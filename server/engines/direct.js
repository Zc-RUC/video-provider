import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseContentRange } from '../utils.js';
import { downloadWithCurl, isDnsError } from './curl.js';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36';

export async function fetchMedia(url, { signal, headers = {} }) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('连接超时，请检查网络后重试。')), 30000);
  const combined = AbortSignal.any([signal, timeout.signal]);
  try {
    return await fetch(url, {
      headers: { 'user-agent': USER_AGENT, ...headers },
      redirect: 'follow',
      signal: combined,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fileSize(file) {
  try {
    return (await fs.promises.stat(file)).size;
  } catch {
    return 0;
  }
}

export async function pipeToFile(response, destination, { append = false, onBytes, signal }) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      try {
        onBytes?.(chunk.length);
        callback(null, chunk);
      } catch (error) {
        callback(error);
      }
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(destination, { flags: append ? 'a' : 'w' }), { signal });
}

async function rangeProbe(url, signal, requestHeaders = {}) {
  const response = await fetchMedia(url, { signal, headers: { ...requestHeaders, range: 'bytes=0-0' } });
  if (response.status !== 206) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const total = parseContentRange(response.headers.get('content-range'));
  await response.arrayBuffer();
  return total;
}

async function downloadSingle(task, target, context, retryWithoutRange = true) {
  const part = `${target}.part`;
  let existing = await fileSize(part);
  const headers = { ...(task.requestHeaders || {}), ...(existing ? { range: `bytes=${existing}-` } : {}) };
  let response = await fetchMedia(task.mediaUrl, { signal: context.signal, headers });
  if (response.status === 416 && retryWithoutRange) {
    await response.body?.cancel().catch(() => {});
    await fs.promises.rm(part, { force: true });
    return downloadSingle(task, target, context, false);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`下载请求失败（HTTP ${response.status}）。`);
  }
  if ((response.headers.get('content-type') || '').includes('text/html')) {
    await response.body?.cancel().catch(() => {});
    throw new Error('下载链接返回了网页而不是媒体文件，请重新解析。');
  }
  const append = response.status === 206 && existing > 0;
  if (append) {
    const returnedStart = Number(/^bytes\s+(\d+)-/i.exec(response.headers.get('content-range') || '')?.[1]);
    if (returnedStart !== existing) {
      await response.body?.cancel().catch(() => {});
      throw new Error('服务器返回了错误的续传位置，已保护已有下载数据。');
    }
  }
  if (!append) existing = 0;
  const length = Number(response.headers.get('content-length')) || null;
  const total = parseContentRange(response.headers.get('content-range')) || (length ? existing + length : task.total);
  let downloaded = existing;
  context.onProgress({ downloaded, total, progress: total ? Math.min(99, downloaded / total * 100) : 0 });
  await pipeToFile(response, part, {
    append,
    signal: context.signal,
    onBytes(bytes) {
      downloaded += bytes;
      context.onProgress({ downloaded, total, progress: total ? Math.min(99.5, downloaded / total * 100) : null });
    },
  });
  const actual = await fileSize(part);
  if (total && actual !== total) {
    throw new Error(`连接提前结束，已保存 ${actual} / ${total} 字节；继续下载即可重试。`);
  }
  await fs.promises.rename(part, target);
  context.onProgress({ downloaded: actual, total: actual, progress: 100 });
}

async function downloadChunk(task, target, chunk, index, total, context, report) {
  const directory = `${target}.parts`;
  const part = path.join(directory, `${index}.part`);
  await fs.promises.mkdir(directory, { recursive: true });
  const expected = chunk.end - chunk.start + 1;
  let existing = await fileSize(part);
  if (existing > expected) {
    await fs.promises.rm(part, { force: true });
    existing = 0;
  }
  if (existing === expected) {
    report(index, existing);
    return;
  }
  const start = chunk.start + existing;
  const response = await fetchMedia(task.mediaUrl, {
    signal: context.signal,
    headers: { ...(task.requestHeaders || {}), range: `bytes=${start}-${chunk.end}` },
  });
  if (response.status !== 206) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`服务器未按请求返回分段数据（HTTP ${response.status}）。`);
  }
  const returnedStart = Number(/^bytes\s+(\d+)-/i.exec(response.headers.get('content-range') || '')?.[1]);
  if (returnedStart !== start) {
    await response.body?.cancel().catch(() => {});
    throw new Error('服务器返回了错误的字节范围，已保护已有下载数据。');
  }
  let current = existing;
  await pipeToFile(response, part, {
    append: existing > 0,
    signal: context.signal,
    onBytes(bytes) {
      current += bytes;
      if (current > expected) throw new Error('分段数据超过预期大小。');
      report(index, current);
    },
  });
  if (current !== expected) throw new Error(`第 ${index + 1} 个分段未下载完整，继续下载即可重试。`);
  report(index, current);
}

async function assembleParts(target, chunks, signal) {
  const directory = `${target}.parts`;
  const assembled = `${target}.assemble`;
  await fs.promises.rm(assembled, { force: true });
  for (let index = 0; index < chunks.length; index += 1) {
    await pipeline(
      createReadStream(path.join(directory, `${index}.part`)),
      createWriteStream(assembled, { flags: index ? 'a' : 'w' }),
      { signal },
    );
  }
  await fs.promises.rename(assembled, target);
  await fs.promises.rm(directory, { recursive: true, force: true });
}

async function downloadParallel(task, target, total, context) {
  const desired = Math.max(2, Math.min(8, context.settings.connections || 4));
  const count = Math.min(desired, Math.max(2, Math.floor(total / (1024 * 1024))));
  const size = Math.ceil(total / count);
  const chunks = Array.from({ length: count }, (_, index) => ({
    start: index * size,
    end: Math.min(total - 1, (index + 1) * size - 1),
  })).filter((chunk) => chunk.start <= chunk.end);
  const received = Array(chunks.length).fill(0);
  for (let index = 0; index < chunks.length; index += 1) {
    received[index] = await fileSize(path.join(`${target}.parts`, `${index}.part`));
  }
  let lastReport = 0;
  const report = (index, bytes) => {
    received[index] = bytes;
    const now = Date.now();
    if (now - lastReport < 80 && received.reduce((sum, value) => sum + value, 0) !== total) return;
    lastReport = now;
    const downloaded = received.reduce((sum, value) => sum + value, 0);
    context.onProgress({ downloaded, total, progress: Math.min(99.5, downloaded / total * 100) });
  };
  report(0, received[0]);

  const local = new AbortController();
  const forwardAbort = () => local.abort(context.signal.reason);
  context.signal.addEventListener('abort', forwardAbort, { once: true });
  const localContext = { ...context, signal: local.signal };
  const workers = chunks.map((chunk, index) => downloadChunk(task, target, chunk, index, total, localContext, report));
  try {
    await Promise.all(workers);
  } catch (error) {
    local.abort(error);
    await Promise.allSettled(workers);
    throw context.signal.aborted ? context.signal.reason : error;
  } finally {
    context.signal.removeEventListener('abort', forwardAbort);
  }
  await assembleParts(target, chunks, context.signal);
  context.onProgress({ downloaded: total, total, progress: 100 });
}

async function downloadDirectWithFetch(task, context) {
  const target = task.mediaPath || task.outputPath;
  const existing = await fileSize(target);
  if (existing > 0) {
    context.onProgress({ downloaded: existing, total: task.total || existing, progress: 100 });
    return;
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const canParallel = (task.total || 0) >= 2 * 1024 * 1024 && (context.settings.connections || 4) > 1;
  if (canParallel) {
    const total = await rangeProbe(task.mediaUrl, context.signal, task.requestHeaders || {}).catch(() => null);
    if (total) {
      await downloadParallel(task, target, total, context);
      return;
    }
  }
  await downloadSingle(task, target, context);
}

export async function downloadDirect(task, context) {
  try {
    return await downloadDirectWithFetch(task, context);
  } catch (error) {
    if (isDnsError(error)) return downloadWithCurl(task, context);
    throw error;
  }
}

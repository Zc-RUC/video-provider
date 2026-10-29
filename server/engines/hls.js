import { createDecipheriv, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fetchMedia, pipeToFile } from './direct.js';
import { parseMaster, parseMedia } from '../hls-parser.js';

async function text(url, signal) {
  const response = await fetchMedia(url, { signal });
  if (!response.ok) throw new Error(`读取 HLS 清单失败（HTTP ${response.status}）。`);
  return { body: await response.text(), url: response.url || url };
}

async function size(file) {
  try {
    return (await fs.promises.stat(file)).size;
  } catch {
    return 0;
  }
}

async function saveState(file, state) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(state));
}

async function downloadSegment(segment, directory, signal) {
  const destination = path.join(directory, `${segment.sequence}.seg`);
  if (await size(destination)) return size(destination);
  const part = `${destination}.part`;
  let existing = await size(part);
  const base = segment.range?.start || 0;
  const headers = (segment.range || existing) ? { range: `bytes=${base + existing}-${segment.range?.end ?? ''}` } : {};
  const response = await fetchMedia(segment.uri, { signal, headers });
  if (!response.ok || (segment.range && response.status !== 206)) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HLS 分片 ${segment.sequence} 下载失败（HTTP ${response.status}）。`);
  }
  const append = existing > 0 && response.status === 206;
  if (!append) existing = 0;
  await pipeToFile(response, part, { append, signal });
  const expected = segment.range ? segment.range.end - segment.range.start + 1 : null;
  const actual = await size(part);
  if (expected && actual !== expected) throw new Error(`HLS 分片 ${segment.sequence} 不完整，继续下载即可重试。`);
  await fs.promises.rename(part, destination);
  return actual;
}

function sequenceIv(sequence) {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(sequence), 8);
  return iv;
}

async function decrypt(buffer, segment, cacheDir, signal) {
  if (!segment.key || segment.key.method === 'NONE') return buffer;
  if (segment.key.method !== 'AES-128') throw new Error(`暂不支持 HLS 加密方式 ${segment.key.method}。`);
  const digest = createHash('sha256').update(segment.key.uri).digest('hex').slice(0, 24);
  const keyFile = path.join(cacheDir, `${digest}.key`);
  let key = await fs.promises.readFile(keyFile).catch(() => null);
  if (!key) {
    const response = await fetchMedia(segment.key.uri, { signal });
    if (!response.ok) throw new Error('无法读取 HLS 解密密钥。');
    key = Buffer.from(await response.arrayBuffer());
    if (key.length !== 16) throw new Error('HLS 密钥长度无效。');
    await fs.promises.mkdir(cacheDir, { recursive: true });
    await fs.promises.writeFile(keyFile, key);
  }
  const iv = segment.key.iv ? Buffer.from(segment.key.iv.replace(/^0x/i, ''), 'hex') : sequenceIv(segment.sequence);
  if (iv.length !== 16) throw new Error('HLS 初始化向量无效。');
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

async function initSegment(segment, directory, signal) {
  if (!segment.map) return null;
  const digest = createHash('sha256').update(`${segment.map.uri}|${segment.map.range?.start || 0}|${segment.map.range?.end || ''}`).digest('hex').slice(0, 24);
  const destination = path.join(directory, `${digest}.init`);
  if (!await size(destination)) {
    const headers = segment.map.range ? { range: `bytes=${segment.map.range.start}-${segment.map.range.end}` } : {};
    const response = await fetchMedia(segment.map.uri, { signal, headers });
    if (!response.ok) throw new Error('无法下载 HLS 初始化分片。');
    await fs.promises.mkdir(directory, { recursive: true });
    await pipeToFile(response, destination, { signal });
  }
  return decrypt(await fs.promises.readFile(destination), segment, directory, signal);
}

async function assemble(task, state, directory, signal) {
  const assembled = `${task.mediaPath}.assemble`;
  await fs.promises.rm(assembled, { force: true });
  await fs.promises.mkdir(path.dirname(task.mediaPath), { recursive: true });
  const output = await fs.promises.open(assembled, 'w');
  let previousMap = null;
  try {
    for (const segment of state.segments) {
      if (signal.aborted) throw signal.reason;
      const mapKey = segment.map ? `${segment.map.uri}|${segment.map.range?.start || 0}` : null;
      if (segment.map && mapKey !== previousMap) {
        const init = await initSegment(segment, directory, signal);
        if (init) await output.write(init);
        previousMap = mapKey;
      }
      const encrypted = await fs.promises.readFile(path.join(directory, `${segment.sequence}.seg`));
      const content = await decrypt(encrypted, segment, directory, signal);
      await output.write(content);
    }
  } finally {
    await output.close();
  }
  await fs.promises.rename(assembled, task.mediaPath);
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', aborted, { once: true });
  });
}

export async function downloadHls(task, context) {
  if (await size(task.mediaPath)) return;
  const stateFile = path.join(context.partialsDir, `${task.id}-hls.json`);
  const directory = path.join(context.partialsDir, `${task.id}-segments`);
  let state = await fs.promises.readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null);
  if (!state) {
    const manifest = await text(task.mediaUrl, context.signal);
    let playlist = parseMedia(manifest.body, manifest.url);
    if (!playlist.segments.length) {
      const variants = parseMaster(manifest.body, manifest.url);
      if (!variants.length) throw new Error('HLS 清单中没有可下载的分片。');
      const selected = await text(variants[0].url, context.signal);
      playlist = parseMedia(selected.body, selected.url);
      state = { playlistUrl: selected.url };
    }
    if (!playlist.segments.length) throw new Error('HLS 清单中没有可下载的分片。');
    state = {
      playlistUrl: state?.playlistUrl || manifest.url,
      targetDuration: playlist.targetDuration,
      live: !playlist.endList,
      nextSequence: playlist.mediaSequence + playlist.segments.length,
      segments: playlist.segments.map((segment) => ({ ...segment, complete: false, bytes: 0 })),
    };
    await saveState(stateFile, state);
  }
  context.onProgress({ live: state.live, totalSegments: state.segments.length, completedSegments: state.segments.filter((segment) => segment.complete).length });

  while (true) {
    const pending = state.segments.find((segment) => !segment.complete);
    if (!pending) break;
    pending.bytes = await downloadSegment(pending, directory, context.signal);
    pending.complete = true;
    await saveState(stateFile, state);
    const completed = state.segments.filter((segment) => segment.complete);
    const downloaded = completed.reduce((sum, segment) => sum + segment.bytes, 0);
    const knownTotal = state.segments.every((segment) => segment.range) ? state.segments.reduce((sum, segment) => sum + segment.range.end - segment.range.start + 1, 0) : null;
    context.onProgress({
      downloaded,
      total: knownTotal,
      progress: state.live ? null : completed.length / state.segments.length * 100,
      live: state.live,
      completedSegments: completed.length,
      totalSegments: state.segments.length,
    });
  }

  while (state.live && !context.isFinishRequested()) {
    await abortableDelay(Math.max(1000, state.targetDuration * 1000), context.signal);
    const manifest = await text(state.playlistUrl, context.signal);
    const playlist = parseMedia(manifest.body, manifest.url);
    const known = new Set(state.segments.map((segment) => segment.sequence));
    const additions = playlist.segments.filter((segment) => segment.sequence >= state.nextSequence && !known.has(segment.sequence));
    state.segments.push(...additions.map((segment) => ({ ...segment, complete: false, bytes: 0 })));
    state.nextSequence = Math.max(state.nextSequence, playlist.mediaSequence + playlist.segments.length);
    state.live = !playlist.endList;
    await saveState(stateFile, state);
    for (const segment of additions) {
      if (context.isFinishRequested()) break;
      segment.bytes = await downloadSegment(segment, directory, context.signal);
      segment.complete = true;
      await saveState(stateFile, state);
      const completed = state.segments.filter((item) => item.complete);
      context.onProgress({
        downloaded: completed.reduce((sum, item) => sum + item.bytes, 0),
        total: null,
        progress: null,
        live: state.live,
        completedSegments: completed.length,
        totalSegments: state.segments.length,
      });
    }
  }

  if (context.isFinishRequested()) state.segments = state.segments.filter((segment) => segment.complete);
  const incomplete = state.segments.find((segment) => !segment.complete);
  if (incomplete) throw new Error('直播分片尚未下载完整，请继续下载后再停止保存。');
  if (!state.segments.length) throw new Error('还没有可保存的直播分片。');
  await assemble(task, state, directory, context.signal);
  await fs.promises.rm(directory, { recursive: true, force: true });
  await fs.promises.rm(stateFile, { force: true });
  const downloaded = await size(task.mediaPath);
  context.onProgress({ downloaded, total: downloaded, progress: 100, live: false });
}

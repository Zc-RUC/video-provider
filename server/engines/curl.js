import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { runProcess } from './process.js';

const execFileAsync = promisify(execFile);
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36';

export function isDnsError(error) {
  const code = error?.cause?.code || error?.code;
  return ['ENOTFOUND', 'EAI_AGAIN'].includes(code);
}

async function resolveArguments(urlValue) {
  const url = new URL(urlValue);
  const response = await fetch(`https://dns.google/resolve?name=${url.hostname}&type=A`, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('备用 DNS 查询失败。');
  const data = await response.json();
  const address = data.Answer?.find((answer) => answer.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(answer.data))?.data;
  if (!address) throw new Error(`备用 DNS 也无法解析 ${url.hostname}。`);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return ['--resolve', `${url.hostname}:${port}:${address}`];
}

export async function probeWithCurl(url, pageUrl) {
  const args = [
    '--silent', '--show-error', '--fail', '--location', '--http1.1',
    '--max-time', '30', '--range', '0-0', '--output', '/dev/null',
    '--dump-header', '-', '--write-out', '\nDOWNBIT_EFFECTIVE_URL=%{url_effective}',
    '--referer', pageUrl, '--user-agent', USER_AGENT,
    ...(await resolveArguments(url)),
    url,
  ];
  const { stdout } = await execFileAsync('curl', args, { timeout: 45000, windowsHide: true });
  const finalUrl = /DOWNBIT_EFFECTIVE_URL=(.*)/.exec(stdout)?.[1]?.trim() || url;
  const blocks = stdout.split(/\r?\n\r?\n/).filter((block) => /^HTTP\//.test(block));
  const header = blocks.at(-1) || '';
  const contentType = /content-type:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim() || '';
  if (!contentType.startsWith('video/') && !contentType.includes('octet-stream')) throw new Error('地址没有返回视频文件');
  return {
    finalUrl,
    contentType,
    contentDisposition: /content-disposition:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim() || '',
    size: Number(/content-range:\s*bytes\s+\d+-\d+\/(\d+)/i.exec(header)?.[1]) || Number(/content-length:\s*(\d+)/i.exec(header)?.[1]) || null,
    acceptRanges: /accept-ranges:\s*bytes/i.test(header),
  };
}

async function fileSize(file) {
  try {
    return (await fs.promises.stat(file)).size;
  } catch {
    return 0;
  }
}

export async function downloadWithCurl(task, context) {
  const target = task.mediaPath || task.outputPath;
  const part = `${target}.part`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  let existing = await fileSize(part);
  if (task.total && existing === task.total) {
    await fs.promises.rename(part, target);
    context.onProgress({ downloaded: existing, total: existing, progress: 100 });
    return;
  }
  const args = [
    '--fail', '--location', '--http1.1',
    '--retry', '4', '--retry-delay', '2', '--connect-timeout', '30',
    '--continue-at', '-', '--output', part,
    '--referer', task.sourceUrl, '--user-agent', USER_AGENT,
    ...(await resolveArguments(task.mediaUrl)),
    task.mediaUrl,
  ];
  let first = true;
  const report = async () => {
    const downloaded = await fileSize(part);
    context.onProgress({
      downloaded,
      total: task.total,
      progress: task.total ? Math.min(99.5, downloaded / task.total * 100) : null,
      speed: first ? 0 : undefined,
    });
    first = false;
  };
  await report();
  const timer = setInterval(() => report().catch(() => {}), 1000);
  timer.unref();
  try {
    await runProcess('curl', args, { signal: context.signal });
  } finally {
    clearInterval(timer);
  }
  existing = await fileSize(part);
  if (!existing || (task.total && existing !== task.total)) {
    throw new Error(`下载不完整，已保存 ${existing}${task.total ? ` / ${task.total}` : ''} 字节。`);
  }
  await fs.promises.rename(part, target);
  context.onProgress({ downloaded: existing, total: task.total || existing, progress: 100 });
}

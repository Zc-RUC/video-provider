import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { binaries } from '../binaries.js';

export function runProcess(binary, args, { signal, onLine, onStage }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const abort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', abort, { once: true });
    const consume = (chunk, stream) => {
      const text = String(chunk);
      if (stream === 'stderr') stderr = `${stderr}${text}`.slice(-8000);
      let buffer = (stream === 'stdout' ? stdoutBuffer : stderrBuffer) + text;
      const lines = buffer.split(/\r?\n|\r/);
      buffer = lines.pop() || '';
      if (stream === 'stdout') stdoutBuffer = buffer;
      else stderrBuffer = buffer;
      for (const line of lines) onLine?.(line, stream);
      if (/\[Merger]|\[ExtractAudio]|\[VideoConvertor]/i.test(text)) onStage?.('processing');
    };
    child.stdout.on('data', (chunk) => consume(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => consume(chunk, 'stderr'));
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason);
      else if (code !== 0) reject(new Error(stderr.trim().split('\n').slice(-8).join('\n') || `处理程序退出，代码 ${code}。`));
      else resolve({ stdout: stdoutBuffer, stderr: stderrBuffer });
    });
  });
}

export async function postprocess(task, { signal, onStage }) {
  if (!binaries.ffmpeg) throw new Error('此格式需要 FFmpeg 处理。请运行 npm install 或设置 FFMPEG_PATH。');
  await fs.promises.mkdir(path.dirname(task.outputPath), { recursive: true });
  const audio = task.audioOnly;
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i', task.mediaPath,
    ...(audio ? ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] : ['-c', 'copy', '-movflags', '+faststart']),
    '-metadata', `title=${task.title}`,
    '-metadata', `artist=${task.uploader || task.source || ''}`,
    '-metadata', `comment=${task.sourceUrl}`,
    task.outputPath,
  ];
  await runProcess(binaries.ffmpeg, args, { signal, onStage });
  await fs.promises.rm(task.mediaPath, { force: true });
}

import fs from 'node:fs';
import path from 'node:path';
import { binaries } from '../binaries.js';
import { runProcess } from './process.js';

function formatSelector(task) {
  if (task.audioOnly) return 'bestaudio/best';
  if (!task.formatId || task.formatId === 'recommended') return 'bestvideo*+bestaudio/best';
  if (task.formatHasVideo && !task.formatHasAudio) return `${task.formatId}+bestaudio/${task.formatId}`;
  return task.formatId;
}

async function locateOutput(task, printedPath) {
  const candidates = [printedPath, task.outputPath].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const stat = await fs.promises.stat(candidate);
      if (stat.isFile() && stat.size > 0) return { path: candidate, size: stat.size };
    } catch {}
  }
  const directory = path.dirname(task.outputPath);
  const basename = path.basename(task.outputPath, path.extname(task.outputPath));
  const files = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
  const matches = [];
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.startsWith(`${basename}.`)) continue;
    if (/\.(part|ytdl|temp|f\d+)$/.test(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    const stat = await fs.promises.stat(fullPath);
    if (stat.size > 0) matches.push({ path: fullPath, size: stat.size, mtime: stat.mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0] || null;
}

export async function downloadWithYtDlp(task, context) {
  if (!binaries.ytDlp) throw new Error('yt-dlp 未安装，无法下载此站点。');
  const progressTemplate = 'DOWNBIT_PROGRESS={"downloaded":%(progress.downloaded_bytes)j,"total":%(progress.total_bytes)j,"estimate":%(progress.total_bytes_estimate)j,"speed":%(progress.speed)j,"eta":%(progress.eta)j}';
  const cookieBrowser = task.cookiesFromBrowser || context.settings.cookiesFromBrowser;
  const args = [
    '--newline',
    '--continue',
    '--no-cache-dir',
    '--no-warnings',
    '--no-playlist',
    '--no-overwrites',
    '--socket-timeout', '30',
    '--retries', '3',
    '--embed-metadata',
    '--format', formatSelector(task),
    '--output', task.outputTemplate,
    '--progress-template', `download:${progressTemplate}`,
    '--print', 'after_move:DOWNBIT_FILE=%(filepath)j',
    ...(binaries.ffmpeg ? ['--ffmpeg-location', binaries.ffmpeg] : []),
    ...(task.audioOnly ? ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K'] : ['--merge-output-format', 'mp4']),
    ...(cookieBrowser && cookieBrowser !== 'none' ? ['--cookies-from-browser', cookieBrowser] : []),
    '--', task.sourceUrl,
  ];
  let printedPath = null;
  const onLine = (line) => {
    if (line.includes('DOWNBIT_FILE=')) {
      const value = line.slice(line.indexOf('DOWNBIT_FILE=') + 13);
      try { printedPath = JSON.parse(value); } catch { printedPath = value; }
      return;
    }
    if (!line.includes('DOWNBIT_PROGRESS=')) return;
    const value = line.slice(line.indexOf('DOWNBIT_PROGRESS=') + 17);
    try {
      const progress = JSON.parse(value);
      const number = (input) => Number.isFinite(Number(input)) ? Number(input) : null;
      const downloaded = number(progress.downloaded) || 0;
      const total = number(progress.total) || number(progress.estimate);
      context.onProgress({
        downloaded,
        total,
        progress: total ? Math.min(99.5, downloaded / total * 100) : null,
        speed: number(progress.speed),
        eta: number(progress.eta),
      });
    } catch {}
  };
  await runProcess(binaries.ytDlp, args, {
    signal: context.signal,
    onLine,
    onStage: context.onStage,
  });
  const output = await locateOutput(task, printedPath);
  if (!output) throw new Error('下载程序已完成，但没有找到输出文件。请检查下载目录权限。');
  return output;
}

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function executable(candidate) {
  if (!candidate) return null;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function fromPath(name) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const result = executable(path.join(directory, name));
    if (result) return result;
  }
  return null;
}

const bundledName = { darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux', win32: 'yt-dlp.exe' }[process.platform];
const bundled = bundledName ? path.join(root, 'bin', bundledName) : null;

export const binaries = {
  ytDlp: executable(process.env.YT_DLP_PATH) || executable(bundled) || fromPath(process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
  ffmpeg: executable(process.env.FFMPEG_PATH) || executable(ffmpegStatic) || fromPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
};

function version(binary, args = ['--version']) {
  if (!binary) return null;
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 4000, windowsHide: true });
  return result.status === 0 ? String(result.stdout || '').split('\n')[0].trim() : null;
}

export function capabilities() {
  return {
    ytDlp: Boolean(binaries.ytDlp),
    ffmpeg: Boolean(binaries.ffmpeg),
    ytDlpVersion: version(binaries.ytDlp),
    ffmpegVersion: version(binaries.ffmpeg, ['-version']),
    platform: process.platform,
  };
}

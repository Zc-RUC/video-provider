import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = { darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux', win32: 'yt-dlp.exe' };
const name = names[process.platform];
if (!name) {
  console.log(`[video-provider] No bundled yt-dlp for ${process.platform}; set YT_DLP_PATH.`);
  process.exit(0);
}

const destination = path.join(root, 'bin', name);
try {
  await access(destination);
  console.log('[video-provider] yt-dlp is already installed.');
  process.exit(0);
} catch {}

await mkdir(path.dirname(destination), { recursive: true });
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`;
console.log('[video-provider] Installing yt-dlp…');
try {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Video-Provider/1.2.0' },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  if (process.platform !== 'win32') await chmod(destination, 0o755);
  console.log(`[video-provider] yt-dlp installed at ${destination}`);
} catch (error) {
  console.warn(`[video-provider] Could not install yt-dlp: ${error.message}`);
  console.warn('[video-provider] Direct downloads still work. Run npm run postinstall to retry.');
}

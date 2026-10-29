import puppeteer from 'puppeteer-core';
import { chromeExecutable } from './accounts.js';

const url = process.argv[2];
if (!url) throw new Error('缺少网页地址。');

const browser = await puppeteer.launch({
  executablePath: chromeExecutable(),
  headless: true,
  pipe: true,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-first-run', '--no-default-browser-check'],
});
const page = await browser.newPage();
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let candidates = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const main = await page.$eval('video', (video) => ({
      src: video.currentSrc || video.src,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      poster: video.poster || null,
    })).catch(() => null);
    if (main?.src) {
      candidates = [main];
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  process.stdout.write(JSON.stringify({ candidates }));
} finally {
  await browser.close().catch(() => {});
}

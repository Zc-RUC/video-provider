import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const id = () => randomUUID();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function expandHome(value) {
  const input = String(value || '').trim();
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function normalizeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('只支持不带账号信息的 HTTP 或 HTTPS 链接。');
  }
  url.hash = '';
  return url.toString();
}

export function sanitizeFilename(value) {
  const cleaned = String(value || '未命名媒体')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || '未命名媒体').slice(0, 160);
}

export function extensionFrom(urlValue, contentType = '') {
  const byType = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/flac': '.flac',
  };
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (byType[mime]) return byType[mime];
  try {
    const ext = path.extname(new URL(urlValue).pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {}
  return mime.startsWith('audio/') ? '.audio' : '.mp4';
}

export function filenameFrom(urlValue, contentDisposition = '') {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1];
  let name = encoded ? decodeURIComponent(encoded) : plain;
  if (!name) {
    try {
      name = decodeURIComponent(path.basename(new URL(urlValue).pathname));
    } catch {
      name = '未命名媒体';
    }
  }
  return name || '未命名媒体';
}

export function uniqueOutputPath(directory, basename, extension, reserved = new Set()) {
  const safeBase = sanitizeFilename(basename);
  let candidate = path.join(directory, `${safeBase}${extension}`);
  for (let index = 1; reserved.has(candidate) || fs.existsSync(candidate); index += 1) {
    candidate = path.join(directory, `${safeBase} (${index})${extension}`);
  }
  return candidate;
}

export function errorMessage(error) {
  if (error?.name === 'AbortError') return '操作已停止。';
  return String(error?.message || error || '发生未知错误。')
    .replace(/Error:\s*/g, '')
    .slice(-1600);
}

export function abortError() {
  return new DOMException('The operation was aborted', 'AbortError');
}

export function parseContentRange(value) {
  const match = /^bytes\s+\d+-\d+\/(\d+|\*)$/i.exec(value || '');
  return match && match[1] !== '*' ? Number(match[1]) : null;
}

export function publicTask(task) {
  return { ...task };
}

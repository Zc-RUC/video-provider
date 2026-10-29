import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { binaries } from './binaries.js';
import { parseMaster } from './hls-parser.js';
import { errorMessage, extensionFrom, filenameFrom, id, isHttpUrl, normalizeUrl } from './utils.js';

const execFileAsync = promisify(execFile);
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36';
const directExtensions = new Set(['.mp4', '.webm', '.mov', '.mkv', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.m4v']);

function sourceName(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '网页搜索';
  }
}

async function probe(url) {
  const options = {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  };
  let response = await fetch(url, { ...options, method: 'HEAD' });
  if ([400, 403, 405, 501].includes(response.status)) {
    response = await fetch(url, {
      ...options,
      headers: { ...options.headers, range: 'bytes=0-0' },
      method: 'GET',
    });
  }
  if (!response.ok && response.status !== 206) {
    throw new Error(`链接返回 HTTP ${response.status}，尝试使用站点解析器。`);
  }
  const result = {
    finalUrl: response.url || url,
    contentType: response.headers.get('content-type') || '',
    contentDisposition: response.headers.get('content-disposition') || '',
    size: Number(/\/(\d+)$/.exec(response.headers.get('content-range') || '')?.[1]) || Number(response.headers.get('content-length')) || null,
    acceptRanges: (response.headers.get('accept-ranges') || '').includes('bytes'),
  };
  await response.body?.cancel().catch(() => {});
  return result;
}

function directInfo(url, details) {
  const mime = details.contentType.split(';')[0].toLowerCase();
  const filename = filenameFrom(details.finalUrl, details.contentDisposition);
  const ext = extensionFrom(details.finalUrl, details.contentType);
  const title = filename.replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '').replace(/[-_]+/g, ' ') || '未命名媒体';
  const audio = mime.startsWith('audio/') || ['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac'].includes(ext);
  return {
    kind: 'direct',
    mediaKind: audio ? 'audio' : 'video',
    sourceUrl: url,
    originalInput: url,
    mediaUrl: details.finalUrl,
    title,
    uploader: sourceName(details.finalUrl),
    source: sourceName(details.finalUrl),
    thumbnail: null,
    duration: null,
    size: details.size,
    acceptRanges: details.acceptRanges,
    extension: ext,
    defaultFormat: 'original',
    formats: [{
      id: 'original',
      label: `原始${audio ? '音频' : '文件'} · ${ext.slice(1).toUpperCase()}`,
      ext: ext.slice(1),
      height: null,
      fps: null,
      filesize: details.size,
      hasVideo: !audio,
      hasAudio: true,
    }],
  };
}

async function hlsInfo(url, details) {
  const response = await fetch(details.finalUrl, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`无法读取 HLS 清单（HTTP ${response.status}）。`);
  const text = await response.text();
  if (!text.includes('#EXTM3U')) throw new Error('链接没有返回有效的 HLS 清单。');
  const variants = parseMaster(text, response.url || details.finalUrl);
  const filename = filenameFrom(details.finalUrl);
  const formats = variants.length ? variants.map((variant, index) => ({
    id: `variant-${index}`,
    label: `${variant.height ? `${variant.height}p` : `${Math.round((variant.bandwidth || 0) / 1000)} kbps`}${variant.fps ? ` ${variant.fps}fps` : ''} · HLS`,
    ext: 'mp4',
    height: variant.height,
    fps: variant.fps,
    filesize: null,
    hasVideo: true,
    hasAudio: true,
    url: variant.url,
  })) : [{
    id: 'hls',
    label: '自动画质 · HLS',
    ext: 'mp4',
    height: null,
    fps: null,
    filesize: null,
    hasVideo: true,
    hasAudio: true,
    url: response.url || details.finalUrl,
  }];
  return {
    kind: 'hls',
    mediaKind: 'video',
    sourceUrl: url,
    originalInput: url,
    mediaUrl: response.url || details.finalUrl,
    title: filename.replace(/\.m3u8$/i, '').replace(/[-_]+/g, ' ') || 'HLS 视频',
    uploader: sourceName(url),
    source: sourceName(url),
    thumbnail: null,
    duration: null,
    defaultFormat: formats[0].id,
    formats,
  };
}

function cookieArgs(options) {
  if (options.cookieFile) return ['--cookies', options.cookieFile];
  const browser = options.cookiesFromBrowser;
  return browser && browser !== 'none' ? ['--cookies-from-browser', browser] : [];
}

function isBilibili(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com') || hostname === 'b23.tv';
  } catch {
    return false;
  }
}

function isXiaohongshu(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com');
  } catch {
    return false;
  }
}

function xiaohongshuTarget(value) {
  const url = new URL(value);
  if (url.hostname === 'www.xiaohongshu.com' && url.pathname === '/login') {
    const redirect = url.searchParams.get('redirectPath');
    if (redirect && isHttpUrl(redirect)) return normalizeUrl(redirect);
  }
  return value;
}

async function inspectSite(input, options = {}) {
  if (!binaries.ytDlp) {
    throw new Error('站点解析需要 yt-dlp。请在项目目录运行 npm run postinstall，或设置 YT_DLP_PATH。');
  }
  const search = !isHttpUrl(input);
  const target = search ? `ytsearch1:${input}` : normalizeUrl(input);
  const args = [
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--no-cache-dir',
    '--socket-timeout', '30',
    '--retries', '3',
    '--extractor-retries', '4',
    '--retry-sleep', '2',
    '--playlist-end', '25',
    ...cookieArgs(options),
    '--', target,
  ];
  try {
    const { stdout } = await execFileAsync(binaries.ytDlp, args, {
      timeout: 240000,
      maxBuffer: 48 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf8' },
    });
    let data = JSON.parse(stdout);
    if (data._type === 'playlist' && data.entries?.length === 1) data = data.entries[0];
    if (data._type === 'playlist' || (Array.isArray(data.entries) && !data.formats)) {
      return {
        kind: 'playlist',
        mediaKind: 'video',
        sourceUrl: data.webpage_url || target,
        originalInput: input,
        title: data.title || input,
        uploader: data.uploader || data.channel || sourceName(target),
        source: data.extractor_key || data.extractor || sourceName(target),
        thumbnail: data.thumbnail || null,
        duration: null,
        formats: [],
        entries: (data.entries || []).filter(Boolean).map((entry, index) => ({
          id: entry.id || String(index),
          title: entry.title || `条目 ${index + 1}`,
          url: entry.webpage_url || entry.url,
          duration: entry.duration || null,
          thumbnail: entry.thumbnail || entry.thumbnails?.at(-1)?.url || null,
          uploader: entry.uploader || entry.channel || data.uploader || null,
        })).filter((entry) => entry.url && isHttpUrl(entry.url)),
      };
    }
    const formats = (data.formats || []).filter((format) => format.url && (format.vcodec !== 'none' || format.acodec !== 'none')).map((format) => {
      const hasVideo = format.vcodec !== 'none';
      const hasAudio = format.acodec !== 'none';
      const quality = hasVideo ? (format.format_note || (format.height ? `${format.height}p` : '视频')) : '音频';
      const codecName = format.vcodec?.split('.')[0];
      const codec = ({ av01: 'AV1', hev1: 'HEVC', hvc1: 'HEVC', avc1: 'H.264', h264: 'H.264', vp09: 'VP9', vp9: 'VP9' })[codecName] || (hasVideo ? codecName?.toUpperCase().slice(0, 12) : null);
      const dynamicRange = format.dynamic_range && format.dynamic_range.toUpperCase() !== 'SDR' && !/(HDR|杜比|Dolby)/i.test(quality) ? format.dynamic_range : null;
      const label = [
        quality,
        format.fps && hasVideo ? `${Math.round(format.fps)}fps` : null,
        codec,
        dynamicRange,
        hasVideo && format.tbr ? `${Math.round(format.tbr)}kbps` : null,
        String(format.ext).toUpperCase(),
        hasVideo && !hasAudio ? '自动合流' : null,
        !hasVideo && format.abr ? `${Math.round(format.abr)}kbps` : null,
      ].filter(Boolean).join(' · ');
      return {
        id: String(format.format_id),
        label,
        ext: format.ext,
        height: format.height || null,
        fps: format.fps || null,
        filesize: format.filesize || format.filesize_approx || null,
        hasVideo,
        hasAudio,
        formatNote: format.format_note || null,
        codec,
        dynamicRange: format.dynamic_range || null,
        tbr: format.tbr || null,
      };
    });
    formats.sort((a, b) => Number(b.hasVideo) - Number(a.hasVideo) || (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0) || (b.tbr || 0) - (a.tbr || 0));
    const recommended = {
      id: 'recommended',
      label: '最佳画质 · 自动选择并合流',
      ext: 'mp4',
      height: null,
      fps: null,
      filesize: null,
      hasVideo: data.vcodec !== 'none',
      hasAudio: true,
    };
    const audioOnly = data.vcodec === 'none';
    return {
      kind: 'ytdlp',
      mediaKind: audioOnly ? 'audio' : 'video',
      sourceUrl: data.webpage_url || data.original_url || target,
      originalInput: input,
      title: data.title || input,
      uploader: data.uploader || data.channel || data.creator || sourceName(target),
      source: data.extractor_key || data.extractor || sourceName(target),
      thumbnail: data.thumbnail || data.thumbnails?.at(-1)?.url || null,
      duration: data.duration || null,
      description: data.description?.slice(0, 500) || '',
      isLive: Boolean(data.is_live),
      defaultFormat: audioOnly ? formats[0]?.id : 'recommended',
      formats: audioOnly ? formats : [recommended, ...formats],
    };
  } catch (error) {
    const detail = error.stderr || error.stdout || errorMessage(error);
    throw new Error(`解析失败：${String(detail).trim().slice(-1200)}`);
  }
}

export class Inspector {
  constructor(settings, accounts) {
    this.settings = settings;
    this.accounts = accounts;
    this.cache = new Map();
  }

  async inspect(rawInput, overrides = {}) {
    const input = String(rawInput || '').trim();
    if (!input) throw new Error('请先粘贴链接或输入搜索内容。');
    const config = { ...this.settings(), ...overrides };
    if (this.accounts) {
      const cookieFile = isBilibili(input)
        ? this.accounts.bilibili?.cookiePath()
        : isXiaohongshu(input)
          ? this.accounts.xiaohongshu?.cookiePath()
          : null;
      if (cookieFile) {
        config.cookieFile = cookieFile;
        config.cookiesFromBrowser = 'none';
      }
    }
    let info;
    if (!isHttpUrl(input)) {
      info = await inspectSite(input, config);
    } else {
      const normalized = normalizeUrl(input);
      const url = isXiaohongshu(normalized) ? xiaohongshuTarget(normalized) : normalized;
      try {
        const details = await probe(url);
        const mime = details.contentType.split(';')[0].toLowerCase();
        const ext = path.extname(new URL(details.finalUrl).pathname).toLowerCase();
        if (mime.includes('mpegurl') || ext === '.m3u8') {
          info = await hlsInfo(url, details);
        } else if (mime.startsWith('video/') || mime.startsWith('audio/') || directExtensions.has(ext)) {
          info = directInfo(url, details);
        } else {
          info = await inspectSite(url, config);
        }
      } catch (error) {
        if (error.message.startsWith('解析失败：')) throw error;
        info = await inspectSite(url, config);
      }
    }
    info.cookiesFromBrowser = config.cookiesFromBrowser || 'none';
    info.cookieFile = config.cookieFile || null;
    info.inspectionId = id();
    info.createdAt = Date.now();
    this.cache.set(info.inspectionId, info);
    if (this.cache.size > 60) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      this.cache.delete(oldest[0]);
    }
    return this.public(info);
  }

  get(inspectionId) {
    const info = this.cache.get(inspectionId);
    if (!info || Date.now() - info.createdAt > 30 * 60 * 1000) {
      throw new Error('解析结果已过期，请重新解析链接。');
    }
    return info;
  }

  public(info) {
    return {
      ...info,
      mediaUrl: undefined,
      cookieFile: undefined,
      acceptRanges: undefined,
      formats: info.formats.map(({ url, ...format }) => format),
    };
  }
}

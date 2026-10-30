#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.argv.slice(2);
const options = { audioOnly: false, json: false, wait: true, port: Number(process.env.DOWNBIT_API_PORT || 4317) };
const rest = [];
for (let index = 0; index < raw.length; index += 1) {
  const arg = raw[index];
  if (arg === '--json') options.json = true;
  else if (arg === '-a' || arg === '--audio') options.audioOnly = true;
  else if (arg === '--no-wait') options.wait = false;
  else if (['-q', '--quality'].includes(arg)) options.quality = Number(raw[++index]);
  else if (['-o', '--output'].includes(arg)) options.outputDir = raw[++index];
  else if (['-f', '--format'].includes(arg)) options.formatId = raw[++index];
  else if (arg === '--port') options.port = Number(raw[++index]);
  else if (arg === '--cookies') options.cookies = raw[++index];
  else if (arg === '-h' || arg === '--help') options.help = true;
  else rest.push(arg);
}
const base = `http://127.0.0.1:${options.port}`;
const commands = new Set(['get', 'info', 'formats', 'list', 'open', 'pause', 'resume', 'retry', 'cancel', 'finish', 'remove', 'help']);
let command = commands.has(rest[0]) ? rest.shift() : 'get';
const input = rest[0];

function help() {
  console.log(`Downbit · 本地视频与音频下载器

用法
  video-provider <url>                  使用默认设置下载
  video-provider get [-a] [-q 720] [-f id] [-o ~/Movies] <url>
  video-provider open <url>              交给工作空间下载，不等待完成
  video-provider info <url|搜索词>        查看标题与来源
  video-provider formats <url>           查看可下载格式
  video-provider list                    查看网页与 CLI 的全部任务
  video-provider pause|resume|cancel|finish|remove <任务ID>

全局选项
  --json                         输出机器可读 JSON
  --no-wait                      创建任务后立即返回
  --cookies <browser>            本次解析使用浏览器登录状态
  --port <port>                  本地服务端口，默认 4317

首次使用 npm link 后可直接运行 video-provider；也可运行 npm run cli -- <命令>。`);
}

async function health() {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(700) });
    const data = await response.json();
    return data.service === 'video-provider-local';
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await health()) return;
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DOWNBIT_API_PORT: String(options.port) },
  });
  child.unref();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await health()) return;
  }
  throw new Error('无法启动本地下载服务。');
}

async function request(route, init = {}) {
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function bytes(value) {
  if (!Number.isFinite(value)) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function duration(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function print(value) {
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === 'string') console.log(value);
  else console.log(value);
}

async function inspect(value) {
  return request('/api/inspect', {
    method: 'POST',
    body: JSON.stringify({ url: value, cookiesFromBrowser: options.cookies }),
  });
}

function chooseFormat(info) {
  if (options.formatId) return options.formatId;
  if (options.quality && !options.audioOnly) {
    const candidates = info.formats.filter((format) => format.hasVideo && format.height);
    const within = candidates.filter((format) => format.height <= options.quality).sort((a, b) => b.height - a.height);
    if (within.length) return within[0].id;
    candidates.sort((a, b) => Math.abs(a.height - options.quality) - Math.abs(b.height - options.quality));
    if (candidates.length) return candidates[0].id;
  }
  return info.defaultFormat;
}

async function create(info) {
  return request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      inspectionId: info.inspectionId,
      formatId: chooseFormat(info),
      audioOnly: options.audioOnly,
      outputDir: options.outputDir,
    }),
  });
}

async function waitFor(task) {
  if (!options.wait) return task;
  let lastLine = '';
  while (true) {
    const state = await request('/api/state');
    const current = state.tasks.find((item) => item.id === task.id);
    if (!current) throw new Error('任务已被移除。');
    if (!options.json) {
      const line = `${current.status.padEnd(11)} ${String(Math.floor(current.progress || 0)).padStart(3)}%  ${bytes(current.downloaded)} / ${bytes(current.total)}  ${current.title}`;
      if (line !== lastLine) process.stderr.write(`\r\x1b[2K${line}`);
      lastLine = line;
    }
    if (current.status === 'completed') {
      if (!options.json) process.stderr.write('\n');
      return current;
    }
    if (['error', 'cancelled'].includes(current.status)) {
      if (!options.json) process.stderr.write('\n');
      throw new Error(current.error || `任务${current.status}。`);
    }
    await new Promise((resolve) => setTimeout(resolve, 850));
  }
}

async function taskId(value) {
  const state = await request('/api/state');
  const matches = state.tasks.filter((task) => task.id.startsWith(value));
  if (matches.length !== 1) throw new Error(matches.length ? '任务 ID 前缀不唯一。' : '找不到任务。');
  return matches[0].id;
}

try {
  if (options.help || command === 'help' || !rest.length && command === 'get' && !input) {
    help();
    process.exit(0);
  }
  await ensureServer();
  if (command === 'list') {
    const state = await request('/api/state');
    if (options.json) print(state.tasks);
    else if (!state.tasks.length) console.log('还没有下载任务。');
    else for (const task of state.tasks) {
      console.log(`${task.id.slice(0, 8)}  ${task.status.padEnd(11)} ${String(Math.floor(task.progress || 0)).padStart(3)}%  ${task.title}`);
    }
  } else if (['pause', 'resume', 'retry', 'cancel', 'finish'].includes(command)) {
    if (!input) throw new Error(`用法: video-provider ${command} <任务ID>`);
    const task = await request(`/api/tasks/${await taskId(input)}/action`, { method: 'POST', body: JSON.stringify({ action: command }) });
    if (options.json) print(task); else console.log(`${task.title}: ${task.status}`);
  } else if (command === 'remove') {
    if (!input) throw new Error('用法: video-provider remove <任务ID>');
    await request(`/api/tasks/${await taskId(input)}`, { method: 'DELETE' });
    if (options.json) print({ removed: input }); else console.log('已移除记录，本地文件保留。');
  } else if (['info', 'formats'].includes(command)) {
    if (!input) throw new Error(`用法: video-provider ${command} <url|搜索词>`);
    const info = await inspect(input);
    if (command === 'info' || options.json) print(info);
    else if (info.kind === 'playlist') {
      for (const [index, entry] of info.entries.entries()) console.log(`${String(index + 1).padStart(2)}  ${entry.title}`);
    } else {
      console.log(`${info.title}\n${info.uploader || info.source} · ${duration(info.duration)}\n`);
      for (const format of info.formats) {
        console.log(`${format.id.padEnd(14)} ${format.label.padEnd(38)} ${bytes(format.filesize)}`);
      }
    }
  } else if (['get', 'open'].includes(command)) {
    if (!input) throw new Error('请提供链接或搜索内容。');
    const info = await inspect(input);
    if (info.kind === 'playlist') throw new Error('这是合集，请先在网页工作空间中选择条目。');
    const task = await create(info);
    const result = command === 'open' ? task : await waitFor(task);
    if (options.json) print(result);
    else if (command === 'open' || !options.wait) console.log(`已创建任务 ${result.id.slice(0, 8)} · ${result.title}`);
    else console.log(`下载完成: ${result.outputPath}`);
  }
} catch (error) {
  if (options.json) console.error(JSON.stringify({ error: error.message }));
  else console.error(`video-provider: ${error.message}`);
  process.exitCode = 1;
}

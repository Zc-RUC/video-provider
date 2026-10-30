import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Store } from './store.js';
import { Inspector } from './inspector.js';
import { DownloadManager } from './manager.js';
import { AccountManager } from './accounts.js';
import { capabilities } from './binaries.js';
import { errorMessage, expandHome } from './utils.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DOWNBIT_DATA_DIR || path.join(root, '.downbit'));
const store = new Store(dataDir);
const accounts = new AccountManager(dataDir);
const xiaohongshu = new AccountManager(dataDir, 'xiaohongshu');
const accountManagers = { bilibili: accounts, xiaohongshu };
const inspector = new Inspector(() => store.state.settings, accountManagers);
const manager = new DownloadManager(store, path.join(dataDir, 'partials'));
for (const accountManager of Object.values(accountManagers)) accountManager.on('change', () => manager.emitChange());
const app = express();
const port = Number(process.env.DOWNBIT_API_PORT || process.env.PORT || 4317);
const host = '127.0.0.1';

app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      const hostname = new URL(origin).hostname;
      if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return res.status(403).json({ error: '只允许本地页面访问下载服务。' });
    } catch {
      return res.status(403).json({ error: '无效的请求来源。' });
    }
  }
  next();
});
app.use(express.json({ limit: '64kb' }));

const capabilityInfo = capabilities();
const state = () => ({
  tasks: manager.snapshot(),
  settings: store.state.settings,
  capabilities: capabilityInfo,
  accounts: { bilibili: accounts.snapshot(), xiaohongshu: xiaohongshu.snapshot() },
});

app.get('/api/health', (req, res) => res.json({ service: 'video-provider-local', version: 1 }));
app.get('/api/state', (req, res) => res.json(state()));
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = () => res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
  send();
  manager.on('change', send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    manager.off('change', send);
  });
});

app.post('/api/accounts/bilibili/login', async (req, res, next) => {
  try {
    res.json(await accounts.login());
  } catch (error) {
    next(error);
  }
});
app.post('/api/accounts/bilibili/refresh', async (req, res, next) => {
  try {
    res.json(await accounts.refresh());
  } catch (error) {
    next(error);
  }
});
app.post('/api/accounts/bilibili/logout', async (req, res, next) => {
  try {
    res.json(await accounts.logout());
  } catch (error) {
    next(error);
  }
});

for (const action of ['login', 'refresh', 'logout']) {
  app.post(`/api/accounts/xiaohongshu/${action}`, async (req, res, next) => {
    try {
      res.json(await xiaohongshu[action]());
    } catch (error) {
      next(error);
    }
  });
}

app.post('/api/inspect', async (req, res, next) => {
  try {
    const browser = req.body.cookiesFromBrowser;
    if (browser && !['chrome', 'chromium', 'edge', 'firefox', 'safari', 'brave', 'arc'].includes(browser)) {
      throw new Error('不支持的浏览器。');
    }
    const overrides = browser ? { cookiesFromBrowser: browser } : {};
    res.json(await inspector.inspect(req.body.url, overrides));
  } catch (error) {
    next(error);
  }
});

app.post('/api/tasks', (req, res, next) => {
  try {
    const info = inspector.get(req.body.inspectionId);
    res.status(201).json(manager.create(info, req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/tasks/:id/action', (req, res, next) => {
  try {
    res.json(manager.action(req.params.id, req.body.action));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/tasks/:id', (req, res, next) => {
  try {
    manager.remove(req.params.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/settings', (req, res, next) => {
  try {
    const patch = {};
    if (req.body.downloadDir != null) {
      const value = String(req.body.downloadDir).trim();
      if (!value) throw new Error('下载目录不能为空。');
      patch.downloadDir = expandHome(value);
      fs.mkdirSync(patch.downloadDir, { recursive: true });
    }
    for (const [key, min, max] of [['maxConcurrent', 1, 4], ['connections', 1, 8]]) {
      if (req.body[key] != null) {
        const value = Number(req.body[key]);
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} 必须在 ${min}–${max} 之间。`);
        patch[key] = value;
      }
    }
    for (const key of ['resumeOnStart', 'notifications']) {
      if (req.body[key] != null) patch[key] = Boolean(req.body[key]);
    }
    if (req.body.cookiesFromBrowser != null) {
      const value = String(req.body.cookiesFromBrowser);
      if (!['none', 'chrome', 'chromium', 'edge', 'firefox', 'safari', 'brave', 'arc'].includes(value)) throw new Error('不支持的浏览器。');
      patch.cookiesFromBrowser = value;
    }
    res.json(manager.updateSettings(patch));
  } catch (error) {
    next(error);
  }
});

app.post('/api/system/choose-folder', async (req, res, next) => {
  if (process.platform !== 'darwin') return res.status(501).json({ error: '当前系统请直接输入下载目录。' });
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择 Downbit 下载位置")'], { timeout: 120000 });
    res.json({ path: stdout.trim() });
  } catch (error) {
    if (String(error.stderr).includes('User canceled')) return res.status(204).end();
    next(error);
  }
});

app.post('/api/tasks/:id/open', async (req, res, next) => {
  try {
    const task = store.getTask(req.params.id);
    if (!task || task.status !== 'completed') throw new Error('文件尚未下载完成。');
    await fs.promises.access(task.outputPath);
    const reveal = req.body.reveal === true;
    let command;
    let args;
    if (process.platform === 'darwin') {
      command = 'open';
      args = reveal ? ['-R', task.outputPath] : [task.outputPath];
    } else if (process.platform === 'win32') {
      command = 'explorer';
      args = reveal ? [`/select,${task.outputPath}`] : [task.outputPath];
    } else {
      command = 'xdg-open';
      args = [reveal ? path.dirname(task.outputPath) : task.outputPath];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/tasks/:id/content', (req, res, next) => {
  const task = store.getTask(req.params.id);
  if (!task || task.status !== 'completed') return res.status(404).json({ error: '文件尚未下载完成。' });
  res.sendFile(path.resolve(task.outputPath), { dotfiles: 'deny' }, (error) => {
    if (error) next(error);
  });
});

const dist = path.join(root, 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && req.accepts('html')) {
      return res.sendFile(path.join(dist, 'index.html'));
    }
    next();
  });
}
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在。' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(error.status || 400).json({ error: errorMessage(error) });
});

function openWorkspace() {
  if (process.env.DOWNBIT_OPEN_BROWSER !== '1' || !fs.existsSync(path.join(dist, 'index.html'))) return;
  const url = `http://${host}:${port}`;
  const [command, args] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

const server = app.listen(port, host, () => {
  console.log(`[video-provider] Local service: http://${host}:${port}`);
  if (fs.existsSync(path.join(dist, 'index.html'))) console.log(`[video-provider] Workspace: http://${host}:${port}`);
  manager.recover();
  openWorkspace();
});
server.on('error', (error) => {
  console.error(`[video-provider] ${error.message}`);
  process.exitCode = 1;
});

async function shutdown() {
  for (const [taskId, controller] of manager.active) {
    const task = store.getTask(taskId);
    if (task) task.status = 'queued';
    controller.abort(new DOMException('Server stopped', 'AbortError'));
  }
  await accounts.close().catch(() => {});
  await xiaohongshu.close().catch(() => {});
  store.save();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

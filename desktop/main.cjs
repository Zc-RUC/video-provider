const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

app.setName('VideoProvider');
if (process.env.VIDEOPROVIDER_DESKTOP_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.VIDEOPROVIDER_DESKTOP_USER_DATA_DIR));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'VideoProvider'));
}

let mainWindow = null;
let serverProcess = null;
let serverPort = null;
let quitting = false;
let failed = false;
const logFile = path.join(app.getPath('userData'), 'video-provider-desktop.log');

function log(message) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function fail(title, error) {
  if (failed) return;
  failed = true;
  log(`${title}: ${error.stack || error.message || error}`);
  dialog.showErrorBox(title, '请查看日志后重试。也可以继续使用浏览器版。\n\n' + String(error.message || error));
  app.quit();
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.unref();
    listener.on('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(() => resolve(port));
    });
  });
}

function startServer(port) {
  const child = spawn(process.execPath, [path.join(app.getAppPath(), 'server', 'index.js')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DOWNBIT_API_PORT: String(port),
      DOWNBIT_DATA_DIR: process.env.DOWNBIT_DATA_DIR || path.join(app.getPath('userData'), 'data'),
      DOWNBIT_OPEN_BROWSER: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => log(data.toString().trim()));
  child.stderr.on('data', (data) => log(data.toString().trim()));
  child.once('error', (error) => { child.startupError = error; });
  child.once('exit', (code, signal) => {
    log(`Local service exited (code=${code}, signal=${signal})`);
    if (!quitting) fail('Video Provider 本地服务已停止', new Error('下载服务意外退出。请重新打开应用。'));
  });
  return child;
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.startupError) throw child.startupError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('内置 Node 服务未能启动');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('等待本地服务启动超时');
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'Video Provider · 视频下载工作台',
    backgroundColor: '#f6f3ec',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('did-fail-load', (event, code, description, url) => log(`Page load failed (${code}): ${description} ${url}`));
  mainWindow.webContents.on('render-process-gone', (event, details) => log(`Renderer exited: ${JSON.stringify(details)}`));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`http://127.0.0.1:${port}/`)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`).catch((error) => fail('Video Provider 页面加载失败', error));
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    serverPort = await availablePort();
    serverProcess = startServer(serverPort);
    await waitForServer(serverPort, serverProcess);
    createWindow(serverPort);
  }).catch((error) => fail('Video Provider 启动失败', error));
  app.on('activate', () => {
    if (!mainWindow && serverPort && !failed) createWindow(serverPort);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode !== null || quitting) return;
    event.preventDefault();
    quitting = true;
    const forceStop = setTimeout(() => {
      if (serverProcess.exitCode === null && serverProcess.signalCode === null) serverProcess.kill('SIGKILL');
    }, 4000);
    forceStop.unref();
    serverProcess.once('exit', () => {
      clearTimeout(forceStop);
      app.quit();
    });
    serverProcess.kill('SIGTERM');
  });
}

process.on('uncaughtException', (error) => fail('Video Provider 运行异常', error));

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, CircleHelp, Command, Download, FolderOpen, Library as LibraryIcon, Plus, Settings as SettingsIcon, Terminal, WifiOff, X } from 'lucide-react';
import { api } from './api.js';
import Downloads from './pages/Downloads.jsx';
import Library from './pages/Library.jsx';
import Cli from './pages/Cli.jsx';
import Settings from './pages/Settings.jsx';
import { InspectDialog, MediaDialog } from './components/Dialogs.jsx';
import { basename } from './utils.js';

const pages = {
  downloads: { label: '下载', icon: Download },
  library: { label: '资料库', icon: LibraryIcon },
  cli: { label: '命令行', icon: Terminal },
  settings: { label: '设置', icon: SettingsIcon },
};

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [settings, setSettings] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(() => pages[location.hash.slice(1)] ? location.hash.slice(1) : 'downloads');
  const [input, setInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [composerError, setComposerError] = useState('');
  const [preview, setPreview] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [toasts, setToasts] = useState([]);
  const inputRef = useRef(null);
  const previousTasks = useRef(new Map());
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const notify = useCallback((message, type = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current.slice(-2), { id, message, type }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3800);
  }, []);

  const applyState = useCallback((state) => {
    setTasks(state.tasks);
    setSettings(state.settings);
    setCapabilities(state.capabilities);
    setAccounts(state.accounts || null);
    setReady(true);
    setLoadError(false);
  }, []);

  useEffect(() => {
    api.state().then(applyState).catch(() => { setLoadError(true); setReady(true); });
    const events = api.subscribe({
      onState: applyState,
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
    });
    return () => events.close();
  }, [applyState]);

  useEffect(() => {
    const current = new Map();
    for (const task of tasks) {
      const previous = previousTasks.current.get(task.id);
      current.set(task.id, task.status);
      if (previous && previous !== 'completed' && task.status === 'completed') {
        notify(`已保存：${task.title}`);
        if (settings?.notifications && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('下载完成', { body: task.title, icon: '/favicon.svg' });
        }
      }
    }
    previousTasks.current = current;
  }, [tasks, settings?.notifications, notify]);

  useEffect(() => {
    const listener = () => {
      const next = location.hash.slice(1);
      if (pages[next]) setPage(next);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);

  const navigate = useCallback((next) => {
    setPage(next);
    history.replaceState(null, '', `#${next}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const newDownload = useCallback(() => {
    navigate('downloads');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [navigate]);

  useEffect(() => {
    const listener = (event) => {
      if ((event.metaKey || event.ctrlKey) && ['k', 'l'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        newDownload();
      } else if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        newDownload();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [newDownload]);

  const inspect = useCallback(async (value) => {
    const url = String(value || '').trim();
    if (!url || analyzing) return;
    setAnalyzing(true);
    setComposerError('');
    try {
      const info = await api.inspect(url);
      setPreview(info);
    } catch (error) {
      setComposerError(error.message);
      notify('无法解析这个链接', 'error');
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, notify]);

  const paste = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) return notify('剪贴板里还没有链接', 'error');
      setInput(value.trim());
      inspect(value.trim());
    } catch {
      inputRef.current?.focus();
      notify('请使用 ⌘V 将链接粘贴到输入框', 'error');
    }
  };

  const startDownload = async (options) => {
    setCreating(true);
    try {
      const task = await api.createTask(options);
      setPreview(null);
      setInput('');
      navigate('downloads');
      notify(`已加入队列：${task.title}`);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const action = async (task, name) => {
    try {
      await api.action(task.id, name);
      if (name === 'finish') notify('正在停止录制并封装文件');
    } catch (error) { notify(error.message, 'error'); }
  };
  const remove = async (task) => {
    try {
      await api.remove(task.id);
      notify(task.status === 'completed' ? '已移出资料库，本地文件保留' : '已移除任务记录');
    } catch (error) { notify(error.message, 'error'); }
  };
  const open = async (task, reveal) => {
    try { await api.open(task.id, reveal); }
    catch (error) { notify(error.message, 'error'); }
  };
  const saveSettings = async (patch) => {
    try {
      const updated = await api.settings(patch);
      setSettings((current) => ({ ...current, ...updated }));
    } catch (error) {
      notify(error.message, 'error');
      throw error;
    }
  };
  const chooseFolder = async () => {
    try {
      const result = await api.chooseFolder();
      return result?.path || null;
    } catch (error) {
      notify(error.message, 'error');
      return null;
    }
  };
  const accountAction = async (site, action) => {
    const siteName = site === 'bilibili' ? 'B 站' : '小红书';
    try {
      const status = await api.accountAction(site, action);
      setAccounts((current) => ({ ...current, [site]: status }));
      if (action === 'login') notify(`已打开${siteName}登录窗口，登录成功后会自动同步`);
      else if (action === 'refresh') notify(status.loggedIn ? `已同步：${status.username} · ${status.vipLabel}` : `尚未检测到${siteName}登录`);
      else if (action === 'logout') notify(`已退出应用内的${siteName}账号`);
      return status;
    } catch (error) {
      notify(error.message, 'error');
      throw error;
    }
  };

  if (!ready) return <div className="app-loading"><span className="brand-mark large"><ArrowDownToLine size={30} /></span><p>正在打开你的媒体空间…</p></div>;
  if (loadError || !settings) return <div className="app-loading offline"><WifiOff size={30} /><h1>本地服务还没有连接</h1><p>在项目目录运行 <code>npm run dev</code>，然后刷新页面。</p><button className="primary-button" onClick={() => location.reload()}>重新连接</button></div>;

  const activeCount = tasks.filter((task) => ['queued', 'downloading'].includes(task.status)).length;
  const completedCount = tasks.filter((task) => task.status === 'completed').length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('downloads')} aria-label="Downbit 首页"><span className="brand-mark"><ArrowDownToLine size={20} /></span><span>Downbit<small>LOCAL WORKSPACE</small></span></button>
        <button className="sidebar-new" onClick={newDownload}><Plus size={17} /><span>新建下载</span><kbd>⌘ K</kbd></button>
        <nav className="sidebar-nav" aria-label="主导航">
          <span className="nav-section-label">工作空间</span>
          {Object.entries(pages).slice(0, 3).map(([key, item]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => navigate(key)}><item.icon size={18} /><span>{item.label}</span>{key === 'downloads' && activeCount > 0 && <b>{activeCount}</b>}{key === 'library' && completedCount > 0 && <small>{completedCount}</small>}</button>)}
          <span className="nav-section-label secondary">偏好</span>
          <button className={page === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><SettingsIcon size={18} /><span>设置</span><ChevronRight size={14} className="nav-chevron" /></button>
        </nav>
        <div className="sidebar-bottom">
          <button className="storage-card" onClick={() => navigate('settings')}><span><FolderOpen size={16} /></span><div><strong>{basename(settings.downloadDir)}</strong><small>默认下载位置</small></div><ChevronRight size={14} /></button>
          <div className="local-status"><span className={connected ? 'connected' : ''} /><div><strong>{connected ? '本地服务运行中' : '正在重新连接'}</strong><small>你的文件，只属于你</small></div></div>
          <div className="sidebar-foot"><span>Downbit · 本地复刻版</span><button title="查看命令行" onClick={() => navigate('cli')}><CircleHelp size={15} /></button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div><span>工作空间</span><ChevronRight size={12} /><strong>{pages[page].label}</strong></div><div className="topbar-right"><span className="privacy-label"><span /> 本地优先</span><button className="topbar-new" onClick={newDownload}><Plus size={16} /> 新建下载</button></div></header>
        <div className="page-container">
          {page === 'downloads' && <Downloads inputRef={inputRef} input={input} setInput={setInput} onInspect={inspect} onPaste={paste} analyzing={analyzing} error={composerError} tasks={tasks} settings={settings} onAction={action} onRemove={remove} onPlay={setPlaying} onOpen={open} navigate={navigate} />}
          {page === 'library' && <Library tasks={tasks} onPlay={setPlaying} onOpen={open} onRemove={remove} onNew={newDownload} />}
          {page === 'cli' && <Cli />}
          {page === 'settings' && <Settings settings={settings} capabilities={capabilities} accounts={accounts} onSave={saveSettings} onChooseFolder={chooseFolder} onAccountAction={accountAction} />}
        </div>
      </main>

      {preview && <InspectDialog info={preview} accounts={accounts} defaultDir={settings.downloadDir} analyzing={analyzing} creating={creating} onClose={() => setPreview(null)} onStart={startDownload} onInspectEntry={inspect} />}
      {playing && <MediaDialog task={playing} onClose={() => setPlaying(null)} />}
      <div className="toast-region" aria-live="polite">{toasts.map((toast) => <div className={`toast toast-${toast.type}`} key={toast.id}>{toast.type === 'success' ? <Check size={16} /> : <X size={16} />}<span>{toast.message}</span><button onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X size={13} /></button></div>)}</div>
    </div>
  );
}

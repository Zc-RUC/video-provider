import { useEffect, useState } from 'react';
import { Bell, Check, ChevronDown, Folder, FolderOpen, Gauge, HardDrive, Layers3, RotateCcw, ShieldCheck, TerminalSquare } from 'lucide-react';

function Toggle({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}

export default function Settings({ settings, capabilities, onSave, onChooseFolder }) {
  const [directory, setDirectory] = useState(settings.downloadDir);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDirectory(settings.downloadDir), [settings.downloadDir]);
  const save = async (patch) => {
    try {
      await onSave(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch {}
  };
  const saveDirectory = () => {
    if (directory.trim() && directory !== settings.downloadDir) return save({ downloadDir: directory });
  };
  return (
    <div className="settings-page page-enter">
      <section className="page-title-row"><div><span className="eyebrow">MAKE IT YOURS</span><h1>设置</h1><p>下载留在本地，偏好也只保存在这台设备。</p></div><span className={`settings-saved ${saved ? 'visible' : ''}`}><Check size={15} /> 已保存</span></section>

      <section className="settings-group">
        <div className="settings-group-title"><HardDrive size={19} /><div><h2>存储与队列</h2><p>决定文件保存在哪里，以及同时处理多少任务。</p></div></div>
        <div className="setting-row directory-row"><div><label htmlFor="download-dir">下载位置</label><p>新任务默认保存到这个文件夹</p></div><div className="directory-control"><Folder size={16} /><input id="download-dir" value={directory} onChange={(event) => setDirectory(event.target.value)} onBlur={saveDirectory} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />{capabilities.platform === 'darwin' && <button onClick={async () => { const value = await onChooseFolder(); if (value) { setDirectory(value); await save({ downloadDir: value }); } }} title="选择文件夹"><FolderOpen size={16} /></button>}</div></div>
        <div className="setting-row"><div><label>并行下载</label><p>同时进行的任务数量</p></div><div className="segmented-control">{[1, 2, 3, 4].map((value) => <button key={value} className={settings.maxConcurrent === value ? 'active' : ''} onClick={() => save({ maxConcurrent: value })}>{value}</button>)}</div></div>
        <div className="setting-row"><div><label>单文件连接数</label><p>支持 Range 的大文件会使用多连接下载</p></div><div className="range-control"><Gauge size={16} /><input type="range" min="1" max="8" value={settings.connections} onChange={(event) => save({ connections: Number(event.target.value) })} /><strong>{settings.connections}</strong></div></div>
      </section>

      <section className="settings-group">
        <div className="settings-group-title"><Layers3 size={19} /><div><h2>下载行为</h2><p>续传、登录状态与完成提醒。</p></div></div>
        <div className="setting-row"><div><label>启动后继续未完成任务</label><p>意外退出不会丢失已经下载的部分</p></div><Toggle label="启动后继续未完成任务" checked={settings.resumeOnStart} onChange={(value) => save({ resumeOnStart: value })} /></div>
        <div className="setting-row"><div><label htmlFor="cookies-browser">使用浏览器登录状态</label><p>用于 B 站会员画质等需要登录的网站；选择已登录同一账号的浏览器后重新解析</p></div><div className="select-control"><ShieldCheck size={15} /><select id="cookies-browser" value={settings.cookiesFromBrowser} onChange={(event) => save({ cookiesFromBrowser: event.target.value })}><option value="none">不使用</option><option value="chrome">Chrome</option><option value="chromium">Chromium</option><option value="edge">Microsoft Edge</option><option value="firefox">Firefox</option><option value="safari">Safari</option><option value="brave">Brave</option><option value="arc">Arc</option></select><ChevronDown size={14} /></div></div>
        <div className="setting-row"><div><label>下载完成通知</label><p>任务完成时显示系统通知</p></div><div className="toggle-with-icon"><Bell size={15} /><Toggle label="下载完成通知" checked={settings.notifications} onChange={async (value) => { if (value && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); save({ notifications: value }); }} /></div></div>
      </section>

      <section className="settings-group environment-group">
        <div className="settings-group-title"><TerminalSquare size={19} /><div><h2>运行环境</h2><p>真实解析与媒体处理组件，不是演示下载器。</p></div></div>
        <div className="environment-cards"><div><span className={capabilities.ytDlp ? 'ready' : 'missing'} /><p>站点解析<strong>yt-dlp</strong></p><small>{capabilities.ytDlpVersion || (capabilities.ytDlp ? '已就绪' : '未安装')}</small></div><div><span className={capabilities.ffmpeg ? 'ready' : 'missing'} /><p>音视频处理<strong>FFmpeg</strong></p><small>{capabilities.ffmpegVersion || (capabilities.ffmpeg ? '已就绪' : '未安装')}</small></div></div>
      </section>
      <p className="settings-footnote"><RotateCcw size={13} /> 设置会立即生效；进行中的任务会在下一次连接时采用新偏好。</p>
    </div>
  );
}

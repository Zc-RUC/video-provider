import { useEffect, useState } from 'react';
import { ArrowDownToLine, ChevronRight, Folder, ListVideo, LoaderCircle, Music2, X } from 'lucide-react';
import Thumbnail from './Thumbnail.jsx';
import { formatDuration } from '../utils.js';

export function InspectDialog({ info, defaultDir, analyzing, creating, onClose, onStart, onInspectEntry }) {
  const [formatId, setFormatId] = useState(info.defaultFormat);
  const [audioOnly, setAudioOnly] = useState(info.mediaKind === 'audio');
  const [outputDir, setOutputDir] = useState(defaultDir);
  useEffect(() => {
    setFormatId(info.defaultFormat);
    setAudioOnly(info.mediaKind === 'audio');
    setOutputDir(defaultDir);
  }, [info.inspectionId, info.defaultFormat, info.mediaKind, defaultDir]);
  useEffect(() => {
    const listener = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="inspect-dialog" role="dialog" aria-modal="true" aria-label="确认下载">
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        {analyzing && <div className="dialog-loading"><LoaderCircle size={26} className="spin" /><p>正在读取条目信息…</p></div>}
        {info.kind === 'playlist' ? (
          <>
            <div className="dialog-header playlist-header"><span><ListVideo size={24} /></span><div><p>发现一个合集</p><h2>{info.title}</h2><small>{info.source} · 已读取 {info.entries.length} 个条目</small></div></div>
            <div className="playlist-entries">
              {info.entries.map((entry, index) => <button key={`${entry.id}-${index}`} onClick={() => onInspectEntry(entry.url)}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{entry.title}</strong><small>{entry.uploader || info.source}{entry.duration ? ` · ${formatDuration(entry.duration)}` : ''}</small></div><ChevronRight size={17} /></button>)}
            </div>
            <p className="dialog-note">选择一个条目，继续查看画质与下载选项。</p>
          </>
        ) : (
          <>
            <div className="dialog-header"><span className="eyebrow">READY TO SAVE</span><h2>确认下载</h2><p>信息已就绪，选择你想要的保存方式。</p></div>
            <div className="inspect-media">
              <Thumbnail src={info.thumbnail} title={info.title} duration={info.duration} kind={info.mediaKind} />
              <div><span className="source-pill">{info.source}</span><h3>{info.title}</h3><p>{info.uploader}{info.duration ? ` · ${formatDuration(info.duration)}` : ''}</p></div>
            </div>
            <div className="inspect-options">
              <label><span>下载格式</span><select value={audioOnly && info.kind === 'ytdlp' ? 'audio-auto' : formatId} disabled={audioOnly && info.kind === 'ytdlp'} onChange={(event) => setFormatId(event.target.value)}>{audioOnly && info.kind === 'ytdlp' && <option value="audio-auto">最佳音频 · MP3 192kbps</option>}{info.formats.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}</select></label>
              <div className="audio-option"><span className="audio-option-icon"><Music2 size={18} /></span><div><strong>仅保留音频</strong><small>{info.mediaKind === 'audio' ? '来源本身就是音频' : '去掉画面，保存为 MP3'}</small></div><button type="button" role="switch" aria-checked={audioOnly} disabled={info.mediaKind === 'audio'} className={`toggle ${audioOnly ? 'is-on' : ''}`} onClick={() => setAudioOnly(!audioOnly)}><span /></button></div>
              <label><span>保存到</span><div className="dialog-directory"><Folder size={16} /><input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} /></div></label>
            </div>
            <button className="primary-button dialog-download" disabled={creating || !outputDir.trim()} onClick={() => onStart({ inspectionId: info.inspectionId, formatId, audioOnly, outputDir })}>{creating ? <LoaderCircle size={17} className="spin" /> : <ArrowDownToLine size={17} />}{creating ? '正在创建任务' : '开始下载'}<span>文件仅保存到本地</span></button>
          </>
        )}
      </section>
    </div>
  );
}

export function MediaDialog({ task, onClose }) {
  useEffect(() => {
    const listener = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onClose]);
  return (
    <div className="modal-backdrop media-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="media-dialog" role="dialog" aria-modal="true" aria-label={task.title}>
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        <div className={`media-player ${task.kind === 'audio' ? 'audio-player' : ''}`}>
          {task.kind === 'audio' ? <><Thumbnail src={task.thumbnail} title={task.title} kind="audio" /><audio src={`/api/tasks/${task.id}/content`} controls autoPlay preload="auto" /></> : <video src={`/api/tasks/${task.id}/content`} poster={task.thumbnail || undefined} controls autoPlay muted playsInline preload="auto" />}
        </div>
        <div className="media-dialog-info"><span>{task.source}</span><h2>{task.title}</h2><p>{task.uploader}</p></div>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { Check, Folder, LoaderCircle, Pause, Play, Square, Trash2, X } from 'lucide-react';
import Thumbnail from './Thumbnail.jsx';
import { formatBytes, formatDuration, timeAgo } from '../utils.js';

const statusText = {
  queued: '等待中',
  downloading: '下载中',
  paused: '已暂停',
  completed: '已完成',
  error: '需重试',
  cancelled: '已取消',
};

function IconButton({ label, children, className = '', ...props }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} {...props}>{children}</button>;
}

export default function TaskCard({ task, onAction, onRemove, onPlay, onOpen }) {
  const [tint, setTint] = useState('#d97757');
  const active = ['queued', 'downloading'].includes(task.status);
  const processing = task.stage === 'processing' && task.status === 'downloading';
  let detail;
  if (processing) detail = '正在封装文件并写入媒体信息';
  else if (task.status === 'queued') detail = '等待其他任务完成';
  else if (task.status === 'paused') detail = '进度已保存，随时继续';
  else if (task.status === 'completed') detail = `${formatBytes(task.fileSize)} · ${timeAgo(task.completedAt)}`;
  else if (task.status === 'cancelled') detail = '已保留断点，可以重新开始';
  else if (task.status === 'error') detail = '下载没有完成，已有进度已保留';
  else if (task.live) detail = `${task.completedSegments || 0} 个分片 · ${formatBytes(task.downloaded, '0 B')} · 持续录制中`;
  else {
    detail = `${formatBytes(task.downloaded, '0 B')} / ${formatBytes(task.total)}`;
    if (task.speed > 0) detail += ` · ${formatBytes(task.speed)}/s`;
    if (Number.isFinite(task.eta) && task.eta > 0) detail += ` · 剩余 ${formatDuration(task.eta)}`;
    if (task.totalSegments) detail += ` · ${task.completedSegments || 0}/${task.totalSegments} 分片`;
  }
  return (
    <article className={`task-card status-${task.status}`} style={{ '--tint': tint }}>
      <div className="task-art">
        <Thumbnail src={task.thumbnail} title={task.title} duration={task.duration} progress={task.progress} kind={task.kind} onTint={setTint} />
        {task.status === 'completed' && <button className="art-play" onClick={() => onPlay(task)} aria-label={`播放 ${task.title}`}><Play size={18} fill="currentColor" /></button>}
      </div>
      <div className="task-body">
        <div className="task-heading">
          <div>
            <span className={`status-label status-label-${task.status}`}>
              {processing ? <LoaderCircle size={12} className="spin" /> : task.status === 'completed' ? <Check size={12} /> : <span className="status-dot" />}
              {processing ? '处理中' : statusText[task.status]}
            </span>
            <h3 title={task.title}>{task.title}</h3>
          </div>
          <div className="task-actions">
            {task.status === 'downloading' && <IconButton label="暂停" onClick={() => onAction(task, 'pause')}><Pause size={16} /></IconButton>}
            {task.status === 'queued' && <IconButton label="暂停排队" onClick={() => onAction(task, 'pause')}><Pause size={16} /></IconButton>}
            {['paused', 'error', 'cancelled'].includes(task.status) && <IconButton label="继续下载" onClick={() => onAction(task, 'resume')}><Play size={16} /></IconButton>}
            {active && <IconButton label="取消下载" onClick={() => onAction(task, 'cancel')}><X size={16} /></IconButton>}
            {task.live && task.status === 'downloading' && <IconButton label="停止录制并保存" onClick={() => onAction(task, 'finish')}><Square size={15} /></IconButton>}
            {task.status === 'completed' && <>
              <IconButton label="播放" onClick={() => onPlay(task)}><Play size={16} /></IconButton>
              <IconButton label="在文件夹中显示" onClick={() => onOpen(task, true)}><Folder size={16} /></IconButton>
            </>}
            {!active && <IconButton label="移出列表（保留文件）" onClick={() => onRemove(task)}><Trash2 size={15} /></IconButton>}
          </div>
        </div>
        <p className="task-meta">{task.source} {task.uploader && task.uploader !== task.source ? `· ${task.uploader}` : ''} · {task.formatLabel}</p>
        <div className="task-progress-row">
          <div className="progress-track"><span style={{ width: `${Number.isFinite(task.progress) ? task.progress : 100}%` }} className={processing ? 'indeterminate' : ''} /></div>
          {Number.isFinite(task.progress) && <strong>{Math.floor(task.progress)}<small>%</small></strong>}
        </div>
        <p className="task-detail">{detail}</p>
        {task.error && <p className="task-error">{task.error}</p>}
      </div>
    </article>
  );
}

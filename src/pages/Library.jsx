import { useMemo, useState } from 'react';
import { ArrowDownToLine, Folder, MoreHorizontal, Music2, Play, Search, Trash2, Video } from 'lucide-react';
import Thumbnail from '../components/Thumbnail.jsx';
import { formatBytes, timeAgo } from '../utils.js';

export default function Library({ tasks, onPlay, onOpen, onRemove, onNew }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const completed = useMemo(() => tasks.filter((task) => task.status === 'completed'), [tasks]);
  const visible = completed.filter((task) => {
    if (filter !== 'all' && task.kind !== filter) return false;
    const haystack = `${task.title} ${task.source} ${task.uploader || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const totalSize = completed.reduce((sum, task) => sum + (task.fileSize || 0), 0);
  return (
    <div className="library-page page-enter">
      <section className="page-title-row">
        <div><span className="eyebrow">YOUR COLLECTION</span><h1>资料库</h1><p>{completed.length} 份内容 · 共 {formatBytes(totalSize, '0 B')}，都在你的设备上。</p></div>
        <button className="primary-button" onClick={onNew}><ArrowDownToLine size={16} /> 新建下载</button>
      </section>
      <div className="library-toolbar">
        <div className="filter-tabs">
          {[['all', '全部'], ['video', '视频'], ['audio', '音频']].map(([value, label]) => (
            <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}<span>{value === 'all' ? completed.length : completed.filter((task) => task.kind === value).length}</span></button>
          ))}
        </div>
        <label className="library-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或来源" /></label>
      </div>
      {visible.length ? (
        <section className="library-grid">
          {visible.map((task) => (
            <article className="library-card" key={task.id}>
              <button className="library-art" onClick={() => onPlay(task)} aria-label={`播放 ${task.title}`}>
                <Thumbnail src={task.thumbnail} title={task.title} duration={task.duration} kind={task.kind} />
                <span className="library-play"><Play size={20} fill="currentColor" /></span>
                <span className="library-kind">{task.kind === 'audio' ? <Music2 size={13} /> : <Video size={13} />}{task.kind === 'audio' ? '音频' : '视频'}</span>
              </button>
              <div className="library-card-body">
                <h3 title={task.title}>{task.title}</h3>
                <p>{task.source} · {formatBytes(task.fileSize)}</p>
                <div className="library-card-footer"><span>{timeAgo(task.completedAt)}</span><div>
                  <button title="在文件夹中显示" onClick={() => onOpen(task, true)}><Folder size={15} /></button>
                  <button title="移出资料库（保留文件）" onClick={() => onRemove(task)}><Trash2 size={15} /></button>
                </div></div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="library-empty">
          <span><Search size={26} /></span>
          <h2>{completed.length ? '没有找到匹配的内容' : '资料库还空着'}</h2>
          <p>{completed.length ? '换个关键词或筛选条件试试。' : '完成的视频和音频会自动整理到这里。'}</p>
          {!completed.length && <button className="primary-button" onClick={onNew}>下载第一份内容</button>}
        </div>
      )}
    </div>
  );
}

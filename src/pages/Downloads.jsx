import { ArrowDownToLine, ArrowRight, Check, Clipboard, Link2, LoaderCircle, LockKeyhole, Search, Sparkles } from 'lucide-react';
import TaskCard from '../components/TaskCard.jsx';
import Thumbnail from '../components/Thumbnail.jsx';
import { formatBytes, samples } from '../utils.js';

export default function Downloads({
  inputRef, input, setInput, onInspect, onPaste, analyzing, error, tasks, settings,
  onAction, onRemove, onPlay, onOpen, navigate,
}) {
  const queue = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status));
  const recent = tasks.filter((task) => task.status === 'completed').slice(0, 3);
  const completed = tasks.filter((task) => task.status === 'completed');
  const savedBytes = completed.reduce((sum, task) => sum + (task.fileSize || 0), 0);
  const activeCount = tasks.filter((task) => task.status === 'downloading').length;
  return (
    <div className="downloads-page page-enter">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={13} /> 你的本地媒体工作空间</span>
          <h1>把视频和音频，<br /><em>带回自己的设备。</em></h1>
          <p>粘贴一个链接，选择想要的品质。<br />没有云端队列，只有简单、可靠的本地下载。</p>
        </div>
        <div className="hero-note">
          <span className="hero-note-icon"><ArrowDownToLine size={22} /></span>
          <div><strong>{completed.length}</strong><span>份内容已保存</span></div>
          <i />
          <div><strong>{formatBytes(savedBytes, '0 B')}</strong><span>属于这个设备</span></div>
        </div>
      </section>

      <section
        className={`download-composer ${analyzing ? 'is-analyzing' : ''}`}
        onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('is-dragging'); }}
        onDragLeave={(event) => event.currentTarget.classList.remove('is-dragging')}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.classList.remove('is-dragging');
          const value = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
          if (value) { setInput(value); onInspect(value); }
        }}
      >
        <form onSubmit={(event) => { event.preventDefault(); onInspect(input); }}>
          <span className="composer-link"><Link2 size={21} /></span>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="粘贴链接，或搜索想保存的内容…"
            aria-label="媒体链接或搜索内容"
            spellCheck="false"
          />
          {input && !analyzing && <button type="button" className="clear-input" onClick={() => setInput('')} aria-label="清空">×</button>}
          <button type="button" className="paste-button" onClick={onPaste} title="读取剪贴板并解析"><Clipboard size={16} /><span>粘贴</span></button>
          <button className="primary-button analyze-button" disabled={analyzing || !input.trim()}>
            {analyzing ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />}
            {analyzing ? '正在解析' : '解析链接'}
            {!analyzing && <ArrowRight size={16} />}
          </button>
        </form>
        <div className="composer-footer">
          <div className="sample-links"><span>快速试试</span>{samples.map((sample) => <button key={sample.name} onClick={() => { setInput(sample.url); onInspect(sample.url); }}>{sample.name}<small>{sample.note}</small></button>)}</div>
          <span className="local-note"><LockKeyhole size={13} /> 文件仅保存到本地</span>
        </div>
      </section>
      {error && <div className="inline-error" role="alert">{error}</div>}

      <div className="section-heading queue-heading">
        <div><h2>下载队列</h2><span>{activeCount ? `${activeCount} 个任务正在进行` : '一切尽在掌握'}</span></div>
        <span className="shortcut-hint"><kbd>⌘</kbd><kbd>K</kbd> 快速新建</span>
      </div>
      <section className="queue-list">
        {queue.length ? queue.slice(0, 5).map((task) => (
          <TaskCard key={task.id} task={task} onAction={onAction} onRemove={onRemove} onPlay={onPlay} onOpen={onOpen} />
        )) : (
          <div className="empty-queue">
            <div className="empty-queue-art"><span /><ArrowDownToLine size={25} /></div>
            <div><h3>队列很安静</h3><p>链接解析完成后，下载任务会在这里实时更新。</p></div>
            <span className="empty-queue-status"><Check size={14} /> 准备就绪</span>
          </div>
        )}
      </section>

      <div className="section-heading recent-heading">
        <div><h2>最近保存</h2><span>下载完成，自动收入资料库</span></div>
        {completed.length > 0 && <button className="text-button" onClick={() => navigate('library')}>全部内容 <ArrowRight size={15} /></button>}
      </div>
      {recent.length ? (
        <section className="recent-grid">
          {recent.map((task) => (
            <button className="recent-card" key={task.id} onClick={() => onPlay(task)}>
              <Thumbnail src={task.thumbnail} title={task.title} duration={task.duration} kind={task.kind} />
              <span className="recent-info"><strong>{task.title}</strong><small>{task.source} · {formatBytes(task.fileSize)}</small></span>
              <span className="recent-play"><ArrowRight size={16} /></span>
            </button>
          ))}
        </section>
      ) : (
        <div className="recent-placeholder"><span>你的下一份收藏，会出现在这里。</span><button onClick={() => inputRef.current?.focus()}>开始下载 <ArrowRight size={14} /></button></div>
      )}
      <p className="rights-note">请仅下载你有权保存的内容，并遵守来源网站的使用条款。</p>
    </div>
  );
}

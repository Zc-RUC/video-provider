import { useState } from 'react';
import { Bot, Check, ChevronRight, Clipboard, Code2, ListVideo, Terminal, Workflow } from 'lucide-react';

const commandCode = `# 让 video-provider 命令在终端中可用
npm link

# 直接使用默认设置
 video-provider <url>

# 只保留音频，或指定画质与目录
 video-provider get -a <url>
 video-provider get -q 720 -o ~/Movies <url>

# 下载前查看信息与格式
 video-provider info <url>
 video-provider formats <url>

# 查看所有任务，或交给工作空间
 video-provider list
 video-provider open <url>`;
const jsonCode = `$ video-provider info <url> --json
{
  "kind": "ytdlp",
  "title": "Big Buck Bunny",
  "source": "YouTube",
  "duration": 634,
  "defaultFormat": "recommended"
}

$ video-provider list --json
[
  {
    "id": "2c1f…",
    "status": "downloading",
    "progress": 42.8,
    "speed": 3810924
  }
]`;

export default function Cli() {
  const [tab, setTab] = useState('commands');
  const [copied, setCopied] = useState(false);
  const code = tab === 'commands' ? commandCode : jsonCode;
  const copy = async () => {
    await navigator.clipboard.writeText(code.replace(/^ /gm, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="cli-page page-enter">
      <section className="page-title-row cli-title">
        <div><span className="eyebrow">HUMANS & AGENTS</span><h1>同样的能力，<br />换种方式调用。</h1><p>CLI 与网页工作空间共用任务和设置。写脚本、做自动化，<br />或者直接交给你的 AI 智能体。</p></div>
        <div className="terminal-mark"><Terminal size={44} strokeWidth={1.25} /><span>local-first</span></div>
      </section>
      <section className="cli-terminal">
        <div className="terminal-top"><div className="terminal-lights"><i /><i /><i /></div><span>video-provider — zsh</span><button onClick={copy}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? '已复制' : '复制'}</button></div>
        <div className="terminal-tabs"><button className={tab === 'commands' ? 'active' : ''} onClick={() => setTab('commands')}><Code2 size={14} /> 常用命令</button><button className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}><Bot size={14} /> JSON 输出</button></div>
        <pre><code>{code}</code></pre>
        <div className="terminal-foot"><span><i /> 本地服务已连接</span><span>UTF-8 · zsh</span></div>
      </section>
      <section className="cli-features">
        <article><span><Workflow size={20} /></span><h3>一个任务，两处可见</h3><p>终端发起的下载会同步出现在网页队列，进度、暂停和续传共用状态。</p></article>
        <article><span><ListVideo size={20} /></span><h3>完整地管理任务</h3><p>使用任务 ID 暂停、继续或取消。直播录制也能通过 finish 停止并保存。</p></article>
        <article><span><Bot size={20} /></span><h3>为自动化而设计</h3><p>每个命令都支持 --json，输出结构化结果，方便脚本和智能体读取。</p></article>
      </section>
      <section className="cli-task-commands"><h2>任务管理</h2><div><code>video-provider pause &lt;id&gt;</code><ChevronRight size={14} /><code>video-provider resume &lt;id&gt;</code><ChevronRight size={14} /><code>video-provider finish &lt;id&gt;</code><ChevronRight size={14} /><code>video-provider remove &lt;id&gt;</code></div></section>
    </div>
  );
}

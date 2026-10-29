import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { downloadDirect } from './engines/direct.js';
import { downloadHls } from './engines/hls.js';
import { postprocess } from './engines/process.js';
import { downloadWithYtDlp } from './engines/ytdlp.js';
import { binaries } from './binaries.js';
import { errorMessage, expandHome, id, uniqueOutputPath } from './utils.js';

const activeStatuses = new Set(['queued', 'downloading']);
const finalStatuses = new Set(['completed', 'cancelled']);

export class DownloadManager extends EventEmitter {
  constructor(store, partialsDir) {
    super();
    this.store = store;
    this.partialsDir = partialsDir;
    this.active = new Map();
    this.lastSaved = 0;
    this.progressState = new Map();
    fs.mkdirSync(partialsDir, { recursive: true });
  }

  recover() {
    for (const task of this.store.state.tasks) {
      if (activeStatuses.has(task.status) || task.stage === 'processing') {
        task.status = this.store.state.settings.resumeOnStart ? 'queued' : 'paused';
        task.speed = 0;
        task.eta = null;
        task.error = null;
      }
    }
    this.store.save();
    this.pump();
  }

  snapshot() {
    return this.store.state.tasks;
  }

  create(info, options = {}) {
    if (info.kind === 'playlist') throw new Error('请先选择一个合集条目。');
    const format = info.formats.find((item) => item.id === options.formatId) || info.formats.find((item) => item.id === info.defaultFormat) || info.formats[0];
    if (!format) throw new Error('没有可用的下载格式。');
    const audioOnly = info.mediaKind === 'audio' || Boolean(options.audioOnly);
    const outputDir = expandHome(options.outputDir || this.store.state.settings.downloadDir);
    fs.mkdirSync(outputDir, { recursive: true });
    const needsConversion = audioOnly && format.hasVideo;
    let extension = `.${format.ext || info.extension?.replace(/^\./, '') || 'mp4'}`;
    if (audioOnly && (needsConversion || info.kind === 'ytdlp')) extension = '.mp3';
    if (info.kind === 'hls' && !audioOnly) extension = binaries.ffmpeg ? '.mp4' : '.ts';
    if (info.kind === 'ytdlp' && !audioOnly && (format.id === 'recommended' || !format.hasAudio)) extension = '.mp4';
    const reserved = new Set(this.store.state.tasks.flatMap((task) => [task.outputPath, task.mediaPath]));
    const outputPath = uniqueOutputPath(outputDir, options.filename || info.title, extension, reserved);
    const taskId = id();
    const needsProcessing = needsConversion || (info.kind === 'hls' && Boolean(binaries.ffmpeg));
    const mediaPath = needsProcessing ? path.join(this.partialsDir, `${taskId}.source`) : outputPath;
    const task = {
      id: taskId,
      status: 'queued',
      stage: 'download',
      engine: info.kind,
      kind: audioOnly ? 'audio' : info.mediaKind,
      title: info.title,
      uploader: info.uploader,
      source: info.source,
      sourceUrl: info.sourceUrl,
      cookiesFromBrowser: info.cookiesFromBrowser || 'none',
      originalInput: info.originalInput,
      thumbnail: info.thumbnail,
      duration: info.duration,
      mediaUrl: format.url || info.mediaUrl,
      formatId: format.id,
      formatLabel: audioOnly && (needsConversion || info.kind === 'ytdlp') ? '音频 · MP3 192kbps' : format.label,
      formatHasVideo: format.hasVideo,
      formatHasAudio: format.hasAudio,
      quality: format.height,
      audioOnly,
      outputDir,
      outputPath,
      outputTemplate: info.kind === 'ytdlp' ? outputPath.slice(0, -path.extname(outputPath).length) + '.%(ext)s' : null,
      mediaPath,
      needsProcessing,
      total: format.filesize || info.size || null,
      downloaded: 0,
      fileSize: null,
      progress: 0,
      speed: 0,
      eta: null,
      live: Boolean(info.isLive),
      completedSegments: 0,
      totalSegments: null,
      finishRequested: false,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
    this.store.addTask(task);
    this.emitChange();
    this.pump();
    return task;
  }

  emitChange() {
    this.emit('change', this.snapshot());
  }

  touch(task, save = true) {
    task.updatedAt = new Date().toISOString();
    if (save) this.store.save();
    this.emitChange();
  }

  updateProgress(task, update) {
    if (!this.store.getTask(task.id) || finalStatuses.has(task.status)) return;
    const now = Date.now();
    const previous = this.progressState.get(task.id) || { time: now, bytes: task.downloaded || 0, speed: 0 };
    const elapsed = (now - previous.time) / 1000;
    let speed = previous.speed;
    if (update.speed != null) speed = update.speed;
    else if (elapsed >= 0.6 && update.downloaded != null) {
      const measured = Math.max(0, update.downloaded - previous.bytes) / elapsed;
      speed = previous.speed ? previous.speed * 0.55 + measured * 0.45 : measured;
      this.progressState.set(task.id, { time: now, bytes: update.downloaded, speed });
    }
    Object.assign(task, update);
    task.speed = Number.isFinite(speed) ? speed : 0;
    task.eta = update.eta ?? (task.total && task.speed > 0 ? Math.max(0, (task.total - task.downloaded) / task.speed) : null);
    this.touch(task, false);
    if (now - this.lastSaved > 900) {
      this.store.save();
      this.lastSaved = now;
    }
  }

  pump() {
    const limit = this.store.state.settings.maxConcurrent;
    if (this.active.size >= limit) return;
    for (const task of this.store.state.tasks) {
      if (this.active.size >= limit) break;
      if (task.status !== 'queued' || this.active.has(task.id)) continue;
      this.run(task);
    }
  }

  async run(task) {
    const controller = new AbortController();
    this.active.set(task.id, controller);
    task.status = 'downloading';
    task.error = null;
    task.speed = 0;
    task.eta = null;
    this.progressState.set(task.id, { time: Date.now(), bytes: task.downloaded || 0, speed: 0 });
    this.touch(task);
    const context = {
      signal: controller.signal,
      settings: this.store.state.settings,
      partialsDir: this.partialsDir,
      onProgress: (update) => this.updateProgress(task, update),
      onStage: (stage) => {
        task.stage = stage;
        task.speed = 0;
        task.eta = null;
        this.touch(task);
      },
      isFinishRequested: () => task.finishRequested,
    };
    try {
      if (task.engine === 'ytdlp') {
        const output = await downloadWithYtDlp(task, context);
        task.outputPath = output.path;
        task.fileSize = output.size;
      } else {
        if (task.stage !== 'processing') {
          if (task.engine === 'hls') await downloadHls(task, context);
          else await downloadDirect(task, context);
        }
        if (task.needsProcessing) {
          const exists = await fs.promises.stat(task.mediaPath).then((stat) => stat.size > 0).catch(() => false);
          if (exists) {
            task.stage = 'processing';
            this.touch(task);
            await postprocess(task, context);
          } else if (task.engine === 'hls' || task.audioOnly) {
            throw new Error('下载数据不完整，请继续下载后重试。');
          }
        }
      }
      if (controller.signal.aborted || ['paused', 'cancelled'].includes(task.status)) return;
      const stat = await fs.promises.stat(task.outputPath);
      task.status = 'completed';
      task.stage = 'done';
      task.progress = 100;
      task.fileSize = stat.size;
      task.total = stat.size;
      task.downloaded = stat.size;
      task.speed = 0;
      task.eta = null;
      task.completedAt = new Date().toISOString();
      task.error = null;
      this.touch(task);
    } catch (error) {
      if (controller.signal.aborted || ['paused', 'cancelled'].includes(task.status)) return;
      task.status = 'error';
      task.speed = 0;
      task.eta = null;
      task.error = errorMessage(error);
      this.touch(task);
    } finally {
      this.active.delete(task.id);
      this.progressState.delete(task.id);
      this.store.save();
      this.pump();
    }
  }

  action(taskId, action) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('找不到这个下载任务。');
    if (action === 'pause') {
      if (!activeStatuses.has(task.status)) throw new Error('当前任务不能暂停。');
      task.status = 'paused';
      task.speed = 0;
      task.eta = null;
      this.active.get(taskId)?.abort(new DOMException('Paused', 'AbortError'));
      this.touch(task);
    } else if (['resume', 'retry'].includes(action)) {
      if (task.status === 'completed') throw new Error('这个文件已经下载完成。');
      task.status = 'queued';
      task.error = null;
      task.finishRequested = false;
      this.touch(task);
      this.pump();
    } else if (action === 'cancel') {
      task.status = 'cancelled';
      task.speed = 0;
      task.eta = null;
      this.active.get(taskId)?.abort(new DOMException('Cancelled', 'AbortError'));
      this.touch(task);
    } else if (action === 'finish') {
      if (task.engine !== 'hls' || !task.live) throw new Error('只有直播录制可以停止并保存。');
      task.finishRequested = true;
      this.touch(task);
    } else {
      throw new Error('不支持的任务操作。');
    }
    return task;
  }

  remove(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('找不到这个下载任务。');
    this.active.get(taskId)?.abort(new DOMException('Removed', 'AbortError'));
    this.active.delete(taskId);
    this.store.removeTask(taskId);
    this.emitChange();
    this.pump();
  }

  updateSettings(patch) {
    const settings = this.store.updateSettings(patch);
    if (patch.maxConcurrent) this.pump();
    this.emitChange();
    return settings;
  }
}

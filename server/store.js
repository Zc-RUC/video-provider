import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const defaults = {
  downloadDir: process.env.DOWNBIT_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads', 'VideoProvider'),
  maxConcurrent: 2,
  connections: 4,
  resumeOnStart: true,
  cookiesFromBrowser: 'none',
  notifications: false,
};

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'state.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.state = { version: 1, settings: { ...defaults }, tasks: [] };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state = {
        version: 1,
        settings: { ...defaults, ...saved.settings },
        tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
      };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[downbit] Could not read state: ${error.message}`);
    }
    this.save();
  }

  save() {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2));
    fs.renameSync(temporary, this.file);
  }

  addTask(task) {
    this.state.tasks.unshift(task);
    this.save();
    return task;
  }

  getTask(id) {
    return this.state.tasks.find((task) => task.id === id);
  }

  removeTask(id) {
    this.state.tasks = this.state.tasks.filter((task) => task.id !== id);
    this.save();
  }

  updateSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
    return this.state.settings;
  }
}

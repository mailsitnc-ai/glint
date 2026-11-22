const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const IGNORED = new Set([
  'node_modules', '.git', '.DS_Store', 'dist', 'build', '.next', '.cache',
  'out', '.venv', '__pycache__', '.glint', 'coverage', 'vendor', 'target',
]);

/**
 * Workspace service: directory tree building, file I/O and native watching.
 *
 * Uses fs.watch (native, event-driven) rather than polling where possible.
 */
class WorkspaceService {
  constructor() {
    this.root = null;
    this.watchers = new Map(); // dirPath -> FSWatcher
    this.debounce = new Map();
    this.onChange = () => {};
  }

  setRoot(root) {
    this.root = root;
  }

  async readTree(dir, depth = 0) {
    if (depth > 12) return [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes = [];
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.glint') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: full, type: 'directory', children: await this.readTree(full, depth + 1) });
      } else if (entry.isFile()) {
        let size = 0;
        let mtime = 0;
        try {
          const stat = await fs.stat(full);
          size = stat.size;
          mtime = stat.mtimeMs;
        } catch {
          /* ignore */
        }
        nodes.push({ name: entry.name, path: full, type: 'file', size, mtime });
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    return nodes;
  }

  async readFile(filePath) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 12 * 1024 * 1024) {
        return { ok: false, error: 'File is too large to open (>12MB)' };
      }
      const content = await fs.readFile(filePath, 'utf-8');
      return { ok: true, content, size: stat.size, mtime: stat.mtimeMs };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async writeFile(filePath, content) {
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Native recursive watch of the workspace root.
   * Emits debounced events so the renderer does not thrash on bulk saves.
   */
  watch(root) {
    this.unwatchAll();
    if (!root || !fsSync.existsSync(root)) return false;

    try {
      const watcher = fsSync.watch(root, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const name = path.basename(filename);
        if (IGNORED.has(name)) return;
        if (name.startsWith('.') && name !== '.glint') return;

        const full = path.join(root, filename);
        const key = full;
        clearTimeout(this.debounce.get(key));
        this.debounce.set(
          key,
          setTimeout(() => {
            this.debounce.delete(key);
            try {
              const stat = fsSync.statSync(full);
              this.onChange({ path: full, type: stat.isDirectory() ? 'directory' : 'file', event: eventType });
            } catch {
              this.onChange({ path: full, type: 'file', event: 'deleted' });
            }
          }, 120),
        );
      });

      watcher.on('error', () => {});
      this.watchers.set(root, watcher);
      return true;
    } catch {
      // Recursive watch is unsupported on some platforms; fall back to a
      // targeted watch of each top-level directory.
      return this.watchShallow(root);
    }
  }

  watchShallow(root) {
    try {
      const entries = fsSync.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || IGNORED.has(entry.name)) continue;
        const dir = path.join(root, entry.name);
        try {
          const w = fsSync.watch(dir, (eventType, filename) => {
            if (!filename) return;
            const name = path.basename(filename);
            if (IGNORED.has(name)) return;
            const full = path.join(dir, filename);
            clearTimeout(this.debounce.get(full));
            this.debounce.set(full, setTimeout(() => {
              this.debounce.delete(full);
              this.onChange({ path: full, type: 'file', event: eventType });
            }, 150));
          });
          w.on('error', () => {});
          this.watchers.set(dir, w);
        } catch {
          /* ignore individual failures */
        }
      }
      return this.watchers.size > 0;
    } catch {
      return false;
    }
  }

  unwatchAll() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers.clear();
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
  }

  /** Watch a single file for external edits (used for the open editor). */
  watchFile(filePath, cb) {
    if (!filePath || !fsSync.existsSync(filePath)) return false;
    try {
      const w = fsSync.watch(filePath, { persistent: false }, (eventType) => {
        cb(eventType, filePath);
      });
      w.on('error', () => {});
      this.watchers.set(filePath, w);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { WorkspaceService, IGNORED };

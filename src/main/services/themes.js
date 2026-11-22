const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');

/**
 * Themes service: built-in themes, a local theme marketplace and
 * desktop-wallpaper capture used by the "liquid" mode.
 */

const BUILTIN_THEMES = [
  {
    id: 'glint-dark',
    label: 'Glint Dark',
    author: 'Glint',
    bg: '#0f0f12',
    text: '#e8eaed',
    muted: '#94a3b8',
    accent: '#7c3aed',
    glassBlur: 22,
    glassOpacity: 62,
    tags: ['dark', 'default'],
  },
  {
    id: 'glint-light',
    label: 'Glint Light',
    author: 'Glint',
    bg: '#f4f5f7',
    text: '#1e1e1e',
    muted: '#5b6472',
    accent: '#6d28d9',
    glassBlur: 22,
    glassOpacity: 70,
    tags: ['light'],
  },
  {
    id: 'ocean',
    label: 'Ocean',
    author: 'Glint',
    bg: '#0b1f30',
    text: '#e2e8f0',
    muted: '#7d9ab5',
    accent: '#38bdf8',
    glassBlur: 26,
    glassOpacity: 58,
    tags: ['dark', 'blue'],
  },
  {
    id: 'solarized',
    label: 'Solarized',
    author: 'Glint',
    bg: '#fdf6e3',
    text: '#586e75',
    muted: '#93a1a1',
    accent: '#268bd2',
    glassBlur: 18,
    glassOpacity: 76,
    tags: ['light', 'classic'],
  },
  {
    id: 'midnight',
    label: 'Midnight',
    author: 'Glint',
    bg: '#05060a',
    text: '#d6deeb',
    muted: '#637777',
    accent: '#a855f7',
    glassBlur: 30,
    glassOpacity: 52,
    tags: ['dark', 'deep'],
  },
  {
    id: 'sakura',
    label: 'Sakura',
    author: 'Glint',
    bg: '#1b1418',
    text: '#f3e6ea',
    muted: '#b08fa0',
    accent: '#f472b6',
    glassBlur: 24,
    glassOpacity: 60,
    tags: ['dark', 'pink'],
  },
  {
    id: 'forest',
    label: 'Forest',
    author: 'Glint',
    bg: '#0d1613',
    text: '#dbe7e0',
    muted: '#7fa596',
    accent: '#34d399',
    glassBlur: 24,
    glassOpacity: 58,
    tags: ['dark', 'green'],
  },
  {
    id: 'ember',
    label: 'Ember',
    author: 'Glint',
    bg: '#18100e',
    text: '#f2e3dd',
    muted: '#b59185',
    accent: '#fb923c',
    glassBlur: 22,
    glassOpacity: 60,
    tags: ['dark', 'warm'],
  },
  {
    id: 'paper',
    label: 'Paper',
    author: 'Glint',
    bg: '#faf7f2',
    text: '#2b2b2b',
    muted: '#6f6a63',
    accent: '#b45309',
    glassBlur: 16,
    glassOpacity: 82,
    tags: ['light', 'warm'],
  },
  {
    id: 'matrix',
    label: 'Matrix',
    author: 'Glint',
    bg: '#001100',
    text: '#c8ffd0',
    muted: '#3f8f52',
    accent: '#00ff66',
    glassBlur: 12,
    glassOpacity: 70,
    tags: ['dark', 'mono'],
  },
];

class ThemesService {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.customDir = path.join(userDataPath, 'themes');
    this.wallpaperPath = path.join(userDataPath, 'wallpaper.jpg');
  }

  builtin() {
    return BUILTIN_THEMES;
  }

  async listCustom() {
    try {
      await fs.mkdir(this.customDir, { recursive: true });
      const files = await fs.readdir(this.customDir);
      const themes = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = JSON.parse(await fs.readFile(path.join(this.customDir, file), 'utf-8'));
          themes.push({ ...data, id: data.id || path.basename(file, '.json'), custom: true });
        } catch {
          /* skip invalid theme */
        }
      }
      return themes;
    } catch {
      return [];
    }
  }

  async listAll() {
    return [...BUILTIN_THEMES, ...(await this.listCustom())];
  }

  async install(theme) {
    if (!theme || !theme.id) return { ok: false, error: 'A theme with an id is required' };
    const file = path.join(this.customDir, `${theme.id}.json`);
    try {
      await fs.mkdir(this.customDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(theme, null, 2));
      return { ok: true, theme: { ...theme, custom: true } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async remove(id) {
    const file = path.join(this.customDir, `${id}.json`);
    try {
      await fs.unlink(file);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** Create a theme from the current settings so users can share their look. */
  async exportCurrent(settings, name) {
    const id = name
      ? `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      : `custom-${Date.now().toString(36)}`;
    const theme = {
      id,
      label: name || 'Custom Theme',
      author: 'You',
      bg: settings.bg,
      text: settings.text,
      muted: settings.muted,
      accent: settings.accent,
      glassBlur: settings.glassBlur,
      glassOpacity: settings.glassOpacity,
      tags: ['custom'],
      exportedAt: new Date().toISOString(),
    };
    return await this.install(theme);
  }

  /* ------------------------------------------------------------------ */
  /* Wallpaper (liquid mode)                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Capture the macOS desktop wallpaper so the editor can render it behind
   * the translucent surfaces. Uses osascript against System Events, which
   * avoids extra dependencies.
   */
  async captureWallpaper() {
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'Wallpaper capture is only implemented for macOS' };
    }

    const script = `
      set wallpaperFile to (POSIX path of (path to pictures folder)) & "Glint Wallpaper"
      try
        tell application "System Events"
          set picture to value of property "picture" of current desktop
          tell picture
            set picAlias to POSIX path of (it as alias)
          end tell
        end tell
        return picAlias
      on error errMsg
        return "ERROR:" & errMsg
      end try
    `;

    return new Promise((resolve) => {
      execFile('/usr/bin/osascript', ['-e', script], { timeout: 10000 }, (error, stdout) => {
        const output = (stdout || '').trim();
        if (error || output.startsWith('ERROR:')) {
          resolve({ ok: false, error: error ? error.message : output });
          return;
        }
        // Copy into our userData folder so the renderer can load it reliably.
        fs.copyFile(output, this.wallpaperPath)
          .then(() => resolve({ ok: true, path: this.wallpaperPath }))
          .catch((err) => resolve({ ok: false, error: err.message }));
      });
    });
  }

  /** Compute an ambient tint for the current time of day. */
  ambientTint(date = new Date()) {
    const hour = date.getHours();
    const minute = date.getMinutes();
    const t = hour + minute / 60;

    // Keyframes across the day: dawn -> day -> dusk -> night.
    const stops = [
      { at: 0, color: '#1e1b4b', intensity: 0.16 },
      { at: 6, color: '#7c2d12', intensity: 0.20 },
      { at: 8, color: '#fed7aa', intensity: 0.10 },
      { at: 12, color: '#e0f2fe', intensity: 0.06 },
      { at: 17, color: '#fdba74', intensity: 0.16 },
      { at: 20, color: '#4c1d95', intensity: 0.22 },
      { at: 24, color: '#1e1b4b', intensity: 0.16 },
    ];

    let lower = stops[0];
    let upper = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].at && t <= stops[i + 1].at) {
        lower = stops[i];
        upper = stops[i + 1];
        break;
      }
    }

    const span = upper.at - lower.at || 1;
    const ratio = Math.max(0, Math.min(1, (t - lower.at) / span));
    const mix = (a, b) => {
      const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
      const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
      const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * ratio));
      return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };

    return {
      color: mix(lower.color, upper.color),
      intensity: lower.intensity + (upper.intensity - lower.intensity) * ratio,
      phase: t < 6 ? 'night' : t < 11 ? 'morning' : t < 17 ? 'day' : t < 21 ? 'evening' : 'night',
    };
  }

  /** Import a font file into the user data folder so it can be loaded. */
  async importFont(filePath) {
    const fontsDir = path.join(this.userDataPath, 'fonts');
    try {
      await fs.mkdir(fontsDir, { recursive: true });
      const ext = path.extname(filePath);
      const name = `${path.basename(filePath, ext)}.ttf`;
      const dest = path.join(fontsDir, name);
      await fs.copyFile(filePath, dest);
      const family = path.basename(filePath, ext).replace(/[-_]/g, ' ');
      return { ok: true, path: dest, family };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async listFonts() {
    const fontsDir = path.join(this.userDataPath, 'fonts');
    try {
      const files = await fs.readdir(fontsDir);
      return files
        .filter((f) => /\.(ttf|otf|woff2?)$/i.test(f))
        .map((f) => ({
          family: path.basename(f, path.extname(f)).replace(/[-_]/g, ' '),
          file: path.join(fontsDir, f),
        }));
    } catch {
      return [];
    }
  }
}

module.exports = { ThemesService, BUILTIN_THEMES };

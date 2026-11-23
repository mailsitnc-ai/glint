const path = require('node:path');
const fs = require('node:fs/promises');

/**
 * Persisted application settings.
 *
 * Settings are global (userData/settings.json) but a workspace can override
 * selected appearance keys via .glint/settings.json.
 */

const DEFAULT_SETTINGS = {
  /* appearance */
  theme: 'glint-dark',
  accent: '#7c3aed',
  bg: '#0f0f12',
  text: '#e8eaed',
  muted: '#94a3b8',
  glassBlur: 22,
  glassOpacity: 62,
  liquidGlass: true,
  liquidMode: false, // refracts the desktop wallpaper behind the window
  wallpaperDim: 45,
  ambientLight: false, // time-of-day ambient tint
  zenMode: false,

  /* editor */
  fontSize: 14,
  fontFamily: 'Menlo',
  fontWeight: '400',
  fontLigatures: true,
  fontLineHeight: 1.55,
  letterSpacing: 0,
  customFontPath: '',
  tabSize: 2,
  wordWrap: false,
  minimap: false,
  cursorBlink: true,
  renderWhitespace: false,
  smoothScroll: true,
  bracketPairColorization: true,
  inlayHints: true,

  /* performance */
  virtualScroll: true,
  virtualScrollThreshold: 5000,
  nativeWatch: true,
  lazyStartup: true,
  backgroundAnalysis: true,

  /* ai */
  aiProvider: 'kilo', // kilo | pollinations | openrouter | nvidia | deepinfra | local | custom
  aiModel: '',        // empty = use the provider default
  aiEndpoint: '',     // only used when aiUseCustomEndpoint is on
  aiUseCustomEndpoint: false,
  aiFimModel: 'mistralai/codestral',
  kiloKey: '',
  pollinationsKey: '',
  openrouterKey: '',
  nvidiaKey: '',
  deepinfraKey: '',
  customKey: '',
  zenKey: '',
  coarenaKey: '',
  groqKey: '',
  geminiKey: '',
  numesKey: '',
  abliterationKey: '',
  omnirouteKey: '',
  aiGhostText: true,
  omnirouteObjective: 'auto',
  omnirouteBase: '',
  aiAutoContext: true,
  aiContextLines: 120,

  /* collaboration */
  collabEnabled: false,
  collabRelay: 'wss://glint-relay.local',
  collabRoom: '',
  collabDisplayName: '',
  voiceEnabled: false,

  /* workflow */
  previewEnabled: true,
  previewPort: 3000,
  deployTarget: 'vercel',
  deployToken: '',
  dbConnection: '',
  apiBaseUrl: '',
};

/** Keys that a workspace-local .glint/settings.json may override. */
const WORKSPACE_OVERRIDABLE = new Set([
  'theme', 'accent', 'bg', 'text', 'muted', 'glassBlur', 'glassOpacity',
  'liquidGlass', 'fontSize', 'fontFamily', 'fontWeight', 'fontLigatures',
  'fontLineHeight', 'letterSpacing', 'tabSize', 'wordWrap', 'minimap',
]);

class SettingsStore {
  constructor(userDataPath) {
    this.globalPath = path.join(userDataPath, 'settings.json');
    this.statePath = path.join(userDataPath, 'state.json');
    this.settings = { ...DEFAULT_SETTINGS };
    this.workspaceSettings = {};
  }

  async init() {
    await this.load();
    return this.settings;
  }

  async load() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await readJson(this.globalPath, {})) };
    return this.settings;
  }

  async getAll() {
    return { ...this.settings, ...this.workspaceSettings };
  }

  /** Merge a patch into global settings and persist. */
  async update(patch) {
    this.settings = { ...this.settings, ...patch };
    await writeJson(this.globalPath, this.settings);
    return this.getAll();
  }

  async reset() {
    this.settings = { ...DEFAULT_SETTINGS };
    await writeJson(this.globalPath, this.settings);
    return this.getAll();
  }

  /** Load per-workspace overrides from <workspace>/.glint/settings.json. */
  async loadWorkspace(workspacePath) {
    this.workspaceSettings = {};
    if (!workspacePath) return this.getAll();
    const file = path.join(workspacePath, '.glint', 'settings.json');
    const data = await readJson(file, null);
    if (!data) return this.getAll();
    const filtered = {};
    for (const [key, value] of Object.entries(data)) {
      if (WORKSPACE_OVERRIDABLE.has(key)) filtered[key] = value;
    }
    this.workspaceSettings = filtered;
    return this.getAll();
  }

  async getState() {
    return await readJson(this.statePath, { recent: [], sessions: {} });
  }

  async setState(patch) {
    const current = await this.getState();
    const next = { ...current, ...patch };
    await writeJson(this.statePath, next);
    return next;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value, null, 2));
    return true;
  } catch {
    return false;
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS, WORKSPACE_OVERRIDABLE };

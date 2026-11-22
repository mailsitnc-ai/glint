const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const isMac = process.platform === 'darwin';

let mainWindow = null;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const statePath = () => path.join(app.getPath('userData'), 'state.json');

/** Default settings: liquid-glass editor look with full colour customisation. */
const DEFAULT_SETTINGS = {
  theme: 'glint-dark',
  accent: '#7c3aed',
  bg: '#0f0f12',
  text: '#e8eaed',
  muted: '#94a3b8',
  glassBlur: 22,
  glassOpacity: 62,
  fontSize: 14,
  fontFamily: 'Menlo',
  tabSize: 2,
  minimap: false,
  wordWrap: false,
  liquidGlass: true,
};

async function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(await fs.readFile(file, 'utf-8')) };
  } catch {
    return { ...fallback };
  }
}

async function writeJson(file, value) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value, null, 2));
    return true;
  } catch (err) {
    console.error('[glint] failed to write', file, err);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    backgroundColor: DEFAULT_SETTINGS.bg,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Surface renderer errors in the terminal so failures are visible.
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[glint] renderer gone:', details.reason);
  });
}

function buildMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: 'Glint',
            submenu: [
              { label: 'About Glint', click: () => dialog.showMessageBox(mainWindow, { message: 'Glint 0.1.0', detail: 'A liquid-glass code editor.' }) },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => openFolderDialog() },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openFileDialog() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu', 'save-as') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow?.webContents.send('menu', 'undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => mainWindow?.webContents.send('menu', 'redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => mainWindow?.webContents.send('menu', 'cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => mainWindow?.webContents.send('menu', 'copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => mainWindow?.webContents.send('menu', 'paste') },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => mainWindow?.webContents.send('menu', 'find') },
        { label: 'Replace', accelerator: 'Shift+CmdOrCtrl+F', click: () => mainWindow?.webContents.send('menu', 'replace') },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => mainWindow?.webContents.send('menu', 'select-all') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', accelerator: 'Shift+CmdOrCtrl+P', click: () => mainWindow?.webContents.send('menu', 'command-palette') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => mainWindow?.webContents.send('menu', 'toggle-sidebar') },
        { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+J', click: () => mainWindow?.webContents.send('menu', 'toggle-panel') },
        { type: 'separator' },
        { label: 'Customise Colours…', accelerator: 'Shift+CmdOrCtrl+K', click: () => mainWindow?.webContents.send('menu', 'settings') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Theme',
      submenu: [
        { label: 'Glint Dark', click: () => setTheme('glint-dark') },
        { label: 'Glint Light', click: () => setTheme('glint-light') },
        { label: 'Ocean', click: () => setTheme('ocean') },
        { label: 'Solarized', click: () => setTheme('solarized') },
        { label: 'Midnight', click: () => setTheme('midnight') },
        { type: 'separator' },
        { label: 'Customise…', click: () => mainWindow?.webContents.send('menu', 'settings') },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Glint on GitHub', click: async () => await shell.openExternal('https://github.com/mailsitnc-ai/glint') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* IPC: settings                                                        */
/* ------------------------------------------------------------------ */

ipcMain.handle('settings:get', async () => {
  return await readJson(settingsPath(), DEFAULT_SETTINGS);
});

ipcMain.handle('settings:set', async (_e, patch) => {
  const current = await readJson(settingsPath(), DEFAULT_SETTINGS);
  const next = { ...current, ...patch };
  await writeJson(settingsPath(), next);
  mainWindow?.webContents.send('settings:changed', next);
  return next;
});

ipcMain.handle('settings:reset', async () => {
  await writeJson(settingsPath(), DEFAULT_SETTINGS);
  mainWindow?.webContents.send('settings:changed', DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
});

/* ------------------------------------------------------------------ */
/* IPC: workspace                                                       */
/* ------------------------------------------------------------------ */

async function openFolderDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;

  const folderPath = result.filePaths[0];
  const tree = await buildTree(folderPath);
  const state = await readJson(statePath(), { recent: [] });
  const recent = [folderPath, ...(state.recent || []).filter((p) => p !== folderPath)].slice(0, 10);
  await writeJson(statePath(), { ...state, recent, lastFolder: folderPath });

  const payload = { path: folderPath, name: path.basename(folderPath), tree, recent };
  mainWindow?.webContents.send('workspace:opened', payload);
  return payload;
}

async function openFileDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Open File',
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  const payload = { path: filePath, name: path.basename(filePath), content };
  mainWindow?.webContents.send('file:opened', payload);
  return payload;
}

/** Recursively build a directory tree, skipping heavy/irrelevant folders. */
const IGNORED = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '.next', '.cache', 'out', '.venv', '__pycache__']);

async function buildTree(dir, depth = 0) {
  if (depth > 12) return [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await buildTree(full, depth + 1);
      nodes.push({ name: entry.name, path: full, type: 'directory', children });
    } else if (entry.isFile()) {
      let size = 0;
      try {
        size = (await fs.stat(full)).size;
      } catch {
        /* ignore */
      }
      nodes.push({ name: entry.name, path: full, type: 'file', size });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return nodes;
}

ipcMain.handle('workspace:open-folder', async () => await openFolderDialog());
ipcMain.handle('workspace:open-file', async () => await openFileDialog());
ipcMain.handle('workspace:tree', async (_e, dir) => await buildTree(dir));
ipcMain.handle('workspace:recent', async () => {
  const state = await readJson(statePath(), { recent: [] });
  return state.recent || [];
});

/* ------------------------------------------------------------------ */
/* IPC: files                                                           */
/* ------------------------------------------------------------------ */

ipcMain.handle('file:read', async (_e, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:write', async (_e, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:save-as', async (_e, suggestedName, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save As',
    defaultPath: suggestedName || 'untitled.txt',
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  try {
    await fs.writeFile(result.filePath, content, 'utf-8');
    return { ok: true, path: result.filePath, name: path.basename(result.filePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:exists', async (_e, filePath) => fsSync.existsSync(filePath));

const watchedFiles = new Set();
ipcMain.handle('file:watch', async (_e, filePath) => {
  if (!filePath || watchedFiles.has(filePath)) return true;
  if (!fsSync.existsSync(filePath)) return false;
  watchedFiles.add(filePath);
  fsSync.watchFile(filePath, { interval: 900 }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs) {
      mainWindow?.webContents.send('file:changed', filePath);
    }
  });
  return true;
});
ipcMain.handle('file:unwatch', async (_e, filePath) => {
  if (filePath && watchedFiles.has(filePath)) {
    fsSync.unwatchFile(filePath);
    watchedFiles.delete(filePath);
  }
  return true;
});

/* ------------------------------------------------------------------ */
/* IPC: window controls                                                 */
/* ------------------------------------------------------------------ */

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

/* ------------------------------------------------------------------ */
/* App lifecycle                                                        */
/* ------------------------------------------------------------------ */

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

async function setTheme(theme) {
  const current = await readJson(settingsPath(), DEFAULT_SETTINGS);
  const next = { ...current, theme };
  await writeJson(settingsPath(), next);
  mainWindow?.webContents.send('settings:changed', next);
}

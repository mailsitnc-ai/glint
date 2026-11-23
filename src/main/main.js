const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const { SettingsStore } = require('./services/settings');
const { WorkspaceService } = require('./services/workspace');
const { AIService, lineDiff, listProviders } = require('./services/ai');
const { ArchiveService } = require('./services/archive');
const { OmniRouteService } = require('./services/omniroute');
const { OMNI_OBJECTIVES } = require('./services/providers');
const { CollaborationService } = require('./services/collaboration');
const { IntelligenceService } = require('./services/intelligence');
const { WorkflowService } = require('./services/workflow');
const { ThemesService } = require('./services/themes');
const { GitService } = require('./services/git');

const isMac = process.platform === 'darwin';

let mainWindow = null;

const settings = new SettingsStore(app.getPath('userData'));
const workspace = new WorkspaceService();
const archive = new ArchiveService(app.getPath('userData'));
const ai = new AIService(settings, archive);
const collaboration = new CollaborationService(settings);
const intelligence = new IntelligenceService();
const workflow = new WorkflowService(settings);
const themes = new ThemesService(app.getPath('userData'));
const git = new GitService();
const omniroute = new OmniRouteService({
  ai,
  archive,
  getSettings: () => settings.settings,
  onEvent: (event) => mainWindow?.webContents.send('ai:route-event', event),
});

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function createWindow() {
  const bounds = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1360, bounds.width - 80),
    height: Math.min(860, bounds.height - 80),
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    backgroundColor: settings.settings.bg,
    show: false,
    title: 'Glint : Caelix IDE',
    icon: path.join(__dirname, process.platform === 'win32' ? '../../assets/icon.ico' : '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    globalThis.mainWindow = null;
  });

  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`);
  });

  globalThis.mainWindow = mainWindow;
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function buildMenu() {
  const send = (command) => mainWindow?.webContents.send('menu', command);

  const template = [
    ...(isMac
      ? [
          {
            label: 'Glint : Caelix IDE',
            submenu: [
              { label: 'About Glint : Caelix IDE', click: () => dialog.showMessageBox(mainWindow, { message: 'Glint : Caelix IDE', detail: 'Version 0.3.0 — a liquid-glass code editor with built-in AI, collaboration and developer workflow tools.' }) },
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
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        { label: 'AI: Generate Commit Message', accelerator: 'CmdOrCtrl+Alt+M', click: () => send('ai-commit-message') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => send('cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => send('copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => send('paste') },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
        { label: 'Replace', accelerator: 'Shift+CmdOrCtrl+F', click: () => send('replace') },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => send('select-all') },
        { type: 'separator' },
        { label: 'AI: Explain Selection', accelerator: 'CmdOrCtrl+Alt+E', click: () => send('ai-explain') },
        { label: 'AI: Refactor Selection', accelerator: 'CmdOrCtrl+Alt+R', click: () => send('ai-refactor') },
        { label: 'AI: Generate Documentation', accelerator: 'CmdOrCtrl+Alt+D', click: () => send('ai-docstring') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', accelerator: 'Shift+CmdOrCtrl+P', click: () => send('command-palette') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => send('toggle-sidebar') },
        { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+J', click: () => send('toggle-panel') },
        { label: 'Toggle Zen Mode', accelerator: 'CmdOrCtrl+K', click: () => send('toggle-zen') },
        { type: 'separator' },
        { label: 'Toggle Liquid Mode', accelerator: 'CmdOrCtrl+Alt+L', click: () => send('toggle-liquid') },
        { label: 'Customise Colours…', accelerator: 'Shift+CmdOrCtrl+K', click: () => send('settings') },
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
      label: 'AI',
      submenu: [
        { label: 'Toggle AI Chat', accelerator: 'CmdOrCtrl+Alt+A', click: () => send('toggle-ai') },
        { label: 'AI Settings…', click: () => send('ai-settings') },
        { type: 'separator' },
        { label: 'Toggle Ghost Text', click: () => send('toggle-ghost-text') },
        { label: 'Check AI Provider', click: () => send('ai-health') },
      ],
    },
    {
      label: 'Collab',
      submenu: [
        { label: 'Start Collaboration Session…', click: () => send('collab-start') },
        { label: 'Join Session…', click: () => send('collab-join') },
        { label: 'Stop Session', click: () => send('collab-stop') },
        { type: 'separator' },
        { label: 'Toggle Voice Chat', click: () => send('toggle-voice') },
      ],
    },
    {
      label: 'Theme',
      submenu: [
        { label: 'Theme Marketplace…', click: () => send('theme-marketplace') },
        { type: 'separator' },
        { label: 'Glint Dark', click: () => setTheme('glint-dark') },
        { label: 'Glint Light', click: () => setTheme('glint-light') },
        { label: 'Ocean', click: () => setTheme('ocean') },
        { label: 'Solarized', click: () => setTheme('solarized') },
        { label: 'Midnight', click: () => setTheme('midnight') },
        { type: 'separator' },
        { label: 'Customise…', click: () => send('settings') },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Semantic Search…', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('semantic-search') },
        { label: 'Find Dead Code', click: () => send('dead-code') },
        { label: 'Test Impact Analysis', click: () => send('test-impact') },
        { type: 'separator' },
        { label: 'Start Live Preview', click: () => send('preview-start') },
        { label: 'Stop Live Preview', click: () => send('preview-stop') },
        { label: 'Deploy…', click: () => send('deploy') },
        { type: 'separator' },
        { label: 'Database Browser…', click: () => send('database') },
        { label: 'API Client…', click: () => send('api-client') },
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
/* Workspace dialogs                                                   */
/* ------------------------------------------------------------------ */

async function openFolderDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return await openFolderPath(result.filePaths[0]);
}

async function openFolderPath(folderPath) {
  const tree = await workspace.readTree(folderPath);
  workspace.setRoot(folderPath);

  const state = await settings.getState();
  const recent = [folderPath, ...(state.recent || []).filter((p) => p !== folderPath)].slice(0, 12);
  await settings.setState({ recent, lastFolder: folderPath });

  // Per-workspace appearance overrides.
  const merged = await settings.loadWorkspace(folderPath);

  // Start native watching so external edits are picked up instantly.
  if (settings.settings.nativeWatch) {
    workspace.onChange = (event) => {
      mainWindow?.webContents.send('workspace:changed', event);
    };
    workspace.watch(folderPath);
  }

  const payload = { path: folderPath, name: path.basename(folderPath), tree, recent, settings: merged };
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
  const read = await workspace.readFile(filePath);
  if (!read.ok) return null;
  const payload = { path: filePath, name: path.basename(filePath), content: read.content };
  mainWindow?.webContents.send('file:opened', payload);
  return payload;
}

/* ------------------------------------------------------------------ */
/* IPC: settings                                                       */
/* ------------------------------------------------------------------ */

ipcMain.handle('settings:get', async () => await settings.getAll());
ipcMain.handle('settings:set', async (_e, patch) => {
  const next = await settings.update(patch);
  mainWindow?.webContents.send('settings:changed', next);
  return next;
});
ipcMain.handle('settings:reset', async () => {
  const next = await settings.reset();
  mainWindow?.webContents.send('settings:changed', next);
  return next;
});
ipcMain.handle('settings:workspace', async (_e, root) => await settings.loadWorkspace(root));

/* ------------------------------------------------------------------ */
/* IPC: workspace and files                                            */
/* ------------------------------------------------------------------ */

ipcMain.handle('workspace:open-folder', async () => await openFolderDialog());
ipcMain.handle('workspace:open-file', async () => await openFileDialog());
ipcMain.handle('workspace:open-path', async (_e, folderPath) => await openFolderPath(folderPath));
ipcMain.handle('workspace:tree', async (_e, dir) => await workspace.readTree(dir));
ipcMain.handle('workspace:recent', async () => (await settings.getState()).recent || []);
ipcMain.handle('workspace:root', async () => workspace.root);

ipcMain.handle('file:read', async (_e, filePath) => await workspace.readFile(filePath));
ipcMain.handle('file:write', async (_e, filePath, content) => await workspace.writeFile(filePath, content));
ipcMain.handle('file:save-as', async (_e, suggestedName, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save As',
    defaultPath: suggestedName || 'untitled.txt',
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  const write = await workspace.writeFile(result.filePath, content);
  return write.ok ? { ok: true, path: result.filePath, name: path.basename(result.filePath) } : write;
});
ipcMain.handle('file:exists', async (_e, filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('file:watch', async (_e, filePath) => workspace.watchFile(filePath, (eventType, p) => {
  mainWindow?.webContents.send('file:changed', { path: p, event: eventType });
}));

/* ------------------------------------------------------------------ */
/* IPC: AI                                                             */
/* ------------------------------------------------------------------ */

ipcMain.handle('ai:providers', async () => listProviders());

/* Archive: hide a model from the pickers, or bring it back. */
ipcMain.handle('ai:archive', async (_e, providerId, modelId, reason) =>
  await archive.archiveModel(providerId, modelId, reason));
ipcMain.handle('ai:unarchive', async (_e, providerId, modelId) =>
  await archive.unarchiveModel(providerId, modelId));
ipcMain.handle('ai:archived', async () => ({ ok: true, archived: archive.list() }));
ipcMain.handle('ai:archive-clear', async () => await archive.clear());

/* OmniRoute: objective-based routing across connected providers. */
ipcMain.handle('ai:omniroute-status', async () => omniroute.status());
ipcMain.handle('ai:omniroute-objectives', async () => OMNI_OBJECTIVES);
ipcMain.handle('ai:omniroute-candidates', async (_e, objective) =>
  await omniroute.routeCandidates(objective));
ipcMain.handle('ai:omniroute-chat', async (_e, messages, options) =>
  await omniroute.routeChat(messages, options || {}));

ipcMain.handle('ai:status', async () => ({
  configured: ai.isConfigured(),
  ...ai.providerInfo(),
  quota: ai.quotaStatus(),
}));

ipcMain.handle('ai:models', async () => await ai.listModels());
ipcMain.handle('ai:health', async () => await ai.healthCheck());
ipcMain.handle('ai:fim', async (_e, payload) => await ai.fim(payload));

ipcMain.handle('ai:chat', async (_e, messages, options) => await ai.chat(messages, options));

ipcMain.handle('ai:explain', async (_e, payload) =>
  await ai.explain({ ...payload, code: payload.code ?? payload.selection ?? '' }));

ipcMain.handle('ai:refactor', async (_e, payload) =>
  await ai.refactor({ ...payload, code: payload.code ?? payload.selection ?? '' }));

ipcMain.handle('ai:completion', async (_e, payload) => await ai.completion(payload));

ipcMain.handle('ai:docstring', async (_e, payload) => {
  const result = await ai.docstring(payload);
  if (result.ok) return result;
  // Fall back to the local static generator when no provider is configured.
  return { ok: true, text: intelligence.generateDocstring(payload.code, payload.language), local: true };
});

ipcMain.handle('ai:commit-message', async (_e, root) => {
  const { ok, diff, error } = await git.fullDiff(root || workspace.root);
  if (!ok) return { ok: false, error };
  if (!diff.trim()) return { ok: false, error: 'There are no changes to describe' };

  const branch = (await git.status(root || workspace.root)).branch || '';
  const result = await ai.commitMessage({ diff, branch });
  if (!result.ok) return result;
  return { ok: true, message: result.text, diff };
});

ipcMain.handle('ai:diff', async (_e, before, after) => lineDiff(before, after));

/* ------------------------------------------------------------------ */
/* IPC: collaboration                                                  */
/* ------------------------------------------------------------------ */

collaboration.onEvent = (event) => mainWindow?.webContents.send('collab:event', event);

ipcMain.handle('collab:start', async (_e, options) => {
  const root = options?.workspacePath || workspace.root;
  if (!root) return { ok: false, error: 'Open a folder before starting a session' };
  try {
    const result = await collaboration.startLocalRoom(root, options);
    mainWindow?.webContents.send('collab:event', { type: 'peers', peers: collaboration.getPeers() });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('collab:join', async (_e, url, options) => {
  try {
    const result = await collaboration.joinRoom(url, options);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('collab:stop', async () => {
  await collaboration.stop();
  return { ok: true };
});

ipcMain.handle('collab:peers', async () => collaboration.getPeers());
ipcMain.handle('collab:operation', async (_e, filePath, before, after) =>
  collaboration.broadcastOperation(filePath, before, after));
ipcMain.handle('collab:cursor', async (_e, filePath, cursor) =>
  collaboration.broadcastCursor(filePath, cursor));
ipcMain.handle('collab:chat', async (_e, message) => {
  collaboration.sendChat(message);
  return { ok: true };
});
ipcMain.handle('collab:apply', async (_e, filePath, op, currentText) =>
  collaboration.applyRemote(filePath, op, currentText));

/* ------------------------------------------------------------------ */
/* IPC: intelligence                                                   */
/* ------------------------------------------------------------------ */

ipcMain.handle('intel:search', async (_e, query, options) =>
  await intelligence.search(workspace.root, query, options));
ipcMain.handle('intel:dead-code', async () => await intelligence.findDeadCode(workspace.root));
ipcMain.handle('intel:test-impact', async (_e, changedFiles) =>
  await intelligence.testImpact(workspace.root, changedFiles));
ipcMain.handle('intel:overview', async () => await intelligence.projectOverview(workspace.root));
ipcMain.handle('intel:docstring', async (_e, code, language) =>
  ({ ok: true, text: intelligence.generateDocstring(code, language) }));

/* ------------------------------------------------------------------ */
/* IPC: workflow                                                       */
/* ------------------------------------------------------------------ */

ipcMain.handle('workflow:preview-start', async () => {
  if (!workspace.root) return { ok: false, error: 'Open a folder first' };
  return await workflow.startPreview(workspace.root);
});
ipcMain.handle('workflow:preview-stop', async () => await workflow.stopPreview());
ipcMain.handle('workflow:preview-log', async () => workflow.getPreviewLog());
ipcMain.handle('workflow:deploy-targets', async () => workflow.getDeployTargets());
ipcMain.handle('workflow:deploy', async (_e, options) =>
  await workflow.deploy({ ...options, root: workspace.root }));
ipcMain.handle('workflow:db-connect', async (_e, connectionString) =>
  await workflow.dbConnect(connectionString));
ipcMain.handle('workflow:db-query', async (_e, connectionString, query) =>
  await workflow.dbQuery(connectionString, query));
ipcMain.handle('workflow:api-request', async (_e, options) => await workflow.apiRequest(options));
ipcMain.handle('workflow:terminal', async (_e, command) =>
  await workflow.runTerminal(command, workspace.root || process.cwd()));

/* ------------------------------------------------------------------ */
/* IPC: themes and fonts                                               */
/* ------------------------------------------------------------------ */

ipcMain.handle('themes:list', async () => await themes.listAll());
ipcMain.handle('themes:install', async (_e, theme) => await themes.install(theme));
ipcMain.handle('themes:remove', async (_e, id) => await themes.remove(id));
ipcMain.handle('themes:export', async (_e, name) => await themes.exportCurrent(settings.settings, name));
ipcMain.handle('themes:wallpaper', async () => await themes.captureWallpaper());
ipcMain.handle('themes:ambient', async () => themes.ambientTint());
ipcMain.handle('themes:font-import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Import Font',
    filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
  return await themes.importFont(result.filePaths[0]);
});
ipcMain.handle('themes:fonts', async () => await themes.listFonts());

/* ------------------------------------------------------------------ */
/* IPC: git                                                            */
/* ------------------------------------------------------------------ */

ipcMain.handle('git:status', async () => await git.status(workspace.root));
ipcMain.handle('git:diff', async (_e, filePath, staged) => await git.diff(workspace.root, filePath, staged));
ipcMain.handle('git:staged-diff', async () => await git.stagedDiff(workspace.root));
ipcMain.handle('git:stage', async (_e, filePath) => await git.stage(workspace.root, filePath));
ipcMain.handle('git:unstage', async (_e, filePath) => await git.unstage(workspace.root, filePath));
ipcMain.handle('git:commit', async (_e, message) => await git.commit(workspace.root, message));
ipcMain.handle('git:log', async (_e, limit) => await git.log(workspace.root, limit));

/* ------------------------------------------------------------------ */
/* IPC: window controls                                                */
/* ------------------------------------------------------------------ */

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

app.whenReady().then(async () => {
  await settings.init();
  await archive.init();
  if (isMac && app.dock) app.dock.setIcon(path.join(__dirname, '../../assets/icon.png'));
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  workspace.unwatchAll();
  collaboration.stop().catch(() => {});
  if (!isMac) app.quit();
});

async function setTheme(theme) {
  const all = await themes.listAll();
  const found = all.find((t) => t.id === theme);
  const patch = found
    ? {
        theme: found.id,
        bg: found.bg,
        text: found.text,
        muted: found.muted,
        accent: found.accent,
        glassBlur: found.glassBlur,
        glassOpacity: found.glassOpacity,
      }
    : { theme };
  const next = await settings.update(patch);
  mainWindow?.webContents.send('settings:changed', next);
}

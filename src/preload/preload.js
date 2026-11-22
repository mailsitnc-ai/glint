const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Every method maps 1:1 to an ipcMain handler in main.js.
 */
contextBridge.exposeInMainWorld('glint', {
  /* ---------------------------------------------------------------- */
  /* settings                                                           */
  /* ---------------------------------------------------------------- */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  loadWorkspaceSettings: (root) => ipcRenderer.invoke('settings:workspace', root),
  onSettingsChanged: (cb) => {
    const listener = (_e, settings) => cb(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },

  /* ---------------------------------------------------------------- */
  /* workspace and files                                                 */
  /* ---------------------------------------------------------------- */
  openFolder: () => ipcRenderer.invoke('workspace:open-folder'),
  openFile: () => ipcRenderer.invoke('workspace:open-file'),
  openPath: (dir) => ipcRenderer.invoke('workspace:open-path', dir),
  getTree: (dir) => ipcRenderer.invoke('workspace:tree', dir),
  getRecent: () => ipcRenderer.invoke('workspace:recent'),
  getWorkspaceRoot: () => ipcRenderer.invoke('workspace:root'),
  onWorkspaceOpened: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('workspace:opened', listener);
    return () => ipcRenderer.removeListener('workspace:opened', listener);
  },
  onWorkspaceChanged: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('workspace:changed', listener);
    return () => ipcRenderer.removeListener('workspace:changed', listener);
  },
  onFileOpened: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('file:opened', listener);
    return () => ipcRenderer.removeListener('file:opened', listener);
  },

  readFile: (path) => ipcRenderer.invoke('file:read', path),
  writeFile: (path, content) => ipcRenderer.invoke('file:write', path, content),
  saveFileAs: (name, content) => ipcRenderer.invoke('file:save-as', name, content),
  fileExists: (path) => ipcRenderer.invoke('file:exists', path),
  watchFile: (path) => ipcRenderer.invoke('file:watch', path),
  onFileChanged: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('file:changed', listener);
    return () => ipcRenderer.removeListener('file:changed', listener);
  },

  /* ---------------------------------------------------------------- */
  /* AI                                                                 */
  /* ---------------------------------------------------------------- */
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiModels: () => ipcRenderer.invoke('ai:models'),
  aiHealth: () => ipcRenderer.invoke('ai:health'),
  aiChat: (messages, options) => ipcRenderer.invoke('ai:chat', messages, options),
  aiExplain: (payload) => ipcRenderer.invoke('ai:explain', payload),
  aiRefactor: (payload) => ipcRenderer.invoke('ai:refactor', payload),
  aiCompletion: (payload) => ipcRenderer.invoke('ai:completion', payload),
  aiDocstring: (payload) => ipcRenderer.invoke('ai:docstring', payload),
  aiCommitMessage: (root) => ipcRenderer.invoke('ai:commit-message', root),
  aiDiff: (before, after) => ipcRenderer.invoke('ai:diff', before, after),

  /* ---------------------------------------------------------------- */
  /* collaboration                                                      */
  /* ---------------------------------------------------------------- */
  collabStart: (options) => ipcRenderer.invoke('collab:start', options),
  collabJoin: (url, options) => ipcRenderer.invoke('collab:join', url, options),
  collabStop: () => ipcRenderer.invoke('collab:stop'),
  collabPeers: () => ipcRenderer.invoke('collab:peers'),
  collabOperation: (filePath, before, after) =>
    ipcRenderer.invoke('collab:operation', filePath, before, after),
  collabCursor: (filePath, cursor) => ipcRenderer.invoke('collab:cursor', filePath, cursor),
  collabChat: (message) => ipcRenderer.invoke('collab:chat', message),
  collabApply: (filePath, op, currentText) => ipcRenderer.invoke('collab:apply', filePath, op, currentText),
  onCollabEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('collab:event', listener);
    return () => ipcRenderer.removeListener('collab:event', listener);
  },

  /* ---------------------------------------------------------------- */
  /* intelligence                                                       */
  /* ---------------------------------------------------------------- */
  semanticSearch: (query, options) => ipcRenderer.invoke('intel:search', query, options),
  findDeadCode: () => ipcRenderer.invoke('intel:dead-code'),
  testImpact: (changedFiles) => ipcRenderer.invoke('intel:test-impact', changedFiles),
  projectOverview: () => ipcRenderer.invoke('intel:overview'),
  localDocstring: (code, language) => ipcRenderer.invoke('intel:docstring', code, language),

  /* ---------------------------------------------------------------- */
  /* workflow                                                           */
  /* ---------------------------------------------------------------- */
  previewStart: () => ipcRenderer.invoke('workflow:preview-start'),
  previewStop: () => ipcRenderer.invoke('workflow:preview-stop'),
  previewLog: () => ipcRenderer.invoke('workflow:preview-log'),
  deployTargets: () => ipcRenderer.invoke('workflow:deploy-targets'),
  deploy: (options) => ipcRenderer.invoke('workflow:deploy', options),
  dbConnect: (connectionString) => ipcRenderer.invoke('workflow:db-connect', connectionString),
  dbQuery: (connectionString, query) => ipcRenderer.invoke('workflow:db-query', connectionString, query),
  apiRequest: (options) => ipcRenderer.invoke('workflow:api-request', options),
  runTerminal: (command) => ipcRenderer.invoke('workflow:terminal', command),

  /* ---------------------------------------------------------------- */
  /* themes and fonts                                                   */
  /* ---------------------------------------------------------------- */
  listThemes: () => ipcRenderer.invoke('themes:list'),
  installTheme: (theme) => ipcRenderer.invoke('themes:install', theme),
  removeTheme: (id) => ipcRenderer.invoke('themes:remove', id),
  exportTheme: (name) => ipcRenderer.invoke('themes:export', name),
  captureWallpaper: () => ipcRenderer.invoke('themes:wallpaper'),
  ambientTint: () => ipcRenderer.invoke('themes:ambient'),
  importFont: () => ipcRenderer.invoke('themes:font-import'),
  listFonts: () => ipcRenderer.invoke('themes:fonts'),

  /* ---------------------------------------------------------------- */
  /* git                                                                */
  /* ---------------------------------------------------------------- */
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitDiff: (filePath, staged) => ipcRenderer.invoke('git:diff', filePath, staged),
  gitStagedDiff: () => ipcRenderer.invoke('git:staged-diff'),
  gitStage: (filePath) => ipcRenderer.invoke('git:stage', filePath),
  gitUnstage: (filePath) => ipcRenderer.invoke('git:unstage', filePath),
  gitCommit: (message) => ipcRenderer.invoke('git:commit', message),
  gitLog: (limit) => ipcRenderer.invoke('git:log', limit),

  /* ---------------------------------------------------------------- */
  /* window and menu                                                    */
  /* ---------------------------------------------------------------- */
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMenuCommand: (cb) => {
    const listener = (_e, command) => cb(command);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },
});

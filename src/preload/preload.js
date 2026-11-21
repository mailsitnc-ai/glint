const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_, theme) => cb(theme)),
  onFolderOpened: (cb) => ipcRenderer.on('folder-opened', (_, data) => cb(data)),
  onToggleSidebar: (cb) => ipcRenderer.on('toggle-sidebar', () => cb()),
  openFolder: () => ipcRenderer.send('open-folder'),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  readdir: (dir) => ipcRenderer.invoke('readdir', dir),
});

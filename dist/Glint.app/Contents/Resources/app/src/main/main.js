const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const isMac = process.platform === 'darwin';

let mainWindow;
const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f0f12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
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
        { label: 'Open Folder', accelerator: 'CmdOrCtrl+O', click: async () => openFolder() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => mainWindow.webContents.send('toggle-sidebar') },
      ],
    },
    {
      label: 'Theme',
      submenu: [
        { label: 'Glint Dark', type: 'radio', checked: true, click: () => setTheme('glint-dark') },
        { label: 'Glint Light', type: 'radio', click: () => setTheme('glint-light') },
        { label: 'Ocean', type: 'radio', click: () => setTheme('ocean') },
        { label: 'Solarized', type: 'radio', click: () => setTheme('solarized') },
      ],
    },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
    {
      label: 'Help',
      submenu: [{ label: 'Learn More', click: async () => await shell.openExternal('https://github.com/mailsitnc-ai/glint') }],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

async function openFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      mainWindow.webContents.send('folder-opened', {
        path: folderPath,
        name: path.basename(folderPath),
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        })),
      });
    } catch (err) {
      dialog.showErrorBox('Error', `Could not read folder: ${err.message}`);
    }
  }
}

async function setTheme(theme) {
  try {
    await fs.writeFile(settingsPath, JSON.stringify({ theme }, null, 2));
    mainWindow.webContents.send('theme-changed', theme);
  } catch (err) {
    console.error('Failed to save theme', err);
  }
}

ipcMain.on('get-settings', async (event) => {
  try {
    const data = await fs.readFile(settingsPath, 'utf-8');
    event.returnValue = JSON.parse(data);
  } catch (err) {
    event.returnValue = { theme: 'glint-dark' };
  }
});

ipcMain.handle('read-file', async (_, filePath) => {
  return await fs.readFile(filePath, 'utf-8');
});

ipcMain.handle('write-file', async (_, filePath, content) => {
  await fs.writeFile(filePath, content);
  return { ok: true };
});

ipcMain.handle('readdir', async (_, dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    type: e.isDirectory() ? 'directory' : 'file',
  }));
});

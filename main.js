const { app, BrowserWindow, desktopCapturer, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Fix GPU for cold boot
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('enable-zero-copy');
app.setPath('userData', path.join(app.getPath('appData'), 'CatDesk'));

let mainWindow = null;
let inputProcess = null;
let inputReady = false;
let inputErrorShown = false;
let updateDownloaded = false;
let updateFilePath = null;
let tray = null;
let isQuitting = false;
let closeToTray = true;

function startInputHelper() {
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'input_helper.ps1')
    : path.join(__dirname, 'input_helper.ps1');

  inputProcess = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';

  inputProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.status === 'ready') {
          inputReady = true;
          inputErrorShown = false;
        }
      } catch (_) { /* ignore */ }
    }
  });

  inputProcess.stderr.on('data', (data) => {
    console.error('[INPUT] stderr:', data.toString());
  });

  inputProcess.on('error', (err) => {
    console.error('[INPUT] spawn error:', err.message);
    if (!inputErrorShown && mainWindow) {
      inputErrorShown = true;
      mainWindow.webContents.send('input-error', err.message);
    }
  });

  inputProcess.on('close', (code) => {
    inputReady = false;
  });
}

function sendInputCommand(cmd) {
  if (inputProcess && inputReady) {
    try {
      inputProcess.stdin.write(JSON.stringify(cmd) + '\n');
    } catch (e) {
      console.error('[INPUT] Write error:', e.message);
    }
  }
  return Promise.resolve({ status: 'ok' });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 720,
    minHeight: 520,
    title: 'CatDesk',
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    titleBarOverlay: {
      color: '#0a0a0f',
      symbolColor: '#94a3b8',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (e) => {
    if (!isQuitting && closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Create a proper 16x16 icon for tray from the .ico file
  let trayIcon;
  try {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'icon.ico')
      : path.join(__dirname, 'icon.ico');
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAclJREFUWEftlr1KA0EUhe+ZTTbRxkYb30DfwCfwBXwFH8LOwkZshICFhSAIghAIgmAhWIiF+A8iiCAoiCAoiCAoiCAoiCAoiCD4AzOT3Z0kM+5GdpOAjbhVYO+c+ebMnblDBH+8iD98I/6ECnwCgA/Cm1mYS+Nj7UZ/AzUhD50JITrH/TYJofrXUJmaS2B+rp5/hC+ixA4mBfxFYoRa4/V6kACzQAdfLjO4X4vP4x2vFqCW8jjd+Dm8nwErtTAvkbRDuD9uPwM4V4Noh5fn6GMAuzqE0Ac3ZwH4LhEia9DnBIArkgvPJntB+rMB4E25IFOULGsPJwE0hQAI7fHBtCoKkPdw/Cd/GfnR3kL5NIAPKt1OyB5wDm9AduNJygaYZ2hmWh8BRgcuHgGYXYdApOsdSY2n95Wk6EDnHoAHoQGNB4jIR/ATab0r6ZEMkYYLAE7Ems9pABIiOJmQPF4OAPCm1JESiGb4p4M8gE3YRFSCqORBQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQMALvgHnS9jt+r7K0AAAAABJRU5ErkJggg==');
    }
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch (_) {
    trayIcon = nativeImage.createEmpty();
  }
  
  tray = new Tray(trayIcon);
  tray.setToolTip('CatDesk');

  updateTrayMenu();

  tray.on('double-click', () => { if (mainWindow) mainWindow.show(); });
}

function updateTrayMenu() {
  const roomId = global.roomId || '------';
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Ваш КЭТ: ' + roomId, enabled: false },
    { type: 'separator' },
    { label: 'Настройки', click: () => { 
      if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.executeJavaScript("document.getElementById('settingsOverlay').classList.remove('hidden');");
      }
    }},
    { label: 'Открыть', click: () => { if (mainWindow) mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Выйти', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

// Auto-start with Windows
function setAutoStart(enable) {
  const appPath = process.execPath;
  const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  if (enable) {
    exec(`reg add "${regKey}" /v CatDesk /t REG_SZ /d "${appPath}" /f`);
  } else {
    exec(`reg delete "${regKey}" /v CatDesk /f`);
  }
}

function isAutoStartEnabled() {
  try {
    const result = require('child_process').execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v CatDesk', { encoding: 'utf8' });
    return result.includes('CatDesk');
  } catch (_) { return false; }
}

app.whenReady().then(() => {
  startInputHelper();
  createTray();
  createWindow();
  // Enable auto-start by default
  if (!isAutoStartEnabled()) setAutoStart(true);
});

app.on('window-all-closed', () => {
  if (inputProcess) {
    sendInputCommand({ action: 'quit' }).finally(() => {
      inputProcess.kill();
    });
  }
  // Don't quit - stay in tray
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  } catch (err) {
    console.error('Failed to get screen sources:', err);
    return [];
  }
});

ipcMain.handle('get-screen-size', async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return { width: primaryDisplay.size.width, height: primaryDisplay.size.height };
});

ipcMain.handle('simulate-input', async (_event, { type, data }) => {
  if (!inputReady) return { ok: false };
  try {
    const display = screen.getPrimaryDisplay();
    const sw = display.size.width;
    const sh = display.size.height;

    switch (type) {
      case 'mouse-move': {
        const x = Math.round(data.x * sw);
        const y = Math.round(data.y * sh);
        sendInputCommand({ action: 'move', x, y });
        break;
      }
      case 'mouse-down': {
        sendInputCommand({ action: 'mousedown', button: data.button || 'left' });
        break;
      }
      case 'mouse-up': {
        sendInputCommand({ action: 'mouseup', button: data.button || 'left' });
        break;
      }
      case 'mouse-click-right': {
        sendInputCommand({ action: 'mousedown', button: 'right' });
        sendInputCommand({ action: 'mouseup', button: 'right' });
        break;
      }
      case 'mouse-wheel': {
        sendInputCommand({ action: 'wheel', delta: data.delta || data.deltaY || 0 });
        break;
      }
      case 'key-down': {
        sendInputCommand({ action: 'keydown', vk: data.vk || data.keyCode || 0 });
        break;
      }
      case 'key-up': {
        sendInputCommand({ action: 'keyup', vk: data.vk || data.keyCode || 0 });
        break;
      }
    }
  } catch (err) {
    console.error('[INPUT] Simulation error:', err);
  }
  return { ok: true };
});

ipcMain.handle('set-auto-start', async (_event, enable) => {
  setAutoStart(enable);
  return { ok: true };
});

ipcMain.handle('is-auto-start', async () => {
  return { enabled: isAutoStartEnabled() };
});

ipcMain.handle('get-app-version', async () => {
  return { version: app.getVersion() };
});

ipcMain.handle('focus-window', async () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  return { ok: true };
});

ipcMain.handle('set-close-to-tray', async (_event, enable) => {
  closeToTray = enable;
  return { ok: true };
});

ipcMain.handle('update-tray-id', async (_event, id) => {
  global.roomId = id;
  if (tray) updateTrayMenu();
  return { ok: true };
});

ipcMain.handle('open-external', async (_event, url) => {
  require('electron').shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const https = require('https');
    const http = require('http');
    const currentVersion = app.getVersion();
    return new Promise((resolve) => {
      https.get('https://catdesk.ru/version.json', { rejectUnauthorized: false }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            if (info.version && info.version !== currentVersion) {
              resolve({ ok: true, version: info.version, url: info.url || 'https://catdesk.ru/CatDesk-Setup.exe' });
            } else {
              resolve({ ok: true, version: null });
            }
          } catch (e) { resolve({ ok: false, message: 'Ошибка проверки' }); }
        });
      }).on('error', () => resolve({ ok: false, message: 'Сервер недоступен' }));
    });
  } catch (err) { return { ok: false, message: err.message }; }
});

ipcMain.handle('download-update', async (_event, { url }) => {
  try {
    const https = require('https');
    const http = require('http');
    const os = require('os');
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, 'CatDesk-Update.exe');
    
    return new Promise((resolve) => {
      const proto = url.startsWith('https') ? https : http;
      const req = proto.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          // Follow redirect
          const newUrl = res.headers.location;
          if (mainWindow) mainWindow.webContents.send('update-progress', 0);
          const req2 = (newUrl.startsWith('https') ? https : http).get(newUrl, (res2) => {
            downloadStream(res2, filePath, resolve);
          });
          req2.on('error', () => resolve({ ok: false, message: 'Ошибка загрузки' }));
          return;
        }
        downloadStream(res, filePath, resolve);
      });
      req.on('error', () => resolve({ ok: false, message: 'Ошибка загрузки' }));
    });
  } catch (err) { return { ok: false, message: err.message }; }
});

function downloadStream(res, filePath, resolve) {
  const fs = require('fs');
  const total = parseInt(res.headers['content-length'] || '0');
  let received = 0;
  const file = fs.createWriteStream(filePath);
  res.on('data', (chunk) => {
    received += chunk.length;
    file.write(chunk);
    if (total > 0 && mainWindow) {
      mainWindow.webContents.send('update-progress', Math.round(received / total * 100));
    }
  });
  res.on('end', () => {
    file.end();
    updateDownloaded = true;
    updateFilePath = filePath;
    if (mainWindow) mainWindow.webContents.send('update-downloaded');
    resolve({ ok: true, path: filePath });
  });
  res.on('error', () => {
    file.close();
    resolve({ ok: false, message: 'Ошибка загрузки' });
  });
}

ipcMain.handle('install-update', async () => {
  if (updateFilePath) {
    const { exec } = require('child_process');
    exec('"' + updateFilePath + '"');
    setTimeout(() => app.quit(), 1000);
    return { ok: true };
  }
  return { ok: false };
});
const { contextBridge, ipcRenderer } = require('electron');
const gost = require('./lib/gost');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
  simulateInput: (input) => ipcRenderer.invoke('simulate-input', input),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: (url) => ipcRenderer.invoke('download-update', { url }),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, pct) => cb(pct)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setCloseToTray: (enable) => ipcRenderer.invoke('set-close-to-tray', enable),
  updateTrayId: (id) => ipcRenderer.invoke('update-tray-id', id),
  setAutoStart: (enable) => ipcRenderer.invoke('set-auto-start', enable),
  isAutoStart: () => ipcRenderer.invoke('is-auto-start'),
  setCloseToTray: (enable) => ipcRenderer.invoke('set-close-to-tray', enable),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, pct) => cb(pct)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  onInputError: (cb) => ipcRenderer.on('input-error', (_e, msg) => cb(msg)),
  gost: {
    generateKey: () => gost.bytesToBase64(gost.generateKey()),
    encrypt: (keyB64, plaintext) => {
      const key = gost.base64ToBytes(keyB64);
      const cipher = gost.createGostCipher(key);
      return cipher.encrypt(plaintext);
    },
    decrypt: (keyB64, ivB64, dataB64) => {
      const key = gost.base64ToBytes(keyB64);
      const iv = gost.base64ToBytes(ivB64);
      const data = gost.base64ToBytes(dataB64);
      return gost.bytesToString(gost.gostCtrDecrypt(key, iv, data));
    },
  },
});

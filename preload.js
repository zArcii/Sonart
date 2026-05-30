const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sonart', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onMaximizeChange: (callback) => {
    ipcRenderer.on('maximize-change', (_event, isMaximized) => callback(isMaximized));
  },
  startLoginFlow: () => ipcRenderer.send('start-login-flow'),
  onLoginSuccess: (callback) => {
    ipcRenderer.on('login-success', () => callback());
  },
  updateActivity: (activity) => ipcRenderer.send('update-activity', activity)
});

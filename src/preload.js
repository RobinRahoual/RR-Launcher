const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('rr', {
  getLibrary: () => ipcRenderer.invoke('lib:get'),
  pickExe: () => ipcRenderer.invoke('game:pick'),
  inspectExe: (p) => ipcRenderer.invoke('game:inspect', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  search: (term) => ipcRenderer.invoke('meta:search', term),
  addGame: (data) => ipcRenderer.invoke('game:add', data),
  refetch: (id, match) => ipcRenderer.invoke('game:refetch', { id, match }),
  updateGame: (id, patch) => ipcRenderer.invoke('game:update', { id, patch }),
  removeGame: (id) => ipcRenderer.invoke('game:remove', id),
  setImage: (id, kind) => ipcRenderer.invoke('game:setImage', { id, kind }),
  openFolder: (id) => ipcRenderer.invoke('game:openFolder', id),
  launch: (id) => ipcRenderer.invoke('game:launch', id),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: on('update:status'),
  onLibrary: on('lib:changed'),
  onProgress: on('game:progress'),
  onRunning: on('game:running'),
  onFullscreen: on('win:fullscreen'),
});

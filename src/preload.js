const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('rr', {
  getLibrary: call('lib:get'),
  pickFile: call('game:pick'),
  inspectFile: call('game:inspect'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  search: (term, platform) => ipcRenderer.invoke('meta:search', { term, platform }),
  addGame: call('game:add'),
  addMany: call('games:addMany'),
  refetchAll: call('games:refetchAll'),
  refetch: (id, match) => ipcRenderer.invoke('game:refetch', { id, match }),
  updateGame: (id, patch) => ipcRenderer.invoke('game:update', { id, patch }),
  removeGame: call('game:remove'),
  setImage: (id, kind) => ipcRenderer.invoke('game:setImage', { id, kind }),
  openFolder: call('game:openFolder'),
  launch: call('game:launch'),
  platformImage: call('platform:image'),
  setPlatformImage: call('platform:setImage'),
  platformLogo: call('platform:logo'),
  setPlatformLogo: call('platform:setLogo'),
  pickEmulator: call('emu:pick'),
  setEmulator: (platformId, conf) => ipcRenderer.invoke('emu:set', { platformId, conf }),
  applyDetectedEmulators: call('emu:applyDetected'),
  pickScanFolders: call('scan:pickFolders'),
  scan: (mode, folders) => ipcRenderer.invoke('scan:run', { mode, folders }),
  cancelScan: call('scan:cancel'),
  setSettings: call('settings:set'),
  toggleFullscreen: call('win:toggleFullscreen'),
  minimize: call('win:minimize'),
  quit: call('app:quit'),
  openExternal: call('app:openExternal'),
  getUpdate: call('update:get'),
  checkUpdate: call('update:check'),
  installUpdate: call('update:install'),
  onUpdate: on('update:status'),
  onLibrary: on('lib:changed'),
  onProgress: on('game:progress'),
  onRunning: on('game:running'),
  onScanProgress: on('scan:progress'),
  onVisible: on('win:visible'),
  onFullscreen: on('win:fullscreen'),
  // GUIDE : bouton Xbox / PS / Home, menu en jeu, alimentation
  resumeGame: call('game:resume'),
  quitGame: call('game:quit'),
  sessions: call('game:sessions'),
  power: call('power:action'), // 'shutdown' | 'restart' | 'sleep'
  guideStatus: call('guide:status'),
  setIngame: call('guide:ingame'),
  onGuide: on('guide:press'),
  onPadRemote: on('pad:remote'),
  // WAKE : retour au premier plan (fin de la dernière session, manette allumée)
  onWake: on('win:wake'),
});

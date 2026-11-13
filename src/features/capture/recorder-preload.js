// RR Launcher — CAPTURE : pont de la fenêtre cachée d'enregistrement (recorder.html)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rec', {
  onStart: (cb) => ipcRenderer.on('rec:start', (_e, o) => cb(o)),
  onStop: (cb) => ipcRenderer.on('rec:stop', () => cb()),
  chunk: (u8) => ipcRenderer.send('capture-rec:chunk', u8),
  info: (o) => ipcRenderer.send('capture-rec:info', o),
  done: (o) => ipcRenderer.send('capture-rec:done', o),
});

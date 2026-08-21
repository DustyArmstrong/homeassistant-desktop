const { contextBridge, ipcRenderer } = require('electron');

console.log('preload script loaded');

contextBridge.exposeInMainWorld('electron', {
    getHaInstance: () => ipcRenderer.send("get-ha-instance"),
    onReceiveHaInstance: (callback) => ipcRenderer.on("receive-ha-instance", (event, url) => callback(url)),
    getInstances: () => ipcRenderer.send("get-instances"),
    onReceiveInstances: (callback) => ipcRenderer.on("receive-instances", (event, result) => callback(result)),
    sendHaInstance: (url) => ipcRenderer.send("get-ha-instance", url),
    reconnect: () => ipcRenderer.send('reconnect'),
    restart: () => ipcRenderer.send('restart'),
    onRetryUpdate: (callback) => ipcRenderer.on('retry-update', (event, data) => callback(data)),
    onRetrySuccess: (callback) => ipcRenderer.on('retry-success', (event, data) => callback(data)),
    onRetryError: (callback) => ipcRenderer.on('retry-error', (event, data) => callback(data)),
});
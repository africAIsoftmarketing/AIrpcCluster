const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rpcCluster', {
  scanWorkers: () => ipcRenderer.invoke('scan-workers'),
  listModels: () => ipcRenderer.invoke('list-models'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),
  testCluster: (config) => ipcRenderer.invoke('test-cluster', config),
  startInferenceServer: () => ipcRenderer.invoke('start-inference-server'),
  stopInferenceServer: () => ipcRenderer.invoke('stop-inference-server'),
  getInferenceServerStatus: () => ipcRenderer.invoke('get-inference-server-status'),
  detectHostHardware: () => ipcRenderer.invoke('detect-host-hardware'),
  getLlamaDownloadUrl: (variant) => ipcRenderer.invoke('get-llama-download-url', variant),
  installLlamaServer: (url) => ipcRenderer.invoke('install-llama-server', url),
  onInstallProgress: (cb) => ipcRenderer.on('install-progress', (event, data) => cb(data)),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
});

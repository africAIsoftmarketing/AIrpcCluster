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
  getInferenceServerStatus: () => ipcRenderer.invoke('get-inference-server-status')
});

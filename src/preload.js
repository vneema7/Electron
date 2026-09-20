const { contextBridge, ipcRenderer, webUtils } = require('electron');
const subscribe = channel => callback => {
  const listener = (_event,data) => callback(data);
  ipcRenderer.on(channel,listener);
  return () => ipcRenderer.removeListener(channel,listener);
};
contextBridge.exposeInMainWorld('electronAPI', {
  getServerPort: () => ipcRenderer.invoke('get-server-port'),
  getDeviceName: () => ipcRenderer.invoke('get-device-name'),
  getDeviceId: () => ipcRenderer.invoke('get-device-id'),
  getLocalAddresses: () => ipcRenderer.invoke('get-local-addresses'),
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  getNetworkWarning: () => ipcRenderer.invoke('get-network-warning'),
  getPeers: () => ipcRenderer.invoke('get-peers'),
  getLocalFiles: () => ipcRenderer.invoke('get-local-files'),
  shareFile: p => ipcRenderer.invoke('share-file',p),
  chooseFiles: () => ipcRenderer.invoke('choose-files'),
  fetchPeerFiles: opts => ipcRenderer.invoke('fetch-peer-files',opts),
  downloadPeerFile: opts => ipcRenderer.invoke('download-peer-file',opts),
  removeSharedFile: id => ipcRenderer.invoke('remove-shared-file',id),
  addManualPeer: opts => ipcRenderer.invoke('add-manual-peer',opts),
  getFilePath: file => webUtils.getPathForFile(file),
  onFilesUpdated: subscribe('files-updated'),
  onPeersUpdated: subscribe('peers-updated'),
  onTransferProgress: subscribe('transfer-progress'),
  onNetworkWarning: subscribe('network-warning'),
});

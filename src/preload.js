const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerPort:    ()       => ipcRenderer.invoke('get-server-port'),
  getDeviceName:    ()       => ipcRenderer.invoke('get-device-name'),
  getDeviceId:      ()       => ipcRenderer.invoke('get-device-id'),
  getLocalIp:       ()       => ipcRenderer.invoke('get-local-ip'),
  getPeers:         ()       => ipcRenderer.invoke('get-peers'),
  getLocalFiles:    ()       => ipcRenderer.invoke('get-local-files'),
  shareFile:        (p)      => ipcRenderer.invoke('share-file', p),
  fetchPeerFiles:   (opts)   => ipcRenderer.invoke('fetch-peer-files', opts),
  downloadPeerFile: (opts)   => ipcRenderer.invoke('download-peer-file', opts),
  removeSharedFile: (id)     => ipcRenderer.invoke('remove-shared-file', id),
  getFilePath:      (file)   => webUtils.getPathForFile(file),

  onFilesUpdated: (cb) => {
    ipcRenderer.on('files-updated', cb);
    return () => ipcRenderer.removeListener('files-updated', cb);
  },
  onPeersUpdated: (cb) => {
    ipcRenderer.on('peers-updated', cb);
    return () => ipcRenderer.removeListener('peers-updated', cb);
  },
});

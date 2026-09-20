const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const { Network, addresses } = require('./network');
const network = new Network();
let mainWindow;
let quitting = false;
let warning = '';
function send(channel,data) { if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel,data); }
for(const channel of ['files-updated','peers-updated','transfer-progress']) network.on(channel,data => send(channel,data));
network.on('warning',message => { warning = message; console.warn(message); send('network-warning',message); });
function createWindow() {
  mainWindow = new BrowserWindow({width:960,height:700,minWidth:640,minHeight:520,backgroundColor:'#0f0f1a',show:true,
    title:'AirDrop',titleBarStyle:process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.js')}});
  mainWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  mainWindow.webContents.on('will-navigate',event => event.preventDefault());
  const window = mainWindow;
  window.loadFile(path.join(__dirname,'index.html')).then(() => {
    if (!window.isDestroyed()) { window.show(); window.focus(); }
  }).catch(error => {
    console.error('Could not load AirDrop window:', error);
    dialog.showErrorBox('AirDrop window could not load', error.message);
  });
  if(process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
  mainWindow.on('closed',() => { mainWindow = null; });
}
function handle(channel,callback) {
  ipcMain.handle(channel,async (event,...args) => {
    if(!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Invalid sender');
    return callback(...args);
  });
}
const result = fn => async (...args) => {try {return {success:true,...await fn(...args)};} catch(e) {return {success:false,error:e.message};}};
handle('get-server-port',() => network.port);
handle('get-device-name',() => network.name);
handle('get-device-id',() => network.id);
handle('get-local-addresses',() => addresses());
handle('get-local-ip',() => addresses()[0] || '127.0.0.1');
handle('get-network-warning',() => warning);
handle('get-peers',() => [...network.peers.values()]);
handle('get-local-files',() => network.listFiles());
handle('share-file',result(p => network.share(p)));
handle('choose-files',result(async () => {
  const selection = await dialog.showOpenDialog(mainWindow,{properties:['openFile','multiSelections']});
  for(const file of selection.filePaths) await network.share(file);
}));
handle('remove-shared-file',result(id => network.remove(id)));
handle('add-manual-peer',result(endpoint => network.addPeer(endpoint)));
handle('fetch-peer-files',async endpoint => {try {return await network.fetchFiles(endpoint);} catch (_) {return [];}});
handle('download-peer-file',result(async endpoint => {
  const destination = await network.download(endpoint,app.getPath('downloads'));
  shell.showItemInFolder(destination);
  return {path:destination};
}));
app.whenReady().then(async () => {
  await network.start();
  console.log(`AirDrop listening on ${addresses().map(ip => `${ip}:${network.port}`).join(', ')}`);
  createWindow();
}).catch(error => { console.error(error); dialog.showErrorBox('AirDrop could not start',error.message); app.quit(); });
app.on('activate',() => {if(!mainWindow && network.port) createWindow();});
app.on('window-all-closed',() => {if(process.platform !== 'darwin') app.quit();});
app.on('before-quit',event => {
  if(quitting) return;
  event.preventDefault(); quitting = true;
  network.close().catch(console.error).finally(() => app.quit());
});

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
require('../src/main');
let root;
let failed = false;
app.on('will-quit',() => {if(failed) app.exit(1);});
const watchdog = setTimeout(() => {console.error('App smoke test timed out'); app.exit(1);},20000);
app.on('browser-window-created',(_event,window) => {
  window.webContents.on('render-process-gone',(_event,details) => {console.error(details); app.exit(1);});
  window.webContents.once('did-finish-load',async () => {
    try {
      await new Promise(resolve => setTimeout(resolve,500));
      assert.equal(window.isVisible(),true,'The app window must be visible');
      assert.equal(window.isMinimized(),false,'The app window must not be minimized');
      assert.ok(await window.webContents.executeJavaScript('Boolean(window.electronAPI)'));
      const address = await window.webContents.executeJavaScript("document.getElementById('ip-badge').textContent");
      assert.match(address,/:\d+$/);
      root = await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-ui-test-'));
      const file = path.join(root,'test & notes.txt'); await fs.writeFile(file,'Electron IPC smoke test');
      const shared = await window.webContents.executeJavaScript(`window.electronAPI.shareFile(${JSON.stringify(file)})`);
      assert.equal(shared.success,true);
      await window.webContents.executeJavaScript('refresh()');
      const label = await window.webContents.executeJavaScript("document.querySelector('.file-name')?.textContent");
      assert.equal(label,'test & notes.txt');
      await window.webContents.executeJavaScript(`window.electronAPI.removeSharedFile(${JSON.stringify(shared.fileId)})`);
      await window.webContents.executeJavaScript('refresh()');
      assert.match(await window.webContents.executeJavaScript("document.getElementById('file-list').textContent"),/No files/);
      console.log('PASS: Electron window, sandboxed preload, renderer, share/remove IPC and file list');
    } catch(error) {console.error(error); failed = true;}
    finally {clearTimeout(watchdog); if(root) await fs.rm(root,{recursive:true,force:true}); app.quit();}
  });
});

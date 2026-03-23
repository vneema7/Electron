const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const dgram = require('dgram');
const http = require('http');

const isDev = process.argv.includes('--dev');
const sharedFilesDir = path.join(os.tmpdir(), 'electron-airdrop-shared');
const fileDatabase = {};
const deviceId = uuidv4();
const DISCOVERY_PORT = 45678;
const peers = {};

let mainWindow;
let serverPort;

if (!fs.existsSync(sharedFilesDir)) {
  fs.mkdirSync(sharedFilesDir, { recursive: true });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// ── Express server ────────────────────────────────────────────────────────────

const expressApp = express();

expressApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

expressApp.use(express.json());

const upload = multer({ dest: sharedFilesDir });

expressApp.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const fileId = uuidv4();
  const ext = path.extname(req.file.originalname);
  const finalPath = path.join(sharedFilesDir, fileId + ext);
  fs.renameSync(req.file.path, finalPath);

  fileDatabase[fileId] = {
    id: fileId,
    name: req.file.originalname,
    size: req.file.size,
    timestamp: Date.now(),
    path: finalPath,
    deviceName: os.hostname(),
    deviceId,
  };

  if (mainWindow) mainWindow.webContents.send('files-updated');
  res.json({ success: true, fileId });
});

expressApp.get('/api/files', (req, res) => {
  res.json(
    Object.values(fileDatabase).map(({ id, name, size, timestamp, deviceName }) => ({
      id, name, size, timestamp, deviceName,
    }))
  );
});

expressApp.get('/api/download/:fileId', (req, res) => {
  const file = fileDatabase[req.params.fileId];
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.download(file.path, file.name);
});

const server = expressApp.listen(0, '0.0.0.0', () => {
  serverPort = server.address().port;
  console.log(`File server on port ${serverPort}`);
  startDiscovery();
});

// ── UDP peer discovery ────────────────────────────────────────────────────────

const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

function broadcastPresence() {
  const msg = Buffer.from(
    JSON.stringify({ id: deviceId, name: os.hostname(), port: serverPort, ip: getLocalIP() })
  );
  try {
    udpSocket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255');
  } catch (_) {}
}

function startDiscovery() {
  udpSocket.bind(DISCOVERY_PORT, () => {
    udpSocket.setBroadcast(true);
    broadcastPresence();
    setInterval(broadcastPresence, 3000);
    setInterval(() => {
      const now = Date.now();
      let changed = false;
      Object.keys(peers).forEach((id) => {
        if (now - peers[id].lastSeen > 10000) {
          delete peers[id];
          changed = true;
        }
      });
      if (changed && mainWindow) mainWindow.webContents.send('peers-updated');
    }, 4000);
  });

  udpSocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.id === deviceId) return;
      const isNew = !peers[data.id];
      peers[data.id] = { ...data, ip: rinfo.address, lastSeen: Date.now() };
      if (mainWindow) mainWindow.webContents.send('peers-updated');
      if (isNew) console.log(`Peer found: ${data.name} @ ${rinfo.address}:${data.port}`);
    } catch (_) {}
  });

  udpSocket.on('error', (err) => console.error('UDP error:', err.message));
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 640,
    minHeight: 520,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#0f0f1a',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'AirDrop',
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (isDev) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-server-port', () => serverPort);
ipcMain.handle('get-device-name', () => os.hostname());
ipcMain.handle('get-device-id', () => deviceId);
ipcMain.handle('get-local-ip', () => getLocalIP());

ipcMain.handle('get-peers', () =>
  Object.values(peers).map(({ id, name, ip, port }) => ({ id, name, ip, port }))
);

ipcMain.handle('share-file', async (event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const fileId = uuidv4();
    const ext = path.extname(fileName);
    const destPath = path.join(sharedFilesDir, fileId + ext);

    fs.copyFileSync(filePath, destPath);

    fileDatabase[fileId] = {
      id: fileId,
      name: fileName,
      size: stat.size,
      timestamp: Date.now(),
      path: destPath,
      deviceName: os.hostname(),
      deviceId,
    };

    if (mainWindow) mainWindow.webContents.send('files-updated');
    return { success: true, fileId, name: fileName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fetch-peer-files', async (event, { ip, port }) => {
  return new Promise((resolve) => {
    const req = http.get({ hostname: ip, port, path: '/api/files', timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (_) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
});

ipcMain.handle('download-peer-file', async (event, { ip, port, fileId, fileName }) => {
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  // avoid collisions
  const base = path.basename(fileName, path.extname(fileName));
  const ext = path.extname(fileName);
  let destPath = path.join(downloadsDir, fileName);
  let counter = 1;
  while (fs.existsSync(destPath)) {
    destPath = path.join(downloadsDir, `${base} (${counter++})${ext}`);
  }

  return new Promise((resolve) => {
    const file = fs.createWriteStream(destPath);
    http
      .get(`http://${ip}:${port}/api/download/${fileId}`, (res) => {
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          shell.showItemInFolder(destPath);
          resolve({ success: true, path: destPath });
        });
      })
      .on('error', (err) => {
        fs.unlink(destPath, () => {});
        resolve({ success: false, error: err.message });
      });
  });
});

ipcMain.handle('remove-shared-file', (event, fileId) => {
  const file = fileDatabase[fileId];
  if (!file) return { success: false };
  try { fs.unlinkSync(file.path); } catch (_) {}
  delete fileDatabase[fileId];
  if (mainWindow) mainWindow.webContents.send('files-updated');
  return { success: true };
});

ipcMain.handle('get-local-files', () =>
  Object.values(fileDatabase).map(({ id, name, size, timestamp, deviceName }) => ({
    id, name, size, timestamp, deviceName,
  }))
);

// Clean files older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  Object.entries(fileDatabase).forEach(([id, file]) => {
    if (file.timestamp < cutoff) {
      try { fs.unlinkSync(file.path); } catch (_) {}
      delete fileDatabase[id];
    }
  });
}, 300000);

app.on('ready', createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (!mainWindow) createWindow(); });
app.on('before-quit', () => {
  try { server.close(); udpSocket.close(); } catch (_) {}
});

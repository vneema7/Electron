
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function hsl(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},65%,58%)`;
}

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    pdf:'📄', jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', webp:'🖼️', svg:'🖼️',
    mp4:'🎬', mov:'🎬', avi:'🎬', mkv:'🎬',
    mp3:'🎵', wav:'🎵', flac:'🎵', aac:'🎵',
    zip:'🗜️', rar:'🗜️', '7z':'🗜️', tar:'🗜️', gz:'🗜️',
    doc:'📝', docx:'📝', txt:'📝', rtf:'📝',
    xls:'📊', xlsx:'📊', csv:'📊',
    ppt:'📊', pptx:'📊',
    js:'💻', ts:'💻', py:'💻', html:'🌐', css:'🎨', json:'🔧',
    exe:'⚙️', msi:'⚙️', dmg:'💿', apk:'📱',
  };
  return map[ext] || '📁';
}

function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(1) + ' GB';
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = (type === 'success' ? '✓  ' : '✕  ') + msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Manual connect ────────────────────────────────────────────────────────────

let localIP = '';
let localIPPort = '';

function copyIP() {
  if (!localIPPort) return;
  navigator.clipboard.writeText(localIPPort).then(() => toast('Address copied — share it with the other device'));
}

async function connectManual() {
  const raw = document.getElementById('manual-ip-input').value.trim();
  if (!raw) return;

  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(raw);
  if (!match) { toast('Enter the other device’s complete IPv4 address and port', 'error'); return; }
  const ip = match[1], port = Number(match[2]);
  const btn = document.getElementById('btn-connect');
  btn.disabled = true;
  btn.textContent = 'Connecting…';


    const result = await window.electronAPI.addManualPeer({ ip, port });
    if (result.success) {
      toast(`Connected to ${ip}:${port}`);
      document.getElementById('manual-ip-input').value = '';
      await refresh();
    } else {
      toast(`Could not connect: ${result.error}`, 'error');
    }

  btn.disabled = false;
  btn.textContent = 'Connect';
}

// ── State ─────────────────────────────────────────────────────────────────────

let peers        = [];
let allFiles     = [];
let pendingFiles = [];
let promptActive = false;
let knownFileKeys = new Set();
let initialized  = false;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const [name, ip, port] = await Promise.all([
    window.electronAPI.getDeviceName(),
    window.electronAPI.getLocalIp(),
    window.electronAPI.getServerPort(),
  ]);

  localIP = ip;
  localIPPort = `${ip}:${port}`;
  document.getElementById('device-badge').textContent = name;
  const ipBadge = document.getElementById('ip-badge');
  ipBadge.textContent = `${ip}:${port}`;
  ipBadge.title = `Your address — click to copy`;

  const addresses = await window.electronAPI.getLocalAddresses();
  const selector = document.getElementById('network-addresses');
  for(const address of addresses) {
    const option = document.createElement('option'); option.value = address; option.textContent = address; selector.appendChild(option);
  }
  selector.hidden = addresses.length < 2;
  selector.addEventListener('change',() => { localIPPort = selector.value + ':' + port; ipBadge.textContent = localIPPort; });
  await refresh();
  initialized = true;

  window.electronAPI.onFilesUpdated(refresh);
  window.electronAPI.onPeersUpdated(refresh);
  setInterval(refresh, 4000);
}

let refreshing = null;
let refreshRequested = false;
function refresh() {
  refreshRequested = true;
  if (!refreshing) refreshing = (async () => {
    do { refreshRequested = false; await refreshOnce(); } while (refreshRequested);
  })().finally(() => { refreshing = null; });
  return refreshing;
}
async function refreshOnce() {
  peers = await window.electronAPI.getPeers();
  renderPeers();

  const localFiles = await window.electronAPI.getLocalFiles();
  const mine = localFiles.map(f => ({ ...f, _mine: true }));

  const peerFilesArrays = await Promise.all(
    peers.map(p =>
      window.electronAPI.fetchPeerFiles({ ip: p.ip, port: p.port })
        .then(files => files.map(f => ({
          ...f,
          _peerId: p.id, _peerIp: p.ip, _peerPort: p.port, _mine: false,
        })))
    )
  );

  const combined = [...mine];
  for (const pFiles of peerFilesArrays) {
    for (const f of pFiles) {
      const key = f._peerId + ':' + f.id;
      if (initialized && !knownFileKeys.has(key)) {
        queueIncoming(f);
      }
      knownFileKeys.add(key);
      combined.push(f);
    }
  }

  // Track local file keys too
  for (const f of mine) knownFileKeys.add('mine:' + f.id);

  allFiles = combined;
  renderFiles();
}

// ── Peers ──────────────────────────────────────────────────────────────────────

function renderPeers() {
  const grid = document.getElementById('peers-grid');
  if (peers.length === 0) {
    grid.innerHTML = `<div class="no-peers"><div class="pulse"></div>Scanning for devices on your network…</div>`;
    return;
  }
  grid.innerHTML = peers.map(p => {
    const initials = p.name.slice(0, 2).toUpperCase();
    const color    = hsl(p.name);
    return `
      <div class="peer-card">
        <div class="peer-avatar" style="background:var(--surface2);color:${color};border-color:${color};">
          ${escapeHTML(initials)}
        </div>
        <div class="peer-name" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</div>
      </div>`;
  }).join('');
}

// ── Files ──────────────────────────────────────────────────────────────────────

let _fileIndex = [];

function renderFiles() {
  const list = document.getElementById('file-list');
  if (allFiles.length === 0) {
    list.innerHTML = '<div class="no-files">No files shared yet.</div>';
    _fileIndex = [];
    return;
  }

  // Dedupe
  const seen   = new Set();
  const unique = allFiles.filter(f => {
    const key = f._mine ? 'mine:' + f.id : f._peerId + ':' + f.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  _fileIndex = unique;

  list.innerHTML = unique.map((f, i) => {
    const badge   = f._mine
      ? `<span class="file-badge badge-mine">Shared by me</span>`
      : `<span class="file-badge badge-peer">From ${escapeHTML(f.deviceName)}</span>`;
    const actions = f._mine
      ? `<button class="btn-icon btn-remove"    data-remove="${i}"  title="Stop sharing">✕</button>`
      : `<button class="btn-icon btn-download"  data-download="${i}"     title="Save to Downloads">⬇</button>`;
    return `
      <div class="file-item">
        <span class="file-icon">${fileIcon(f.name)}</span>
        <div class="file-info">
          <div class="file-name" title="${escapeHTML(f.name)}">${escapeHTML(f.name)}</div>
          <div class="file-meta">${fmt(f.size)} · ${timeAgo(f.timestamp)}</div>
        </div>
        ${badge}
        ${actions}
      </div>`;
  }).join('');
}

async function removeFile(id) {
  const result = await window.electronAPI.removeSharedFile(id);
  if (!result.success) { toast(result.error, 'error'); return; }
  knownFileKeys.delete('mine:' + id);
  toast('File removed from sharing');
  await refresh();
}

async function downloadFile(idx) {
  const f = _fileIndex[idx];
  if (!f || f._mine) return;
  toast(`Downloading "${f.name}"…`);
  const result = await receiveFile({
    ip: f._peerIp, port: f._peerPort, fileId: f.id, fileName: f.name,
  });
  if (result.success) {
    toast(`Saved "${f.name}" to Downloads ✓`);
  } else {
    toast(`Download failed: ${result.error}`, 'error');
  }
}

// ── Drag & drop ───────────────────────────────────────────────────────────────

let dragCount = 0;
const dropOverlay = document.getElementById('drop-overlay');

document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  dragCount++;
  dropOverlay.classList.add('active');
});

document.addEventListener('dragleave', () => {
  dragCount = Math.max(0, dragCount - 1);
  if (dragCount === 0) dropOverlay.classList.remove('active', 'drag-over');
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (dragCount > 0) dropOverlay.classList.add('drag-over');
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCount = 0;
  dropOverlay.classList.remove('active', 'drag-over');

  const files = [...e.dataTransfer.files];
  if (!files.length) return;

  for (const file of files) {
    const filePath = window.electronAPI.getFilePath(file);
    if (!filePath) { toast('No file path available', 'error'); continue; }
    const result = await window.electronAPI.shareFile(filePath);
    if (result.success) {
      toast(`"${result.name}" is now shared`);
    } else {
      toast(`Failed: ${result.error}`, 'error');
    }
  }
  await refresh();
});

// ── Incoming prompt ───────────────────────────────────────────────────────────

function queueIncoming(file) {
  pendingFiles.push(file);
  if (!promptActive) showNextPrompt();
}

function showNextPrompt() {
  if (!pendingFiles.length) { promptActive = false; return; }
  promptActive = true;
  const f = pendingFiles[0];

  document.getElementById('incoming-icon').textContent = fileIcon(f.name);
  document.getElementById('incoming-from').textContent = `From ${f.deviceName}`;
  document.getElementById('incoming-name').textContent = f.name;
  document.getElementById('incoming-size').textContent = fmt(f.size);

  const incomingOverlay = document.getElementById('incoming-overlay');
  incomingOverlay.classList.add('active');

  document.getElementById('btn-accept').onclick = async () => {
    incomingOverlay.classList.remove('active');
    const target = pendingFiles.shift();
    toast(`Downloading "${target.name}"…`);
    const result = await receiveFile({
      ip: target._peerIp, port: target._peerPort, fileId: target.id, fileName: target.name,
    });
    if (result.success) {
      toast(`Saved "${target.name}" to Downloads ✓`);
    } else {
      toast(`Download failed: ${result.error}`, 'error');
    }
    setTimeout(showNextPrompt, 300);
  };

  document.getElementById('btn-decline').onclick = () => {
    incomingOverlay.classList.remove('active');
    pendingFiles.shift();
    setTimeout(showNextPrompt, 300);
  };
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init().catch(console.error);

const transfers = new Set();
async function receiveFile(options) {
  const key = options.ip + ':' + options.port + ':' + options.fileId;
  if(transfers.has(key)) return {success:false,error:'This file is already downloading'};
  transfers.add(key);
  try { return await window.electronAPI.downloadPeerFile(options); }
  finally { transfers.delete(key); if(!transfers.size) document.getElementById('transfer-status').hidden = true; }
}
document.getElementById('ip-badge').addEventListener('click',copyIP);
document.getElementById('btn-connect').addEventListener('click',connectManual);
document.getElementById('manual-ip-input').addEventListener('keydown',e => {if(e.key === 'Enter') connectManual();});
document.getElementById('choose-files').addEventListener('click',async () => {
  const result = await window.electronAPI.chooseFiles();
  if(!result.success) toast(result.error,'error');
  await refresh();
});
document.getElementById('file-list').addEventListener('click',event => {
  const button = event.target.closest('button'); if(!button) return;
  if(button.dataset.remove !== undefined) removeFile(_fileIndex[Number(button.dataset.remove)].id);
  if(button.dataset.download !== undefined) downloadFile(Number(button.dataset.download));
});
function showWarning(message) {const el = document.getElementById('network-warning'); el.hidden = !message; el.textContent = message;}
window.electronAPI.getNetworkWarning().then(showWarning);
window.electronAPI.onNetworkWarning(showWarning);
window.electronAPI.onTransferProgress(progress => {
  const el = document.getElementById('transfer-status'); el.hidden = false;
  el.textContent = 'Downloading ' + progress.name + ' — ' + fmt(progress.received) + ' / ' + fmt(progress.total);
});

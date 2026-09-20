const { EventEmitter } = require('node:events');
const dgram = require('node:dgram');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const GROUP = '239.255.45.67';
const PROTOCOL = 'electron-airdrop/1';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const validPort = value => Number.isInteger(value) && value > 0 && value <= 65535;
function addresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
}
function safeName(name) {
  const result = path.win32.basename(path.posix.basename(String(name))).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0,180);
  return !result || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(result) ? 'download' : result;
}
class Network extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = randomUUID(); this.name = options.name || os.hostname();
    this.options = { discoveryPort: 45678, heartbeat: 3000, expiry: 12000, ttl: 3600000, ...options };
    this.memberships = new Set(); this.peers = new Map(); this.files = new Map(); this.requests = new Set(); this.timers = []; this.closed = false;
  }
  listFiles() { return [...this.files.values()].map(({ path: _, ...file }) => file); }
  identity() { return { protocol: PROTOCOL, id: this.id, name: this.name, port: this.port }; }
  async start() {
    this.directory = await fsp.mkdtemp(path.join(this.options.tempRoot || os.tmpdir(), 'electron-airdrop-'));
    this.server = http.createServer((req,res) => {
      res.setHeader('X-Content-Type-Options','nosniff');
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      const json = data => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); };
      if(req.url === '/api/info') return json(this.identity());
      if(req.url === '/api/files') return json(this.listFiles());
      const match = /^\/api\/download\/([a-zA-Z0-9-]{1,80})$/.exec(req.url);
      const file = match && this.files.get(match[1]);
      if(!file) { res.writeHead(404).end('File no longer shared'); return; }
      res.setHeader('Content-Type','application/octet-stream');
      res.setHeader('Content-Length',file.size);
      pipeline(fs.createReadStream(file.path),res).catch(() => res.destroy());
    });
    await new Promise((resolve,reject) => { this.server.once('error',reject); this.server.listen(0,'0.0.0.0',resolve); });
    this.port = this.server.address().port;
    this.server.on('error', e => this.emit('warning',e.message));
    this.socket = dgram.createSocket({type:'udp4',reuseAddr:true});
    this.socket.on('error', e => this.emit('warning', `Discovery: ${e.message}. Manual connection is still available.`));
    this.socket.on('message', (message,remote) => this.receive(message,remote));
    await new Promise(resolve => {
      this.socket.once('error',resolve);
      this.socket.bind(this.options.discoveryPort, () => {
        this.socket.removeListener('error',resolve);
        this.socket.setMulticastTTL(1);
        this.socket.setMulticastLoopback(true);
        this.announce(); resolve();
      });
    });
    this.timers.push(setInterval(() => { this.announce(); this.expire(); },this.options.heartbeat));
    this.timers.push(setInterval(() => this.cleanup().catch(e => this.emit('warning',e.message)), Math.min(30000,this.options.ttl)));
    return this;
  }
  announce() {
    if(this.closed) return;
    const message = Buffer.from(JSON.stringify(this.identity()));
    const current = addresses();
    for(const old of this.memberships) if(!current.includes(old)) {
      try { this.socket.dropMembership(GROUP,old); } catch (_) {}
      this.memberships.delete(old);
    }
    for(const address of current) {
      if(!this.memberships.has(address)) {
        try {this.socket.addMembership(GROUP,address); this.memberships.add(address);}
        catch(error) {this.emit('warning','Discovery on ' + address + ': ' + error.message);}
      }
      try { this.socket.setMulticastInterface(address); this.socket.send(message,this.options.discoveryPort,GROUP, () => {}); } catch (_) {}
    }
  }
  receive(message, remote) {
    if(message.length > 2048) return;
    try {
      const peer = JSON.parse(message);
      if(peer.protocol !== PROTOCOL || !validId(peer.id) || peer.id === this.id || typeof peer.name !== 'string' || peer.name.length > 100 || !validPort(peer.port)) return;
      const old = this.peers.get(peer.id);
      if(!old && this.peers.size >= 256) return;
      this.peers.set(peer.id,{id:peer.id,name:peer.name,port:peer.port,ip:remote.address,lastSeen:Date.now()});
      if(!old || old.ip !== remote.address || old.port !== peer.port || old.name !== peer.name) this.emit('peers-updated');
      if(!old) this.announce();
    } catch (_) {}
  }
  expire() {
    for(const [id,peer] of this.peers) if(Date.now()-peer.lastSeen > this.options.expiry) {
      this.peers.delete(id); this.emit('peers-updated');
    }
  }
  async json(ip,port,url) {
    if(net.isIP(ip) !== 4 || !validPort(port)) throw new Error('Use an IPv4 address and port');
    return new Promise((resolve,reject) => {
      const req = http.get({hostname:ip,port,path:url},res => {
        if(res.statusCode !== 200) {res.resume(); reject(new Error(`Peer returned HTTP ${res.statusCode}`)); return;}
        let body = ''; let bytes = 0;
        res.on('data',chunk => { bytes += chunk.length; if(bytes > 2*1024*1024) req.destroy(new Error('Peer response too large')); else body += chunk; });
        res.on('error',reject);
        res.on('end',() => {try { resolve(JSON.parse(body)); } catch (_) { reject(new Error('Invalid peer response')); }});
      });
      const timer = setTimeout(() => req.destroy(new Error('Peer timed out')),4000);
      this.requests.add(req);
      req.on('close',() => {clearTimeout(timer); this.requests.delete(req);}); req.on('error',reject);
    });
  }
  async addPeer({ip,port}) {
    const info = await this.json(ip,port,'/api/info');
    if(info.protocol !== PROTOCOL || !validId(info.id) || typeof info.name !== 'string' || info.name.length > 100 || info.id === this.id) throw new Error('Not another compatible AirDrop instance');
    this.peers.set(info.id,{id:info.id,name:info.name,ip,port,lastSeen:Date.now()}); this.emit('peers-updated');
  }
  peer({ip,port}) {
    const peer = [...this.peers.values()].find(p => p.ip === ip && p.port === port);
    if(!peer) throw new Error('Device is offline; reconnect and try again');
    return peer;
  }
  async fetchFiles(endpoint) {
    const peer = this.peer(endpoint);
    const files = await this.json(peer.ip,peer.port,'/api/files');
    if(!Array.isArray(files) || files.length > 10000 || files.some(f => !f || !validId(f.id) || typeof f.name !== 'string' || f.name.length > 255 || !Number.isSafeInteger(f.size) || f.size < 0 || !Number.isFinite(f.timestamp))) throw new Error('Invalid file list');
    peer.lastSeen = Date.now();
    return files.map(f => ({id:f.id,name:f.name,size:f.size,timestamp:f.timestamp,deviceName:peer.name}));
  }
  async share(filePath) {
    const stat = await fsp.stat(filePath);
    if(!stat.isFile()) throw new Error('Please share individual files; folders are not supported');
    const id = randomUUID(); const dest = path.join(this.directory,id);
    await fsp.copyFile(filePath,dest);
    const copied = await fsp.stat(dest);
    this.files.set(id,{id,name:path.basename(filePath),size:copied.size,timestamp:Date.now(),deviceName:this.name,path:dest});
    this.emit('files-updated'); return {fileId:id,name:path.basename(filePath)};
  }
  async remove(id) {
    const file = this.files.get(id); if(!file) return;
    await fsp.rm(file.path,{force:true}); this.files.delete(id); this.emit('files-updated');
  }
  async cleanup() { for(const file of this.files.values()) if(Date.now()-file.timestamp >= this.options.ttl) await this.remove(file.id); }
  async download(endpoint,downloads) {
    const files = await this.fetchFiles(endpoint);
    const file = files.find(f => f.id === endpoint.fileId);
    if(!file) throw new Error('File is no longer shared');
    await fsp.mkdir(downloads,{recursive:true});
    const name = safeName(file.name); const ext = path.extname(name); const base = path.basename(name,ext);
    let destination, handle;
    for(let i=0; !handle; i++) {
      destination = path.join(downloads,i ? `${base} (${i})${ext}` : name);
      try { handle = await fsp.open(destination,'wx'); } catch(e) { if(e.code !== 'EEXIST') throw e; }
    }
    const temp = path.join(downloads,`.airdrop-${randomUUID()}.part`);
    await handle.close();
    try {
      await new Promise((resolve,reject) => {
        const req = http.get({hostname:endpoint.ip,port:endpoint.port,path:`/api/download/${file.id}`},res => {
          if(res.statusCode !== 200) { res.resume(); reject(new Error(`Download failed (HTTP ${res.statusCode})`)); return; }
          let received = 0; let last = 0;
          res.on('data',chunk => {
            received += chunk.length;
            if(received > file.size) req.destroy(new Error('File size changed; retry the transfer'));
            if(Date.now()-last > 100) { last = Date.now(); this.emit('transfer-progress',{fileId:file.id,name:file.name,received,total:file.size}); }
          });
          pipeline(res,fs.createWriteStream(temp,{flags:'wx'})).then(() => {
            if(received !== file.size) reject(new Error('Incomplete download')); else resolve();
          },reject);
        });
        this.requests.add(req); req.on('close',() => this.requests.delete(req));
        req.setTimeout(15000,() => req.destroy(new Error('Transfer timed out'))); req.on('error',reject);
      });
      await fsp.rename(temp,destination);
      return destination;
    } catch(error) { await fsp.rm(temp,{force:true}); await fsp.rm(destination,{force:true}); throw error; }
  }
  async close() {
    this.closed = true; this.timers.forEach(clearInterval);
    for(const req of this.requests) req.destroy(new Error('App closed'));
    try { this.socket?.close(); } catch (_) {}
    if(this.server) { this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); }
    if(this.directory) await fsp.rm(this.directory,{recursive:true,force:true});
  }
}
module.exports = { Network, addresses, safeName, PROTOCOL };

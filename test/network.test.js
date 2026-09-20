const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Network, safeName, PROTOCOL } = require('../src/network');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(predicate) { const deadline = Date.now()+6000; while(!predicate()) {if(Date.now()>deadline) throw new Error('Discovery timed out'); await delay(50);} }
async function pair(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-test-'));
  const port = 46000 + Math.floor(Math.random()*10000);
  const a = new Network({name:'Sender',discoveryPort:port,heartbeat:150,expiry:700});
  const b = new Network({name:'Receiver',discoveryPort:port,heartbeat:150,expiry:700});
  t.after(async () => {await a.close(); await b.close(); await fs.rm(root,{recursive:true,force:true});});
  await a.start(); await b.start(); return {a,b,root};
}
test('automatic multicast discovery, transfer both ways, collision, zero bytes, removal and expiry',async t => {
  const {a,b,root} = await pair(t);
  await until(() => a.peers.has(b.id) && b.peers.has(a.id));
  assert.equal(a.peers.size,1); assert.equal(b.peers.size,1);
  const source = path.join(root,'hello.txt'); const contents = Buffer.alloc(2*1024*1024,37);
  await fs.writeFile(source,contents); const shared = await a.share(source);
  const endpoint = {...b.peers.get(a.id),fileId:shared.fileId};
  let progress = 0; b.on('transfer-progress',() => progress++);
  const saved = await b.download(endpoint,path.join(root,'received'));
  assert.deepEqual(await fs.readFile(saved),contents); assert.ok(progress > 0);
  const duplicate = await b.download(endpoint,path.join(root,'received'));
  assert.notEqual(saved,duplicate); assert.deepEqual(await fs.readFile(duplicate),contents);
  await fs.writeFile(source,''); const zero = await b.share(source);
  const back = await a.download({...a.peers.get(b.id),fileId:zero.fileId},path.join(root,'back'));
  assert.equal((await fs.stat(back)).size,0);
  await a.remove(shared.fileId);
  await assert.rejects(b.download(endpoint,path.join(root,'received')),/no longer shared/);
  assert.equal((await b.fetchFiles(endpoint)).length,0);
  a.files.set('expired',{id:'expired',timestamp:0,path:path.join(a.directory,'expired')});
  await a.cleanup(); assert.equal(a.files.size,0);
  await a.close(); await until(() => !b.peers.has(a.id));
});
test('manual identity handshake, malformed announcements, safe names and directory rejection',async t => {
  const {a,b,root} = await pair(t);
  await b.addPeer({ip:'127.0.0.1',port:a.port}); assert.ok(b.peers.has(a.id));
  const before = b.peers.size;
  for(const message of ['bad','{}',JSON.stringify({protocol:PROTOCOL,id:'evil',name:42,port:80})]) b.receive(Buffer.from(message),{address:'127.0.0.1'});
  assert.equal(b.peers.size,before);
  await assert.rejects(a.share(root),/individual files/);
  await assert.rejects(b.addPeer({ip:'garbage',port:80}),/IPv4/);
  assert.equal(safeName('../../outside.txt'),'outside.txt');
  assert.equal(safeName('C:\\outside.txt'),'outside.txt'); assert.equal(safeName('CON.txt'),'download');
});
test('HTTP errors and interrupted streams never become successful downloads',async t => {
  const {b,root} = await pair(t);
  let mode = '404';
  const server = http.createServer((req,res) => {
    if(req.url === '/api/files') {res.end(JSON.stringify([{id:'test',name:'../unsafe.txt',size:100,timestamp:Date.now()}]));return;}
    if(mode === '404') {res.writeHead(404).end('missing');return;}
    res.writeHead(200,{'Content-Length':100}); res.write('short'); setTimeout(() => res.destroy(),20);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = {id:'fake',ip:'127.0.0.1',port:server.address().port,fileId:'test'};
  b.peers.set('fake',{...endpoint,lastSeen:Date.now()});
  const downloads = path.join(root,'failed');
  await assert.rejects(b.download(endpoint,downloads),/404/);
  assert.deepEqual(await fs.readdir(downloads),[]);
  mode = 'broken'; await assert.rejects(b.download(endpoint,downloads));
  assert.deepEqual(await fs.readdir(downloads),[]);
});

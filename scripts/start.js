const { spawn } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const smoke = process.argv.includes('--smoke');
// Electron is the interactive app itself: Windows must be allowed to show it.
const child = spawn(require('electron'), smoke ? ['scripts/smoke.js'] : ['.', ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: false });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });

'use strict';
const { createOfficeServer: createServer } = require('./office-server.cjs');
const { execFile } = require('node:child_process');
const port = Number(process.env.OFFICE_PORT || 4180);
const url = `http://127.0.0.1:${port}/`;
const server = createServer();
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被使用，请打开 ${url} 或另设 OFFICE_PORT。` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`办公楼 3D: ${url}`);
  if (process.platform === 'win32' && !process.env.OFFICE_NO_BROWSER) execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => {});
});

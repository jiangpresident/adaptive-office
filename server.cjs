const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createLocalModel, ModelError } = require('./local-model.cjs');
const { createOpenAIModel } = require('./openai-model.cjs');
const root = path.join(__dirname, 'dist');
const MAX_REQUEST_BYTES = 524288;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function json(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function isLocalRequest(req) {
  const host = req.headers.host || '';
  if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try { const origin = new URL(req.headers.origin); return origin.protocol === 'http:' && origin.host.toLowerCase() === host.toLowerCase(); } catch { return false; }
}
async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new ModelError(415, 'CONTENT_TYPE', '请求必须使用 JSON。');
  if (Number(req.headers['content-length']) > MAX_REQUEST_BYTES) { req.resume(); throw new ModelError(413, 'BODY_TOO_LARGE', '对话资料过长，请清理部分历史后重试。'); }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) { failed = true; chunks.length = 0; reject(new ModelError(413, 'BODY_TOO_LARGE', '对话资料过长，请清理部分历史后重试。')); return; }
      chunks.push(chunk);
    });
    req.once('error', () => { if (!failed) { failed = true; reject(new ModelError(400, 'REQUEST_ABORTED', '请求已中断。')); } });
    req.once('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new ModelError(400, 'INVALID_JSON', '请求内容无法读取，请重试。')); }
    });
  });
}
function createServer({ localModel = process.env.WISHOUSE_PROVIDER === 'ollama' ? createLocalModel() : createOpenAIModel(), modelFactory = createLocalModel } = {}) {
 const models = new Map([[localModel.model, localModel]]);
 function selectModel(name) {
   if (localModel.provider === 'openai') {
     if (name && name !== 'openai' && name !== localModel.model) throw new ModelError(400, 'INVALID_MODEL', '当前已使用 GPT API，请刷新页面后重试。');
     return localModel;
   }
   if (!name || name === localModel.model) return localModel;
   if (!['qwen3.5:9b', 'qwen3.5:27b'].includes(name)) throw new ModelError(400, 'INVALID_MODEL', '请选择工具提供的本地模型。');
   if (!models.has(name)) models.set(name, modelFactory({model:name}));
   return models.get(name);
 }
 let busy = false;
 const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname.startsWith('/api/')) {
    if (!isLocalRequest(req)) { json(res, 403, { error: 'ORIGIN_FORBIDDEN', message: '请从本机愿居页面发起对话。' }); return; }
    if (pathname === '/api/health' && req.method === 'GET') { json(res, 200, { service: 'wishouse', model: localModel.model, provider: localModel.provider || 'ollama' }); return; }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    let ownsBusy = false,streaming=false,heartbeat;
    const send=event=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(event)+'\n');};
    try {
      if (pathname === '/api/model/status' && req.method === 'GET') { json(res, 200, await selectModel(new URL(req.url, 'http://localhost').searchParams.get('model')).status()); return; }
      if (pathname !== '/api/chat') { json(res, 404, { error: 'NOT_FOUND', message: '没有这个接口。' }); return; }
      if (req.method !== 'POST') { json(res, 405, { error: 'METHOD_NOT_ALLOWED', message: '请使用 POST 请求。' }); return; }
      if (busy) { json(res, 429, { error: 'MODEL_BUSY', message: '正在回复另一条消息，请稍后再试。' }); return; }
      busy = true; ownsBusy = true;
      const body = await readJson(req);
      const selectedModel = selectModel(body?.model);
      streaming=(req.headers.accept||'').includes('application/x-ndjson');
      if(streaming){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.flushHeaders();send({type:'progress',phase:'preparing',characters:0});}
      if(streaming) heartbeat=setInterval(()=>send({type:'heartbeat'}),15000);
      const result = await selectedModel.chat(body, { signal: controller.signal,...(streaming?{onProgress:progress=>send({type:'progress',...progress})}:{}) });
      if(streaming){send({type:'complete',result});res.end();}else json(res, 200, result);
    } catch (error) { const payload={error:error.code||'SERVER_ERROR',message:error instanceof ModelError?error.message:'本地服务发生错误，请重试。'};if(streaming){send({type:'error',...payload});res.end();}else json(res,error instanceof ModelError?error.status:500,payload); }
    finally { clearInterval(heartbeat); if (ownsBusy) busy = false; res.off('close', cancel); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(filename, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data);
  });
 });
 server.requestTimeout = 150000;
 return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
}
module.exports = { createServer, isLocalRequest, readJson };

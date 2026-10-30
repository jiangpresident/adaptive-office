'use strict';
const {createServer,isLocalRequest,readJson}=require('./server.cjs');
const {createOfficeAI}=require('./office-ai.cjs');
const {ModelError}=require('./local-model.cjs');
function createOfficeServer({officeAI=createOfficeAI(),...options}={}){
  const server=createServer(options),base=server.listeners('request')[0];server.removeListener('request',base);
  let busy=false;
  const json=(res,status,data)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  server.on('request',async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(!pathname.startsWith('/api/office/'))return base(req,res);
    if(!isLocalRequest(req))return json(res,403,{message:'请从本机办公楼页面发起请求。'});
    const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);let ownsBusy=false;
    try{
      if(pathname==='/api/office/status'&&req.method==='GET')return json(res,200,await officeAI.status());
      if(pathname!=='/api/office/chat')return json(res,404,{message:'没有这个办公接口。'});
      if(req.method!=='POST')return json(res,405,{message:'请使用 POST。'});
      if(busy)return json(res,429,{message:'正在处理另一条办公需求，请稍后重试。'});
      busy=true;ownsBusy=true;
      const body=await readJson(req),result=await officeAI.chat(body,{signal:controller.signal});json(res,200,result);
    }catch(e){json(res,e instanceof ModelError?e.status:500,{error:e.code||'OFFICE_ERROR',message:e instanceof ModelError?e.message:'办公需求服务发生错误，模型未修改。'});}
    finally{if(ownsBusy)busy=false;res.off('close',cancel);}
  });
  return server;
}
module.exports={createOfficeServer};

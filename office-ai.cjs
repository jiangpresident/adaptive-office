'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https');
const {Readable}=require('node:stream');
const {readConfig,createOpenAIModel}=require('./openai-model.cjs');
const {ModelError}=require('./local-model.cjs');
const M=require('./dist/office-model.js');
const schema={type:'object',additionalProperties:false,required:['kind','reply','reason','feedback'],properties:{
  kind:{type:'string',enum:['proposal','clarify','reply']},reply:{type:'string'},reason:{type:'string'},
  feedback:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:M.KEYS,properties:Object.fromEntries(M.KEYS.map(k=>[k,{type:'integer',minimum:-2,maximum:2}]))}]}
}};
function apiFetch(url,options){return new Promise((resolve,reject)=>{const req=https.request(url,{method:options.method,headers:options.headers,signal:options.signal},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode})));req.on('error',reject);req.end(options.body);});}
function prepare(raw){
  if(!raw||typeof raw.message!=='string'||!raw.message.trim()||raw.message.length>3000)throw new ModelError(400,'BAD_INPUT','请输入 1–3000 字的办公需求。');
  const language=raw.language??'zh';
  if(!['zh','en'].includes(language))throw new ModelError(400,'BAD_LANGUAGE','Unsupported UI language.');
  let state,context;
  try{state=M.validate(raw.state);context=M.aiContext(state,raw.context);}catch(e){throw new ModelError(400,'BAD_CONTEXT',e.message);}
  const history=Array.isArray(raw.history)?raw.history.slice(-12).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,3000)})):[];
  const multiplier=raw.multiplier??1;
  if(!Number.isInteger(multiplier)||multiplier<1||multiplier>100)throw new ModelError(400,'BAD_MULTIPLIER','需求倍率必须为 1–100 的整数。');
  const currentWeights=Object.fromEntries(M.KEYS.map(k=>[k,context.groups.reduce((n,g)=>n+g.demand[k],0)/context.groups.length]));
  return {state,context,message:raw.message.trim(),history,multiplier,currentWeights,language};
}
function instructions(language='zh'){const root=path.join(__dirname,'skills','adaptive-office-design');return fs.readFileSync(path.join(root,'SKILL.md'),'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'')+'\n\n'+fs.readFileSync(path.join(root,'references','ai-contract.md'),'utf8').replace('reply 和 reason 都用简短中文','reply 和 reason 使用当前界面指定的语言')+'\n\nResponse language: '+(language==='en'?'English':'Simplified Chinese')+'. Write both reply and reason exclusively in this language, regardless of the language of the request or conversation history. This overrides any earlier language preference. Keep JSON keys and enum values unchanged. Use natural human-readable program names, never expose internal field names.';}
function createOfficeAI({fetchImpl=apiFetch,config=readConfig}={}){
  return {
    status:()=>createOpenAIModel({config}).status(),
    async chat(raw,{signal}={}){
      const input=prepare(raw),{apiKey,model}=config();
      if(!apiKey)throw new ModelError(503,'API_KEY_MISSING','尚未配置 GPT API Key，请运行配置GPT.cmd。');
      const combined=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(120000)]);
      const messages=[...input.history,{role:'user',content:JSON.stringify({currentRequest:input.message,currentContext:input.context,currentWeights:input.currentWeights})}];
      let correction=null;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:combined,
            body:JSON.stringify({model,store:false,instructions:instructions(input.language),input:correction?[...messages,{role:'user',content:correction}]:messages,max_output_tokens:6000,text:{format:{type:'json_schema',name:'adaptive_office_proposal',strict:true,schema}}})});
          if(!response.ok){await response.body?.cancel();throw new ModelError(response.status===429?429:502,'GPT_API_ERROR',response.status===401?'GPT API Key 无效，请检查本机配置。':response.status===429?'GPT API 额度不足或请求过于频繁，请稍后重试。':`GPT API 请求失败（${response.status}），模型未修改。`);}
          const data=await response.json();
          if(data.status!=='completed')throw new ModelError(502,'INCOMPLETE','GPT 回复未完成，模型未修改，请重试。');
          const parts=(data.output||[]).flatMap(x=>x.content||[]);
          if(parts.some(p=>p.type==='refusal'))throw new ModelError(422,'REFUSAL','GPT 未能处理本次需求，请换一种描述。');
          let output;
          try{
            output=JSON.parse(parts.filter(p=>p.type==='output_text').map(p=>p.text).join(''));
            if(!['proposal','clarify','reply'].includes(output.kind)||typeof output.reply!=='string'||!output.reply.trim()||output.reply.length>5000||typeof output.reason!=='string'||output.reason.length>3000)throw Error('输出格式无效');
            if(/\b(?:floorId|userId|userName|scope|demandMultiplier|currentContext|currentWeights)\b/.test(output.reply+' '+output.reason))throw Error('reply 和 reason 不展示内部程序字段，使用当前界面语言的自然表达。');
            if(output.kind==='proposal')M.proposeFeedback(input.state,input.context,output.feedback,input.multiplier);
            else if(output.feedback!==null)throw Error('追问或普通回复不能携带修改');
          }catch(e){
            if(attempt===0){correction=`上次建议未通过程序校验：${e.message}。请依据原始 currentContext 重新生成；不要声称已经应用。无法满足时返回 clarify 或 reply，feedback 为 null。`;continue;}
            throw new ModelError(422,'INVALID_PROPOSAL','建议未通过模块数量或范围校验，未修改模型。请缩小需求或明确希望调整的用途。');
          }
          const preview=output.kind==='proposal'?M.proposeFeedback(input.state,input.context,output.feedback,input.multiplier):null;
          return {...output,weights:preview?.weights||null,currentWeights:preview?.currentWeights||null,multiplier:input.multiplier,model,provider:'openai'};
        }catch(e){if(e instanceof ModelError)throw e;if(combined.aborted)throw new ModelError(408,'CANCELLED','本次请求已停止或超时，模型未修改。');throw new ModelError(503,'API_UNAVAILABLE','GPT 连接失败，模型未修改。请检查网络后重试。');}
      }
    }
  };
}
module.exports={createOfficeAI,prepare,schema,instructions};

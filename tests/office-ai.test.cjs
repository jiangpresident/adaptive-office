'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../dist/office-model.js');
const {createOfficeAI,prepare,instructions}=require('../office-ai.cjs');
const {createOfficeServer}=require('../office-server.cjs');
function fixture(){const state=M.seed(),context={scope:'floor',floorIndex:0,userId:state.floors[0].users[0].id};const c=state.floors[0].cubes.find(c=>c.program==='garden');return {state,context,message:'花园少一点，会议空间多一点',history:[],transfer:{floorId:'L1',userId:c.userId,from:'garden',to:'collaborate',count:1}};}
const config=()=>({model:'test-model',apiKey:'test-key'});
const output=t=>({kind:'proposal',reply:'建议将一个花园转换为会议空间，等待确认。',reason:'回应协作需求。',feedback:{focus:0,collaborate:t.count===99999?99999:2,make:0,social:0,garden:-1}});
const response=o=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(o)}]}]}),{status:200});
test('one feedback is small, 20 copies are bounded, heterogeneous baselines and unrelated dimensions survive',()=>{
  const f=fixture(),selection={...f.context,scope:'building'},snapshot=JSON.stringify(f.state),feedback={focus:0,collaborate:0,make:0,social:0,garden:2};
  const one=M.proposeFeedback(f.state,selection,feedback,1),many=M.proposeFeedback(f.state,selection,feedback,20);
  f.state.floors.forEach((floor,i)=>floor.users.forEach((u,j)=>{
    const a=one.next.floors[i].users[j].demand,b=many.next.floors[i].users[j].demand;
    assert.ok(a.garden-u.demand.garden<=1);assert.ok(b.garden>=a.garden);assert.ok(b.garden-u.demand.garden<=16.667);
    assert.ok(Math.abs(b.garden-(u.demand.garden+(100-u.demand.garden)/6))<0.000001);
    for(const k of M.KEYS.filter(k=>k!=='garden'))assert.equal(a[k],u.demand[k]);
  }));
  assert.equal(JSON.stringify(f.state),snapshot);assert.deepEqual(M.proposeFeedback(f.state,selection,feedback,1),one);
  assert.equal(M.stats(many.next).cubes,M.stats(f.state).cubes);
  for(const n of [0,101,1.5])assert.throws(()=>M.proposeFeedback(f.state,selection,feedback,n));
  assert.throws(()=>M.proposeFeedback(f.state,selection,{...feedback,garden:85},1));
});
test('single-user feedback preserves outsiders and changes only the minimum required modules',()=>{
  const f=fixture(),selection={...f.context,scope:'user'},feedback={focus:0,collaborate:0,make:0,social:0,garden:1};
  const p=M.proposeFeedback(f.state,selection,feedback,1);
  assert.deepEqual(p.next.floors.slice(1),f.state.floors.slice(1));
  assert.deepEqual(p.next.floors[0].users.filter(u=>u.id!==selection.userId),f.state.floors[0].users.filter(u=>u.id!==selection.userId));
  assert.equal(p.changes.length,M.KEYS.reduce((n,k)=>n+Math.abs(p.after[k]-p.before[k]),0)/2);
  assert.ok(p.next.floors[0].users[0].demand.garden!==Math.round(p.next.floors[0].users[0].demand.garden));
});
test('API computes the copy count locally, ignores client replacement weights and validates feedback',async()=>{
  const f=fixture();let sent;
  const ai=createOfficeAI({config,fetchImpl:async(url,options)=>{sent=JSON.parse(JSON.parse(options.body).input.at(-1).content);return response({kind:'proposal',reply:'建议稍增花园需求，是否调整？',reason:'需要室外空间。',feedback:{focus:0,collaborate:0,make:0,social:0,garden:2}});}});
  const result=await ai.chat({...f,multiplier:100,weights:{garden:100}});
  assert.equal(sent.demandMultiplier,undefined);assert.equal(result.multiplier,100);
  assert.deepEqual(result.weights,M.proposeFeedback(f.state,f.context,result.feedback,100).weights);
});
test('demand amplification is repeatable, bounded and preview-only',()=>{
  const {state,context,transfer}=fixture(),snapshot=JSON.stringify(state);
  const one=M.scaleTransfers(state,context,[transfer],1),many=M.scaleTransfers(state,context,[transfer],20);
  assert.deepEqual(one.transfers,[transfer]);assert.equal(one.actual,1);
  const available=state.floors[0].cubes.filter(c=>c.userId===transfer.userId&&c.program==='garden').length;
  assert.equal(many.actual,Math.min(20,available));assert.equal(many.clipped,20-many.actual);
  M.proposeTransfers(state,context,many.transfers);assert.equal(JSON.stringify(state),snapshot);
  assert.deepEqual(M.scaleTransfers(state,context,[transfer],1),one);
  for(const n of [0,101,1.5,NaN])assert.throws(()=>M.scaleTransfers(state,context,[transfer],n));
});
test('amplification shares source stock without spending new conversions or escaping scope',()=>{
  const {state,context}=fixture(),u=state.floors[0].users[0],source=state.floors[0].cubes.filter(c=>c.userId===u.id&&c.program==='focus');
  assert.ok(source.length>=2);
  const ts=['collaborate','garden'].map(to=>({floorId:'L1',userId:u.id,from:'focus',to,count:1}));
  const scaled=M.scaleTransfers(state,context,ts,20),p=M.proposeTransfers(state,context,scaled.transfers);
  assert.equal(scaled.actual,source.length);assert.equal(p.after.focus,p.before.focus-source.length);
  assert.deepEqual(p.next.floors.slice(1),state.floors.slice(1));
});
test('AI transfer preserves IDs, ownership, quantities, geometry rules and other floors until confirmation',()=>{
  const {state,context,transfer}=fixture(),before=M.clone(state),p=M.proposeTransfers(state,context,[transfer]);
  assert.deepEqual(state,before);assert.equal(p.changes.length,1);assert.equal(p.after.garden,p.before.garden-1);assert.equal(p.after.collaborate,p.before.collaborate+1);
  assert.equal(M.stats(p.next).cubes,M.stats(state).cubes);
  state.floors.forEach((f,i)=>{if(i)assert.deepEqual(p.next.floors[i],f);f.cubes.forEach((c,j)=>{const n=p.next.floors[i].cubes[j];for(const key of ['id','userId','lane','rank','footprint'])assert.equal(n[key],c[key]);});});
  const changedUser=p.next.floors[0].users.find(u=>u.id===transfer.userId);assert.ok(changedUser.demand.collaborate>0);M.validate(p.next);
});
test('reject invalid IDs, scope, missing inventory, repeated consumption and negative/fractional counts',()=>{
  const {state,context,transfer}=fixture();
  for(const patch of [{count:0},{count:-1},{count:1.5},{count:1000},{from:'unknown'},{to:'garden'},{floorId:'L2'},{userId:'missing'}])assert.throws(()=>M.proposeTransfers(state,context,[{...transfer,...patch}]));
  const all=state.floors[0].cubes.filter(c=>c.userId===transfer.userId&&c.program==='garden').length;
  assert.throws(()=>M.proposeTransfers(state,context,[{...transfer,count:all},{...transfer,count:1}]));
  const wrongUser=state.floors[0].users.find(u=>u.id!==transfer.userId).id;
  assert.throws(()=>M.proposeTransfers(state,{...context,scope:'user',userId:wrongUser},[transfer]));
  const zero=M.proposal(state,{scope:'building',floorIndex:0,weights:{focus:100,collaborate:0,make:0,social:0,garden:0}}).next;
  assert.throws(()=>M.proposeTransfers(zero,context,[transfer]));
});
test('office API reads office skill, sends summaries only and never sends residential prompt',async()=>{
  const f=fixture(),before=M.clone(f.state);let sent;
  const ai=createOfficeAI({config,fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(options.body);return response(output(f.transfer));}});
  const result=await ai.chat(f);assert.equal(result.kind,'proposal');assert.deepEqual(f.state,before);
  assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(sent.text.format.name,'adaptive_office_proposal');
  assert.match(sent.instructions,/花园.*所属链/);assert.match(sent.instructions,/没有固定答案/);assert.doesNotMatch(sent.instructions,/单人小睡房/);
  const context=JSON.parse(sent.input.at(-1).content).currentContext;assert.equal(context.groups.length,2);assert.ok(context.groups.every(g=>!g.cubes));assert.equal(context.groups[0].floorId,'L1');
});
test('one semantic repair, then reject without changing model',async()=>{
  const f=fixture();let calls=0;
  const ai=createOfficeAI({config,fetchImpl:async()=>{calls++;return response(output({...f.transfer,count:99999}));}});
  await assert.rejects(ai.chat(f),e=>e.code==='INVALID_PROPOSAL');assert.equal(calls,2);
});
test('semantic repair can return clarification without a pending proposal',async()=>{
  const f=fixture();let calls=0;
  const ai=createOfficeAI({config,fetchImpl:async()=>++calls===1?response(output({...f.transfer,count:99999})):response({kind:'clarify',reply:'可否优先减少共享交流空间？',reason:'花园数量不足。',feedback:null})});
  assert.equal((await ai.chat(f)).kind,'clarify');assert.equal(calls,2);
});
test('ambiguous replies have no transfers; no-key, authentication, incomplete and cancel are explicit failures',async()=>{
  const f=fixture();
  const clarify=createOfficeAI({config,fetchImpl:async()=>response({kind:'clarify',reply:'你更在意噪音还是拥挤？',reason:'需求不明确。',feedback:null})});assert.deepEqual((await clarify.chat(f)).feedback,null);
  await assert.rejects(createOfficeAI({config:()=>({model:'test',apiKey:''})}).chat(f),e=>e.code==='API_KEY_MISSING');
  let calls=0;await assert.rejects(createOfficeAI({config,fetchImpl:async()=>{calls++;return new Response('{}',{status:401});}}).chat(f),e=>e.code==='GPT_API_ERROR');assert.equal(calls,1);
  await assert.rejects(createOfficeAI({config,fetchImpl:async()=>new Response(JSON.stringify({status:'incomplete'}))}).chat(f),e=>e.code==='INCOMPLETE');
  const controller=new AbortController();controller.abort();await assert.rejects(createOfficeAI({config,fetchImpl:async()=>{throw Error('aborted');}}).chat(f,{signal:controller.signal}),e=>e.code==='CANCELLED');
});
test('HTTP office routes enforce same-origin and methods, using separate office service',async()=>{
  const f=fixture(),officeAI={status:async()=>({ready:true,model:'mock'}),chat:async raw=>{prepare(raw);return output(f.transfer);}},localModel={model:'mock',provider:'openai'};
  const server=createOfficeServer({officeAI,localModel});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/api/office/status')).status,200);
    assert.equal((await fetch(base+'/api/office/chat')).status,405);
    assert.equal((await fetch(base+'/api/office/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify(f)})).status,403);
    const r=await fetch(base+'/api/office/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});assert.equal(r.status,200);assert.equal((await r.json()).kind,'proposal');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('UI language controls reply instructions independently of input and history',async()=>{
  assert.equal(prepare(fixture()).language,'zh');
  assert.throws(()=>prepare({...fixture(),language:'invalid'}));
  for(const language of ['en','zh']){
    let sent;
    const reply=language==='en'?'I suggest more garden space while preserving focus areas. Shall we preview this?':'建议适当增加花园空间，是否预览调整？';
    const reason=language==='en'?'A garden supports outdoor breaks.':'花园可提供户外休息空间。';
    const ai=createOfficeAI({config,fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return response({kind:'proposal',reply,reason,feedback:{focus:0,collaborate:0,make:0,social:0,garden:1}});}});
    const f=fixture(),before=JSON.stringify(f.state);
    const result=await ai.chat({...f,language,history:[{role:'assistant',content:language==='en'?'之前是中文':'Previous reply in English'}]});
    assert.equal(result.reply,reply);assert.equal(result.reason,reason);
    assert.ok(sent.instructions.includes('Response language: '+(language==='en'?'English':'Simplified Chinese')));
    assert.ok(!sent.instructions.includes('reply 和 reason 都用简短中文'));
    assert.equal(JSON.stringify(f.state),before);
  }
});

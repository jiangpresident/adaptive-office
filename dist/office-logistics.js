(function(root,factory){const api=factory(typeof module==='object'?require('./office-model.js'):root.OfficeModel);if(typeof module==='object')module.exports=api;else root.OfficeLogistics=api;})(typeof window==='undefined'?globalThis:window,function(M){
'use strict';
const clone=M.clone, lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t), same=(a,b)=>a.id===b.id&&a.program===b.program;
function stock(){return Array.from({length:320},(_,i)=>i<25?{program:M.KEYS[i%5]}:null);}
function normalizeStock(input){
 if(!Array.isArray(input)||input.length%5||input.length<25||input.some(c=>c!==null&&(!c||!M.KEYS.includes(c.program))))throw Error('仓库数据无效');
 const out=Array(320).fill(null);
 for(const k of M.KEYS){const items=input.filter(c=>c?.program===k);if(items.length>64)throw Error(`${M.PROGRAMS[k].label}现有库存 ${items.length} 个，超过64个仓位；未丢弃库存，请先调用多余模块。`);items.forEach((c,i)=>out[i*5+M.KEYS.indexOf(k)]=clone(c));}return out;
}
function checkCapacity(queue,inventory){const inv=clone(inventory),peak=Object.fromEntries(M.KEYS.map(k=>[k,inv.filter(c=>c?.program===k).length]));
 queue.forEach((q,index)=>{if(q.kind==='transfer')return;const slot=selectSlot(inv,q);if(slot<0){const k=q.cube.program,n=inv.filter(c=>c?.program===k).length;throw Error(q.kind==='recover'?`仓库放不下：第 ${index+1} 步回收${M.PROGRAMS[k].label}时需要 ${n+1} 个仓位，该列只有64个。请先调用部分模块，或减少本批回收。`:'备用模块总量不足；本次调度未开始。');}inv[slot]=q.kind==='recover'?{program:q.cube.program}:null;for(const k of M.KEYS)peak[k]=Math.max(peak[k],inv.filter(c=>c?.program===k).length);});return peak;
}
function selectSlot(inv,q){if(q.kind==='recover')return inv.findIndex((c,i)=>!c&&M.KEYS[i%5]===q.cube.program);const same=inv.findIndex(c=>c?.program===q.cube.program);return same<0?inv.findIndex(Boolean):same;}
function layout(state){const b=M.bounds(state);return {port:[0,2,b.minZ-8],left:b.minX-8,right:b.maxX+8,top:b.minZ-8,bottom:b.maxZ+8,height:b.maxY+6};}
function rack(slot,angle,site){const a=Math.PI+slot%5*2*Math.PI/5+angle;return [site.port[0]+12+6*Math.cos(a),-9-Math.min(15,Math.floor(slot/5))*5,site.port[2]+6*Math.sin(a)];}
function physical(state){return state.floors.flatMap((f,fi)=>M.displayGeometry(state,f).map(c=>({...clone(c),logicalId:c.id,id:`cell:${fi}:${c.lane}:${c.offset}`,fi})));}
const address=c=>`${c.fi}:${c.x}:${c.z}`;
function plan(before,after,inventory=stock()){
 M.validate(before);M.validate(after);
 const source=physical(before),target=physical(after),current=new Map(source.map(c=>[address(c),c])),wanted=new Map(target.map(c=>[address(c),c]));
 const removed=new Set(source.filter(c=>!wanted.has(address(c))||wanted.get(address(c)).program!==c.program).map(address));
 // Remove outer blockers and every roof terrace supported by a module being removed.
 let changed=true;while(changed){changed=false;for(const c of source){if(removed.has(address(c)))continue;
  const blocked=source.some(a=>removed.has(address(a))&&((a.fi===c.fi&&a.lane===c.lane&&a.offset<c.offset)||(c.automaticRoof&&a.fi+1===c.fi&&a.x===c.x&&a.z===c.z)));
  if(blocked){removed.add(address(c));changed=true;}
 }}
 const need=new Map(target.filter(c=>removed.has(address(c))||!current.has(address(c))||current.get(address(c)).program!==c.program).map(c=>[address(c),c]));
 const inv=clone(inventory),queue=[];
 const canRemove=c=>![...current.values()].some(o=>(o.fi===c.fi&&o.lane===c.lane&&o.offset>c.offset)||(o.automaticRoof&&o.fi===c.fi+1&&o.x===c.x&&o.z===c.z));
 const canPlace=c=>{if(current.has(address(c)))return false;if(c.automaticRoof){if([...need.values()].some(o=>o.fi===c.fi&&o.lane===c.lane&&o.offset<c.offset))return false;const below=current.get(`${c.fi-1}:${c.x}:${c.z}`);return !!below&&below.program!=='garden'&&!removed.has(address(below));}
  if([...current.values()].some(o=>o.fi===c.fi&&o.lane===c.lane&&o.offset>c.offset))return false;
  for(let off=0;off<c.offset;off+=4)if(![...current.values()].some(o=>o.fi===c.fi&&o.lane===c.lane&&o.offset===off&&!o.automaticRoof&&!removed.has(address(o))))return false;
  return true;};
 let guard=0;while(removed.size||need.size){if(++guard>10000)throw Error('无法安排此存档组合，请检查挂接与承托关系。');
  const available=[...current.values()].filter(c=>removed.has(address(c))&&canRemove(c));
  const places=[...need.values()].filter(canPlace);
  // Prefer direct same-purpose reuse. Nearest pickup first from the previous operation.
  const here=queue.at(-1)?.targetCube||queue.at(-1)?.cube;
  available.sort((a,b)=>here?(Math.abs(a.x-here.x)+Math.abs(a.z-here.z)+4*Math.abs(a.fi-here.fi))-(Math.abs(b.x-here.x)+Math.abs(b.z-here.z)+4*Math.abs(b.fi-here.fi)):b.fi-a.fi||b.offset-a.offset);
  let moved=false;
  for(const c of available){const d=places.filter(t=>t.program===c.program).sort((a,b)=>(Math.abs(a.x-c.x)+Math.abs(a.z-c.z)+4*Math.abs(a.fi-c.fi))-(Math.abs(b.x-c.x)+Math.abs(b.z-c.z)+4*Math.abs(b.fi-c.fi)))[0];if(!d)continue;
   queue.push({kind:'transfer',fi:c.fi,cube:c,targetFi:d.fi,targetCube:d});current.delete(address(c));removed.delete(address(c));current.set(address(d),d);need.delete(address(d));moved=true;break;}
  if(moved)continue;
  // Deploy available matching stock before filling the warehouse with recoveries.
  const d=places.find(c=>inv.some(v=>v?.program===c.program));
  if(d){const i=inv.findIndex(v=>v?.program===d.program);inv[i]=null;queue.push({kind:'deploy',fi:d.fi,cube:d});current.set(address(d),d);need.delete(address(d));continue;}
  const c=available.find(c=>inv.some((v,i)=>!v&&i%5===M.KEYS.indexOf(c.program)));
  if(c){const i=inv.findIndex((v,i)=>!v&&i%5===M.KEYS.indexOf(c.program));inv[i]={program:c.program};queue.push({kind:'recover',fi:c.fi,cube:c});current.delete(address(c));removed.delete(address(c));continue;}
  // Existing prototype supports explicit warehouse refitting when that purpose is depleted.
  if(places.length&&inv.some(Boolean)){const d=places[0],i=inv.findIndex(Boolean);queue.push({kind:'deploy',fi:d.fi,cube:d,refitFrom:inv[i].program});inv[i]=null;current.set(address(d),d);need.delete(address(d));continue;}
  const blocked=available[0];if(blocked)throw Error(`仓库放不下：${M.PROGRAMS[blocked.program].label}列已满（64/64），当前挂接顺序暂时无法先调用腾位。请减少本批回收或先调用该用途模块。`);throw Error(places.length?'备用模块总量不足，无法完成目标方案。':'挂接或承托依赖阻止了调度，当前方案未应用。');
 }
 return queue;
}
function route(c,site){const t=M.lanes()[c.lane].t,py=2,p=site.port;switch(c.side){case '北':return [p,[t,py,site.top]];case '西':return [p,[site.left,py,site.top],[site.left,py,t]];case '南':return [p,[site.left,py,site.top],[site.left,py,site.bottom],[t,py,site.bottom]];default:return [p,[site.right,py,site.top],[site.right,py,t]];}}
// Parametrize the safe exterior rectangle clockwise, then compare both arcs.
function shortestExteriorPath(from,to,site){
  const {left,right,top,bottom}=site,w=right-left,h=bottom-top,total=2*(w+h);
  const distance=p=>p[2]===top?p[0]-left:p[0]===right?w+p[2]-top:p[2]===bottom?w+h+right-p[0]:2*w+h+bottom-p[2];
  const point=d=>{d=((d%total)+total)%total;if(d<=w)return [left+d,from[1],top];if(d<=w+h)return [right,from[1],top+d-w];if(d<=2*w+h)return [right-(d-w-h),from[1],bottom];return [left,from[1],bottom-(d-2*w-h)];};
  const forward=(a,b)=>{if(b<a)b+=total;const corners=[0,w,w+h,2*w+h,total,total+w,total+w+h,total+2*w+h].filter(d=>d>a&&d<b);return [point(a),...corners.map(point),point(b)];};
  const a=distance(from),b=distance(to),clockwise=(b-a+total)%total;
  return clockwise<=total-clockwise?forward(a,b):forward(b,a).reverse();
}
function selectedQueue(before,after,jobs){
 const old=physical(before),next=physical(after),roofs=old.filter(c=>c.automaticRoof),newRoofs=next.filter(c=>c.automaticRoof);
 const remove=roofs.filter(c=>!newRoofs.some(t=>address(t)===address(c)&&t.supportId===c.supportId)||jobs.some(j=>j.cube.id===c.supportId||(j.fi===c.fi&&j.cube.lane===c.lane&&j.cube.offset<c.offset)));
 // Any outer automatic terrace blocking an affected terrace is temporarily removed too.
 let changed=true;while(changed){changed=false;for(const c of roofs)if(!remove.includes(c)&&remove.some(r=>r.fi===c.fi&&r.lane===c.lane&&r.offset<c.offset)){remove.push(c);changed=true;}}
 const kept=new Set(roofs.filter(c=>!remove.includes(c)).map(address));
 const add=newRoofs.filter(c=>!kept.has(address(c)));
 const real=(c,fi)=>({...clone(c),logicalId:c.id,id:`cell:${fi}:${c.lane}:${c.offset}`,fi});
 return [...remove.sort((a,b)=>b.fi-a.fi||b.offset-a.offset).map(c=>({kind:'recover',fi:c.fi,cube:c})),
 ...jobs.map(j=>({...j,cube:real(j.cube,j.fi),targetCube:real(j.targetCube,j.targetFi)})),
 ...add.sort((a,b)=>a.fi-b.fi||a.offset-b.offset).map(c=>({kind:'deploy',fi:c.fi,cube:c}))];
}
function interleaveSelected(before,queue,inventory){
 const current=new Map(physical(before).map(c=>[address(c),c])),remaining=[...queue],out=[],inv=clone(inventory);
 const removable=c=>current.has(address(c))&&![...current.values()].some(o=>(o.fi===c.fi&&o.lane===c.lane&&o.offset>c.offset)||(o.automaticRoof&&o.fi===c.fi+1&&o.x===c.x&&o.z===c.z));
 const pendingRemoval=c=>remaining.some(q=>q.kind!=='deploy'&&address(q.cube)===address(c));
 const placeable=c=>{if(current.has(address(c)))return false;
 if(c.automaticRoof){const below=current.get(`${c.fi-1}:${c.x}:${c.z}`);return !!below&&below.program!=='garden'&&!pendingRemoval(below)&&!remaining.some(q=>q.kind!=='recover'&&(q.targetCube||q.cube).fi===c.fi&&(q.targetCube||q.cube).lane===c.lane&&(q.targetCube||q.cube).offset<c.offset);}
 if([...current.values()].some(o=>o.fi===c.fi&&o.lane===c.lane&&o.offset>c.offset))return false;
 for(let off=0;off<c.offset;off+=4)if(![...current.values()].some(o=>o.fi===c.fi&&o.lane===c.lane&&o.offset===off&&!o.automaticRoof&&!pendingRemoval(o)))return false;return true;};
 while(remaining.length){const nextTransfer=remaining.find(q=>q.kind==='transfer');
 let q=remaining.find(q=>q.kind==='deploy'&&placeable(q.cube)&&inv.some(c=>c?.program===q.cube.program));
 if(!q&&nextTransfer&&removable(nextTransfer.cube)&&placeable(nextTransfer.targetCube))q=nextTransfer;
 if(!q)q=remaining.find(q=>q.kind==='recover'&&removable(q.cube)&&selectSlot(inv,q)>=0);
 if(!q)q=remaining.find(q=>q.kind==='deploy'&&placeable(q.cube)&&selectSlot(inv,q)>=0);
 if(!q){const blocked=remaining.find(q=>q.kind==='recover'&&removable(q.cube));if(blocked)throw Error(`仓库放不下：${M.PROGRAMS[blocked.cube.program].label}列已满（64/64），还需回收才能继续这批转移。请分批移动或先调用花园腾位。`);throw Error('当前批次受挂接与承托顺序限制，无法完成；请调整选择。');}
 remaining.splice(remaining.indexOf(q),1);out.push(q);
 if(q.kind!=='deploy')current.delete(address(q.cube));if(q.kind!=='recover'){const c=q.targetCube||q.cube;current.set(address(c),c);}
 if(q.kind!=='transfer'){const i=selectSlot(inv,q);inv[i]=q.kind==='recover'?{program:q.cube.program}:null;}
 }return out;
}
function create(before,after,inventory=stock(),angle=0,selected=null){
 inventory=normalizeStock(inventory);
 const queue=selected?interleaveSelected(before,selectedQueue(before,after,selected),inventory):plan(before,after,inventory);
 const peak=checkCapacity(queue,inventory);
 const scene=clone(before);scene.roofGardens=false;
 scene.floors=Array.from({length:Math.max(before.floors.length,after.floors.length)},(_,fi)=>({...clone(before.floors[fi]||after.floors[fi]),cubes:physical(before).filter(c=>c.fi===fi)}));
 const a=layout(before),b=layout(after),site={...a,left:Math.min(a.left,b.left),right:Math.max(a.right,b.right),top:Math.min(a.top,b.top),bottom:Math.max(a.bottom,b.bottom),height:Math.max(a.height,b.height)};site.port=[0,2,site.top];
 return {peak,scene,after:clone(after),stock:inventory,angle,site,queue,index:0,job:null,done:!queue.length,gantry:null,lifter:null,total:physical(before).length+inventory.filter(Boolean).length,completed:0};
}
function begin(s){if(s.index>=s.queue.length){s.done=true;return;}s.stock=normalizeStock(s.stock);const q=s.queue[s.index];if(q.kind==='transfer'){beginTransfer(s,q);return;}const p=s.site.port,target=[q.cube.x+2,q.fi*s.scene.floorHeight+2,q.cube.z+2];let slot=selectSlot(s.stock,q);if(slot<0)throw Error('没有可用库位或备用模块');const delta=-(slot%5)*2*Math.PI/5-s.angle,to=s.angle+Math.atan2(Math.sin(delta),Math.cos(delta)),r=rack(slot,to,s.site),pickup=[p[0],r[1],p[2]],base=[p[0],-84,p[2]],path=route(q.cube,s.site),low=path.at(-1),high=[low[0],target[1],low[2]],steps=[];let pose={cube:q.kind==='deploy'?r:target,gantry:p,lifter:base},frames=[clone(pose)];const add=(name,patch={},event=null,duration=1)=>{pose={...pose,...patch};frames.push(clone(pose));steps.push({name,event,duration});};
add('储存桶旋转对准仓位',{},null,1.5);
let program=q.cube.program;
if(q.kind==='deploy'){program=s.stock[slot].program;const refit=program!==q.cube.program;s.stock[slot]=null;add('固定升降台对准储存深度',{lifter:pickup});add('从储存桶水平抽取',{cube:pickup});if(refit)add('升降台上换装为'+M.PROGRAMS[q.cube.program].label,{},'refit',1.5);add('经唯一出口提升到地面',{cube:p,lifter:p},null,1.5);add('四立柱桁架抓取 / 双机交接');add('地下升降台下降让位',{lifter:base});for(const v of path.slice(1))add('地面桁架绕楼对准挂接列',{cube:v,gantry:v});add('提升至目标楼层',{cube:high,gantry:high},null,1.5);add('沿核心筒法向送至最外端',{cube:target});add('挂接锁定 / 释放模块',{},'deliver');add('桁架空载下降',{gantry:low});for(const v of path.slice(0,-1).reverse())add('桁架沿楼外返回出口',{gantry:v});}
else{for(const v of path.slice(1))add('地面桁架绕楼对准挂接列',{gantry:v});add('提升至目标楼层',{gantry:high},null,1.5);add('最外端解锁',{},'detach');add('沿核心筒法向抽出模块',{cube:high});add('下降至地面',{cube:low,gantry:low},null,1.5);for(const v of path.slice(0,-1).reverse())add('地面桁架沿楼外返回出口',{cube:v,gantry:v});add('地下升降台上升接货',{lifter:p});add('双机交接');add('固定井道下降至空仓层',{cube:pickup,lifter:pickup},null,1.5);add(slot>=80?'存入隐藏备用区':'水平推入储存桶',{cube:r},'deliver');add('地下升降台竖向复位',{lifter:base});}
s.job={...q,slot,from:s.angle,to,frames,steps,stage:0,t:0,program,carried:q.kind==='deploy',delivered:false};s.gantry=p;s.lifter=base;}
function tick(s,dt){if(s.done)return;if(!s.job)begin(s);if(s.done)return;const j=s.job;j.t+=dt;while(j.t>=j.steps[j.stage].duration){j.t-=j.steps[j.stage].duration;const step=j.steps[j.stage];if(j.stage===0)s.angle=j.to;if(step.event==='refit')j.program=j.cube.program;if(step.event==='detach'){s.scene.floors[j.fi].cubes=s.scene.floors[j.fi].cubes.filter(c=>c.id!==j.cube.id);j.carried=true;}if(step.event==='deliver'){if(j.kind==='recover')s.stock[j.slot]={program:j.program};else {const fi=j.targetFi??j.fi,c=clone(j.targetCube||j.cube);s.scene.floors[fi].cubes.push(c);}j.carried=false;j.delivered=true;}j.stage++;if(j.stage===j.steps.length){const last=j.frames.at(-1);s.gantry=clone(last.gantry);s.lifter=clone(last.lifter);s.cargo=clone(last.cube);s.index++;s.completed++;s.stock=normalizeStock(s.stock);s.job=null;if(s.index===s.queue.length)s.done=true;return;}}
const t=j.t/j.steps[j.stage].duration,u=t*t*(3-2*t);if(j.stage===0)s.angle=j.from+(j.to-j.from)*u;s.gantry=lerp(j.frames[j.stage].gantry,j.frames[j.stage+1].gantry,u);s.lifter=lerp(j.frames[j.stage].lifter,j.frames[j.stage+1].lifter,u);s.cargo=j.kind==='deploy'&&j.stage===0?rack(j.slot,s.angle,s.site):lerp(j.frames[j.stage].cube,j.frames[j.stage+1].cube,u);
}
function validate(s){if(s.stock.some((c,i)=>c&&c.program!==M.KEYS[i%5]))throw Error('储存列用途不匹配');const count=s.scene.floors.reduce((n,f)=>n+f.cubes.length,0)+s.stock.filter(Boolean).length+(s.job?.carried?1:0);if(count!==s.total)throw Error('模块总量不守恒');if(s.lifter&&(s.lifter[0]!==s.site.port[0]||s.lifter[2]!==s.site.port[2]))throw Error('地下升降台横移');return true;}
function manual(state,inventory,kind,fi,lane,program){M.validate(state);if(!['deploy','recover'].includes(kind)||!M.KEYS.includes(program)||!Number.isInteger(fi)||!state.floors[fi]||!Number.isInteger(lane)||!M.lanes()[lane])throw Error('请选择有效用途、楼层和挂接列');if((state.disabledSides||[]).includes(M.lanes()[lane].side))throw Error('此方向已禁止外挂');const chain=M.geometry(state,state.floors[fi]).filter(c=>c.lane===lane).sort((a,b)=>a.offset-b.offset),outer=chain.at(-1),next=clone(state),floor=next.floors[fi];
if(kind==='deploy'){if(chain.length>=state.projectionDepth)throw Error('此挂接列已满，请先回收最外端模块');if(outer?.program==='garden'&&program!=='garden')throw Error('最外端是花园，请先回收花园后再调用室内模块');if(!inventory.some(c=>c?.program===program))throw Error(M.PROGRAMS[program].label+'库存不足，手动调用不自动换装');const ids=new Set(state.floors.flatMap(f=>f.cubes.map(c=>c.id)));let i=1;while(ids.has(floor.id+'-M'+i))i++;floor.cubes.push({id:floor.id+'-M'+i,lane,rank:chain.length,footprint:'4x4',userId:floor.users[0].id,program});}
else{if(!outer)throw Error('此挂接列没有模块');if(outer.program!==program)throw Error('最外端是'+M.PROGRAMS[outer.program].label+'，请先选择该用途再回收');if(floor.cubes.length===1)throw Error('楼层至少保留一个模块');if(!inventory.some((c,i)=>!c&&M.KEYS[i%5]===program))throw Error(M.PROGRAMS[program].label+'专用储存列已满');floor.cubes=floor.cubes.filter(c=>c.id!==outer.id);floor.cubes.filter(c=>c.lane===lane).sort((a,b)=>a.rank-b.rank).forEach((c,i)=>c.rank=i);}
next.revision++;M.validate(next);return {next,manual:true,changes:[],moved:[]};}
function deployMany(state,inventory,program,targets){
 if(!M.KEYS.includes(program)||!Array.isArray(targets)||!targets.length)throw Error('请选择用途和目的地。');
 if(inventory.filter(c=>c?.program===program).length<targets.length)throw Error('所选用途库存不足。');
 let next=clone(state);const unique=new Set();
 for(const t of [...targets].sort((a,b)=>a.pos-b.pos||a.fi-b.fi||a.lane-b.lane)){
  const key=`${t.fi}:${t.lane}:${t.pos}`;if(unique.has(key))throw Error('目的地重复。');unique.add(key);
  if(!next.floors[t.fi]||M.geometry(next,next.floors[t.fi]).filter(c=>c.lane===t.lane).length!==t.pos)throw Error('目的地必须从现有挂接列末端连续选择。');
  next=manual(next,inventory,'deploy',t.fi,t.lane,program).next;
 }
 return {next,manual:true,changes:[],moved:[],deployedCount:targets.length};
}
function recoverMany(state,sources){
 M.validate(state);if(!Array.isArray(sources)||!sources.length)throw Error('请先选择要存入仓库的模块。');
 const next=clone(state),ids=new Set();
 for(const item of sources){const floor=state.floors[item.fi],cube=floor?.cubes.find(c=>c.id===item.id);if(!cube||cube.lane!==item.lane||ids.has(item.id))throw Error('模块选择已失效，请重新选择。');ids.add(item.id);}
 for(const item of sources){const floor=state.floors[item.fi],chain=M.geometry(state,floor).filter(c=>c.lane===item.lane).sort((a,b)=>a.offset-b.offset),i=chain.findIndex(c=>c.id===item.id);if(chain.slice(i+1).some(c=>!ids.has(c.id)))throw Error('请同时选中该模块外侧的所有模块。');}
 next.floors.forEach(f=>{f.cubes=f.cubes.filter(c=>!ids.has(c.id));if(!f.cubes.length)throw Error('每层至少保留一个模块。');});next.revision++;M.validate(next);
 return {next,manual:true,changes:[],moved:[],storedCount:sources.length};
}
function transfer(state,fi,lane,targetFi,targetLane){M.validate(state);const axes=M.lanes();if(!Number.isInteger(fi)||!Number.isInteger(targetFi)||!state.floors[fi]||!state.floors[targetFi]||!Number.isInteger(lane)||!Number.isInteger(targetLane)||!axes[lane]||!axes[targetLane])throw Error('请选择有效楼层和挂接列');if(fi===targetFi&&lane===targetLane)throw Error('目标位置与来源相同');if((state.disabledSides||[]).includes(axes[targetLane].side))throw Error('目标方向已禁止外挂');const chain=M.geometry(state,state.floors[fi]).filter(c=>c.lane===lane).sort((a,b)=>a.offset-b.offset),cube=chain.at(-1),dest=M.geometry(state,state.floors[targetFi]).filter(c=>c.lane===targetLane).sort((a,b)=>a.offset-b.offset);if(!cube)throw Error('来源列没有模块');if(fi!==targetFi&&state.floors[fi].cubes.length===1)throw Error('来源楼层至少保留一个模块');if(dest.length>=state.projectionDepth)throw Error('目标挂接列已满');if(cube.program!=='garden'&&dest.at(-1)?.program==='garden')throw Error('目标末端是花园，不能在花园外接室内模块');const next=clone(state),source=next.floors[fi],target=next.floors[targetFi],moving=source.cubes.find(c=>c.id===cube.id);source.cubes=source.cubes.filter(c=>c.id!==cube.id);source.cubes.filter(c=>c.lane===lane).sort((a,b)=>a.rank-b.rank).forEach((c,i)=>c.rank=i);moving.lane=targetLane;moving.rank=dest.length;if(fi!==targetFi)moving.userId=target.users[0].id;target.cubes.push(moving);next.revision++;M.validate(next);const targetCube=M.geometry(next,target).find(c=>c.id===cube.id);return {next,manual:true,changes:[],moved:[cube.id],transfer:{kind:'transfer',fi,cube,targetFi,targetCube}};}
function transferMany(state,sources,targets){
  M.validate(state);
  if(!sources.length||sources.length!==targets.length)throw Error('请选择相同数量的模块和目标位置');
  const key=v=>v.fi+':'+v.lane,slot=v=>key(v)+':'+v.pos,ids=new Set(sources.map(v=>v.id));
  if(ids.size!==sources.length||new Set(targets.map(slot)).size!==targets.length)throw Error('不能重复选择模块或位置');
  const chain=(building,fi,lane)=>M.geometry(building,building.floors[fi]).filter(c=>c.lane===lane).sort((a,b)=>a.offset-b.offset);
  for(const v of sources){if(!state.floors[v.fi]||!M.lanes()[v.lane])throw Error('来源位置无效');const list=chain(state,v.fi,v.lane),i=list.findIndex(c=>c.id===v.id);if(i<0||list.slice(i+1).some(c=>!ids.has(c.id)))throw Error('选择内侧模块时，外侧模块必须全部一起选中');}
  for(const t of targets){if(!state.floors[t.fi]||!M.lanes()[t.lane]||!Number.isInteger(t.pos)||t.pos>=state.projectionDepth)throw Error('目标位置无效');if(sources.some(v=>key(t)===key(v)))throw Error('目标不能与本批来源共用同一挂接列');const n=chain(state,t.fi,t.lane).length;if(t.pos<n)throw Error('目标位置已有模块');for(let pos=n;pos<t.pos;pos++)if(!targets.some(v=>slot(v)===slot({...t,pos})))throw Error('目标空位必须从内向外连续选择');}
  // Search legal next moves; only currently exposed sources and next empty slots qualify.
  const failed=new Set(),site=layout(state);let visited=0;
  const stop=(cube,fi)=>{const p=route(cube,site).at(-1);return [p[0],fi*state.floorHeight+2,p[2]];};
  const travel=(from,to)=>{const path=shortestExteriorPath(from,to,site);return path.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-path[i][0],p[2]-path[i][2]),0)+Math.abs(from[1]-to[1]);};
  function schedule(building,remaining,empty,jobs,current){if(!remaining.length)return {next:building,jobs};if(++visited>20000)throw Error('本批组合较多，请减少模块后分批调度');const signature=remaining.map(v=>v.id).sort().join(',')+'|'+empty.map(slot).sort().join(',')+'|'+targets.map(t=>chain(building,t.fi,t.lane).map(c=>c.program).join(',')).join(';');if(failed.has(signature))return null;
    const exposed=remaining.filter(v=>chain(building,v.fi,v.lane).at(-1)?.id===v.id),ready=empty.filter(t=>chain(building,t.fi,t.lane).length===t.pos);
    const candidates=[];for(const v of exposed)for(const t of ready){try{const p=transfer(building,v.fi,v.lane,t.fi,t.lane);const pickup=stop(p.transfer.cube,v.fi),delivery=stop(p.transfer.targetCube,t.fi);candidates.push({v,t,p,delivery,emptyDistance:travel(current,pickup),loadedDistance:travel(pickup,delivery)});}catch{}}
    // Prefer the nearest legal pickup, then a nearby delivery; backtrack only for feasibility.
    candidates.sort((a,b)=>a.emptyDistance-b.emptyDistance||a.loadedDistance-b.loadedDistance||a.v.fi-b.v.fi||a.v.lane-b.v.lane||a.t.fi-b.t.fi||a.t.lane-b.t.lane);
    for(const {v,t,p,delivery} of candidates){const result=schedule(p.next,remaining.filter(x=>x.id!==v.id),empty.filter(x=>slot(x)!==slot(t)),[...jobs,p.transfer],delivery);if(result)return result;}failed.add(signature);return null;
  }
  const result=schedule(clone(state),sources,targets,[],site.port);if(!result)throw Error('这些位置无法完成外先内后搬运，请调整目标；花园必须在室内模块外侧');
  return {next:result.next,manual:true,changes:[],moved:sources.map(v=>v.id),transfer:result.jobs};
}
function beginTransfer(s,q){const p=s.site.port,base=[p[0],-84,p[2]],origin=[q.cube.x+2,q.fi*s.scene.floorHeight+2,q.cube.z+2],target=[q.targetCube.x+2,q.targetFi*s.scene.floorHeight+2,q.targetCube.z+2],a=route(q.cube,s.site),b=route(q.targetCube,s.site),low=a.at(-1),high=[low[0],origin[1],low[2]],end=b.at(-1),endHigh=[end[0],target[1],end[2]];const start=s.gantry||p,continuing=s.index>0&&s.queue[s.index-1].kind==='transfer';let pose={cube:origin,gantry:start,lifter:base};const frames=[clone(pose)],steps=[];const add=(name,patch={},event=null)=>{pose={...pose,...patch};frames.push(clone(pose));steps.push({name,event,duration:1.3});};for(const v of shortestExteriorPath(start,[high[0],start[1],high[2]],s.site).slice(1))if(v.some((n,i)=>n!==pose.gantry[i]))add(continuing?'空载就近前往下一个来源列':'桁架就近前往来源列',{gantry:v});if(start[1]!==high[1])add(continuing?'调整至下一个来源楼层':'提升至来源楼层',{gantry:high});add('来源末端解锁',{},'detach');add('抽出原模块',{cube:high});if(q.cube.side===q.targetCube.side){const lateral=[end[0],origin[1],end[2]];if(high[0]!==lateral[0]||high[2]!==lateral[2])add('同侧直接横移至目标列',{cube:lateral,gantry:lateral});if(origin[1]!==target[1])add('同侧调整至目标楼层',{cube:endHigh,gantry:endHigh});}else{for(const v of shortestExteriorPath(high,[end[0],origin[1],end[2]],s.site).slice(1))add('沿楼外最短路线转移',{cube:v,gantry:v});if(origin[1]!==target[1])add('调整至目标楼层',{cube:endHigh,gantry:endHigh});}add('送至目标列最外端',{cube:target});add('目标挂接锁定',{},'deliver');if(s.index===s.queue.length-1||s.queue[s.index+1].kind!=='transfer'){add('全部搬运完成，桁架空载下降',{gantry:end});for(const v of shortestExteriorPath(end,p,s.site).slice(1))add('全部搬运完成，返回停泊点',{gantry:v});}s.job={...q,slot:-1,from:s.angle,to:s.angle,frames,steps,stage:0,t:0,program:q.cube.program,carried:false,delivered:false};s.gantry=start;s.lifter=base;}
function columns(inventory,job=null){return M.KEYS.map((program,col)=>({program,col,count:inventory.filter((c,i)=>c&&i%5===col).length,visible:inventory.slice(0,80).filter((c,i)=>c&&i%5===col).length,hidden:inventory.slice(80).filter((c,i)=>c&&i%5===col).length,active:!!job&&!job.delivered&&job.slot%5===col,kind:job?.kind,target:job?.cube.program}));}
return {deployMany,recoverMany,checkCapacity,interleaveSelected,physical,selectedQueue,transferMany,shortestExteriorPath,transfer,manual,columns,stock,normalizeStock,layout,rack,plan,create,tick,validate};
});

(function(root,factory){const api=factory(typeof module==='object'?require('./engine'):root.WishEngine,typeof module==='object'?require('./building'):root.WishBuilding,typeof module==='object'?require('./interior'):root.WishInterior,typeof module==='object'?require('./circulation'):root.WishCirculation);if(typeof module==='object')module.exports=api;else root.WishModuleEdits=api;})(typeof globalThis!=='undefined'?globalThis:this,function(E,B,I,P){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x)),types=Object.keys(E.TYPES).concat('custom');
  const counts=rooms=>Object.fromEntries(types.map(type=>[type,rooms.filter(r=>r.type===type).length]));
  function signature(rooms){const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;const text=JSON.stringify(rooms.map(r=>canonical({id:r.id,type:r.type,x:r.x,y:r.y,w:r.w,h:r.h,rotation:r.rotation,...(r.functionPlan?{functionPlan:r.functionPlan}:{})}))),hash=[2166136261,5381];for(const c of text){hash[0]=Math.imul(hash[0]^c.charCodeAt(0),16777619);hash[1]=Math.imul(hash[1],33)^c.charCodeAt(0);}return rooms.length+':'+hash.map(n=>(n>>>0).toString(16)).join(':');}
  const targetMetrics=types.concat('bedrooms','cooking');
  function cleanTargets(targets){
    if(targets===undefined)return [];
    if(!Array.isArray(targets)||targets.length>12)return null;
    const seen=new Set(),result=[];
    for(const t of targets){if(!t||!targetMetrics.includes(t.metric)||!Number.isInteger(t.value)||t.value<0||t.value>40||t.metric==='cooking'&&t.value>1||seen.has(t.metric))return null;seen.add(t.metric);result.push({metric:t.metric,value:t.value});}
    return result;
  }
  // Capacity describes the module's bed program, not clearance certification.
  function sleepingCapacity(rooms){return rooms.reduce((sum,r)=>sum+(r.functionPlan?(r.functionPlan.furniture||[]).reduce((n,f)=>n+({singleBed:1,doubleBed:2,largeBed:2}[f.profile]||0),0):r.type==='bedroom'?2:r.type==='bedroomSingle'?1:0),0);}
  function occupancyReview(rooms,transaction,occupancy){
    const before=sleepingCapacity(rooms),after=transaction?sleepingCapacity(project(rooms,transaction)):before;
    const residents=occupancy?.residentCount,guests=occupancy?.guestCount;
    const needed=Number.isInteger(residents)&&Number.isInteger(guests)?residents+guests:null;
    return {before,after,needed,shortfall:needed===null?null:Math.max(0,needed-after)};
  }
  function auditTargets(rooms,targets){
    const inventory=counts(rooms),cooking=rooms.some(r=>r.functionPlan?(r.functionPlan.furniture||[]).some(f=>f.profile==='stove'):['kitchen','livingLarge'].includes(r.type));
    return (targets||[]).map(t=>{const actual=t.metric==='bedrooms'?rooms.filter(E.isBedroom).length:t.metric==='cooking'?Number(cooking):inventory[t.metric];const label=t.metric==='bedrooms'?'睡房总数':t.metric==='cooking'?'厨房功能':t.metric==='custom'?'草图模块':E.TYPES[t.metric].name;return {...t,actual,met:actual===t.value,label};});
  }
  function replacement(room,op){
    if(op.type==='custom')return E.createCustomRoom(op.functionPlan,room.id,room.x,room.y,room.rotation);
    const shape=E.TYPES[op.type],turned=room.rotation%180!==0;
    return {id:room.id,type:op.type,x:room.x,y:room.y,w:turned?shape.h:shape.w,h:turned?shape.w:shape.h,rotation:room.rotation};
  }
  function project(rooms,tx){
    const result=rooms.filter(r=>!tx.operations.some(o=>o.action==='remove'&&o.roomId===r.id)).map(r=>{const op=tx.operations.find(o=>o.action==='replace'&&o.roomId===r.id);return op?replacement(r,op):r;});
    for(const op of tx.operations.filter(o=>o.action==='add'))for(let i=0;i<op.count;i++)result.push(op.type==='custom'?E.createCustomRoom(op.functionPlan,'project-'+result.length):{id:'project-'+result.length,type:op.type});
    return result;
  }
  function clean(transaction){
    if(!transaction||typeof transaction.baseSignature!=='string'||!Array.isArray(transaction.operations)||!transaction.operations.length||transaction.operations.length>40)return null;
    const targets=cleanTargets(transaction.targets);if(!targets)return null;
    const operations=[];
    for(const op of transaction.operations){
      if(!['add','remove','replace'].includes(op.action)||!types.includes(op.type)||!Number.isInteger(op.count)||op.count<1||op.count>8||op.action!=='add'&&(typeof op.roomId!=='string'||op.count!==1))return null;
      const next={action:op.action,type:op.type,count:op.count,roomId:op.action!=='add'?op.roomId:null,anchorId:typeof op.anchorId==='string'?op.anchorId:null};
      if(op.action!=='remove'&&op.type==='custom'){try{next.functionPlan=E.createCustomRoom(op.functionPlan,'validate').functionPlan;}catch(_){return null;}}
      operations.push(next);
    }
    return {baseSignature:transaction.baseSignature,operations,...(targets.length?{targets}:{})};
  }
  function compile(raw,rooms,library,targets,options={}){
    if(!Array.isArray(raw)||!raw.length||raw.length>12)throw Error('请给出明确的模块增减操作。');
    const operations=[],removed=new Set();
    for(const op of raw){
      if(!op||!['add','remove','replace'].includes(op.action)||!types.includes(op.type)||!Number.isInteger(op.count)||op.count<1||op.count>8)throw Error('模块类型或增减数量无效，未修改平面。');
      if(op.action==='replace'){
        const target=rooms.find(r=>r.id===op.roomId),plan=library.find(p=>p.id===op.sketchId);
        if(op.count!==1||!target||removed.has(target.id)||op.anchorId)throw Error('替换需要指定当前平面中一个真实房间的编号，不能重复替换同一房间。');
        if(op.type==='custom'&&(!plan?.parentType||plan.parentType!==(target.functionPlan?.parentType||target.type)))throw Error('子类型必须属于被替换房间的原模块。');
        if(op.type===target.type&&!target.functionPlan)continue; // Treat a redundant keep instruction as no change, never as an executed edit.
        if(op.type!=='custom'&&op.sketchId)throw Error('标准模块替换不需要草图编号，请指定目标标准模块。');
        removed.add(target.id);operations.push({action:'replace',type:op.type,count:1,roomId:target.id,anchorId:null,...(op.type==='custom'?{functionPlan:clone(plan)}:{})});continue;
      }
      if(op.anchorId&&!rooms.some(r=>r.id===op.anchorId))throw Error('指定的相邻模块已经不存在，请重新选择连接位置。');
      if(op.action==='remove'){
        const matches=rooms.filter(r=>!removed.has(r.id)&&r.type===op.type&&(!op.roomId||r.id===op.roomId)&&(!op.sketchId||r.functionPlan?.id===op.sketchId));
        if(matches.length!==op.count)throw Error('移除目标不明确或数量不符：有多个同类模块时，请指定模块或明确全部移除。');
        matches.forEach(r=>{removed.add(r.id);operations.push({action:'remove',type:r.type,count:1,roomId:r.id,anchorId:null});});
      }else{
        if(op.roomId)throw Error('新增模块不能使用现有房间编号作为删除目标。');
        const plan=op.type==='custom'?library.find(p=>p.id===op.sketchId):null;
        if(op.type==='custom'&&!plan)throw Error('没有找到指定草图；请从当前草图库选择，或先生成该功能草图。');
        operations.push({action:'add',type:op.type,count:op.count,roomId:null,anchorId:op.anchorId||null,...(plan?{functionPlan:clone(plan)}:{})});
      }
    }
    if(!operations.length)throw Error('这些操作没有改变数量、尺寸或用途，不能把无变化操作当成完成。请核对本轮全部需求。');
    if(operations.some(op=>op.anchorId&&operations.some(o=>o.action==='remove'&&o.roomId===op.anchorId)))throw Error('新增模块不能连接到本次要删除的模块。');
    const compiled=clean({baseSignature:signature(rooms),operations,targets});if(!compiled)throw Error('模块操作、需求目标或草图数据不完整。');const missed=auditTargets(project(rooms,compiled),compiled.targets).filter(t=>!t.met);if(missed.length&&!options.reviewTargetChanges)throw Error('方案与需求不同：'+missed.map(t=>t.label+'原目标 '+t.value+'，方案结果 '+t.actual).join('；')+'。请先确认修改方案。');return compiled;
  }
  // Ground a complete semantic target set in one minimal standard conversion.
  // This never invents a target or touches custom snapshots: both the decrease
  // and increase must be explicit, and the candidate must satisfy EVERY target.
  function completeSingleReplacement(rooms,targets){
    const cleaned=cleanTargets(targets);if(!cleaned?.length)return null;
    const checks=auditTargets(rooms,cleaned),excess=checks.filter(t=>t.actual>t.value),deficits=checks.filter(t=>t.actual<t.value);
    if(!excess.length||!deficits.length)return null;
    const destinations=[...new Set(deficits.flatMap(t=>t.metric==='cooking'?['kitchen']:Object.hasOwn(E.TYPES,t.metric)?[t.metric]:[]))];
    const candidates=[];
    for(const room of rooms){
      if(room.functionPlan||!Object.hasOwn(E.TYPES,room.type)||!excess.some(t=>t.metric===room.type||t.metric==='bedrooms'&&E.isBedroom(room)))continue;
      for(const type of destinations){
        if(type===room.type)continue;
        try{
          const tx=compile([{action:'replace',type,count:1,roomId:room.id,sketchId:null,anchorId:null}],rooms,[],cleaned);
          const adjacentLiving=rooms.some(r=>r.type.startsWith('living')&&E.touches(r,room));
          candidates.push({tx,score:type==='kitchen'&&!adjacentLiving?1:0});
        }catch(_){/* A partial target match is never an acceptable repair. */}
      }
    }
    return candidates.sort((a,b)=>a.score-b.score)[0]?.tx||null;
  }
  // Only the caller's synchronous core-alignment step may refresh a proposal.
  // A stale request or any change beyond position must keep the conflict guard.
  function rebaseAfterAlignment(transaction,before,after){
    const tx=clean(transaction);if(!tx||tx.baseSignature!==signature(before)||before.length!==after.length)return null;
    const stable=r=>({...r,x:0,y:0});
    if(signature(before.map(stable))!==signature(after.map(stable)))return null;
    return {...tx,baseSignature:signature(after)};
  }
  function targetChanges(rooms,transaction){return auditTargets(project(rooms,transaction),transaction.targets).filter(t=>!t.met);}
  function summary(transaction){return transaction.operations.map(op=>`${op.action==='add'?'新增':op.action==='replace'?'替换为':'移除'} ${op.count} 个${op.type==='custom'?op.functionPlan?.title||'草图模块':E.TYPES[op.type].name}`).join('；');}
  // Reflow actual instances, never reconstruct from household defaults. Only x/y
  // may change; room identity, orientation and all non-target snapshots survive.
  function reassemble(targets,originals,side,placement,constraints,optimize=false){
    if(!targets.length)return [[]];
    const oldById=new Map(originals.map(r=>[r.id,r])),limits=B.boundary(placement),obstacles=B.siteObstacles(placement);
    const daylightPenalty=rs=>{const living=rs.find(r=>r.type.startsWith('living'));if(!living)return 0;const walls=[...rs.filter(r=>r.id!==living.id&&r.type!=='garden'),...obstacles];let open=0;
      for(const side of ['north','east','south','west']){const horizontal=['north','south'].includes(side),start=horizontal?living.x:living.y,end=start+(horizontal?living.w:living.h),cuts=walls.filter(r=>side==='north'?r.y+r.h===living.y:side==='south'?r.y===living.y+living.h:side==='west'?r.x+r.w===living.x:r.x===living.x+living.w).map(r=>[Math.max(start,horizontal?r.x:r.y),Math.min(end,horizontal?r.x+r.w:r.y+r.h)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);let last=start;for(const [a,b] of cuts){open=Math.max(open,a-last);last=Math.max(last,b);}open=Math.max(open,end-last);}
      return open<3?500:0;};
    const score=rs=>{let moved=0,distance=0;for(const r of rs){const old=oldById.get(r.id);if(old){const d=Math.abs(r.x-old.x)+Math.abs(r.y-old.y);moved+=!!d;distance+=d;}}const b=E.getBounds(rs);return optimize?E.circulationScore(rs)+daylightPenalty(rs)+distance*.001:moved*100000+distance*100+E.circulationScore(rs);};
    const allowed=(r,rs)=>Math.abs(r.x)<=E.MAX_COORD&&Math.abs(r.y)<=E.MAX_COORD&&!obstacles.some(a=>E.intersects(a,r))&&!B.entryViolation(r,placement)&&!rs.some(a=>E.intersects(a,r))&&!E.entranceConflicts(rs.concat(r),side).length;
    const valid=rs=>{const v=E.validateLayout(rs);return !v.overlaps.length&&!v.disconnected.length&&!E.enclosedVoids(rs).length&&rs.every(r=>allowed(r,rs.filter(a=>a.id!==r.id)))&&E.evaluateRequirements(rs,constraints).every(c=>c.status==='met'||c.id==='compactFootprint');};
    const candidates=[];
    if(valid(targets)){if(!optimize)return [clone(targets)];candidates.push(clone(targets));}
    const root=targets.find(r=>r.type.startsWith('living'))||targets[0],rest=targets.filter(r=>r.id!==root.id);
    const orders=[rest,[...rest].sort((a,b)=>b.w*b.h-a.w*a.h),[...rest].sort((a,b)=>(Math.abs(a.x-root.x)+Math.abs(a.y-root.y))-(Math.abs(b.x-root.x)+Math.abs(b.y-root.y)))];
    if(optimize){const priority=r=>r.type==='custom'?0:r.type==='kitchen'?1:E.isBedroom(r)?2:3;orders.push([...rest].sort((a,b)=>priority(a)-priority(b)),[...rest].reverse());}
    const orderSeen=new Set();let attempts=0;
    for(const order of orders){
      const orderKey=order.map(r=>r.id).join('|');if(orderSeen.has(orderKey))continue;orderSeen.add(orderKey);
      let beam=[[]];
      for(const shape of [root,...order]){
        const next=[],seen=new Set();
        for(const rs of beam){
          const positions=[{x:shape.x,y:shape.y}];
          if(!optimize&&!rs.length&&shape.type.startsWith('living')&&limits){
            if(['north','south'].includes(limits.coreSide)){
              const y=limits.coreSide==='north'?limits.minY:limits.maxY-shape.h;
              positions.push({x:shape.x,y});for(let x=limits.minX;x<=limits.maxX-shape.w;x+=5)positions.push({x,y});
            }else{
              const x=limits.coreSide==='west'?limits.minX:limits.maxX-shape.w;
              positions.push({x,y:shape.y});for(let y=limits.minY;y<=limits.maxY-shape.h;y+=5)positions.push({x,y});
            }
          }
          for(const a of rs){
            const xs=new Set([a.x,a.x+a.w-shape.w,shape.x]),ys=new Set([a.y,a.y+a.h-shape.h,shape.y]);
            for(let x=a.x-shape.w+5;x<=a.x+a.w-5;x+=5)xs.add(x);
            for(let y=a.y-shape.h+5;y<=a.y+a.h-5;y+=5)ys.add(y);
            for(const x of xs)positions.push({x,y:a.y-shape.h},{x,y:a.y+a.h});
            for(const y of ys)positions.push({x:a.x-shape.w,y},{x:a.x+a.w,y});
          }
          for(const xy of positions){
            if(++attempts>100000)break;
            const r={...shape,...xy};if(!allowed(r,rs))continue;
            const placed=rs.concat(r);if(rs.length&&!rs.some(a=>E.touches(a,r)))continue;
            const key=placed.map(a=>a.id+':'+a.x+','+a.y).join('|');if(seen.has(key))continue;seen.add(key);
            next.push({rooms:placed,score:score(placed)});
          }
        }
        beam=next.sort((a,b)=>a.score-b.score).slice(0,512).map(n=>n.rooms).filter(rs=>rs.length!==targets.length||valid(rs)).slice(0,optimize?48:24);if(!beam.length)break;
      }
      candidates.push(...beam.filter(rs=>rs.length===targets.length));
    }
    const seen=new Set();return candidates.sort((a,b)=>score(a)-score(b)).map(rs=>targets.map(r=>clone(rs.find(n=>n.id===r.id)))).filter(rs=>{const key=signature(rs);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,optimize?24:16);
  }
  function layoutKey(rooms){
    const root=rooms.find(r=>r.type.startsWith('living'))||{x:0,y:0};
    return JSON.stringify(rooms.map(r=>JSON.stringify([r.type,r.x-root.x,r.y-root.y,r.w,r.h,r.rotation,r.functionPlan||null])).sort());
  }
  function cleanRoutes(input){
    if(!Array.isArray(input)||!input.length||input.length>8)return null;
    const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
    if(input.some(r=>!r||!id(r.roomId)||!Array.isArray(r.avoidIds)||r.avoidIds.length>40||r.avoidIds.some(x=>!id(x))||r.directTo!==null&&!id(r.directTo)))return null;
    return input.map(r=>({roomId:r.roomId,avoidIds:[...new Set(r.avoidIds)],directTo:r.directTo}));
  }
  function routesMet(rooms,details,travel,routes){return routes.every(r=>{
    const route=travel.routes.find(t=>t.roomId===r.roomId);
    return route?.reachable&&!r.avoidIds.some(id=>route.via.includes(id))&&(!r.directTo||details.byRoom[r.roomId]?.doors.some(d=>d.to===r.directTo));
  });}
  function optimizeLayout(rooms,prefs,constraints,conversation,placement,options={}){
    if(!rooms.length)return {ok:false,reason:'先生成平面，再优化动线。'};
    const routes=options.routes?cleanRoutes(options.routes):null;
    if(options.routes&&(!routes||routes.some(r=>!rooms.some(a=>a.id===r.roomId)||r.avoidIds.concat(r.directTo?[r.directTo]:[]).some(id=>id===r.roomId||!rooms.some(a=>a.id===id)))))return {ok:false,reason:'动线要求引用的房间不存在或目标无效，请重新核对当前平面。'};
    const side=B.entranceSide(conversation,prefs.entranceSide),obstacles=B.siteObstacles(placement);
    const assess=rs=>{const details=I.analyze(rs,prefs,{obstacles}),travel=P.measure(rs,details);const living=rs.find(r=>r.type.startsWith('living')),light=details.byRoom[living?.id];const daylight=!!light?.windows.length||!!light?.doors.some(d=>d.glazed);return {rooms:rs,travel,daylight,routeOK:!routes||routesMet(rs,details,travel,routes),score:travel.score+E.circulationScore(rs)+(!daylight?1000:0)};};
    const before=assess(rooms),candidates=reassemble(rooms,rooms,side,placement,constraints,true).slice(0,24).map(assess).filter(c=>c.routeOK).sort((a,b)=>a.score-b.score);
    const best=candidates[0];if(!best)return {ok:false,reason:routes?'当前候选未找到满足指定通行路线的布局，原平面已保留；可继续调整房间连接。':'未找到满足核心筒、邻居和无中空规则的重排方案。'};
    // No unsupported promise of a global shortest solution; never accept a worse shortlist result.
    let chosen=!before.routeOK||best.score<before.score-0.01?best:before,alternativeCount=0,reused=false;
    if(options.randomize){
      const currentKey=layoutKey(rooms),seen=new Set([currentKey]),recent=new Set(options.recent||[]);
      const eligible=candidates.filter(c=>{
        const key=layoutKey(c.rooms);if(seen.has(key))return false;seen.add(key);
        return c.score<=best.score+Math.max(12,Math.abs(best.score)*.15)&&c.travel.reachable>=before.travel.reachable&&c.travel.privatePasses<=before.travel.privatePasses&&(!before.daylight||c.daylight);
      });
      const fresh=eligible.filter(c=>!recent.has(layoutKey(c.rooms))),pool=fresh.length?fresh:eligible;
      alternativeCount=pool.length;reused=!fresh.length&&!!pool.length;
      if(!pool.length)return {ok:true,rooms:clone(rooms),before:before.travel,after:before.travel,movedIds:[],alternativeCount:0};
      const rng=options.rng||Math.random,draw=Math.max(0,Math.min(.999999,Number(rng())||0));
      chosen=pool[Math.floor(draw*pool.length)];
    }
    return {ok:true,alternativeCount,reused,rooms:clone(chosen.rooms),before:before.travel,after:chosen.travel,movedIds:chosen.rooms.filter(r=>{const old=rooms.find(a=>a.id===r.id);return old.x!==r.x||old.y!==r.y;}).map(r=>r.id)};
  }
  function execute(rooms,transaction,prefs,constraints,conversation,placement,options={}){
    const fail=reason=>({ok:false,reason,rooms:null});
    const tx=clean(transaction);if(!tx)return fail('模块操作数据不完整，请重新提出要求。');
    if(signature(rooms)!==tx.baseSignature)return fail('画布已在这份提案之后改变，请基于当前平面重新提出操作，避免误删或重复添加。');
    const removed=new Set(tx.operations.filter(o=>o.action==='remove').map(o=>o.roomId));
    if(removed.size!==tx.operations.filter(o=>o.action==='remove').length||tx.operations.some(o=>o.action==='remove'&&!rooms.some(r=>r.id===o.roomId&&r.type===o.type)))return fail('待移除模块已经改变，未执行任何操作。');
    const replacements=tx.operations.filter(o=>o.action==='replace'),replaced=new Set(replacements.map(o=>o.roomId));
    if(replaced.size!==replacements.length||replacements.some(o=>removed.has(o.roomId)))return fail('同一房间不能重复替换或同时删除。');
    const retained=rooms.filter(r=>!removed.has(r.id)).map(room=>{
      const op=replacements.find(o=>o.roomId===room.id);return op?replacement(room,op):room;
    }),additions=tx.operations.flatMap(o=>o.action==='add'?Array(o.count).fill(o):[]);
    if(replacements.some(o=>{const old=rooms.find(r=>r.id===o.roomId),next=retained.find(r=>r.id===o.roomId);return !old||o.type==='custom'&&o.functionPlan.parentType!==(old.functionPlan?.parentType||old.type);}))return fail('替换目标已改变，原平面保留。');
    if(retained.length+additions.length>40)return fail('执行后将超过40个模块，请减少新增数量。');
    const side=B.entranceSide(conversation,prefs.entranceSide),obstacles=B.siteObstacles(placement),baseline=I.analyze(rooms,prefs,{obstacles}),nextConstraints={...constraints};
    // The first lounge establishes the core-facing entrance, regardless of
    // the order in which the model listed additions. Existing rooms stay put.
    if(!retained.some(r=>r.type.startsWith('living')))additions.sort((a,b)=>Number(b.type.startsWith('living'))-Number(a.type.startsWith('living')));
    const expected=counts(retained);additions.forEach(o=>expected[o.functionPlan?E.createCustomRoom(o.functionPlan,'count').type:o.type]++);
    if(!expected.garden)nextConstraints.gardenCourtyard=false;
    if(!expected.balcony)nextConstraints.balconyBedroom=false;
    const resizedIds=replacements.filter(o=>{const old=rooms.find(r=>r.id===o.roomId),next=retained.find(r=>r.id===o.roomId);return old.w!==next.w||old.h!==next.h;}).map(o=>o.roomId);
    let beam=resizedIds.length?reassemble(retained,rooms,side,placement,nextConstraints):[clone(retained)];
    if(!beam.length)return fail('新尺寸暂未找到满足核心筒、邻居禁区、入口、连接及无中空规则的重新拼接方案。原平面保留，可调整目标尺寸后重试。');
    const reasons=new Set();let fallback=null;
    for(let n=0;n<additions.length;n++){
      const op=additions[n],next=[],seen=new Set();
      let id='chat-'+tx.baseSignature.replace(/:/g,'-')+'-'+n;while(rooms.some(r=>r.id===id))id+='x';
      const original=op.type==='custom'?E.createCustomRoom(op.functionPlan,id):{id,type:op.type,x:0,y:0,w:E.TYPES[op.type].w,h:E.TYPES[op.type].h,rotation:0};
      const shapes=[original];if(original.w!==original.h||op.type==='custom')shapes.push({...original,w:original.h,h:original.w,rotation:90});
      for(const rs of beam){
        const anchors=rs.filter(r=>op.anchorId?r.id===op.anchorId:op.type.startsWith('living')?!['garden','balcony'].includes(r.type):op.type==='garden'?r.type==='garden'||r.type.startsWith('living'):op.type==='balcony'&&nextConstraints.balconyBedroom?E.isBedroom(r):!['garden','balcony'].includes(r.type)&&!E.isBedroom(r));
        for(const shape of shapes){
          const positions=[];
          if(!rs.length||shape.type.startsWith('living')&&!rs.some(r=>r.type.startsWith('living'))){
            const edge=B.boundary(placement);
            if(edge){
              const horizontal=['north','south'].includes(edge.coreSide),start=horizontal?edge.minX:edge.minY,end=(horizontal?edge.maxX-shape.w:edge.maxY-shape.h);
              const along=[Math.round((start+end)/2)];for(let at=start;at<=end;at+=5)along.push(at);along.push(end);
              for(const at of along)if(at>=start&&at<=end)positions.push(horizontal?{x:at,y:edge.coreSide==='north'?edge.minY:edge.maxY-shape.h}:{x:edge.coreSide==='west'?edge.minX:edge.maxX-shape.w,y:at});
            }else if(!rs.length)positions.push({x:0,y:0});
          }
          for(const a of anchors){
            for(let x=a.x-shape.w+5;x<=a.x+a.w-5;x+=5)positions.push({x,y:a.y-shape.h},{x,y:a.y+a.h});
            for(let y=a.y-shape.h+5;y<=a.y+a.h-5;y+=5)positions.push({x:a.x-shape.w,y},{x:a.x+a.w,y});
          }
          for(const xy of positions){const r={...shape,...xy},key=signature(rs)+JSON.stringify([r.x,r.y,r.w,r.rotation]);if(seen.has(key))continue;seen.add(key);
            if(Math.abs(r.x)>E.MAX_COORD||Math.abs(r.y)>E.MAX_COORD||rs.some(a=>E.intersects(a,r))||B.violation(r,placement)||B.entryViolation(r,placement)||E.entranceConflicts(rs.concat(r),side).length)continue;
            if(n===additions.length-1&&E.enclosedVoids(rs.concat(r)).length)continue;
            next.push(rs.concat(r));
          }
        }
      }
      beam=next.sort((a,b)=>E.circulationScore(a)-E.circulationScore(b)).slice(0,64);
      if(!beam.length)return fail(`${E.getDefinition(original).name}没有找到不重叠、能连接且不围出中空的位置。未移动其他模块；可指定另一处连接位置后重试。`);
    }
    beam=beam.slice(0,12).map(rs=>({rs,score:P.measure(rs,I.analyze(rs,prefs,{obstacles})).score})).sort((a,b)=>a.score-b.score).map(item=>item.rs).concat(beam.slice(12));
    for(const result of beam){
      if(E.enclosedVoids(result).length){reasons.add('这次增减会留下内部中空，需要先调整相邻模块；没有擅自移动其他模块');continue;}
      const valid=E.validateLayout(result);
      if(valid.overlaps.length||valid.disconnected.length){reasons.add('移除后会使保留模块断开，或新增模块发生重叠');continue;}
      if(result.some(r=>B.violation(r,placement)||B.entryViolation(r,placement))||E.entranceConflicts(result,side).length){reasons.add('模块占用了入口、核心筒或邻居范围');continue;}
      const warnings=[];
      const checks=E.evaluateRequirements(result,nextConstraints);
      warnings.push(...checks.filter(c=>c.id==='compactFootprint'&&c.status!=='met').map(c=>'已优先安排紧凑位置，'+c.detail));
      const failed=checks.filter(c=>c.status!=='met'&&c.id!=='compactFootprint');if(failed.length){failed.forEach(c=>reasons.add(c.detail));continue;}
      const detail=I.analyze(result,prefs,{obstacles});let blocked=false;
      const candidateReasons=new Set();
      const newRooms=result.filter(r=>!rooms.some(old=>old.id===r.id));
      additions.forEach((op,n)=>{if(op.anchorId&&!detail.byRoom[op.anchorId]?.doors.some(d=>d.to===newRooms[n]?.id)){blocked=true;candidateReasons.add('新增模块还没有门直接连接指定房间');}});
      for(const r of result){const a=detail.byRoom[r.id],old=baseline.byRoom[r.id];
        const issues=a.feasibility.issues.filter(i=>!old||!old.feasibility.issues.some(j=>i.code===j.code&&i.label===j.label));
        if(a.entryConnected===false||issues.length||!old&&a.feasibility.status!=='fit'){blocked=true;candidateReasons.add(E.getDefinition(r).name+'：'+(issues[0]?.message||'门或家具的使用通路未通过检查'));}
      }
      if(nextConstraints.balconyBedroom&&result.filter(r=>r.type==='balcony').some(b=>!result.some(r=>E.isBedroom(r)&&detail.byRoom[r.id].doors.some(d=>d.to===b.id)))){blocked=true;candidateReasons.add('阳台尚未与睡房直接连通');}
      if(nextConstraints.gardenCourtyard){const living=result.find(r=>r.type.startsWith('living')),gardens=new Set(result.filter(r=>r.type==='garden').map(r=>r.id)),seen=new Set(),queue=(detail.byRoom[living?.id]?.doors||[]).filter(d=>gardens.has(d.to)).map(d=>d.to);while(queue.length){const id=queue.pop();if(seen.has(id))continue;seen.add(id);detail.byRoom[id].doors.filter(d=>gardens.has(d.to)).forEach(d=>queue.push(d.to));}if(seen.size!==gardens.size){blocked=true;candidateReasons.add('花园无法从客厅直接进入全部区域');}}
      warnings.push(...candidateReasons);
      if(blocked){if(placement?.softInterior){if(resizedIds.length)return finish(result,warnings);if(!fallback||warnings.length<fallback.warnings.length)fallback={result,warnings};}else candidateReasons.forEach(w=>reasons.add(w));continue;}
      return finish(result,warnings);
    }
    if(fallback)return finish(fallback.result,fallback.warnings);
    return fail([...reasons].slice(0,2).join('；')+'。没有改动任何模块。');
    function finish(result,warnings){
      const stable=r=>{const value=clone(r);if(resizedIds.length){delete value.x;delete value.y;}return JSON.stringify(value);};
      if(retained.some(r=>!result.some(n=>n.id===r.id)||stable(r)!==stable(result.find(n=>n.id===r.id)))||JSON.stringify(counts(result))!==JSON.stringify(expected))return fail('增减核对失败，未替换原平面。');
      const targetChecks=auditTargets(result,tx.targets);if(targetChecks.some(t=>!t.met)&&!options.acceptTargetChanges)return fail('方案与原需求不同，请先确认修改方案。');
      const movedIds=result.filter(r=>{const old=rooms.find(n=>n.id===r.id);return old&&(r.x!==old.x||r.y!==old.y);}).map(r=>r.id);
      const reassembled=!!resizedIds.length&&!!movedIds.length;
      const living=result.find(r=>r.type.startsWith('living'));
      const nextPrefs={...prefs,...(living?{living:({livingLarge:'large',livingSmall:'small',livingMedium:'medium'}[living.type])}:{}),bedrooms:Math.max(1,Math.min(4,expected.bedroom+expected.bedroomSingle)),singleBedrooms:Math.min(4,expected.bedroomSingle),outdoor:expected.balcony?expected.garden?'both':'balcony':expected.garden?'garden':'none',gardenCount:Math.max(1,expected.garden),balconyCount:Math.max(1,expected.balcony)};
      return {ok:true,rooms:result,prefs:nextPrefs,constraints:nextConstraints,inventory:expected,targetChecks,reassembled,movedIds,resizedIds,removedIds:[...removed],replacedIds:[...replaced],addedIds:result.filter(r=>!rooms.some(old=>old.id===r.id)).map(r=>r.id),warnings,receipt:summary(tx)+(targetChecks.length?'。需求结果核对：'+targetChecks.map(t=>!t.met?'已按你的确认调整'+t.label+'：原目标 '+t.value+' → 本次 '+t.actual:t.metric==='cooking'?(t.actual?'已含厨房功能':'不配置厨房'):t.label+' '+t.actual+' / '+t.value).join('；'):'')+'。已核对数量；'+(reassembled?'新尺寸已重新拼接，移动了 '+movedIds.length+' 个模块（'+result.filter(r=>movedIds.includes(r.id)).map(r=>E.getDefinition(r).name+' / '+r.id).join('、')+'）；未指定修改的模块保留尺寸、旋转和草图内容。':'其余模块的位置、尺寸、旋转和草图内容保持不变。')+(placement?.softInterior?' 已核对核心筒、邻居禁区和无中空规则。':'')+(warnings.length?' 待调整：'+warnings.slice(0,3).map(w=>w.replace(/[。；]+$/,'')).join('；')+'。本次操作已执行，未自动缩小家具。':'')};
    }
  }
  return Object.freeze({cleanRoutes,routesMet,layoutKey,optimizeLayout,compile,clean,signature,counts,summary,targetChanges,sleepingCapacity,occupancyReview,execute,rebaseAfterAlignment,auditTargets,completeSingleReplacement});
});

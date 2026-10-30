(function(root,factory){
  const api=factory(typeof module==='object'?require('./engine'):root.WishEngine,typeof module==='object'?require('./building'):root.WishBuilding,typeof module==='object'?require('./interior'):root.WishInterior);
  if(typeof module==='object')module.exports=api;else root.WishPlanSync=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(E,B,I){
  'use strict';
  function audit(rooms,prefs,constraints={},conversation={},placement=null,interior=null,previous=[],inventory=null){
    const checks=[], add=(id,ok,detail)=>checks.push({id,status:ok?'met':'unmet',detail});
    const count=type=>rooms.filter(r=>r.type===type).length;
    const desiredBedrooms=inventory?inventory.bedroom+inventory.bedroomSingle:prefs.bedrooms,desiredSingle=inventory?inventory.bedroomSingle:prefs.singleBedrooms||0;
    add('bedrooms',rooms.filter(E.isBedroom).length===desiredBedrooms,`睡房：要求 ${desiredBedrooms} 间，实际 ${rooms.filter(E.isBedroom).length} 间`);
    add('singleBedrooms',count('bedroomSingle')===desiredSingle,`其中单人小睡房：要求 ${desiredSingle} 间，实际 ${count('bedroomSingle')} 间`);
    const living={small:'livingSmall',medium:'livingMedium',large:'livingLarge'}[prefs.living];
    if(!inventory)add('living',count(living)===1&&rooms.filter(r=>r.type.startsWith('living')).length===1,`客厅：${{small:'3×3 小客厅',medium:'3×4.5 多用客厅',large:'6×6 大客厅'}[prefs.living]}`);
    const wantedOutdoor=inventory||E.outdoorCounts(prefs),expected=[wantedOutdoor.balcony,wantedOutdoor.garden];
    add('outdoor',count('balcony')===expected[0]&&count('garden')===expected[1],`户外：阳台 ${count('balcony')}/${expected[0]} 个、花园 ${count('garden')}/${expected[1]} 个（实际/要求）`);
    if(inventory){for(const type of Object.keys(inventory))add('module-'+type,count(type)===inventory[type],`${type==='custom'?'草图模块':E.TYPES[type].name}：实际 ${count(type)} / 要求 ${inventory[type]}`);}else add('kitchen',prefs.living==='large'?count('livingLarge')===1:count('kitchen')>=1,'厨房：核对独立或客厅内集成厨房');
    add('no-voids',E.enclosedVoids(rooms).length===0,'模块拼合后内部没有中空');
    const valid=E.validateLayout(rooms);
    add('connected',!valid.overlaps.length&&!valid.disconnected.length&&rooms.length>0,'模块无重叠，全部连接');
    const side=B.entranceSide(conversation,prefs.entranceSide);
    add('building',!rooms.some(r=>B.violation(r,placement)||B.entryViolation(r,placement))&&!E.entranceConflicts(rooms,side).length,'入口朝向核心筒，模块避开核心筒与邻居');
    add('custom',previous.filter(r=>r.type==='custom').every(r=>rooms.some(n=>n.id===r.id&&n.type==='custom')),'原有功能草图模块已保留');
    checks.push(...E.evaluateRequirements(rooms,constraints));
    const warnings=[];
    const interiorCheck=(id,ok,detail)=>{if(!ok&&placement?.softInterior)warnings.push(detail+'：待调整');else add(id,ok,detail);};
    for(const r of conversation.requirements||[]){
      if(r.kind!=='layout')continue;
      if(['gardenCount','balconyCount'].includes(r.id)&&Number.isInteger(r.value)){const type=r.id==='gardenCount'?'garden':'balcony';add('wish-'+r.id,count(type)===r.value,`已确认${type==='garden'?'花园':'阳台'} ${r.value} 个，实际 ${count(type)} 个`);}
      if(r.id==='singleBedrooms'&&Number.isInteger(r.value))add('wish-singleBedrooms',count('bedroomSingle')===r.value,`单人小睡房要求 ${r.value} 间，实际 ${count('bedroomSingle')} 间`);
      if(r.id==='bedrooms'&&Number.isInteger(r.value))add('wish-bedrooms',rooms.filter(E.isBedroom).length===r.value,`已确认睡房需求 ${r.value} 间，实际 ${rooms.filter(E.isBedroom).length} 间`);
      if(r.id==='living'&&['small','medium','large'].includes(r.value))add('wish-living',count({small:'livingSmall',medium:'livingMedium',large:'livingLarge'}[r.value])===1,'已确认的客厅尺寸与画布一致');
      if(r.id==='outdoor'&&['none','balcony','garden','both'].includes(r.value)){const want={none:[0,0],balcony:[1,0],garden:[0,1],both:[1,1]}[r.value];add('wish-outdoor',(count('balcony')>0)===(want[0]>0)&&(count('garden')>0)===(want[1]>0),'已确认的户外空间与画布一致');}
    }
    if(interior)for(const room of rooms){
      const d=interior.byRoom[room.id];
      if(d?.feasibility?.status!=='fit')warnings.push(`${E.getDefinition(room).name}：家具或通路仍需调整`);
      if(room.type==='livingSmall' && (!d?.compactProgram?.daylightReady||!d?.compactProgram?.occupiedClear))warnings.push('小客厅：采光或展开桌椅通路尚未通过');
    }
    if(constraints.gardenCourtyard&&interior){
      const living=rooms.find(r=>r.type.startsWith('living')),ld=living&&interior.byRoom[living.id],gardenIds=new Set(rooms.filter(r=>r.type==='garden').map(r=>r.id)),seen=new Set(),queue=(ld?.doors||[]).filter(d=>gardenIds.has(d.to)).map(d=>d.to);
      while(queue.length){const id=queue.pop();if(seen.has(id))continue;seen.add(id);(interior.byRoom[id]?.doors||[]).filter(d=>gardenIds.has(d.to)).forEach(d=>queue.push(d.to));}
      interiorCheck('garden-route',gardenIds.size>0&&seen.size===gardenIds.size&&ld?.accessibility?.status==='fit'&&!ld.routeUnresolved&&(!ld.compactProgram||ld.compactProgram.occupiedClear&&ld.compactProgram.daylightReady),'从客厅直接进入全部花园，无需穿过睡房；餐写桌使用时通路保持畅通');
    }
    if(constraints.balconyBedroom){
      const balconies=rooms.filter(r=>r.type==='balcony');
      interiorCheck('balconyBedroom',balconies.length>0&&balconies.every(b=>rooms.some(r=>E.isBedroom(r)&&E.touches(r,b)&&(!interior||interior.byRoom[r.id]?.doors.some(d=>d.to===b.id)))),'阳台与睡房直接相接，并有可通行的门');
    }
    const pending=(conversation.requirements||[]).filter(r=>['detail','note'].includes(r.kind)&&!['household','lifestyle'].includes(r.id)).map(r=>r.label);
    return {ok:checks.every(c=>c.status==='met'),checks,warnings,pending};
  }
  // Add bedrooms without moving existing modules or covering the small lounge's
  // exposed facade. No hidden shrinking/deletion if the available site is full.
  function extendBedrooms(rooms,prefs,conversation,placement){
    const missing=prefs.bedrooms-rooms.filter(E.isBedroom).length;
    if(missing<=0)return null;
    const singleMissing=(prefs.singleBedrooms||0)-rooms.filter(r=>r.type==='bedroomSingle').length;
    if(singleMissing<0 || singleMissing>missing)return null;
    const wanted={small:'livingSmall',medium:'livingMedium',large:'livingLarge'}[prefs.living];
    if(!rooms.some(r=>r.type===wanted))return null;
    const outside=rooms.some(r=>r.type==='balcony')?(rooms.some(r=>r.type==='garden')?'both':'balcony'):rooms.some(r=>r.type==='garden')?'garden':'none';
    if(outside!==prefs.outdoor || ['balcony','garden'].some(type=>rooms.filter(r=>r.type===type).length!==E.outdoorCounts(prefs)[type]))return null;
    const side=B.entranceSide(conversation,prefs.entranceSide), result=rooms.map(r=>({...r}));
    const lounge=result.find(r=>r.type==='livingSmall');
    const apron=lounge&&({...lounge});
    if(apron){if(side==='north'){apron.y+=apron.h;apron.h=4;}if(side==='south'){apron.y-=4;apron.h=4;}if(side==='west'){apron.x+=apron.w;apron.w=4;}if(side==='east'){apron.x-=4;apron.w=4;}}
    const contact=(a,b)=>(a.x+a.w===b.x||b.x+b.w===a.x)?Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>=3:(a.y+a.h===b.y||b.y+b.h===a.y)&&Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>=3;
    for(let i=0;i<missing;i++){
      let id=1;while(result.some(r=>r.id==='bedroom-'+id))id++;
      const type=i<singleMissing?'bedroomSingle':'bedroom',size=E.TYPES[type];
      const shape={id:'bedroom-'+id,type,x:0,y:0,w:size.w,h:size.h,rotation:0};
      const allowed=r=>!B.violation(r,placement)&&(!apron||!E.intersects(r,apron))&&result.some(a=>!['bedroom','bedroomSingle','balcony','garden'].includes(a.type)&&contact(a,r));
      try{result.push({...shape,...E.findFreePosition(shape,result,side,allowed)});}catch(_){return null;}
    }
    return result;
  }
  function extendOutdoor(rooms,prefs,conversation,placement){
    if(!rooms.length || rooms.filter(E.isBedroom).length!==prefs.bedrooms || rooms.filter(r=>r.type==='bedroomSingle').length!==(prefs.singleBedrooms||0) || !rooms.some(r=>r.type===({small:'livingSmall',medium:'livingMedium',large:'livingLarge'}[prefs.living])))return null;
    const counts=E.outdoorCounts(prefs), result=rooms.map(r=>({...r})), side=B.entranceSide(conversation,prefs.entranceSide);
    if(['garden','balcony'].some(type=>rooms.filter(r=>r.type===type).length>counts[type]))return null;
    const lounge=rooms.find(r=>r.type==='livingSmall'),apron=lounge&&({...lounge});
    if(apron){if(side==='north'){apron.y+=apron.h;apron.h=4;}if(side==='south'){apron.y-=4;apron.h=4;}if(side==='west'){apron.x+=apron.w;apron.w=4;}if(side==='east'){apron.x-=4;apron.w=4;}}
    for(const type of ['garden','balcony'])for(let n=result.filter(r=>r.type===type).length;n<counts[type];n++){
      let id=1;while(result.some(r=>r.id===type+'-'+id))id++;
      const shape={id:type+'-'+id,type,x:0,y:0,w:E.TYPES[type].w,h:E.TYPES[type].h,rotation:0};
      const anchors=result.filter(r=>r.type===type),allowed=r=>!B.violation(r,placement)&&!B.entryViolation(r,placement)&&(!apron||!E.intersects(r,apron))&&(!anchors.length||anchors.some(a=>E.touches(a,r)));
      try{result.push({...shape,...E.findFreePosition(shape,result,side,allowed)});}catch(_){return null;}
    }
    return result.length>rooms.length?result:null;
  }
  function compactGarden(rooms,prefs,conversation,placement){
    const living=rooms.find(r=>r.type.startsWith('living')),count=E.outdoorCounts(prefs).garden;
    if(!living||!count)return null;
    const base=rooms.filter(r=>r.type!=='garden'),old=rooms.filter(r=>r.type==='garden'),side=B.entranceSide(conversation,prefs.entranceSide),unit=E.MODULE_CELLS;
    const allowed=(r,placed)=>!placed.some(n=>E.intersects(r,n))&&!B.violation(r,placement)&&!B.entryViolation(r,placement)&&!E.entranceConflicts(base.concat(r),side).length;
    const neighbors=r=>[{x:r.x-unit,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x,y:r.y-unit},{x:r.x,y:r.y+r.h}];
    const score=gs=>{const b=E.getBounds(gs);return b.width*b.height+Math.abs(b.width-b.height)*unit;};
    let beam=[[]];
    for(let n=0;n<count;n++){
      const unique=new Map();
      for(const gs of beam)for(const anchor of gs.length?gs:[living])for(const xy of neighbors(anchor)){
        const r={...(old[n]||{}),id:old[n]?.id||'garden-'+(n+1),type:'garden',...xy,w:unit,h:unit,rotation:0};
        if(!allowed(r,base.concat(gs)))continue;
        const next=gs.concat(r),key=next.map(g=>g.x+','+g.y).sort().join('|');if(!unique.has(key))unique.set(key,next);
      }
      beam=[...unique.values()].sort((a,b)=>score(a)-score(b)).slice(0,64);if(!beam.length)return null;
    }
    const candidates=beam.map(gs=>base.concat(gs)).filter(rs=>E.evaluateRequirements(rs,{gardenCourtyard:true})[0].status==='met');
    for(const result of candidates){
      if(placement?.softInterior&&audit(result,prefs,{gardenCourtyard:true},conversation,placement).ok)return result;
      const detail=I.analyze(result,prefs,{obstacles:B.siteObstacles(placement)}),check=audit(result,prefs,{gardenCourtyard:true},conversation,placement,detail,rooms);
      if(check.ok&&!check.warnings.length)return result;
    }
    return null;
  }
  // Reconcile exact inventory before committing. Candidate search is bounded;
  // failures never mutate the original rooms or silently drop requested modules.
  function inventory(rooms){return Object.fromEntries(['bedroom','bedroomSingle','garden','balcony'].map(t=>[t,rooms.filter(r=>r.type===t).length]));}
  function reconcile(rooms,prefs,constraints,conversation,placement){
    const living={small:'livingSmall',medium:'livingMedium',large:'livingLarge'}[prefs.living];
    if(!rooms.some(r=>r.type===living))return {rooms:null,reason:'客厅尺寸改变，需要重新拼排。',applicable:false};
    const counts={bedroom:prefs.bedrooms-(prefs.singleBedrooms||0),bedroomSingle:prefs.singleBedrooms||0,...E.outdoorCounts(prefs)};
    const side=B.entranceSide(conversation,prefs.entranceSide),obstacles=B.siteObstacles(placement),failures=new Set();
    const baseline=I.analyze(rooms,prefs,{obstacles});
    const issueKey=i=>i.code+':'+i.label;
    let beam=[rooms.map(r=>({...r}))];
    // Try alternative removals so a bridge module is not blindly deleted.
    for(const [type,wanted] of Object.entries(counts)){
      const excess=rooms.filter(r=>r.type===type).length-wanted;
      for(let n=0;n<excess;n++)beam=beam.flatMap(rs=>rs.filter(r=>r.type===type).map(r=>rs.filter(a=>a.id!==r.id))).slice(0,48);
    }
    const missing=Object.keys(counts).flatMap(type=>Array(Math.max(0,counts[type]-(beam[0]||[]).filter(r=>r.type===type).length)).fill(type));
    const score=rs=>{const b=E.getBounds(rs);return b.width*b.height+rs.reduce((n,r)=>{const old=rooms.find(a=>a.id===r.id);return n+(old?Math.abs(old.x-r.x)+Math.abs(old.y-r.y):0);},0)*10;};
    for(const type of missing){
      const next=[],seen=new Set();
      for(const rs of beam){
        let id=1;while(rs.some(r=>r.id===type+'-'+id))id++;
        const size=E.TYPES[type],shapes=[{w:size.w,h:size.h,rotation:0}];
        if(size.w!==size.h)shapes.push({w:size.h,h:size.w,rotation:90});
        const anchors=rs.filter(r=>type==='balcony'?constraints.balconyBedroom?E.isBedroom(r):!['garden','balcony'].includes(r.type):type==='garden'?r.type==='garden'||r.type.startsWith('living'):!E.isBedroom(r)&&!['garden','balcony'].includes(r.type));
        for(const shape of shapes)for(const a of anchors){
          const positions=[];
          for(let x=a.x-shape.w+5;x<=a.x+a.w-5;x+=5)positions.push({x,y:a.y-shape.h},{x,y:a.y+a.h});
          for(let y=a.y-shape.h+5;y<=a.y+a.h-5;y+=5)positions.push({x:a.x-shape.w,y},{x:a.x+a.w,y});
          for(const xy of positions){
            const r={id:type+'-'+id,type,...shape,...xy},key=rs.map(n=>n.id+':'+n.x+','+n.y).join('|')+'|'+r.x+','+r.y+','+r.w;
            if(seen.has(key))continue;seen.add(key);
            if(Math.abs(r.x)>E.MAX_COORD||Math.abs(r.y)>E.MAX_COORD||rs.some(n=>E.intersects(n,r))||B.violation(r,placement)||B.entryViolation(r,placement)||E.entranceConflicts(rs.concat(r),side).length)continue;
            next.push(rs.concat(r));
          }
        }
      }
      beam=next.sort((a,b)=>score(a)-score(b)).slice(0,64);
      if(!beam.length)return {rooms:null,applicable:true,reason:`${E.TYPES[type].name}未找到满足连接、入口及核心筒／邻居边界的空位；可移动相邻模块后重试。`};
    }
    for(const candidate of beam.sort((a,b)=>score(a)-score(b))){
      const geometric=audit(candidate,prefs,constraints,conversation,placement);
      if(!geometric.ok){geometric.checks.filter(c=>c.status!=='met').forEach(c=>failures.add(c.detail));continue;}
      const detail=I.analyze(candidate,prefs,{obstacles}),checked=audit(candidate,prefs,constraints,conversation,placement,detail,rooms);
      const bad=candidate.filter(r=>{
        const now=detail.byRoom[r.id],old=baseline.byRoom[r.id];
        if(now?.entryConnected===false)return true;
        if(now?.feasibility?.status==='fit')return false;
        // Existing unrelated furniture issues remain visible in the receipt;
        // they must not prohibit every edit. New rooms and regressions fail.
        return !old||old.feasibility?.status==='fit'||now.feasibility.issues.some(i=>!old.feasibility.issues.some(j=>issueKey(i)===issueKey(j)));
      });
      if(placement?.softInterior&&geometric.ok)return {rooms:candidate,applicable:true,before:inventory(rooms),after:inventory(candidate)};
      if(checked.ok&&!bad.length)return {rooms:candidate,applicable:true,before:inventory(rooms),after:inventory(candidate)};
      checked.checks.filter(c=>c.status!=='met').forEach(c=>failures.add(c.detail));
      bad.forEach(r=>failures.add(E.getDefinition(r).name+'：'+(detail.byRoom[r.id]?.feasibility?.issues?.[0]?.message||'家具或进出通路尚未通过')));
      checked.warnings.forEach(w=>failures.add(w));
    }
    return {rooms:null,applicable:true,reason:[...failures].slice(0,3).join('；')||'没有找到保留全部模块且通路畅通的拼法。'};
  }
  function syncManualRequirements(conversation,prefs,rooms){
    const values={bedrooms:rooms.filter(E.isBedroom).length,singleBedrooms:rooms.filter(r=>r.type==='bedroomSingle').length,living:prefs.living,outdoor:prefs.outdoor,gardenCount:rooms.filter(r=>r.type==='garden').length,balconyCount:rooms.filter(r=>r.type==='balcony').length};
    conversation.requirements=conversation.requirements.filter(r=>!(['gardenCount','balconyCount'].includes(r.id)&&values[r.id]===0)).map(r=>Object.hasOwn(values,r.id)?{...r,value:values[r.id],status:'pending',text:'按当前画布手动调整更新',label:({bedrooms:`${values.bedrooms} 间睡房`,singleBedrooms:`${values.singleBedrooms} 间单人小睡房`,gardenCount:`${values.gardenCount} 个花园`,balconyCount:`${values.balconyCount} 个阳台`,outdoor:{none:'无户外空间',garden:'花园',balcony:'阳台',both:'阳台与花园'}[prefs.outdoor],living:{small:'3×3 小客厅',medium:'3×4.5 多用客厅',large:'大客厅'}[prefs.living]})[r.id]}:r);
  }
  return Object.freeze({audit,extendBedrooms,extendOutdoor,compactGarden,reconcile,inventory,syncManualRequirements});
});

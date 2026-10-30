(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.OfficeModel = model;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const PROGRAMS = {
    focus: { label: '专注办公', color: '#b7dc77' },
    collaborate: { label: '协作会议', color: '#88c7e0' },
    make: { label: '制作实验', color: '#d7b2ed' },
    social: { label: '共享交流', color: '#efb97f' },
    garden: { label: '花园平台', color: '#65cfa0' }
  };
  // Footprints are measured along the facade × outward from the core.
  const FOOTPRINTS = { '4x4': { width:4, depth:4, label:'4 × 4 m' } };
  const KEYS = Object.keys(PROGRAMS), clone = value => JSON.parse(JSON.stringify(value));
  function demand(value) {
    if (!value || KEYS.some(key => !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 100) || !KEYS.some(key => value[key] > 0)) throw Error('至少一个需求权重大于 0，且均在 0–100 之间。');
    return Object.fromEntries(KEYS.map(key => [key, value[key]]));
  }
  function lanes() {
    const out=[];
    for (let i=0;i<6;i++) {
      if (i<3) out.push({side:'北',t:-4+i*4},{side:'南',t:-4+i*4});
      out.push({side:'西',t:-10+i*4},{side:'东',t:-10+i*4});
    }
    return out;
  }
  const activeLanes = state => lanes().map((lane,i)=>(state.disabledSides||[]).includes(lane.side)?-1:i).filter(i=>i>=0);
  const capacity = state => activeLanes(state).length * state.projectionDepth;
  function geometry(state, floor) {
    const axes=lanes(),out=[],distances=new Map();
    const place=(cube,side,t,offset)=>{
      const ns=side==='北'||side==='南';
      const x=ns?t-2:side==='西'?-6-offset-4:6+offset;
      const z=ns?(side==='北'?-12-offset-4:12+offset):t-2;
      out.push({...cube,x,z,w:4,d:4,h:state.moduleHeight,side,offset});
    };
    // Indoor chains are packed continuously; gardens never interrupt them.
    for(const cube of [...floor.cubes].filter(c=>c.program!=='garden').sort((a,b)=>a.lane-b.lane||a.rank-b.rank)) {
      const lane=axes[cube.lane],offset=distances.get(cube.lane)||0;
      place(cube,lane.side,lane.t,offset);distances.set(cube.lane,offset+4);
    }
    // Every garden continues its own facade-normal chain, after all indoor rooms.
    // No lateral branches or gaps are introduced, including after demand changes.
    for(const cube of [...floor.cubes].filter(c=>c.program==='garden').sort((a,b)=>a.lane-b.lane||a.rank-b.rank)) {
      const lane=axes[cube.lane],offset=distances.get(cube.lane)||0;
      place(cube,lane.side,lane.t,offset);distances.set(cube.lane,offset+4);
    }
    return out;
  }
  // Roof terraces are derived from occupied indoor cells, never recursively from gardens.
  // They are vertically supported additions, independent of facade-normal chains.
  function displayGeometry(state,floor) {
    const own=geometry(state,floor),fi=state.floors.findIndex(f=>f.id===floor.id);
    if(!state.roofGardens||fi<1)return own;
    const occupied=new Set(own.map(c=>`${c.x}:${c.z}`));
    const additions=geometry(state,state.floors[fi-1]).filter(c=>c.program!=='garden'&&!occupied.has(`${c.x}:${c.z}`)).map(c=>({...c,
      id:`roof:${c.id}`,program:'garden',userId:floor.users[0].id,automaticRoof:true,supportId:c.id,rank:c.offset/4
    }));
    return [...own,...additions];
  }
  function bounds(state, floorIndex=null) {
    const first=floorIndex===null?0:floorIndex,last=floorIndex===null?state.floors.length-1:floorIndex;
    const out={minX:-6,maxX:6,minZ:-12,maxZ:12,minY:first*state.floorHeight,maxY:(last+1)*state.floorHeight+.3};
    state.floors.forEach((floor,i)=>{
      if(floorIndex!==null&&i!==floorIndex)return;
      displayGeometry(state,floor).forEach(c=>{out.minX=Math.min(out.minX,c.x);out.maxX=Math.max(out.maxX,c.x+c.w);out.minZ=Math.min(out.minZ,c.z);out.maxZ=Math.max(out.maxZ,c.z+c.d);});
    });
    return out;
  }
  function distribute(count, weights) {
    const total=KEYS.reduce((s,k)=>s+weights[k],0);
    const quotas=KEYS.map(key=>({key,exact:count*weights[key]/total,count:Math.floor(count*weights[key]/total)}));
    const ranking=[...quotas].sort((a,b)=>(b.exact-b.count)-(a.exact-a.count));
    const remaining=count-quotas.reduce((s,item)=>s+item.count,0);
    for(let i=0;i<remaining;i++)ranking[i].count++;
    return quotas.flatMap(item=>Array(item.count).fill(item.key));
  }
  function programFloor(floor, onlyUser) {
    for(const user of floor.users) {
      if(onlyUser&&user.id!==onlyUser)continue;
      const cubes=floor.cubes.filter(c=>c.userId===user.id),programs=distribute(cubes.length,user.demand);
      const gardenCount=programs.filter(p=>p==='garden').length;
      const gardens=new Set([...cubes].sort((a,b)=>b.rank-a.rank||a.lane-b.lane).slice(0,gardenCount).map(c=>c.id));
      const indoor=programs.filter(p=>p!=='garden');let cursor=0;
      cubes.forEach(cube=>{cube.program=gardens.has(cube.id)?'garden':indoor[cursor++];});
    }
  }
  function scatterFloor(state,floor,rng=Math.random) {
    const sample=()=>{const n=rng();if(!Number.isFinite(n)||n<0||n>=1)throw Error('随机数须在 0 到 1 之间。');return n;};
    const order=activeLanes(state);
    for(let i=order.length-1;i>0;i--){const j=Math.floor(sample()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    const lengths=order.map(()=>0);let remaining=floor.cubes.length;
    const preferredDepth=Math.min(state.projectionDepth,Math.max(2,Math.ceil(remaining/order.length)));
    // Reserve room for later lanes, then independently choose each chain length.
    order.forEach((lane,i)=>{
      const min=Math.max(0,remaining-(order.length-i-1)*preferredDepth);
      const max=Math.min(preferredDepth,remaining);
      lengths[lane]=min+Math.floor(sample()*(max-min+1));remaining-=lengths[lane];
    });
    const slots=order.flatMap(lane=>Array.from({length:lengths[lane]},(_,rank)=>({lane,rank})));
    floor.cubes.forEach((cube,i)=>Object.assign(cube,slots[i],{footprint:'4x4'}));
  }
  function randomizeLayout(state,rng=Math.random) {
    const next=clone(state);next.floors.forEach(f=>scatterFloor(next,f,rng));next.layoutVersion=1;next.revision++;return next;
  }
  function resizeFloor(state,index,count,{reprogram=true,redistributeUsers=false}={}) {
    const floor=state.floors[index];
    if(!floor||!Number.isInteger(count)||count<1||count>capacity(state))throw Error(`本层模块数量须为 1–${capacity(state)}。`);
    const previous=floor.cubes;
    floor.cubes=Array.from({length:count},(_,i)=>{
      const old=previous[i];
      return {id:old?.id||`${floor.id}-C${i+1}`,lane:Math.floor(i/state.projectionDepth),rank:i%state.projectionDepth,footprint:old?.footprint||state.defaultFootprint,userId:!redistributeUsers&&floor.users.some(u=>u.id===old?.userId)?old.userId:floor.users[i%floor.users.length].id,program:old?.program||'focus'};
    });
    if(count!==previous.length||previous.some(c=>c.rank>=state.projectionDepth||!activeLanes(state).includes(c.lane)))scatterFloor(state,floor);
    else floor.cubes.forEach((c,i)=>{c.lane=previous[i].lane;c.rank=previous[i].rank;});
    if(reprogram)programFloor(floor);
  }
  function seed() {
    const state={format:'adaptive-office-v2',core:{width:12,depth:24},layoutVersion:2,gridSize:4,defaultFootprint:'4x4',projectionDepth:3,moduleHeight:4,floorHeight:4,disabledSides:['北','南'],revision:0,floors:[]};
    const names=['产品研究','设计团队','技术研发','项目协同','材料实验','运营团队','创意工作','共享社区'];
    const quantities=[18,22,19,21,17,23,18,22],weights={focus:50,collaborate:20,make:10,social:10,garden:10};
    let randomState=54023;
    const rng=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
    const previousGardens=new Set();
    for(let i=0;i<8;i++) {
      const floor={id:`L${i+1}`,name:names[i],users:[0,1].map(j=>({id:`L${i+1}-U${j+1}`,name:`${names[i]} · 用户 ${j+1}`,demand:clone(weights)})),cubes:[]};
      state.floors.push(floor);
      floor.cubes=Array.from({length:quantities[i]},(_,j)=>({id:`${floor.id}-C${j+1}`,userId:floor.users[j%2].id,program:'focus',footprint:'4x4'}));
      scatterFloor(state,floor,rng);
      const terminals=floor.cubes.filter(c=>!floor.cubes.some(o=>o.lane===c.lane&&o.rank>c.rank));
      const gardens=['西','东'].map(side=>{
        const options=terminals.filter(c=>lanes()[c.lane].side===side&&!previousGardens.has(c.lane));
        return options[Math.floor(rng()*options.length)];
      });
      previousGardens.clear();gardens.forEach(c=>{c.program='garden';previousGardens.add(c.lane);});
      const indoor=floor.cubes.filter(c=>!gardens.includes(c));
      const programs=[...Array(quantities[i]-10).fill('focus'),...Array(4).fill('collaborate'),...Array(2).fill('make'),...Array(2).fill('social')];
      for(let j=programs.length-1;j>0;j--){const k=Math.floor(rng()*(j+1));[programs[j],programs[k]]=[programs[k],programs[j]];}
      indoor.forEach((c,j)=>{c.program=programs[j];});
    }
    return state;
  }
  function setFloorCounts(state,counts) {
    if(!Array.isArray(counts)||counts.length!==state.floors.length||counts.some(n=>!Number.isInteger(n)||n<1||n>capacity(state)))throw Error(`请为每一层填写 1–${capacity(state)} 的整数模块数量。`);
    const next=clone(state);
    counts.forEach((count,i)=>{if(count!==next.floors[i].cubes.length)resizeFloor(next,i,count);});
    next.revision++;return next;
  }
  function randomizeFloorCounts(state,min,max,rng=Math.random) {
    if(!Number.isInteger(min)||!Number.isInteger(max)||min<1||max<min||max>capacity(state))throw Error(`随机数量范围须为 1–${capacity(state)} 的整数，且最小值不大于最大值。`);
    const counts=state.floors.map(floor=>{
      const sample=rng();if(!Number.isFinite(sample)||sample<0||sample>=1)throw Error('随机数应在 0（含）到 1（不含）之间。');
      let count=min+Math.floor(sample*(max-min+1));
      if(min<max&&count===floor.cubes.length)count=count===max?min:count+1;
      return count;
    });
    if(min<max&&counts.length>1&&counts.every(n=>n===counts[0]))counts[1]=counts[0]===max?min:counts[0]+1;
    return setFloorCounts(state,counts);
  }
  function setBuildingSideCounts(state,counts,rng=Math.random) {
    const axes=lanes(),sides=['北','南','西','东'];
    for(const side of sides){const max=(state.disabledSides||[]).includes(side)?0:axes.filter(a=>a.side===side).length*state.projectionDepth;if(!Number.isInteger(counts[side])||counts[side]<0||counts[side]>max)throw Error(`${side}侧每层数量须为 0–${max}。`);}
    const total=sides.reduce((n,side)=>n+counts[side],0);if(!total)throw Error('每层至少保留一个模块。');
    const next=clone(state);
    next.floors.forEach((floor,index)=>{
      resizeFloor(next,index,total);
      const slots=[];
      for(const side of sides){
        const available=axes.map((a,i)=>a.side===side?i:-1).filter(i=>i>=0),lengths=new Map(available.map(i=>[i,0]));
        for(let i=0;i<counts[side];i++){
          const eligible=available.filter(l=>lengths.get(l)<next.projectionDepth),sample=rng();
          if(!Number.isFinite(sample)||sample<0||sample>=1)throw Error('随机数须在 0 到 1 之间。');
          const lane=eligible[Math.floor(sample*eligible.length)];lengths.set(lane,lengths.get(lane)+1);
        }
        for(const lane of available)for(let rank=0;rank<lengths.get(lane);rank++)slots.push({lane,rank});
      }
      floor.cubes.forEach((c,i)=>Object.assign(c,slots[i]));programFloor(floor);
    });
    next.revision++;return next;
  }
  function setDisabledSides(state,sides) {
    if(!Array.isArray(sides)||sides.some(s=>!['北','南','西','东'].includes(s))||new Set(sides).size!==sides.length||sides.length===4)throw Error('请至少保留一个允许外挂的方向。');
    const next=clone(state);next.disabledSides=[...sides];
    if(next.floors.some(f=>f.cubes.length>capacity(next)))throw Error(`开启的方向每层最多容纳 ${capacity(next)} 个模块。请先减少超额楼层的数量，或增加最大外挂排数。`);
    next.floors.forEach(f=>scatterFloor(next,f));next.revision++;return next;
  }
  function configure(state,{floorCount,defaultFootprint=state.defaultFootprint,projectionDepth=state.projectionDepth,moduleHeight=state.moduleHeight,floorHeight}) {
    if(!Number.isInteger(floorCount)||floorCount<1||floorCount>20||!Object.hasOwn(FOOTPRINTS,defaultFootprint)||!Number.isInteger(projectionDepth)||projectionDepth<3||projectionDepth>6||moduleHeight!==4||floorHeight!==4)throw Error('层数 1–20，向外挂接 3–6 排，模块尺寸固定 4×4×4 m，层高固定 4 m。');
    const next=clone(state);
    next.defaultFootprint=defaultFootprint;next.projectionDepth=projectionDepth;next.moduleHeight=moduleHeight;next.floorHeight=floorHeight;
    next.floors=next.floors.slice(0,floorCount);
    if(next.floors.some(f=>f.cubes.length>capacity(next)))throw Error('减小挂接排数后容不下现有模块，请先减少对应楼层的模块数量。');
    while(next.floors.length<floorCount) {
      const id=`L${next.floors.length+1}`;
      next.floors.push({id,name:'新增办公层',users:[{id:`${id}-U1`,name:'新增用户',demand:{focus:35,collaborate:25,make:10,social:15,garden:15}}],cubes:[]});
    }
    next.floors.forEach((floor,i)=>resizeFloor(next,i,floor.cubes.length||9,{reprogram:!floor.cubes.length}));
    next.revision++;
    return next;
  }
  function setFootprint(state,floorIndex,cubeId,footprint) {
    const next=clone(state),cube=next.floors[floorIndex]?.cubes.find(c=>c.id===cubeId);
    if(!cube||!Object.hasOwn(FOOTPRINTS,footprint))throw Error('请选择模块及有效的平面尺寸。');
    cube.footprint=footprint;next.revision++;return next;
  }
  function proposal(state,{scope,floorIndex,userId,weights}) {
    const next=clone(state),clean=demand(weights);
    if(!['user','floor','building'].includes(scope)||!next.floors[floorIndex])throw Error('请选择有效的需求范围及楼层。');
    const floors=scope==='building'?next.floors:[next.floors[floorIndex]];
    if(scope==='user'&&!floors[0].users.some(u=>u.id===userId))throw Error('此层没有该用户。');
    floors.forEach(floor=>{floor.users.forEach(user=>{if(scope!=='user'||user.id===userId)user.demand=clone(clean);});programFloor(floor,scope==='user'?userId:null);});
    const changes=[];
    next.floors.forEach((floor,i)=>floor.cubes.forEach((cube,j)=>{const before=state.floors[i].cubes[j];if(cube.program!==before.program)changes.push({floor:floor.id,cube:cube.id,from:before.program,to:cube.program,userId:cube.userId});}));
    next.revision++;
    return {next,changes,scope,affectedFloors:floors.map(f=>f.id),userId:scope==='user'?userId:null};
  }
  function migrate(input) {
    // Preserve IDs, ownership, programs and original file; only the placement
    // model changes to connected outward chains. New garden demand starts at 0.
    if(!input||input.format!=='adaptive-office-v1')return input;
    if(![3,4,6].includes(input.cubeSize)||!Array.isArray(input.floors)||input.floors.some(f=>!Array.isArray(f.cubes)||f.cubes.some(c=>!Number.isInteger(c.slot)||c.slot<0||c.slot>=(72/input.cubeSize))||new Set(f.cubes.map(c=>c.slot)).size!==f.cubes.length))throw Error('旧版方案挂接数据无效。');
    const next=clone(input);next.format='adaptive-office-v2';next.defaultFootprint=input.cubeSize===6?'6x6':'3x3';next.projectionDepth=3;next.moduleHeight=3;next.floorHeight=Math.max(3,next.floorHeight);
    next.floors.forEach(floor=>{
      floor.users.forEach(user=>{user.demand.garden=0;});
      floor.cubes=floor.cubes.map((cube,i)=>({id:cube.id,lane:Math.floor(i/3),rank:i%3,footprint:next.defaultFootprint,userId:cube.userId,program:cube.program}));
    });
    delete next.cubeSize;return next;
  }
  function validate(raw) {
    const input=migrate(raw),bad=()=>{throw Error('这不是有效的办公楼方案，请载入此版本导出的 JSON。');};
    if(!input||input.format!=='adaptive-office-v2'||input.core?.width!==12||input.core?.depth!==24||!['4x4','3x3','6x3','6x6'].includes(input.defaultFootprint)||!Number.isInteger(input.projectionDepth)||input.projectionDepth<3||input.projectionDepth>6||!Number.isFinite(input.moduleHeight)||input.moduleHeight<2.5||input.moduleHeight>6||!Number.isFinite(input.floorHeight)||input.floorHeight<input.moduleHeight||input.floorHeight>12||!Array.isArray(input.floors)||!input.floors.length||input.floors.length>20)bad();
    if(input.disabledSides!==undefined&&(!Array.isArray(input.disabledSides)||input.disabledSides.length>=4||new Set(input.disabledSides).size!==input.disabledSides.length||input.disabledSides.some(s=>!['北','南','西','东'].includes(s))))bad();
    const ids=new Set();
    const unique=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,60}$/.test(id)||ids.has(id))bad();ids.add(id);};
    input.floors.forEach(floor=>{
      unique(floor.id);
      if(typeof floor.name!=='string'||floor.name.length>80||!Array.isArray(floor.users)||!floor.users.length||floor.users.length>12||!Array.isArray(floor.cubes)||!floor.cubes.length||floor.cubes.length>capacity(input))bad();
      floor.users.forEach(user=>{unique(user.id);if(typeof user.name!=='string'||user.name.length>80)bad();demand(user.demand);});
      const taken=new Set();
      floor.cubes.forEach(cube=>{
        unique(cube.id);const address=`${cube.lane}:${cube.rank}`;
        if(!Number.isInteger(cube.lane)||cube.lane<0||cube.lane>=lanes().length||!Number.isInteger(cube.rank)||cube.rank<0||cube.rank>=input.projectionDepth||taken.has(address)||!['4x4','3x3','6x3','6x6'].includes(cube.footprint)||!floor.users.some(u=>u.id===cube.userId)||!KEYS.includes(cube.program))bad();
        if((input.disabledSides||[]).includes(lanes()[cube.lane].side))bad();
        taken.add(address);
      });
      floor.cubes.forEach(c=>{if(c.rank>0&&!taken.has(`${c.lane}:${c.rank-1}`))bad();});
    });
    const clean=clone(input);clean.revision=Number.isSafeInteger(input.revision)&&input.revision>=0?input.revision:0;
    clean.defaultFootprint='4x4';clean.moduleHeight=4;clean.floorHeight=4;
    clean.floors.forEach(f=>f.cubes.forEach(c=>{c.footprint='4x4';}));
    if(clean.gridSize!==4){
      const oldAxes=[];for(let i=0;i<4;i++){if(i<2)oldAxes.push('北','南');oldAxes.push('西','东');}
      const axes=lanes();
      clean.floors.forEach(f=>{
        const used=axes.map(()=>0);
        f.cubes.forEach(c=>{
          const side=oldAxes[c.lane];if(!side)bad();
          const eligible=axes.map((a,i)=>a.side===side&&used[i]<clean.projectionDepth?i:-1).filter(i=>i>=0);
          const lane=eligible[Math.floor(Math.random()*eligible.length)];if(lane===undefined)bad();
          c.lane=lane;c.rank=used[lane]++;
        });
      });
      clean.gridSize=4;clean.layoutVersion=1;
    }
    return clean;
  }
  function stats(state) {
    const counts=Object.fromEntries(KEYS.map(key=>[key,0]));let moduleArea=0,gardenArea=0;
    state.floors.forEach(f=>displayGeometry(state,f).forEach(c=>{counts[c.program]++;const shape=FOOTPRINTS[c.footprint],area=shape.width*shape.depth;moduleArea+=area;if(c.program==='garden')gardenArea+=area;}));
    return {counts,cubes:Object.values(counts).reduce((a,b)=>a+b,0),users:state.floors.reduce((n,f)=>n+f.users.length,0),moduleArea,gardenArea,indoorArea:moduleArea-gardenArea,coreArea:state.floors.length*288};
  }
  function aiContext(state,selection) {
    const {scope,floorIndex,userId}=selection||{};
    if(!['user','floor','building'].includes(scope)||!Number.isInteger(floorIndex)||!state.floors[floorIndex])throw Error('请选择有效的楼层与需求范围。');
    if(scope==='user'&&!state.floors[floorIndex].users.some(u=>u.id===userId))throw Error('请选择有效用户。');
    const groups=[];
    state.floors.forEach((floor,i)=>{
      if(scope!=='building'&&i!==floorIndex)return;
      floor.users.forEach(user=>{
        if(scope==='user'&&user.id!==userId)return;
        const cubes=floor.cubes.filter(c=>c.userId===user.id);
        groups.push({floorId:floor.id,floorName:floor.name,userId:user.id,userName:user.name,counts:Object.fromEntries(KEYS.map(k=>[k,cubes.filter(c=>c.program===k).length])),demand:clone(user.demand)});
      });
    });
    return {scope,floorIndex,userId:scope==='user'?userId:null,selectedFloorId:state.floors[floorIndex].id,revision:state.revision,groups,
      rules:{core:[12,24],module:[4,4,4],floorHeight:4,disabledSides:state.disabledSides||[],projectionDepth:state.projectionDepth,straightChains:true,gardenAtChainEnd:true,totalModulesFixed:true},programs:KEYS.map(key=>({key,label:PROGRAMS[key].label}))};
  }
  function proposeTransfers(state,selection,transfers) {
    const context=aiContext(state,selection),next=clone(state),changes=[],consumed=new Set(),affectedUsers=new Set();
    if(!Array.isArray(transfers)||!transfers.length||transfers.length>240)throw Error('用途调整必须包含 1–240 条有效转换。');
    for(const t of transfers){
      if(!t||!KEYS.includes(t.from)||!KEYS.includes(t.to)||t.from===t.to||!Number.isSafeInteger(t.count)||t.count<1)throw Error('每条转换必须是两种不同的有效用途，数量为正整数。');
      if(!context.groups.some(g=>g.floorId===t.floorId&&g.userId===t.userId))throw Error('建议超出所选用户或楼层范围。');
      const index=state.floors.findIndex(f=>f.id===t.floorId),floor=state.floors[index];
      const pool=floor.cubes.filter(c=>c.userId===t.userId&&c.program===t.from&&!consumed.has(c.id)).sort((a,b)=>b.rank-a.rank||a.lane-b.lane);
      if(pool.length<t.count)throw Error(`${t.floorId}/${t.userId} 的${PROGRAMS[t.from].label}不足，最多可转换 ${pool.length} 个。`);
      for(const c of pool.slice(0,t.count)){
        consumed.add(c.id);next.floors[index].cubes.find(n=>n.id===c.id).program=t.to;
        changes.push({floor:floor.id,cube:c.id,userId:c.userId,from:t.from,to:t.to});
      }
      affectedUsers.add(t.userId);
    }
    const moved=[];
    next.floors.forEach((f,i)=>{
      f.users.forEach(u=>{if(affectedUsers.has(u.id)){const owned=f.cubes.filter(c=>c.userId===u.id);u.demand=Object.fromEntries(KEYS.map(k=>[k,Math.round(100*owned.filter(c=>c.program===k).length/owned.length)]));}});
      const old=new Map(geometry(state,state.floors[i]).map(c=>[c.id,c]));
      geometry(next,f).forEach(c=>{const p=old.get(c.id);if(c.x!==p.x||c.z!==p.z)moved.push(c.id);});
    });
    next.revision++;validate(next);
    const countGroups=groups=>Object.fromEntries(KEYS.map(k=>[k,groups.reduce((n,g)=>n+g.counts[k],0)]));
    return {next,changes,moved,scope:context.scope,affectedFloors:[...new Set(changes.map(c=>c.floor))],before:countGroups(context.groups),after:countGroups(aiContext(next,selection).groups)};
  }
  function proposeFeedback(state,selection,feedback,multiplier=1) {
    if(!feedback||KEYS.some(k=>!Number.isInteger(feedback[k])||Math.abs(feedback[k])>2)||!KEYS.some(k=>feedback[k]))throw Error('反馈方向须为 -2 至 2 的整数且至少一项非零。');
    if(!Number.isInteger(multiplier)||multiplier<1||multiplier>100)throw Error('需求份数须为 1–100。');
    const context=aiContext(state,selection),next=clone(state),alpha=multiplier/(100+multiplier),ids=new Set(context.groups.map(g=>g.userId));
    const averages=ctx=>Object.fromEntries(KEYS.map(k=>[k,Number((ctx.groups.reduce((n,g)=>n+g.demand[k],0)/ctx.groups.length).toFixed(3))]));
    const counts=ctx=>Object.fromEntries(KEYS.map(k=>[k,ctx.groups.reduce((n,g)=>n+g.counts[k],0)]));
    next.floors.forEach(f=>{f.users.forEach(u=>{
      if(!ids.has(u.id))return;const proposed={...u.demand};KEYS.forEach(k=>{const v=u.demand[k],s=feedback[k]/2;proposed[k]=Number((v+alpha*(s>0?(100-v)*s:v*s)).toFixed(6));});u.demand=demand(proposed);
      const cubes=f.cubes.filter(c=>c.userId===u.id),target=distribute(cubes.length,u.demand),remaining=Object.fromEntries(KEYS.map(k=>[k,target.filter(p=>p===k).length])),spare=[];
      cubes.forEach(c=>{if(remaining[c.program]>0)remaining[c.program]--;else spare.push(c);});
      let index=0;KEYS.forEach(k=>{for(let n=0;n<remaining[k];n++)spare[index++].program=k;});
    });});
    const changes=[],moved=[];
    next.floors.forEach((f,i)=>{const original=state.floors[i],old=new Map(geometry(state,original).map(c=>[c.id,c]));f.cubes.forEach((c,j)=>{const b=original.cubes[j];if(c.program!==b.program)changes.push({floor:f.id,cube:c.id,userId:c.userId,from:b.program,to:c.program});});geometry(next,f).forEach(c=>{const b=old.get(c.id);if(c.x!==b.x||c.z!==b.z)moved.push(c.id);});});
    next.revision++;validate(next);const after=aiContext(next,selection);
    return {next,changes,moved,scope:selection.scope,affectedFloors:[...new Set(context.groups.map(g=>g.floorId))],before:counts(context),after:counts(after),currentWeights:averages(context),weights:averages(after),multiplier,baseline:100,feedback:clone(feedback)};
  }
  function proposeWeights(state,selection,weights) {
    if(!weights||KEYS.some(k=>!Number.isInteger(weights[k])||weights[k]<0||weights[k]>100)||!KEYS.some(k=>weights[k]>0))throw Error('五项需求权重必须为 0–100 的整数，且不能全部为零。');
    const before=aiContext(state,selection),p=proposal(state,{...selection,weights});validate(p.next);
    const count=ctx=>Object.fromEntries(KEYS.map(k=>[k,ctx.groups.reduce((n,g)=>n+g.counts[k],0)]));
    const moved=[];
    p.next.floors.forEach((f,i)=>{const old=new Map(geometry(state,state.floors[i]).map(c=>[c.id,c]));geometry(p.next,f).forEach(c=>{const b=old.get(c.id);if(c.x!==b.x||c.z!==b.z)moved.push(c.id);});});
    return {...p,moved,before:count(before),after:count(aiContext(p.next,selection)),weights:clone(weights)};
  }
  function scaleTransfers(state,selection,transfers,multiplier) {
    if(!Number.isSafeInteger(multiplier)||multiplier<1||multiplier>100)throw Error('需求倍率应为 1–100 的整数。');
    proposeTransfers(state,selection,transfers);
    const groups=aiContext(state,selection).groups;
    const remaining=new Map();
    groups.forEach(g=>KEYS.forEach(k=>remaining.set(JSON.stringify([g.floorId,g.userId,k]),g.counts[k])));
    const scaled=transfers.map(t=>({...t,count:0}));
    // Repeat the same validated demand. Never consume newly converted modules.
    for(let round=0;round<multiplier;round++)transfers.forEach((t,i)=>{
      const key=JSON.stringify([t.floorId,t.userId,t.from]),n=Math.min(t.count,remaining.get(key));
      scaled[i].count+=n;remaining.set(key,remaining.get(key)-n);
    });
    const requested=transfers.reduce((n,t)=>n+t.count,0)*multiplier;
    const actual=scaled.reduce((n,t)=>n+t.count,0);
    return {transfers:scaled.filter(t=>t.count),multiplier,requested,actual,clipped:requested-actual};
  }
  return {PROGRAMS,FOOTPRINTS,KEYS,clone,seed,lanes,capacity,geometry,displayGeometry,bounds,distribute,resizeFloor,configure,setFootprint,setFloorCounts,randomizeFloorCounts,randomizeLayout,setBuildingSideCounts,setDisabledSides,proposal,validate,stats,aiContext,proposeTransfers,scaleTransfers,proposeWeights,proposeFeedback};
}));


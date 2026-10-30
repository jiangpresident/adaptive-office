'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../dist/office-model.js');
const allFocus = { focus:100, collaborate:0, make:0, social:0, garden:0 };
test('12 × 24 core, varied per-floor quantities, valid serializable seed', () => {
  const state=M.seed(); assert.deepEqual(state.core,{width:12,depth:24});
  assert.ok(new Set(state.floors.map(f=>f.cubes.length)).size>1);
  assert.deepEqual(M.validate(JSON.parse(JSON.stringify(state))),state);
  assert.equal(M.stats(state).cubes,160);
  state.floors.forEach(floor=>{
    assert.ok(floor.cubes.length>=17&&floor.cubes.length<=23);
    assert.deepEqual(new Set(floor.cubes.map(c=>c.footprint)),new Set(['4x4']));
    assert.ok(new Set(floor.cubes.map(c=>c.lane)).size>=4);

    const gardens=floor.cubes.filter(c=>c.program==='garden');
    assert.ok(gardens.length>0);
  });
});
test('per-floor quantities apply atomically and preserve unedited floors and retained footprints',()=>{
  const state=M.seed(),original=M.clone(state),counts=state.floors.map(f=>f.cubes.length);
  counts[2]=35;const next=M.setFloorCounts(state,counts);
  assert.equal(next.floors[2].cubes.length,35);
  state.floors[2].cubes.forEach((c,i)=>{assert.equal(next.floors[2].cubes[i].footprint,c.footprint);assert.equal(next.floors[2].cubes[i].userId,c.userId);});
  state.floors.forEach((floor,i)=>{if(i!==2)assert.deepEqual(next.floors[i],floor);});
  assert.deepEqual(state,original);M.validate(next);
  for(const invalid of [[1],counts.map((n,i)=>i===4?0:n),counts.map((n,i)=>i===4?55:n),counts.map((n,i)=>i===4?3.5:n)])assert.throws(()=>M.setFloorCounts(state,invalid));
  assert.deepEqual(state,original);
});
test('random floor counts respect bounds, change the model, remain varied and validate',()=>{
  const state=M.seed(),before=M.clone(state);
  for(const sample of [0,.5,.99999]) {
    const next=M.randomizeFloorCounts(state,24,36,()=>sample);
    assert.ok(next.floors.every(f=>f.cubes.length>=24&&f.cubes.length<=36));
    assert.ok(new Set(next.floors.map(f=>f.cubes.length)).size>1);
    assert.notDeepEqual(next.floors.map(f=>f.cubes.length),state.floors.map(f=>f.cubes.length));M.validate(next);
  }
  assert.ok(M.randomizeFloorCounts(state,7,7,()=>0).floors.every(f=>f.cubes.length===7));
  for(const range of [[0,36],[30,24],[1,55],[1.5,20]])assert.throws(()=>M.randomizeFloorCounts(state,...range));
  assert.throws(()=>M.randomizeFloorCounts(state,24,36,()=>1));
  assert.deepEqual(state,before);
});
test('3–6 outward modules per lane connect continuously, with 4x4 footprints and no overlaps', () => {
  const overlaps=(a,b)=>a.x<b.x+b.w-1e-7&&a.x+a.w>b.x+1e-7&&a.z<b.z+b.d-1e-7&&a.z+a.d>b.z+1e-7;
  for(const depth of [3,4,6])for(const uniform of ['4x4']) {
    const state=M.configure(M.setDisabledSides(M.seed(),[]),{floorCount:1,projectionDepth:depth,moduleHeight:4,floorHeight:4});
    M.resizeFloor(state,0,M.capacity(state));
    state.floors[0].cubes.forEach(c=>{c.footprint=uniform;c.program='focus';});
    const boxes=M.geometry(state,state.floors[0]);
    boxes.forEach((box,i)=>{
      assert.ok(box.x+box.w<=-6||box.x>=6||box.z+box.d<=-12||box.z>=12);
      boxes.slice(i+1).forEach(other=>assert.equal(overlaps(box,other),false,`${box.id}/${other.id}`));
      if(box.rank>0) {
        const previous=boxes.find(c=>c.lane===box.lane&&c.rank===box.rank-1);
        assert.equal(box.offset,previous.offset+M.FOOTPRINTS[previous.footprint].depth);
        const touch=box.side==='北'?box.z+box.d===previous.z:box.side==='南'?box.z===previous.z+previous.d:box.side==='西'?box.x+box.w===previous.x:box.x===previous.x+previous.w;
        assert.equal(touch,true);
      } else assert.equal(box.offset,0);
    });
    assert.equal(boxes.filter(c=>c.lane===0).length,depth);
    assert.ok(state.moduleHeight<=state.floorHeight);M.validate(state);
  }
});
test('user scope changes only that user and keeps quantity, position and other users', () => {
  const state=M.seed(),original=M.clone(state),floor=state.floors[3],id=floor.users[0].id;
  const p=M.proposal(state,{scope:'user',floorIndex:3,userId:id,weights:allFocus});
  assert.deepEqual(state,original);
  p.next.floors.forEach((f,i)=>{if(i!==3)assert.deepEqual(f,state.floors[i]);});
  p.next.floors[3].cubes.forEach((c,i)=>{
    assert.equal(c.id,floor.cubes[i].id);assert.equal(c.lane,floor.cubes[i].lane);assert.equal(c.rank,floor.cubes[i].rank);assert.equal(c.footprint,floor.cubes[i].footprint);
    if(c.userId===id)assert.equal(c.program,'focus');else assert.deepEqual(c,floor.cubes[i]);
  });
  assert.ok(p.changes.length>0);assert.deepEqual(p.next.floors[3].users[1],floor.users[1]);
});
test('floor scope leaves all other floors intact; building scope updates every user', () => {
  const state=M.seed(),p=M.proposal(state,{scope:'floor',floorIndex:2,weights:allFocus});
  p.next.floors.forEach((f,i)=>i===2?assert.ok(f.cubes.every(c=>c.program==='focus')):assert.deepEqual(f,state.floors[i]));
  const all=M.proposal(state,{scope:'building',floorIndex:2,weights:allFocus});
  assert.equal(all.affectedFloors.length,state.floors.length);
  all.next.floors.forEach(f=>{assert.ok(f.cubes.every(c=>c.program==='focus'));f.users.forEach(u=>assert.deepEqual(u.demand,allFocus));});
});
test('reject invalid imports and invalid geometry without mutating existing design', () => {
  const state=M.seed(),before=M.clone(state);
  for (const alter of [s=>s.core.width=24,s=>s.floorHeight=1,s=>{s.floors[0].cubes[1].lane=s.floors[0].cubes[0].lane;s.floors[0].cubes[1].rank=s.floors[0].cubes[0].rank;},s=>s.floors[0].cubes[0].userId='missing',s=>s.floors[0].users[0].demand.focus=-1,s=>s.floors[0].cubes[0].footprint='5x5',s=>s.floors[0].cubes[0].rank=6,s=>s.projectionDepth=1]) {
    const bad=M.clone(state);alter(bad);assert.throws(()=>M.validate(bad));
  }
  assert.throws(()=>M.configure(state,{floorCount:8,moduleHeight:4,floorHeight:3}));
  assert.throws(()=>M.proposal(state,{scope:'floor',floorIndex:0,weights:{focus:0,collaborate:0,make:0,social:0,garden:0}}));
  assert.deepEqual(state,before);
});
test('garden demand updates program and area while repacking outer terraces',()=>{
  const state=M.seed(),weights={focus:0,collaborate:0,make:0,social:0,garden:100};
  const p=M.proposal(state,{scope:'building',floorIndex:0,weights});
  const before=M.stats(state),after=M.stats(p.next);
  assert.ok(p.next.floors.every(f=>f.cubes.every(c=>c.program==='garden')));
  assert.equal(after.gardenArea,before.moduleArea);assert.equal(after.indoorArea,0);assert.equal(after.moduleArea,before.moduleArea);
  p.next.floors.forEach(f=>assert.ok(M.geometry(p.next,f).every(c=>c.w===4&&c.d===4)));
});
test('random layout preserves counts, ownership and colors; migration retains contents and normalizes footprints',()=>{
  const state=M.seed(),original=M.clone(state),next=M.randomizeLayout(state,()=>.35);
  assert.deepEqual(state,original);
  next.floors.forEach((f,i)=>{
    assert.deepEqual(f.cubes.map(({lane,rank,...c})=>c),state.floors[i].cubes.map(({lane,rank,...c})=>c));
  });
  assert.notDeepEqual(next.floors,state.floors);M.validate(next);
  const old=M.clone(state);delete old.layoutVersion;old.defaultFootprint='6x6';old.floors[0].cubes[0].footprint='6x3';
  const migrated=M.validate(old);assert.ok(migrated.floors.every(f=>f.cubes.every(c=>c.footprint==='4x4')));
  assert.deepEqual(M.stats(migrated).counts,M.stats(state).counts);
  assert.throws(()=>M.setFootprint(state,0,'L1-C1','6x6'));
  for(let j=0;j<30;j++) {
    const randomized=M.randomizeLayout(state);M.validate(randomized);
    for(const f of randomized.floors) {
      const boxes=M.geometry(randomized,f);
      for(const box of boxes.filter(c=>c.program!=='garden'))if(box.offset>0)assert.ok(boxes.some(c=>c.program!=='garden'&&c.lane===box.lane&&c.offset===box.offset-4));
    }
  }
});
test('v1 import preserves IDs, users, programs and quantities while adding zero garden demand',()=>{
  const old={format:'adaptive-office-v1',core:{width:12,depth:24},cubeSize:6,floorHeight:6,revision:4,floors:[{id:'L1',name:'旧方案',users:[{id:'L1-U1',name:'旧用户',demand:{focus:50,collaborate:20,make:10,social:20}}],cubes:[0,1,2].map((slot)=>({id:`L1-C${slot+1}`,slot,userId:'L1-U1',program:['focus','make','social'][slot]}))}]};
  const before=M.clone(old),next=M.validate(old);
  assert.deepEqual(old,before);assert.equal(next.format,'adaptive-office-v2');assert.equal(next.floors[0].users[0].demand.garden,0);
  assert.deepEqual(next.floors[0].cubes.map(c=>[c.id,c.program,c.userId]),old.floors[0].cubes.map(c=>[c.id,c.program,c.userId]));
  assert.ok(next.floors[0].cubes.every(c=>c.footprint==='4x4'));
  assert.deepEqual(M.validate(JSON.parse(JSON.stringify(next))),next);
});
test('legacy compatibility files retain their recorded checksums', () => {
  const hashes=require('./legacy-hashes.json'),crypto=require('node:crypto');
  for(const [name,expected] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',name),'utf8').replace(/\r\n/g,'\n')).digest('hex'),expected,name);
});

test('building-wide side counts apply atomically to every floor',()=>{
  const state=M.setDisabledSides(M.seed(),[]),before=M.clone(state),counts={'北':5,'南':7,'西':10,'东':8};
  const next=M.setBuildingSideCounts(state,counts);
  for(const f of next.floors)for(const side of Object.keys(counts))assert.equal(M.geometry(next,f).filter(c=>c.side===side).length,counts[side]);
  assert.deepEqual(state,before);M.validate(next);
  for(const bad of [{'北':19,'南':7,'西':10,'东':8},{'北':0,'南':0,'西':0,'东':0},{'北':-1,'南':7,'西':10,'东':8}])assert.throws(()=>M.setBuildingSideCounts(state,bad));
});
test('all chains extend perpendicular to the core, with terminal gardens and no lateral branches or overlaps',()=>{
  const overlap=(a,b)=>a.x<b.x+b.w-1e-7&&a.x+a.w>b.x+1e-7&&a.z<b.z+b.d-1e-7&&a.z+a.d>b.z+1e-7;
  const touch=(a,b)=>((Math.abs(a.x+a.w-b.x)<1e-7||Math.abs(b.x+b.w-a.x)<1e-7)&&Math.min(a.z+a.d,b.z+b.d)>Math.max(a.z,b.z)+1e-7)||((Math.abs(a.z+a.d-b.z)<1e-7||Math.abs(b.z+b.d-a.z)<1e-7)&&Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)+1e-7);
  for(let run=0;run<25;run++) {
    let state=M.seed();
    if(run%2===0)state=M.proposal(state,{scope:'building',floorIndex:0,weights:{focus:100-run*4,collaborate:0,make:0,social:0,garden:run*4}}).next;
    state=M.randomizeLayout(state);
    for(const floor of state.floors){
      const boxes=M.geometry(state,floor),core={x:-6,z:-12,w:12,d:24};
      boxes.forEach((box,i)=>{assert.equal(overlap(box,core),false);boxes.slice(i+1).forEach(other=>assert.equal(overlap(box,other),false));});
      for(let lane=0;lane<M.lanes().length;lane++){
        const indoor=boxes.filter(c=>c.lane===lane&&c.program!=='garden'),gardens=boxes.filter(c=>c.lane===lane&&c.program==='garden');
        const chain=boxes.filter(c=>c.lane===lane).sort((a,b)=>a.offset-b.offset);
        chain.forEach((c,i)=>{assert.equal(c.offset,i*4);const axis=M.lanes()[lane];assert.equal(axis.side==='北'||axis.side==='南'?c.x+2:c.z+2,axis.t);});
        const edge=Math.max(0,...indoor.map(c=>c.offset+4));
        gardens.forEach((g,i)=>{assert.ok(g.offset>=edge);assert.ok([core,...indoor,...gardens.slice(0,i)].some(c=>touch(g,c)));});
      }
    }
  }
});

test('all module boundaries use the same 4m grid, with 3 short-side and 6 long-side slots',()=>{
  const state=M.seed();assert.equal(state.floorHeight,4);assert.equal(state.moduleHeight,4);
  for(const side of ['北','南'])assert.equal(M.lanes().filter(l=>l.side===side).length,3);
  for(const side of ['西','东'])assert.equal(M.lanes().filter(l=>l.side===side).length,6);
  for(const f of state.floors)for(const c of M.geometry(state,f)){
    assert.equal(c.w,4);assert.equal(c.d,4);assert.equal(c.h,4);
    assert.equal(Math.abs((c.x+6)%4),0);assert.equal(Math.abs((c.z+12)%4),0);
  }
  const legacy=M.clone(state);legacy.disabledSides=[];delete legacy.gridSize;
  legacy.moduleHeight=3;legacy.floorHeight=3;legacy.defaultFootprint='3x3';
  const sides=['北','南','西','东','北','南','西','东','西','东','西','东'];
  legacy.floors.forEach(f=>f.cubes.forEach((c,i)=>{c.lane=Math.floor(i/3);c.rank=i%3;c.footprint='3x3';}));
  const migrated=M.validate(legacy);assert.equal(migrated.floorHeight,4);
  migrated.floors.forEach((f,i)=>{for(const side of ['北','南','西','东'])assert.equal(f.cubes.filter(c=>M.lanes()[c.lane].side===side).length,legacy.floors[i].cubes.filter(c=>sides[c.lane]===side).length);});
  assert.deepEqual(M.validate(migrated),migrated);
});
const testDirections = () => {
  const state=M.seed(),before=M.clone(state),next=M.setDisabledSides(state,['北','南']);
  assert.equal(M.capacity(next),36);assert.deepEqual(state,before);
  const check=s=>{M.validate(s);s.floors.forEach(f=>assert.ok(M.geometry(s,f).every(c=>['东','西'].includes(c.side))));};
  check(next);assert.deepEqual(M.stats(next).counts,M.stats(state).counts);
  for(let i=0;i<20;i++)check(M.randomizeLayout(next));
  check(M.randomizeFloorCounts(next,25,36));
  check(M.configure(next,{floorCount:9,floorHeight:4,moduleHeight:4}));
  check(M.setBuildingSideCounts(next,{'北':0,'南':0,'西':10,'东':9}));
  assert.throws(()=>M.setBuildingSideCounts(next,{'北':1,'南':0,'西':10,'东':9}));
  assert.throws(()=>M.setDisabledSides(state,['北','南','西','东']));
  assert.throws(()=>M.setDisabledSides(state,['北','南','西']));
  assert.deepEqual(M.validate(JSON.parse(JSON.stringify(next))),next);
  const invalid=M.clone(state);invalid.disabledSides=['北','南'];invalid.floors[0].cubes[0].lane=0;assert.throws(()=>M.validate(invalid));
};
test('disabled directions persist through randomization, configuration and side-count edits',testDirections);


test('balanced baseline has exact mix, shallow varied chains and separated gardens',()=>{
 const s=M.seed();assert.deepEqual(M.stats(s).counts,{focus:80,collaborate:32,make:16,social:16,garden:16});
 let prev=[];const profiles=[];
 for(const f of s.floors){const boxes=M.geometry(s,f);assert.ok(boxes.every(c=>c.offset<=4));const gardens=boxes.filter(c=>c.program==='garden');assert.equal(gardens.length,2);assert.deepEqual(new Set(gardens.map(c=>c.side)),new Set(['东','西']));assert.ok(gardens.every(c=>!prev.includes(c.lane)));prev=gardens.map(c=>c.lane);const lengths=M.lanes().map((_,i)=>boxes.filter(c=>c.lane===i).length);assert.ok(lengths.includes(1));profiles.push(JSON.stringify(lengths));}
 assert.equal(new Set(profiles).size,8);
 for(let i=0;i<10;i++)assert.ok(M.randomizeLayout(s).floors.every(f=>f.cubes.every(c=>c.rank<2)));
});

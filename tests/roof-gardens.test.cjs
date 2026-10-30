const test=require('node:test'),assert=require('node:assert/strict'),M=require('../dist/office-model.js'),A=require('../dist/office-archives.js');
test('automatic terraces occupy every exposed indoor top except building roof, without recursion',()=>{
 const s=M.seed();s.roofGardens=true;let expected=0;
 s.floors.forEach((f,fi)=>{const rendered=M.displayGeometry(s,f),raw=M.geometry(s,f);assert.equal(new Set(rendered.map(c=>`${c.x}:${c.z}`)).size,rendered.length);const extras=rendered.filter(c=>c.automaticRoof);if(!fi)assert.equal(extras.length,0);else {const exposed=M.geometry(s,s.floors[fi-1]).filter(c=>c.program!=='garden'&&!raw.some(o=>o.x===c.x&&o.z===c.z));assert.equal(extras.length,exposed.length);expected+=exposed.length;extras.forEach(c=>assert.ok(exposed.some(o=>o.id===c.supportId&&o.x===c.x&&o.z===c.z)));}});
 assert.ok(expected>0);assert.equal(M.stats(s).cubes,160+expected);assert.equal(M.stats(s).counts.garden,16+expected);
 const saved=A.create(s,'roof','roof-test',new Date().toISOString());assert.equal(saved.modules.length,160+expected);assert.ok(saved.modules.every(c=>c.floorIndex<8));assert.deepEqual(A.read(saved),saved);
 const off=M.clone(s);off.roofGardens=false;assert.equal(M.stats(off).cubes,160);assert.deepEqual(off.floors,s.floors);
});
test('terraces update in AI preview without mutating saved state',()=>{const s=M.seed();s.roofGardens=true;const before=JSON.stringify(s);const p=M.proposeFeedback(s,{scope:'building',floorIndex:0},{focus:-2,collaborate:0,make:0,social:0,garden:2},20);assert.equal(JSON.stringify(s),before);assert.equal(p.next.roofGardens,true);const a=A.create(p.next,'preview','preview',new Date().toISOString());assert.equal(a.modules.length,M.stats(p.next).cubes);});

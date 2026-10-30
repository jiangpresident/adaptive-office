const test=require('node:test'),assert=require('node:assert/strict'),M=require('../dist/office-model.js'),L=require('../dist/office-logistics.js');
test('320 slots retain five spares per program and upgrade old inventory without additions',()=>{const inv=L.stock();assert.equal(inv.length,320);assert.equal(inv.filter(Boolean).length,25);for(const k of M.KEYS)assert.equal(inv.filter(c=>c?.program===k).length,5);const old=[...inv,...Array(80).fill(null)],copy=JSON.stringify(old),up=L.normalizeStock(old);assert.equal(up.length,320);assert.equal(up.filter(Boolean).length,25);assert.equal(JSON.stringify(old),copy);assert.equal(up.filter(v=>!v).length,295);});
test('bottom storage tier uses depth 84m and fixed lift well',()=>{const s=M.seed(),site=L.layout(s);assert.equal(L.rack(79,0,site)[1],-84);const inv=Array(80).fill(null);inv[75]={program:'focus'};const p=L.manual(s,inv,'deploy',0,12,'focus'),run=L.create(s,p.next,inv);let bottom=false,n=0;while(!run.done&&n++<10000){L.tick(run,.5);L.validate(run);if(run.lifter?.[1]===-84)bottom=true;}assert.ok(run.done);assert.ok(bottom);});

test('preflight rejects intermediate overflow but accepts deploy-before-recover',()=>{const inv=L.stock();for(let i=0;i<64;i++)inv[i*5+4]={program:'garden'};const recover={kind:'recover',cube:{program:'garden'}},deploy={kind:'deploy',cube:{program:'garden'}};const before=JSON.stringify(inv);assert.throws(()=>L.checkCapacity([recover,deploy],inv),/第 1 步.*65.*64/);assert.equal(L.checkCapacity([deploy,recover],inv).garden,64);assert.equal(JSON.stringify(inv),before);});
test('migration never discards inventory above 64',()=>{const inv=Array(325).fill(null);for(let i=0;i<65;i++)inv[i*5+4]={program:'garden'};const before=JSON.stringify(inv);assert.throws(()=>L.normalizeStock(inv),/花园平台.*65.*64/);assert.equal(JSON.stringify(inv),before);});

test('hidden inventory remains usable within the sixteen-level visible tower',()=>{
 const inv=Array(320).fill(null);for(let i=0;i<30;i++)inv[i*5+4]={program:'garden'};
 const packed=L.normalizeStock(inv);assert.equal(packed.filter(Boolean).length,30);assert.equal(packed.slice(0,80).filter(Boolean).length,16);
 assert.equal(L.rack(149,0,L.layout(M.seed()))[1],-84);
 const before=M.seed();before.roofGardens=true;const after=M.clone(before);after.roofGardens=false;
 const run=L.create(before,after,packed);let n=0;while(!run.done&&n++<20000){L.tick(run,1);L.validate(run);assert.ok(!run.lifter||run.lifter[1]>=-84);}
 assert.ok(run.done);assert.equal(run.stock.filter(Boolean).length,45);
 const reverse=L.create(after,before,run.stock);n=0;while(!reverse.done&&n++<20000){L.tick(reverse,1);L.validate(reverse);}assert.ok(reverse.done);assert.equal(reverse.stock.filter(Boolean).length,30);
});

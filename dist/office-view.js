(function () {
  'use strict';
  const L=window.OfficeLogistics;
  let transport=null,inventory=L.stock(),rotorAngle=0,transportPaused=false,transportLast=0,transportFrameId=null,dispatchPreview=null;
  let showWarehouse=true,inventoryLoadError='';
  let viewMode='space';const viewCameras={space:{yaw:-.65,pitch:.42,zoom:1,isolated:false},logistics:{yaw:2.45,pitch:.42,zoom:1,isolated:false}};
  const M = window.OfficeModel, $ = id => document.getElementById(id), canvas = $('officeCanvas'), ctx = canvas.getContext('2d');
  const STORAGE = 'adaptive-office.building.v1', esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let state = M.seed(), floorIndex = 3, selectedCube = null, pending = null, history = [], isolated = false;
  let yaw = -.65, pitch = .42, zoom = 1, W = 800, H = 570, hits = [], frame, drag = null, stored = false, migrated = false;
  let projection = {scale:1,x:0,y:0},pickBoxes=[];
  try {
    const saved=localStorage.getItem(STORAGE);
    if(saved) {
      const raw=JSON.parse(saved);state=M.validate(raw);stored=true;
      if(raw.gridSize!==4||JSON.stringify(raw)!==JSON.stringify(state)) {
        const backup=STORAGE+'.before-grid-4m';
        if(!localStorage.getItem(backup))localStorage.setItem(backup,saved);
        localStorage.setItem(STORAGE,JSON.stringify(state));migrated=true;
      }
    }
  } catch { $('officeStatus').textContent = '保存资料无法读取或升级，已显示演示方案；原始资料未覆盖。'; }
  try{const saved=JSON.parse(localStorage.getItem(STORAGE+'.logistics'));if(saved){inventory=L.normalizeStock(saved.stock);rotorAngle=saved.angle||0;}}catch(e){inventoryLoadError=e.message;}
  floorIndex = Math.min(floorIndex, state.floors.length - 1);
  const currentFloor = () => state.floors[floorIndex];
  const currentUser = () => currentFloor().users.find(u => u.id === $('officeUser').value) || currentFloor().users[0];
  function status(message) { $('officeStatus').textContent = message; }
  function persist() {
    if(inventoryLoadError){status(inventoryLoadError);return false;}
    try { localStorage.setItem(STORAGE, JSON.stringify(state));localStorage.setItem(STORAGE+'.logistics',JSON.stringify({stock:inventory,angle:rotorAngle})); return true; }
    catch { status('浏览器无法保存，请下载办公方案 JSON。'); return false; }
  }
  function clearProposal() { const wasAI=pending?.ai;pending = null; $('officeProposal').hidden = true;requestDraw();if(wasAI)document.dispatchEvent(new CustomEvent('office:ai-preview',{detail:{status:'cleared'}})); }
  function commit(next, message, nextStock=inventory, nextAngle=rotorAngle) {
    M.validate(next);
    history.push({building:M.clone(state),stock:M.clone(inventory),angle:rotorAngle}); if (history.length > 30) history.shift();
    state = next;inventory=M.clone(nextStock);rotorAngle=nextAngle;dispatchPreview=null;if($('dispatchConfirm'))$('dispatchConfirm').disabled=true; floorIndex = Math.min(floorIndex, state.floors.length - 1);
    selectedCube = null; clearProposal(); refresh();
    if (persist()) status(message + ' · 已保存在本浏览器');
  }
  function weightedDemand() {
    const scope = $('officeScope').value;
    const users = scope === 'building' ? state.floors.flatMap(f => f.users) : scope === 'floor' ? currentFloor().users : [currentUser()];
    return Object.fromEntries(M.KEYS.map(key => [key, Number((users.reduce((s, u) => s + u.demand[key], 0) / users.length).toFixed(3))]));
  }
  function loadSliders() {
    const weights = weightedDemand();
    M.KEYS.forEach(key => { $('demand-' + key).value = weights[key]; $('weight-' + key).value = weights[key]; });
    clearProposal();
  }
  function refresh() {
    $('officeRoofGardens').checked=!!state.roofGardens;
    const stats = M.stats(state), floor = currentFloor(), previousUser = $('officeUser').value;
    $('officeStats').innerHTML = [
      ['楼层', state.floors.length, '层'], ['功能模块', stats.cubes, 'MODULES'], ['室内 / 花园平台', `${stats.indoorArea} / ${stats.gardenArea}`, 'm²'], ['需求主体', stats.users, '用户']
    ].map(([label, value, unit]) => `<div class="office-stat"><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>`).join('');
    $('officeLegend').innerHTML = M.KEYS.map(key => `<span><i style="--swatch:${M.PROGRAMS[key].color}"></i>${M.PROGRAMS[key].label} <small>${stats.counts[key]}</small></span>`).join('');
    $('officeCountRows').innerHTML=state.floors.map((f,i)=>`<label for="officeFloorModules${i}"><span>${esc(f.id)} <small>${esc(f.name)}</small></span><input id="officeFloorModules${i}" data-floor-count="${i}" type="number" min="1" max="${M.capacity(state)}" step="1" value="${f.cubes.length}" aria-label="第 ${i+1} 层模块数量"></label>`).join('');
    $('officeCountCapacity').textContent=`每层可选 1–${M.capacity(state)} 个模块 / ${state.projectionDepth} 排挂接`;
    for(const id of ['officeRandomMin','officeRandomMax']) {
      const input=$(id);input.max=M.capacity(state);
      if(!input.value||Number(input.value)>M.capacity(state))input.value=id==='officeRandomMin'?Math.min(17,M.capacity(state)):Math.min(23,M.capacity(state));
    }
    $('officeFloors').innerHTML = [...state.floors].reverse().map((f, reverseIndex) => {
      const i = state.floors.length - 1 - reverseIndex;
      return `<button data-floor="${i}" aria-pressed="${i === floorIndex}" title="${esc(f.name)}"><span>${String(i + 1).padStart(2, '0')} / ${esc(f.name)}</span><small>${f.cubes.length} ◇</small></button>`;
    }).join('');
    $('officeUser').innerHTML = floor.users.map(u => `<option value="${esc(u.id)}">${esc(u.name)} · ${floor.cubes.filter(c => c.userId === u.id).length} cube</option>`).join('');
    if (floor.users.some(u => u.id === previousUser)) $('officeUser').value = previousUser;
    $('officeFloorCount').value = state.floors.length;
    $('officeDefaultFootprint').value = state.defaultFootprint;
    $('officeProjectionDepth').value = state.projectionDepth;
    $('officeModuleHeight').value = state.moduleHeight;
    $('officeFloorHeight').value = state.floorHeight;
    for(const [side,key] of [['北','North'],['南','South'],['西','West'],['东','East']]) {
      const input=$('officeSide'+key),axes=M.lanes();const enabled=!(state.disabledSides||[]).includes(side);input.max=enabled?axes.filter(a=>a.side===side).length*state.projectionDepth:0;input.disabled=!enabled;$('officeAllow'+key).checked=enabled;
      input.value=floor.cubes.filter(c=>axes[c.lane].side===side).length;
    }
    $('officeUndo').disabled = !history.length;
    $('officeRemoveUser').disabled = floor.users.length < 2;
    $('officeAddUser').disabled = floor.users.length >= 12;
    $('officeDimensions').textContent = `核心筒 12 × 24 m · 最多向外 ${state.projectionDepth} 排 · 4×4×4 m 模块 · 短边 3 格 / 长边 6 格`;
    $('officeHeight').textContent = `${state.floors.length} 层 / 总高 ${state.floors.length * state.floorHeight} M`;
    $('officeViewLabel').textContent = isolated ? `${floor.id} / SINGLE FLOOR` : `${floor.id} 已选 / ALL FLOORS`;
    loadSliders(); detail(); requestDraw();if($("logisticsInventory"))updateInventory();
  }
  function detail() {
    const detailState=pending?.ai?pending.next:state,detailFloor=detailState.floors[floorIndex];
    const cube = M.displayGeometry(detailState,detailFloor).find(c => c.id === selectedCube);
    if(cube?.automaticRoof){$('officeDetail').innerHTML=`<strong>自动屋面花园 · ${esc(detailFloor.id)}</strong><span>由下层 ${esc(cube.supportId)} 承托 · 上方空格自动补花园</span><span>随楼体自动增减，计入存档；不参与需求权重分配。</span>`;return;}
    if (cube) {
      const user = currentFloor().users.find(u => u.id === cube.userId), slot = M.geometry(detailState,detailFloor).find(c=>c.id===cube.id);
      $('officeDetail').innerHTML = `<strong>${esc(cube.id)} · ${M.PROGRAMS[cube.program].label}</strong><span>${esc(user.name)}</span><span>${slot.side}侧 / 向外第 ${slot.offset/4+1} 排 / 高 ${state.moduleHeight} m</span><span>模块平面：4 × 4 m</span>`;
    } else {
      $('officeDetail').innerHTML = `<strong>${esc(currentFloor().id)} · ${esc(currentFloor().name)}</strong><span>${currentFloor().cubes.length} 模块 / 向外 ${state.projectionDepth} 排 / ${currentFloor().users.length} 位用户</span><span>点击模块查看用途 · 固定 4×4×4 m 平面</span>`;
    }
  }
  // An orthographic 3D camera projects metre-based XYZ geometry. Faces are
  // depth-sorted and back-face culled; hit regions use the same visible polygons.
  function camera(point) {
    const centerY = isolated ? (floorIndex + .5) * state.floorHeight : state.floors.length * state.floorHeight * .5;
    const y = point[1] - centerY;
    const x = Math.cos(yaw) * point[0] - Math.sin(yaw) * point[2];
    const z = Math.sin(yaw) * point[0] + Math.cos(yaw) * point[2];
    return [x, y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
  }
  function fitProjection() {
    const b=M.bounds(state,isolated?floorIndex:null),site=transport?.site||L.layout(state),points=[];if(viewMode==='logistics'){const rows=16;b.minY=showWarehouse?-9-(rows-1)*5-5:0;b.maxY=Math.max(b.maxY,site.height+1);b.maxX=Math.max(b.maxX,site.port[0]+22,site.right+4);b.minX=Math.min(b.minX,site.left-4);b.minZ=Math.min(b.minZ,site.port[2]-10);b.maxZ=Math.max(b.maxZ,site.bottom+4);}
    for(const x of [b.minX-3,b.maxX+3])for(const y of [b.minY,b.maxY])for(const z of [b.minZ-3,b.maxZ+3])points.push(camera([x,y,z]));
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    projection={scale:Math.min((W-75)/(maxX-minX),(H-100)/(maxY-minY))*zoom,x:(minX+maxX)/2,y:(minY+maxY)/2};
  }
  function project(point) { const p=camera(point),s=projection.scale;return [W/2+(p[0]-projection.x)*s,H/2-(p[1]-projection.y)*s+12,p[2]]; }
  const faces = [
    { v: [0, 3, 2, 1], normal: [0, 0, -1], shade: .76 },
    { v: [4, 5, 6, 7], normal: [0, 0, 1], shade: .87 },
    { v: [0, 4, 7, 3], normal: [-1, 0, 0], shade: .70 },
    { v: [1, 2, 6, 5], normal: [1, 0, 0], shade: .94 },
    { v: [3, 7, 6, 2], normal: [0, 1, 0], shade: 1.08 },
    { v: [0, 1, 5, 4], normal: [0, -1, 0], shade: .55 }
  ];
  function color(hex, shade, alpha = 1) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${Math.min(255, ((n >> 16) & 255) * shade)},${Math.min(255, ((n >> 8) & 255) * shade)},${Math.min(255, (n & 255) * shade)},${alpha})`;
  }
  let polygons = [];
  function box(x, y, z, w, h, d, hex, options = {}) {
    // Split structures crossing ground, so a large ground polygon cannot sort
    // in front of above-ground modules merely because of its average depth.
    const groundTop=-.05;
    if(viewMode==='logistics'&&options.renderLayer===undefined&&y<groundTop-1e-6&&y+h>groundTop+1e-6){
      box(x,y,z,w,groundTop-y,d,hex,{...options,renderLayer:0});
      box(x,groundTop,z,w,y+h-groundTop,d,hex,{...options,renderLayer:2});return;
    }
    const renderLayer=options.renderLayer??(viewMode==='logistics'?(y+h<=groundTop+1e-6?0:2):2);
    const verts = [[x,y,z],[x+w,y,z],[x+w,y+h,z],[x,y+h,z],[x,y,z+d],[x+w,y,z+d],[x+w,y+h,z+d],[x,y+h,z+d]];
    faces.forEach(face => {
      const n = face.normal;
      const cameraNormalZ = n[1] * Math.sin(pitch) + (Math.sin(yaw) * n[0] + Math.cos(yaw) * n[2]) * Math.cos(pitch);
      if (cameraNormalZ <= .001) return;
      const corners=face.v.map(i=>verts[i]);
      // Large core faces span several module columns. Sort module-sized patches
      // independently, rather than letting the face centre hide nearer modules.
      const length=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
      const nu=options.tileFaces?Math.ceil(length(corners[0],corners[1])/4):1;
      const nv=options.tileFaces?Math.ceil(length(corners[0],corners[3])/4):1;
      const at=(u,v)=>corners[0].map((a,i)=>a+(corners[1][i]-a)*u+(corners[3][i]-a)*v);
      for(let u=0;u<nu;u++)for(let v=0;v<nv;v++){
        const points=[at(u/nu,v/nv),at((u+1)/nu,v/nv),at((u+1)/nu,(v+1)/nv),at(u/nu,(v+1)/nv)].map(project);
        const edges=[v===0,u===nu-1,v===nv-1,u===0];
        polygons.push({ points, edges, tiled:!!options.tileFaces, renderLayer, depth: points.reduce((s, p) => s + p[2], 0) / 4, fill: color(hex, face.shade, options.alpha ?? 1), stroke: options.stroke || color(hex, .48), width: options.width || .7, id: options.id, floor: options.floor });
      }
    });
  }
  function line(points, stroke, width = 1) {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
  }
  function furniture(cube, x, y, z, floor, active) {
    const w=cube.w,d=cube.d,col=active?'#d7dfca':'#8f9d83';
    const props = { id: cube.id, floor, alpha: active ? 1 : .85 };
    const smallBox = (a,b,c,bw,h,bd,hex=col) => box(x+a,y+b,z+c,bw,h,bd,hex,props);
    if (cube.program === 'focus') {
      const desks=w>=5?[.55,w-1.95]:[(w-1.4)/2];
      for(const dx of desks) {
        smallBox(dx,.74,.5,1.4,.07,.7);
        smallBox(dx+.2,.81,.58,1,.45,.06,'#30493c');
        smallBox(dx+.45,.42,1.5,.5,.45,.5,'#607747');
      }
    } else if (cube.program === 'collaborate') {
      const tw=w>=5?2.4:1.4,td=.85,tx=(w-tw)/2,tz=(d-td)/2;
      smallBox(tx,.73,tz,tw,.08,td);
      for(const dx of [tx+.1,tx+tw-.6]) {smallBox(dx,.42,tz-.65,.5,.45,.5,'#476877');smallBox(dx,.42,tz+td+.15,.5,.45,.5,'#476877');}
    } else if (cube.program === 'make') {
      const tx=(w-1.8)/2;
      smallBox(tx,.86,.45,1.8,.09,.75,'#c9b9d4');
      smallBox(tx+.25,.95,.5,.65,.75,.6,'#695574');
      smallBox((w-1.5)/2,0,d-.7,1.5,.8,.5,'#927c9e');
    } else if(cube.program==='garden') {
      smallBox(.25,.17,.25,w-.5,.12,.7,'#607c45');
      const trees=w>=5?[.9,w-1]:[w/2];
      trees.forEach(dx=>{smallBox(dx-.07,.3,.5,.14,1.1,.14,'#947958');smallBox(dx-.45,1.2,.2,.9,.8,.9,'#63a86b');smallBox(dx-.32,2,.33,.65,.35,.65,'#88bb68');});
      smallBox((w-1.5)/2,.45,d-1.1,1.5,.12,.45,'#bcac7c');
      smallBox((w-1.5)/2,.57,d-.75,1.5,.55,.1,'#a59366');
    } else {
      const tx=(w-1.7)/2;
      smallBox(tx,.2,.4,1.7,.35,.75,'#b98a5b');smallBox(tx,.55,.4,1.7,.65,.15,'#aa7a50');
      smallBox((w-.85)/2,.5,d-1.1,.85,.06,.55);
    }
  }
  function draw() {
    frame = null;
    const scene=viewMode==='logistics'?(transport?.scene||state):(transport?.after||pending?.next||state);
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    W = rect.width; H = rect.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(W*ratio) || canvas.height !== Math.round(H*ratio)) { canvas.width = Math.round(W*ratio); canvas.height = Math.round(H*ratio); }
    ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,W,H); polygons = []; hits = [];pickBoxes=[];
    fitProjection();
    $('officeViewLabel').textContent=viewMode==='logistics'?(transport?'调度演示 · 正在搬运':'调度演示 · 待命'):pending?.ai?'AI 预览 · 尚未应用':(isolated?`${state.floors[floorIndex].id} / SINGLE FLOOR`:`${state.floors[floorIndex].id} 已选 / ALL FLOORS`);
    const baseY = isolated ? floorIndex * scene.floorHeight - .3 : -.3;
    const extent=M.bounds(scene,isolated?floorIndex:null),grid=Math.ceil(Math.max(Math.abs(extent.minX),Math.abs(extent.maxX),Math.abs(extent.minZ),Math.abs(extent.maxZ))/4)*4+12;
    for(let i=-grid;i<=grid;i+=4) {
      line([project([i+2,baseY,-grid]),project([i+2,baseY,grid])], '#273324', .6);
      line([project([-grid,baseY,i]),project([grid,baseY,i])], '#273324', .6);
    }
    scene.floors.forEach((floor, fi) => {
      if (isolated && fi !== floorIndex) return;
      const base = fi * scene.floorHeight, active = fi === floorIndex;
      box(-6,base,-12,12,scene.floorHeight-.14,24,active?'#536046':'#394431',{ stroke: '#798365', width:.8,alpha:1,tileFaces:true });
      pickBoxes.push({x:-6,y:base,z:-12,w:12,h:scene.floorHeight-.14,d:24});
      (viewMode==='logistics'&&transport?floor.cubes:M.displayGeometry(scene,floor)).forEach(cube => {
        const {x,z,w,d,h}=cube,hex=M.PROGRAMS[cube.program].color;
        pickBoxes.push({id:cube.id,floor:fi,x,y:base,z,w,h,d});
        const selected = !pending?.ai && selectedCube === cube.id;
        const options = { id:cube.id, floor:fi, stroke:selected?'#edffaf':active?color(hex,.8):'#536047', width:selected?2:active?1:.6 };
        const post=.10;
        if(cube.program==='garden') {
          box(x,base,z,w,.17,d,hex,options);
          // Open terrace: planting, seating and a low perimeter guard, no roof frame.
          for(const dx of [0,w-post])for(const dz of [0,d-post])box(x+dx,base,z+dz,post,1.1,post,hex,options);
          box(x,base+1.05,z,w,.05,post,hex,options);box(x,base+1.05,z+d-post,w,.05,post,hex,options);
          box(x,base+1.05,z,post,.05,d,hex,options);box(x+w-post,base+1.05,z,post,.05,d,hex,options);
        } else {
          // One opaque volume per module; program colors match the legend.
          box(x,base,z,w,h,d,hex,options);
        }
        if(cube.program==='garden') furniture(cube,x,base,z,fi,active);
      });
    });
    if(viewMode==='logistics')drawLogistics();
    polygons.sort((a,b)=>a.renderLayer-b.renderLayer||a.depth-b.depth);
    polygons.forEach(poly => {
      ctx.beginPath(); poly.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
      ctx.fillStyle=poly.fill;ctx.fill();if(poly.tiled){ctx.strokeStyle=poly.fill;ctx.lineWidth=.6;ctx.stroke();}ctx.strokeStyle=poly.stroke;ctx.lineWidth=poly.width;
      ctx.beginPath();poly.edges.forEach((edge,i)=>{if(edge){const a=poly.points[i],b=poly.points[(i+1)%4];ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);}});ctx.stroke();
      hits.push(poly);
    });
    if(viewMode==='logistics'&&showWarehouse)drawColumnLabels();
    // Dimension annotations are tied to the actual 12 × 24 m core coordinates.
    const y = isolated ? floorIndex * scene.floorHeight : 0;
    const dimension = (a,b,label) => {
      const p=project(a),q=project(b);line([p,q],'#a4b67c',1);const mx=(p[0]+q[0])/2,my=(p[1]+q[1])/2;
      ctx.font='11px monospace';const tw=ctx.measureText(label).width;ctx.fillStyle='#10170f';ctx.fillRect(mx-tw/2-5,my-9,tw+10,17);ctx.fillStyle='#c3d794';ctx.textAlign='center';ctx.fillText(label,mx,my+3);
    };
    dimension([-6,y,extent.maxZ+3],[6,y,extent.maxZ+3],'12 M');dimension([extent.maxX+3,y,-12],[extent.maxX+3,y,12],'24 M');
    const north=camera([0,0,-1]),origin=camera([0,0,0]),nx=north[0]-origin[0],ny=-(north[1]-origin[1]),norm=Math.hypot(nx,ny)||1;
    const ax=W-37,ay=H-46,bx=ax+nx/norm*23,by=ay+ny/norm*23;
    ctx.textAlign='left';ctx.font='10px monospace';ctx.fillStyle='#91a57e';ctx.fillText('N',bx-3,by-7);
    line([[ax,ay],[bx,by]],'#91a57e');
  }
  function requestDraw() { if (!frame) frame = requestAnimationFrame(draw); }
  function inside(point, polygon) {
    let hit = false;
    for (let i = 0, j = polygon.length-1; i < polygon.length; j=i++) {
      const a=polygon[i],b=polygon[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
    }
    return hit;
  }
  function selectAt(x,y) {
    if(transport||viewMode==='logistics')return;
    // Pick the complete module envelope, including its open faces. A ray/core
    // intersection prevents clicking through the opaque core to hidden modules.
    const cx=(x-W/2)/projection.scale+projection.x,cy=-(y-H/2-12)/projection.scale+projection.y;
    const centerY=isolated?(floorIndex+.5)*state.floorHeight:state.floors.length*state.floorHeight*.5;
    const inverse=(a,b,c)=>[Math.cos(yaw)*a+Math.sin(yaw)*(-Math.sin(pitch)*b+Math.cos(pitch)*c),centerY+Math.cos(pitch)*b+Math.sin(pitch)*c,-Math.sin(yaw)*a+Math.cos(yaw)*(-Math.sin(pitch)*b+Math.cos(pitch)*c)];
    const origin=inverse(cx,cy,10000),direction=[-Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
    let hit=null,nearest=Infinity;
    for(const candidate of pickBoxes) {
      let near=0,far=Infinity;
      for(const [axis,min,max] of [[0,candidate.x,candidate.x+candidate.w],[1,candidate.y,candidate.y+candidate.h],[2,candidate.z,candidate.z+candidate.d]]) {
        if(Math.abs(direction[axis])<1e-9) {if(origin[axis]<min||origin[axis]>max){far=-1;break;}continue;}
        const a=(min-origin[axis])/direction[axis],b=(max-origin[axis])/direction[axis];
        near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));
      }
      if(far>=near&&near<nearest){nearest=near;hit=candidate;}
    }
    if (!hit?.id) { selectedCube=null; detail(); requestDraw();return; }
    if(pending?.ai&&hit.floor===floorIndex){selectedCube=hit.id;detail();requestDraw();return;}
    floorIndex=hit.floor;selectedCube=hit.id;refresh();
    const cube=currentFloor().cubes.find(c=>c.id===selectedCube);$('officeUser').value=cube.userId;loadSliders();
  }
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,yaw,pitch,moved:0};canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.moved=Math.max(drag.moved,Math.hypot(dx,dy));yaw=drag.yaw+dx*.008;pitch=Math.max(.10,Math.min(1.15,drag.pitch+dy*.006));requestDraw();});
  canvas.addEventListener('pointerup',event=>{if(!drag)return;const didDrag=drag.moved>5;drag=null;if(!didDrag){const r=canvas.getBoundingClientRect();selectAt(event.clientX-r.left,event.clientY-r.top);}});
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  canvas.addEventListener('wheel',event=>{event.preventDefault();zoom=Math.max(.45,Math.min(3,zoom*Math.exp(-event.deltaY*.001)));requestDraw();},{passive:false});
  canvas.addEventListener('keydown',event=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key)){
      event.preventDefault();event.stopPropagation();
      if(event.key==='ArrowLeft')yaw-=.12;if(event.key==='ArrowRight')yaw+=.12;
      if(event.key==='ArrowUp')pitch=Math.min(1.15,pitch+.08);if(event.key==='ArrowDown')pitch=Math.max(.1,pitch-.08);
      if(event.key==='+'||event.key==='=')zoom=Math.min(3,zoom*1.1);if(event.key==='-')zoom=Math.max(.45,zoom/1.1);requestDraw();
    }
  });
  $('officeSliders').innerHTML=M.KEYS.map(key=>`<div class="office-slider"><label for="demand-${key}">${M.PROGRAMS[key].label}<output id="weight-${key}" for="demand-${key}">0</output></label><input id="demand-${key}" type="range" min="0" max="100" step="0.001"></div>`).join('');
  M.KEYS.forEach(key=>$('demand-'+key).addEventListener('input',()=>{$('weight-'+key).value=$('demand-'+key).value;clearProposal();}));
  $('officeScope').addEventListener('change',loadSliders);$('officeUser').addEventListener('change',loadSliders);
  $('officeFloors').addEventListener('click',event=>{const button=event.target.closest('[data-floor]');if(!button)return;floorIndex=Number(button.dataset.floor);selectedCube=null;refresh();});
  $('officeIsolate').addEventListener('click',()=>{isolated=!isolated;zoom=1;$('officeIsolate').setAttribute('aria-pressed',String(isolated));requestDraw();});
  $('officeHome').addEventListener('click',()=>{yaw=viewMode==='logistics'?2.45:-.65;pitch=.42;zoom=1;requestDraw();});
  $('officeZoomIn').addEventListener('click',()=>{zoom=Math.min(3,zoom*1.15);requestDraw();});$('officeZoomOut').addEventListener('click',()=>{zoom=Math.max(.45,zoom/1.15);requestDraw();});
  $('officePreview').addEventListener('click',()=>{
    clearProposal();
    try {
      pending=M.proposal(state,{scope:$('officeScope').value,floorIndex,userId:currentUser().id,weights:Object.fromEntries(M.KEYS.map(key=>[key,Number($('demand-'+key).value)]))});
      const title={user:'当前用户',floor:'当前楼层',building:'整栋楼用户'}[pending.scope];
      $('officeProposal').innerHTML=`<strong>${title} / ${pending.affectedFloors.length} 层 · ${pending.changes.length} 个 cube 改变用途</strong><ul>${pending.changes.length?pending.changes.map(c=>`<li>${esc(c.cube)}：${M.PROGRAMS[c.from].label} → ${M.PROGRAMS[c.to].label}</li>`).join(''):'<li>用途数量无需调整；应用后仍会保存新的需求权重。</li>'}</ul><button id="officeApply" class="office-button office-primary">应用这次空间回应</button> <button id="officeCancel" class="office-button">继续调整</button>`;
      $('officeProposal').hidden=false;
    } catch(error){clearProposal();status(error.message);}
  });
  $('officeProposal').addEventListener('click',event=>{
    if(event.target.closest('#officeApply')&&pending){if(pending.ai){try{applyAI();}catch(e){status(e.message);}return;}try{startTransport(pending);}catch(e){status(e.message);}}
    if(event.target.closest('#officeCancel'))clearProposal();
  });
  $('officeUndo').addEventListener('click',()=>{if(!history.length)return;const previous=history.pop();state=previous.building;inventory=previous.stock;rotorAngle=previous.angle;dispatchPreview=null;floorIndex=Math.min(floorIndex,state.floors.length-1);selectedCube=null;clearProposal();refresh();if(persist())status('已撤销上一次办公楼变更 · 已保存');});
  $('officeConfigure').addEventListener('click',()=>{try{commit(M.configure(state,{floorCount:Number($('officeFloorCount').value),defaultFootprint:$('officeDefaultFootprint').value,projectionDepth:Number($('officeProjectionDepth').value),moduleHeight:Number($('officeModuleHeight').value),floorHeight:Number($('officeFloorHeight').value)}),'模型参数已更新，现有模块尺寸保留');}catch(error){status(error.message);}});
  function applyDirections(sides){try{commit(M.setDisabledSides(state,sides),sides.length?`已禁止 ${sides.join('、')} 侧外挂，后续随机布局也遵守此设置`:'已允许四个方向外挂');}catch(error){status(error.message);}}
  $('officeApplyDirections').addEventListener('click',()=>applyDirections([['北','North'],['南','South'],['西','West'],['东','East']].filter(([side,key])=>!$('officeAllow'+key).checked).map(([side])=>side)));
  $('officeOnlyLongSides').addEventListener('click',()=>applyDirections(['北','南']));
  $('officeResize').addEventListener('click',()=>{try{const counts=Object.fromEntries([['北','North'],['南','South'],['西','West'],['东','East']].map(([side,key])=>[side,Number($('officeSide'+key).value)]));commit(M.setBuildingSideCounts(state,counts),'已将四侧模块数量统一应用到整栋楼每层，花园排列在室内外缘');}catch(error){status(error.message);}});
  $('officeApplyCounts').addEventListener('click',()=>{
    try {
      const counts=Array.from($('officeCountRows').querySelectorAll('[data-floor-count]'),input=>Number(input.value));
      if(counts.every((n,i)=>n===state.floors[i].cubes.length)){status('各层模块数量未变化。');return;}
      const next=M.setFloorCounts(state,counts);commit(next,`已设置各层模块数量：${counts.join(' / ')}`);
    }catch(error){status(error.message);}
  });
  $('officeRandomCounts').addEventListener('click',()=>{
    try {
      const next=M.randomizeFloorCounts(state,Number($('officeRandomMin').value),Number($('officeRandomMax').value));
      commit(next,`已随机各层数量：${next.floors.map(f=>f.cubes.length).join(' / ')}；可撤销`);
    }catch(error){status(error.message);}
  });
  $('officeRandomLayout').addEventListener('click',()=>{try{commit(M.randomizeLayout(state),'已重新随机各层延伸长度，数量与用途保留；可撤销');}catch(error){status(error.message);}});
  function applyInitialLayout() {
    try {
      const backup=STORAGE+'.before-balanced-layout-v2';
      if(!localStorage.getItem(backup))localStorage.setItem(backup,JSON.stringify(state));
    }catch {status('无法保存旧方案备份，请先下载当前办公方案再使用初始布局。');return;}
    isolated=false;zoom=1;$('officeIsolate').setAttribute('aria-pressed','false');
    const initial=M.seed();initial.roofGardens=state.roofGardens;
    commit(initial,'已应用新版初始布局：160 个模块、每层 17–23 个、向外 1–2 格、分散花园；旧方案已备份，可撤销');
  }
  $('officeInitialLayout').addEventListener('click',applyInitialLayout);
  $('officeAddUser').addEventListener('click',()=>{
    const name=$('officeUserName').value.trim();if(!name){status('请填写新增用户名称。');return;}
    if(currentFloor().users.length>=12)return;
    const next=M.clone(state),floor=next.floors[floorIndex];
    let suffix=1;while(floor.users.some(u=>u.id===`${floor.id}-U${suffix}`))suffix++;
    const id=`${floor.id}-U${suffix}`;floor.users.push({id,name,demand:{focus:35,collaborate:25,make:10,social:15,garden:15}});
    M.resizeFloor(next,floorIndex,floor.cubes.length,{redistributeUsers:true});next.revision++;commit(next,'已添加用户并重新分配本层模块');$('officeUser').value=id;$('officeUserName').value='';loadSliders();
  });
  $('officeRemoveUser').addEventListener('click',()=>{
    if(currentFloor().users.length<2)return;
    const id=currentUser().id,next=M.clone(state),floor=next.floors[floorIndex];floor.users=floor.users.filter(u=>u.id!==id);M.resizeFloor(next,floorIndex,floor.cubes.length,{redistributeUsers:true});next.revision++;commit(next,'已移除用户并重新分配本层模块，可撤销');
  });
  function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function save(){download('自适应办公楼.json',JSON.stringify(state,null,2),'application/json');status('已导出办公楼方案，包含各层模块、用户与需求权重。');}
  $('officeSave').addEventListener('click',save);$('officeLoad').addEventListener('click',()=>$('officeImport').click());
  $('officeImport').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>1024*1024){status('办公方案文件过大，请选择 1 MB 以内的 JSON。');return;}
    try{const next=M.validate(JSON.parse(await file.text()));commit(next,'已载入办公楼方案，可撤销');}catch(error){status(error.message);}
  });
  // Capture header file actions so they operate on the visible office model.
  $('saveButton').addEventListener('click',event=>{event.stopImmediatePropagation();save();},true);
  $('importButton').addEventListener('click',event=>{event.stopImmediatePropagation();$('officeImport').click();},true);
  $('exportButton').textContent='导出 3D 图像 PNG ↗';
  $('exportButton').addEventListener('click',event=>{event.stopImmediatePropagation();draw();const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='自适应办公楼-3D.png';a.click();},true);
  $('resetButton').textContent='使用新版初始布局 ↺';
  $('resetButton').addEventListener('click',event=>{event.stopImmediatePropagation();applyInitialLayout();},true);
  document.addEventListener('wishouse:plan-open',()=>{requestDraw();$('officeWorkspace').scrollIntoView({behavior:'smooth',block:'start'});});
  $('chatPanel').insertAdjacentHTML('beforebegin','<p class="office-chat-note">描述办公需求 → GPT 建议 → 3D 预览 → 确认应用。黄色轮廓标出待变更用途，确认前模型不会保存变化。</p>');
  new ResizeObserver(requestDraw).observe(canvas);
  document.addEventListener('office:language',requestDraw);

  const logisticsPanel=document.createElement('section');logisticsPanel.id='logisticsPanel';logisticsPanel.className='office-logistics-panel';
  logisticsPanel.innerHTML=`<strong>模块调度 · 仓库与升降系统</strong><p>短边唯一出口 · 5 竖列 × 64 容量（320 仓位），每列最多显示 16 个，超出隐藏 · 固定地下升降台 · 四立柱桁架。优先复用同用途模块；无法直接转移时回收或调用。库存用途不足时在升降台换装，并显示在步骤中。</p><p id="logisticsInventory"></p><div id="logisticsColumns" class="logistics-columns"></div><p id="logisticsSource"></p><p id="logisticsCapacity" role="status"></p><p id="logisticsStatus" role="status">选择两个存档并计算，或确认 AI 建议开始调度。</p><progress id="logisticsProgress" max="1" value="0"></progress><label>演示速度 <output id="logisticsSpeedText">×3</output><input id="logisticsSpeed" type="range" min="1" max="30" value="3"></label><button id="logisticsPause" disabled>暂停</button> <button id="logisticsCancel" disabled>撤回本次调度</button><details><summary>搬运步骤</summary><ol id="dispatchSteps"></ol></details>`;
  canvas.parentElement.after(logisticsPanel);
  const viewTabs=document.createElement('section');viewTabs.id='officeViewModes';viewTabs.className='office-view-modes';viewTabs.innerHTML='<div><button id="officeSpaceView" aria-pressed="true">01 空间效果</button><button id="officeLogisticsView" aria-pressed="false">02 调度演示</button><button id="toggleWarehouse" aria-pressed="false">隐藏旋转仓库</button></div><p id="officeModeDescription">查看用途与空间变化；确认 AI 方案后进入搬运演示。</p><p id="officeTransportNotice" hidden>正在调度；空间视图显示目标方案，完成前尚未保存。</p>';
  canvas.parentElement.before(viewTabs);logisticsPanel.hidden=true;
  function switchView(mode){if(mode===viewMode)return;viewCameras[viewMode]={yaw,pitch,zoom,isolated};viewMode=mode;({yaw,pitch,zoom,isolated}=viewCameras[mode]);if(mode==='logistics')isolated=false;logisticsPanel.hidden=mode!=='logistics';$('officeSpaceView').setAttribute('aria-pressed',String(mode==='space'));$('officeLogisticsView').setAttribute('aria-pressed',String(mode==='logistics'));$('officeIsolate').hidden=mode==='logistics';$('officeTransportNotice').hidden=!transport||mode!=='space';$('officeModeDescription').textContent=mode==='space'?'查看用途与空间变化；AI 建议先预览再确认。':'查看模块的取出、转移、挂接与回收过程。';requestDraw();}
  $('toggleWarehouse').onclick=()=>{showWarehouse=!showWarehouse;$('toggleWarehouse').textContent=showWarehouse?'隐藏旋转仓库':'显示旋转仓库';$('toggleWarehouse').setAttribute('aria-pressed',String(!showWarehouse));requestDraw();};
  $('officeSpaceView').onclick=()=>switchView('space');$('officeLogisticsView').onclick=()=>switchView('logistics');
  const manual=document.createElement('details');manual.id='integratedManual';manual.innerHTML='<summary>手动调用 / 回收（无需 AI）</summary><div class="office-inputs"><label>楼层<select id="manualFloor"></select></label><label>用途<select id="manualProgram"></select></label><label>挂接列<select id="manualLane"></select></label></div><button id="manualDeploy">预览调用</button> <button id="manualRecover">预览回收</button> <button id="manualConfirm" disabled>确认手动调度</button><p id="manualMessage" role="status"></p>';logisticsPanel.append(manual);
  $('manualProgram').innerHTML=M.KEYS.map(k=>`<option value="${k}">${M.PROGRAMS[k].label}</option>`).join('');
  $('manualLane').innerHTML=M.lanes().map((a,i)=>`<option value="${i}">${a.side}侧 · 列${M.lanes().slice(0,i+1).filter(b=>b.side===a.side).length}</option>`).join('');$('manualLane').value='2';
  let manualPreview=null;
  function previewManual(kind){try{if(transport)throw Error('请等待调度完成。');const p=L.manual(state,inventory,kind,Number($('manualFloor').value),Number($('manualLane').value),$('manualProgram').value),run=L.create(state,p.next,inventory,rotorAngle);manualPreview={p,run,snapshot:JSON.stringify(state),stock:JSON.stringify(inventory)};showQueue(run);$('manualConfirm').disabled=false;$('manualMessage').textContent=`已计算 ${run.queue.length} 步（含承托花园处理），确认前不改变楼体。`;}catch(e){manualPreview=null;$('manualConfirm').disabled=true;$('manualMessage').textContent=e.message;}}
  $('manualDeploy').onclick=()=>previewManual('deploy');$('manualRecover').onclick=()=>previewManual('recover');
  for(const id of ['manualFloor','manualProgram','manualLane'])$(id).onchange=()=>{manualPreview=null;$('manualConfirm').disabled=true;};
  $('manualConfirm').onclick=()=>{try{const v=manualPreview;if(!v||v.snapshot!==JSON.stringify(state)||v.stock!==JSON.stringify(inventory))throw Error('方案已变化，请重新预览。');manualPreview=null;$('manualConfirm').disabled=true;startTransport(v.p,v.run);}catch(e){$('manualMessage').textContent=e.message;}};
  const transferPanel=document.createElement('section');transferPanel.id='manualTransfer';transferPanel.innerHTML='<strong>3D 悬浮格 · 直接转移</strong><p>拖动旋转，滚轮缩放。每个竖立的悬浮正方形代表一个模块位置，内侧模块调暗；可点选多个彩色末端模块，点击「确认来源，选择目的地」后，可点击「存入仓库」批量回收，或再选择相同数量的虚线空位，系统自动匹配。确认来源后才显示可用目标空位，避免空框遮挡模块；背面模块可旋转查看。再次点击取消选择。同列可从外向内连续选择；取消外侧时会同时取消其内侧选择。系统先搬外侧，再搬内侧；可搬模块中优先就近取货。自动屋面花园以绿色虚框标识，由系统配套拆装，不单独点选。</p><div id="transferLegend"></div><div class="office-inputs"><label>从仓库调用用途<select id="transferDeployProgram"></select></label><label>调用数量<input id="transferDeployCount" type="number" min="1" max="64" value="1"></label></div><button id="transferDeployBegin">从仓库调用：选择目的地</button><p id="transferDeployStock"></p><label>显示楼层 <select id="transferVisibleFloor"><option value="all">整栋楼</option></select></label> <button id="transferHome">复位视角</button><svg id="transferGrid" viewBox="0 0 900 600" role="group" aria-label="可旋转的三维模块转移视图"></svg><p id="transferSummary" aria-live="polite"></p><div id="transferPlan" aria-live="polite"></div><button id="transferStore" disabled>存入仓库</button> <button id="transferConfirmSource" disabled>确认来源，选择目的地</button> <button id="transferEditSource" hidden>返回修改来源</button> <button id="transferClear">重新选择</button> <button id="transferStart" disabled>确认转移</button><p id="transferStatus" role="status"></p>';logisticsPanel.append(transferPanel);
  let deployment=null,transferStage='source',gridSource=[],gridTarget=[],gridRevision=JSON.stringify(state),transferSignature='',transferYaw=.65,transferPitch=.55,transferZoom=1,transferDrag=null,suppressTransferClick=false,transferPlan=null,transferPlanKey='',transferPlanError='',transferStep=0;
  $('transferDeployProgram').innerHTML=M.KEYS.map(k=>`<option value="${k}">${M.PROGRAMS[k].label}</option>`).join('');
  $('transferLegend').innerHTML=M.KEYS.map(k=>`<span><i style="background:${M.PROGRAMS[k].color}"></i>${M.PROGRAMS[k].label}</span>`).join('')+'<span>黄框：来源　半透明黄色方形：目标　虚线：可挂接</span>';
  function updateTransfer(){
    if(gridRevision!==JSON.stringify(state)){gridSource=[];gridTarget=[];deployment=null;transferStage='source';gridRevision=JSON.stringify(state);}
    const select=$('transferVisibleFloor');if(select.options.length!==state.floors.length+1){const previous=select.value;select.innerHTML='<option value="all">整栋楼</option>'+state.floors.map((f,i)=>`<option value="${i}">${f.id}</option>`).join('');select.value=previous==='all'||state.floors[Number(previous)]?previous:'all';}
    const required=deployment?deployment.count:gridSource.length;
    const planKey=JSON.stringify([state,inventory,gridSource,gridTarget,deployment]);if(planKey!==transferPlanKey){transferPlanKey=planKey;transferPlan=null;transferPlanError='';transferStep=0;if(required&&required===gridTarget.length){try{transferPlan=deployment?L.deployMany(state,inventory,deployment.program,gridTarget):L.transferMany(state,gridSource,gridTarget);transferPlan.run=L.create(state,transferPlan.next,inventory,rotorAngle,transferPlan.transfer);}catch(e){transferPlan=null;transferPlanError=e.message;}}}
    const sig=JSON.stringify([state,inventory,gridSource,gridTarget,deployment,transferStage,!!transport,transferYaw,transferPitch,transferZoom,select.value,transferStep]);if(sig===transferSignature)return;transferSignature=sig;
    const axes=M.lanes(),depth=state.projectionDepth,height=state.floors.length*4,scale=Math.min(11,450/(height+28))*transferZoom;
    const project=(x,y,z)=>{const rx=Math.cos(transferYaw)*x-Math.sin(transferYaw)*z,rz=Math.sin(transferYaw)*x+Math.cos(transferYaw)*z,cy=y-height/2;return [450+rx*scale,300-(cy*Math.cos(transferPitch)-rz*Math.sin(transferPitch))*scale,cy*Math.sin(transferPitch)+rz*Math.cos(transferPitch)];};
    const pts=points=>points.map(p=>project(...p).slice(0,2).join(',')).join(' '),shapes=[];
    const coreVertices=[[-6,0,-12],[6,0,-12],[6,height,-12],[-6,height,-12],[-6,0,12],[6,0,12],[6,height,12],[-6,height,12]];
    // Sort small core patches with the plates; a whole wall's centre depth
    // cannot represent its occlusion across all eight floors and six columns.
    for(const face of faces){
      const n=face.normal,visible=n[1]*Math.sin(transferPitch)+(Math.sin(transferYaw)*n[0]+Math.cos(transferYaw)*n[2])*Math.cos(transferPitch);if(visible<=.001)continue;
      const corners=face.v.map(i=>coreVertices[i]),length=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
      const nu=Math.ceil(length(corners[0],corners[1])/4),nv=Math.ceil(length(corners[0],corners[3])/4);
      const at=(u,v)=>corners[0].map((a,i)=>a+(corners[1][i]-a)*u+(corners[3][i]-a)*v),fill=color('#86a39a',face.shade);
      for(let u=0;u<nu;u++)for(let v=0;v<nv;v++){
        const patch=[at(u/nu,v/nv),at((u+1)/nu,v/nv),at((u+1)/nu,(v+1)/nv),at(u/nu,(v+1)/nv)];
        shapes.push({depth:patch.reduce((sum,p)=>sum+project(...p)[2],0)/4,html:`<polygon class="transfer-core-face" points="${pts(patch)}" fill="${fill}" stroke="${fill}" stroke-width=".6" style="pointer-events:none"/>`});
      }
    }
    let html='<g fill="none" stroke="#547079" stroke-width="1" stroke-opacity=".55">';
    for(const x of [-6,6])for(const z of [-12,12])html+=`<polyline points="${pts([[x,0,z],[x,height,z]])}"/>`;
    for(let fi=0;fi<state.floors.length;fi++){const y=fi*4+2;html+=`<polyline points="${pts([[-6,y,-12],[6,y,-12],[6,y,12],[-6,y,12],[-6,y,-12]])}"/>`;const p=project(-6,y,-15);shapes.push({depth:p[2],html:`<text class="transfer-floor-label" x="${p[0]}" y="${p[1]}" fill="#ff4966" stroke="#101d20" stroke-width="3" paint-order="stroke" stroke-linejoin="round" font-size="12" font-weight="700" style="pointer-events:none">L${fi+1}</text>`});}html+='</g>';
    for(let fi=0;fi<state.floors.length;fi++){if(select.value!=='all'&&Number(select.value)!==fi)continue;const geo=M.geometry(state,state.floors[fi]);for(let lane=0;lane<axes.length;lane++){const a=axes[lane];if(!['东','西'].includes(a.side))continue;const chain=geo.filter(c=>c.lane===lane).sort((a,b)=>a.offset-b.offset);const valid=transferStage==='target'&&required>0&&!transport&&!gridSource.some(v=>v.fi===fi&&v.lane===lane)&&!(state.disabledSides||[]).includes(a.side)&&(!deployment||deployment.program==='garden'||chain.at(-1)?.program!=='garden');
      for(let pos=0;pos<depth;pos++){const c=chain[pos],outer=!!c&&pos===chain.length-1,available=!c&&valid&&Array.from({length:Math.max(0,pos-chain.length)},(_,i)=>chain.length+i).every(p=>gridTarget.some(t=>t.fi===fi&&t.lane===lane&&t.pos===p)),source=!!c&&gridSource.some(v=>v.id===c.id),target=gridTarget.some(v=>v.fi===fi&&v.lane===lane&&v.pos===pos),enabled=!transport&&(transferStage==='source'?((!!c&&chain.slice(pos+1).every(v=>gridSource.some(s=>s.id===v.id)))||source):(target||(available&&gridTarget.length<(deployment?deployment.count:gridSource.length)))),x=(a.side==='西'?-1:1)*(8+pos*4),z=a.t,y=fi*4+2,r=1.65,p=project(x,y,z),name=`L${fi+1} · ${a.side}侧${axes.slice(0,lane+1).filter(v=>v.side===a.side).length}列 · 第${pos+1}格`,color=c?M.PROGRAMS[c.program].color:target?'#ffe600':'none';
        if(!c&&!available&&!target)continue;
        const frontX=x+(Math.sin(transferYaw)>=0?.22:-.22),backX=2*x-frontX;
        if(c){const front=[[frontX,y-r,z-r],[frontX,y+r,z-r],[frontX,y+r,z+r],[frontX,y-r,z+r]],back=front.map(v=>[backX,v[1],v[2]]),faces=[back,...front.map((v,i)=>[v,front[(i+1)%4],back[(i+1)%4],back[i]])];
          for(const face of faces)shapes.push({depth:face.reduce((sum,v)=>sum+project(...v)[2],0)/4,html:`<polygon points="${pts(face)}" fill="${color}" stroke="#050909" stroke-width="1.3" stroke-linejoin="round" style="pointer-events:none;filter:brightness(${outer?'.65':'.4'})"/>`});
        }
        const faceX=c?frontX:x;
        shapes.push({depth:project(faceX,y,z)[2],html:`<polygon points="${pts([[faceX,y-r,z-r],[faceX,y+r,z-r],[faceX,y+r,z+r],[faceX,y-r,z+r]])}" fill="${color}" fill-opacity="${target?.45:1}" stroke="${c?'#050909':target?'#ffe600':available?'#afeedd':'#050909'}" stroke-width="${target||available?2:1.4}" stroke-linejoin="round" ${c||target?'':'stroke-dasharray="3 2"'} data-fi="${fi}" data-lane="${lane}" data-pos="${pos}" data-enabled="${enabled}" tabindex="${enabled?0:-1}" role="button" aria-disabled="${!enabled}" aria-pressed="${source||target}" aria-label="${name}${c?' '+M.PROGRAMS[c.program].label:''} ${enabled?'可选择':'不可选择'}" style="cursor:${enabled?'pointer':'default'};pointer-events:all;${c&&!outer&&!source?'filter:brightness(.6)':''}"><title>${name}${c?' · '+M.PROGRAMS[c.program].label+' · '+c.id:available?' · 可挂接':' · 空位'}</title></polygon>${source?`<g class="transfer-selected-highlight" style="pointer-events:none"><polygon points="${pts([[faceX,y-r,z-r],[faceX,y+r,z-r],[faceX,y+r,z+r],[faceX,y-r,z+r]])}" fill="#ffe600" fill-opacity=".16" stroke="#102024" stroke-width="7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><polygon points="${pts([[faceX,y-r,z-r],[faceX,y+r,z-r],[faceX,y+r,z+r],[faceX,y-r,z+r]])}" fill="none" stroke="#ffe600" stroke-width="4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></g>`:''}`});
      }
    }}
    state.floors.forEach((floor,fi)=>{if(select.value!=='all'&&Number(select.value)!==fi)return;M.displayGeometry(state,floor).filter(c=>c.automaticRoof&&['东','西'].includes(c.side)).forEach(c=>{const x=c.x+2,y=fi*4+2,z=c.z+2,r=1.65;shapes.push({depth:project(x,y,z)[2],html:`<polygon points="${pts([[x,y-r,z-r],[x,y+r,z-r],[x,y+r,z+r],[x,y-r,z+r]])}" fill="#65cfa0" fill-opacity=".15" stroke="#65cfa0" stroke-width="1.5" stroke-dasharray="4 3" style="pointer-events:none"><title>自动屋面花园 · 系统配套拆装</title></polygon>`});});});
    shapes.sort((a,b)=>a.depth-b.depth);let markers='';
    const jobs=transferPlan?.transfer||[];
    const pointFor=(cube,fi)=>project(cube.x+2,fi*state.floorHeight+2,cube.z+2);
    if(jobs.length){const job=jobs[transferStep],a=pointFor(job.cube,job.fi),b=pointFor(job.targetCube,job.targetFi);if(select.value==='all'||(Number(select.value)===job.fi&&job.fi===job.targetFi))markers+=`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#fff279" stroke-width="2" stroke-dasharray="5 5" style="pointer-events:none"/>`;
      jobs.forEach((job,i)=>{for(const [cube,fi,prefix,color] of [[job.cube,job.fi,'取','#fff279'],[job.targetCube,job.targetFi,'放','#ffffff']]){if(select.value!=='all'&&Number(select.value)!==fi)continue;const p=pointFor(cube,fi);markers+=`<g style="pointer-events:none"><rect x="${p[0]-15}" y="${p[1]-10}" width="30" height="18" rx="4" fill="${i===transferStep?color:'#102024'}" stroke="${color}" stroke-width="${i===transferStep?2:1}"/><text x="${p[0]}" y="${p[1]+3}" text-anchor="middle" font-size="11" font-weight="bold" fill="${i===transferStep?'#102024':color}">${prefix}${i+1}</text></g>`;}});
    }
    $('transferGrid').innerHTML=html+shapes.map(v=>v.html).join('')+markers;
    const label=v=>`L${v.fi+1} · ${axes[v.lane].side}侧${axes.slice(0,v.lane+1).filter(a=>a.side===axes[v.lane].side).length}列 · 第${v.pos+1}格`;
    $('transferSummary').textContent=(transferStage==='source'?'第 1 步：选择要移动的模块。':'第 2 步：选择目的地。')+`已选模块 ${gridSource.length} 个 / 目标 ${gridTarget.length} 个。`+(transferStage==='source'?'从最外端开始向内点选，选好后确认来源。':gridTarget.length<(deployment?deployment.count:gridSource.length)?`还需选择 ${gridSource.length-gridTarget.length} 个目标空位。`:'数量一致，请查看下方顺序预览后确认。')+(gridSource.length?' 来源：'+gridSource.map(label).join('；'):'');
    const planHTML=transferPlanError?`<p class="transfer-plan-error">无法安排：${esc(transferPlanError)}。请调整选择，楼体未改变。</p>`:jobs.length?'<strong>搬运顺序预览 · 尚未应用</strong><p>完整调度共 '+transferPlan.run.queue.length+' 步，包含必要的自动花园拆装。</p><p>黄色「取N」对应白色「放N」。点击某一步查看配对虚线（仅表示对应关系，不是实际搬运路径）。</p><ol>'+jobs.map((job,i)=>`<li><button type="button" data-step="${i}" aria-pressed="${i===transferStep}" ${transport?'disabled':''}>${i+1}. ${M.PROGRAMS[job.cube.program].label} · ${label({fi:job.fi,lane:job.cube.lane,pos:job.cube.offset/4})} → ${label({fi:job.targetFi,lane:job.targetCube.lane,pos:job.targetCube.offset/4})}</button></li>`).join('')+'</ol>':'';
    const shownPlan=deployment&&transferPlan?`<p>调用预览：${M.PROGRAMS[deployment.program].label} ${required} 个，共 ${transferPlan.run.queue.length} 步（含自动花园配套处理）。确认后开始播放。</p>`:planHTML;
    if($('transferPlan').innerHTML!==shownPlan)$('transferPlan').innerHTML=shownPlan;
    if(deployment)$('transferSummary').textContent=`从仓库调用 ${M.PROGRAMS[deployment.program].label} ${required} 个 · 已选目的地 ${gridTarget.length}/${required}。`+(gridTarget.length===required?'请确认调用。':'请从挂接列末端连续选择目的地。');
    $('transferDeployStock').textContent=`${M.PROGRAMS[$('transferDeployProgram').value].label}库存：${inventory.filter(c=>c?.program===$('transferDeployProgram').value).length} 个`;
    for(const id of ['transferDeployProgram','transferDeployCount','transferDeployBegin'])$(id).disabled=!!transport;
    $('transferStore').hidden=transferStage!=='target'||!!deployment;$('transferStore').disabled=!!transport||!gridSource.length;$('transferStore').textContent=gridSource.length?`存入仓库（${gridSource.length} 个）`:'存入仓库';
    $('transferConfirmSource').hidden=transferStage!=='source';$('transferConfirmSource').disabled=!!transport||!gridSource.length;
    $('transferEditSource').hidden=transferStage!=='target';$('transferEditSource').disabled=!!transport;
    $('transferStart').hidden=transferStage!=='target';
    $('transferStart').disabled=!!transport||!transferPlan;$('transferClear').disabled=!!transport;
    $('transferStart').textContent=deployment?`确认调用 ${required} 个模块`:`确认转移${gridSource.length?' '+gridSource.length+' 个模块':''}`;
    $('transferEditSource').textContent=deployment?'返回修改调用用途和数量':'返回修改来源';
  }
  function selectTransferCell(cell){if(!cell||cell.dataset.enabled!=='true'||transport)return;const fi=Number(cell.dataset.fi),lane=Number(cell.dataset.lane),pos=Number(cell.dataset.pos),c=M.geometry(state,state.floors[fi]).filter(c=>c.lane===lane).sort((a,b)=>a.offset-b.offset)[pos];if(c){const found=gridSource.findIndex(v=>v.id===c.id);if(found>=0)gridSource=gridSource.filter(v=>v.fi!==fi||v.lane!==lane||v.pos>pos);else gridSource.push({fi,lane,pos,id:c.id,program:c.program});gridTarget=[];$('transferStatus').textContent='来源已更新，选好后点击「确认来源，选择目的地」。';}else{const found=gridTarget.findIndex(v=>v.fi===fi&&v.lane===lane&&v.pos===pos);if(found>=0)gridTarget=gridTarget.filter(v=>v.fi!==fi||v.lane!==lane||v.pos<pos);else if(gridTarget.length<(deployment?deployment.count:gridSource.length))gridTarget.push({fi,lane,pos});$('transferStatus').textContent='';}updateTransfer();}
  $('transferGrid').onclick=e=>{if(suppressTransferClick){suppressTransferClick=false;return;}selectTransferCell(e.target.closest('[data-fi]'));};
  $('transferGrid').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectTransferCell(e.target.closest('[data-fi]'));}};
  $('transferGrid').onpointerdown=e=>{transferDrag={x:e.clientX,y:e.clientY,yaw:transferYaw,pitch:transferPitch};suppressTransferClick=false;};
  $('transferGrid').onpointermove=e=>{if(!transferDrag)return;const dx=e.clientX-transferDrag.x,dy=e.clientY-transferDrag.y;if(Math.abs(dx)+Math.abs(dy)<5)return;suppressTransferClick=true;$('transferGrid').setPointerCapture(e.pointerId);transferYaw=transferDrag.yaw+dx*.009;transferPitch=Math.max(.15,Math.min(1.2,transferDrag.pitch+dy*.006));updateTransfer();};
  $('transferGrid').onpointerup=e=>{transferDrag=null;if($('transferGrid').hasPointerCapture(e.pointerId))$('transferGrid').releasePointerCapture(e.pointerId);};$('transferGrid').onpointercancel=()=>{transferDrag=null;};
  $('transferGrid').addEventListener('wheel',e=>{e.preventDefault();transferZoom=Math.max(.6,Math.min(2.5,transferZoom*Math.exp(-e.deltaY*.001)));updateTransfer();},{passive:false});
  $('transferVisibleFloor').onchange=updateTransfer;$('transferHome').onclick=()=>{transferYaw=.65;transferPitch=.55;transferZoom=1;updateTransfer();};
  $('transferDeployBegin').onclick=()=>{if(transport)return;const program=$('transferDeployProgram').value,count=Number($('transferDeployCount').value),available=inventory.filter(c=>c?.program===program).length;if(!Number.isInteger(count)||count<1||count>64||count>available){$('transferStatus').textContent=`请输入 1–${Math.min(64,available)} 个；所选用途库存 ${available} 个。`;return;}deployment={program,count};gridSource=[];gridTarget=[];transferStage='target';$('transferStatus').textContent='请在悬浮格中选择目的地，确认前不改变楼体。';updateTransfer();};
  for(const id of ['transferDeployProgram','transferDeployCount'])$(id).onchange=()=>{if(deployment){deployment=null;gridTarget=[];transferStage='source';}transferSignature='';updateTransfer();};
  $('transferStore').onclick=()=>{if(transport||transferStage!=='target'||deployment||!gridSource.length)return;try{const p=L.recoverMany(state,gridSource),run=L.create(state,p.next,inventory,rotorAngle);startTransport(p,run);$('transferStatus').textContent=`正在将所选 ${p.storedCount} 个模块存入仓库，自动屋面花园会配套调整。`;}catch(e){$('transferStatus').textContent=e.message;}};
  $('transferConfirmSource').onclick=()=>{if(transport||!gridSource.length)return;transferStage='target';$('transferStatus').textContent='来源已锁定，请选择目的地。';updateTransfer();};
  $('transferEditSource').onclick=()=>{if(transport)return;deployment=null;transferStage='source';gridTarget=[];$('transferStatus').textContent='可继续修改来源；目的地已清空。';updateTransfer();};
  $('transferClear').onclick=()=>{deployment=null;transferStage='source';gridSource=[];gridTarget=[];$('transferStatus').textContent='';updateTransfer();};
  $('transferPlan').onclick=e=>{const button=e.target.closest('[data-step]');if(!button||transport)return;transferStep=Number(button.dataset.step);$('transferVisibleFloor').value='all';updateTransfer();};
  $('transferStart').onclick=()=>{if(transport)return;updateTransfer();if(!transferPlan)return;try{startTransport(transferPlan,transferPlan.run);updateTransfer();$('transferStatus').textContent=deployment?'正在从仓库调用所选用途模块。':'正在搬运所选模块；如有承托花园，会先回收再补回。';}catch(e){$('transferStatus').textContent=e.message;}};

  $('logisticsSpeed').oninput=()=>{$('logisticsSpeedText').textContent='×'+$('logisticsSpeed').value;};
  $('logisticsPause').onclick=()=>{transportPaused=!transportPaused;$('logisticsPause').textContent=transportPaused?'继续':'暂停';};
  function cancelTransport(message='已撤回调度，楼体和库存保持确认前状态。'){if(transportFrameId!==null)cancelAnimationFrame(transportFrameId);transportFrameId=null;transport=null;transportPaused=false;$('logisticsPause').disabled=$('logisticsCancel').disabled=true;$('officeTransportNotice').hidden=true;$('logisticsPause').textContent='暂停';$('logisticsStatus').textContent=message;refresh();document.dispatchEvent(new CustomEvent('office:ai-preview',{detail:{status:'cleared'}}));}
  $('logisticsCancel').onclick=()=>cancelTransport();
  const allowDuringTransport='#officeViewModes,#logisticsPanel,#officeCanvas,#officeHome,#officeZoomIn,#officeZoomOut';
  for(const type of ['click','input','change','submit','keydown','pointerdown'])document.addEventListener(type,e=>{if(transport&&!e.target.closest(allowDuringTransport)){e.preventDefault();e.stopImmediatePropagation();}},true);
  function updateInventory(){if($('manualFloor')&&$('manualFloor').options.length!==state.floors.length){$('manualFloor').innerHTML=state.floors.map((f,i)=>`<option value="${i}">${esc(f.id)}</option>`).join('');}const stock=transport?.stock||inventory,n=stock.filter(Boolean).length,count=transport?transport.scene.floors.reduce((n,f)=>n+f.cubes.length,0):M.stats(state).cubes,carried=transport?.job?.carried?1:0;$('logisticsInventory').textContent=`地下备用 ${n} · 空位 ${stock.length-n} · 楼上 ${count} · 运输中 ${carried}`;updateColumns();if($("transferGrid"))updateTransfer();}
  function describe(q){const c=q.cube,n=M.lanes().slice(0,c.lane+1).filter(a=>a.side===c.side).length;return `${q.kind==='transfer'?'转移':q.kind==='recover'?'回收':'调用'} ${M.PROGRAMS[c.program].label} · L${q.fi+1} ${c.side}侧列${n} 第${c.offset/4+1}格${q.targetCube?` → L${q.targetFi+1} ${q.targetCube.side}侧 第${q.targetCube.offset/4+1}格`:''}${c.automaticRoof?' · 屋面花园':''}${q.refitFrom?' · 库存换装':''}`;}
  function showQueue(run){$('logisticsCapacity').textContent='容量检查通过；各列库存峰值：'+M.KEYS.map(k=>M.PROGRAMS[k].label+' '+run.peak[k]+'/64').join(' · ');$('dispatchSteps').innerHTML=run.queue.map((q,i)=>`<li>${i+1}. ${esc(describe(q))}</li>`).join('');}
  function startTransport(p,prepared=null){if(inventoryLoadError)throw Error(inventoryLoadError);if(transport)throw Error('请等待当前调度完成。');const run=prepared||L.create(state,p.next,inventory,rotorAngle);transport=run;run.proposal=p;manualPreview=null;transferSignature='';updateTransfer();$('manualConfirm').disabled=true;pending=null;$('officeProposal').hidden=true;dispatchPreview=null;if($('dispatchConfirm'))$('dispatchConfirm').disabled=true;showQueue(run);switchView('logistics');transportPaused=false;transportLast=0;$('logisticsPause').disabled=$('logisticsCancel').disabled=false;$('logisticsPause').textContent='暂停';document.dispatchEvent(new CustomEvent('office:ai-preview',{detail:{status:'transporting'}}));transportFrameId=requestAnimationFrame(transportFrame);}
  function transportFrame(now){transportFrameId=null;if(!transport)return;const run=transport,dt=Math.min(.1,transportLast?(now-transportLast)/1000:0);transportLast=now;
    try{if(!transportPaused)L.tick(run,dt*Number($('logisticsSpeed').value));L.validate(run);updateInventory();$('logisticsProgress').value=run.queue.length?run.completed/run.queue.length:1;
      if(run.done){const p=run.proposal;transport=null;commit(p.next,`调度完成：${run.completed} 步`,run.stock,run.angle);$('logisticsPause').disabled=$('logisticsCancel').disabled=true;$('officeTransportNotice').hidden=true;$('logisticsStatus').textContent=`已完成 ${run.completed} 步，楼体与仓库已保存。`;if(!p.ai)document.dispatchEvent(new CustomEvent('office:ai-preview',{detail:{status:'cleared'}}));if(p.ai)document.dispatchEvent(new CustomEvent('office:ai-preview',{detail:{status:'applied',count:p.changes.length}}));return;}
      const j=run.job;$('logisticsStatus').textContent=`${transportPaused?'暂停 · ':''}${run.completed}/${run.queue.length} · ${j?describe(j)+' · '+j.steps[j.stage].name:'准备'}`;requestDraw();transportFrameId=requestAnimationFrame(transportFrame);
    }catch(e){cancelTransport('调度已撤回：'+e.message);}
  }
  document.addEventListener('office:archive-plan',e=>{
    try{if(transport)throw Error('请等待调度完成。');const {from,to}=e.detail;const run=L.create(from.building,to.building,inventory,rotorAngle);dispatchPreview={run,from,to,snapshot:JSON.stringify(state),stock:JSON.stringify(inventory)};showQueue(run);switchView('logistics');const counts=Object.fromEntries(['transfer','recover','deploy'].map(k=>[k,run.queue.filter(q=>q.kind===k).length]));$('logisticsStatus').textContent=`${from.name} → ${to.name}：直接转移 ${counts.transfer}，回收 ${counts.recover}，调用 ${counts.deploy}。确认后以起点存档开始演示，完成后应用目标；撤回保留当前楼体。`;$('dispatchConfirm').disabled=false;}catch(error){dispatchPreview=null;$('dispatchConfirm').disabled=true;switchView('logistics');$('logisticsStatus').textContent=error.message;}
  });
  document.addEventListener('office:archive-confirm',()=>{try{if(!dispatchPreview)throw Error('请先计算调度。');const p=dispatchPreview;if(p.snapshot!==JSON.stringify(state)||p.stock!==JSON.stringify(inventory))throw Error('楼体或库存已改变，请重新计算。');startTransport({next:p.to.building,ai:false},p.run);}catch(e){$('logisticsStatus').textContent=e.message;}});

  function columnState(){return L.columns(transport?.stock||inventory,transport?.job);}
  function updateColumns(){const cols=columnState(),active=cols.find(c=>c.active);const markup=cols.map(c=>`<div class="logistics-column${c.active?' active':''}" style="--column-color:${M.PROGRAMS[c.program].color}" data-column="${c.program}"><strong>${M.PROGRAMS[c.program].label}</strong><span>剩余 ${c.count} / ${(transport?.stock||inventory).length/5}</span><small>可见 ${c.visible} · 隐藏 ${c.hidden} · ${c.active?(c.kind==='deploy'?'正在调用 · 已预留 1 个':'回收入此列'):'专用储存列'}</small></div>`).join('');if($('logisticsColumns').innerHTML!==markup)$('logisticsColumns').innerHTML=markup;
    const text=transport?.job?.kind==='transfer'?'直接搬运原模块，仓库库存不变。':active?(active.kind==='recover'?`回收目的地：${M.PROGRAMS[active.program].label}列`:`取货来源：${M.PROGRAMS[active.program].label}列${active.target!==active.program?' → 抽出后换装为'+M.PROGRAMS[active.target].label:''}（剩余数量不含已预留模块）`):'五列按用途固定分类；黄色轮廓标出当前取货或回收列。';if($('logisticsSource').textContent!==text)$('logisticsSource').textContent=text;
  }
  function drawColumnLabels(){const s=transport,site=s?.site||L.layout(state),angle=s?.angle??rotorAngle,cols=columnState();const center=project([site.port[0]+12,-46.5,site.port[2]]),gap=22;
    const ordered=cols.map(c=>({...c,anchor:project(L.rack(c.col+35,angle,site))})).sort((a,b)=>a.anchor[0]-b.anchor[0]);
    ordered.forEach((c,i)=>{const label=window.OfficeI18n?.t(`${c.active?'▶ ':''}${M.PROGRAMS[c.program].label} · 余 ${c.count}`)||`${M.PROGRAMS[c.program].label} · 余 ${c.count}`;ctx.font=(c.active?'bold ':'')+'11px system-ui';const width=Math.ceil(ctx.measureText(label).width)+14;const left=i<2,row=left?i:i-2,x=left?Math.max(8,center[0]-width-62):Math.min(W-width-8,center[0]+62),y=Math.max(70,Math.min(H-100,center[1]-32))+row*gap,stroke=c.active?'#fff279':M.PROGRAMS[c.program].color,edge=left?x+width:x;
      line([[edge,y+10],[left?edge+12:edge-12,y+10],c.anchor],stroke,c.active?2:1);ctx.fillStyle=c.active?'#41451b':'#101a12ee';ctx.fillRect(x,y,width,20);ctx.strokeStyle=stroke;ctx.lineWidth=c.active?2:1;ctx.strokeRect(x,y,width,20);ctx.font=(c.active?'bold ':'')+'11px system-ui';ctx.textAlign='left';ctx.fillStyle=stroke;ctx.fillText(label,x+7,y+14);ctx.beginPath();ctx.arc(c.anchor[0],c.anchor[1],c.active?4:2,0,Math.PI*2);ctx.fill();
      if(c.active){const p=L.rack(c.col,angle,site);for(const dx of [-2.2,2.2])for(const dz of [-2.2,2.2])line([project([p[0]+dx,-86.2,p[2]+dz]),project([p[0]+dx,-6.8,p[2]+dz])],'#fff279',2);for(const y of [-86.2,-6.8])line([[-2.2,-2.2],[2.2,-2.2],[2.2,2.2],[-2.2,2.2],[-2.2,-2.2]].map(([dx,dz])=>project([p[0]+dx,y,p[2]+dz])),'#fff279',2);}
    });
  }
  function drawLogistics(){const s=transport,site=s?.site||L.layout(state),p=site.port,angle=s?.angle??rotorAngle,stock=s?.stock||inventory,g=s?.gantry||p,u=s?.lifter||[p[0],-84,p[2]];
    const rows=16,bottom=-9-(rows-1)*5-2.5,center=(bottom-7)/2;
    const cb=(x,y,z,w,h,d,c)=>box(x-w/2,y-h/2,z-d/2,w,h,d,c);
    // Opaque ground cut into four rectangles around the single lift opening.
    const left=site.left-5,right=Math.max(site.right+5,p[0]+23),front=site.top-8,back=site.bottom+5,hole=3;
    const ground=(x0,x1,z0,z1)=>{if(x1>x0&&z1>z0)box(x0,-.55,z0,x1-x0,.5,z1-z0,'#777c65',{stroke:'#a7ad94',width:1,renderLayer:1});};
    ground(left,p[0]-hole,front,back);ground(p[0]+hole,right,front,back);
    ground(p[0]-hole,p[0]+hole,front,p[2]-hole);ground(p[0]-hole,p[0]+hole,p[2]+hole,back);
    if(showWarehouse){
    cb(p[0]+6,bottom,p[2],30,.4,23,'#344e49');
    for(const dx of [-3,3])for(const dz of [-3,3])cb(p[0]+dx,bottom/2,p[2]+dz,.14,-bottom,.14,'#60cbd1');
    cb(p[0]+12,center,p[2],.6,-7-bottom,.6,'#70a69b');
    for(let level=0;level<=rows;level++)for(let k=0;k<32;k++){const a=k*Math.PI/16;cb(p[0]+12+8.8*Math.cos(a),bottom+.5+level*5,p[2]+8.8*Math.sin(a),.6,.16,.6,'#72a99d');}
    for(let k=0;k<5;k++){const a=angle+Math.PI+Math.PI/5+k*2*Math.PI/5;cb(p[0]+12+8.6*Math.cos(a),center,p[2]+8.6*Math.sin(a),.18,-7-bottom,.18,'#72a99d');}
    // Cargo positions mark the 4 m envelope center. A 0.4 m garden slab sits at its bottom (center - 1.8 m).
    stock.slice(0,80).forEach((c,i)=>{const r=L.rack(i,angle,site);cb(r[0],r[1]-2.09,r[2],4.3,.18,4.3,s?.job&&!s.job.delivered&&s.job.slot%5===i%5?'#fff279':M.PROGRAMS[M.KEYS[i%5]].color);if(c)cb(r[0],r[1]-(c.program==='garden'?1.8:0),r[2],3.8,c.program==='garden'?.4:3.8,3.8,M.PROGRAMS[c.program].color);});
    cb(u[0],u[1]-2.175,u[2],4.5,.35,4.5,'#6bd9e3');
    }
    for(const dx of [-3.5,3.5])for(const dz of [-3.5,3.5])cb(g[0]+dx,site.height/2,g[2]+dz,.5,site.height,.5,'#a8b598');
    for(const dx of [-3.5,3.5])cb(g[0]+dx,site.height,g[2],.5,.5,7.5,'#e4cf68');for(const dz of [-3.5,3.5])cb(g[0],site.height,g[2]+dz,7.5,.5,.5,'#e4cf68');
    // Open central hatch during handoff allows the underground platform through.
    for(const dx of [-2.7,2.7])cb(g[0]+dx,g[1]-2.175,g[2],.5,.35,5.8,'#efd34e');for(const dz of [-2.7,2.7])cb(g[0],g[1]-2.175,g[2]+dz,5,.35,.5,'#efd34e');
    const cargoOnGantry=s?.job?.carried&&s.cargo&&s.cargo.every((v,i)=>Math.abs(v-g[i])<.01);
    if(Math.abs(g[0]-p[0])>.01||Math.abs(g[2]-p[2])>.01||u[1]<-4||cargoOnGantry)cb(g[0],g[1]-2.175,g[2],4.8,.35,4.8,'#efd34e');
    cb(g[0],g[1]+2.4,g[2],5,.3,5,'#e4cf68');
    for(const dx of [-2.4,2.4])cb(g[0]+dx,g[1],g[2],.15,4.8,.5,'#e4cf68');
    if(s?.job?.carried&&s.cargo&&(showWarehouse||s.cargo[1]>=0)){const r=s.cargo,j=s.job;cb(r[0],r[1]-(j.program==='garden'?1.8:0),r[2],3.9,j.program==='garden'?.4:3.9,3.9,M.PROGRAMS[j.program].color);
      if(j.stage>0&&Math.abs(r[1]-u[1])<.01&&Math.abs(r[2]-u[2])<.01&&r[0]>u[0])cb((r[0]+u[0])/2,r[1]-2.075,r[2],r[0]-u[0]+4,.15,3.2,'#6bd9e3');
      // Gardens have no roof to hang from: a lower telescopic tray supports the slab.
      if(j.program==='garden'&&r[1]>=2&&Math.abs(r[1]-g[1])<.01){if(Math.abs(r[2]-g[2])<.01)cb((r[0]+g[0])/2,r[1]-2.075,r[2],Math.abs(r[0]-g[0])+4,.15,3.8,'#ddbc59');else if(Math.abs(r[0]-g[0])<.01)cb(r[0],r[1]-2.075,(r[2]+g[2])/2,3.8,.15,Math.abs(r[2]-g[2])+4,'#ddbc59');}
      if(r[1]>=2&&Math.abs(r[1]-g[1])<.01){if(Math.abs(r[2]-g[2])<.01)cb((r[0]+g[0])/2,r[1]+2.4,r[2],Math.abs(r[0]-g[0])+4,.2,1,'#ddbc59');else if(Math.abs(r[0]-g[0])<.01)cb(r[0],r[1]+2.4,(r[2]+g[2])/2,1,.2,Math.abs(r[2]-g[2])+4,'#ddbc59');}}
  }

  function applyAI(){
    if(!pending?.ai)throw Error('没有待应用的 AI 方案，请重新发送需求。');
    if(JSON.stringify(state)!==pending.snapshot){clearProposal();throw Error('模型已改变，旧提案失效，请重新发送需求。');}
    if(transport)throw Error('模块正在调度。');startTransport(pending);
  }
  window.OfficeAI=Object.freeze({
    getContext:()=>({state:M.clone(state),selection:{scope:$('officeScope').value,floorIndex,userId:currentUser().id}}),
    clearPreview:clearProposal,
    apply:applyAI,
    preview:(feedback,snapshot,selection,multiplier)=>{
      if(JSON.stringify(state)!==snapshot)throw Error('等待回复期间模型已改变，请重新发送需求。');
      if(selection.floorIndex!==floorIndex||(selection.scope==='user'&&selection.userId!==currentUser().id))throw Error('选择的楼层或用户已改变，请重新发送需求。');
      if(transport)throw Error('请等待调度完成或撤回。');switchView('space');clearProposal();pending={...M.proposeFeedback(state,selection,feedback,multiplier),ai:true,snapshot};
      const p=pending;
      $('officeProposal').innerHTML=`<strong>AI 方案预览 · 尚未应用</strong><p>${p.changes.length} 个模块改变用途，${p.moved.length} 个模块因花园末端规则在同链重排。</p><ul>${p.changes.map(c=>`<li>${esc(c.floor)} / ${esc(c.cube)}：${M.PROGRAMS[c.from].label} → ${M.PROGRAMS[c.to].label}</li>`).join('')}</ul><button id="officeApply" class="office-button office-primary">确认应用 AI 方案</button> <button id="officeCancel" class="office-button">取消预览</button>`;
      $('officeProposal').hidden=false;requestDraw();
      return {changes:p.changes,moved:p.moved,before:p.before,after:p.after,affectedFloors:p.affectedFloors};
    }
  });
  // Read-only diagnostics support meaningful geometry and interaction checks.
  window.OfficeTower=Object.freeze({captureLogistics:()=>({stock:M.clone(inventory),angle:rotorAngle}),restoreDemo:(building,logistics)=>{if(transport)throw Error('Cancel the running dispatch before resetting the demo.');commit(M.validate(building),'Demo baseline restored',L.normalizeStock(logistics.stock),Number(logistics.angle)||0);},restoreArchive:building=>commit(M.validate(building),'已恢复楼体存档，可撤销'),getState:()=>M.clone(state),getView:()=>({yaw,pitch,zoom,isolated,floorIndex,selectedCube}),getHitTarget:()=>{const p=[...hits].reverse().find(p=>p.floor===floorIndex);return p?{id:p.id,floor:p.floor,x:p.points.reduce((s,v)=>s+v[0],0)/4,y:p.points.reduce((s,v)=>s+v[1],0)/4}:null;}});
  $('officeRoofGardens').checked=!!state.roofGardens;
  $('officeRoofGardens').addEventListener('change',()=>{const next=M.clone(state);next.roofGardens=$('officeRoofGardens').checked;next.revision++;commit(next,next.roofGardens?'已启用露台自动补花园，楼顶除外':'已关闭露台自动补花园');});
  updateInventory();if(inventoryLoadError)$('logisticsStatus').textContent=inventoryLoadError;refresh();if(!$('officeStatus').textContent)status(migrated?'已按 4 m 网格重新摆放，层高 4 m；四侧数量与用途保留；原方案已备份。':stored?'已恢复本浏览器的办公楼方案。':'初始布局 · 8 层 / 160 个模块 / 向外 1–2 格 / 办公50%、会议20%、实验10%、交流10%、花园10%。');
}());

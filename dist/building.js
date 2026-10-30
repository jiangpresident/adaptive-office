(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./engine.js') : root.WishEngine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WishBuilding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';
  const names = { north: '北', east: '东', south: '南', west: '西' };
  // The dimensions belong to the CENTRAL CORE, never the building envelope.
  const core = Object.freeze({ x: 0, y: 0, w: 24, h: 12 });
  const lots = Object.freeze([
    { id: 'W1', side: 'west', label: '西侧户', frontageM: 12 },
    { id: 'N1', side: 'north', label: '西北户', frontageM: 12 },
    { id: 'N2', side: 'north', label: '东北户', frontageM: 12 },
    { id: 'E1', side: 'east', label: '东侧户', frontageM: 12 },
    { id: 'S1', side: 'south', label: '西南户', frontageM: 12 },
    { id: 'S2', side: 'south', label: '东南户', frontageM: 12 }
  ].map(Object.freeze));
  // Site geometry is always enforced. Only interior feasibility is advisory.
  const draftPlacement = p => { const next={...(p||{}),softInterior:true};delete next.demandFirst;return next; };
  const round = v => Math.round(v * 100) / 100;
  function preference(conversation) {
    const p = conversation?.orientationPreference;
    if (p) return p.status === 'confirmed' && names[p.direction] ? p.direction : null;
    const requirement = conversation?.requirements?.find(r => r.id === 'orientation' && r.kind === 'layout' && names[r.value]);
    return requirement?.value || null;
  }
  function selectedLot(conversation) {
    const direction = preference(conversation);
    if (!direction) return null;
    return lots.find(lot => lot.side === direction && lot.id === conversation.householdSlot) || lots.find(lot => lot.side === direction);
  }
  const inward = { south: 'north', north: 'south', east: 'west', west: 'east' };
  function entranceSide(conversation, fallback = E.DEFAULTS.entranceSide) {
    return inward[selectedLot(conversation)?.side] || fallback;
  }
  function entryViolation(room, p) {
    const b = boundary(p);
    if (!b || !room.type.startsWith('living')) return null;
    const touching = b.coreSide === 'north' ? room.y === b.minY : b.coreSide === 'south' ? room.y + room.h === b.maxY :
      b.coreSide === 'west' ? room.x === b.minX : room.x + room.w === b.maxX;
    const along = ['north','south'].includes(b.coreSide) ? room.x >= b.minX && room.x+room.w <= b.maxX : room.y >= b.minY && room.y+room.h <= b.maxY;
    return touching && along ? null : `客厅${names[b.coreSide]}侧主入口需要贴着本户的核心筒界面，不能移离入户边界。`;
  }
  function syncEntrance(rooms, conversation, saved, fallback) {
    const p = placement(rooms, conversation, saved), side = entranceSide(conversation, fallback);
    if (!p || !rooms.length) return { rooms, placement: p, side, movedIds: [] };
    if (rooms.every(r => !violation(r,p) && !entryViolation(r,p)) && !E.entranceConflicts(rooms,side).length) return { rooms, placement:p, side, movedIds:[] };
    const b = boundary(p), placed = [];
    const ordered = [...rooms].sort((a,c) => Number(c.type.startsWith('living')) - Number(a.type.startsWith('living')));
    for (const original of ordered) {
      const r = { ...original };
      if (r.type.startsWith('living')) {
        if (side === 'north') r.y = b.minY;
        if (side === 'south') r.y = b.maxY - r.h;
        if (side === 'west') r.x = b.minX;
        if (side === 'east') r.x = b.maxX - r.w;
        r.x = Math.max(b.minX, Math.min(b.maxX-r.w,r.x));
        r.y = Math.max(b.minY, Math.min(b.maxY-r.h,r.y));
      }
      const allowed = candidate => !violation(candidate,p) && !entryViolation(candidate,p);
      if (!allowed(r) || !E.canPlace(r,placed,undefined,side) || (placed.length && E.validateLayout([...placed,r]).disconnected.length)) {
        Object.assign(r,E.findFreePosition(r,placed,side,allowed));
      }
      placed.push(r);
    }
    if (placed.some(r => violation(r,p) || entryViolation(r,p)) || E.validateLayout(placed).disconnected.length || E.entranceConflicts(placed,side).length) throw new Error('无法在分户界面内连接核心筒入口，请调整模块。');
    const result = rooms.map(r => placed.find(v => v.id === r.id));
    return { rooms: result, placement:p, side, movedIds: result.filter((r,i) => r.x !== rooms[i].x || r.y !== rooms[i].y).map(r=>r.id) };
  }
  // Keep the compact lounge on the core, but reserve its opposite facade for
  // daylight before fitting the adjoining modules. No dimensions/IDs are lost.
  function improveSmallLiving(rooms, conversation, saved, fallback) {
    const synced = syncEntrance(rooms, conversation, saved, fallback);
    const sourceLiving = synced.rooms.find(r => r.type === 'livingSmall');
    const living = sourceLiving && { ...sourceLiving };
    if (!living) return synced;
    const limits = boundary(synced.placement);
    // Leave attachment room on both sides, so bedrooms need not be reached
    // through the kitchen and the outward living facade can stay open.
    if(limits){
      if(['north','south'].includes(synced.side))living.x=Math.round((limits.minX+limits.maxX-living.w)/2);
      else living.y=Math.round((limits.minY+limits.maxY-living.h)/2);
    }
    const side = inward[synced.side], depth = 4; // 1.2 m clear apron outside the window
    const apron = { x: living.x, y: living.y, w: living.w, h: living.h };
    if (side === 'south') { apron.y += living.h; apron.h = depth; }
    if (side === 'north') { apron.y -= depth; apron.h = depth; }
    if (side === 'east') { apron.x += living.w; apron.w = depth; }
    if (side === 'west') { apron.x -= depth; apron.w = depth; }
    if (siteObstacles(synced.placement).some(r => E.intersects(apron, r))) return synced;
    const placed = [{ ...living }];
    const pending = synced.rooms.filter(r => r.id !== living.id).sort((a,b) =>
      Number(['garden','balcony'].includes(a.type)) - Number(['garden','balcony'].includes(b.type)));
    let firstBedroom=true;
    function usableContact(a,b){
      if(a.x+a.w===b.x || b.x+b.w===a.x)return Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>=3;
      if(a.y+a.h===b.y || b.y+b.h===a.y)return Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>=3;
      return false;
    }
    for (const original of pending) {
      let r = { ...original };
      if(r.type==='kitchen' || E.isBedroom(r) && firstBedroom){
        const positive=r.type==='kitchen';
        if(['north','south'].includes(synced.side)){r.x=positive?living.x+living.w:living.x-r.w;r.y=synced.side==='north'?living.y:living.y+living.h-r.h;}
        else{r.y=positive?living.y+living.h:living.y-r.h;r.x=synced.side==='west'?living.x:living.x+living.w-r.w;}
        if(E.isBedroom(r))firstBedroom=false;
      }
      const publicRooms=placed.filter(r=>!['bedroom','bedroomSingle','balcony','garden'].includes(r.type));
      const allowed = candidate => !violation(candidate, synced.placement) && !E.intersects(candidate, apron) &&
        (['balcony','garden'].includes(candidate.type) || publicRooms.some(anchor=>usableContact(candidate,anchor)));
      if (!allowed(r) || !E.canPlace(r, placed, undefined, synced.side) || E.validateLayout([...placed, r]).disconnected.length) {
        Object.assign(r, E.findFreePosition(r, placed, synced.side, allowed));
      }
      placed.push(r);
    }
    const result = rooms.map(r => placed.find(v => v.id === r.id));
    if (E.validateLayout(result).disconnected.length || result.some(r => violation(r, synced.placement) || entryViolation(r, synced.placement))) throw new Error('小客厅采光重排未完成');
    if(E.enclosedVoids(result).length){const repaired=E.closeVoids(result,synced.side,r=>!violation(r,synced.placement)&&!entryViolation(r,synced.placement));if(!repaired)throw new Error("无法消除拼搭中空");return {...synced,rooms:repaired.rooms,movedIds:repaired.movedIds};}
    return { ...synced, rooms: result, daylightSide: side, movedIds: result.filter((r,i) => r.x !== rooms[i].x || r.y !== rooms[i].y).map(r => r.id) };
  }
  function placement(rooms, conversation, saved) {
    const lot = selectedLot(conversation);
    if (!lot) return null;
    if (saved?.lotId === lot.id && [saved.x, saved.y].every(v => Number.isInteger(v) && Math.abs(v) <= E.MAX_COORD * 2)) return { lotId: lot.id, x: saved.x, y: saved.y, ...(saved.softInterior ? { softInterior:true } : {}) };
    const b = E.getBounds(rooms);
    return { lotId: lot.id, x: lot.side === 'west' ? b.maxX : b.minX, y: lot.side === 'north' ? b.maxY : b.minY, ...(saved?.softInterior ? { softInterior:true } : {}) };
  }
  function boundary(p) {
    const lot = lots.find(l => l.id === p?.lotId);
    if (!lot) return null;
    const span = lot.frontageM / E.CELL_METERS;
    return { lot, coreSide: inward[lot.side],
      minX: lot.side === 'west' ? -Infinity : p.x,
      maxX: lot.side === 'west' ? p.x : lot.side === 'east' ? Infinity : p.x + span,
      minY: lot.side === 'north' ? -Infinity : p.y,
      maxY: lot.side === 'north' ? p.y : lot.side === 'south' ? Infinity : p.y + span };
  }
  function globalOrigin(p) {
    const lot = lots.find(l=>l.id===p?.lotId);
    return { x: lot?.side==='east' ? 24 : ['N2','S2'].includes(lot?.id) ? 12 : 0, y: lot?.side==='south' ? 12 : 0 };
  }
  function lotRect(l, d=6) {
    return l.side==='west' ? {x:-d,y:0,w:d,h:12} : l.side==='east' ? {x:24,y:0,w:d,h:12} :
      {x:l.id.endsWith('1')?0:12,y:l.side==='north'?-d:12,w:12,h:d};
  }
  function siteObstacles(p) {
    if (!p || !lots.some(l=>l.id===p.lotId)) return [];
    const o=globalOrigin(p), scale=E.CELL_METERS;
    return [{id:'core',kind:'core',label:'核心筒 · 24 × 12 m',...core},
      ...lots.filter(l=>l.id!==p.lotId).map(l=>({id:'neighbor-'+l.id,kind:'neighbor',label:l.label+' · 邻居（暂示进深 6 m）',...lotRect(l)}))]
      .map(r=>({...r,x:p.x+(r.x-o.x)/scale,y:p.y+(r.y-o.y)/scale,w:r.w/scale,h:r.h/scale}));
  }
  function violation(room,p) {
    const hit=siteObstacles(p).find(r=>E.intersects(room,r));
    return hit ? (hit.kind==='core'?'此处属于核心筒':'此处属于邻居范围')+'，不能拼接模块。' : null;
  }
  function fit(rooms, p, entranceSide) {
    if (!p || rooms.every(r => !violation(r, p))) return rooms;
    const b = boundary(p), ordered = [...rooms].sort((a, c) => Number(c.type.startsWith('living')) - Number(a.type.startsWith('living'))), result = [];
    for (const original of ordered) {
      let r = { ...original };
      if (!result.length) {
        r.x = Math.max(b.minX, Math.min(b.maxX - r.w, r.x));
        r.y = Math.max(b.minY, Math.min(b.maxY - r.h, r.y));
      }
      if (violation(r, p) || !E.canPlace(r, result, undefined, entranceSide)) Object.assign(r, E.findFreePosition(r, result, entranceSide, candidate => !violation(candidate, p)));
      if (violation(r, p)) throw new Error('Cannot fit household boundary');
      result.push(r);
    }
    if (E.validateLayout(result).disconnected.length || E.entranceConflicts(result, entranceSide).length) throw new Error('Cannot connect household modules');
    return rooms.map(r => result.find(v => v.id === r.id));
  }
  function boundarySvg(p, box, grid) {
    const obstacles=siteObstacles(p);
    return '<g class="building-no-build" pointer-events="none"><defs><pattern id="buildingHatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="#ff3982" stroke-width=".5" opacity=".35"/></pattern></defs>'+obstacles.map(r=>{
      const x=r.x*grid,y=r.y*grid,w=r.w*grid,h=r.h*grid;
      const left=Math.max(x,box.x),top=Math.max(y,box.y),right=Math.min(x+w,box.x+box.width),bottom=Math.min(y+h,box.y+box.height);
      if(right<=left||bottom<=top)return '';
      const label=r.label+' · 禁止拼接';
      return '<g aria-label="'+label+'"><rect data-building-obstacle="'+r.id+'" x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="#ff39820c"/><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="url(#buildingHatch)" stroke="#ff3982" stroke-width=".7"/><text x="'+((left+right)/2)+'" y="'+((top+bottom)/2)+'" text-anchor="middle" fill="#ff679d" font-size="8">'+label+'</text></g>';
    }).join('')+'</g>';
  }
  function assess(rooms, conversation, saved) {
    const lot = selectedLot(conversation), indoor = rooms.filter(r => !['balcony', 'garden'].includes(r.type));
    const areaM2 = round(indoor.reduce((sum, r) => sum + r.w * r.h * E.CELL_METERS ** 2, 0));
    const bounds = indoor.length ? { x: Math.min(...indoor.map(r => r.x)), y: Math.min(...indoor.map(r => r.y)),
      right: Math.max(...indoor.map(r => r.x + r.w)), bottom: Math.max(...indoor.map(r => r.y + r.h)) } : null;
    const widthM = bounds ? round((bounds.right - bounds.x) * E.CELL_METERS) : 0;
    const depthM = bounds ? round((bounds.bottom - bounds.y) * E.CELL_METERS) : 0;
    const frontageM = lot ? ['north', 'south'].includes(lot.side) ? widthM : depthM : null;
    const frontageFits = lot ? frontageM <= lot.frontageM + .0001 : null;
    const p=placement(rooms,conversation,saved), conflicts=rooms.filter(r=>violation(r,p));
    return { status: !lot ? 'orientation-needed' : !indoor.length ? 'empty' : conflicts.length ? 'collision' : 'schematic', conflictCount:conflicts.length,
      lot, areaM2, widthM, depthM, frontageM, frontageFits, areaLimitM2: null, outwardDepthLimitM: null, bounds,
      outdoorAreaM2: round(rooms.filter(r => ['balcony', 'garden'].includes(r.type)).reduce((n, r) => n + r.w * r.h * E.CELL_METERS ** 2, 0)) };
  }
  function displayLots(rooms, conversation, saved) {
    const a = assess(rooms, conversation, saved);
    const p = placement(rooms, conversation, saved), bounds = E.getBounds(rooms);
    return lots.map(l => {
      // Six metres is ONLY the drawing placeholder for unplanned neighbors.
      // The active envelope grows to the actual draft depth, without a cap.
      const reach = !p ? 0 : l.side === 'north' ? p.y - bounds.minY : l.side === 'south' ? bounds.maxY - p.y : l.side === 'west' ? p.x - bounds.minX : bounds.maxX - p.x;
      const d = a.lot?.id === l.id ? Math.max(6, reach * E.CELL_METERS) : 6;
      const rect = l.side === 'west' ? { x: -d, y: 0, w: d, h: 12 } : l.side === 'east' ? { x: 24, y: 0, w: d, h: 12 } :
        { x: l.id.endsWith('1') ? 0 : 12, y: l.side === 'north' ? -d : 12, w: 12, h: d };
      if (a.lot?.id===l.id && rooms.length) {
        const o=globalOrigin(p), x=o.x+(bounds.minX-p.x)*E.CELL_METERS, y=o.y+(bounds.minY-p.y)*E.CELL_METERS;
        const right=Math.max(rect.x+rect.w,x+bounds.width*E.CELL_METERS), bottom=Math.max(rect.y+rect.h,y+bounds.height*E.CELL_METERS);
        rect.x=Math.min(rect.x,x);rect.y=Math.min(rect.y,y);rect.w=right-rect.x;rect.h=bottom-rect.y;
      }
      return { ...l, ...rect };
    });
  }
  function context(rooms, conversation, saved) {
    const a = assess(rooms, conversation, saved);
    const p = placement(rooms, conversation, saved);
    return { planningMode: saved?.softInterior ? 'site-constrained; no enclosed voids; furniture and routes are non-blocking draft warnings' : 'site-constrained', core: { widthM: 24, depthM: 12, areaM2: 288 }, longAxis: 'east-west', householdCount: 6,
      ...(p ? { attachmentRules: { coreSide: boundary(p).coreSide, frontageM: 12, finiteObstacles: true, neighborDepthM: 6, conflictCount: rooms.filter(r => violation(r, p)).length } } : {}),
      buildingEnvelope: 'undetermined', outwardDepthLimitM: null, allocation: 'outside-core, provisional equal frontage',
      lots: lots.map(l => ({ id: l.id, side: l.side, frontageM: l.frontageM })),
      confirmedOrientation: preference(conversation), selectedLotId: a.lot?.id || null,
      currentDraft: { status: a.status, indoorAreaM2: a.areaM2, widthM: a.widthM, depthM: a.depthM, frontageFits: a.frontageFits },
      entranceConnection: p ? 'core-facing living entrance; detailed core circulation unresolved' : 'unresolved', outdoorPlacement: 'unresolved' };
  }
  function svg(rooms, conversation, saved) {
    const a = assess(rooms, conversation, saved), active = a.lot?.id, p = placement(rooms, conversation, saved), shapes = displayLots(rooms, conversation, p);
    const minX = Math.min(...shapes.map(l => l.x)) - 2, minY = Math.min(...shapes.map(l => l.y)) - 2;
    const width = Math.max(...shapes.map(l => l.x+l.w)) - minX + 2, height = Math.max(...shapes.map(l => l.y+l.h)) - minY + 2.5;
    const boxes = shapes.map(l => `<g><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" fill="${l.id === active ? '#c6ff0030' : '#24232b'}" stroke="${l.id === active ? '#c6ff00' : '#73717d'}" stroke-width=".08" stroke-dasharray=".3 .18"/><text x="${l.x + l.w / 2}" y="${l.y + l.h / 2 - .5}" fill="${l.id === active ? '#c6ff00' : '#dddce1'}">${l.id === active ? '你的家' : active ? '邻居' : '住户'} · ${l.label}</text><text x="${l.x + l.w / 2}" y="${l.y + l.h / 2 + .6}" fill="#aaa9b3">外边界待定</text></g>`).join('');
    const l = shapes.find(l => l.id === active);
    const origin=globalOrigin(p), ox=origin.x, oy=origin.y;
    const outline = p ? `<g fill="none" stroke="#c6ff00" stroke-width=".08">${rooms.map(r => `<rect x="${ox + (r.x - p.x) * E.CELL_METERS}" y="${oy + (r.y - p.y) * E.CELL_METERS}" width="${r.w * E.CELL_METERS}" height="${r.h * E.CELL_METERS}" ${violation(r,p) ? 'stroke="#ff3982"' : ''}/>`).join('')}</g>` : '';
    return `<svg class="building-diagram" xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="24乘12米中央核心筒，六户围绕核心筒外侧，北向朝上"><style>.building-diagram text{font-family:monospace,sans-serif;font-size:.7px;text-anchor:middle}</style><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#101210"/>${boxes}${outline}<rect x="0" y="0" width="24" height="12" fill="#343c24" stroke="#c6ff00" stroke-width=".12"/><g stroke="#a6b881" stroke-width=".06" fill="none"><path d="M0 2V1.5H24V2M2 0H1.5V12H2"/></g><text x="12" y="1.1" fill="#c6ff00">24 m · 核心筒长边</text><text x="1.1" y="6" transform="rotate(-90 1.1 6)" fill="#c6ff00">12 m · 核心筒短边</text><text x="12" y="5.8" fill="#c6ff00" style="font-size:1.1px">中央核心筒</text><text x="12" y="7.3" fill="#c7d7ac">24 × 12 m / 288 m²</text><text x="12" y="9.2" fill="#c7d7ac">楼梯 · 电梯 · 公共交通 / 内部分布待定</text><text x="${minX + width - 1.5}" y="${minY+1}" fill="#c6ff00">↑ N</text><text x="12" y="${minY + height - .6}" fill="#aaa9b3">邻居暂示进深 6 m；核心筒 24 × 12 m；空白角部可继续拼搭</text></svg>`;
  }
  return Object.freeze({ draftPlacement, lots, core, displayLots, names, preference, selectedLot, assess, context, svg, placement, boundary, violation, fit, boundarySvg, siteObstacles, entranceSide, entryViolation, syncEntrance, improveSmallLiving });
});

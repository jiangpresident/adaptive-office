(function (root, factory) {
  'use strict';
  var api = factory(typeof module === 'object' && module.exports ? require('./function-plans.js') : null, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, root) {
  'use strict';

  // The drafting grid is finer than the architectural module: 10 grid cells
  // form one 3 m unit; a half-module remains an exact integer rectangle.
  var CELL_METERS = 0.3, MODULE_METERS = 3, MODULE_CELLS = 10, HALF_MODULE_CELLS = 5, GRID_VERSION = 2;
  var TYPES = {
    livingLarge: { name: '大客厅', w: 20, h: 20, unitW: 2, unitH: 2, color: '#efe6ca' },
    livingSmall: { name: '小客厅', w: 10, h: 10, unitW: 1, unitH: 1, color: '#efe6ca' },
    livingMedium: { name: '多用客厅', w: 10, h: 15, unitW: 1, unitH: 1.5, color: '#efe6ca' },
    washroom: { name: '洗手间', w: 5, h: 5, unitW: .5, unitH: .5, color: '#d9e7ec' },
    showerRoom: { name: '淋浴卫生间', w: 5, h: 10, unitW: .5, unitH: 1, color: '#ccdee8' },
    kitchen: { name: '厨房', w: 10, h: 10, unitW: 1, unitH: 1, color: '#e6d8cc' },
    bedroomSingle: { name: '单人小睡房', w: 10, h: 10, unitW: 1, unitH: 1, color: '#dce7d4' },
    bedroom: { name: '2人睡房', w: 10, h: 15, unitW: 1, unitH: 1.5, color: '#dce7d4' },
    balcony: { name: '阳台', w: 5, h: 10, unitW: 0.5, unitH: 1, color: '#d5e6e4' },
    garden: { name: '花园', w: 10, h: 10, unitW: 1, unitH: 1, color: '#d6dfb5' }
  };
  var DEFAULTS = {
    household: 'couple', bedrooms: 2, singleBedrooms: 0, living: 'large', outdoor: 'balcony', gardenCount: 1, balconyCount: 1,
    orientation: 'south', entranceSide: 'east', lifestyle: 'relaxed'
  };
  var ORIENTATIONS = ['south', 'west', 'north', 'east'];
  var ENTRANCE_DEPTH = 4, MINIMUM_CONTACT = 4;
  var MAX_COORD = 280;

  function functionPlans() { return F || (root && root.WishouseFunctionPlans); }
  function getDefinition(roomOrType) {
    var type = typeof roomOrType === 'string' ? roomOrType : roomOrType && roomOrType.type;
    if (Object.prototype.hasOwnProperty.call(TYPES, type) && !roomOrType.functionPlan) return TYPES[type];
    if (!roomOrType || typeof roomOrType !== 'object' || type !== 'custom' && !TYPES[type]) return null;
    // Geometry queries are frequent while dragging. Furniture is normalized at
    // creation/import; looking up a footprint must not rerun the packing solver.
    var plan = roomOrType.functionPlan;
    if (!plan || typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 60 ||
        ['widthUnits', 'heightUnits'].some(function (key) { var n = plan[key]; return typeof n !== 'number' || !Number.isFinite(n) || n < .5 || n > 4 || Math.abs(n * 2 - Math.round(n * 2)) > .00001; })) return null;
    return plan ? { name: plan.title, w: plan.widthUnits * MODULE_CELLS, h: plan.heightUnits * MODULE_CELLS,
      unitW: plan.widthUnits, unitH: plan.heightUnits, color: '#ddd8ec' } : null;
  }
  function createCustomRoom(plan, id, x, y, rotation) {
    var plans = functionPlans(), snapshot = plans && plans.normalizePlan(plan);
    x = x === undefined ? 0 : x; y = y === undefined ? 0 : y; rotation = rotation === undefined ? 0 : rotation;
    if (!snapshot || typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || ['__proto__', 'prototype', 'constructor'].indexOf(id) >= 0 ||
        !Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD || [0, 90, 180, 270].indexOf(rotation) < 0) {
      throw new TypeError('Invalid custom module');
    }
    var rotated = rotation % 180 !== 0, type=snapshot.parentType||'custom';
    if(['bedroom','bedroomSingle'].includes(type)&&!snapshot.furniture.concat((snapshot.unplaced||[]).map(v=>v.item)).some(item=>item.kind==='bed'))type='custom';
    return { id: id, type: type, x: x, y: y,
      w: (rotated ? snapshot.heightUnits : snapshot.widthUnits) * MODULE_CELLS,
      h: (rotated ? snapshot.widthUnits : snapshot.heightUnits) * MODULE_CELLS,
      rotation: rotation, functionPlan: snapshot };
  }
  function cloneRoom(room) {
    var copy = Object.assign({}, room);
    if (room.functionPlan) copy.functionPlan = JSON.parse(JSON.stringify(room.functionPlan));
    return copy;
  }
  function roundArea(value) { return Math.round(value * 100) / 100; }
  function normalizePrefs(input) {
    var prefs = Object.assign({}, DEFAULTS, input || {});
    [['household', ['solo', 'couple', 'family']], ['living', ['large', 'small', 'medium']],
      ['outdoor', ['none', 'balcony', 'garden', 'both']], ['orientation', ORIENTATIONS], ['entranceSide', ORIENTATIONS],
      ['lifestyle', ['relaxed', 'social', 'quiet']]].forEach(function (entry) {
      if (entry[1].indexOf(prefs[entry[0]]) < 0) prefs[entry[0]] = DEFAULTS[entry[0]];
    });
    prefs.bedrooms = Math.max(1, Math.min(4, Math.round(Number(prefs.bedrooms) || DEFAULTS.bedrooms)));
    prefs.singleBedrooms = Math.max(0, Math.min(prefs.bedrooms, Math.round(Number(prefs.singleBedrooms) || 0)));
    ['gardenCount','balconyCount'].forEach(function(key){prefs[key]=Math.max(1,Math.min(8,Math.round(Number(prefs[key])||1)));});
    return prefs;
  }
  function outdoorCounts(prefs){return {garden: ['garden','both'].includes(prefs.outdoor)?Math.max(1,Math.min(8,Number(prefs.gardenCount)||1)):0, balcony:['balcony','both'].includes(prefs.outdoor)?Math.max(1,Math.min(8,Number(prefs.balconyCount)||1)):0};}
  function isBedroom(room) { return room && ['bedroom','bedroomSingle'].includes(room.type); }
  function roomAt(type, id, x, y) {
    var definition = TYPES[type];
    return { id: id, type: type, x: x, y: y, w: definition.w, h: definition.h, rotation: 0 };
  }
  function validRect(room) {
    return room && ['x', 'y', 'w', 'h'].every(function (key) {
      return Number.isInteger(room[key]);
    }) && room.w > 0 && room.h > 0;
  }
  function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function touches(a, b) {
    var vertical = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    var horizontal = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    return (vertical > 0 && (a.x + a.w === b.x || b.x + b.w === a.x)) ||
      (horizontal > 0 && (a.y + a.h === b.y || b.y + b.h === a.y));
  }
  function isLiving(room) { return ['livingLarge', 'livingSmall', 'livingMedium'].includes(room.type); }
  function normalizeEntranceSide(side) { return ORIENTATIONS.indexOf(side) >= 0 ? side : DEFAULTS.entranceSide; }
  function getEntranceZones(rooms, entranceSide) {
    // Entrance direction is a world-space setting, independent of room rotation
    // and the preferred orientation of windows/outdoor spaces.
    var side = normalizeEntranceSide(entranceSide);
    return (rooms || []).filter(isLiving).map(function (room) {
      var zone = { roomId: room.id, x: room.x, y: room.y, w: room.w, h: ENTRANCE_DEPTH, side: side };
      if (side === 'south') zone.y += room.h;
      if (side === 'north') zone.y -= ENTRANCE_DEPTH;
      if (side === 'east' || side === 'west') {
        zone.x += side === 'east' ? room.w : -ENTRANCE_DEPTH;
        zone.w = ENTRANCE_DEPTH; zone.h = room.h;
      }
      return zone;
    });
  }
  function entranceConflicts(rooms, entranceSide) {
    var conflicts = [];
    getEntranceZones(rooms, entranceSide).forEach(function (zone) {
      (rooms || []).forEach(function (room) {
        if (room.id !== zone.roomId && intersects(room, zone)) conflicts.push({ livingId: zone.roomId, roomId: room.id });
      });
    });
    return conflicts;
  }
  function canPlace(room, rooms, excludeId, entranceSide) {
    if (!validRect(room)) return false;
    return !(rooms || []).some(function (other) {
      if (excludeId !== undefined && other.id === excludeId) return false;
      if (intersects(room, other)) return true;
      if (isLiving(other) && intersects(room, getEntranceZones([other], entranceSide)[0])) return true;
      return isLiving(room) && intersects(other, getEntranceZones([room], entranceSide)[0]);
    });
  }
  function getBounds(rooms) {
    if (!rooms || !rooms.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rooms.forEach(function (room) {
      minX = Math.min(minX, room.x); minY = Math.min(minY, room.y);
      maxX = Math.max(maxX, room.x + room.w); maxY = Math.max(maxY, room.y + room.h);
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: maxX - minX, height: maxY - minY };
  }
  function addOutdoorRooms(rooms, prefs) {
    // The generator works in a south-entry frame, then rotates to the requested
    // world entrance. Preserve sunlight preferences when an outdoor module has
    // to use the adjacent edge instead of blocking the entrance.
    var side = prefs.orientation === 'south' ? 'east' : prefs.orientation;
    ['balcony', 'garden'].forEach(function (type) {
      if (prefs.outdoor !== type && prefs.outdoor !== 'both') return;
      for(var i=0;i<outdoorCounts(prefs)[type];i++){
      var room = roomAt(type, type + '-' + (i+1), 0, 0);
      var position = findPosition(room, rooms, { side: side, anchor: rooms[0], minimumContact: MINIMUM_CONTACT, snap: HALF_MODULE_CELLS, entranceSide: 'south' });
      rooms.push(Object.assign(room, position));
      }
    });
    return rooms;
  }
  function mirrorLayout(rooms) {
    var living = rooms[0];
    return rooms.map(function (room) { return Object.assign({}, room, { x: living.w - room.x - room.w }); });
  }
  function standardLayout(prefs, version) {
    var livingType = {large:'livingLarge',small:'livingSmall',medium:'livingMedium'}[prefs.living];
    var living = roomAt(livingType, 'living-1', 0, 0);
    // The large living module includes an open kitchen within its 6 × 6 m
    // footprint. The small living module still needs a separate kitchen.
    var rooms = [living];
    if (prefs.living !== 'large') rooms.push(roomAt('kitchen', 'kitchen-1', -TYPES.kitchen.w, 0));
    // The bedroom wing grows northwards, leaving the living room's light-facing edge free.
    var bedroomWidth = TYPES.bedroom.w, bedroomHeight = TYPES.bedroom.h;
    var bedroomSlots = [[0, -bedroomHeight], [bedroomWidth, -bedroomHeight], [0, -bedroomHeight * 2], [bedroomWidth, -bedroomHeight * 2]];
    if (version % 4 >= 2) bedroomSlots = [[0, -bedroomHeight], [-bedroomWidth, -bedroomHeight], [bedroomWidth, -bedroomHeight], [0, -bedroomHeight * 2]];
    for (var i = 0; i < prefs.bedrooms; i++) {
      var type=i>=prefs.bedrooms-prefs.singleBedrooms?'bedroomSingle':'bedroom';
      var next=roomAt(type,'bedroom-'+(i+1),bedroomSlots[i][0],bedroomSlots[i][1]);
      if(type==='bedroomSingle')Object.assign(next,findFreePosition(next,rooms,'south'));
      rooms.push(next);
    }
    if (version % 2) rooms = mirrorLayout(rooms);
    return addOutdoorRooms(rooms, prefs);
  }
  // Fast search heuristic: paths through usable shared walls, not straight lines
  // through other rooms. Finalists are checked against the actual drawn doors.
  function circulationScore(rooms) {
    var living=rooms.find(r=>r.type.startsWith('living'));if(!living)return 0;
    var distances=new Map(rooms.map(r=>[r.id,Infinity])),todo=new Set(rooms.map(r=>r.id));distances.set(living.id,0);
    while(todo.size){var id=[...todo].sort((a,b)=>distances.get(a)-distances.get(b))[0];todo.delete(id);if(!Number.isFinite(distances.get(id)))break;var a=rooms.find(r=>r.id===id);
      for(var b of rooms){if(!todo.has(b.id))continue;var shared=0;
        if(a.x+a.w===b.x||b.x+b.w===a.x)shared=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
        if(a.y+a.h===b.y||b.y+b.h===a.y)shared=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
        if(shared<MINIMUM_CONTACT)continue;
        var distance=(Math.abs(a.x+a.w/2-b.x-b.w/2)+Math.abs(a.y+a.h/2-b.y-b.h/2))*CELL_METERS;
        var penalty=a.id===living.id?0:isBedroom(a)?12:['garden','balcony'].includes(a.type)&&!['garden','balcony'].includes(b.type)?20:0;
        distances.set(b.id,Math.min(distances.get(b.id),distances.get(id)+distance+penalty));
      }
    }
    var ds=rooms.filter(r=>r.id!==living.id).map(r=>distances.get(r.id)),bounds=getBounds(rooms),area=rooms.reduce((n,r)=>n+r.w*r.h,0),ratio=Math.max(bounds.width,bounds.height)/Math.max(1,Math.min(bounds.width,bounds.height));
    return ds.reduce((n,d)=>n+(Number.isFinite(d)?d:1000),0)+Math.max(0,...ds.filter(Number.isFinite))*2+Math.max(0,ratio-1.4)*24+(bounds.width*bounds.height-area)*CELL_METERS*CELL_METERS;
  }
  function footprintArea(rooms) {
    var bounds = getBounds(rooms);
    return bounds.width * bounds.height;
  }
  function separatedBedrooms(rooms) {
    var kitchens = rooms.filter(function (room) { return room.type === 'kitchen'; });
    return rooms.filter(function (room) {
      return isBedroom(room) && kitchens.some(function (kitchen) { return touches(room, kitchen); });
    });
  }
  var candidateCache = new Map();
  function layoutCandidates(prefs, separate) {
    var key = [prefs.living, prefs.bedrooms, prefs.singleBedrooms, prefs.outdoor, prefs.gardenCount, prefs.balconyCount, prefs.orientation, separate].join(':');
    if (candidateCache.has(key)) return candidateCache.get(key);
    var candidates = [], seen = new Set();
    function geometryKey(rooms) {
      return rooms.map(function (room) { return [room.type, room.x, room.y, room.w, room.h].join(','); }).sort().join('|');
    }
    function append(rooms) {
      if (entranceConflicts(rooms, 'south').length || validateLayout(rooms).overlaps.length || enclosedVoids(rooms).length) return;
      if (separate && separatedBedrooms(rooms).length) return;
      var layoutKey = geometryKey(rooms);
      if (!seen.has(layoutKey)) { seen.add(layoutKey); candidates.push(rooms); }
    }
    // Keep the familiar arrangements among the candidates, then search several
    // connected arrangements. This is a bounded search, not a global optimum.
    for (var version = 0; version < 4; version++) append(standardLayout(prefs, version));
    var livingType = {large:'livingLarge',small:'livingSmall',medium:'livingMedium'}[prefs.living];
    var kitchenSlots = prefs.living !== 'large' ? [[0, -1], [0, 1], [TYPES[livingType].h - TYPES.kitchen.h, -1], [TYPES[livingType].h - TYPES.kitchen.h, 1]] : [null];
    kitchenSlots.forEach(function (kitchenSlot) {
      var living = roomAt(livingType, 'living-1', 0, 0);
      var seed = [living];
      if (kitchenSlot) {
        var kitchenX = kitchenSlot[1] < 0 ? -TYPES.kitchen.w : living.w;
        seed.push(roomAt('kitchen', 'kitchen-1', kitchenX, kitchenSlot[0]));
      }
      var beam = [addOutdoorRooms(seed, prefs)];
      for (var count = 0; count < prefs.bedrooms; count++) {
        var next = [], nextSeen = new Set();
        var bedType=count>=prefs.bedrooms-prefs.singleBedrooms?'bedroomSingle':'bedroom',bedSize=TYPES[bedType];
        beam.forEach(function (rooms) {
          var positions = new Set();
          function consider(x, y) {
            var positionKey = x + ',' + y;
            if (positions.has(positionKey)) return;
            positions.add(positionKey);
            var bedroom = roomAt(bedType, 'bedroom-' + (count + 1), x, y);
            // Keep all bedrooms behind the living room's outdoor-facing edge.
            if (bedroom.y + bedroom.h > living.h || !canPlace(bedroom, rooms, undefined, 'south')) return;
            if (separate && rooms.some(function (room) { return room.type === 'kitchen' && touches(bedroom, room); })) return;
            var proposal = rooms.concat([bedroom]), proposalKey = geometryKey(proposal);
            if (!nextSeen.has(proposalKey)) { nextSeen.add(proposalKey); next.push(proposal); }
          }
          rooms.filter(function (room) { return room.type !== 'balcony' && room.type !== 'garden'; }).forEach(function (room) {
            [room.x, room.x + room.w - bedSize.w].forEach(function (x) {
              consider(x, room.y - bedSize.h); consider(x, room.y + room.h);
            });
            [room.y, room.y + room.h - bedSize.h].forEach(function (y) {
              consider(room.x - bedSize.w, y); consider(room.x + room.w, y);
            });
          });
        });
        next.sort(function (a, b) { return circulationScore(a) - circulationScore(b); });
        beam = next.slice(0, 24);
      }
      beam.forEach(append);
    });
    candidateCache.set(key, candidates);
    return candidates;
  }
  function createLayout(input, variant, constraints) {
    var prefs = normalizePrefs(input);
    var turns = ORIENTATIONS.indexOf(prefs.entranceSide);
    var localPrefs = Object.assign({}, prefs, {
      entranceSide: 'south', orientation: ORIENTATIONS[(ORIENTATIONS.indexOf(prefs.orientation) - turns + 4) % 4]
    });
    var version = Math.abs(Math.floor(Number(variant) || 0));
    constraints = constraints || {};
    var rooms;
    var candidates=layoutCandidates(localPrefs,!!constraints.separateKitchenBedroom).slice();
    if(constraints.compactFootprint){var bestArea=Math.min(...candidates.map(footprintArea));candidates=candidates.filter(r=>footprintArea(r)===bestArea);}
    candidates.sort((a,b)=>circulationScore(a)-circulationScore(b));
    if(!candidates.length)throw new Error('无法找到可连接的无中空拼法');
    rooms=candidates[version%candidates.length].map(cloneRoom);
    if(enclosedVoids(rooms).length){var alternatives=layoutCandidates(localPrefs,!!constraints.separateKitchenBedroom);if(!alternatives.length)throw new Error('无法找到无中空的拼法');rooms=alternatives[version%alternatives.length].map(cloneRoom);}
    // Rotate complete rectangles, including their dimensions/rotation metadata,
    // back into world axes. This keeps entry direction separate from orientation.
    for (var turn = 0; turn < turns; turn++) rooms = rooms.map(function (room) {
      return Object.assign({}, room, { x: -room.y - room.h, y: room.x,
        w: room.h, h: room.w, rotation: ((room.rotation || 0) + 90) % 360 });
    });
    var bounds = getBounds(rooms);
    return rooms.map(function (room) { return Object.assign({}, room, { x: room.x - bounds.minX, y: room.y - bounds.minY }); });
  }
  function rebuildLayout(input, variant, constraints, existingRooms) {
    var rooms = createLayout(input, variant, constraints);
    var assigned=new Set();
    (existingRooms||[]).filter(r=>r.functionPlan&&!['custom','washroom','showerRoom'].includes(r.type)).forEach(original=>{
      var target=rooms.find(r=>r.type===original.type&&!assigned.has(r.id));
      if(!target)throw new Error('子类型房间不能在重新生成时静默丢弃，请明确移除目标。');
      var replacement=createCustomRoom(original.functionPlan,target.id,target.x,target.y,target.rotation);
      if(replacement.w!==target.w||replacement.h!==target.h)throw new Error('子类型尺寸不同，请通过模块操作保留原布局。');
      Object.assign(target,replacement);assigned.add(target.id);
    });
    var customRooms = (existingRooms || []).filter(function (room) { return ['custom','washroom','showerRoom'].includes(room.type); });
    if (!customRooms.length) return rooms;
    var entranceSide = normalizePrefs(input).entranceSide;
    // A custom id may have arrived through an imported document. Keep its identity
    // stable, even if it happens to match a freshly generated standard room id.
    var usedIds = new Set(customRooms.map(function (room) { return room.id; }));
    rooms = rooms.map(function (room) {
      var id = room.id, count = 1;
      while (usedIds.has(id)) id = room.id + '-layout-' + count++;
      usedIds.add(id);
      return id === room.id ? room : Object.assign({}, room, { id: id });
    });
    customRooms.forEach(function (original) {
      var room = cloneRoom(original), definition = getDefinition(room), rotated = room.rotation % 180 !== 0;
      if (!definition || !validRect(room) || [0, 90, 180, 270].indexOf(room.rotation) < 0 ||
          room.w !== (rotated ? definition.h : definition.w) || room.h !== (rotated ? definition.w : definition.h)) {
        throw new TypeError('Invalid custom module');
      }
      var hasDoorWall = rooms.some(function (other) {
        var contact = 0;
        if (room.x + room.w === other.x || other.x + other.w === room.x) contact = Math.min(room.y + room.h, other.y + other.h) - Math.max(room.y, other.y);
        if (room.y + room.h === other.y || other.y + other.h === room.y) contact = Math.max(contact, Math.min(room.x + room.w, other.x + other.w) - Math.max(room.x, other.x));
        return contact >= MINIMUM_CONTACT;
      });
      if (Math.abs(room.x) > MAX_COORD || Math.abs(room.y) > MAX_COORD || !hasDoorWall || enclosedVoids(rooms.concat(room)).length || !canPlace(room, rooms, undefined, entranceSide)) {
        Object.assign(room, findFreePosition(room, rooms, entranceSide));
      }
      rooms.push(room);
    });
    return rooms;
  }
  function occupiedArea(rooms) {
    // Union area also gives honest feedback after a manually edited/imported
    // plan: overlapping modules must never count twice toward coverage.
    var rectangles = rooms.filter(validRect);
    var edges = Array.from(new Set(rectangles.reduce(function (xs, room) {
      return xs.concat([room.x, room.x + room.w]);
    }, []))).sort(function (a, b) { return a - b; });
    var area = 0;
    for (var i = 1; i < edges.length; i++) {
      var left = edges[i - 1], right = edges[i];
      var intervals = rectangles.filter(function (room) { return room.x < right && room.x + room.w > left; })
        .map(function (room) { return [room.y, room.y + room.h]; }).sort(function (a, b) { return a[0] - b[0]; });
      var length = 0, start = null, end = null;
      intervals.forEach(function (interval) {
        if (start === null) { start = interval[0]; end = interval[1]; }
        else if (interval[0] <= end) end = Math.max(end, interval[1]);
        else { length += end - start; start = interval[0]; end = interval[1]; }
      });
      if (start !== null) length += end - start;
      area += (right - left) * length;
    }
    return area;
  }
  function evaluateRequirements(rooms, constraints) {
    rooms = rooms || []; constraints = constraints || {};
    var results = [];
    if(constraints.gardenCourtyard){
      var gardens=rooms.filter(r=>r.type==='garden'),living=rooms.find(r=>r.type.startsWith('living')),seen=new Set(),queue=gardens.length?[gardens[0]]:[];
      while(queue.length){var g=queue.pop();if(seen.has(g.id))continue;seen.add(g.id);gardens.filter(n=>!seen.has(n.id)&&touches(g,n)).forEach(n=>queue.push(n));}
      var b=gardens.length?getBounds(gardens):{width:0,height:0},area=gardens.reduce((n,r)=>n+r.w*r.h,0);
      var compact=area>0&&area/(b.width*b.height)>=.7&&Math.max(b.width,b.height)/Math.min(b.width,b.height)<=2;
      var direct=!!living&&gardens.some(g=>touches(living,g));
      results.push({id:'gardenCourtyard',label:'连续花园，客厅直达',status:compact&&direct&&seen.size===gardens.length?'met':'unmet',detail:compact&&direct&&seen.size===gardens.length?'花园连成紧凑庭院，与客厅直接相接；实际门与通路另行核对。':'需要紧凑连片的花园和客厅直接连接，不能只串在睡房外。'});
    }
    if (constraints.separateKitchenBedroom) {
      var adjacent = separatedBedrooms(rooms), bedrooms = rooms.filter(function (room) { return isBedroom(room); });
      var canEvaluate = bedrooms.length > 0 && rooms.some(function (room) { return room.type === 'kitchen'; });
      var hasOpenKitchen = rooms.some(function (room) { return room.type === 'livingLarge'; });
      var detail = !canEvaluate ? (hasOpenKitchen ? '大客厅采用开放厨房，无法按独立厨房模块核对厨卧分离；需要结合厨房位置与隔墙另行确认。' : '当前方案缺少厨房或睡房，暂不能核对。') : adjacent.length ?
          '厨房与 ' + adjacent.length + ' 间睡房共边。' :
          '厨房与 ' + bedrooms.length + ' 间睡房均不共边；角点接触不计为共边。';
      if (hasOpenKitchen && canEvaluate) detail += ' 客厅仍有开放厨房，不能据此确认完整厨卧隔离。';
      results.push({ id: 'separateKitchenBedroom', label: hasOpenKitchen && canEvaluate ? '睡房与独立厨房不共边' : '睡房与厨房不共边',
        status: !canEvaluate && hasOpenKitchen ? 'pending' : canEvaluate && !adjacent.length ? 'met' : 'unmet', detail: detail });
    }
    if (constraints.compactFootprint) {
      var boundsArea = footprintArea(rooms), coverage = boundsArea > 0 ? occupiedArea(rooms) / boundsArea : 0;
      results.push({ id: 'compactFootprint', label: '户型尽量方正', status: coverage >= 0.9 ? 'met' : 'partial',
        detail: '模块占外接矩形面积的 ' + Math.round(coverage * 100) + '%；这是形状紧凑度参考。' });
    }
    return results;
  }
  function findPosition(shape, rooms, options) {
    options = options || {};
    if (!rooms || !rooms.length) return { x: Math.max(-MAX_COORD, Math.min(MAX_COORD, shape.x || 0)), y: Math.max(-MAX_COORD, Math.min(MAX_COORD, shape.y || 0)) };
    var bounds = getBounds(rooms);
    var centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
    var best = null, seen = new Set();
    function consider(x, y) {
      if (options.snap > 1) { x = Math.round(x / options.snap) * options.snap; y = Math.round(y / options.snap) * options.snap; }
      var key = x + ',' + y;
      if (seen.has(key)) return;
      seen.add(key);
      if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return;
      var candidate = Object.assign({}, shape, { x: x, y: y });
      if (options.allowed && !options.allowed(candidate)) return;
      if (!canPlace(candidate, rooms, undefined, options.entranceSide)) return;
      var dx = x + shape.w / 2 - centerX, dy = y + shape.h / 2 - centerY;
      var area = (Math.max(bounds.maxX, x + shape.w) - Math.min(bounds.minX, x)) *
        (Math.max(bounds.maxY, y + shape.h) - Math.min(bounds.minY, y));
      var distance = dx * dx + dy * dy;
      var movement = Math.abs(x - (shape.x || 0)) + Math.abs(y - (shape.y || 0));
      var anchor = options.anchor, side = options.side;
      var preferred = !anchor || !side || (side === 'north' && y + shape.h <= anchor.y) ||
        (side === 'south' && y >= anchor.y + anchor.h) || (side === 'east' && x >= anchor.x + anchor.w) ||
        (side === 'west' && x + shape.w <= anchor.x);
      // A one-cell contact connects rectangles but cannot fit the concept plan's
      // 0.9m door. Prefer a usable shared wall before minimizing repair movement.
      var usableContact = !options.minimumContact || (options.attachTo || rooms).some(function (other) {
        var shared = 0;
        if (x + shape.w === other.x || other.x + other.w === x) shared = Math.min(y + shape.h, other.y + other.h) - Math.max(y, other.y);
        if (y + shape.h === other.y || other.y + other.h === y) shared = Math.max(shared, Math.min(x + shape.w, other.x + other.w) - Math.max(x, other.x));
        return shared >= options.minimumContact;
      });
      var score = options.preserve ? [usableContact ? 0 : 1, movement, area, distance, y, x] : [usableContact ? 0 : 1, preferred ? 0 : 1, circulationScore(rooms.concat(candidate)), area, distance, y, x];
      function better(a, b) { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; }
      if (!best || better(score, best.score)) {
        best = { x: x, y: y, score: score };
      }
    }
    (options.attachTo || rooms).forEach(function (room) {
      for (var x = room.x - shape.w + 1; x < room.x + room.w; x++) {
        consider(x, room.y - shape.h); consider(x, room.y + room.h);
      }
      for (var y = room.y - shape.h + 1; y < room.y + room.h; y++) {
        consider(room.x - shape.w, y); consider(room.x + room.w, y);
      }
    });
    // A crowded imported plan near the coordinate limits may have no legal
    // touching position. Search bounded free space instead of bypassing rules.
    if (!best) for (var y = -MAX_COORD; y <= MAX_COORD; y++) for (var x = -MAX_COORD; x <= MAX_COORD; x++) consider(x, y);
    if (!best) throw new Error('No free position inside the plan limits');
    return { x: best.x, y: best.y };
  }
  function findFreePosition(typeOrRoom, rooms, entranceSide, allowed) {
    var definition = getDefinition(typeOrRoom);
    if (!definition) throw new Error('Unknown module type: ' + (typeof typeOrRoom === 'string' ? typeOrRoom : typeOrRoom && typeOrRoom.type));
    var shape = typeof typeOrRoom === 'string' ? { type: typeOrRoom, x: 0, y: 0, w: definition.w, h: definition.h } : cloneRoom(typeOrRoom);
    if (!validRect(shape)) throw new TypeError('Invalid module dimensions');
    var result = findPosition(shape, rooms, { minimumContact: MINIMUM_CONTACT, entranceSide: entranceSide, allowed: candidate => (!allowed||allowed(candidate))&&!enclosedVoids(rooms.concat(candidate)).length });
    if (allowed && !allowed(Object.assign({}, shape, result))) throw new Error('Outside household boundary');
    return result;
  }
  function repairEntrance(input, entranceSide) {
    var rooms = (input || []).map(cloneRoom);
    var conflicts = entranceConflicts(rooms, entranceSide);
    if (!conflicts.length) return { rooms: rooms, movedIds: [] };
    var originallyDetached = new Set(validateLayout(rooms).disconnected);
    var blocked = new Set(conflicts.map(function (conflict) { return conflict.roomId; }));
    var pending = rooms.filter(function (room) { return blocked.has(room.id); });
    var kept = rooms.filter(function (room) { return !blocked.has(room.id); });
    pending.forEach(function (room) {
      kept.push(Object.assign({}, room, findPosition(room, kept, { preserve: true, minimumContact: MINIMUM_CONTACT, entranceSide: entranceSide })));
    });
    // An outdoor chain can lose its only neighbour when its first module moves.
    // Reconnect only rooms stranded by this repair, leaving unrelated old manual
    // disconnections untouched. Living-root rooms retain their original positions.
    var detached = new Set(validateLayout(kept).disconnected);
    var stranded = new Set(Array.from(detached).filter(function (id) { return !originallyDetached.has(id); }));
    if (stranded.size) {
      pending = kept.filter(function (room) { return stranded.has(room.id); });
      kept = kept.filter(function (room) { return !stranded.has(room.id); });
      var connected = kept.filter(function (room) { return !detached.has(room.id); });
      pending.forEach(function (room) {
        var moved = Object.assign({}, room, findPosition(room, kept, { preserve: true, minimumContact: MINIMUM_CONTACT, attachTo: connected, entranceSide: entranceSide }));
        kept.push(moved); connected.push(moved);
      });
    }
    var byId = new Map(kept.map(function (room) { return [room.id, room]; }));
    var repaired = rooms.map(function (room) { return byId.get(room.id); });
    return { rooms: repaired, movedIds: rooms.filter(function (room, i) {
      return room.x !== repaired[i].x || room.y !== repaired[i].y;
    }).map(function (room) { return room.id; }) };
  }
  function standardizeLayout(input, entranceSide, sourceCellMeters) {
    // Migration is explicit: callers retain the original document as a backup.
    // Keep ids, rotations and old adjacency where possible; only relocate a
    // resized rectangle when its old relationship can no longer fit safely.
    var original = (input || []).map(cloneRoom);
    var scale = (Number(sourceCellMeters) > 0 ? Number(sourceCellMeters) : CELL_METERS) / CELL_METERS;
    if (original.some(function (room) { return !getDefinition(room) || !validRect(room) || typeof room.id !== 'string' || !room.id; }) ||
        new Set(original.map(function (room) { return room.id; })).size !== original.length) throw new Error('Cannot standardize an invalid module');
    var originalById = new Map(original.map(function (room) { return [room.id, room]; }));
    var remaining = original.slice(), placed = [], root = remaining.find(isLiving) || remaining[0];
    function alignOffset(start, size, anchorStart, anchorSize, newAnchorStart, newAnchorSize, newSize) {
      if (start === anchorStart) return newAnchorStart;
      if (start + size === anchorStart + anchorSize) return newAnchorStart + newAnchorSize - newSize;
      return newAnchorStart + Math.round((start - anchorStart) * scale);
    }
    while (remaining.length) {
      var old = !placed.length ? root : remaining.find(function (candidate) {
        return placed.some(function (anchor) { return touches(candidate, originalById.get(anchor.id)); });
      }) || remaining[0];
      remaining = remaining.filter(function (room) { return room !== old; });
      var definition = getDefinition(old), rotated = Math.abs(Number(old.rotation) || 0) % 180 === 90;
      var room = Object.assign({}, old, { x: Math.round(old.x * scale), y: Math.round(old.y * scale),
        w: rotated ? definition.h : definition.w, h: rotated ? definition.w : definition.h });
      var anchors = placed.filter(function (anchor) { return touches(old, originalById.get(anchor.id)); });
      var relations = anchors.map(function (anchor) {
        var before = originalById.get(anchor.id), candidate = cloneRoom(room);
        if (old.x + old.w === before.x || before.x + before.w === old.x) {
          candidate.x = old.x < before.x ? anchor.x - room.w : anchor.x + anchor.w;
          candidate.y = alignOffset(old.y, old.h, before.y, before.h, anchor.y, anchor.h, room.h);
        } else {
          candidate.y = old.y < before.y ? anchor.y - room.h : anchor.y + anchor.h;
          candidate.x = alignOffset(old.x, old.w, before.x, before.w, anchor.x, anchor.w, room.w);
        }
        return candidate;
      });
      function fits(candidate) { return Math.abs(candidate.x) <= MAX_COORD && Math.abs(candidate.y) <= MAX_COORD && canPlace(candidate, placed, undefined, entranceSide); }
      var preferred = relations.find(function (candidate) {
        return fits(candidate) && anchors.some(function (anchor) {
          if (candidate.x + candidate.w === anchor.x || anchor.x + anchor.w === candidate.x) {
            return Math.min(candidate.y + candidate.h, anchor.y + anchor.h) - Math.max(candidate.y, anchor.y) >= MINIMUM_CONTACT;
          }
          if (candidate.y + candidate.h === anchor.y || anchor.y + anchor.h === candidate.y) {
            return Math.min(candidate.x + candidate.w, anchor.x + anchor.w) - Math.max(candidate.x, anchor.x) >= MINIMUM_CONTACT;
          }
          return false;
        });
      });
      if (preferred) room = preferred;
      else if (relations.length || !fits(room)) {
        room = Object.assign(room, findPosition(relations[0] || room, placed, {
          preserve: true, minimumContact: MINIMUM_CONTACT, attachTo: anchors.length ? anchors : placed, entranceSide: entranceSide
        }));
      }
      placed.push(room);
    }
    var byId = new Map(placed.map(function (room) { return [room.id, room]; }));
    var result = original.map(function (room) { return byId.get(room.id); });
    return { rooms: result, gridVersion: GRID_VERSION,
      movedIds: original.filter(function (room, index) { return result[index].x !== Math.round(room.x * scale) || result[index].y !== Math.round(room.y * scale); }).map(function (room) { return room.id; }),
      resizedIds: original.filter(function (room, index) { return result[index].w !== room.w * scale || result[index].h !== room.h * scale; }).map(function (room) { return room.id; }) };
  }
  function moveRoom(rooms, id, x, y, entranceSide) {
    var room = rooms.find(function (item) { return item.id === id; });
    if (!room) return null;
    var moved = Object.assign({}, room, { x: x, y: y });
    if (!canPlace(moved, rooms, id, entranceSide)) return null;
    return rooms.map(function (item) { return item.id === id ? moved : cloneRoom(item); });
  }
  function rotateRoom(rooms, id, entranceSide) {
    var room = rooms.find(function (item) { return item.id === id; });
    if (!room) return null;
    // Alternate the rounding side so rotating odd/even dimensions four times never drifts.
    var roundPosition = ((room.rotation || 0) % 180 === 0) ? Math.floor : Math.ceil;
    var rotated = Object.assign({}, room, { w: room.h, h: room.w,
      x: room.x + roundPosition((room.w - room.h) / 2),
      y: room.y + roundPosition((room.h - room.w) / 2), rotation: ((room.rotation || 0) + 90) % 360 });
    if (!canPlace(rotated, rooms, id, entranceSide)) return null;
    return rooms.map(function (item) { return item.id === id ? rotated : cloneRoom(item); });
  }
  function getStats(rooms) {
    var result = { interiorArea: 0, outdoorArea: 0, totalArea: 0, bedrooms: 0, moduleCount: rooms.length };
    rooms.forEach(function (room) {
      var area = room.w * room.h * CELL_METERS * CELL_METERS;
      if (room.type === 'balcony' || room.type === 'garden') result.outdoorArea += area;
      else result.interiorArea += area;
      if (isBedroom(room)) result.bedrooms++;
    });
    result.totalArea = roundArea(result.interiorArea + result.outdoorArea);
    result.interiorArea = roundArea(result.interiorArea);
    result.outdoorArea = roundArea(result.outdoorArea);
    return result;
  }
  // Flood the complement of the exact rectangle union. Edge compression keeps
  // small gaps visible without scanning the full, potentially huge canvas.
  function enclosedVoids(rooms) {
    var rs=rooms.filter(validRect); if(!rs.length)return [];
    var b=getBounds(rs),xs=Array.from(new Set([b.minX-1,b.maxX+1].concat(rs.flatMap(r=>[r.x,r.x+r.w])))).sort((a,b)=>a-b),ys=Array.from(new Set([b.minY-1,b.maxY+1].concat(rs.flatMap(r=>[r.y,r.y+r.h])))).sort((a,b)=>a-b);
    var w=xs.length-1,h=ys.length-1,cells=new Uint8Array(w*h);
    rs.forEach(r=>{for(var y=ys.indexOf(r.y);y<ys.indexOf(r.y+r.h);y++)for(var x=xs.indexOf(r.x);x<xs.indexOf(r.x+r.w);x++)cells[y*w+x]=1;});
    function flood(seed){var queue=[seed],area=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;cells[seed]=2;
      for(var i=0;i<queue.length;i++){var n=queue[i],x=n%w,y=Math.floor(n/w);area+=(xs[x+1]-xs[x])*(ys[y+1]-ys[y]);minX=Math.min(minX,xs[x]);minY=Math.min(minY,ys[y]);maxX=Math.max(maxX,xs[x+1]);maxY=Math.max(maxY,ys[y+1]);
        var neighbors=[];if(x)neighbors.push(n-1);if(x+1<w)neighbors.push(n+1);if(y)neighbors.push(n-w);if(y+1<h)neighbors.push(n+w);
        neighbors.forEach(k=>{if(!cells[k]){cells[k]=2;queue.push(k);}});
      }return {area:area,areaM2:area*CELL_METERS*CELL_METERS,minX:minX,minY:minY,maxX:maxX,maxY:maxY};
    }
    flood(0);var holes=[];for(var i=0;i<cells.length;i++)if(!cells[i])holes.push(flood(i));return holes;
  }
  // Minimal explicit repair: move/rotate one existing module, never invent space.
  function closeVoids(rooms,entranceSide,allowed){
    var holes=enclosedVoids(rooms);if(!holes.length)return {rooms:rooms,movedIds:[]};var best=null;
    rooms.filter(r=>!r.type.startsWith('living')).forEach(original=>{
      var others=rooms.filter(r=>r.id!==original.id);
      [0,1].forEach(turn=>{var shape=Object.assign({},original,{w:turn?original.h:original.w,h:turn?original.w:original.h,rotation:((original.rotation||0)+turn*90)%360});
        holes.forEach(hole=>{[hole.minX,hole.maxX-shape.w].forEach(x=>[hole.minY,hole.maxY-shape.h].forEach(y=>{
          var r=Object.assign({},shape,{x:x,y:y});if(allowed&&!allowed(r)||!canPlace(r,others,undefined,entranceSide))return;
          var result=rooms.map(n=>n.id===r.id?r:n);if(validateLayout(result).disconnected.length||enclosedVoids(result).length)return;
          var score=Math.abs(x-original.x)+Math.abs(y-original.y)+turn;
          if(!best||score<best.score)best={rooms:result,movedIds:[r.id],score:score};
        }));});
      });
    });return best;
  }
  function validateLayout(rooms) {
    var overlaps = [], disconnected = [];
    rooms.forEach(function (room, i) {
      for (var j = i + 1; j < rooms.length; j++) if (intersects(room, rooms[j])) overlaps.push([room.id, rooms[j].id]);
    });
    if (rooms.length) {
      var root = rooms.find(function (room) { return /^living/.test(room.type); }) || rooms[0];
      var reached = new Set([root.id]), queue = [root];
      while (queue.length) {
        var current = queue.shift();
        rooms.forEach(function (room) {
          if (!reached.has(room.id) && touches(current, room)) { reached.add(room.id); queue.push(room); }
        });
      }
      disconnected = rooms.filter(function (room) { return !reached.has(room.id); }).map(function (room) { return room.id; });
    }
    return { overlaps: overlaps, disconnected: disconnected };
  }
  function parseWish(text, currentPrefs) {
    text = String(text || '').trim();
    var prefs = normalizePrefs(currentPrefs), recognized = [];
    var numberMap = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
      '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    var countPattern = /([零一二两三四五六七八九十\d]+)\s*(?:间|个)?\s*(?:卧室|睡房|卧房|寝室|房间|房|室)/g;
    var match, count;
    while ((match = countPattern.exec(text))) {
      count = /^\d+$/.test(match[1]) ? Number(match[1]) : numberMap[match[1]];
    }
    if (Number.isFinite(count)) {
      prefs.bedrooms = Math.max(1, Math.min(4, count));
      recognized.push(prefs.bedrooms + ' 间睡房' + (count > 4 ? '（当前最多 4 间）' : ''));
    }
    var household = [
      { value: 'solo', pattern: /一个人|一人住|(?:^|[^\d])1\s*(?:个)?\s*人|单人|独居|自己住/g, label: '独居生活' },
      { value: 'couple', pattern: /两个人|两人住|(?:^|[^\d])2\s*(?:个)?\s*人|双人|夫妻|情侣|二人|两口子/g, label: '两人生活' },
      { value: 'family', pattern: /一家[一二两三四五六七八九\d]+口|一家人|家庭|孩子|小孩|父母|亲子|(?:[三四五六七八九十]|[3-9]|\d{2,})\s*(?:个)?\s*人/g, label: '家庭生活' }
    ];
    var lastHousehold = null;
    household.forEach(function (entry) { while ((match = entry.pattern.exec(text))) if (!lastHousehold || match.index > lastHousehold.index) lastHousehold = { index: match.index, entry: entry }; });
    if (lastHousehold) { prefs.household = lastHousehold.entry.value; recognized.push(lastHousehold.entry.label); }
    var livingMatches = [];
    [
      { value: 'large', pattern: /大客厅|宽敞的?客厅|开阔的?客厅|客厅[^，。；,;]{0,5}(?:宽敞|大一点|大一些|更大|大些)/g },
      { value: 'small', pattern: /小客厅|紧凑的?客厅|客厅[^，。；,;]{0,5}(?:紧凑|小一点|小一些|更小|小些)/g }
    ].forEach(function (entry) {
      while ((match = entry.pattern.exec(text))) {
        var value = entry.value;
        if (/(?:不要|不想要|不需要)\s*$/.test(text.slice(Math.max(0, match.index - 5), match.index))) value = value === 'large' ? 'small' : 'large';
        livingMatches.push({ index: match.index, value: value });
      }
    });
    if (livingMatches.length) {
      livingMatches.sort(function (a, b) { return a.index - b.index; });
      prefs.living = livingMatches[livingMatches.length - 1].value;
      recognized.push(prefs.living === 'large' ? '大客厅' : '小客厅');
    }
    var outdoors = { balcony: prefs.outdoor === 'balcony' || prefs.outdoor === 'both', garden: prefs.outdoor === 'garden' || prefs.outdoor === 'both' };
    var outdoorFound = false;
    if (/(?:不要|不需要|取消|去掉|没有|无)(?:任何)?(?:室外|户外|室外空间|户外空间)/.test(text)) {
      outdoors.balcony = false; outdoors.garden = false; outdoorFound = true;
    }
    text.split(/[，。！？；,!?;\n]|但是|不过|但|而是/).forEach(function (clause) {
      var pattern = /阳台|露台|花园|庭院/g, token;
      while ((token = pattern.exec(clause))) {
        var type = /阳台|露台/.test(token[0]) ? 'balcony' : 'garden';
        var prefix = clause.slice(0, token.index), suffix = clause.slice(token.index + token[0].length);
        var intentPattern = /不想要|不需要|不希望有|不要|不带|不设|无需|没有|去掉|取消|舍弃|移除|不喜欢|无|想要|需要|希望|保留|加上|添加|增加|要|带|有/g;
        var intent, lastIntent = '';
        while ((intent = intentPattern.exec(prefix))) lastIntent = intent[0];
        var negative = /^(?:不|无|没|去掉|取消|舍弃|移除)/.test(lastIntent);
        if (/^(?:\s|暂时|先|也|都|就|我)*(?:不要|不需要|取消|去掉|没有|不想要)/.test(suffix) ||
            /(?:都|全部)(?:不要|不需要|取消|去掉)\s*$/.test(clause)) negative = true;
        outdoors[type] = !negative; outdoorFound = true;
      }
    });
    if (outdoorFound) {
      prefs.outdoor = outdoors.balcony ? (outdoors.garden ? 'both' : 'balcony') : (outdoors.garden ? 'garden' : 'none');
      recognized.push({ both: '阳台 + 花园', balcony: '带阳台', garden: '带花园', none: '不设阳台和花园' }[prefs.outdoor]);
    }
    var directionNames = { '南': 'south', '东': 'east', '西': 'west', '北': 'north' };
    var lastDirection = null, directionPriority = 0;
    text.split(/[，。！？；,!?;\n]|但是|不过|但|而是/).forEach(function (clause) {
      var directionPattern = /(?:朝向?|面向?|向)\s*([东南西北])|([东南西北])\s*向/g;
      var direction;
      while ((direction = directionPattern.exec(clause))) {
        var before = clause.slice(0, direction.index);
        if (/(?:不要|不想|避免|不能)\s*$/.test(before)) continue;
        // The only orientation control belongs to the living room. Do not repurpose a bedroom wish.
        var subjectPattern = /客厅|起居室|卧室|睡房|房间|厨房|阳台|花园|庭院/g;
        var subject = null, subjectMatch;
        while ((subjectMatch = subjectPattern.exec(before))) subject = subjectMatch[0];
        if (!subject) {
          var afterSubject = clause.slice(direction.index + direction[0].length).match(/^\s*的?\s*(客厅|起居室|卧室|睡房|房间|厨房|阳台|花园|庭院)/);
          if (afterSubject) subject = afterSubject[1];
        }
        if (subject && subject !== '客厅' && subject !== '起居室') continue;
        var priority = subject ? 2 : 1;
        if (priority >= directionPriority) {
          lastDirection = direction[1] || direction[2]; directionPriority = priority;
        }
      }
    });
    if (lastDirection) { prefs.orientation = directionNames[lastDirection]; recognized.push('客厅朝' + lastDirection); }
    var lifestyle = [
      { value: 'relaxed', pattern: /放松|休闲|悠闲|惬意|慵懒/g, label: '轻松休闲' },
      { value: 'social', pattern: /聚会|会客|朋友|热闹|社交/g, label: '喜欢相聚' },
      { value: 'quiet', pattern: /安静|独处|阅读|看书|静谧/g, label: '喜欢安静' }
    ];
    var lastLifestyle = null;
    lifestyle.forEach(function (entry) { while ((match = entry.pattern.exec(text))) if (!lastLifestyle || match.index > lastLifestyle.index) lastLifestyle = { index: match.index, entry: entry }; });
    if (lastLifestyle) { prefs.lifestyle = lastLifestyle.entry.value; recognized.push(lastLifestyle.entry.label); }
    return { prefs: prefs, recognized: recognized, unrecognized: recognized.length === 0 };
  }

  return {
    CELL_METERS: CELL_METERS, MODULE_METERS: MODULE_METERS, MODULE_CELLS: MODULE_CELLS,
    HALF_MODULE_CELLS: HALF_MODULE_CELLS, GRID_VERSION: GRID_VERSION, MAX_COORD: MAX_COORD,
    TYPES: TYPES, DEFAULTS: Object.assign({}, DEFAULTS), ENTRANCE_DEPTH: ENTRANCE_DEPTH,
    getDefinition: getDefinition, createCustomRoom: createCustomRoom,
    createLayout: createLayout, rebuildLayout: rebuildLayout, normalizePrefs: normalizePrefs, intersects: intersects, canPlace: canPlace,
    findFreePosition: findFreePosition, moveRoom: moveRoom, rotateRoom: rotateRoom,
    getEntranceZones: getEntranceZones, entranceConflicts: entranceConflicts, repairEntrance: repairEntrance, standardizeLayout: standardizeLayout,
    outdoorCounts: outdoorCounts, isBedroom: isBedroom, getBounds: getBounds, getStats: getStats, enclosedVoids: enclosedVoids, closeVoids: closeVoids, validateLayout: validateLayout, evaluateRequirements: evaluateRequirements,
    circulationScore: circulationScore, parseWish: parseWish, touches: touches
  };
});

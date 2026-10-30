(function (root, factory) {
  'use strict';
  var engine = typeof module === 'object' && module.exports ? require('./engine.js') : root.WishEngine;
  var rules = typeof module === 'object' && module.exports ? require('./furniture-rules.js') : root.WishFurnitureRules;
  var access = typeof module === 'object' && module.exports ? require('./accessibility.js') : root.WishAccess;
  var api = factory(engine, rules, access);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishInterior = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E, R, A) {
  'use strict';

  // Furniture uses a stable 0.6 m working unit. The public boundary converts
  // from/to the engine grid so refining the drafting grid never shrinks doors,
  // furniture or clearance. Directions always describe the plan's compass.
  var WORKING_CELL_METERS = 0.6;
  var SIDES = ['north', 'east', 'south', 'west'];
  var OPPOSITE = { north: 'south', east: 'west', south: 'north', west: 'east' };
  var SIDE_NAMES = { north: '北', east: '东', south: '南', west: '西' };
  var EPS = 0.0002, MARGIN = 0;
  var profileCache = Object.create(null), zoneCache = new WeakMap(), roomLayoutCache = new Map();
  function isLiving(room) { return ['livingLarge', 'livingSmall', 'livingMedium'].includes(room.type); }
  function isBathroom(room) { return room.type === 'washroom' || room.type === 'showerRoom'; }
  function isOutdoor(room) { return room.type === 'balcony' || room.type === 'garden'; }
  function length(room, side) { return side === 'north' || side === 'south' ? room.w : room.h; }
  function round(n) { return Math.round(n * 10000) / 10000; }
  function overlap(a, b, padding) {
    var p = padding || 0;
    return a.x < b.x + b.w + p - EPS && a.x + a.w + p > b.x + EPS &&
      a.y < b.y + b.h + p - EPS && a.y + a.h + p > b.y + EPS;
  }
  function inside(rect, room) {
    return rect.x >= -EPS && rect.y >= -EPS && rect.x + rect.w <= room.w + EPS && rect.y + rect.h <= room.h + EPS;
  }
  function intervalsOverlap(a, b, padding) {
    return a.start < b.start + b.width + (padding || 0) - EPS && a.start + a.width + (padding || 0) > b.start + EPS;
  }
  function subtract(segments, cuts) {
    var result = segments.map(function (s) { return { start: s.start, width: s.width }; });
    cuts.forEach(function (cut) {
      var next = [];
      result.forEach(function (s) {
        var end = s.start + s.width, cutEnd = cut.start + cut.width;
        if (cutEnd <= s.start + EPS || cut.start >= end - EPS) next.push(s);
        else {
          if (cut.start > s.start + EPS) next.push({ start: s.start, width: cut.start - s.start });
          if (cutEnd < end - EPS) next.push({ start: cutEnd, width: end - cutEnd });
        }
      });
      result = next;
    });
    return result;
  }
  function wallContact(a, b) {
    var start, end, side;
    if (Math.abs(a.y - b.y - b.h) < EPS || Math.abs(a.y + a.h - b.y) < EPS) {
      start = Math.max(a.x, b.x); end = Math.min(a.x + a.w, b.x + b.w);
      side = Math.abs(a.y - b.y - b.h) < EPS ? 'north' : 'south';
      if (end > start + EPS) return { side: side, start: start - a.x, otherStart: start - b.x, width: end - start };
    }
    if (Math.abs(a.x - b.x - b.w) < EPS || Math.abs(a.x + a.w - b.x) < EPS) {
      start = Math.max(a.y, b.y); end = Math.min(a.y + a.h, b.y + b.h);
      side = Math.abs(a.x - b.x - b.w) < EPS ? 'west' : 'east';
      if (end > start + EPS) return { side: side, start: start - a.y, otherStart: start - b.y, width: end - start };
    }
    return null;
  }
  function clearance(room, side, start, width, depth) {
    var horizontal = side === 'north' || side === 'south';
    var along = Math.max(0, start), span = Math.min(length(room, side), start + width) - along;
    var inward = Math.min(depth, (horizontal ? room.h : room.w) - 0.1);
    if (side === 'north') return { x: along, y: 0, w: span, h: inward };
    if (side === 'south') return { x: along, y: room.h - inward, w: span, h: inward };
    if (side === 'west') return { x: 0, y: along, w: inward, h: span };
    return { x: room.w - inward, y: along, w: inward, h: span };
  }
  function makeDoor(room, side, start, width, kind, to) {
    return { side: side, start: round(start), width: width, kind: kind, to: to || null,
      clearance: clearance(room, side, start, width, kind === 'entry' ? 2 : kind === 'sliding' ? 1 : 1.5), drawSwing: kind === 'entry' };
  }
  function center(rect) { return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }; }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function segmentCrossesRect(a, b, rect) {
    var enter = 0, leave = 1;
    return ['x', 'y'].every(function (axis) {
      var delta = b[axis] - a[axis], low = rect[axis], high = low + rect[axis === 'x' ? 'w' : 'h'];
      if (Math.abs(delta) < EPS) return a[axis] >= low && a[axis] <= high;
      var one = (low - a[axis]) / delta, two = (high - a[axis]) / delta;
      enter = Math.max(enter, Math.min(one, two)); leave = Math.min(leave, Math.max(one, two));
      return enter <= leave;
    });
  }
  function wallPoint(room, opening) {
    var mid = opening.start + opening.width / 2;
    return opening.side === 'north' ? { x: mid, y: 0 } : opening.side === 'south' ? { x: mid, y: room.h } :
      opening.side === 'east' ? { x: room.w, y: mid } : { x: 0, y: mid };
  }
  function entry(room, data, side) {
    var width = 1.5;
    var wallLength = length(room, side), inwardLength = side === 'north' || side === 'south' ? room.h : room.w;
    var segment = (data.entryExposed || data.exposed)[side].filter(function (s) { return s.width >= width + 0.2; }).sort(function (a, b) {
      return Math.abs(a.start + a.width / 2 - wallLength / 2) - Math.abs(b.start + b.width / 2 - wallLength / 2);
    })[0];
    if (!segment) {
      data.entryBlocked = true;
      data.notes.push('客厅' + SIDE_NAMES[side] + '侧主入口被相邻模块遮挡，请先移开该模块。');
      return;
    }
    var start = Math.max(segment.start + 0.1, Math.min(wallLength / 2 - width / 2, segment.start + segment.width - width - 0.1));
    if (room.type === 'livingSmall') {
      var perpendicular = side === 'north' || side === 'south' ? ['west','east'] : ['north','south'];
      data.edgeRouteSide = perpendicular.sort(function(a,b) {
        function contact(s) { return data.shared.filter(w => w.side === s).reduce((n,w) => n+w.width,0); }
        return contact(b)-contact(a);
      })[0];
      start = ['west','north'].includes(data.edgeRouteSide) ? segment.start + .1 : segment.start + segment.width - width - .1;
      if(perpendicular.every(s=>data.shared.some(w=>w.side===s))&&!data.shared.some(w=>w.side===OPPOSITE[side]))start=Math.max(segment.start+.1,Math.min(wallLength/2-width/2,segment.start+segment.width-width-.1));
    }
    data.doors.push(makeDoor(room, side, start, width, 'entry'));
    if(room.type==='livingSmall')data.doors[data.doors.length-1].hingeEnd=['west','north'].includes(data.edgeRouteSide) && start<.5;
    // Extend the approach beyond the swing so a coffee table cannot seal the entrance.
    data.circulation.push(clearance(room, side, start, width, Math.min(inwardLength / 2, 3)));
  }
  function doorPriority(a, b) {
    if (isLiving(a) || isLiving(b)) return isOutdoor(a) || isOutdoor(b) ? 1 : 0;
    if (a.type==='balcony'&&isBedroom(b)||b.type==='balcony'&&isBedroom(a)) return 1;
    if (isOutdoor(a) && isOutdoor(b)) return 2;
    if (isBedroom(a) && isBedroom(b)) return 4;
    if (isOutdoor(a) || isOutdoor(b)) return 6;
    return 5;
  }
  function swingPriority(room) { return isBedroom(room) ? 3 : room.type === 'kitchen' ? 2 : isLiving(room) ? 1 : 0; }
  function placeDoors(rooms, byRoom, edges, entranceSide) {
    var parent = Object.create(null);
    rooms.forEach(function (room) { parent[room.id] = room.id; if (isLiving(room)) entry(room, byRoom[room.id], entranceSide); });
    function find(id) { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; }
    edges.sort(function (a, b) {
      return doorPriority(a.a, a.b) - doorPriority(b.a, b.b) || b.contact.width - a.contact.width || a.key.localeCompare(b.key);
    }).forEach(function (edge) {
      var a = edge.a, b = edge.b, c = edge.contact, aData = byRoom[a.id], bData = byRoom[b.id];
      // Adjoining garden modules form one landscape, with no partition or gate.
      if(a.type==='garden'&&b.type==='garden'){
        aData.doors.push(makeDoor(a,c.side,c.start,c.width,'landscape',b.id));
        bData.doors.push(makeDoor(b,OPPOSITE[c.side],c.otherStart,c.width,'landscape',a.id));
        parent[find(a.id)]=find(b.id);return;
      }
      if ((isBathroom(a) && aData.doors.length) || (isBathroom(b) && bData.doors.length)) return;
      if (c.width < 1.5 - EPS || find(a.id) === find(b.id)) return;
      // A living room's entrance edge is reserved for the external main entrance.
      if (isLiving(a) && c.side === entranceSide || isLiving(b) && OPPOSITE[c.side] === entranceSide) return;
      var outdoor = isOutdoor(a) || isOutdoor(b), width = outdoor && c.width >= 2.4 && a.type!=='livingSmall'&&b.type!=='livingSmall' ? 2 : 1.5;
      var slack = c.width - width, inset = 0, offsets = [slack / 2, inset, slack - inset];
      for (var offset = inset; offset <= slack - inset + EPS; offset += 0.4) offsets.push(offset);
      var choices = offsets.map(function (off) {
        var da = makeDoor(a, c.side, c.start + off, width, isBathroom(a) || isBathroom(b) ? 'sliding' : outdoor ? 'outdoor' : 'internal', b.id);
        var db = makeDoor(b, OPPOSITE[c.side], c.otherStart + off, width, da.kind, a.id);
        var score = Math.abs(off - slack / 2) * 0.015;
        [aData, bData].forEach(function (data, index) {
          var proposed = index ? db : da, room = index ? b : a;
          if (room.type === 'livingSmall') {
            var point = wallPoint(room, proposed), routeSide = data.edgeRouteSide;
            var toEdge = routeSide === 'west' ? point.x : routeSide === 'east' ? room.w-point.x : routeSide === 'north' ? point.y : room.h-point.y;
            // Cluster the side doors at the entrance end, keeping the outward
            // half of the room as one uninterrupted place to sit and work.
            var entrySide=data.doors.find(d=>d.kind==='entry')?.side;
            var toEntry=entrySide==='north'?point.y:entrySide==='south'?room.h-point.y:entrySide==='west'?point.x:room.w-point.x;
            score += (proposed.side===entrySide || proposed.side===OPPOSITE[entrySide] ? toEdge : toEntry) * 20;
          }
          data.doors.forEach(function (door) {
            if (overlap(proposed.clearance, door.clearance) && room.type!=='livingSmall') score += 10;
          });
          if (!!room.functionPlan) {
            score += customItems(room).reduce(function (sum, item) {
              return sum + (overlap(item, proposed.clearance, 0.1) ? 10 + item.w * item.h : 0);
            }, 0);
          } else if (isBathroom(room)) {
            var trial = Object.assign({},data,{doors:data.doors.concat([proposed]),furniture:[]});
            bathroom(room,trial);
            score += ((room.type==='showerRoom'?3:2)-trial.furniture.length)*200 + blockedAccess(checkAccess(room,trial,trial.furniture))*100;
          } else if (!isOutdoor(room)) {
            var trial = Object.assign({}, data, { doors: data.doors.concat([proposed]) });
            var fits = wallCandidates(room, trial, isBedroom(room) ? 'bed' : isLiving(room) ? 'sofa' : 'stove',
              isBedroom(room) ? 3 : isLiving(room) ? 3 : 1.25,
              isBedroom(room) ? 3.5 : isLiving(room) ? 1.4 : 0.95, [], { allowWindow: true, limit: 3 });
            score += fits.length ? 12 / (fits.length + 1) : 100;
            if (isBedroom(room)) {
              // Keep enough of the internal wall beside the doorway for tall
              // storage, instead of forcing it onto a useful exterior facade.
              score += wallCandidates(room, trial, 'wardrobe', 1.6, .9, [], { limit: 1 }).length ? 0 : 35;
            }
          }
        });
        return { a: da, b: db, score: score };
      }).sort(function (one, two) { return one.score - two.score || one.a.start - two.a.start; });
      var selected = choices[0];
      if((a.type==='garden'&&isLiving(b))||(b.type==='garden'&&isLiving(a))){selected.a.glazed=true;selected.b.glazed=true;}
      selected.a.drawSwing = selected.a.kind !== 'sliding' && !outdoor && (swingPriority(a) > swingPriority(b) || swingPriority(a) === swingPriority(b) && a.id < b.id);
      selected.b.drawSwing = selected.b.kind !== 'sliding' && !outdoor && !selected.a.drawSwing;
      aData.doors.push(selected.a); bData.doors.push(selected.b); parent[find(a.id)] = find(b.id);
    });
    var living = rooms.find(isLiving);
    var entryRoots = rooms.filter(function (room) { return byRoom[room.id].doors.some(function (door) { return door.kind === 'entry'; }); }).map(function (room) { return find(room.id); });
    rooms.forEach(function (room) {
      var data = byRoom[room.id];
      data.entryConnected = living ? entryRoots.indexOf(find(room.id)) >= 0 : null;
      if (living && find(room.id) !== find(living.id)) data.notes.push('与主入口之间尚无可用的室内通路；需要移动模块，增加至少 0.9 米的共墙接触。');
      if (isBedroom(room) && data.doors.filter(function (door) { return door.to; }).length > 1) {
        data.notes.push('目前有通路穿过睡房；可调整模块位置以改善私密性。');
      }
    });
  }
  function solidWallItem(item, side) {
    // Tall storage / unknown equipment reserve every wall they touch. Beds,
    // seating, screens and hobs need an uninterrupted backing wall only.
    if (['storage', 'equipment', 'unknown'].indexOf(item.profile) >= 0 || ['storage', 'equipment'].indexOf(item.type) >= 0) return true;
    return ['bed', 'wardrobe', 'sofa', 'tv', 'stove'].indexOf(item.type) >= 0 && item.side === side ||
      ['doubleBed', 'singleBed', 'largeBed', 'sofa', 'largeSofa', 'tv', 'stove'].indexOf(item.profile) >= 0 && item.side === side;
  }
  function windowSegments(room, data, side, furniture) {
    var cuts = data.doors.filter(function (door) { return door.side === side; }).map(function (door) {
      return { start: door.start - .35, width: door.width + .7 };
    });
    (furniture || []).forEach(function (item) {
      var horizontal = side === 'north' || side === 'south';
      var gap = side === 'north' ? item.y : side === 'south' ? room.h - item.y - item.h : side === 'west' ? item.x : room.w - item.x - item.w;
      if (gap < .3 && solidWallItem(item, side)) cuts.push({ start: (horizontal ? item.x : item.y) - .2, width: (horizontal ? item.w : item.h) + .4 });
    });
    return subtract(data.exposed[side], cuts);
  }
  function deskWindowScore(room, item, window) {
    if (['desk', 'gamingDesk'].indexOf(item.profile) < 0) return 0;
    var horizontal = window.side === 'north' || window.side === 'south';
    var aligned = intervalsOverlap({ start: horizontal ? item.x : item.y, width: horizontal ? item.w : item.h }, window);
    var near = Math.max(0, 1 - distance(center(item), wallPoint(room, window)) / 12);
    // Lateral light is a qualitative preference, not a glare calculation.
    if (window.side !== item.side && window.side !== OPPOSITE[item.side]) return -2.5 * near;
    return aligned ? (window.side === item.side ? 3 : 2) * near : .15;
  }
  function windowCandidates(room, data, prefs, furniture) {
    var result = [];
    SIDES.forEach(function (side) {
      windowSegments(room, data, side, furniture).forEach(function (segment) {
        // 0.60 m is a concept-level minimum opening, with 0.12 m end piers.
        if (segment.width < 1.4 - EPS) return;
        var width = Math.min(room.type === 'kitchen' ? 1.8 : isLiving(room) ? 3 : 2.4, segment.width - .4);
        [segment.start + (segment.width - width) / 2, segment.start + .2, segment.start + segment.width - width - .2].forEach(function (start, index) {
          var window = { side: side, start: round(start), width: round(width) };
          var light = (side === prefs.orientation ? 3 : 0) + Math.min(segment.width, 8) * .2 + (side === 'south' ? .4 : side === 'east' ? .2 : 0);
          var desk = (furniture || []).reduce(function (sum, item) { return sum + deskWindowScore(room, item, window); }, 0);
          result.push(Object.assign(window, { score: light - desk - (index ? .03 : 0) }));
        });
      });
    });
    return result.sort(function (a, b) { return b.score - a.score || SIDES.indexOf(a.side) - SIDES.indexOf(b.side) || a.start - b.start; });
  }
  function furnish(room, data) {
    if (room.type === 'livingSmall') reserveEdgeCirculation(room, data);
    if (room.functionPlan) custom(room, data);
    else if (isBedroom(room)) bedroom(room, data);
    else if (isLiving(room)) living(room, data);
    else if (isBathroom(room)) bathroom(room, data);
    else if (room.type === 'kitchen') kitchen(room, data);
    else if (isOutdoor(room)) outdoor(room, data);
    else if (!!room.functionPlan) custom(room, data);
    if (!isOutdoor(room) && !isBathroom(room)) customCirculation(room, data, data.furniture, true);
    data.accessibility = checkAccess(room, data, data.furniture);
  }
  function checkAccess(room, data, items, withPaths) {
    if (!A || typeof A.check !== 'function') return { status: 'unresolved', anchor: 'none', targets: [], issues: [{ code: 'access-unanchored', label: '家具通路', message: '家具使用通路尚未完成检查。' }] };
    var result = A.check(room, Object.assign({}, data, { furniture: items.map(function (item, index) {
      return Object.assign({}, item, { id: room.id + '-furniture-' + index });
    }) }), WORKING_CELL_METERS, { paths: !!withPaths });
    if (data.entryConnected === false) {
      result.status = 'unresolved';
      result.issues.unshift({ code: 'access-disconnected', label: '主入口连接', message: '当前模块与主入口未连通；即使家具在模块内可接近，也不能从家中入口走到这里，需要重新连接模块。', options: ['连接到客厅', '调整模块位置'] });
    }
    return result;
  }
  function reserveEdgeCirculation(room, data) {
    var half = .75, span = 1.5, w = room.w-span, h = room.h-span, perimeter=2*(w+h);
    if (w <= 0 || h <= 0 || !data.doors.length) return;
    function position(door) {
      var mid=door.start+door.width/2;
      if(door.side==='north')return Math.max(0,Math.min(w,mid-half));
      if(door.side==='east')return w+Math.max(0,Math.min(h,mid-half));
      if(door.side==='south')return w+h+Math.max(0,Math.min(w,room.w-half-mid));
      return 2*w+h+Math.max(0,Math.min(h,room.h-half-mid));
    }
    function point(t){t=((t%perimeter)+perimeter)%perimeter;return t<=w?{x:half+t,y:half}:t<=w+h?{x:room.w-half,y:half+t-w}:t<=2*w+h?{x:room.w-half-(t-w-h),y:room.h-half}:{x:half,y:room.h-half-(t-2*w-h)};}
    function path(a,b){
      if(b<a)b+=perimeter;
      var ts=[a,b];[0,w,w+h,2*w+h,perimeter,perimeter+w,perimeter+w+h,perimeter+2*w+h].forEach(t=>{if(t>a+EPS&&t<b-EPS)ts.push(t);});
      ts.sort((a,b)=>a-b);
      return ts.slice(1).map(function(t,i){var a=point(ts[i]),b=point(t);return {x:Math.min(a.x,b.x)-half,y:Math.min(a.y,b.y)-half,w:Math.abs(a.x-b.x)+span,h:Math.abs(a.y-b.y)+span};});
    }
    var entryDoor=data.doors.find(d=>d.kind==='entry')||data.doors[0], anchor=position(entryDoor);
    var routes=data.doors.filter(d=>d!==entryDoor).flatMap(function(door){
      var t=position(door),forward=(t-anchor+perimeter)%perimeter;
      return forward<=perimeter/2?path(anchor,t):path(t,anchor);
    });
    data.edgeCirculation=routes.concat(data.circulation);
    data.circulation=data.edgeCirculation.slice();
  }
  function blockedAccess(access) {
    return access && access.issues ? access.issues.filter(function (issue) { return issue.code === 'access-blocked'; }).length : 0;
  }
  function pickAccessibleLayout(room, data, layouts, limit) {
    if (!layouts.length) return null;
    layouts.sort(function (a, b) { return b.items.length - a.items.length || a.score - b.score; });
    var checked = [];
    for (var index = 0; index < Math.min(limit || 12, layouts.length); index++) {
      var layout = layouts[index];
      layout.accessibility = checkAccess(room, data, layout.items);
      var routeTrial = Object.assign({}, data, { circulation: data.circulation.slice(), routeUnresolved: false });
      customCirculation(room, routeTrial, layout.items, true);
      layout.routeUnresolved = !!routeTrial.routeUnresolved;
      checked.push(layout);
      if (!blockedAccess(layout.accessibility) && !layout.routeUnresolved) return layout;
    }
    return checked.sort(function (a, b) { return (a.routeUnresolved ? 1 : 0) - (b.routeUnresolved ? 1 : 0) || blockedAccess(a.accessibility) - blockedAccess(b.accessibility) || b.items.length - a.items.length || a.score - b.score; })[0];
  }
  function completeWindows(room, data, prefs) {
    var candidates = windowCandidates(room, data, prefs, data.furniture), chosen = data.windows.filter(function (window) {
      return windowSegments(room, data, window.side, data.furniture).some(function (segment) {
        return window.start >= segment.start - EPS && window.start + window.width <= segment.start + segment.width + EPS;
      });
    });
    // Projected opening length is a simple sizing heuristic. It does not claim
    // a daylight factor, effective vent area or a climate-specific performance.
    var target = Math.max(1.8, Math.sqrt(room.w * room.h) * WORKING_CELL_METERS * .65) / WORKING_CELL_METERS;
    while (true) {
      var total = chosen.reduce(function (sum, window) { return sum + window.width; }, 0);
      if (chosen.length >= 2 && total >= target - EPS) break;
      var next = candidates.filter(function (candidate) { return !chosen.some(function (window) { return window.side === candidate.side; }); })
        .map(function (candidate) {
          var opposed = chosen.some(function (window) { return OPPOSITE[window.side] === candidate.side; });
          return { window: candidate, score: candidate.score + (opposed ? 1.2 : chosen.length ? .6 : 0) };
        }).sort(function (a, b) { return b.score - a.score; })[0];
      if (!next) break;
      chosen.push({ side: next.window.side, start: next.window.start, width: next.window.width });
    }
    data.windows = chosen;
  }
  function placeWindowsAndFurniture(room, data, prefs) {
    if (isOutdoor(room)) {
      furnish(room, data);
      data.accessibility = checkAccess(room, data, data.furniture, true);
      data.windowStrategy = { mode: 'outdoor', exposedSides: [], windowSides: [], ventilation: 'none', reason: '室外模块不设置室内窗。', furnitureAdjusted: false, scope: 'concept' };
      return;
    }
    // At most five furniture solves: a no-window baseline plus the strongest
    // primary opening on each available facade. Adding later windows only uses
    // wall intervals left clear by that trial's real-size furniture.
    var seeds = [null], seen = new Set();
    windowCandidates(room, data, prefs, []).forEach(function (window) {
      if (!seen.has(window.side)) { seen.add(window.side); seeds.push({ side: window.side, start: window.start, width: window.width }); }
    });
    var layouts = seeds.map(function (seed, index) {
      var trial = Object.assign({}, data, { windows: seed ? [seed] : [], furniture: [], notes: data.notes.slice(), circulation: data.circulation.slice() });
      furnish(room, trial);
      completeWindows(room, trial, prefs);
      var sides = trial.windows.map(function (window) { return window.side; });
      var total = trial.windows.reduce(function (sum, window) { return sum + window.width; }, 0);
      var target = Math.max(1.8, Math.sqrt(room.w * room.h) * WORKING_CELL_METERS * .65) / WORKING_CELL_METERS;
      var score = Math.min(total / target, 1) * 4 + (sides.length > 1 ? 5 : 0) +
        (sides.some(function (side) { return sides.indexOf(OPPOSITE[side]) >= 0; }) ? 1.2 : 0) +
        (sides.indexOf(prefs.orientation) >= 0 ? 6 : 0) - (trial.routeUnresolved ? 1000 : 0);
      trial.furniture.forEach(function (item) { trial.windows.forEach(function (window) { score -= deskWindowScore(room, item, window); }); });
      return { data: trial, score: score, index: index };
    });
    // Preserve the identity of every requested item fitted by the baseline,
    // rather than accepting a different set with the same item count.
    var baseline = layouts[0].data;
    var baselineReachable = baseline.furniture.filter(function (item, index) {
      var id = room.id + '-furniture-' + index;
      return !(baseline.accessibility && baseline.accessibility.targets || []).some(function (target) { return target.itemId === id && target.reachable === false; });
    });
    function preservesBaseline(trial) {
      if (!baseline.routeUnresolved && trial.routeUnresolved) return false;
      var counts = Object.create(null);
      trial.furniture.forEach(function (item) { var key = !!room.functionPlan ? item.sourceIndex : item.type; counts[key] = (counts[key] || 0) + 1; });
      return baselineReachable.every(function (item) { if(room.type==='livingSmall' && item.type==='tv')return true; var key = !!room.functionPlan ? item.sourceIndex : item.type; return (counts[key]-- || 0) > 0; });
    }
    layouts = layouts.filter(function (layout) { return preservesBaseline(layout.data); }).sort(function (a, b) {
      var compactA = room.type === 'livingLarge' && a.data.furniture.some(function (item) { return item.type === 'sofa' && item.placement === 'floating'; });
      var compactB = room.type === 'livingLarge' && b.data.furniture.some(function (item) { return item.type === 'sofa' && item.placement === 'floating'; });
      return blockedAccess(a.data.accessibility) - blockedAccess(b.data.accessibility) || Number(!!a.data.routeUnresolved) - Number(!!b.data.routeUnresolved) ||
        (room.type === 'livingSmall' ? Number(!!b.data.windows.length)-Number(!!a.data.windows.length) : 0) ||
        (room.type === 'livingSmall' ? Math.min(3,b.data.windows.reduce((n,w)=>n+w.width,0))-Math.min(3,a.data.windows.reduce((n,w)=>n+w.width,0)) : 0) ||
        b.data.furniture.length - a.data.furniture.length || Number(compactB) - Number(compactA) || b.score - a.score || a.index - b.index;
    });
    var selected = layouts[0].data;
    ['windows', 'furniture', 'notes', 'circulation', 'edgeCirculation', 'requestedItems', 'routeUnresolved', 'accessibility', 'kitchenIntegrated'].forEach(function (key) { if (selected[key] !== undefined) data[key] = selected[key]; });
    data.accessibility = checkAccess(room, data, data.furniture, true);
    data.windows.sort(function (a, b) { return (a.side === prefs.orientation ? 0 : 1) - (b.side === prefs.orientation ? 0 : 1); });
    var exposedSides = SIDES.filter(function (side) { return data.exposed[side].some(function (segment) { return segment.width >= 1.4; }); });
    var windowSides = data.windows.map(function (window) { return window.side; });
    var ventilation = windowSides.some(function (side) { return windowSides.indexOf(OPPOSITE[side]) >= 0; }) ? 'opposite' : windowSides.length > 1 ? 'adjacent' : windowSides.length ? 'single-sided' : 'none';
    var solid = isBedroom(room) ? '床头和衣柜' : room.type === 'livingLarge' ? '电视、灶台和贴墙家具' : isLiving(room) ? '沙发和电视' : room.type === 'kitchen' ? '灶台' : '高柜与设备';
    var reason = windowSides.length > 1 ? windowSides.map(function (side) { return SIDE_NAMES[side]; }).join('、') + '侧外墙开窗，保留' + solid + '需要的实墙；' +
      (ventilation === 'opposite' ? '相对开口为穿堂通风提供可能。' : '相邻开口增加采光方向和通风路径。') : windowSides.length ?
      SIDE_NAMES[windowSides[0]] + '侧开窗；' + (exposedSides.length <= 1 ? '其余墙面被相邻模块遮挡或外露长度不足。' : '其余可用外墙需保留门口、家具实墙及使用空间，暂保留单面窗。') :
      '当前外墙可用段不足，或与门口、家具实墙冲突，暂不强行开窗；可调整模块连接。';
    if (!!room.functionPlan && data.furniture.some(function (item) { return ['desk', 'gamingDesk'].indexOf(item.profile) >= 0; }) && windowSides.length > 1) {
      var lateral = data.furniture.filter(function (item) { return ['desk', 'gamingDesk'].indexOf(item.profile) >= 0; }).every(function (item) {
        return windowSides.some(function (side) { return side !== item.side && side !== OPPOSITE[item.side]; });
      });
      if (lateral) reason += '电脑桌优先靠侧向窗布置，减少开口正对屏幕的情况。';
    }
    data.windowStrategy = { mode: windowSides.length > 1 ? 'multi-side' : windowSides.length ? 'single-side' : exposedSides.length ? 'constrained' : 'no-exterior',
      exposedSides: exposedSides, windowSides: windowSides, ventilation: ventilation, reason: reason,
      furnitureAdjusted: JSON.stringify(data.furniture) !== JSON.stringify(baseline.furniture), scope: 'concept' };
    if (!data.windows.length) data.notes.push(data.doors.some(d=>d.glazed)?'客厅通过通向花园的0.9 m玻璃移门采光；实际采光效果、门槛与排水仍需细化。':'当前没有足够长的外墙可开窗；需要调整相邻模块或家具位置。');
  }
  function isAvailable(room, data, rect, placed) {
    var zones = itemUseZones(rect);
    return inside(rect, room) && zones.every(function (zone) { return inside(zone, room); }) &&
      !data.doors.some(function (door) { return overlap(rect, door.clearance); }) &&
      !data.circulation.some(function (space) { return overlap(rect, space); }) &&
      !(room.type === 'livingSmall' && rect.profile === 'desk' && zones.some(zone => (data.edgeCirculation || []).some(space => overlap(zone,space)))) &&
      !placed.some(function (item) {
        return overlap(rect, item) || itemUseZones(item).some(function (zone) { return overlap(rect, zone) && !sharesDeskZone(item, rect, zone); }) ||
          zones.some(function (zone) { return overlap(item, zone) && !sharesDeskZone(rect, item, zone); });
      });
  }
  function storageBlocksExterior(room, data, item) {
    if (item.profile !== 'storage' && item.type !== 'wardrobe' && item.type !== 'storage') return false;
    return SIDES.some(function (side) {
      var horizontal = side === 'north' || side === 'south';
      var gap = side === 'north' ? item.y : side === 'south' ? room.h - item.y - item.h : side === 'west' ? item.x : room.w - item.x - item.w;
      if (gap >= .3) return false;
      return data.exposed[side].some(function (segment) {
        return segment.width >= 1.4 - EPS && intervalsOverlap({ start: horizontal ? item.x : item.y, width: horizontal ? item.w : item.h }, segment);
      });
    });
  }
  function sharesDeskZone(owner, occupant, zone) {
    return (zone.kind === 'front' && ['desk', 'gamingDesk'].indexOf(owner.profile) >= 0 || ['diningTable', 'familyDiningTable'].indexOf(owner.profile) >= 0) && ['chair', 'diningChair'].indexOf(occupant.profile) >= 0 &&
      owner.groupId && owner.groupId === occupant.groupId;
  }
  function itemUseZones(item) {
    if (!item.profile) return [];
    if (['chair', 'diningChair'].indexOf(item.profile) >= 0 && item.paired) return [];
    var zones = zoneCache.get(item);
    if (!zones) {
      zones = [];
      var back = Math.max(0, SIDES.indexOf(item.side));
      function add(side, meters, kind, label) {
        if (!(meters > 0) || side===item.wallSide) return;
        var depth = meters / WORKING_CELL_METERS;
        var rect = side === 'north' ? { x: item.x, y: item.y - depth, w: item.w, h: depth } :
          side === 'south' ? { x: item.x, y: item.y + item.h, w: item.w, h: depth } :
          side === 'west' ? { x: item.x - depth, y: item.y, w: depth, h: item.h } : { x: item.x + item.w, y: item.y, w: depth, h: item.h };
        zones.push(Object.assign(rect, { kind: kind, label: item.label + ' · ' + label, requiredM: meters, profile: item.profile }));
      }
      add(SIDES[(back + 2) % 4], item.frontM, 'front', ['desk', 'gamingDesk'].indexOf(item.profile) >= 0 ? '座椅与拉出空间' : '前方使用空间');
      add(SIDES[(back + 1) % 4], item.sideM, 'side', '侧方使用空间');
      add(SIDES[(back + 3) % 4], item.sideM, 'side', '侧方使用空间');
      add(item.side, item.backM, 'back', '后方使用空间');
      zoneCache.set(item, zones);
    }
    return zones;
  }
  function physicalSpec(type, along) {
    if (type === 'singleDesk') return R.resolve({profile:'desk',widthM:1,depthM:.5,label:'小书桌'});
    if (type === 'singleWardrobe') return R.resolve({profile:'storage',widthM:.8,depthM:.6,label:'单人衣柜'});
    if (type === 'compactDesk') return R.resolve({profile:'desk',widthM:1,depthM:.5,label:'折叠餐写桌'});
    if (type === 'compactChair') return R.resolve({profile:'diningChair',widthM:.45,depthM:.45,label:'紧凑餐椅'});
    if (type === 'sofa' && along === 2.5) return R.resolve({profile:'sofa',widthM:1.5,depthM:.85,label:'紧凑双人沙发'});
    var profile = { bed: 'doubleBed', wardrobe: 'storage', table: 'coffeeTable', sink: 'kitchenSink', counter: 'kitchenCounter', outdoorchair: 'chair' }[type] || type;
    if (type === 'sofa') profile = along > 3.1 ? 'largeSofa' : 'sofa';
    if (!profileCache[profile]) profileCache[profile] = R.resolve({ type: type, profile: profile });
    return profileCache[profile];
  }
  function decorate(item, spec) {
    ['profile', 'label', 'widthM', 'depthM', 'frontM', 'sideM', 'backM', 'verified', 'source'].forEach(function (key) { item[key] = spec[key]; });
    return item;
  }
  function furnitureAt(room, type, side, start, along, depth) {
    var spec = physicalSpec(room.type==='bedroomSingle'&&type==='bed'?'singleBed':type, along);
    along = spec.widthM / WORKING_CELL_METERS; depth = spec.depthM / WORKING_CELL_METERS;
    var vertical = side === 'east' || side === 'west';
    return decorate({ type: ({singleDesk:'desk',singleWardrobe:'wardrobe'}[type]||type), side: side, x: round(side === 'east' ? room.w - MARGIN - depth : vertical ? MARGIN : start),
      y: round(side === 'south' ? room.h - MARGIN - depth : vertical ? start : MARGIN),
      w: vertical ? depth : along, h: vertical ? along : depth, rotation: SIDES.indexOf(side) * 90 }, spec);
  }
  function wallCandidates(room, data, type, along, depth, placed, options) {
    options = options || {};
    var candidates = [], sides = options.sides || SIDES, spec = physicalSpec(room.type==='bedroomSingle'&&type==='bed'?'singleBed':type, along), authoredAlong = along;
    along = spec.widthM / WORKING_CELL_METERS; depth = spec.depthM / WORKING_CELL_METERS;
    sides.forEach(function (side) {
      if (options.limit && candidates.length >= options.limit) return;
      var max = length(room, side) - MARGIN - along;
      if (max < MARGIN - EPS) return;
      var starts = [(length(room, side) - along) / 2, MARGIN, max];
      data.windows.filter(function (window) { return window.side === side; }).forEach(function (window) {
        starts.push(Math.max(MARGIN, Math.min(max, window.start + (window.width - along) / 2)));
      });
      for (var start = MARGIN; start <= max + EPS; start += 0.4) starts.push(start);
      starts.forEach(function (position) {
        if (options.limit && candidates.length >= options.limit) return;
        var rect = furnitureAt(room, type, side, position, authoredAlong, depth), projection = { start: position, width: along };
        if(rect.profile==='singleBed'){var lateral=[SIDES[(SIDES.indexOf(side)+1)%4],SIDES[(SIDES.indexOf(side)+3)%4]];rect.wallSide=lateral.find(function(edge){var gap=edge==='north'?rect.y:edge==='south'?room.h-rect.y-rect.h:edge==='west'?rect.x:room.w-rect.x-rect.w;return Math.abs(gap)<EPS;});}
        if (!isAvailable(room, data, rect, placed)) return;
        if (storageBlocksExterior(room, data, rect)) return;
        if (!options.allowWindow && data.windows.some(function (window) { return window.side === side && intervalsOverlap(projection, window, 0.15); })) return;
        var score = 0;
        if (options.nearWindow) {
          score += data.windows.length ? Math.min.apply(null, data.windows.map(function (window) { return distance(center(rect), wallPoint(room, window)); })) : 12;
          if (!data.windows.some(function (window) { return window.side === side; })) score += 2;
          if (rect.profile === 'desk') score += data.windows.reduce(function (sum, window) { return sum + deskWindowScore(room, rect, window) * 2; }, 0);
        }
        if (options.awayDoor) score -= Math.min.apply(null, data.doors.map(function (door) { return distance(center(rect), wallPoint(room, door)); }).concat([8])) * 0.1;
        score += Math.abs(position + along / 2 - length(room, side) / 2) * 0.035;
        // Rotation is only a deterministic tie-break. Actual walls/openings decide feasibility.
        score += ((SIDES.indexOf(side) - Math.round((room.rotation || 0) / 90) + 4) % 4) * 0.025;
        candidates.push({ item: rect, score: score });
      });
    });
    return candidates.sort(function (a, b) { return a.score - b.score || a.item.y - b.item.y || a.item.x - b.item.x; });
  }
  function best(room, data, type, along, depth, placed, options) {
    var list = wallCandidates(room, data, type, along, depth, placed, options);
    return list.length ? list[0] : null;
  }
  function facingTV(room, data, sofa, placed, fast) {
    var options = { sides: [OPPOSITE[sofa.side]], limit: fast ? 2 : undefined };
    return best(room, data, 'tv', 2.2, 0.42, placed, options) || best(room, data, 'tv', 1.7, 0.32, placed, options);
  }
  function furnishingPenalty(room, data) {
    if (!!room.functionPlan) {
      return customItems(room).reduce(function (sum, item) {
        return sum + (customBlocksWindow(room, data, item) ? 20 + item.w * item.h : 0);
      }, 0);
    }
    if (isBedroom(room)) {
      var beds = wallCandidates(room, data, 'bed', 3, 3.5, [], { limit: 4 });
      return beds.length ? 2 / beds.length : 200;
    }
    if (isLiving(room)) {
      var sofas = wallCandidates(room, data, 'sofa', room.type === 'livingLarge' ? 3.4 : 3, 1.4, [], { limit: 8 });
      if (!sofas.length) return 200;
      var hasTV = sofas.some(function (sofa) { return !!facingTV(room, data, sofa.item, [sofa.item], true); });
      return (hasTV ? 0 : 60) + 2 / sofas.length;
    }
    if (room.type === 'kitchen') return best(room, data, 'stove', 1.25, 0.95, [], { limit: 2 }) ? 0 : 200;
    return 0;
  }
  function isBedroom(room){return ['bedroom','bedroomSingle'].includes(room.type);}
  function bathroom(room, data) {
    var types = room.type === 'showerRoom' ? ['shower','toilet','washbasin'] : ['toilet','washbasin'];
    var layouts = [{items:[],score:0}];
    types.forEach(function(type) {
      var next = [];
      layouts.forEach(function(layout) {
        wallCandidates(room,data,type,1,1,layout.items,{allowWindow:true}).forEach(function(candidate) {
          next.push({items:layout.items.concat(candidate.item),score:layout.score+candidate.score});
        });
      });
      if(next.length) layouts = next.sort(function(a,b){return a.score-b.score;}).slice(0,80);
    });
    if(layouts.length) data.furniture = pickAccessibleLayout(room,data,layouts,80).items;
  }
  function bedroom(room, data) {
    if(room.type==='bedroomSingle')return singleBedroom(room,data);
    var beds = wallCandidates(room, data, 'bed', 3, 3.5, [], { awayDoor: true });
    var layouts = beds.slice(0, 48).map(function (candidate) {
      var items = [candidate.item], score = candidate.score;
      var desk = best(room, data, 'desk', 1.8, 0.9, items, { nearWindow: true, allowWindow: true });
      if (desk) { items.push(desk.item); score += desk.score * 0.25; } else score += 20;
      var wardrobe = best(room, data, 'wardrobe', 1.6, 0.9, items);
      if (wardrobe) items.push(wardrobe.item); else score += 8;
      return { items: items, score: score };
    }).sort(function (a, b) { return a.score - b.score; });
    var selected = pickAccessibleLayout(room, data, layouts, 16);
    if (selected) data.furniture = selected.items;
    else data.notes.push('现有门窗与通路没有留下完整床头墙，暂不强行放床。');
    if (!data.furniture.some(function (item) { return item.type === 'desk'; })) data.notes.push('书桌暂未找到不挡通路的位置。');
    if (!data.furniture.some(function (item) { return item.type === 'wardrobe'; })) data.notes.push('衣柜需靠可用实墙布置，暂未找到同时避开外墙采光、门口及使用通路的位置。');
  }
  function singleBedroom(room,data){
    data.requestedItems=[Object.assign({type:'bed'},physicalSpec('singleBed')),Object.assign({type:'desk'},physicalSpec('singleDesk')),Object.assign({type:'wardrobe'},physicalSpec('singleWardrobe')),Object.assign({type:'chair'},physicalSpec('compactChair'))];
    var layouts=[];
    wallCandidates(room,data,'bed',2,3.5,[],{awayDoor:true}).slice(0,48).forEach(function(b){
      var wardrobes=wallCandidates(room,data,'singleWardrobe',1,1,[b.item]).slice(0,12);
      wardrobes.concat([null]).forEach(function(cab){
        var initial=cab?[b.item,cab.item]:[b.item];
        var desks=wallCandidates(room,data,'singleDesk',1,1,initial,{nearWindow:true,allowWindow:true}).slice(0,16);
        desks.concat([null]).forEach(function(work){
          var items=initial.slice(),score=b.score+(cab?0:50)+(work?0:100);
          if(work){
            var desk=Object.assign({},work.item,{groupId:room.id+'-single-desk'});items.push(desk);score+=work.score*.1;
            var spec=physicalSpec('compactChair'),vertical=['east','west'].includes(desk.side),gap=.1/WORKING_CELL_METERS;
            var w=spec.widthM/WORKING_CELL_METERS,h=spec.depthM/WORKING_CELL_METERS;
            var chair=decorate({type:'chair',side:OPPOSITE[desk.side],rotation:(desk.rotation+180)%360,groupId:desk.groupId,paired:true,w:w,h:h,
              x:vertical?(desk.side==='west'?desk.x+desk.w+gap:desk.x-w-gap):desk.x+desk.w/2-w/2,
              y:vertical?desk.y+desk.h/2-h/2:(desk.side==='north'?desk.y+desk.h+gap:desk.y-h-gap)},spec);
            chair.label='书桌椅';if(isAvailable(room,data,chair,items))items.push(chair);else score+=50;
          }
          layouts.push({items:items,score:score});
        });
      });
    });
    layouts.sort(function(a,b){return a.score-b.score;});
    var chosen=pickAccessibleLayout(room,data,layouts,32);if(chosen)data.furniture=chosen.items;
    data.notes.push('单人小睡房 3×3 m；床含床架 1×2.1 m，小书桌 1×0.5 m，衣柜 0.8×0.6 m。桌前预留0.9 m，柜前0.8 m；床可一侧靠墙，另一侧及床尾0.6 m。按椅子就位检查通路；门窗位置不合适时提示未放下的家具。');
  }
  function coffeeForSofa(sofa) {
    var table = decorate({ type: 'table', rotation: sofa.rotation, side: sofa.side, x: 0, y: 0, w: 1 / WORKING_CELL_METERS, h: .6 / WORKING_CELL_METERS }, physicalSpec('table'));
    if (sofa.side === 'north') { table.x = sofa.x + (sofa.w - table.w) / 2; table.y = sofa.y + sofa.h + .45 / WORKING_CELL_METERS; }
    if (sofa.side === 'south') { table.x = sofa.x + (sofa.w - table.w) / 2; table.y = sofa.y - table.h - .45 / WORKING_CELL_METERS; }
    if (sofa.side === 'east' || sofa.side === 'west') {
      table.w = .6 / WORKING_CELL_METERS; table.h = 1 / WORKING_CELL_METERS; table.y = sofa.y + (sofa.h - table.h) / 2;
      table.x = sofa.side === 'east' ? sofa.x - table.w - .45 / WORKING_CELL_METERS : sofa.x + sofa.w + .45 / WORKING_CELL_METERS;
    }
    return table;
  }
  function floatingLivingLayouts(room, data, initial) {
    var perSide = Object.create(null), positions = new Set(), result = [];
    var televisions = wallCandidates(room, data, 'tv', 2.2, .42, initial).filter(function (candidate) {
      var side = candidate.item.side, key = side + ':' + round(candidate.item.x) + ':' + round(candidate.item.y);
      if (positions.has(key)) return false;
      positions.add(key); perSide[side] = (perSide[side] || 0) + 1; return perSide[side] <= 3;
    });
    televisions.forEach(function (candidate) {
      var tv = candidate.item, side = OPPOSITE[tv.side], vertical = side === 'east' || side === 'west', spec = physicalSpec('sofa', 3.4);
      [2.0, 2.1, 2.35, 2.6].forEach(function (viewM) {
        [0, -.3, .3].forEach(function (shiftM) {
          var point = center(tv), inward = viewM / WORKING_CELL_METERS, shift = shiftM / WORKING_CELL_METERS;
          if (tv.side === 'north') { point.y += inward; point.x += shift; }
          if (tv.side === 'south') { point.y -= inward; point.x += shift; }
          if (tv.side === 'west') { point.x += inward; point.y += shift; }
          if (tv.side === 'east') { point.x -= inward; point.y += shift; }
          var w = (vertical ? spec.depthM : spec.widthM) / WORKING_CELL_METERS, h = (vertical ? spec.widthM : spec.depthM) / WORKING_CELL_METERS;
          var sofa = decorate({ type: 'sofa', side: side, rotation: SIDES.indexOf(side) * 90, placement: 'floating', x: point.x - w / 2, y: point.y - h / 2, w: w, h: h }, spec);
          sofa.backM = .9;
          var items = initial.concat([tv]);
          if (!isAvailable(room, data, sofa, items)) return;
          items.push(sofa);
          [0, -.3, .3].forEach(function (coffeeShiftM) {
            var coffee = coffeeForSofa(sofa);
            if (vertical) coffee.y += coffeeShiftM / WORKING_CELL_METERS;
            else coffee.x += coffeeShiftM / WORKING_CELL_METERS;
            if (!isAvailable(room, data, coffee, items)) return;
            var kitchenSide = initial.length ? initial[0].side : null;
            var separation = kitchenSide ? tv.side === OPPOSITE[kitchenSide] ? -2 : tv.side === kitchenSide ? 3 : 0 : 0;
            result.push({ items: items.concat([coffee]), score: separation + Math.abs(viewM - 2.1) * 2 + Math.abs(shiftM) * .2 + Math.abs(coffeeShiftM) * .1 + candidate.score * .1 });
          });
        });
      });
    });
    return result;
  }
  function livingLayouts(room, data, initial, limit) {
    initial = initial || [];
    var sofas = wallCandidates(room, data, 'sofa', room.type === 'livingLarge' ? 3.4 : 3, 1.4, initial, { awayDoor: true });
    return sofas.slice(0, limit || 48).map(function (candidate) {
      var sofa = candidate.item, items = initial.concat([sofa]), score = candidate.score;
      var tv = facingTV(room, data, sofa, items);
      if (tv) {
        var a = center(sofa), b = center(tv.item);
        score += (sofa.side === 'east' || sofa.side === 'west' ? Math.abs(a.y - b.y) : Math.abs(a.x - b.x)) * 0.3;
        items.push(tv.item);
      } else score += 14;
      var table = coffeeForSofa(sofa);
      if (isAvailable(room, data, table, items)) items.push(table); else score += 3;
      return { items: items, score: score };
    });
  }
  function compactLivingLayouts(room, data) {
    var seats = room.type === 'livingMedium' ? 2 : 1, layouts = [];
    var small = room.type === 'livingSmall', deskType=small?'compactDesk':'desk';
    var deskSpec = Object.assign({}, physicalSpec(deskType), {label:small?'折叠餐写桌':'餐写两用桌'});
    data.requestedItems = [Object.assign({type:'sofa'},physicalSpec('sofa',small?2.5:3)),
      Object.assign({type:'desk'},deskSpec)].concat(Array.from({length:seats},function(){return Object.assign({type:'chair'},physicalSpec(small?'compactChair':'diningChair'));}));
    wallCandidates(room,data,'sofa',small?2.5:3,1.4,[],{awayDoor:true}).slice(0,48).forEach(function(candidate){
      var sofa=candidate.item, desks=wallCandidates(room,data,deskType,2,1,[sofa],{allowWindow:true,nearWindow:true});
      // A folding table can stand beside the edge route; it need not occupy a
      // fourth wall when a compact lounge also opens directly into a garden.
      if(small&&data.doors.length>=4&&data.doors.some(d=>d.kind==='outdoor'))SIDES.forEach(function(side){
        var vertical=['east','west'].includes(side),w=(vertical?deskSpec.depthM:deskSpec.widthM)/WORKING_CELL_METERS,h=(vertical?deskSpec.widthM:deskSpec.depthM)/WORKING_CELL_METERS;
        [MARGIN,1.5,1.7,room.w-1.5-w,room.w-MARGIN-w].forEach(x=>[MARGIN,1.5,1.7,room.h-1.5-h,room.h-MARGIN-h].forEach(y=>{
          var item=decorate({type:'desk',side,rotation:SIDES.indexOf(side)*90,placement:'floating',x,y,w,h},deskSpec);
          var wallGap=side==='north'?y:side==='south'?room.h-y-h:side==='west'?x:room.w-x-w;
          if(wallGap<.01)delete item.placement;
          if(isAvailable(room,data,item,[sofa]))desks.push({item,score:5});
        }));
      });
      var added=false;
      desks.slice(0,48).forEach(function(work){
        var desk=Object.assign({},work.item,{type:'desk',label:deskSpec.label,groupId:room.id+'-flex-table'}), items=[sofa,desk];
        if(small)desk.foldable=true;
        var spec=physicalSpec(small?'compactChair':'diningChair'), vertical=['east','west'].includes(desk.side), gap=.1/WORKING_CELL_METERS;
        for(var index=0;index<seats;index++){
          var w=(vertical?spec.depthM:spec.widthM)/WORKING_CELL_METERS, h=(vertical?spec.widthM:spec.depthM)/WORKING_CELL_METERS;
          var along=seats===1?.5:(index===0?.25:.75);
          var chair=decorate({type:'chair',side:OPPOSITE[desk.side],rotation:(desk.rotation+180)%360,groupId:desk.groupId,paired:true,w:w,h:h,
            x:vertical?(desk.side==='west'?desk.x+desk.w+gap:desk.x-w-gap):desk.x+desk.w*along-w/2,
            y:vertical?desk.y+desk.h*along-h/2:(desk.side==='north'?desk.y+desk.h+gap:desk.y-h-gap)},spec);
          if(!isAvailable(room,data,chair,items))return;
          if(small){chair.foldable=true;chair.label='折叠餐椅';}
          items.push(chair);
        }
        // Keep a real dining/work seat before spending free floor area on a TV or coffee table.
        var tv=facingTV(room,data,sofa,items);
        if(tv)items.push(tv.item);
        // A larger item count must not make an optional coffee table outrank a usable route.
        layouts.push({items:items,score:candidate.score+work.score*.2});added=true;
      });
      if(!added){var tv=facingTV(room,data,sofa,[sofa]);layouts.push({items:tv?[sofa,tv.item]:[sofa],score:candidate.score+100});}
    });
    data.notes.push(small ? '餐写桌展开 1 × 0.5 m，桌前 0.9 m 留给就座与拉椅；另留连续 0.9 m 沿边通路，不借用桌前空位。桌椅可收起靠边存放；独立摆放的餐写桌展开时同样保留使用净空。' : '餐写两用桌兼顾用餐与笔记本办公，两种用途错时使用；桌前保留 0.9 m 座椅与拉出空间，另检查门口到座位的通路。');
    return layouts;
  }
  function living(room, data) {
    var layouts, selected;
    if (room.type === 'livingLarge') {
      var perSide = Object.create(null);
      var runs = kitchenRuns(room, data).filter(function (run) {
        var side = run.items[0].side, horizontal = side === 'north' || side === 'south';
        var start = Math.min.apply(null, run.items.map(function (item) { return horizontal ? item.x : item.y; }));
        var key = side + ':' + (start <= (length(room, side) - 2.6 / WORKING_CELL_METERS) / 2 + EPS ? 'near' : 'far');
        perSide[key] = (perSide[key] || 0) + 1;
        return perSide[key] <= 2;
      }).slice(0, 16);
      var compact = familyLivingLayouts(room, data, withKitchenIsland(room, data, runs.flatMap(function (run) {
        return floatingLivingLayouts(room, data, run.items).map(function (layout) { layout.score += run.score * .05; return layout; });
      })));
      var compactChoice = pickAccessibleLayout(room, data, compact, 96);
      if (compactChoice && compactChoice.items.length === 13 && !compactChoice.routeUnresolved && !blockedAccess(compactChoice.accessibility)) selected = compactChoice;
      if (!selected) {
      layouts = runs.flatMap(function (run) {
        return livingLayouts(room, data, run.items, 24).map(function (layout) {
          layout.score += run.score * .15;
          return layout;
        });
      });
      data.kitchenIntegrated = true;
      if (!layouts.length) {
        layouts = livingLayouts(room, data);
        data.notes.push('大客厅里的连续厨房暂未找到可用位置：需要 2.6 m 台面及前方 1.2 m 操作空间，请调整门口或模块连接。');
      }
      layouts = familyLivingLayouts(room, data, withKitchenIsland(room, data, layouts));
      }
      data.kitchenIntegrated = true;
    } else layouts = compactLivingLayouts(room, data);
    if (!selected) selected = pickAccessibleLayout(room, data, layouts, 48);
    if (selected) data.furniture = selected.items;
    else data.notes.push('现有家具与通路没有留下足够使用空间，沙发位置待调整。');
    if (!data.furniture.some(function (item) { return item.type === 'tv'; })) data.notes.push('电视墙暂未找到与沙发相对且无门窗的位置。');
    if (!data.furniture.some(function (item) { return item.type === 'table'; })) data.notes.push('先留出主入口与座位通路，茶几暂不放置。');
  }
  function withKitchenIsland(room, data, layouts) {
    return layouts.flatMap(function (layout) {
      var run = layout.items.filter(function (item) { return ['sink', 'counter', 'stove'].indexOf(item.type) >= 0; });
      if (!run.length) return [layout];
      var side = run[0].side, vertical = side === 'east' || side === 'west', spec = physicalSpec('kitchenIsland');
      var low = Math.min.apply(null, run.map(function (item) { return vertical ? item.y : item.x; }));
      var result = [];
      [.4, .7, 1.0].forEach(function (offsetM) {
        var w = (vertical ? spec.depthM : spec.widthM) / WORKING_CELL_METERS, h = (vertical ? spec.widthM : spec.depthM) / WORKING_CELL_METERS;
        var edge = (.6 + 1.2) / WORKING_CELL_METERS + MARGIN;
        var item = decorate({ type: 'kitchenIsland', side: OPPOSITE[side], placement: 'floating', rotation: SIDES.indexOf(OPPOSITE[side]) * 90,
          x: vertical ? side === 'west' ? edge : room.w - edge - w : low + offsetM / WORKING_CELL_METERS,
          y: vertical ? low + offsetM / WORKING_CELL_METERS : side === 'north' ? edge : room.h - edge - h, w: w, h: h }, spec);
        if (isAvailable(room, data, item, layout.items)) result.push({ items: layout.items.concat([item]), score: layout.score + Math.abs(offsetM - .7) });
      });
      // Keep the original candidate available: a missing island must be reported,
      // never achieved by dropping chairs or reducing furniture dimensions.
      return result.length ? result : [layout];
    });
  }
  function familyDiningGroup(room, side, x, y) {
    var tableSpec = physicalSpec('familyDiningTable'), chairSpec = physicalSpec('diningChair');
    var vertical = side === 'east' || side === 'west', id = room.id + '-family-dining';
    var table = decorate({ type: 'diningTable', side: side, rotation: SIDES.indexOf(side) * 90, groupId: id,
      x: x, y: y, w: (vertical ? tableSpec.depthM : tableSpec.widthM) / WORKING_CELL_METERS,
      h: (vertical ? tableSpec.widthM : tableSpec.depthM) / WORKING_CELL_METERS }, tableSpec);
    var chairs = [];
    // Two seats on each long side: four real bodies, each with its own approach.
    [false, true].forEach(function (far) {
      [.25, .75].forEach(function (fraction) {
        var chairSide = vertical ? far ? 'east' : 'west' : far ? 'south' : 'north';
        var w = (vertical ? chairSpec.depthM : chairSpec.widthM) / WORKING_CELL_METERS;
        var h = (vertical ? chairSpec.widthM : chairSpec.depthM) / WORKING_CELL_METERS;
        var gap = .08 / WORKING_CELL_METERS;
        var chair = decorate({ type: 'chair', side: chairSide, rotation: SIDES.indexOf(chairSide) * 90, groupId: id,
          x: vertical ? far ? x + table.w + gap : x - w - gap : x + table.w * fraction - w / 2,
          y: vertical ? y + table.h * fraction - h / 2 : far ? y + table.h + gap : y - h - gap, w: w, h: h, paired: true }, chairSpec);
        chair.frontM = 0; chair.label = '餐椅 ' + (chairs.length + 1); chairs.push(chair);
      });
    });
    return [table].concat(chairs);
  }
  function familyDiningCandidates(room, data, placed) {
    var result = [], sink = placed.find(function (item) { return item.type === 'sink'; });
    var sofa = placed.find(function (item) { return item.type === 'sofa'; }), tv = placed.find(function (item) { return item.type === 'tv'; });
    ['north', 'west'].forEach(function (side) {
      var spec = physicalSpec('familyDiningTable'), vertical = side === 'west';
      var w = (vertical ? spec.depthM : spec.widthM) / WORKING_CELL_METERS, h = (vertical ? spec.widthM : spec.depthM) / WORKING_CELL_METERS;
      var margin = .8 / WORKING_CELL_METERS;
      for (var y = margin; y <= room.h - h - margin + EPS; y += .5) {
        for (var x = margin; x <= room.w - w - margin + EPS; x += .5) {
          var group = familyDiningGroup(room, side, round(x), round(y)), temporary = placed.slice(), valid = true;
          for (var index = 0; index < group.length; index++) {
            if (!isAvailable(room, data, group[index], temporary)) { valid = false; break; }
            temporary.push(group[index]);
          }
          if (!valid) continue;
          var score = (sink ? distance(center(group[0]), center(sink)) : 0) * (sofa && sofa.placement === 'floating' ? 1.1 : .35) + distance(center(group[0]), { x: room.w / 2, y: room.h / 2 }) * .05;
          if (sofa && tv && group.some(function (item) { return segmentCrossesRect(center(sofa), center(tv), item); })) score += 25;
          result.push({ items: group, score: score });
        }
      }
    });
    return result.sort(function (a, b) { return a.score - b.score; });
  }
  function floatingArmchairs(room, data, placed, sofa) {
    if (!sofa || sofa.placement !== 'floating') return [];
    var spec = physicalSpec('armchair'), verticalSofa = sofa.side === 'east' || sofa.side === 'west', result = [];
    [-1, 1].forEach(function (sign) {
      // Complete a conversation group at a front corner of the sofa. These
      // chairs face the sofa, while the alternative below faces across it.
      [.1, .22].forEach(function (gapM) {
        var facing = OPPOSITE[sofa.side], upright = facing === 'east' || facing === 'west';
        var cw = (upright ? spec.depthM : spec.widthM) / WORKING_CELL_METERS, ch = (upright ? spec.widthM : spec.depthM) / WORKING_CELL_METERS;
        var p = center(sofa), lateral = (verticalSofa ? sofa.h + ch : sofa.w + cw) / 2 + gapM / WORKING_CELL_METERS;
        if (verticalSofa) p.y += sign * lateral; else p.x += sign * lateral;
        p.x = Math.max(cw / 2 + .9 / WORKING_CELL_METERS, Math.min(room.w - cw / 2 - .9 / WORKING_CELL_METERS, p.x));
        p.y = Math.max(ch / 2 + .9 / WORKING_CELL_METERS, Math.min(room.h - ch / 2 - .9 / WORKING_CELL_METERS, p.y));
        if (sofa.side === 'south') p.y = sofa.y - ch / 2 - .05 / WORKING_CELL_METERS;
        if (sofa.side === 'north') p.y = sofa.y + sofa.h + ch / 2 + .05 / WORKING_CELL_METERS;
        if (sofa.side === 'east') p.x = sofa.x - cw / 2 - .05 / WORKING_CELL_METERS;
        if (sofa.side === 'west') p.x = sofa.x + sofa.w + cw / 2 + .05 / WORKING_CELL_METERS;
        var corner = decorate({ type: 'armchair', side: facing, rotation: SIDES.indexOf(facing) * 90, placement: 'floating', x: p.x - cw / 2, y: p.y - ch / 2, w: cw, h: ch }, spec);
        corner.backM = .9;
        if (isAvailable(room, data, corner, placed)) result.push({ item: corner, score: -.8 + gapM });
      });
      var side = verticalSofa ? sign < 0 ? 'north' : 'south' : sign < 0 ? 'west' : 'east';
      var vertical = side === 'east' || side === 'west', w = (vertical ? spec.depthM : spec.widthM) / WORKING_CELL_METERS, h = (vertical ? spec.widthM : spec.depthM) / WORKING_CELL_METERS;
      var point = center(sofa), long = verticalSofa ? sofa.h : sofa.w;
      var offset = long / 2 + (verticalSofa ? h : w) / 2 + .12 / WORKING_CELL_METERS;
      if (verticalSofa) point.y += sign * offset; else point.x += sign * offset;
      point.x = Math.max(w / 2 + .9 / WORKING_CELL_METERS, Math.min(room.w - w / 2 - .9 / WORKING_CELL_METERS, point.x));
      point.y = Math.max(h / 2 + .9 / WORKING_CELL_METERS, Math.min(room.h - h / 2 - .9 / WORKING_CELL_METERS, point.y));
      [.1, -.2, .35].forEach(function (gapM) {
        var front = sofa.side === 'north' ? sofa.y + sofa.h + h / 2 + gapM / WORKING_CELL_METERS :
          sofa.side === 'south' ? sofa.y - h / 2 - gapM / WORKING_CELL_METERS :
          sofa.side === 'west' ? sofa.x + sofa.w + w / 2 + gapM / WORKING_CELL_METERS : sofa.x - w / 2 - gapM / WORKING_CELL_METERS;
        var item = decorate({ type: 'armchair', side: side, rotation: SIDES.indexOf(side) * 90, placement: 'floating',
          x: (verticalSofa ? front : point.x) - w / 2, y: (verticalSofa ? point.y : front) - h / 2, w: w, h: h }, spec);
        item.backM = .9;
        if (isAvailable(room, data, item, placed)) result.push({ item: item, score: -.5 + Math.abs(gapM - .1) });
      });
    });
    return result;
  }
  function familyLivingLayouts(room, data, base) {
    var result = [];
    base.sort(function (a, b) { return b.items.length - a.items.length || a.score - b.score; });
    // Keep varied wall combinations rather than exhausting one kitchen/sofa pair.
    var combinations = Object.create(null), compact = base.some(function (layout) { return layout.items.some(function (item) { return item.placement === 'floating'; }); });
    base.forEach(function (layout) {
      var sofa = layout.items.find(function (item) { return item.type === 'sofa'; });
      var sink = layout.items.find(function (item) { return item.type === 'sink'; });
      var key = (sink ? sink.side + ':' + round(sink.x) + ':' + round(sink.y) : 'none') + ':' + (sofa ? sofa.side : 'none');
      var maximum = sofa && sofa.placement === 'floating' ? 12 : 2;
      var group = combinations[key] || (combinations[key] = []);
      if (group.length >= maximum) return;
      if (sofa && sofa.placement === 'floating' && blockedAccess(checkAccess(room, data, layout.items))) return;
      group.push(layout);
    });
    var candidates = [];
    // Round-robin wall combinations: one room rotation must not exhaust the
    // finite search budget before the corresponding kitchen/TV wall is tried.
    var groups = Object.keys(combinations).map(function (key) { return combinations[key]; }).filter(function (group) { return group.length; });
    if (compact) {
      for (var rank = 0; rank < 12 && candidates.length < 96; rank++) {
        groups.forEach(function (group) { if (group[rank] && candidates.length < 96) candidates.push(group[rank]); });
      }
    } else candidates = groups.flat().sort(function (a, b) { return b.items.length - a.items.length || a.score - b.score; }).slice(0, 8);
    candidates.forEach(function (layout) {
      var sofa = layout.items.find(function (item) { return item.type === 'sofa'; });
      var diningRegions = Object.create(null);
      var dining = familyDiningCandidates(room, data, layout.items).filter(function (group) {
        var table = group.items[0], point = center(table);
        var key = table.side + ':' + (point.x < room.w / 2 ? 'left' : 'right') + ':' + (point.y < room.h / 2 ? 'top' : 'bottom');
        diningRegions[key] = (diningRegions[key] || 0) + 1;
        return diningRegions[key] <= 2;
      }).slice(0, 12);
      dining.forEach(function (group) {
        var items = layout.items.concat(group.items);
        var chairs = floatingArmchairs(room, data, items, sofa).concat(wallCandidates(room, data, 'armchair', 1.4, 1.4, items, { allowWindow: true }));
        chairs.forEach(function (chair) { chair.score += sofa ? distance(center(chair.item), center(sofa)) * .5 : 0; });
        chairs.sort(function (a, b) { return a.score - b.score; });
        chairs.slice(0, 2).forEach(function (chair) { result.push({ items: items.concat([chair.item]), score: layout.score + group.score + chair.score }); });
        if (!chairs.length) result.push({ items: items, score: layout.score + group.score + 30 });
      });
      if (!dining.length) {
        var chair = best(room, data, 'armchair', 1.4, 1.4, layout.items, { allowWindow: true });
        result.push({ items: chair ? layout.items.concat([chair.item]) : layout.items, score: layout.score + 50 });
      }
    });
    return result;
  }
  function kitchenRuns(room, data) {
    var runs = [];
    SIDES.forEach(function (side) {
      [['sink', 'counter', 'stove'], ['stove', 'counter', 'sink']].forEach(function (order) {
        var runLength = order.reduce(function (sum, type) { return sum + physicalSpec(type).widthM / WORKING_CELL_METERS; }, 0);
        var maximum = length(room, side) - runLength;
        if (maximum < -EPS) return;
        [0, maximum / 2, maximum].forEach(function (start) {
          var items = [], position = start;
          for (var index = 0; index < order.length; index++) {
            var type = order[index], item = furnitureAt(room, type, side, position);
            if (!isAvailable(room, data, item, items)) return;
            if (type === 'stove' && data.windows.some(function (window) { return window.side === side && intervalsOverlap({ start: position, width: physicalSpec(type).widthM / WORKING_CELL_METERS }, window, .15); })) return;
            items.push(item); position += physicalSpec(type).widthM / WORKING_CELL_METERS;
          }
          var sink = items.find(function (item) { return item.type === 'sink'; });
          var daylight = data.windows.length ? Math.min.apply(null, data.windows.map(function (window) { return distance(center(sink), wallPoint(room, window)); })) : 0;
          runs.push({ items: items, score: daylight + start * .01 });
        });
      });
    });
    return runs.sort(function (a, b) { return a.score - b.score; });
  }
  function kitchen(room, data) {
    var runs = kitchenRuns(room, data);
    if (runs.length) { data.furniture = pickAccessibleLayout(room, data, runs, 8).items; return; }
    var sinks = wallCandidates(room, data, 'sink', 1.25, 0.95, [], { nearWindow: true, allowWindow: true });
    var layouts = sinks.slice(0, 40).map(function (candidate) {
      var items = [candidate.item], score = candidate.score;
      var stove = best(room, data, 'stove', 1.25, 0.95, items);
      if (stove) items.push(stove.item); else score += 30;
      var counter = best(room, data, 'counter', 1.4, 0.95, items, { allowWindow: true });
      if (counter) items.push(counter.item); else score += 5;
      return { items: items, score: score };
    }).sort(function (a, b) { return a.score - b.score; });
    if (layouts.length) data.furniture = pickAccessibleLayout(room, data, layouts, 12).items;
    if (data.furniture.length > 1) data.notes.push('门窗位置限制了连续工作台，水槽、备餐台与灶台暂分开布置；可移动厨房模块再尝试一字排布。');
    if (!data.furniture.some(function (item) { return item.type === 'stove'; })) data.notes.push('无足够实墙放置灶台，厨房布局需要调整。');
  }
  function outdoor(room, data) {
    var layouts=[{items:[],score:0}];
    (room.type==='balcony' ? [['plant',0.85,0.85],['outdoorchair',1.05,1.05]] : [['plant', 0.85, 0.85], ['outdoorchair', 1.05, 1.05], ['plant', 0.85, 0.85], ['outdoorchair', 1.05, 1.05]]).forEach(function (spec) {
      var next=[];
      layouts.forEach(function(layout){
        var choices=wallCandidates(room,data,spec[0],spec[1],spec[2],layout.items,{allowWindow:true});
        if(!choices.length)next.push(layout);
        choices.slice(0,12).forEach(function(c){next.push({items:layout.items.concat(c.item),score:layout.score+c.score});});
      });
      layouts=next.sort(function(a,b){return b.items.length-a.items.length||a.score-b.score;}).slice(0,32);
    });
    var chosen=pickAccessibleLayout(room,data,layouts,32);
    if(chosen)data.furniture=chosen.items;
  }
  // Library coordinates are dimensionless, authored against the unrotated
  // footprint. Convert them once and rotate the furniture with that footprint;
  // never scale a saved sketch or shrink its furniture to make a placement fit.
  function customItems(room) {
    var plan = room.functionPlan;
    if (!plan || !Array.isArray(plan.furniture)) return [];
    var width = plan.widthUnits * 3 / WORKING_CELL_METERS;
    var height = plan.heightUnits * 3 / WORKING_CELL_METERS;
    var rotation = ((room.rotation || 0) % 360 + 360) % 360;
    var requests = plan.furniture.concat((plan.unplaced || []).map(function (entry) { return entry.item; }).filter(Boolean));
    return requests.slice(0, 20).map(function (source, index) {
      if (!source) return null;
      var spec = R.resolve(Object.assign({}, source, !source.profile && source.kind === 'desk' && /游戏|电竞|开黑/.test(plan.title) ? { profile: 'gamingDesk' } : {}));
      var footprint = R.footprint(spec);
      var item = decorate({ type: source.kind || source.type || 'generic', sourceIndex: index,
        sizeWarnings: (Array.isArray(source.sizeWarnings) ? source.sizeWarnings : []).concat(spec.adjustments || []),
        groupId: source.groupId || null, x: (Number.isFinite(source.x) ? source.x : 0) * width,
        y: (Number.isFinite(source.y) ? source.y : 0) * height, w: footprint.w / WORKING_CELL_METERS, h: footprint.h / WORKING_CELL_METERS,
        rotation: (SIDES.indexOf(spec.side) * 90 + rotation) % 360,
        side: SIDES[(SIDES.indexOf(spec.side) + Math.floor(rotation / 90)) % 4] || 'north', custom: true }, spec);
      var x = item.x, y = item.y, w = item.w, h = item.h;
      if (rotation === 90) Object.assign(item, { x: height - y - h, y: x, w: h, h: w });
      else if (rotation === 180) Object.assign(item, { x: width - x - w, y: height - y - h });
      else if (rotation === 270) Object.assign(item, { x: y, y: width - x - w, w: h, h: w });
      return item;
    }).filter(Boolean);
  }
  function customBlocksWindow(room, data, item) {
    return data.windows.some(function (window) {
      var side = window.side, horizontal = side === 'north' || side === 'south';
      var distanceToWall = side === 'north' ? item.y : side === 'south' ? room.h - item.y - item.h :
        side === 'west' ? item.x : room.w - item.x - item.w;
      return solidWallItem(item, side) && distanceToWall < 0.3 && intervalsOverlap({ start: horizontal ? item.x : item.y, width: horizontal ? item.w : item.h }, window, 0.2);
    });
  }
  function customCirculation(room, data, preferred, strict) {
    if (!data.doors.length) return;
    if(room.type==='livingSmall' && data.edgeCirculation){
      data.routeUnresolved=data.edgeCirculation.some(function(route){return preferred.some(function(item){return overlap(route,item) || item.profile==='desk' && itemUseZones(item).some(zone=>overlap(route,zone));});});
      return;
    }
    var span = 1.5, half = span / 2;
    var clampPoint = function (point) { return { x: Math.max(half, Math.min(room.w - half, point.x)), y: Math.max(half, Math.min(room.h - half, point.y)) }; };
    var endpoints = data.doors.map(function (door) {
      var point = wallPoint(room, door);
      if (door.side === 'north') point.y = half;
      if (door.side === 'south') point.y = room.h - half;
      if (door.side === 'east') point.x = room.w - half;
      if (door.side === 'west') point.x = half;
      return clampPoint(point);
    });
    var hubs = endpoints.concat([{ x: room.w / 2, y: room.h / 2 }]);
    [.25, .5, .75].forEach(function (x) { [.25, .5, .75].forEach(function (y) { hubs.push(clampPoint({ x: room.w * x, y: room.h * y })); }); });
    function segment(a, b) {
      return { x: Math.min(a.x, b.x) - half, y: Math.min(a.y, b.y) - half,
        w: Math.abs(a.x - b.x) + span, h: Math.abs(a.y - b.y) + span };
    }
    function cost(rects) {
      return rects.reduce(function (sum, rect) {
        return sum + rect.w * rect.h * .02 + preferred.reduce(function (total, item) {
          return total + Math.max(0, Math.min(rect.x + rect.w, item.x + item.w) - Math.max(rect.x, item.x)) *
            Math.max(0, Math.min(rect.y + rect.h, item.y + item.h) - Math.max(rect.y, item.y)) * 40;
        }, 0);
      }, 0);
    }
    var choices = hubs.map(function (hub) {
      var rects = endpoints.flatMap(function (point) {
        var elbows = [{ x: point.x, y: hub.y }, { x: hub.x, y: point.y }];
        return elbows.map(function (elbow) { return [segment(point, elbow), segment(elbow, hub)]; }).sort(function (a, b) { return cost(a) - cost(b); })[0];
      });
      return { rects: rects, score: cost(rects) + distance(hub, { x: room.w / 2, y: room.h / 2 }) * .01 };
    }).sort(function (a, b) { return a.score - b.score; });
    var selected = choices.find(function (choice) { return !strict || !choice.rects.some(function (rect) { return preferred.some(function (item) { return overlap(rect, item); }); }); });
    if (!selected && strict && A && typeof A.connectDoors === 'function') {
      var connected = A.connectDoors(room, Object.assign({}, data, { furniture: preferred }), WORKING_CELL_METERS);
      if (connected.status === 'fit') {
        selected = { rects: connected.paths.flatMap(function (path) {
          if (path.length === 1) return [segment(path[0], path[0])];
          return path.slice(1).map(function (point, index) { return segment(path[index], point); });
        }) };
      }
    }
    if (!selected) { data.routeUnresolved = true; return; }
    var keep = strict ? data.circulation : [];
    if (selected) data.circulation = keep.concat(selected.rects).filter(function (rect, index, all) {
      return !all.slice(0, index).some(function (other) { return ['x', 'y', 'w', 'h'].every(function (key) { return Math.abs(rect[key] - other[key]) < EPS; }); });
    });
  }
  function custom(room, data) {
    var items = customItems(room), desks = items.filter(function (item) { return ['desk', 'gamingDesk', 'diningTable', 'familyDiningTable'].indexOf(item.profile) >= 0; });
    var chairs = items.filter(function (item) { return ['chair', 'diningChair'].indexOf(item.profile) >= 0; }), used = new Set(), groups = [];
    desks.forEach(function (desk) {
      var paired = chairs.filter(function (item) { return !used.has(item.sourceIndex) && (!desk.groupId || !item.groupId || desk.groupId === item.groupId); })
        .sort(function (a, b) { return distance(center(desk), center(a)) - distance(center(desk), center(b)); }).slice(0, ['diningTable', 'familyDiningTable'].indexOf(desk.profile) >= 0 ? 4 : 1);
      var id = desk.groupId || room.id + '-workstation-' + desk.sourceIndex;
      desk.groupId = id; used.add(desk.sourceIndex);
      paired.forEach(function (chair) { chair.groupId = id; used.add(chair.sourceIndex); });
      groups.push({ primary: desk, chairs: paired });
    });
    items.filter(function (item) { return !used.has(item.sourceIndex); }).forEach(function (item) { groups.push({ primary: item }); });
    customCirculation(room, data, items);
    function placeAt(source, side, start) {
      var vertical = side === 'east' || side === 'west', w = (vertical ? source.depthM : source.widthM) / WORKING_CELL_METERS;
      var h = (vertical ? source.widthM : source.depthM) / WORKING_CELL_METERS;
      var back = source.backM / WORKING_CELL_METERS;
      return Object.assign({}, source, { side: side, rotation: SIDES.indexOf(side) * 90,
        x: side === 'east' ? room.w - w - back : vertical ? back : start,
        y: side === 'south' ? room.h - h - back : vertical ? start : back, w: w, h: h });
    }
    function chairFor(source, desk) {
      var gap = .1 / WORKING_CELL_METERS, chair = Object.assign({}, source, { paired: true, frontM: 0, rotation: (desk.rotation + 180) % 360, side: OPPOSITE[desk.side],
        w: source.widthM / WORKING_CELL_METERS, h: source.depthM / WORKING_CELL_METERS });
      if (desk.side === 'north' || desk.side === 'south') {
        chair.x = desk.x + (desk.w - chair.w) / 2;
        chair.y = desk.side === 'north' ? desk.y + desk.h + gap : desk.y - chair.h - gap;
      } else {
        chair.w = source.depthM / WORKING_CELL_METERS; chair.h = source.widthM / WORKING_CELL_METERS;
        chair.y = desk.y + (desk.h - chair.h) / 2;
        chair.x = desk.side === 'west' ? desk.x + desk.w + gap : desk.x - chair.w - gap;
      }
      return chair;
    }
    var preferred = items[0] ? items[0].side : 'north';
    var layouts = SIDES.map(function (_, turn) {
      var commonSide = SIDES[(SIDES.indexOf(preferred) + turn) % 4], placed = [], score = turn * .05;
      groups.forEach(function (group) {
        var source = group.primary, candidate = null, bestScore = Infinity;
        var sides = [commonSide].concat(SIDES.filter(function (side) { return side !== commonSide; }));
        sides.forEach(function (side, sideIndex) {
          var vertical = side === 'east' || side === 'west', along = source.widthM / WORKING_CELL_METERS;
          var maximum = length(room, side) - along;
          if (maximum < -EPS) return;
          var positions = [0, maximum, maximum / 2, source.sideM / WORKING_CELL_METERS, maximum - source.sideM / WORKING_CELL_METERS, vertical ? source.y : source.x];
          placed.forEach(function (item) { positions.push((vertical ? item.y + item.h : item.x + item.w) + .1 / WORKING_CELL_METERS); });
          data.doors.forEach(function (door) { if (door.side === side) positions.push(door.start - along, door.start + door.width); });
          for (var start = 0; start <= maximum + EPS; start += .25) positions.push(start);
          Array.from(new Set(positions.map(round))).forEach(function (position) {
            if (position < -EPS || position > maximum + EPS) return;
            var primary = placeAt(source, side, position), groupItems = [primary];
            if (!isAvailable(room, data, primary, placed) || customBlocksWindow(room, data, primary) || storageBlocksExterior(room, data, primary)) return;
            var chairSides = [side, OPPOSITE[side], SIDES[(SIDES.indexOf(side) + 1) % 4], SIDES[(SIDES.indexOf(side) + 3) % 4]];
            for (var index = 0; index < (group.chairs || []).length; index++) {
              var chair = chairFor(group.chairs[index], Object.assign({}, primary, { side: chairSides[index], rotation: SIDES.indexOf(chairSides[index]) * 90 }));
              if (!isAvailable(room, data, chair, placed.concat(groupItems))) return;
              groupItems.push(chair);
            }
            var value = sideIndex * 10 + position * .04 + distance(center(primary), center(source)) * .005;
            value += data.windows.reduce(function (sum, window) { return sum + deskWindowScore(room, primary, window) * 4; }, 0);
            if (value < bestScore) { bestScore = value; candidate = groupItems; }
          });
        });
        if (candidate) { placed.push.apply(placed, candidate); score += bestScore; }
        else score += (1 + (group.chairs || []).length) * 10000;
      });
      return { items: placed, score: score };
    }).sort(function (a, b) { return a.score - b.score; });
    var selected = pickAccessibleLayout(room, data, layouts, 4);
    data.furniture = (selected ? selected.items : []).sort(function (a, b) { return a.sourceIndex - b.sourceIndex; });
    data.requestedItems = items;
    if (desks.some(function (desk) { return ['diningTable', 'familyDiningTable'].indexOf(desk.profile) < 0; }) && data.furniture.some(function (item) { return item.groupId; })) data.notes.push('电脑桌与座椅成组布置；桌前保留 0.9 m 座椅与拉出空间，另留进出通路。');
  }
  function livingLayoutMetrics(data) {
    var sofa = data.furniture.find(function (item) { return item.type === 'sofa'; });
    var tv = data.furniture.find(function (item) { return item.type === 'tv'; });
    var table = data.furniture.find(function (item) { return item.profile === 'familyDiningTable'; });
    var kitchen = data.furniture.filter(function (item) { return ['sink', 'counter', 'stove'].indexOf(item.type) >= 0; });
    var lounge = data.furniture.filter(function (item) { return ['sofa', 'tv', 'table', 'armchair'].indexOf(item.type) >= 0; });
    function bounds(items) {
      if (!items.length) return null;
      var x = Math.min.apply(null, items.map(function (item) { return item.x; })), y = Math.min.apply(null, items.map(function (item) { return item.y; }));
      return { x: x, y: y, w: Math.max.apply(null, items.map(function (item) { return item.x + item.w; })) - x, h: Math.max.apply(null, items.map(function (item) { return item.y + item.h; })) - y };
    }
    var cooking = bounds(kitchen), sitting = bounds(lounge);
    var edge = table && cooking ? Math.hypot(Math.max(0, cooking.x - table.x - table.w, table.x - cooking.x - cooking.w),
      Math.max(0, cooking.y - table.y - table.h, table.y - cooking.y - cooking.h)) : null;
    return { type: sofa && sofa.placement === 'floating' ? 'compact' : 'wall-based',
      sofaTvDistanceM: sofa && tv ? round(distance(center(sofa), center(tv)) * WORKING_CELL_METERS) : null,
      kitchenDiningDistanceM: table && cooking ? round(distance(center(table), center(cooking)) * WORKING_CELL_METERS) : null,
      kitchenDiningEdgeDistanceM: edge === null ? null : round(edge * WORKING_CELL_METERS),
      loungeFootprintM2: sitting ? round(sitting.w * sitting.h * WORKING_CELL_METERS * WORKING_CELL_METERS) : null,
      sofaBackClearanceM: sofa && sofa.placement === 'floating' ? sofa.backM : 0 };
  }
  function assessFurniture(room, data) {
    var requested = data.requestedItems;
    if (!requested) {
      var types = isBedroom(room) ? ['bed', 'desk', 'wardrobe'] : room.type === 'livingLarge' ? ['sofa', 'tv', 'table', 'sink', 'counter', 'stove', 'familyDiningTable', 'diningChair', 'diningChair', 'diningChair', 'diningChair', 'armchair', 'kitchenIsland'] : isLiving(room) ? ['sofa', 'tv', 'table'] :
        isBathroom(room) ? (room.type === 'showerRoom' ? ['toilet','washbasin','shower'] : ['toilet','washbasin']) : room.type === 'kitchen' ? ['sink', 'stove', 'counter'] : room.type==='balcony' ? ['plant','outdoorchair'] : isOutdoor(room) ? ['plant', 'outdoorchair', 'plant', 'outdoorchair'] : [];
      requested = types.map(function (type, index) { return Object.assign({ type: type === 'familyDiningTable' ? 'diningTable' : type === 'diningChair' ? 'chair' : type, sourceIndex: index }, physicalSpec(type, type === 'sofa' && room.type === 'livingLarge' ? 3.4 : undefined)); });
    }
    var issues = [], used = new Set();
    requested.forEach(function (item) {
      var index = data.furniture.findIndex(function (placed, i) { return !used.has(i) && (!!room.functionPlan ? placed.sourceIndex === item.sourceIndex : placed.type === item.type); });
      if (index >= 0) { used.add(index); return; }
      var message = '「' + item.label + '」按 ' + item.widthM + ' × ' + item.depthM + ' m 外轮廓' +
        (item.frontM ? '及前方 ' + item.frontM + ' m 使用空间' : '') + '暂未找到可用位置；可以减少数量、改变布置或增大模块，不能缩小家具图形来凑数。';
      if (item.profile === 'storage') message = '「' + item.label + '」需要 ' + item.widthM + ' × ' + item.depthM + ' m 柜体及前方 ' + item.frontM + ' m 使用空间；为保留可开窗外墙，暂未找到足够的共享实墙与可达位置，可调整房门或模块连接。';
      issues.push({ code: 'unplaced', label: item.label, message: message, sourceIndex: item.sourceIndex,
        options: ['减少设施数量', '换一种布置', '增大模块'] });
    });
    var metricItems = data.furniture.map(function (item) { return Object.assign({}, item, { x: item.x * WORKING_CELL_METERS, y: item.y * WORKING_CELL_METERS, w: item.w * WORKING_CELL_METERS, h: item.h * WORKING_CELL_METERS }); });
    var audit = R.audit(metricItems, room.w * WORKING_CELL_METERS, room.h * WORKING_CELL_METERS);
    audit.checks.forEach(function (check) { issues.push({ code: check.code, label: check.label, message: check.reason, options: check.options }); });
    (data.accessibility && data.accessibility.issues || []).forEach(function (issue) { issues.push(issue); });
    if (data.routeUnresolved) issues.push({ code: 'route-unresolved', label: '进出通路', message: '当前门与门之间尚未找到连续的 0.9 m 通路；需要移动家具或调整模块连接。' });
    if(room.type==='livingSmall' && !data.windows.length && !data.doors.some(d=>d.glazed))issues.push({code:'daylight-unresolved',label:'小客厅采光',message:'小客厅尚无直接外窗，不能算作完成的起居布局；请留出朝外采光面，再调整相邻模块。'});
    data.useZones = data.furniture.flatMap(function (item) { return itemUseZones(item).map(function (zone) { return Object.assign({}, zone, {
      ownerId: item.id, groupId: item.groupId || null, ownerType: item.type, sharing: 'standing'
    }); }); });
    data.feasibility = { status: requested.length > data.furniture.length || audit.unplaced.length || data.routeUnresolved || blockedAccess(data.accessibility) ? 'partial' :
      audit.needsConfirmation.length || data.accessibility && data.accessibility.status !== 'fit' ? 'unresolved' : 'fit', requestedCount: requested.length, placedCount: data.furniture.length, issues: issues };
    if (room.type === 'livingSmall' || room.type === 'livingMedium') {
      var compactTargets = data.accessibility && data.accessibility.targets || [];
      data.compactProgram = { sharedTable: true, requestedSeats: room.type === 'livingSmall' ? 1 : 2,
        reachableSeats: data.furniture.filter(function(item){return item.type==='chair' && compactTargets.some(function(t){return t.chairId===item.id && t.reachable;});}).length,
        use: room.type === 'livingSmall' ? '单人用餐 / 临时笔记本办公' : '双人用餐 / 错时办公 / 少量待客' };
      if(room.type==='livingSmall'){
        var table=data.furniture.find(f=>f.type==='desk'),chair=data.furniture.find(f=>f.type==='chair');
        var stowed=data.furniture.filter(f=>f!==chair).map(function(f){
          if(f!==table)return Object.assign({},f);
          var folded=Object.assign({},f,{label:'餐写桌与折叠椅 · 已收起',depthM:.15,frontM:0,folded:true});
          if(['east','west'].includes(f.side)){folded.w=.15/WORKING_CELL_METERS;if(f.side==='east')folded.x=f.x+f.w-folded.w;}
          else{folded.h=.15/WORKING_CELL_METERS;if(f.side==='south')folded.y=f.y+f.h-folded.h;}
          return folded;
        });
        var occupiedClear=!!table && !!chair && !data.routeUnresolved && data.accessibility.status==='fit';
        data.compactProgram.foldable=!!table;
        data.compactProgram.daylightReady=!!data.windows.length||data.doors.some(d=>d.glazed);
        data.compactProgram.daylightSource=data.windows.length?'window':data.doors.some(d=>d.glazed)?'glazed-garden-door':'none';
        data.compactProgram.routeWidthM=.9;
        data.compactProgram.occupiedClear=occupiedClear;
        data.compactStates={ expanded:{furniture:data.furniture,routeClear:occupiedClear},stowed:{furniture:stowed,routeClear:occupiedClear} };
        if(!data.compactProgram.daylightReady)data.feasibility.status='partial';
      }
    }
    if (room.type === 'livingLarge') {
      data.livingLayout = livingLayoutMetrics(data);
      var targets = data.accessibility && data.accessibility.targets || [];
      var diningSeats = data.furniture.filter(function (item) { return item.profile === 'diningChair'; });
      var loungeSeats = data.furniture.filter(function (item) { return item.profile === 'largeSofa' || item.profile === 'armchair'; });
      data.livingProgram = { capacity: 4, diningSeats: 4, loungeSeats: 4,
        placedDiningSeats: data.entryConnected === false ? 0 : diningSeats.filter(function (item) { return targets.some(function (target) { return target.chairId === item.id && target.reachable === true; }); }).length,
        placedLoungeSeats: data.entryConnected === false ? 0 : loungeSeats.reduce(function (sum, item) { return sum + (targets.some(function (target) { return target.itemId === item.id && target.reachable === true; }) ? item.profile === 'largeSofa' ? 3 : 1 : 0); }, 0),
        drawnDiningSeats: diningSeats.length, drawnLoungeSeats: loungeSeats.reduce(function (sum, item) { return sum + (item.profile === 'largeSofa' ? 3 : 1); }, 0) };
    }
    issues.forEach(function (issue) { if (data.notes.indexOf(issue.message) < 0) data.notes.push(issue.message); });
    delete data.requestedItems;
  }
  function chooseLabelPosition(room, data) {
    var positions = [{ x: room.w / 2, y: room.h / 2 }];
    for (var y = 0.65; y < room.h - 0.3; y += 0.5) {
      for (var x = 1.25; x < room.w - 0.6; x += 0.5) positions.push({ x: x, y: y });
    }
    var selected = positions.find(function (p) {
      var rect = { x: p.x - 1.15, y: p.y - 0.28, w: 2.3, h: 0.56 };
      return inside(rect, room) && !data.furniture.some(function (item) { return overlap(rect, item, 0.1); }) &&
        !data.doors.some(function (door) { return overlap(rect, door.clearance); });
    });
    if (selected) data.labelPosition = selected;
  }
  function analyzeWorkingUnits(input, preferences, environment) {
    var rooms = (Array.isArray(input) ? input : []).filter(function (room) {
      return room && typeof room.id === 'string' && ['x', 'y', 'w', 'h'].every(function (key) { return Number.isFinite(room[key]); }) && room.w > 0 && room.h > 0;
    }).slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
    var prefs = E && E.normalizePrefs ? E.normalizePrefs(preferences) : Object.assign({ orientation: 'south', entranceSide: 'east' }, preferences);
    var entranceSide = SIDES.includes(prefs.entranceSide) ? prefs.entranceSide : 'east';
    var byRoom = Object.create(null), edges = [];
    rooms.forEach(function (room) { byRoom[room.id] = { doors: [], windows: [], furniture: [], notes: [], shared: [], exposed: {}, circulation: [] }; });
    rooms.forEach(function (a, index) {
      rooms.slice(index + 1).forEach(function (b) {
        var contact = wallContact(a, b);
        if (!contact) return;
        edges.push({ a: a, b: b, contact: contact, key: a.id + ':' + b.id });
        byRoom[a.id].shared.push({ side: contact.side, start: contact.start, width: contact.width, to: b.id });
        byRoom[b.id].shared.push({ side: OPPOSITE[contact.side], start: contact.otherStart, width: contact.width, to: a.id });
      });
    });
    rooms.forEach(function (room) {
      var data = byRoom[room.id];
      SIDES.forEach(function (side) {
        // An open garden does not obstruct daylight. Keep its contact for doors,
        // but permit windows on the indoor facade facing it (never through a core/neighbor).
        data.exposed[side] = subtract([{ start: 0, width: length(room, side) }], data.shared.filter(function (wall) { return wall.side === side && rooms.find(r=>r.id===wall.to)?.type!=='garden'; }));
      });
      // A core wall accepts the main entrance, but never an exterior window.
      // Building obstacles are not rooms: do not add circulation edges to them.
      data.entryExposed = Object.fromEntries(SIDES.map(side => [side, data.exposed[side].map(s => ({...s}))]));
      SIDES.forEach(side=>{data.entryExposed[side]=subtract(data.entryExposed[side],data.shared.filter(w=>w.side===side));});
      data.buildingWalls = [];
      (environment?.obstacles || []).forEach(function (obstacle) {
        var contact = wallContact(room, obstacle);
        if (!contact) return;
        data.buildingWalls.push({ side: contact.side, start: contact.start, width: contact.width, kind: obstacle.kind });
        data.exposed[contact.side] = subtract(data.exposed[contact.side], [contact]);
        if (obstacle.kind !== 'core') data.entryExposed[contact.side] = subtract(data.entryExposed[contact.side], [contact]);
      });
      if (data.buildingWalls.length) data.notes.push('贴核心筒或邻居的墙段保留为实墙；仅未遮挡的外墙参与开窗与家具布置。');
    });
    placeDoors(rooms, byRoom, edges, entranceSide);
    rooms.forEach(function (room) {
      var data = byRoom[room.id];
      // World position matters through contacts and doors, already in data.
      // Public results are recursively copied by scaleGeometry, so callers can
      // never mutate these bounded, internal cache entries during dragging.
      var cacheKey = JSON.stringify([room.id, room.type, room.w, room.h, room.rotation, room.functionPlan, prefs.orientation, data]);
      if (roomLayoutCache.has(cacheKey)) { byRoom[room.id] = roomLayoutCache.get(cacheKey); return; }
      placeWindowsAndFurniture(room, data, prefs);
      data.furniture.forEach(function (item, index) { item.id = room.id + '-furniture-' + index; });
      assessFurniture(room, data);
      chooseLabelPosition(room, data);
      roomLayoutCache.set(cacheKey, data);
      if (roomLayoutCache.size > 64) roomLayoutCache.delete(roomLayoutCache.keys().next().value);
    });
    return { byRoom: byRoom, notes: rooms.flatMap(function (room) {
      return byRoom[room.id].notes.map(function (text) { return { roomId: room.id, text: text }; });
    }) };
  }
  function scaleGeometry(value, factor) {
    if (Array.isArray(value)) return value.map(function (item) { return scaleGeometry(item, factor); });
    if (!value || typeof value !== 'object') return value;
    var result = {};
    Object.keys(value).forEach(function (key) {
      result[key] = key === 'functionPlan' ? value[key] : ['x', 'y', 'w', 'h', 'start', 'width', 'otherStart'].indexOf(key) >= 0 && Number.isFinite(value[key]) ?
        round(value[key] * factor) : scaleGeometry(value[key], factor);
    });
    return result;
  }
  function analyze(input, preferences, environment) {
    var engineCell = E && E.CELL_METERS || WORKING_CELL_METERS;
    var scale = engineCell / WORKING_CELL_METERS;
    var rooms = (Array.isArray(input) ? input : []).map(function (room) { return scaleGeometry(room, scale); });
    return scaleGeometry(analyzeWorkingUnits(rooms, preferences, { obstacles: (environment?.obstacles || []).map(r => scaleGeometry(r,scale)) }), 1 / scale);
  }
  return { analyze: analyze };
});

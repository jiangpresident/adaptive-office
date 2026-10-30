(function (root, factory) {
  'use strict';
  var rules = typeof module === 'object' && module.exports ? require('./furniture-rules.js') : root.WishFurnitureRules;
  var api = factory(rules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishAccess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';
  // This checks a 0.60 m square pedestrian envelope in the concept plan. It is
  // not an accessible-route/code-compliance claim and does not replace the
  // separate 0.90 m door-to-door circulation check in the interior solver.
  var WIDTH = .6, RADIUS = WIDTH / 2, EPS = .00002;
  var SIDES = ['north', 'east', 'south', 'west'];
  var NAMES = { north: '北', east: '东', south: '南', west: '西' };
  var OPPOSITE = { north: 'south', east: 'west', south: 'north', west: 'east' };
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function round(n) { return Math.round(n * 1000000) / 1000000; }
  function rect(item, cell) { return { x: item.x * cell, y: item.y * cell, w: item.w * cell, h: item.h * cell }; }
  function validRect(item) { return item && ['x', 'y', 'w', 'h'].every(function (key) { return finite(item[key]); }) && item.w > 0 && item.h > 0; }
  function inRange(n, lo, hi) { return n >= lo - EPS && n <= hi + EPS; }
  function midpoint(a, b) { return (a + b) / 2; }
  function publicRect(value, cell) { return { x: round(value.x / cell), y: round(value.y / cell), w: round(value.w / cell), h: round(value.h / cell) }; }

  // Centres may extend beyond a narrow furniture-specific zone, but the whole
  // pedestrian envelope must remain clear of walls and every furniture body.
  function approach(item, side, depth, central) {
    var horizontal = side === 'north' || side === 'south';
    var span = horizontal ? item.w : item.h, along = horizontal ? item.x : item.y;
    var half = central ? Math.min(.3, Math.max(0, (span - WIDTH) / 2)) : Math.max(0, (span - WIDTH) / 2);
    var low = along + span / 2 - half, high = along + span / 2 + half;
    var far = Math.max(RADIUS, depth - RADIUS), near, end;
    if (side === 'north') { near = item.y - far; end = item.y - RADIUS; }
    else if (side === 'south') { near = item.y + item.h + RADIUS; end = item.y + item.h + far; }
    else if (side === 'west') { near = item.x - far; end = item.x - RADIUS; }
    else { near = item.x + item.w + RADIUS; end = item.x + item.w + far; }
    return horizontal ? { x: low, y: near, w: high - low, h: end - near } : { x: near, y: low, w: end - near, h: high - low };
  }
  function buildTargets(items, roomId) {
    var targets = [], paired = new Set();
    function add(row, kind, side, goal, label, extra) {
      targets.push(Object.assign({ itemId: row.item.id || roomId + '-furniture-' + row.index,
        sourceIndex: row.item.sourceIndex, groupId: row.item.groupId || null, label: label || row.spec.label,
        kind: kind, side: side, reachable: null, goal: goal }, extra || {}));
    }
    items.forEach(function (row) {
      if (['desk', 'gamingDesk', 'diningTable', 'familyDiningTable'].indexOf(row.spec.profile) < 0 || !row.item.groupId && row.spec.profile !== 'familyDiningTable') return;
      var owner = Object.assign({}, row.item, row.rect), zones = R.zones(owner, row.rect);
      var chairs = items.filter(function (chair) {
        return ['chair', 'diningChair'].indexOf(chair.spec.profile) >= 0 && chair.item.groupId === row.item.groupId && zones.some(function (zone) {
          return R.mayShareUseZone(owner, Object.assign({}, chair.item, chair.rect), zone);
        });
      });
      chairs.forEach(function (chair) {
        // The chair remains a solid obstacle. This goal reaches its back, not
        // its seat; sitting/repositioning a chair is outside this walking audit.
        var side = chair.spec.side, dining = ['diningTable', 'familyDiningTable'].indexOf(row.spec.profile) >= 0;
        var front = OPPOSITE[row.spec.side];
        if (!dining) side = front;
        var alternativeGoals = dining ? [1, 3].map(function (turn) {
          var lateral = SIDES[(SIDES.indexOf(side) + turn) % 4];
          return { side: lateral, kind: 'side', goal: approach(chair.rect, lateral, .6, true) };
        }) : [];
        add(row, dining ? 'dining-seat-approach' : 'station-approach', side, approach(chair.rect, side, .9, true),
          dining ? row.spec.label + ' · ' + (chair.spec.label || '餐椅') + '接近位置' : row.spec.label + ' · 对应座椅后方',
          { chairId: chair.item.id || roomId + '-furniture-' + chair.index, approachSide: side, approachKind: 'behind', alternatives: alternativeGoals });
        paired.add(chair.index);
      });
      if (row.spec.profile === 'familyDiningTable' && chairs.length < 4) {
        add(row, 'missing-dining-seat', row.spec.side, null, row.spec.label + ' · 座位待补齐',
          { confirmationCode: 'access-seating-incomplete', confirmationMessage: '四人餐桌只找到 ' + chairs.length + ' 个正确配对的座位；需要逐一摆出并核对四把餐椅，不能以餐桌标签代替人数。' });
      }
      if (chairs.length) paired.add(row.index);
    });
    items.forEach(function (row) {
      var spec = row.spec, sideIndex = SIDES.indexOf(spec.side), front = OPPOSITE[spec.side];
      if (!spec.verified) {
        add(row, 'unconfirmed-use-space', spec.side, null, spec.label + ' · 使用位置待确认');
        return;
      }
      if (paired.has(row.index)) return;
      if (['doubleBed', 'largeBed', 'singleBed'].indexOf(spec.profile) >= 0) {
        [SIDES[(sideIndex + 1) % 4], SIDES[(sideIndex + 3) % 4]].forEach(function (side) {
          if(side===spec.wallSide)return;
          add(row, 'bed-side', side, approach(row.rect, side, Math.max(.6, spec.sideM), true), spec.label + ' · ' + NAMES[side] + '侧床边');
        });
        add(row, 'bed-foot', front, approach(row.rect, front, Math.max(.6, spec.frontM), true), spec.label + ' · 床尾');
        return;
      }
      if (spec.frontM > 0) {
        var kind = spec.profile === 'storage' ? 'storage-front' : ['kitchenCounter', 'kitchenSink', 'stove'].indexOf(spec.profile) >= 0 ? 'kitchen-front' :
          ['desk', 'gamingDesk', 'diningTable', 'familyDiningTable'].indexOf(spec.profile) >= 0 ? 'desk-front' : 'furniture-front';
        add(row, kind, front, approach(row.rect, front, spec.frontM, false), spec.label + ' · 使用位置');
      }
    });
    return targets;
  }
  function graph(width, height, obstacles, start, targets, radius) {
    radius = finite(radius) && radius > 0 ? radius : RADIUS;
    var minX = radius, maxX = width - radius, minY = radius, maxY = height - radius;
    if (maxX < minX - EPS || maxY < minY - EPS || !start) return null;
    var xs = [minX, maxX, start.x], ys = [minY, maxY, start.y];
    obstacles.forEach(function (o) { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); });
    targets.forEach(function (target) {
      [target.goal].concat((target.alternatives || []).map(function (alternative) { return alternative.goal; })).filter(Boolean).forEach(function (g) {
        xs.push(g.x, g.x + g.w, g.x + g.w / 2); ys.push(g.y, g.y + g.h, g.y + g.h / 2);
      });
    });
    function coordinates(values, low, high) {
      return Array.from(new Set(values.filter(function (value) { return inRange(value, low, high); }).map(round))).sort(function (a, b) { return a - b; });
    }
    xs = coordinates(xs, minX, maxX); ys = coordinates(ys, minY, maxY);
    var nx = xs.length, ny = ys.length, size = nx * ny;
    // Interior furniture is bounded to 20 requests. Keep the stand-alone
    // checker bounded too instead of approximating a giant input as reachable.
    if (size > 65536) return null;
    function blocked(x, y) {
      return obstacles.some(function (o) { return x > o.x + EPS && x < o.x + o.w - EPS && y > o.y + EPS && y < o.y + o.h - EPS; });
    }
    function clearSegment(x1, y1, x2, y2) {
      var horizontal = Math.abs(y1 - y2) < EPS;
      return !obstacles.some(function (o) {
        return horizontal ? y1 > o.y + EPS && y1 < o.y + o.h - EPS && Math.max(x1, x2) > o.x + EPS && Math.min(x1, x2) < o.x + o.w - EPS :
          x1 > o.x + EPS && x1 < o.x + o.w - EPS && Math.max(y1, y2) > o.y + EPS && Math.min(y1, y2) < o.y + o.h - EPS;
      });
    }
    var available = new Uint8Array(size), parents = new Int32Array(size), queue = new Int32Array(size);
    parents.fill(-2);
    for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++) available[y * nx + x] = blocked(xs[x], ys[y]) ? 0 : 1;
    var sx = xs.indexOf(round(start.x)), sy = ys.indexOf(round(start.y)), initial = sy * nx + sx;
    if (sx < 0 || sy < 0 || !available[initial]) return null;
    var head = 0, tail = 1; queue[0] = initial; parents[initial] = -1;
    while (head < tail) {
      var current = queue[head++], cx = current % nx, cy = Math.floor(current / nx);
      var next = [cx > 0 ? current - 1 : -1, cx + 1 < nx ? current + 1 : -1, cy > 0 ? current - nx : -1, cy + 1 < ny ? current + nx : -1];
      for (var index = 0; index < next.length; index++) {
        var id = next[index];
        if (id < 0 || parents[id] !== -2 || !available[id]) continue;
        var tx = id % nx, ty = Math.floor(id / nx);
        if (!clearSegment(xs[cx], ys[cy], xs[tx], ys[ty])) continue;
        parents[id] = current; queue[tail++] = id;
      }
    }
    function reach(goal, paths) {
      var best = -1, bestDistance = Infinity, centerX = goal.x + goal.w / 2, centerY = goal.y + goal.h / 2;
      for (var i = 0; i < tail; i++) {
        var id = queue[i], x = xs[id % nx], y = ys[Math.floor(id / nx)];
        if (!inRange(x, goal.x, goal.x + goal.w) || !inRange(y, goal.y, goal.y + goal.h)) continue;
        var dist = Math.abs(x - centerX) + Math.abs(y - centerY);
        if (dist < bestDistance) { best = id; bestDistance = dist; }
      }
      if (best < 0) return { reachable: false };
      if (!paths) return { reachable: true };
      var points = [];
      for (var id = best; id >= 0; id = parents[id]) points.push({ x: xs[id % nx], y: ys[Math.floor(id / nx)] });
      points.reverse();
      var simplified = [];
      points.forEach(function (point) {
        while (simplified.length >= 2) {
          var a = simplified[simplified.length - 2], b = simplified[simplified.length - 1];
          if (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - point.x) < EPS || Math.abs(a.y - b.y) < EPS && Math.abs(b.y - point.y) < EPS) simplified.pop();
          else break;
        }
        simplified.push(point);
      });
      return { reachable: true, path: simplified };
    }
    return { reach: reach, nodeCount: size };
  }
  function check(room, data, cellMeters, options) {
    var cell = finite(cellMeters) && cellMeters > 0 ? cellMeters : .3;
    options = options || {}; data = data || {}; room = room || {};
    var rawItems = Array.isArray(data.furniture) ? data.furniture : [], issues = [];
    var rows = rawItems.slice(0, 64).filter(validRect).map(function (item) {
      return { item: item, index: rawItems.indexOf(item), rect: rect(item, cell), spec: R.resolve(item) };
    });
    var width = room.w * cell, height = room.h * cell, targets = buildTargets(rows, room.id || 'room');
    var obstacles = rows.map(function (row) { return { x: row.rect.x - RADIUS, y: row.rect.y - RADIUS, w: row.rect.w + WIDTH, h: row.rect.h + WIDTH }; });
    var doors = (data.doors || []).filter(function (door) { return SIDES.indexOf(door.side) >= 0 && finite(door.start) && finite(door.width) && door.width * cell >= WIDTH - EPS; });
    var door = doors.find(function (entry) { return entry.kind === 'entry'; }) || doors[0], start = null;
    if (door) {
      var along = (door.start + door.width / 2) * cell;
      start = door.side === 'north' ? { x: along, y: RADIUS } : door.side === 'south' ? { x: along, y: height - RADIUS } :
        door.side === 'west' ? { x: RADIUS, y: along } : { x: width - RADIUS, y: along };
    }
    var valid = finite(width) && finite(height) && width > 0 && height > 0 && rows.length === rawItems.length && targets.length <= 96;
    var network = valid ? graph(width, height, obstacles, start, targets) : null;
    if (!door) issues.push({ code: 'access-unanchored', severity: 'info', label: '入口尚未连接', message: '当前模块没有可用门口，暂不能核对从入口到家具的连续通路。', options: ['先把模块连接到主平面'] });
    else if (!network) issues.push({ code: 'access-entry-blocked', severity: 'warning', label: '门内站立位置', message: '门内没有可用的 0.6 m 行人站立位置，或输入范围超出当前校核能力。', options: ['调整门口附近的家具', '增大通行空间'] });
    targets.forEach(function (target) {
      if (!target.goal) {
        issues.push({ code: target.confirmationCode || 'access-use-unconfirmed', severity: 'warning', label: target.label, sourceIndex: target.sourceIndex,
          message: target.confirmationMessage || target.label + '，设备真实操作位置和使用空间明确后才能核对行走通路。',
          options: target.confirmationCode === 'access-seating-incomplete' ? ['补齐并重新摆放餐椅'] : ['确认设备型号和操作位置'] });
      } else if (door) {
        var result = network ? network.reach(target.goal, options.paths !== false) : { reachable: false };
        if (!result.reachable && network) {
          (target.alternatives || []).some(function (alternative) {
            var choice = network.reach(alternative.goal, options.paths !== false);
            if (!choice.reachable) return false;
            result = choice; target.goal = alternative.goal; target.approachSide = alternative.side; target.approachKind = alternative.kind;
            return true;
          });
        }
        target.reachable = result.reachable;
        if (result.path) target.path = result.path.map(function (point) { return { x: round(point.x / cell), y: round(point.y / cell) }; });
        if (!result.reachable) issues.push({ code: 'access-blocked', severity: 'warning', itemId: target.itemId, sourceIndex: target.sourceIndex, label: target.label,
          message: '门口到「' + target.label + '」之间没有连续的 0.6 m 行人通路；局部留出家具间距仍不代表能够走到。',
          options: ['移动阻路家具', '调整家具朝向', '增大模块'] });
      }
      if (target.goal) target.goal = publicRect(target.goal, cell);
      delete target.alternatives;
    });
    return { status: door && network && targets.every(function (target) { return target.reachable === true; }) ? 'fit' : 'unresolved',
      anchor: door ? 'door' : 'none', passageWidthM: WIDTH, scope: 'concept',
      entry: start ? Object.assign({ side: door.side, kind: door.kind, to: door.to || null }, { x: round(start.x / cell), y: round(start.y / cell) }) : null,
      targets: targets, issues: issues, nodeCount: network ? network.nodeCount : 0 };
  }
  // The circulation fallback uses the same exact orthogonal graph with a
  // larger envelope. Every physical body remains solid, including paired
  // dining/work chairs. A single source must reach all other door centres.
  function connectDoors(room, data, cellMeters) {
    room = room || {}; data = data || {};
    var cell = cellMeters === undefined ? .3 : cellMeters;
    var widthM = .9, radius = widthM / 2, issues = [], paths = [], targets = [];
    var result = { status: 'unresolved', widthM: widthM, anchor: 'none', entry: null, paths: paths, targets: targets, issues: issues, nodeCount: 0, scope: 'concept' };
    function issue(code, label, message, doorIndex) {
      var item = { code: code, label: label, message: message };
      if (doorIndex !== undefined) item.doorIndex = doorIndex;
      issues.push(item);
    }
    var rawItems = data.furniture === undefined ? [] : data.furniture, rawDoors = data.doors === undefined ? [] : data.doors;
    if (!finite(cell) || cell <= 0 || !finite(room.w) || !finite(room.h) || room.w <= 0 || room.h <= 0 ||
      !Array.isArray(rawItems) || !Array.isArray(rawDoors) || rawItems.length > 64 || rawDoors.length > 16) {
      issue('circulation-input-invalid', '通路尚未核对', '房间、家具或门口的输入无效，或超出当前通路核对范围。');
      return result;
    }
    var width = room.w * cell, height = room.h * cell;
    // Public geometry rounds position and size independently to four decimal
    // grid places. Permit at most 0.1 mm of boundary round-off, in metres.
    var boundaryToleranceM = .0001;
    if (!finite(width) || !finite(height) || rawItems.some(function (item) {
      if (!validRect(item)) return true;
      var body = rect(item, cell);
      return !validRect(body) || body.x < -boundaryToleranceM || body.y < -boundaryToleranceM || body.x + body.w > width + boundaryToleranceM || body.y + body.h > height + boundaryToleranceM;
    })) {
      issue('circulation-input-invalid', '家具边界待确认', '家具尺寸或位置无效，不能在忽略这些家具后宣称通路畅通。');
      return result;
    }
    rawDoors.forEach(function (door, index) {
      if (!door || SIDES.indexOf(door.side) < 0 || !finite(door.start) || !finite(door.width) || door.width <= 0 ||
        door.start * cell < -EPS || (door.start + door.width) * cell > (door.side === 'north' || door.side === 'south' ? width : height) + EPS) {
        issue('circulation-door-invalid', '门口位置待确认', '门口的位置或宽度超出有效墙面，暂不能核对门间通路。', index);
      } else if (door.width * cell < widthM - EPS) {
        issue('circulation-door-narrow', '门口宽度不足', '门口净宽不足 0.9 m，不能作为已满足 0.9 m 门间通路的连接。', index);
      }
    });
    if (issues.length) return result;
    if (!rawDoors.length) {
      issue('circulation-unanchored', '入口尚未连接', '当前模块没有门口，不能核对从入口到其他门口的连续通路。');
      return result;
    }
    function inside(door) {
      var along = (door.start + door.width / 2) * cell;
      return door.side === 'north' ? { x: along, y: radius } : door.side === 'south' ? { x: along, y: height - radius } :
        door.side === 'west' ? { x: radius, y: along } : { x: width - radius, y: along };
    }
    var sourceIndex = rawDoors.findIndex(function (door) { return door.kind === 'entry'; });
    if (sourceIndex < 0) sourceIndex = 0;
    var source = rawDoors[sourceIndex], start = inside(source);
    result.anchor = 'door';
    result.entry = { doorIndex: sourceIndex, side: source.side, kind: source.kind || null, to: source.to || null, x: round(start.x / cell), y: round(start.y / cell) };
    rawDoors.forEach(function (door, index) {
      var point = inside(door);
      targets.push({ doorIndex: index, side: door.side, to: door.to || null, reachable: false, goal: { x: point.x, y: point.y, w: 0, h: 0 } });
    });
    var obstacles = rawItems.map(function (item) {
      var body = rect(item, cell);
      return { x: body.x - radius, y: body.y - radius, w: body.w + widthM, h: body.h + widthM };
    });
    var network = graph(width, height, obstacles, start, targets, radius);
    result.nodeCount = network ? network.nodeCount : 0;
    if (!network) issue('circulation-entry-blocked', '门内通路受阻', '入口内没有完整的 0.9 m 站立空间，或当前几何超出核对范围。', sourceIndex);
    targets.forEach(function (target) {
      var route = network ? network.reach(target.goal, true) : { reachable: false };
      target.reachable = route.reachable;
      if (route.path) {
        target.path = route.path.map(function (point) { return { x: round(point.x / cell), y: round(point.y / cell) }; });
        paths.push(target.path);
      } else if (network) issue('circulation-blocked', NAMES[target.side] + '侧门口通路受阻', '入口到这处门口之间没有连续的 0.9 m 通路，需要移动家具或调整门口。', target.doorIndex);
      delete target.goal;
    });
    if (network && targets.every(function (target) { return target.reachable; })) result.status = 'fit';
    return result;
  }
  return Object.freeze({ check: check, connectDoors: connectDoors, passageWidthM: WIDTH });
});

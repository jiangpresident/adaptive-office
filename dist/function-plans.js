(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./furniture-rules.js') : root.WishFurnitureRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishouseFunctionPlans = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  const UNIT_METERS = 3;
  const MAX_PLANS = 120;
  const KINDS = Object.freeze(['desk', 'chair', 'storage', 'bed', 'sofa', 'table', 'sink', 'toilet', 'shower', 'fixture', 'equipment', 'plant', 'generic']);
  const ENTRY_CLEARANCE = Object.freeze({ x: .70, y: .58, w: .30, h: .34 });
  function entryClearance(widthUnits, heightUnits) {
    const widthM = widthUnits * UNIT_METERS, heightM = heightUnits * UNIT_METERS;
    return { x: widthM - 1.2, y: Math.max(0, Math.min(heightM - .9, heightM * .75 - .45)), w: 1.2, h: .9 };
  }

  function cleanText(value, length) {
    return typeof value === 'string' ? [...value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()].slice(0, length).join('') : '';
  }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  function dimension(value) {
    const n = number(value);
    return n !== null && n >= .5 && n <= 4 && Math.abs(n * 2 - Math.round(n * 2)) < .0001 ? n : null;
  }
  function intersects(a, b) {
    return a.x < b.x + b.w - .00001 && a.x + a.w > b.x + .00001 && a.y < b.y + b.h - .00001 && a.y + a.h > b.y + .00001;
  }
  function isoDate(value, fallback) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return fallback;
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) ? new Date(stamp).toISOString() : fallback;
  }
  function nowDate(options) {
    return isoDate(options && options.now, new Date().toISOString());
  }
  function identity(value) {
    return cleanText(value, 80).toLocaleLowerCase().replace(/\s+/g, '');
  }
  function autoId(title) {
    let hash = 2166136261;
    for (let i = 0; i < title.length; i++) { hash ^= title.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return 'function-' + (hash >>> 0).toString(36);
  }
  function geometry(item, widthM, heightM, context) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const label = cleanText(item.label, 60) || '未命名设施';
    const kind = KINDS.includes(item.kind) ? item.kind : ({ diningTable: 'table', diningChair: 'chair', armchair: 'chair' })[item.kind] || 'generic';
    const base = { ...item, label, kind };
    if (!base.profile && ['diningChair', 'armchair'].includes(item.kind)) base.profile = item.kind;
    if (!base.profile && kind === 'desk' && /游戏|电竞|开黑|gaming/i.test(context || '')) base.profile = 'gamingDesk';
    const unknown = !R.resolve(base).verified;
    // Historical generic equipment has no catalogue. Freeze its first physical
    // estimate so later changes to the room cannot silently shrink the equipment.
    const quarterTurn = item.side === 'east' || item.side === 'west';
    if (unknown && number(base.widthM) === null && number(item.w) > 0 && number(item.h) > 0) base.widthM = quarterTurn ? item.h * heightM : item.w * widthM;
    if (unknown && number(base.depthM) === null && number(item.w) > 0 && number(item.h) > 0) base.depthM = quarterTurn ? item.w * widthM : item.h * heightM;
    const spec = R.resolve(base), footprint = R.footprint(spec);
    const sizeWarnings = [...new Set([...(Array.isArray(item.sizeWarnings) ? item.sizeWarnings : []).map(note => cleanText(note, 180)).filter(Boolean), ...spec.adjustments])].slice(0, 4);
    if (number(item.x) === null || number(item.y) === null) sizeWarnings.push('原草图坐标无效，已重新寻找位置，需确认布置。');
    const result = { label, kind, x: number(item.x) === null ? 0 : item.x, y: number(item.y) === null ? 0 : item.y,
      w: footprint.w / widthM, h: footprint.h / heightM, profile: spec.profile, widthM: spec.widthM, depthM: spec.depthM, side: spec.side };
    const groupId = cleanText(item.groupId, 60);
    if (groupId) result.groupId = groupId;
    if (sizeWarnings.length) result.sizeWarnings = [...new Set(sizeWarnings)].slice(0, 4);
    return result;
  }
  function toMetric(item, widthM, heightM) { return { ...item, x: item.x * widthM, y: item.y * heightM, w: item.w * widthM, h: item.h * heightM }; }
  function isSeat(item) { return ['chair', 'diningChair'].includes(item.profile); }
  function isDining(item) { return ['diningTable', 'familyDiningTable'].includes(item.profile); }
  function groupStations(items, widthM, heightM) {
    const tables = items.filter(item => ['desk', 'gamingDesk', 'diningTable', 'familyDiningTable'].includes(item.profile));
    tables.forEach((table, index) => { if (!table.groupId) table.groupId = 'auto-station-' + (index + 1); });
    const assigned = new Map(tables.map(table => [table.groupId, items.filter(item => isSeat(item) && item.groupId === table.groupId).length]));
    items.filter(item => isSeat(item) && !item.groupId).forEach(chair => {
      const center = { x: (chair.x + chair.w / 2) * widthM, y: (chair.y + chair.h / 2) * heightM };
      const candidates = tables.filter(table => (assigned.get(table.groupId) || 0) < (isDining(table) ? 4 : 1)).map(table => {
        const rect = toMetric(table, widthM, heightM), use = R.zones(table, rect).filter(zone => isDining(table) || zone.kind === 'front');
        return { table, distance: Math.min(...use.map(zone => (center.x - zone.x - zone.w / 2) ** 2 + (center.y - zone.y - zone.h / 2) ** 2)) };
      }).sort((a, b) => a.distance - b.distance);
      if (candidates.length) { chair.groupId = candidates[0].table.groupId; assigned.set(chair.groupId, (assigned.get(chair.groupId) || 0) + 1); }
    });
    items.filter(item => isSeat(item) && item.groupId).forEach(chair => {
      const table = tables.find(item => item.groupId === chair.groupId);
      if (!table) return;
      // New non-square dining seats need an orientation-independent reference:
      // otherwise an unplaced chair can alternate its nearest table side on
      // every save after a room becomes too small. Legacy chairs keep their
      // existing placement interpretation and physical dimensions.
      const stableSeat = chair.profile === 'diningChair' || table.profile === 'familyDiningTable';
      const anchor = Math.max(chair.widthM, chair.depthM) / 2;
      const rect = toMetric(table, widthM, heightM), center = {
        x: chair.x * widthM + (stableSeat ? anchor : chair.w * widthM / 2),
        y: chair.y * heightM + (stableSeat ? anchor : chair.h * heightM / 2)
      };
      const use = R.zones(table, rect).filter(zone => isDining(table) || zone.kind === 'front').sort((a, b) =>
        (center.x - a.x - a.w / 2) ** 2 + (center.y - a.y - a.h / 2) ** 2 - (center.x - b.x - b.w / 2) ** 2 - (center.y - b.y - b.h / 2) ** 2)[0];
      if (use) { chair.side = use.side; const footprint = R.footprint(chair); chair.w = footprint.w / widthM; chair.h = footprint.h / heightM; }
    });
    // Reserve a table's actual footprint and use space before fitting its chairs.
    return items.filter(item => !isSeat(item)).concat(items.filter(isSeat));
  }
  function nearestPosition(item, placed, widthM, heightM) {
    const metric = toMetric(item, widthM, heightM), bounds = { x: 0, y: 0, w: widthM, h: heightM };
    const entrance = entryClearance(widthM / UNIT_METERS, heightM / UNIT_METERS);
    const others = placed.map(other => { const rect = toMetric(other, widthM, heightM); return { rect, zones: R.zones(rect, rect) }; });
    others.forEach(other => {
      if (isSeat(R.resolve(other.rect)) && others.some(owner => owner !== other && owner.zones.some(zone => R.mayShareUseZone(owner.rect, other.rect, zone)))) other.zones = [];
    });
    const baseZones = R.zones(metric, { ...metric, x: 0, y: 0 });
    function seatZone(rect) {
      if (!isSeat(item)) return null;
      for (const other of others) for (const zone of other.zones) if (zone.side === item.side && R.mayShareUseZone(other.rect, rect, zone)) return zone;
      return null;
    }
    function fits(rect) {
      if (!R.contains(bounds, rect) || R.intersects(rect, entrance)) return false;
      const paired = seatZone(rect);
      if (isSeat(item) && item.groupId && !paired) return false;
      const zones = paired ? [] : baseZones.map(zone => ({ ...zone, x: zone.x + rect.x, y: zone.y + rect.y }));
      if (zones.some(zone => !R.contains(bounds, zone))) return false;
      return !others.some(other => R.intersects(rect, other.rect) || zones.some(zone => R.intersects(zone, other.rect) && !R.mayShareUseZone(rect, other.rect, zone)) || other.zones.some(zone => R.intersects(zone, rect) && !R.mayShareUseZone(other.rect, rect, zone)));
    }
    function normalized(rect) { const seat = seatZone(rect); return { ...item, x: rect.x / widthM, y: rect.y / heightM, ...(seat ? { side: seat.side } : {}) }; }
    if (fits(metric)) return normalized(metric);
    if (metric.w > widthM + .0001 || metric.h > heightM + .0001) return null;
    const axis = (start, size, limit, key) => {
      const max = limit - size, values = [Math.max(0, Math.min(max, start)), 0, max];
      for (let n = 0; n <= Math.ceil(max * 10); n++) if (n / 10 <= max + .00001) values.push(n / 10);
      // Include exact clearances and neighbouring edges between 10 cm samples.
      for (const zone of baseZones) { values.push(-zone[key], limit - zone[key] - zone[key === 'x' ? 'w' : 'h']); }
      for (const other of others) for (const rect of [other.rect, ...other.zones]) { values.push(rect[key] + rect[key === 'x' ? 'w' : 'h'], rect[key] - size); }
      return [...new Set(values.filter(value => Number.isFinite(value) && value >= -.0001 && value <= max + .0001).map(value => Math.round(Math.max(0, value) * 10000) / 10000))];
    };
    let best = null, score = Infinity;
    for (const y of axis(metric.y, metric.h, heightM, 'y')) for (const x of axis(metric.x, metric.w, widthM, 'x')) {
      const distance = (x - metric.x) ** 2 + (y - metric.y) ** 2;
      if (distance > score + .00000001) continue;
      const rect = { ...metric, x, y };
      if (!fits(rect)) continue;
      if (distance < score - .00000001 || !best || y < best.y || (y === best.y && x < best.x)) { best = rect; score = distance; }
    }
    return best ? normalized(best) : null;
  }
  function normalizePlan(input, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const title = cleanText(input.title, 60);
    const widthUnits = dimension(input.widthUnits), heightUnits = dimension(input.heightUnits);
    if (!title || widthUnits === null || heightUnits === null) return null;
    const suppliedId = cleanText(input.id, 80);
    const id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(suppliedId) ? suppliedId : autoId(title);
    const widthM = widthUnits * UNIT_METERS, heightM = heightUnits * UNIT_METERS;
    const requests = (Array.isArray(input.furniture) ? input.furniture : []).concat((Array.isArray(input.unplaced) ? input.unplaced : []).map(value => value && value.item)).slice(0, 10);
    const furniture = [], unplaced = [], moved = [];
    const prepared = groupStations(requests.map(value => geometry(value, widthM, heightM, title + ' ' + cleanText(input.description, 400))).filter(Boolean), widthM, heightM);
    for (const item of prepared) {
      const positioned = nearestPosition(item, furniture, widthM, heightM);
      if (!positioned) {
        const spec = R.resolve(item);
        const use = [spec.frontM ? '前方 ' + spec.frontM + ' m' : '', spec.sideM ? '两侧各 ' + spec.sideM + ' m' : '', spec.backM ? '后方 ' + spec.backM + ' m' : ''].filter(Boolean).join('、');
        unplaced.push({ item, reason: '「' + item.label + '」外形为 ' + item.widthM + ' × ' + item.depthM + ' m' + (use ? '，另需' + use + '使用空间' : '') + '；当前模块未找到可用位置。', options: ['减少设施数量', '增大模块', '调整家具方向或选择合适型号'] });
        continue;
      }
      if (Math.abs(positioned.x - item.x) > .000001 || Math.abs(positioned.y - item.y) > .000001) moved.push(item.label);
      furniture.push(positioned);
    }
    const metric = furniture.map(item => toMetric(item, widthM, heightM));
    const audit = R.audit(metric, widthM, heightM);
    const checks = audit.checks.concat(unplaced.map(value => ({ code: 'unplaced', label: value.item.label, reason: value.reason, options: value.options })));
    prepared.filter(item => item.profile === 'familyDiningTable').forEach(table => {
      const placedTable = metric.find(item => item.profile === table.profile && item.groupId === table.groupId);
      const seats = placedTable ? metric.filter(chair => isSeat(chair) && chair.groupId === placedTable.groupId && R.zones(placedTable, placedTable).some(zone => R.mayShareUseZone(placedTable, chair, zone))).length : 0;
      if (seats < 4) checks.push({ code: 'dining-seats-incomplete', label: table.label, reason: '四人餐桌目前只有 ' + seats + ' 个正确配对并放下的座位；需逐一补齐四把餐椅，不能把桌名当成已容纳四人。', options: ['补齐餐椅', '调整餐桌椅位置', '增大模块'] });
    });
    const layoutAdjusted = input.layoutAdjusted === true || moved.length > 0;
    if (layoutAdjusted) checks.push({ code: 'layout-adjusted', label: title, reason: '已按家具实际尺寸重新布置；原文字中的人数、并排与靠墙关系仍需逐项核对，以当前平面和待调整项为准。', options: ['确认当前布置', '继续调整位置或模块大小'] });
    // Unknown equipment remains an explicit dimensional question even if it did
    // not fit, instead of acquiring a false "verified" status on a later reload.
    for (const entry of unplaced) {
      const spec = R.resolve(entry.item);
      if (!spec.verified) checks.push({ code: 'dimensions-unconfirmed', label: entry.item.label, reason: '设备型号、外形与使用空间尚待确认。', options: ['提供设备型号或实际尺寸'] });
      for (const reason of entry.item.sizeWarnings || []) checks.push({ code: 'size-adjusted', label: entry.item.label, reason, options: ['确认默认尺寸', '提供可核对的家具尺寸'] });
    }
    const notes = [...new Set((Array.isArray(input.notes) ? input.notes : []).map(note => cleanText(note, 160)).filter(Boolean))].slice(0, 4);
    if (moved.length && !notes.some(note => note.startsWith('已按家具实际尺寸'))) {
      const note = '已按家具实际尺寸调整摆位，并保留入口空位与使用空间。';
      if (notes.length < 4) notes.push(note);
    }
    const stamp = nowDate(options);
    return {
      id, title, ...(['livingLarge','livingSmall','livingMedium','kitchen','bedroom','bedroomSingle','washroom','showerRoom','balcony','garden'].includes(input.parentType)?{parentType:input.parentType}:{}), description: cleanText(input.description, 400), widthUnits, heightUnits, furniture, unplaced, checks,
      furnitureRulesVersion: R.VERSION, layoutAdjusted, notes,
      createdAt: isoDate(input.createdAt, stamp), updatedAt: isoDate(input.updatedAt, stamp)
    };
  }
  function contentOf(plan) {
    return JSON.stringify([plan.parentType, plan.title, plan.description, plan.widthUnits, plan.heightUnits, plan.furniture, plan.unplaced, plan.notes]);
  }
  function normalizeLibrary(input, options = {}) {
    if (!Array.isArray(input)) return [];
    const result = [];
    for (const value of input.slice(0, MAX_PLANS * 2)) {
      const plan = normalizePlan(value, options);
      if (!plan) continue;
      const previous = result.findIndex(item => item.id === plan.id || (item.parentType||null)===(plan.parentType||null) && identity(item.title) === identity(plan.title));
      if (previous !== -1) result[previous] = { ...plan, id: result[previous].id, createdAt: result[previous].createdAt };
      else if (result.length < MAX_PLANS) result.push(plan);
    }
    return result;
  }
  function mergeLibrary(existing, incoming, options = {}) {
    const result = normalizeLibrary(existing, options);
    const stamp = nowDate(options);
    for (const plan of normalizeLibrary(incoming, options)) {
      const previous = result.findIndex(item => item.id === plan.id || (item.parentType||null)===(plan.parentType||null) && identity(item.title) === identity(plan.title));
      if (previous === -1) {
        if (result.length < MAX_PLANS) result.push({ ...plan, createdAt: stamp, updatedAt: stamp });
      } else {
        const old = result[previous];
        result[previous] = { ...plan, id: old.id, createdAt: old.createdAt, updatedAt: contentOf(old) === contentOf(plan) ? old.updatedAt : stamp };
      }
    }
    return result;
  }

  function furnitureGlyph(kind, w, h) {
    const n = value => Math.round(value * 100) / 100;
    if (w < 5 || h < 5) return `<rect width="${n(w)}" height="${n(h)}"/>`;
    const box = `<rect x="1" y="1" width="${n(w - 2)}" height="${n(h - 2)}" rx="1"/>`;
    const line = d => `<path class="fp-detail" d="${d}"/>`;
    if (kind === 'plant') return `<ellipse cx="${n(w / 2)}" cy="${n(h / 2)}" rx="${n(w / 2 - 1)}" ry="${n(h / 2 - 1)}"/>` + line(`M${n(w * .2)} ${n(h / 2)}H${n(w * .8)}M${n(w / 2)} ${n(h * .2)}V${n(h * .8)}`);
    if (kind === 'chair') return box + line(`M${n(w * .15)} ${n(h * .3)}H${n(w * .85)}M${n(w * .15)} ${n(h * .3)}V${n(h * .8)}M${n(w * .85)} ${n(h * .3)}V${n(h * .8)}`);
    if (kind === 'diningChair') return `<rect class="fp-soft" x="${n(w * .1)}" y="${n(h * .22)}" width="${n(w * .8)}" height="${n(h * .7)}" rx="1"/><rect x="1" y="1" width="${n(w - 2)}" height="${n(h * .21)}" rx="1"/>`;
    if (kind === 'bed') return box + `<rect class="fp-soft" x="${n(w * .1)}" y="${n(h * .06)}" width="${n(w * .8)}" height="${n(h * .19)}" rx="1"/>` + line(`M1 ${n(h * .32)}H${n(w - 1)}`);
    if (kind === 'sofa') return box + line(`M${n(w * .12)} ${n(h * .9)}V${n(h * .25)}H${n(w * .88)}V${n(h * .9)}M${n(w * .5)} ${n(h * .25)}V${n(h * .9)}`);
    if (kind === 'armchair') return box + `<rect class="fp-soft" x="${n(w * .19)}" y="${n(h * .23)}" width="${n(w * .62)}" height="${n(h * .66)}" rx="1"/>` + line(`M${n(w * .12)} ${n(h * .88)}V${n(h * .17)}H${n(w * .88)}V${n(h * .88)}`);
    if (kind === 'storage') return box + line(`M${n(w / 2)} 1V${n(h - 1)}M${n(w * .44)} ${n(h * .35)}V${n(h * .65)}M${n(w * .56)} ${n(h * .35)}V${n(h * .65)}`);
    if (kind === 'desk') return box + `<rect class="fp-soft" x="${n(w * .25)}" y="${n(h * .1)}" width="${n(w * .5)}" height="${n(h * .24)}"/>` + line(`M${n(w * .18)} ${n(h * .8)}H${n(w * .82)}`);
    if (kind === 'sink') return box + `<rect class="fp-detail" x="${n(w * .15)}" y="${n(h * .22)}" width="${n(w * .7)}" height="${n(h * .6)}" rx="3"/>` + line(`M${n(w / 2)} 1V${n(h * .4)}`);
    if (kind === 'toilet') return `<rect x="${n(w * .2)}" y="1" width="${n(w * .6)}" height="${n(h * .25)}" rx="1"/><ellipse cx="${n(w / 2)}" cy="${n(h * .6)}" rx="${n(w * .33)}" ry="${n(h * .36)}"/>`;
    if (kind === 'shower') return box + line(`M1 1L${n(w - 1)} ${n(h - 1)}M${n(w - 1)} 1L1 ${n(h - 1)}`) + `<circle class="fp-detail" cx="${n(w / 2)}" cy="${n(h / 2)}" r="${n(Math.min(w, h) * .08)}"/>`;
    if (kind === 'table') return box + `<circle class="fp-detail" cx="${n(w / 2)}" cy="${n(h / 2)}" r="${n(Math.min(w, h) * .16)}"/>`;
    if (kind === 'diningTable') return box + [.28, .72].flatMap(x => [.28, .72].map(y => `<circle class="fp-detail" cx="${n(w * x)}" cy="${n(h * y)}" r="${n(Math.min(w, h) * .12)}"/>`)).join('');
    if (kind === 'equipment') return box + line(`M${n(w * .15)} ${n(h * .15)}H${n(w * .85)}V${n(h * .85)}H${n(w * .15)}Z`);
    if (kind === 'fixture') return box + line(`M${n(w * .16)} ${n(h * .18)}H${n(w * .84)}M${n(w * .16)} ${n(h * .82)}H${n(w * .84)}`);
    return box;
  }
  function renderSvg(value, options = {}) {
    const plan = normalizePlan(value);
    if (!plan) return '';
    const paper = options.export === true;
    const colors = paper ? { bg: '#fffef8', text: '#253020', faint: '#7b8974', accent: '#526c2b', fill: '#f2f5e8', line: '#879775', furniture: '#e9efdc', window: '#387588' } : { bg: '#141910', text: '#edf5df', faint: '#8a9c78', accent: '#c0fe04', fill: '#1b2313', line: '#52633c', furniture: '#303f1e', window: '#9db4ff' };
    const mw = plan.widthUnits * UNIT_METERS, mh = plan.heightUnits * UNIT_METERS;
    const scale = Math.min(410 / mw, 305 / mh);
    const width = mw * scale, height = mh * scale;
    const left = (640 - width) / 2, top = 144 + (305 - height) / 2;
    const n = number => Math.round(number * 100) / 100;
    const mark = (x, y, value, anchor = 'middle') => `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" class="fp-dimension">${esc(value)}</text>`;
    let grid = '';
    for (let u = .5; u < plan.widthUnits; u += .5) grid += `<path d="M${n(u * UNIT_METERS * scale)} 0V${n(height)}" opacity="${Number.isInteger(u) ? '.5' : '.23'}"/>`;
    for (let u = .5; u < plan.heightUnits; u += .5) grid += `<path d="M0 ${n(u * UNIT_METERS * scale)}H${n(width)}" opacity="${Number.isInteger(u) ? '.5' : '.23'}"/>`;
    const items = plan.furniture.map(item => {
      const w = item.w * width, h = item.h * height;
      const label = [...item.label].slice(0, Math.max(2, Math.min(8, Math.floor(w / 9)))).join('');
      const labelSize = Math.max(7, Math.min(10, h / 3));
      const labelMarkup = w >= 18 && h >= 12 ? `<text x="${n(w / 2)}" y="${n(h * .64)}" text-anchor="middle" dominant-baseline="middle" font-size="${n(labelSize)}">${esc(label)}</text>` : '';
      const rotation = { north: 0, east: 90, south: 180, west: 270 }[item.side] || 0;
      const transform = rotation === 90 ? `translate(${n(w)} 0) rotate(90)` : rotation === 180 ? `translate(${n(w)} ${n(h)}) rotate(180)` : rotation === 270 ? `translate(0 ${n(h)}) rotate(270)` : '';
      const glyphKind = item.profile === 'familyDiningTable' ? 'diningTable' : item.profile === 'diningChair' ? 'diningChair' : item.profile === 'armchair' ? 'armchair' : item.kind;
      return `<g class="fp-furniture" data-kind="${item.kind}" data-profile="${item.profile}" transform="translate(${n(item.x * width)} ${n(item.y * height)})"><title>${esc(item.label)} · ${item.widthM} × ${item.depthM} m</title><g transform="${transform}">${furnitureGlyph(glyphKind, rotation % 180 ? h : w, rotation % 180 ? w : h)}</g>${labelMarkup}</g>`;
    }).join('');
    const metricItems = plan.furniture.map(item => toMetric(item, mw, mh));
    const useZones = metricItems.flatMap(item => {
      const paired = isSeat(R.resolve(item)) && metricItems.some(owner => owner !== item && R.zones(owner, owner).some(zone => R.mayShareUseZone(owner, item, zone)));
      return R.zones({ ...item, paired }, item).map(zone => `<rect class="fp-use-zone" x="${n(zone.x * scale)}" y="${n(zone.y * scale)}" width="${n(zone.w * scale)}" height="${n(zone.h * scale)}"><title>${esc(zone.label)} · ${zone.requiredM} m</title></rect>`);
    }).join('');
    // Keep the schematic leaf inside the same reserved rectangle used by the model.
    const entry = entryClearance(plan.widthUnits, plan.heightUnits);
    const doorWidth = .9 * scale;
    const doorTop = entry.y * scale, doorBottom = doorTop + doorWidth;
    const windowStart = width * .25, windowEnd = width * .65;
    const clearance = `<rect class="fp-clearance" x="${n(entry.x * scale)}" y="${n(entry.y * scale)}" width="${n(entry.w * scale)}" height="${n(entry.h * scale)}"/><path class="fp-entry-arrow" d="M${n(width + 29)} ${n(doorTop + doorWidth / 2)}H${n(width - 8)}m6-4-6 4 6 4"/>`;
    const window = `<path class="fp-gap" d="M${n(windowStart)} 0H${n(windowEnd)}"/><path class="fp-window" d="M${n(windowStart)} -2H${n(windowEnd)}M${n(windowStart)} 2H${n(windowEnd)}M${n(windowStart)} -4V4M${n(windowEnd)} -4V4"/>`;
    const door = `<path class="fp-gap" d="M${n(width)} ${n(doorTop)}V${n(doorBottom)}"/><path class="fp-door" d="M${n(width)} ${n(doorTop)}H${n(width - doorWidth)}"/><path class="fp-door-arc" d="M${n(width)} ${n(doorBottom)}A${n(doorWidth)} ${n(doorWidth)} 0 0 1 ${n(width - doorWidth)} ${n(doorTop)}"/>`;
    const dimY = top - 22, dimX = left - 23;
    const dimensions = `<g class="fp-dimension-lines"><path d="M${n(left)} ${n(top - 8)}V${n(dimY - 5)}M${n(left + width)} ${n(top - 8)}V${n(dimY - 5)}M${n(left)} ${n(dimY)}H${n(left + width)}M${n(left - 8)} ${n(top)}H${n(dimX - 5)}M${n(left - 8)} ${n(top + height)}H${n(dimX - 5)}M${n(dimX)} ${n(top)}V${n(top + height)}"/></g>${mark(320, dimY - 8, `${mw} m / ${plan.widthUnits} 单元`)}<g transform="translate(${n(dimX - 9)} ${n(top + height / 2)}) rotate(-90)">${mark(0, 0, `${mh} m / ${plan.heightUnits} 单元`)}</g>`;
    const title = [...plan.title].slice(0, 22).join('');
    const warnings = plan.checks.slice().sort((a, b) => Number(b.code === 'unplaced') - Number(a.code === 'unplaced')).slice(0, 4);
    const svgHeight = 540 + warnings.length * 33;
    const warningMarkup = warnings.map((check, index) => `<text x="34" y="${549 + index * 33}" font-size="10" style="fill:${colors.accent}">${esc([...check.label].slice(0, 30).join(''))} · ${check.code === 'unplaced' ? '未放下' : '待核对'}</text><text x="34" y="${564 + index * 33}" class="fp-caption">${esc([...check.reason].slice(0, 49).join(''))}${[...check.reason].length > 49 ? '…' : ''}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 ${svgHeight}" role="img" aria-label="${esc(plan.title)}概念功能平面，${mw}米乘${mh}米" class="function-plan-svg"><title>${esc(plan.title)} · 功能草图</title><desc>${esc(plan.description)}。1 标准单元为 3 米乘 3 米，北侧窗、东侧入口为独立模块示意。</desc><style>.function-plan-svg{font-family:'Wish Pixel','Microsoft YaHei',sans-serif;background:${colors.bg};color:${colors.text}}.function-plan-svg text{fill:${colors.text}}.function-plan-svg .fp-caption,.function-plan-svg .fp-dimension{font-size:11px;fill:${colors.faint}}.function-plan-svg .fp-dimension-lines{fill:none;stroke:${colors.faint};stroke-width:.8}.function-plan-svg .fp-grid{fill:none;stroke:${colors.line};stroke-width:.7}.function-plan-svg .fp-furniture{fill:${colors.furniture};stroke:${colors.faint};stroke-width:1}.function-plan-svg .fp-furniture text{stroke:${colors.furniture};stroke-width:3;paint-order:stroke;fill:${colors.text}}.function-plan-svg .fp-detail{fill:none}.function-plan-svg .fp-soft{fill:${colors.line}}.function-plan-svg .fp-clearance{fill:none;stroke:${colors.accent};stroke-width:.7;stroke-dasharray:3 4;opacity:.38}.function-plan-svg .fp-use-zone{fill:#7697af14;stroke:#7697af;stroke-width:.8;stroke-dasharray:4 3;pointer-events:visiblePainted}.function-plan-svg .fp-gap{stroke:${colors.fill};stroke-width:7}.function-plan-svg .fp-window{fill:none;stroke:${colors.window};stroke-width:1.4}.function-plan-svg .fp-door,.function-plan-svg .fp-entry-arrow{fill:none;stroke:${colors.accent};stroke-width:1.5}.function-plan-svg .fp-door-arc{fill:none;stroke:${colors.faint};stroke-width:.8;stroke-dasharray:3 3}</style><rect width="640" height="${svgHeight}" fill="${colors.bg}"/><text x="34" y="34" font-size="10" letter-spacing="2" style="fill:${colors.accent}">WISHOUSE / FUNCTION ATLAS</text><text x="34" y="66" font-size="23">${esc(title)}</text><text x="34" y="88" class="fp-caption">${plan.widthUnits} × ${plan.heightUnits} 标准单元　·　${n(mw * mh)} m²　·　概念草图</text><path d="M34 104H606" stroke="${colors.line}"/><g transform="translate(587 141)"><path d="M0 20V0m-5 7 5-7 5 7" fill="none" stroke="${colors.accent}" stroke-width="1.3"/><text y="-7" text-anchor="middle" font-size="12" style="fill:${colors.accent}">北 N</text></g>${dimensions}<g transform="translate(${n(left)} ${n(top)})"><rect width="${n(width)}" height="${n(height)}" fill="${colors.fill}" stroke="${colors.accent}" stroke-width="4"/><g class="fp-grid">${grid}</g>${clearance}${useZones}${items}${window}${door}</g><path d="M34 477H606" stroke="${colors.line}"/><path d="M34 503H104M34 499V507M104 499V507" stroke="${colors.accent}" stroke-width="1.2"/><text x="69" y="521" text-anchor="middle" class="fp-caption">${n(70 / scale)} m</text><text x="125" y="504" class="fp-caption">标准单元 3 × 3 m</text><text x="606" y="503" text-anchor="end" class="fp-caption">虚线为使用空间 · 东侧 0.9 m 门</text><text x="606" y="521" text-anchor="end" class="fp-caption">${plan.furniture.length} 项已画出 · ${plan.unplaced.length} 项未放下 · ${plan.checks.length} 项待核对</text>${warningMarkup}</svg>`;
  }

  return Object.freeze({ UNIT_METERS, MAX_PLANS, KINDS, ENTRY_CLEARANCE, entryClearance, normalizePlan, normalizeLibrary, mergeLibrary, cleanSketch: normalizePlan, cleanLibrary: normalizeLibrary, renderSvg, intersects });
});

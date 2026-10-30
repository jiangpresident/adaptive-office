(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishFurnitureRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const SOURCES = Object.freeze({
    gamingDesk: 'https://www.ikea.com/nl/en/p/huvudspelare-gaming-desk-black-90539166/',
    sofa: 'https://www.ikea.com/in/en/files/pdf/25/a4/25a44ca0/kivik.pdf',
    dining: 'https://www.ikea.com/nl/en/rooms/dining/how-to/arranging-your-dining-area-our-best-tips-pxmeb38104000c511ec8c6a55a63e883f13/',
    kitchen: 'https://www.ikea.com/th/th/files/pdf/fb/fa/fbfabb30/th22-your_new_ikea_kitchen.pdf',
    coffee: 'https://www.ikea.com.tr/en/ideas/how-should-the-size-and-height-of-the-coffee-table-be',
    familyDining: 'https://www.ikea.com/gb/en/p/skalsta-table-and-4-chairs-oak-effect-straight-light-grey-beige-plastic-beige-tubular-metal-light-grey-beige-s79608986/'
  });
  const DEFAULTS = Object.freeze({ mainRouteM: .9, deskFrontM: .9, bedSideM: .6, bedFootM: .6, cabinetFrontM: .8, kitchenWorkM: 1.2, diningSeatM: .8, sofaCoffeeM: .45 });
  const profile = (label, widthM, depthM, minWidthM, minDepthM, frontM = 0, sideM = 0, backM = 0, source = '') => Object.freeze({ label, widthM, depthM, minWidthM, minDepthM, frontM, sideM, backM, source: source || '项目家具与使用空间默认值；不是法定净宽或产品承诺。' });
  const PROFILES = Object.freeze({
    gamingDesk: profile('游戏电脑桌', 1.4, .8, 1.2, .6, .9, 0, 0, SOURCES.gamingDesk),
    desk: profile('书桌', 1.2, .6, 1, .5, .9),
    chair: profile('座椅', .65, .65, .45, .45, .6),
    doubleBed: profile('双人床（含床架）', 1.6, 2.1, 1.55, 2.05, .6, .6),
    singleBed: profile('单人床（含床架）', 1, 2.1, .95, 2.05, .6, .6),
    largeBed: profile('大双人床（含床架）', 1.9, 2.1, 1.85, 2.05, .6, .6),
    sofa: profile('双人沙发', 1.9, .95, 1.4, .8, .45, 0, 0, SOURCES.sofa),
    largeSofa: profile('三人沙发', 2.28, .95, 2, .8, .45, 0, 0, SOURCES.sofa),
    storage: profile('储物柜', 1.2, .6, .4, .35, .8),
    coffeeTable: profile('茶几', 1, .6, .5, .4, 0, 0, 0, SOURCES.coffee),
    diningTable: profile('餐桌', 1.2, .8, .8, .6, .8, .8, .8, SOURCES.dining),
    familyDiningTable: profile('四人餐桌', 1.4, .8, 1.2, .75, .8, .8, .8, SOURCES.familyDining),
    diningChair: profile('餐椅', .5, .55, .45, .45, .6),
    armchair: profile('休闲扶手椅', .8, .85, .7, .75, .6),
    kitchenCounter: profile('厨房操作台', 1.2, .6, .6, .6, 1.2, 0, 0, SOURCES.kitchen),
    kitchenIsland: profile('备餐岛台', 1.2, .6, 1.2, .6, 1.2, .6, .9),
    kitchenSink: profile('水槽台', .8, .6, .6, .6, 1.2, 0, 0, SOURCES.kitchen),
    stove: profile('灶台', .6, .6, .6, .6, 1.2, 0, 0, SOURCES.kitchen),
    washbasin: profile('洗手盆', .45, .35, .4, .3, .6),
    toilet: profile('坐便器', .4, .7, .35, .65, .6, .2),
    shower: profile('淋浴区', .9, .9, .8, .8, .6),
    plant: profile('盆栽', .4, .4, .2, .2),
    tv: profile('电视柜', 1.2, .35, .6, .25, .4)
  });
  const SIDES = ['north', 'east', 'south', 'west'];
  const round = value => Math.abs(value) < 1e10 ? Math.round(value * 10000) / 10000 : value;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const text = (value, max = 100) => typeof value === 'string' ? [...value.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, max).join('') : '';
  function infer(item) {
    if (item.profile === 'unknown') return 'unknown';
    if (Object.hasOwn(PROFILES, item.profile)) return item.profile;
    const kind = item.kind || item.type || '', label = text(item.label || item.name).toLowerCase();
    // A generic model type is not evidence that a specialist workstation has
    // the footprint or operating space of a normal desk or dining table.
    if (/陶艺|木工|手工|工艺|实验|健身|训练器械|workbench|pottery|laboratory/.test(label) ||
        (kind === 'table' && /工作台|工作桌/.test(label) && !/餐桌|饭桌|dining/.test(label))) return 'unknown';
    if (kind === 'bed') return /单人|儿童|single/.test(label) ? 'singleBed' : /大床|特大|1[.·]8|king/.test(label) ? 'largeBed' : 'doubleBed';
    if (kind === 'desk') return /游戏|电竞|开黑|gaming/.test(label) ? 'gamingDesk' : 'desk';
    if (kind === 'sofa') return /三人|3人|大沙发|large/.test(label) ? 'largeSofa' : 'sofa';
    if (kind === 'table') return /茶|咖啡|coffee/.test(label) ? 'coffeeTable' : 'diningTable';
    if (Object.hasOwn(PROFILES, kind)) return kind;
    return ({ wardrobe: 'storage', counter: 'kitchenCounter', sink: 'kitchenSink', outdoorchair: 'chair' })[kind] || 'unknown';
  }
  function resolve(input = {}) {
    const item = input || {}, key = infer(item), known = PROFILES[key], adjustments = [];
    function size(name, defaultValue, minimum) {
      const value = item[name];
      if (value === undefined || value === null) return defaultValue;
      if (finite(value) && value >= minimum) return round(value);
      adjustments.push(finite(value) ? `${name === 'widthM' ? '宽度' : '深度'}未达到${minimum} m的项目家具下限，采用${defaultValue} m默认值。` : `${name === 'widthM' ? '宽度' : '深度'}不是有效米制尺寸，暂按${defaultValue} m示意，等待确认。`);
      return defaultValue;
    }
    const widthM = size('widthM', known ? known.widthM : .8, known ? known.minWidthM : .1);
    const depthM = size('depthM', known ? known.depthM : .6, known ? known.minDepthM : .1);
    return { profile: key, label: text(item.label, 60) || (known ? known.label : '待确认设施'), widthM, depthM,
      frontM: known ? known.frontM : 0, sideM: known ? known.sideM : 0, backM: known ? known.backM : 0,
      wallSide: key === 'singleBed' && SIDES.includes(item.wallSide) && [1,3].includes((SIDES.indexOf(item.wallSide)-SIDES.indexOf(item.side)+4)%4) ? item.wallSide : undefined,
      verified: !!known, side: SIDES.includes(item.side) ? item.side : 'north', source: known ? known.source : '尺寸与使用空间需要用户或产品资料确认。', adjustments };
  }
  function footprint(item) {
    const spec = resolve(item), turn = spec.side === 'east' || spec.side === 'west';
    return { w: turn ? spec.depthM : spec.widthM, h: turn ? spec.widthM : spec.depthM };
  }
  function zones(item, rect) {
    const s = resolve(item), { x, y, w, h } = rect, result = [];
    if (['chair', 'diningChair'].includes(s.profile) && item.paired === true) return result;
    function add(side, depth, kind, label) {
      if (!(depth > 0) || side === s.wallSide) return;
      const zone = side === 'north' ? { x, y: y - depth, w, h: depth } : side === 'south' ? { x, y: y + h, w, h: depth } : side === 'west' ? { x: x - depth, y, w: depth, h } : { x: x + w, y, w: depth, h };
      result.push({ ...Object.fromEntries(Object.entries(zone).map(([key, value]) => [key, round(value)])), kind, side, label: `${s.label} · ${label}`, requiredM: depth, profile: s.profile });
    }
    const back = SIDES.indexOf(s.side), front = SIDES[(back + 2) % 4];
    add(front, s.frontM, 'front', s.profile === 'desk' || s.profile === 'gamingDesk' ? '座椅与拉出空间' : '前方使用空间');
    add(SIDES[(back + 1) % 4], s.sideM, 'side', '侧方使用空间');
    add(SIDES[(back + 3) % 4], s.sideM, 'side', '侧方使用空间');
    add(s.side, s.backM, 'back', '后方使用空间');
    return result;
  }
  function intersects(a, b) { return a.x < b.x + b.w - .0001 && a.x + a.w > b.x + .0001 && a.y < b.y + b.h - .0001 && a.y + a.h > b.y + .0001; }
  function contains(outer, inner) { return inner.x >= outer.x - .0001 && inner.y >= outer.y - .0001 && inner.x + inner.w <= outer.x + outer.w + .0001 && inner.y + inner.h <= outer.y + outer.h + .0001; }
  function mayShareUseZone(owner, occupant, zone) {
    const a = resolve(owner), b = resolve(occupant);
    if (owner.groupId && occupant.groupId && owner.groupId !== occupant.groupId) return false;
    const familySeat = a.profile === 'familyDiningTable' || b.profile === 'familyDiningTable' || a.profile === 'diningChair' || b.profile === 'diningChair';
    if (familySeat && (!owner.groupId || !occupant.groupId || owner.groupId !== occupant.groupId)) return false;
    if (['chair', 'diningChair'].includes(b.profile) && ((zone.kind === 'front' && ['desk', 'gamingDesk'].includes(a.profile)) || ['diningTable', 'familyDiningTable'].includes(a.profile))) return contains(zone, occupant);
    if (['chair', 'diningChair'].includes(a.profile) && ['desk', 'gamingDesk', 'diningTable', 'familyDiningTable'].includes(b.profile)) {
      return zones(occupant, occupant).some(use => (['diningTable', 'familyDiningTable'].includes(b.profile) || use.kind === 'front') && contains(use, owner));
    }
    return false;
  }
  function audit(items, widthM, heightM, options = {}) {
    const checks = [], unplaced = [], needsConfirmation = [], bounds = { x: 0, y: 0, w: widthM, h: heightM };
    const rows = (items || []).map((item, index) => ({ ...item, _index: index, _spec: resolve(item) }));
    rows.forEach(row => {
      if (['chair', 'diningChair'].includes(row._spec.profile)) row.paired = rows.some(other => other !== row && zones(other, other).some(zone => mayShareUseZone(other, row, zone)));
    });
    function check(code, row, reason, opts) {
      const value = { code, label: row._spec.label, reason, options: opts || ['减少设施数量', '增大模块', '换一种布置'] };
      if (!checks.some(old => old.code === code && old.label === value.label && old.reason === reason)) checks.push(value);
      return value;
    }
    for (const row of rows) {
      if (!['x', 'y', 'w', 'h'].every(key => finite(row[key])) || row.w <= 0 || row.h <= 0 || !contains(bounds, row)) {
        unplaced.push(check('outside-room', row, '家具完整外轮廓超出房间，不能通过缩小图形表示放得下。'));
        continue;
      }
      if(row._spec.wallSide){const side=row._spec.wallSide,gap=side==='north'?row.y:side==='south'?heightM-row.y-row.h:side==='west'?row.x:widthM-row.x-row.w;if(Math.abs(gap)>.001)unplaced.push(check('invalid-wall-side',row,'单人床免留通道的一侧必须确实贴墙。'));}
      if (!row._spec.verified) needsConfirmation.push(check('dimensions-unconfirmed', row, `暂按${row._spec.widthM} × ${row._spec.depthM} m示意，设备型号、真实外形与使用空间需要确认。`, ['提供设备型号或外形尺寸', '先保留位置再细化']));
      if (['chair', 'diningChair'].includes(row._spec.profile) && row.groupId && !row.paired) unplaced.push(check('station-mismatch', row, '座椅没有位于对应桌子的座椅使用区内，不能算作可用座位。', ['把椅子移回对应桌前', '调整桌椅位置', '减少座位数量']));
      const warnings = [...new Set([...(row.sizeWarnings || []), ...row._spec.adjustments])];
      for (const reason of warnings) needsConfirmation.push(check('size-adjusted', row, reason, ['确认默认尺寸', '提供可核对的家具尺寸']));
      for (const other of rows) if (other._index > row._index && intersects(row, other)) unplaced.push(check('furniture-overlap', row, `与「${other._spec.label}」的家具外轮廓重叠。`));
      for (const obstacle of options.obstacles || []) if (intersects(row, obstacle)) unplaced.push(check('entry-blocked', row, `占用了${obstacle.label || '入口或通行保留区'}。`));
      for (const zone of zones(row, row)) {
        if (!contains(bounds, zone)) unplaced.push(check('use-space-outside', row, `${zone.label}需要${zone.requiredM} m，当前贴近墙边，使用空间放不下。`, ['移动或转向家具', '减少设施数量', '增大模块']));
        for (const other of rows) if (other._index !== row._index && intersects(zone, other) && !mayShareUseZone(row, other, zone)) {
          unplaced.push(check('use-space-blocked', row, `${zone.label}需要${zone.requiredM} m，被「${other._spec.label}」占用。`));
        }
      }
    }
    return { status: unplaced.length ? 'needs-adjustment' : needsConfirmation.length ? 'needs-confirmation' : 'fits', checks, unplaced, needsConfirmation };
  }
  return Object.freeze({ VERSION, PROFILES, catalog: PROFILES, SOURCES, DEFAULTS, SIDES, resolve, footprint, zones, intersects, contains, mayShareUseZone, audit });
});

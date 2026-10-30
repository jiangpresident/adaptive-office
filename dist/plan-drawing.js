(function (root, factory) {
  const engine = typeof module === 'object' && module.exports ? require('./engine.js') : root.WishEngine;
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishPlanDrawing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';
  const STYLES = `.plan-furniture{stroke:#84917b;stroke-width:.7;fill:#ffffff65;pointer-events:none}.plan-furniture.custom-furniture{pointer-events:visiblePainted}.plan-furniture .detail{fill:none}.plan-furniture .soft{fill:#a7b69b35}.plan-furniture .furniture-label{fill:#4c5c42;stroke:#f8faf4;stroke-width:1.5;paint-order:stroke;pointer-events:none}.plan-openings{pointer-events:none}.opening-gap{stroke:#f8faf4;stroke-width:3.2;stroke-linecap:butt}.door-leaf{stroke:#73836a;stroke-width:1;fill:none}.door-swing{stroke:#9daa8d;stroke-width:.65;fill:none;stroke-dasharray:2 1}.window-line{stroke:#759eaa;stroke-width:1;fill:none}.entry-zone{pointer-events:none}.entry-zone rect{fill:url(#entryHatch);stroke:#b5a276;stroke-width:.65;stroke-dasharray:3 2}.entry-zone text{font-size:6px;fill:#9b865c}.entry-arrow{stroke:#a18b5c;stroke-width:1;fill:none}.room-label,.room-area{pointer-events:none}`;
  const DEFS = '<defs><pattern id="moduleGrid" width="90" height="90" patternUnits="userSpaceOnUse"><path d="M45 0V90M0 45H90" fill="none" stroke="#91a17b" stroke-width=".4" opacity=".45"/><path d="M90 0H0V90" fill="none" stroke="#91a17b" stroke-width=".7"/></pattern><pattern id="entryHatch" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M-1 1L1-1M0 7L7 0M6 8L8 6" stroke="#c7b98d" stroke-width=".5" opacity=".45"/></pattern></defs>';
  function glyph(type, w, h) {
    if (w < 5 || h < 5) return `<rect width="${Math.max(0, w)}" height="${Math.max(0, h)}"/>`;
    const rect = `<rect x=".4" y=".4" width="${Math.max(0, w - .8)}" height="${Math.max(0, h - .8)}" rx="1.3"/>`;
    if(type==='foldingDesk')return rect+`<path class="detail" stroke-dasharray="2 1" d="M1 ${h*.2}H${w-1}"/><path class="detail" d="M${w*.15} 1V${h*.25}M${w*.85} 1V${h*.25}"/>`;
    if(type==='singleBed')return rect+`<rect class="soft" x="2" y="2" width="${w-4}" height="${h*.22}" rx="1"/><path class="detail" d="M1 ${h*.3}H${w-1}M1 ${h*.37}H${w-1}"/>`;
    if (type === 'bed') return rect + `<rect class="soft" x="2" y="2" width="${w - 4}" height="${h * .22}" rx="1"/><path class="detail" d="M1 ${h * .3}H${w - 1}M1 ${h * .37}H${w - 1}M${w / 2} 3v${h * .16}"/>`;
    if (type === 'sofa' || type === 'largeSofa') {
      const dividers = (type === 'largeSofa' ? [1 / 3, 2 / 3] : [.5]).map(fraction => `M${3 + (w - 6) * fraction} 4V${h - 2}`).join('');
      return rect + `<path class="detail" d="M3 ${h - 1}V4H${w - 3}V${h - 1}${dividers}"/>`;
    }
    if (type === 'armchair') return rect + `<rect class="soft" x="${w * .19}" y="${h * .23}" width="${w * .62}" height="${h * .66}" rx="1.2"/><path class="detail" d="M${w * .12} ${h * .88}V${h * .17}H${w * .88}V${h * .88}M${w * .2} ${h * .34}H${w * .8}"/>`;
    if (type === 'wardrobe' || type === 'storage') return rect + `<path class="detail" d="M${w / 2} 0V${h}M${w / 2 - 2} ${h * .35}v${h * .3}M${w / 2 + 2} ${h * .35}v${h * .3}"/>`;
    if (type === 'desk') return rect + `<rect class="soft" x="${w * .34}" y="2" width="${w * .38}" height="${h * .35}" rx=".5"/><path class="detail" d="M${w * .2} ${h * .7}H${w * .7}"/>`;
    if (type === 'tv') return rect + `<path class="detail" d="M${w * .15} ${h / 2}H${w * .85}"/>`;
    if (type === 'table') return rect + `<circle class="soft" cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * .17}"/>`;
    if (type === 'diningTable') return rect + [.28, .72].flatMap(x => [.28, .72].map(y => `<circle class="detail" cx="${w * x}" cy="${h * y}" r="${Math.min(w, h) * .12}"/>`)).join('');
    if (type === 'kitchenIsland') return rect + `<rect class="detail" x="1.5" y="1.5" width="${w - 3}" height="${h - 3}"/><text x="${w/2}" y="${h/2 + 1}" text-anchor="middle" stroke="none" fill="#59694c" font-size="3.4">岛台</text>`;
    if ((type === 'sink' || type === 'washbasin')) return rect + `<rect class="detail" x="2" y="2" width="${w - 4}" height="${h - 4}" rx="1"/><path class="detail" d="M${w / 2} 0v${h / 2}h2"/>`;
    if (type === 'stove') return rect + [ .3, .7 ].flatMap(x => [ .3, .7 ].map(y => `<circle class="detail" cx="${w * x}" cy="${h * y}" r="${Math.min(w, h) * .13}"/>`)).join('');
    if (type === 'plant') return `<ellipse class="soft" cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - .5}" ry="${h / 2 - .5}"/><path class="detail" d="M${w * .2} ${h / 2}H${w * .8}M${w / 2} ${h * .2}V${h * .8}"/>`;
    if (type === 'outdoorchair') return rect + `<path class="detail" d="M2 3H${w - 2}M2 ${h * .4}H${w - 2}M2 ${h * .7}H${w - 2}"/>`;
    if (type === 'chair') return rect + `<path class="detail" d="M${w * .15} ${h * .3}H${w * .85}M${w * .15} ${h * .3}V${h * .8}M${w * .85} ${h * .3}V${h * .8}"/>`;
    if (type === 'diningChair') return `<rect class="soft" x="${w * .1}" y="${h * .22}" width="${w * .8}" height="${h * .7}" rx="1"/><rect x=".4" y=".4" width="${w - .8}" height="${h * .21}" rx=".7"/><path class="detail" d="M${w * .12} ${h * .8}V${h - .3}M${w * .88} ${h * .8}V${h - .3}"/>`;
    if (type === 'toilet') return `<rect x="${w * .2}" y=".4" width="${w * .6}" height="${h * .25}" rx="1"/><ellipse cx="${w / 2}" cy="${h * .62}" rx="${w * .33}" ry="${h * .34}"/>`;
    if (type === 'shower') return rect + `<path class="detail" d="M.4 .4L${w - .4} ${h - .4}M${w - .4} .4L.4 ${h - .4}"/><circle class="detail" cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * .08}"/>`;
    if (type === 'equipment') return rect + `<path class="detail" d="M${w * .16} ${h * .16}H${w * .84}V${h * .84}H${w * .16}Z"/>`;
    if (type === 'fixture') return rect + `<path class="detail" d="M${w * .16} ${h * .18}H${w * .84}M${w * .16} ${h * .82}H${w * .84}"/>`;
    if (type === 'generic') return rect;
    return rect + `<path class="detail" d="M${w / 2} 0V${h}"/>`;
  }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function furniture(detail, grid, options = {}) {
    return (detail?.compactStates?.[options.state]?.furniture || detail?.furniture || []).filter(item => ['x', 'y', 'w', 'h'].every(key => Number.isFinite(item[key])) && item.w > 0 && item.h > 0).map(item => {
      const w = item.w * grid, h = item.h * grid, r = [0, 90, 180, 270].includes(item.rotation) ? item.rotation : 0;
      const bw = r % 180 ? h : w, bh = r % 180 ? w : h;
      const t = r === 90 ? `translate(${w} 0) rotate(90)` : r === 180 ? `translate(${w} ${h}) rotate(180)` : r === 270 ? `translate(0 ${h}) rotate(270)` : '';
      const label = typeof item.label === 'string' ? [...item.label].slice(0, 60).join('') : '';
      const shortLabel = [...label].slice(0, 6).join('');
      const fontSize = Math.min(4.2, w / Math.max(2, [...shortLabel].length) * .85, h / 3);
      const text = (item.custom || item.foldable && item.type==='desk') && label && fontSize >= 2.6 ? `<text class="furniture-label" x="${w / 2}" y="${h * .66}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}">${esc(shortLabel)}</text>` : '';
      const dimensions = Number.isFinite(item.widthM) && Number.isFinite(item.depthM) ? ` · ${item.widthM} × ${item.depthM} m` : '';
      const glyphType = item.profile==='singleBed' ? 'singleBed' : item.foldable && item.type==='desk' ? 'foldingDesk' : item.profile === 'familyDiningTable' ? 'diningTable' : item.profile === 'diningChair' ? 'diningChair' : item.profile === 'armchair' ? 'armchair' : item.profile === 'largeSofa' ? 'largeSofa' : item.type;
      return `<g class="plan-furniture${item.custom ? ' custom-furniture' : ''}" data-furniture="${esc(item.type)}" data-profile="${esc(item.profile || '')}" data-facing="${r}"${item.groupId ? ` data-seating-group="${esc(item.groupId)}"` : ''}${dimensions ? ` data-width-m="${item.widthM}" data-depth-m="${item.depthM}"` : ''}${label ? ` aria-label="${esc(label + dimensions)}"` : ''} transform="translate(${item.x * grid} ${item.y * grid})">${label ? `<title>${esc(label + dimensions)}</title>` : ''}<g transform="${t}">${glyph(glyphType, bw, bh)}</g>${text}</g>`;
    }).join('');
  }
  function useZones(detail, grid) {
    return `<g class="plan-use-zones" aria-label="家具使用净空">${(detail?.useZones || []).filter(zone => ['x', 'y', 'w', 'h', 'requiredM'].every(key => Number.isFinite(zone[key])) && zone.w > 0 && zone.h > 0).map(zone => {
      const w = zone.w * grid, h = zone.h * grid;
      const label = `${zone.label || '家具使用空间'} · ${zone.requiredM} m`;
      const text = Math.min(w, h) >= 9 ? `<text x="${w / 2}" y="${h / 2}" dominant-baseline="middle" text-anchor="middle">${zone.requiredM} m</text>` : '';
      return `<g class="plan-use-zone" data-use-kind="${esc(zone.kind || 'front')}" data-required-m="${zone.requiredM}" transform="translate(${zone.x * grid} ${zone.y * grid})"><title>${esc(label)}</title><rect width="${w}" height="${h}"/>${text}</g>`;
    }).join('')}</g>`;
  }
  const USE_STYLES = '.plan-use-zones{pointer-events:none}.plan-use-zone rect{fill:#aa9ac00d;stroke:#9680a8;stroke-width:.5;stroke-dasharray:2 2}.plan-use-zone text{font-size:4.2px;fill:#7a6689;stroke:#f8faf4;stroke-width:1;paint-order:stroke}';
  function lineFor(room, item, grid) {
    const side = item.side, s = item.start * grid, n = item.width * grid;
    const x = side === 'east' ? room.w * grid : side === 'west' ? 0 : s;
    const y = side === 'south' ? room.h * grid : side === 'north' ? 0 : s;
    const dx = side === 'north' || side === 'south' ? 1 : 0, dy = 1 - dx;
    const ix = side === 'east' ? -1 : side === 'west' ? 1 : 0;
    const iy = side === 'north' ? 1 : side === 'south' ? -1 : 0;
    return { x, y, n, dx, dy, ix, iy, x2: x + dx * n, y2: y + dy * n };
  }
  function openings(room, detail, rooms, grid) {
    const rank = type => ['bedroom','bedroomSingle'].includes(type) ? 3 : type === 'kitchen' ? 2 : type.startsWith('living') ? 1 : 0;
    let markup = (detail?.windows || []).map(window => {
      const p = lineFor(room, window, grid);
      return `<g data-window-side="${window.side}"><path class="opening-gap" d="M${p.x} ${p.y}L${p.x2} ${p.y2}"/><path class="window-line" d="M${p.x + p.ix} ${p.y + p.iy}L${p.x2 + p.ix} ${p.y2 + p.iy}M${p.x - p.ix} ${p.y - p.iy}L${p.x2 - p.ix} ${p.y2 - p.iy}M${p.x - p.ix * 2} ${p.y - p.iy * 2}l${p.ix * 4} ${p.iy * 4}M${p.x2 - p.ix * 2} ${p.y2 - p.iy * 2}l${p.ix * 4} ${p.iy * 4}"/></g>`;
    }).join('');
    markup += (detail?.doors || []).map(door => {
      const p = lineFor(room, door, grid), other = rooms.find(r => r.id === door.to);
      if(door.hingeEnd){const x=p.x,y=p.y;p.x=p.x2;p.y=p.y2;p.x2=x;p.y2=y;p.dx=-p.dx;p.dy=-p.dy;}
      const swing = door.drawSwing !== undefined ? door.drawSwing : !other || rank(room.type) > rank(other.type) || (rank(room.type) === rank(other.type) && room.id < other.id);
      let d = `${door.glazed?'<title>通向花园的玻璃移门 · '+(door.width*.3).toFixed(1)+' m</title>':''}<path class="opening-gap" d="M${p.x} ${p.y}L${p.x2} ${p.y2}"/>`;
      if (door.kind === 'outdoor' || door.kind === 'sliding') d += `<path class="door-leaf" d="M${p.x + p.ix} ${p.y + p.iy}l${p.dx * p.n * .62} ${p.dy * p.n * .62}M${p.x2 - p.ix} ${p.y2 - p.iy}l${-p.dx * p.n * .62} ${-p.dy * p.n * .62}"/>`;
      else if (swing) d += `<path class="door-leaf" d="M${p.x} ${p.y}l${p.ix * p.n} ${p.iy * p.n}"/><path class="door-swing" d="M${p.x2} ${p.y2}A${p.n} ${p.n} 0 0 ${p.dx * p.iy - p.dy * p.ix > 0 ? 1 : 0} ${p.x + p.ix * p.n} ${p.y + p.iy * p.n}"/>`;
      return `<g data-door-kind="${door.kind}" data-door-side="${door.side}">${d}</g>`;
    }).join('');
    return `<g class="plan-openings" data-openings-for="${room.id}" transform="translate(${room.x * grid} ${room.y * grid})">${markup}</g>`;
  }
  function entrances(zones, grid, byRoom = {}) {
    return zones.map(zone => {
      const w = zone.w * grid, h = zone.h * grid;
      const names = { north: '北', east: '东', south: '南', west: '西' };
      const side = names[zone.side] ? zone.side : 'east', horizontal = side === 'north' || side === 'south';
      const door = byRoom[zone.roomId]?.doors?.find(item => item.kind === 'entry' && item.side === side);
      const along = door ? (door.start + door.width / 2) * grid : (horizontal ? w : h) / 2;
      const inward = { north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] }[side];
      const depth = horizontal ? h : w;
      const start = horizontal ? [along, h * .5] : [w * .5, along];
      const tip = [start[0] + inward[0] * depth * .32, start[1] + inward[1] * depth * .32];
      const head = Math.min(3, depth * .1);
      const wingA = [tip[0] - inward[0] * head - inward[1] * head, tip[1] - inward[1] * head + inward[0] * head];
      const wingB = [tip[0] - inward[0] * head + inward[1] * head, tip[1] - inward[1] * head - inward[0] * head];
      const tx = horizontal ? w / 2 : w * (side === 'east' ? .78 : .22);
      const ty = horizontal ? h * (side === 'south' ? .78 : .22) : h / 2;
      const label = `${names[side]}侧主入口 · 禁止拼接`;
      const textLength = Math.min((horizontal ? w : h) - 8, label.length * 6);
      const textRotation = horizontal ? '' : ` transform="rotate(${side === 'east' ? 90 : -90} ${tx} ${ty})"`;
      const clearanceMeters = Number(((horizontal ? zone.h : zone.w) * E.CELL_METERS).toFixed(2));
      return `<g class="entry-zone" data-entry-for="${zone.roomId}" data-entry-side="${side}" transform="translate(${zone.x * grid} ${zone.y * grid})" aria-label="客厅${names[side]}侧主入口，${clearanceMeters}米禁止拼接区"><rect width="${w}" height="${h}"/><path class="entry-arrow" d="M${start[0]} ${start[1]}L${tip[0]} ${tip[1]}M${wingA[0]} ${wingA[1]}L${tip[0]} ${tip[1]}L${wingB[0]} ${wingB[1]}"/><text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" textLength="${Math.max(1, textLength)}" lengthAdjust="spacingAndGlyphs"${textRotation}>${label}</text></g>`;
    }).join('');
  }
  function labelPosition(room, detail, width, height) {
    const obstacles = [...(detail?.furniture || []), ...(detail?.doors || []).map(d => d.clearance).filter(Boolean)];
    let best = { x: room.w / 2, y: room.h / 2, score: Infinity };
    for (let y = height / 2 + .2; y <= room.h - height / 2 - .2; y += .25) {
      for (let x = width / 2 + .2; x <= room.w - width / 2 - .2; x += .25) {
        const area = obstacles.reduce((sum, o) => sum + Math.max(0, Math.min(x + width / 2, o.x + o.w) - Math.max(x - width / 2, o.x)) * Math.max(0, Math.min(y + height / 2, o.y + o.h) - Math.max(y - height / 2, o.y)), 0);
        const score = area * 100 + Math.hypot(x - room.w / 2, y - room.h / 2);
        if (score < best.score) best = { x, y, score };
      }
    }
    return best;
  }
  function accessRoutes(detail, grid) {
    return (detail?.accessibility?.targets || []).filter(target => target.reachable && target.path?.length > 1).map(target => {
      const points = target.path.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (points.length !== target.path.length) return '';
      const end = points.at(-1);
      return `<g class="access-route"><title>${esc(target.label)} · 从门口可走到</title><polyline points="${points.map(point => `${point.x * grid},${point.y * grid}`).join(' ')}"/><circle cx="${end.x * grid}" cy="${end.y * grid}" r="1.5"/></g>`;
    }).join('');
  }
  return { STYLES: STYLES + USE_STYLES + '[data-door-kind=landscape] .opening-gap{stroke:#d6dfb5;stroke-width:4}.access-route{pointer-events:none;stroke:#d8f3c5;fill:none;stroke-width:.8;stroke-dasharray:2 1;opacity:.8}.access-route circle{fill:#d8f3c5;stroke:none}', DEFS, furniture, useZones, accessRoutes, openings, entrances, labelPosition };
});

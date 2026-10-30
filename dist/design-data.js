(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./conversation.js'), require('./function-plans.js'));
  else root.WishouseDesignData = factory(root.WishEngine, root.WishConversation, root.WishouseFunctionPlans);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (E, C, F) {
  'use strict';
  const LEGACY = { livingLarge: [8, 7], livingSmall: [6, 6], kitchen: [5, 4], bedroom: [6, 6], balcony: [8, 2], garden: [8, 4] };
  const DIRECTIONS = ['north', 'east', 'south', 'west'];
  const constraints = input => ({ separateKitchenBedroom: input?.separateKitchenBedroom === true, compactFootprint: input?.compactFootprint === true, gardenCourtyard: input?.gardenCourtyard === true, balconyBedroom: input?.balconyBedroom === true });
  function validLegacyFunctionPlan(input) {
    if (!input || input.furnitureRulesVersion !== undefined || typeof input.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.id) ||
        typeof input.title !== 'string' || !input.title.trim() || input.title.length > 60 || typeof input.description !== 'string' || input.description.length > 400 ||
        !Array.isArray(input.furniture) || input.furniture.length > 10 || !Array.isArray(input.notes) || input.notes.length > 4 ||
        !input.notes.every(note => typeof note === 'string' && note.length <= 160) ||
        !['createdAt', 'updatedAt'].every(key => typeof input[key] === 'string' && /^\d{4}-\d\d-\d\dT/.test(input[key]) && Number.isFinite(Date.parse(input[key]))) ||
        !['widthUnits', 'heightUnits'].every(key => Number.isFinite(input[key]) && input[key] >= .5 && input[key] <= 4 && Math.abs(input[key] * 2 - Math.round(input[key] * 2)) < .00001)) return false;
    return input.furniture.every(item => item && typeof item.label === 'string' && item.label.trim() && item.label.length <= 60 && F.KINDS.includes(item.kind) &&
      ['x', 'y', 'w', 'h'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key])) &&
      item.x >= 0 && item.y >= 0 && item.w >= .04 && item.h >= .04 && item.x + item.w <= 1.00001 && item.y + item.h <= 1.00001);
  }
  function validFunctionPlan(input) {
    // Historical snapshots used ratios. Accept their original valid data, then
    // migrate once to metres; an ergonomic correction must never reset a design.
    if (validLegacyFunctionPlan(input)) return true;
    const plan = F.normalizePlan(input);
    if (!plan || !Array.isArray(input.furniture) || !Array.isArray(input.notes)) return false;
    // Placed modules are complete snapshots, not references to the current library.
    // Reject an import that would repair or discard their content behind the user's back.
    if (['id', 'title', 'parentType', 'description', 'widthUnits', 'heightUnits', 'createdAt', 'updatedAt'].some(key => input[key] !== plan[key]) ||
        input.furniture.length !== plan.furniture.length || input.notes.length !== plan.notes.length) return false;
    return input.notes.every((note, index) => note === plan.notes[index]) && input.furniture.every((item, index) =>
      ['label', 'kind', 'x', 'y', 'w', 'h', 'profile', 'widthM', 'depthM', 'side', 'groupId'].every(key => item && item[key] === plan.furniture[index][key])) &&
      input.furnitureRulesVersion === plan.furnitureRulesVersion && JSON.stringify(input.unplaced || []) === JSON.stringify(plan.unplaced || []);
  }
  function validDesign(data) {
    if (!data || ![1, 2].includes(data.version) || (data.version === 2 && data.gridVersion !== E.GRID_VERSION) || !Array.isArray(data.rooms) || data.rooms.length > 60 || typeof data.title !== 'string' || data.title.length > 24) return false;
    const p = data.prefs;
    if(['gardenCount','balconyCount'].some(key=>p?.[key]!==undefined&&(!Number.isInteger(p[key])||p[key]<1||p[key]>8)))return false;
    if (p?.singleBedrooms!==undefined && (!Number.isInteger(p.singleBedrooms)||p.singleBedrooms<0||p.singleBedrooms>p.bedrooms))return false;
    if (!p || (p.entranceSide !== undefined && !DIRECTIONS.includes(p.entranceSide)) || !['solo', 'couple', 'family'].includes(p.household) || !DIRECTIONS.includes(p.orientation) || !['none', 'balcony', 'garden', 'both'].includes(p.outdoor) || !['large', 'small', 'medium'].includes(p.living) || !Number.isInteger(p.bedrooms) || p.bedrooms < 1 || p.bedrooms > 4) return false;
    const ids = new Set(), limit = data.version === 1 ? 140 : E.MAX_COORD;
    return data.rooms.every(room => {
      if (!room || (room.type === 'custom' ? data.version !== 2 || !validFunctionPlan(room.functionPlan) : !Object.hasOwn(E.TYPES, room.type)) || typeof room.id !== 'string' || !/^[\w-]{1,80}$/.test(room.id) || ['__proto__', 'prototype', 'constructor'].includes(room.id) || ids.has(room.id)) return false;
      ids.add(room.id);
      if(room.functionPlan && (!validFunctionPlan(room.functionPlan)||E.createCustomRoom(room.functionPlan,'validate').type!==room.type))return false;
      const definition = E.getDefinition(room);
      if (data.version === 1 && !LEGACY[room.type]) return false;
      const [w, h] = data.version === 1 ? LEGACY[room.type] : [definition.w, definition.h];
      // Grid version 2 originally shipped with a 3 x 3 m bedroom. Keep that
      // precise historical footprint readable so prepare can upgrade it while
      // retaining the complete original as a recoverable document.
      const oldBedroom = data.version === 2 && room.type === 'bedroom' && room.w === 10 && room.h === 10;
      return ['x', 'y', 'w', 'h'].every(key => Number.isInteger(room[key]) && Math.abs(room[key]) <= limit) && [0, 90, 180, 270].includes(room.rotation) &&
        (oldBedroom || (room.rotation % 180 === 0 ? room.w === w && room.h === h : room.w === h && room.h === w));
    }) && !E.validateLayout(data.rooms).overlaps.length;
  }
  function prepare(data) {
    if (!validDesign(data)) throw new TypeError('无效的愿居方案');
    const prefs = E.normalizePrefs(data.prefs), conversation = C.cleanConversation(data.conversation), last = conversation.messages.at(-1);
    const pendingChat = typeof data.pendingChat?.text === 'string' && last?.role === 'user' && last.text === data.pendingChat.text.trim().slice(0, 1200) ? { text: last.text } : null;
    const oldBedrooms = data.version === 2 && data.rooms.some(room => room.type === 'bedroom' && room.w === 10 && room.h === 10);
    const migration = data.version === 1 ? E.standardizeLayout(data.rooms, prefs.entranceSide, .6) : oldBedrooms ?
      { ...E.standardizeLayout(data.rooms, prefs.entranceSide, E.CELL_METERS), kind: 'bedroom-size' } : null;
    const rooms = migration ? migration.rooms : data.rooms;
    const design = {
      version: 2, gridVersion: E.GRID_VERSION, title: data.title.trim() || '我的向阳小屋', prefs,
      rooms: rooms.map(r => ({ id: r.id, type: r.type, x: r.x, y: r.y, w: r.w, h: r.h, rotation: r.rotation,
        ...(r.functionPlan ? { functionPlan: F.normalizePlan(r.functionPlan) } : {}) })),
      step: Math.max(0, Math.min(3, Math.floor(Number(data.step) || 0))), variant: Math.max(0, Math.min(999, Math.floor(Number(data.variant) || 0))),
      completed: !!data.completed, manual: !!data.manual, constraints: constraints(data.constraints), conversation,
      ...(data.buildingPlacement && ['W1','N1','N2','E1','S1','S2'].includes(data.buildingPlacement.lotId) &&
        [data.buildingPlacement.x, data.buildingPlacement.y].every(v => Number.isInteger(v) && Math.abs(v) <= E.MAX_COORD * 2) ?
        { buildingPlacement: { lotId: data.buildingPlacement.lotId, x: data.buildingPlacement.x, y: data.buildingPlacement.y } } : {}),
      inputMode: data.inputMode === 'guide' ? 'guide' : 'chat', chatDraft: typeof data.chatDraft === 'string' ? data.chatDraft.slice(0, 1200) : '', pendingChat,
      functionLibrary: F.normalizeLibrary(data.functionLibrary)
    };
    if (!validDesign(design)) throw new Error('标准尺寸转换未完成，原方案仍可恢复');
    return { design, migration };
  }
  return Object.freeze({ validDesign, prepare, validFunctionPlan });
}));

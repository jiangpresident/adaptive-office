(function () {
  'use strict';
  const E = window.WishEngine;
  const C = window.WishConversation;
  const B = window.WishBuilding;
  const S = window.WishPlanSync;
  const M = window.WishModuleEdits;
  const I = window.WishInterior;
  const P = window.WishCirculation;
  const D = window.WishPlanDrawing;
  const F = window.WishouseFunctionPlans;
  const R = window.WishFurnitureRules;
  const DATA = window.WishouseDesignData;
  const $ = id => document.getElementById(id);
  const GRID = 30 * E.CELL_METERS;
  const MAX_COORD = E.MAX_COORD;
  const STORAGE = 'wishouse.design.v1';
  let preferredModel = 'openai';
  try { const saved = localStorage.getItem('wishouse.model'); if (saved === 'openai') preferredModel=saved; } catch {}
  $('modelChoice').value=preferredModel;
  const DIRECTIONS = { south: '南', east: '东', west: '西', north: '北' };
  const HOUSEHOLDS = { solo: '一个人住', couple: '两个人住', family: '一家人住' };
  const OUTDOORS = { none: '专注室内', balcony: '一个阳台', garden: '一片花园', both: '阳台与花园' };
  const ICONS = {
    download: '<path d="M8 2v9m-3-3 3 3 3-3M3 12v3h10v-3"/>',
    edit: '<path d="m10 3 3 3M3 13l1-4 7-7 3 3-7 7-4 1Z"/>',
    arrowUp: '<path d="M8 13V3m-4 4 4-4 4 4"/>',
    shuffle: '<path d="M2 4h2c3 0 5 8 8 8h2m-3-3 3 3-3 3M2 12h2c1.5 0 2.5-2 4-4s2.5-4 4-4h2m-3-3 3 3-3 3"/>',
    undo: '<path d="m6 3-4 4 4 4M2 7h7a5 5 0 0 1 5 5"/>',
    redo: '<path d="m10 3 4 4-4 4m4-4H7a5 5 0 0 0-5 5"/>',
    minus: '<path d="M3 8h10"/>', plus: '<path d="M3 8h10M8 3v10"/>',
    fit: '<path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4"/>',
    move: '<path d="M8 1v14M1 8h14M5 4l3-3 3 3M5 12l3 3 3-3M4 5 1 8l3 3m8-6 3 3-3 3"/>',
    rotate: '<path d="M13 6a5.5 5.5 0 1 0 .3 5M10 6h4V2"/>',
    trash: '<path d="M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4m2-4v4"/>'
  };
  const svgIcon = name => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = svgIcon(el.dataset.icon));
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const cleanConstraints = input => ({ separateKitchenBedroom: input?.separateKitchenBedroom === true, compactFootprint: input?.compactFootprint === true, gardenCourtyard: input?.gardenCourtyard === true, balconyBedroom: input?.balconyBedroom === true });
  const freshState = () => ({ version: 2, gridVersion: E.GRID_VERSION, title: '我的向阳小屋', prefs: { ...E.DEFAULTS }, rooms: [], step: 0, variant: 0, completed: false, manual: false, constraints: cleanConstraints(), conversation: C.newSession(), inputMode: 'chat', chatDraft: '', pendingChat: null, functionLibrary: [] });
  let state = freshState(), selected = null, zoom = 1, view = 'plan', drag = null, showClearances = false;
  let history = [], future = [], toastTimer, resizeTimer, confirmAction, baseBox, showBuildingExtent = false;
  let storageWorks = true;
  let interiorPlan, entryMigration = null;
  const compactView = Object.create(null);
  const SMALL_LIVING_BACKUP = STORAGE + '.before-small-living-daylight-v1';
  const ENTRY_BACKUP = STORAGE + '.before-entry-direction-v2';
  let legacyEntryOriginal = null, conversationBackup = null;
  const MODULE_BACKUP = STORAGE + '.before-standard-modules-v2';
  const BEDROOM_BACKUP = STORAGE + '.before-bedroom-size-v1';
  const moduleBackupKey = migration => migration?.kind === 'bedroom-size' ? BEDROOM_BACKUP : MODULE_BACKUP;
  const FURNITURE_BACKUP = STORAGE + '.before-metric-furniture-v1';
  const FUNCTION_STORAGE = 'wishouse.function-library.v1';
  let moduleMigration = null, selectedFunction = null;
  const entrySide = () => B.entranceSide(state.conversation, state.prefs.entranceSide);
  const entryName = () => DIRECTIONS[entrySide()];
  const buildingPlacement = () => B.draftPlacement(B.placement(state.rooms, state.conversation, state.buildingPlacement));
  const allowedByBuilding = room => !B.violation(room, buildingPlacement()) && !B.entryViolation(room, buildingPlacement());
  const canPlace = (room, excludeId) => allowedByBuilding(room) && E.canPlace(room, state.rooms, excludeId, entrySide()) && !E.enclosedVoids(state.rooms.filter(r=>r.id!==excludeId).concat(room)).length;
  let modelState = { ready: false, checking: true, model: '', message: '正在连接GPT API…' };
  let chatFlight = null, chatError = '', chatNoticeTone = 'note', statusSequence = 0;

  const validDesign = DATA.validDesign;
  function cleanDesign(data) {
    if (data.rooms?.some(room => room.type === 'custom' && !room.functionPlan?.furnitureRulesVersion) || data.functionLibrary?.some(plan => !plan.furnitureRulesVersion)) {
      try { if (!localStorage.getItem(FURNITURE_BACKUP)) localStorage.setItem(FURNITURE_BACKUP, JSON.stringify(data)); } catch (_) { storageWorks = false; }
    }
    if (data.version === 1) {
      moduleMigration = { original: clone(data), failed: true };
      try { localStorage.setItem(MODULE_BACKUP, JSON.stringify(moduleMigration)); } catch (_) { storageWorks = false; }
    }
    const prepared = DATA.prepare(data);
    if (prepared.migration) {
      moduleMigration = { original: clone(data), count: prepared.migration.resizedIds.length, kind: prepared.migration.kind };
      try { localStorage.setItem(moduleBackupKey(moduleMigration), JSON.stringify(moduleMigration)); } catch (_) { storageWorks = false; }
    }
    return prepared.design;
  }
  // Opening the tool always begins a new, isolated wish. Old local data is
  // retained as a recovery snapshot, but never becomes the new chat's context.
  try {
    const previous = localStorage.getItem(STORAGE), library = localStorage.getItem(FUNCTION_STORAGE);
    const recoveryKey = STORAGE + '.before-blank-start-v1';
    if ((previous || library) && !localStorage.getItem(recoveryKey)) {
      localStorage.setItem(recoveryKey, JSON.stringify({ design: previous, functionLibrary: library }));
    }
  } catch (_) { /* A blank session does not depend on local storage. */ }
  function enforceEntryRule() {
    if (B.selectedLot(state.conversation)) {
      const original = clone(state);
      try {
        const synced = syncCoreEntrance();
        if (synced.movedIds.length || original.prefs.entranceSide !== synced.side) {
          entryMigration = { original, side: synced.side, count: synced.movedIds.length };
          try { localStorage.setItem(ENTRY_BACKUP, JSON.stringify(entryMigration)); } catch (_) { storageWorks = false; }
        }
      } catch (_) { entryMigration = { original, side: entrySide(), failed: true }; }
      return;
    }
    if (!E.entranceConflicts(state.rooms, entrySide()).length) { legacyEntryOriginal = null; return; }
    const original = legacyEntryOriginal || clone(state);
    legacyEntryOriginal = null;
    try {
      const repaired = E.repairEntrance(state.rooms, entrySide());
      if (E.entranceConflicts(repaired.rooms, entrySide()).length) throw new Error('No clear entry');
      state.rooms = repaired.rooms;
      state.manual = true;
      entryMigration = { original, side: entrySide(), count: repaired.movedIds.length };
      try { localStorage.setItem(ENTRY_BACKUP, JSON.stringify(entryMigration)); } catch (_) { storageWorks = false; }
    } catch (_) {
      entryMigration = { original, side: entrySide(), failed: true };
    }
  }
  function syncCoreEntrance() {
    const synced = B.syncEntrance(state.rooms, state.conversation, buildingPlacement(), state.prefs.entranceSide);
    state.rooms = synced.rooms; state.buildingPlacement = synced.placement; state.prefs.entranceSide = synced.side;
    if (synced.movedIds.length) baseBox = null;
    return synced;
  }
  state.inputMode = 'chat';
  enforceEntryRule();
  if (state.pendingChat) chatError = '上次的回答尚未完成。想法已保留，可以继续回答。';
  function dismissEntryNotice() {
    if (entryMigration) { try { localStorage.setItem(ENTRY_BACKUP, JSON.stringify({ ...entryMigration, dismissed: true })); } catch (_) {} }
    entryMigration = null;
  }
  function dismissModuleNotice() {
    if (moduleMigration) { try { localStorage.setItem(moduleBackupKey(moduleMigration), JSON.stringify({ ...moduleMigration, dismissed: true })); } catch (_) {} }
    moduleMigration = null;
  }
  function persist() {
    try { localStorage.setItem(FUNCTION_STORAGE, JSON.stringify(state.functionLibrary)); localStorage.setItem(STORAGE, JSON.stringify(state)); } catch (_) { storageWorks = false; }
    $('summaryStatus').textContent = storageWorks ? (state.manual ? '手动拼搭中' : '实时预览') : '请下载保存方案';
  }
  function notify(message) {
    $('toast').textContent = message; $('toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3300);
  }
  function commit(action, message, fit = false) {
    if (chatFlight) cancelChat('平面已更新，已停止上一轮回答。可以基于当前平面重新回答。');
    history.push(clone(state)); if (history.length > 70) history.shift(); future = [];
    action(); if (fit) { zoom = 1; baseBox = null; }
    if (!state.rooms.some(r => r.id === selected)) selected = null;
    render(); persist(); if (message) notify(message);
  }
  function undo() {
    restorePlanHistory(history, future, '已撤销平面操作，对话与需求仍保留。');
  }
  function redo() {
    restorePlanHistory(future, history, '已恢复平面操作');
  }
  function restorePlanHistory(from, to, message) {
    if (!from.length) return;
    const p = buildingPlacement();
    if (from.at(-1).rooms.some(r => B.violation(r, p) || B.entryViolation(r,p)) || E.entranceConflicts(from.at(-1).rooms,entrySide()).length) { notify('该历史拼法超出当前住户边界，未恢复。可先切回原来的住户位置。'); return; }
    if (chatFlight) cancelChat('平面已更新，可以基于当前平面重新回答。');
    to.push(clone(state));
    const retained = { functionLibrary: state.functionLibrary, conversation: state.conversation, chatDraft: state.chatDraft, pendingChat: state.pendingChat, buildingPlacement: p };
    state = Object.assign(from.pop(), retained); syncPreferences(); reconcileConstraints(); selected = null; baseBox = null; render(); persist(); notify(message);
  }
  function askReplace(title, text, action, label = '生成新平面') {
    $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmAccept').textContent = label; confirmAction = action; $('confirmDialog').showModal();
  }
  function regenerate(prefs, options = {}) {
    if (!B.preference(state.conversation)) {
      state.prefs = E.normalizePrefs({ ...state.prefs, ...prefs }); render(); persist();
      notify('先确认住户朝向，再生成平面；当前选择已保留。'); return;
    }
    const apply = () => {
      const nextPrefs = { ...state.prefs, ...prefs, entranceSide: entrySide() }, nextVariant = options.variant ?? state.variant;
      const constraints = cleanConstraints(state.constraints);
      Object.keys(constraints).forEach(key => { if (!state.conversation.requirements.some(item => item.id === key)) constraints[key] = false; });
      const rooms = rebuildRooms(nextPrefs, nextVariant, constraints);
      if (!rooms) return;
      commit(() => {
      dismissEntryNotice(); dismissModuleNotice();
      state.prefs = nextPrefs; state.variant = nextVariant; state.constraints = constraints;
      state.rooms = rooms; state.manual = false; selected = null;
      supersedeProposals();
      if (options.complete) { state.completed = true; state.step = 3; }
    }, options.message, true);
    };
    if (state.manual) askReplace('用新愿望重新拼一版？', '基础空间会按新的选择重新拼排。已加入的草图模块会保留，并调整到可连接的位置；之后可以撤销。', apply);
    else apply();
  }
  let planFailure="";
  function rebuildRooms(prefs, variant, constraints, existingRooms = state.rooms) {
    planFailure="";
    try {
      const existingAudit=S.audit(existingRooms,prefs,constraints,state.conversation,buildingPlacement(),I.analyze(existingRooms,prefs,{obstacles:B.siteObstacles(buildingPlacement())}));
      if(variant===state.variant&&existingAudit.ok)return existingRooms;
      if(variant===state.variant&&existingRooms.length){
        const edit=S.reconcile(existingRooms,prefs,constraints,state.conversation,buildingPlacement());
        if(edit.rooms)return edit.rooms;
        if(edit.applicable){
          const countChange=existingRooms.filter(E.isBedroom).length!==prefs.bedrooms||existingRooms.filter(r=>r.type==="bedroomSingle").length!==prefs.singleBedrooms||["garden","balcony"].some(t=>existingRooms.filter(r=>r.type===t).length!==E.outdoorCounts(prefs)[t]);
          const rearranged=!countChange&&constraints.gardenCourtyard&&S.compactGarden(existingRooms,prefs,state.conversation,buildingPlacement());
          if(rearranged&&S.audit(rearranged,prefs,constraints,state.conversation,buildingPlacement(),I.analyze(rearranged,prefs,{obstacles:B.siteObstacles(buildingPlacement())})).ok)return rearranged;
          planFailure=edit.reason;notify(planFailure);return null;
        }
      }
      let rooms = constraints.gardenCourtyard&&S.compactGarden(existingRooms,prefs,state.conversation,buildingPlacement()) || S.extendOutdoor(existingRooms,prefs,state.conversation,buildingPlacement()) || S.extendBedrooms(existingRooms,prefs,state.conversation,buildingPlacement()) || B.improveSmallLiving(E.rebuildLayout(prefs, variant, constraints, existingRooms), state.conversation, buildingPlacement(), prefs.entranceSide).rooms;
      if(constraints.gardenCourtyard){rooms=S.compactGarden(rooms,prefs,state.conversation,buildingPlacement());if(!rooms){notify('尚未找到既能从客厅直达花园、又保留家具通路的布局，原平面已保留。');return null;}}
      if(E.enclosedVoids(rooms).length){const fixed=E.closeVoids(rooms,prefs.entranceSide,allowedByBuilding);if(!fixed){planFailure='自动拼搭未能消除内部中空，原平面已保留。';notify(planFailure);return null;}rooms=fixed.rooms;}
      if (rooms.length > 40) { notify('保留功能模块后会超过 40 块积木，请先移除一些模块再重新拼排。'); return null; }
      const optimized=M.optimizeLayout(rooms,prefs,constraints,state.conversation,buildingPlacement());
      return optimized.ok?optimized.rooms:rooms;
    } catch (_) { notify('这次没有找到能保留全部功能模块的拼法，当前平面已保留。可以先移除一些模块。'); return null; }
  }

  function supersedeProposals() {
    state.conversation.messages.forEach(message => { if (message.proposal && !message.applied) message.superseded = true; });
  }
  function reconcileConstraints() {
    Object.keys(state.constraints).forEach(key => { if (!state.conversation.requirements.some(item => item.id === key)) state.constraints[key] = false; });
  }
  function proposalSummary(proposal) {
    if(proposal.routeRequests)return proposal.routeRequests.map(r=>{const name=id=>E.getDefinition(state.rooms.find(n=>n.id===id))?.name||id;return '前往'+name(r.roomId)+(r.avoidIds.length?'不经过'+r.avoidIds.map(name).join('、'):'')+(r.directTo?'，直接连接'+name(r.directTo):'');}).concat(['只调整位置和连接，保留房间尺寸与家具']);
    if(proposal.replaceAll)return ['从头设计：确认后整体替换旧平面','旧房间与旧需求不继承，可撤销',...(proposal.moduleEdits?[M.summary(proposal.moduleEdits)]:[proposal.prefs.bedrooms+' 间睡房'])];
    if(proposal.orientationOnly)return ['住户改为'+DIRECTIONS[proposal.orientationChange.direction]+'向','主入口与核心筒同步，可能移动模块'];
    if(proposal.moduleEdits){const cap=M.occupancyReview(state.rooms,proposal.moduleEdits,state.conversation.occupancy),o=state.conversation.occupancy;return [...(proposal.orientationChange?['住户改为'+DIRECTIONS[proposal.orientationChange.direction]+'向']:[]),M.summary(proposal.moduleEdits),...(o?['常住 '+(o.residentCount??'待确认')+' 人 + 来客 '+(o.guestCount??'待确认')+' 人',...(o.residentCount===2?[o.residentSleeping==='separate'?'常住者分房睡':o.residentSleeping==='shared'?'常住者共用睡房':'常住者分房意愿待确认']:[]),'床位容量 '+cap.before+' → '+cap.after+' 人'+(cap.shortfall?'，仍缺 '+cap.shortfall+' 人床位':'')]:[]),...M.targetChanges(state.rooms,proposal.moduleEdits).map(t=>t.label+'：原目标 '+t.value+' → 本次 '+t.actual+'（同意后更新）'),'尺寸变化时自动重拼，其余模块尺寸与内容保留'];}
    const p = proposal.prefs;
    return [HOUSEHOLDS[p.household], `${p.bedrooms} 间睡房（${p.singleBedrooms||0} 间单人小睡房）`, ({large:'大客厅 · 6 × 6 m',small:'小客厅 · 3 × 3 m',medium:'多用客厅 · 3 × 4.5 m'}[p.living]), `阳台 ${E.outdoorCounts(p).balcony} 个 · 花园 ${E.outdoorCounts(p).garden} 个`, proposal.orientationChange?`住户改为${DIRECTIONS[proposal.orientationChange.direction]}向`:B.preference(state.conversation) ? `住户朝${DIRECTIONS[B.preference(state.conversation)]}` : '朝向待确认', proposal.constraints.separateKitchenBedroom ? '厨卧不共边' : '', proposal.constraints.compactFootprint ? '尽量方正' : '', proposal.constraints.gardenCourtyard?'连续花园 · 客厅直达':'',proposal.constraints.balconyBedroom?'睡房直达阳台':''].filter(Boolean);
  }
  function publishWorkspaceState() {
    const stats = E.getStats(state.rooms);
    document.dispatchEvent(new CustomEvent('wishouse:state', { detail: {
      roomCount: state.rooms.length, bedrooms: stats.bedrooms, area: stats.interiorArea,
      requirements: state.conversation.requirements.length,
      hasMessages: state.conversation.messages.some(message => message.role === 'user')
    } }));
  }
  function renderChat(scrollToBottom = false) {
    const messages = state.conversation.messages;
    const activeProposal = [...messages].reverse().find(message => message.proposal && !message.applied && !message.superseded && !message.noChange);
    const latestAssistant = [...messages].reverse().find(message => message.role === 'assistant');
    const previousScroll = $('chatMessages').scrollTop;
    $('chatMessages').innerHTML = messages.map(message => {
      const own = message.role === 'user';
      const pending = own && message === messages.at(-1) && state.pendingChat;
      const sketches = (message.functionSketchIds || []).map(id => state.functionLibrary.find(plan => plan.id === id)).filter(Boolean);
      const choices = (message.choices || []).filter(choice => (!message.proposal || !/^(应用到平面|应用方案|确认方案|同意并执行|确认执行|立即执行|执行修改|取消修改|暂不修改|继续调整)$/.test(choice.label.trim())) && !(sketches.length && /^(查看|看看|打开).*(草图|功能库)/.test(choice.label.trim())));
      let content = `<div class="message-label">${own ? '你' : '愿居'}${pending ? `<span class="message-pending">${chatFlight ? '等待回答' : '尚未回答'}</span>` : ''}</div><div class="message-text">${esc(message.text)}</div>`;
      if (!own && choices.length && message === latestAssistant) content += `<div class="chat-choices">${choices.map(choice => `<button data-chat-prompt="${esc(choice.text)}">${esc(choice.label)}<span>↗</span></button>`).join('')}</div>`;
      if (message.proposal && message === activeProposal) content += `<div class="chat-proposal"><span class="proposal-label">待你确认 · 尚未修改平面</span><div class="proposal-chips">${proposalSummary(message.proposal).map(label => `<span>${esc(label)}</span>`).join('')}</div><button class="apply-proposal" data-apply-proposal="${esc(message.id)}">同意并执行 <span>↗</span></button><div class="chat-choices"><button data-revise-proposal="${esc(message.id)}">继续调整 ↗</button><button data-reject-proposal="${esc(message.id)}">暂不修改</button></div><small>只有点击「同意并执行」才会修改平面。尺寸变化可能需要重新拼接；执行后可以撤销。</small></div>`;
      else if (message.proposal) content += `<div class="proposal-receipt">${message.noChange?'本轮未修改平面':message.applied ? '已生成过方案 · 下方核对当前画布' : '后续修改已更新这份提案'}</div>`;
      if (message.applicationNote) content += `<div class="proposal-receipt">${esc(message.applicationNote)}</div>`;
      if (!own && message===latestAssistant && messages.some(m=>m.role==='user')) {
        const intended=activeProposal?.proposal;
        const check=S.audit(state.rooms,intended?.prefs||state.prefs,intended?.constraints||state.constraints,state.conversation,buildingPlacement(),interiorPlan,[],intended&&!intended.moduleEdits?null:state.conversation.moduleCounts);
        content += `<div class="chat-proposal plan-sync-summary"><span class="proposal-label">当前画布核对 · ${E.getStats(state.rooms).bedrooms} 间睡房</span><p>${esc(check.checks.filter(c=>['bedrooms','singleBedrooms','living','outdoor'].includes(c.id)).map(c=>(c.status==='met'?'✓ ':'未落实：')+c.detail).join('；'))}</p><small>${esc(check.checks.filter(c=>c.status!=='met').map(c=>'未落实：'+c.detail).concat(check.warnings,check.pending.length?['仍待核对：'+check.pending.join('、')]:[]).join('；')||'基础空间已核对；家具与细节以平面提示为准。')}</small></div>`;
      }
      if (sketches.length) content += `<div class="sketch-receipts">${sketches.map(plan => `<button data-open-sketch="${esc(plan.id)}"><span>⌑</span><span><b>${esc(plan.title)}</b><small>已收入功能草图库 · ${plan.widthUnits} × ${plan.heightUnits} 单元</small></span><span>查看 ↗</span></button>`).join('')}</div>`;
      return `<article class="chat-message ${own ? 'from-user' : 'from-assistant'}"><div class="chat-bubble">${content}</div></article>`;
    }).join('');
    renderOrientation();
    $('guidePanel').hidden = state.inputMode !== 'guide'; $('chatPanel').hidden = state.inputMode === 'guide';
    $('chatMessages').scrollTop = scrollToBottom ? $('chatMessages').scrollHeight : previousScroll;
    $('chatModeButton').classList.toggle('active', state.inputMode !== 'guide'); $('guideModeButton').classList.toggle('active', state.inputMode === 'guide');
    $('chatModeButton').setAttribute('aria-selected', state.inputMode !== 'guide'); $('guideModeButton').setAttribute('aria-selected', state.inputMode === 'guide');
    renderChatControls();
    publishWorkspaceState();
    if (scrollToBottom) requestAnimationFrame(() => { $('chatMessages').scrollTop = $('chatMessages').scrollHeight; });
  }
  function renderChatControls() {
    const busy = !!chatFlight;
    document.querySelectorAll("#buildingContext button, #orientationPrompt button").forEach(button => { button.disabled = busy; });
    $('conversationResetNotice').hidden = !conversationBackup;
    $('chatIsolationNotice').hidden = !state.conversation.contextScope?.isolated || state.conversation.contextScope.planShared;
    $('sharePlanWithChat').disabled = busy || !state.rooms.length;
    $('sendWishButton').disabled = busy || !modelState.ready || !$('wishInput').value.trim();
    document.querySelectorAll('[data-chat-prompt]').forEach(button => { button.disabled = busy || !modelState.ready; });
    document.querySelectorAll('[data-apply-proposal], [data-revise-proposal], [data-reject-proposal]').forEach(button => { button.disabled = busy; });
    $('wishForm').setAttribute('aria-busy', String(busy));
    $('modelStatus').dataset.state = busy ? 'working' : modelState.checking ? 'checking' : modelState.ready ? 'ready' : 'offline';
    $('modelStatusText').textContent = busy ? '正在思考' : modelState.checking ? '正在连接…' : modelState.ready ? '对话已连接' : '对话暂未连接';
    $('modelStatus').title = modelState.ready ? `${modelState.model || 'GPT'} · 通过 OpenAI API 处理` : modelState.message;
    $('modelConnectionDetail').textContent = modelState.ready ? `当前使用 ${modelState.model || 'GPT'}；聊天及所选方案上下文发送至 OpenAI，按 API 用量计费。` : modelState.message;
    $('checkModelButton').disabled = modelState.checking || busy;
    $('modelChoice').disabled = busy;
    $('collectFunctionSketches').disabled = busy || !modelState.ready || !state.conversation.messages.some(message => message.role === 'user');
    $('chatNotice').hidden = !busy && !chatError;
    if(!busy){$('chatStreamPreview').textContent='';$('chatStreamPreview').hidden=true;}
    $('chatNotice').classList.toggle('is-working', busy);
    $('chatNotice').dataset.tone = busy ? 'working' : chatNoticeTone;
    $('thinkingSignal').hidden = !busy;
    $('chatNoticeText').textContent = busy ? (chatFlight.progressText||'正在读取你的需求…请稍候。') : chatError;
    $('cancelChatButton').hidden = !busy;
    $('retryChatButton').hidden = busy || !state.pendingChat;
    $('retryChatButton').disabled = !modelState.ready || modelState.checking;
    $('chatLimit').textContent = modelState.ready ? '先选方案，再确认；点击「同意并执行」后才修改平面。' : modelState.checking ? '连接后就可以聊天。想法和当前平面都会保留。' : `${modelState.message || '对话暂未连接'} 也可以点击「需要一点引导？」继续设计。`;
  }
  async function checkModelStatus() {
    const sequence = ++statusSequence;
    modelState.checking = true; renderChatControls();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      if (!/^https?:$/.test(location.protocol)) throw new Error('请通过「启动愿居」打开本地聊天工具');
      const response = await fetch('/api/model/status?model='+encodeURIComponent(preferredModel), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('GPT API服务暂时没有响应');
      const result = await response.json();
      if (sequence !== statusSequence) return;
      modelState = { ready: result.ready === true, checking: false, model: typeof result.model === 'string' ? result.model.slice(0, 80) : '', message: typeof result.message === 'string' ? result.message.slice(0, 200) : 'GPT API尚未连接' };
    } catch (error) {
      if (sequence !== statusSequence) return;
      modelState = { ...modelState, ready: false, checking: false, message: error.name === 'AbortError' ? '连接超时，请确认GPT API已启动' : error.message === 'Failed to fetch' ? '本地服务未连接，请通过「启动愿居」打开' : error.message };
    } finally {
      clearTimeout(timer); if (sequence === statusSequence) renderChatControls();
    }
  }
  function restorePendingDraft() {
    if (!state.chatDraft.trim() && state.pendingChat) { state.chatDraft = state.pendingChat.text; $('wishInput').value = state.chatDraft; }
  }
  function cancelChat(message = '已停止回答。你的想法已保留，可以修改后重发或重新回答。', discard = false, tone = 'note') {
    const flight = chatFlight; chatFlight = null;
    chatNoticeTone = tone;
    if (flight) { clearTimeout(flight.timer); clearInterval(flight.pulseTimer); flight.controller.abort(); }
    if (discard) { state.pendingChat = null; chatError = ''; }
    else if (state.pendingChat) { chatError = message; restorePendingDraft(); }
    renderChat(); persist();
  }
  function renderRequirements() {
    const requirements = state.conversation.requirements || [], checks = E.evaluateRequirements(state.rooms, state.constraints);
    if(state.constraints.balconyBedroom){
      const detail=interiorPlan||I.analyze(state.rooms,state.prefs,{obstacles:B.siteObstacles(buildingPlacement())});
      checks.push(...S.audit(state.rooms,state.prefs,{balconyBedroom:true},{},buildingPlacement(),detail).checks.filter(c=>c.id==='balconyBedroom'));
    }
    const explanations = {
      household: '记录居住人数；睡房数量仍由你单独决定。',
      lifestyle: '生活习惯已保留，隔音、家具与动线需继续细化。',
      fengshui: '按你的具体空间偏好逐项讨论，不做整体风水判定。',
      entryStove: `已有${entryName()}侧入口与灶位示意，尚未校核入户视线。`,
      bedDoor: '房门与床会随拼搭调整，尚未专项校核门床正对关系。',
      headboard: '床头优先靠无门窗的墙段，仍需结合具体要求细化。',
      ventilation: '需要门窗开口和周边条件，当前无法验证通风。',
      accessibility: '通道净宽、门槛、卫浴与使用者需求需要后续细化。',
      pets: '宠物活动区、收纳与阳台防护需要后续细化。',
      workspace: '睡房会自动尝试放置书桌，独立办公区仍待细化。',
      study: '书桌优先靠外窗布置，学习区的安静与使用需求仍待细化。',
      cooking: '已有厨房模块；开放或封闭布局、排烟与收纳待细化。'
    };
    const bedrooms = E.getStats(state.rooms).bedrooms;
    const hasBalcony = state.rooms.some(room => room.type === 'balcony'), hasGarden = state.rooms.some(room => room.type === 'garden');
    const currentOutdoor = hasBalcony ? (hasGarden ? 'both' : 'balcony') : hasGarden ? 'garden' : 'none';
    requirements.forEach(requirement => {
      let met, detail;
      if (['gardenCount','balconyCount'].includes(requirement.id) && Number.isInteger(requirement.value)) {const type=requirement.id==='gardenCount'?'garden':'balcony',n=state.rooms.filter(r=>r.type===type).length;met=n===requirement.value;detail=`当前 ${n} 个，期望 ${requirement.value} 个。`;}
      if (requirement.id === 'singleBedrooms' && Number.isInteger(requirement.value)) { const n=state.rooms.filter(r=>r.type==='bedroomSingle').length; met=n===requirement.value;detail=`当前有 ${n} 间单人小睡房，期望 ${requirement.value} 间。`; }
      if (requirement.id === 'bedrooms' && Number.isInteger(requirement.value)) { met = bedrooms === requirement.value; detail = `当前画布有 ${bedrooms} 间睡房，期望 ${requirement.value} 间。`; }
      if (requirement.id === 'living' && ['large', 'small', 'medium'].includes(requirement.value)) { met = state.rooms.some(room => room.type === ({large:'livingLarge',small:'livingSmall',medium:'livingMedium'}[requirement.value])); detail = met ? '当前画布包含所选客厅模块。' : '当前画布还没有所选客厅模块。'; }
      if (requirement.id === 'outdoor' && Object.hasOwn(OUTDOORS, requirement.value)) { met = currentOutdoor === requirement.value; detail = `当前：${OUTDOORS[currentOutdoor]}；期望：${OUTDOORS[requirement.value]}。`; }
      if (requirement.id === 'orientation' && Object.hasOwn(DIRECTIONS, requirement.value)) { met = state.prefs.orientation === requirement.value && state.rooms.some(room => room.type.startsWith('living')); detail = `当前客厅${DIRECTIONS[state.prefs.orientation]}向偏好；这里只核对设置，未验证真实采光。`; }
      if (met !== undefined) checks.push({ id: requirement.id, status: met ? 'met' : 'unmet', detail });
    });
    $('requirementCount').textContent = `${requirements.length} 项需求`;
    if (!requirements.length) { $('requirementsList').innerHTML = '<div class="requirements-empty"><span>✳</span><p>朝向之外，还可以聊聊生活习惯和风水偏好。<br><button class="inline-action" data-chat-prompt="睡房不要挨着厨房">试试「睡房不要挨着厨房」 ↗</button></p></div>'; renderChatControls(); return; }
    $('requirementsList').innerHTML = requirements.map(requirement => {
      const check = checks.find(item => item.id === requirement.id);
      const status = requirement.kind === 'layout' ? (check?.status || 'pending') : requirement.kind === 'detail' ? 'detail' : requirement.label.startsWith('待澄清') ? 'clarify' : 'note';
      const statusLabel = requirement.id === 'orientation' && status === 'met' ? '偏好已设置' : { met: '已满足', unmet: '需调整', partial: '部分满足', pending: '待应用', detail: '待细化', note: '已记下', clarify: '待澄清' }[status] || '已记下';
      const detail = check?.detail || explanations[requirement.id] || (requirement.kind === 'layout' ? '先应用对话中的提案，再检查当前布局。' : requirement.detail || requirement.text || (requirement.kind === 'detail' ? '当前模块图缺少所需细节，尚未落实。' : '作为设计意图保留，尚未自动转成空间。'));
      return `<article class="requirement-item"><span class="requirement-dot ${status}">${status === 'met' ? '✓' : status === 'detail' ? '⌑' : '·'}</span><div class="requirement-copy"><strong>${esc(requirement.label)}</strong><p>${esc(detail)}</p></div><span class="requirement-status ${status}">${statusLabel}</span><button class="inline-action" data-remove-requirement="${esc(requirement.id)}" aria-label="移除需求：${esc(requirement.label)}" title="移除这项需求">×</button></article>`;
    }).join('');
  }
  async function sendWish(text, retry = false) {
    const wish = String(text).trim().slice(0, 1200); if (!wish || chatFlight) return;
    if (!modelState.ready) { notify('GPT API尚未连接，想法已保留。请检查连接或先使用选项引导。'); if (!modelState.checking) checkModelStatus(); return; }
    conversationBackup = null;
    const previous = clone(state.conversation);
    const last = previous.messages.at(-1);
    const repeat = state.pendingChat?.text === wish && last?.role === 'user' && last.text === wish;
    if (repeat) previous.messages.pop();
    else {
      const id = 'm-' + (state.conversation.messages.reduce((max, item) => Math.max(max, Number(item.id.slice(2)) || 0), 0) + 1);
      state.conversation.messages.push({ id, role: 'user', text: wish });
      if (state.conversation.messages.length > 60) state.conversation.messages = state.conversation.messages.slice(-60);
    }
    state.pendingChat = { text: wish }; state.inputMode = 'chat'; chatError = '';
    if (!retry || state.chatDraft.trim() === wish) { state.chatDraft = ''; $('wishInput').value = ''; }
    const controller = new AbortController();
    const flight = { controller, timer: null, pulseTimer: null, startedAt: Date.now() }; chatFlight = flight;
    $('thinkingElapsed').textContent='0s';
    flight.pulseTimer=setInterval(()=>{if(chatFlight===flight)$('thinkingElapsed').textContent=Math.floor((Date.now()-flight.startedAt)/1000)+'s';},1000);
    // Keep waiting for local inference; the Stop button cancels explicitly.
    const payload = C.requestContext({ text: wish, prefs: clone(state.prefs), rooms: clone(state.rooms), constraints: clone(state.constraints), conversation: previous, buildingPlacement: buildingPlacement(), functionLibrary: clone(state.functionLibrary) });
    renderChat(true); persist();
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept:'application/x-ndjson' }, body: JSON.stringify({...payload,model:preferredModel}), signal: controller.signal });
      let result=null;
      if(response.ok&&response.headers.get('content-type')?.includes('application/x-ndjson')){
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=false;
        const receive=line=>{if(!line.trim())return;const event=JSON.parse(line);
          if(event.type==='error')throw new Error(event.message||'GPT API回复中断。');
          if(event.type==='complete'){result=event.result;complete=true;return;}
          if(event.type==='progress'&&chatFlight===flight){const text=event.phase==='generating'?`正在生成回复 · 已收到 ${event.characters||0} 字符`:event.phase==='validating'?'正在核对需求与平面操作…':event.phase==='retrying'?'正在修正回复格式，尚未修改平面…':'正在读取需求并准备回复…';flight.progressText=text;$('chatNoticeText').textContent=text;$('chatStreamPreview').textContent=event.preview||'';$('chatStreamPreview').hidden=!event.preview;}
        };
        try{while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});if(buffer.length>524288)throw new Error('回复数据异常，未修改平面。');let n;while((n=buffer.indexOf('\n'))>=0){receive(buffer.slice(0,n));buffer=buffer.slice(n+1);}}buffer+=decoder.decode();if(buffer.trim())receive(buffer);}finally{reader.releaseLock();}
        if(!complete)throw new Error('回复连接中断，你的想法已保留，平面未修改。');
      }else result=await response.json().catch(()=>null);
      if (chatFlight !== flight) return;
      if (!response.ok || !result?.conversation) {
        const message = typeof result?.message === 'string' ? result.message : typeof result?.error === 'string' ? result.error : '这次没有收到完整回答，请重新回答。';
        if (response.status === 503 || ['MODEL_UNAVAILABLE', 'MODEL_MISSING'].includes(result?.error)) modelState = { ...modelState, ready: false, checking: false, message };
        throw new Error(message);
      }
      const conversation = C.stageForReview(state,result.conversation);
      if (conversation.messages.at(-1)?.role !== 'assistant') throw new Error('这次回答没有完成，请重新回答。');
      state.functionLibrary = F.mergeLibrary(state.functionLibrary, result.functionSketches);
      const normalizedTitle = title => title.toLocaleLowerCase().replace(/\s+/g, '');
      const receivedSketches = F.normalizeLibrary(result.functionSketches);
      conversation.messages.at(-1).functionSketchIds = receivedSketches.map(plan => state.functionLibrary.find(saved => saved.id === plan.id || (saved.parentType||null)===(plan.parentType||null) && normalizedTitle(saved.title) === normalizedTitle(plan.title))?.id).filter(Boolean);
      if (conversation.contextScope) conversation.contextScope.functionIds = [...new Set([...conversation.contextScope.functionIds, ...conversation.messages.at(-1).functionSketchIds])];
      if (conversation.messages.at(-1).functionSketchIds.length < receivedSketches.length) notify('功能草图库已满，部分新草图尚未收藏。请先下载备份。');
      renderFunctionLibrary();
      state.conversation = conversation; state.pendingChat = null; chatError = '';
      renderPlan(); renderWizard();
      if (typeof result.model === 'string') modelState.model = result.model.slice(0, 80);
      modelState.ready = true;
      renderRequirements();
    } catch (error) {
      if (chatFlight !== flight) return;
      chatNoticeTone = error.name === 'AbortError' ? 'note' : 'error';
      chatError = error.name === 'AbortError' ? '回答已停止，你的想法已保留。' : error.message === 'Failed to fetch' ? '本地服务连接中断。你的想法已保留，可以检查连接后重新回答。' : String(error.message).slice(0, 240);
      if (error.message === 'Failed to fetch') modelState = { ...modelState, ready: false, checking: false, message: '本地服务连接中断，请重新检查连接' };
      restorePendingDraft();
    } finally {
      clearTimeout(flight.timer); clearInterval(flight.pulseTimer);
      if (chatFlight === flight) { chatFlight = null; renderChat(true); persist();
        // Responses and option selections never authorize a canvas mutation.
      }
    }
  }
  function applyProposal(id) {
    if(chatFlight)return;
    const message=state.conversation.messages.find(m=>m.id===id);
    if(!message?.proposal||message.applied||message.superseded)return;
    const proposal=message.proposal;
    if(proposal.reviewSignature&&proposal.reviewSignature!==M.signature(state.rooms)){message.applicationNote='尚未执行：画布在提案之后已改变，请继续调整并重新确认。';renderChat(true);persist();return;}
    if(!proposal.orientationChange){applyReviewedProposal(id);return;}
    const before=clone(state);
    try{
      state.conversation.orientationPreference=clone(proposal.orientationChange);state.conversation.householdSlot=null;
      state.prefs.orientation=proposal.orientationChange.direction;
      const original=clone(state.rooms);syncCoreEntrance();
      if(proposal.moduleEdits&&!proposal.replaceAll){const tx=M.rebaseAfterAlignment(proposal.moduleEdits,original,state.rooms);if(!tx)throw Error('画布已改变，请重新确认方案。');proposal.moduleEdits=tx;}
      if(proposal.orientationOnly){commit(()=>{message.applied=true;message.choices=[];supersedeProposals();message.applicationNote='已按你的确认更新住户朝向与主入口。';},'已确认并更新朝向。',true);}
      else applyReviewedProposal(id);
      if(!message.applied)throw Error(message.applicationNote||'方案未通过检查，原平面保留。');
      if(history.length)history[history.length-1]=before;
    }catch(error){state=before;state.conversation.messages.find(m=>m.id===id).applicationNote='未执行，原平面保留：'+error.message;render();persist();}
  }
  function applyReviewedProposal(id) {
    if (chatFlight) return;
    const message = state.conversation.messages.find(item => item.id === id);
    if (!message?.proposal || message.applied || message.superseded) return;
    if (!B.preference(state.conversation)) { message.applicationNote='尚未生成：先选择住户朝向，再应用方案。'; renderOrientation(); renderChat(true);persist(); notify("先在对话下方确认朝向，再应用方案。"); return; }
    const proposal = message.proposal;
    if(proposal.routeRequests){
      const result=M.optimizeLayout(state.rooms,state.prefs,state.constraints,state.conversation,buildingPlacement(),{routes:proposal.routeRequests});
      if(!result.ok){message.applicationNote='未执行：'+result.reason;renderChat(true);persist();notify(result.reason);return;}
      commit(()=>{state.rooms=result.rooms;state.manual=true;selected=null;message.applied=true;message.choices=[];supersedeProposals();message.applicationNote='已按实际门洞和可达步行路径核对指定动线，移动了 '+result.movedIds.length+' 个模块；房间尺寸和家具内容保留。';},'已落实指定动线要求。',true);
      renderChat(true);document.dispatchEvent(new CustomEvent('wishouse:reveal-plan'));return;
    }
    if(proposal.moduleEdits){
      const isolated=proposal.replaceAll||state.conversation.contextScope?.isolated&&!state.conversation.contextScope.planShared;
      const result=M.execute(isolated?[]:state.rooms,proposal.moduleEdits,{...(proposal.replaceAll?proposal.prefs:state.prefs),household:proposal.prefs.household},proposal.constraints,state.conversation,buildingPlacement(),{acceptTargetChanges:true});
      if(!result.ok){message.applicationNote='未执行，原平面保留：'+result.reason;renderChat(true);persist();notify(result.reason);return;}
      commit(()=>{
        state.rooms=result.rooms;state.prefs=result.prefs;state.constraints=result.constraints;state.manual=true;state.completed=true;selected=null;
        S.syncManualRequirements(state.conversation,state.prefs,state.rooms);
        state.conversation.moduleCounts=result.inventory;
        for(const key of Object.keys(state.constraints))if(!state.constraints[key])state.conversation.requirements=state.conversation.requirements.filter(r=>r.id!==key);
        if(state.conversation.contextScope){state.conversation.contextScope.planShared=true;state.conversation.contextScope.replaceAll=false;}
        message.applied=true;message.choices=[];supersedeProposals();message.applicationNote='已执行并核对：'+result.receipt;
      },result.reassembled?`新尺寸已重新拼接，移动了 ${result.movedIds.length} 个模块。`:'模块操作已落实，其他模块保持原位。',true);
      renderChat(true);document.dispatchEvent(new CustomEvent('wishouse:reveal-plan'));return;
    }

    const prefs = { ...E.DEFAULTS, ...proposal.prefs, orientation: B.preference(state.conversation), entranceSide: entrySide() }, constraints = cleanConstraints(proposal.constraints);
    const rooms = rebuildRooms(prefs, state.variant, constraints, proposal.replaceAll || state.conversation.contextScope?.isolated && !state.conversation.contextScope.planShared ? [] : state.rooms);
    if (!rooms) {message.applicationNote='未执行，原平面保留：'+(planFailure||'尚未找到满足全部需求的拼法。');renderChat(true);persist();return;}
    const detail=I.analyze(rooms,prefs,{obstacles:B.siteObstacles(buildingPlacement())});
    const checked=S.audit(rooms,prefs,constraints,state.conversation,buildingPlacement(),detail,proposal.replaceAll||state.conversation.contextScope?.isolated&&!state.conversation.contextScope.planShared?[]:state.rooms);
    if(!checked.ok){message.applicationNote='未应用，原平面保留：'+checked.checks.filter(c=>c.status!=='met').map(c=>c.detail).join('；');renderChat(true);persist();notify('生成结果未通过需求核对，未替换当前平面。');return;}
    const before=S.inventory(state.rooms),after=S.inventory(rooms);
    const changes=Object.keys(before).filter(k=>before[k]!==after[k]).map(k=>`${E.TYPES[k].name} ${before[k]} → ${after[k]}`).join('；');
    if(JSON.stringify(rooms)===JSON.stringify(state.rooms)&&Object.keys(prefs).every(k=>prefs[k]===state.prefs[k])&&Object.keys(constraints).every(k=>constraints[k]===!!state.constraints[k])){
      message.noChange=true;message.applicationNote='未修改：这次可执行提案与当前平面完全相同，没有新增、删除或移动模块。如果你要求改变空间，这条回答尚未落实，请重新说明要增减的模块与数量。';renderChat(true);persist();return;
    }
    commit(() => {
      dismissEntryNotice(); dismissModuleNotice();
      state.prefs = prefs; state.constraints = constraints;
      state.rooms = rooms; state.conversation.moduleCounts=M.counts(rooms); state.manual = false; state.completed = true; selected = null;
      if (state.conversation.contextScope) {state.conversation.contextScope.planShared = true;state.conversation.contextScope.replaceAll=false;}
      message.applied = true; message.choices=[]; supersedeProposals();
      message.applicationNote=`${changes?"已执行并核对："+changes+"。":""}已生成并核对：${E.getStats(rooms).bedrooms} 间睡房，${({small:'3×3 小客厅',medium:'3×4.5 多用客厅',large:'6×6 大客厅'}[prefs.living])}。花园 ${E.outdoorCounts(prefs).garden} 个、阳台 ${E.outdoorCounts(prefs).balcony} 个。${constraints.balconyBedroom&&checked.checks.some(c=>c.id==='balconyBedroom'&&c.status==='met')?'阳台已与睡房直接连通。':''}${constraints.gardenCourtyard&&checked.checks.some(c=>c.id==='garden-route'&&c.status==='met')?'花园已连片，从客厅玻璃移门直接进入，不穿过睡房。':''}${checked.warnings.length?'仍待调整：'+checked.warnings.join('；')+'。':''}${checked.pending.length?'其他生活需求仍需逐项细化，未标为完成。':''}`;
    }, '已把这次愿望拼进平面，具体落实情况见需求清单。', true);
    renderChat(true);
    document.dispatchEvent(new CustomEvent('wishouse:reveal-plan'));
  }

  function illustration(kind) {
    const paths = {
      solo: '<circle cx="16" cy="9" r="4"/><path d="M10 27v-8a6 6 0 0 1 12 0v8M13 27v-7m6 7v-7"/>',
      couple: '<circle cx="10" cy="10" r="3.4"/><circle cx="23" cy="10" r="3.4"/><path d="M5 27v-8a5 5 0 0 1 10 0v8m3 0v-8a5 5 0 0 1 10 0v8M8 27v-6m13 6v-6"/>',
      family: '<circle cx="7" cy="8" r="3"/><circle cx="25" cy="8" r="3"/><circle cx="16" cy="16" r="2.6"/><path d="M2 26V16a5 5 0 0 1 9-3m10 0a5 5 0 0 1 9 3v10M12 29v-7a4 4 0 0 1 8 0v7M5 26v-8m22 8v-8"/>',
      large: '<path d="M5 17V9a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v8M4 15h3v8h18v-8h3v11H4V15Zm3 11v3m18-3v3M10 6v11m12-11v11M7 18h18"/>',
      small: '<path d="M7 18V10a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8M6 16h3v8h14v-8h3v11H6V16Zm3 11v2m14-2v2M16 7v12M9 19h14"/>',
      balcony: '<path d="M4 27h24M6 27V16m5 11V16m5 11V16m5 11V16m5 11V16M4 16h24M7 12V4h18v8"/><circle cx="22" cy="8" r="2"/>',
      garden: '<path d="M16 27V14m-6 4c-9 0-8-11-4-11 7 0 10 5 10 11m0-2c0-9 5-13 10-12 3 9-3 13-10 12M8 27h16"/>',
      both: '<path d="M3 27h27M4 27V17h24v10M9 17v10m7-10v10m7-10v10M11 14V8m0 3C3 10 4 3 6 3c5 0 5 8 5 8m0 0c0-7 5-10 7-7 3 5-4 7-7 7"/><circle cx="26" cy="8" r="3"/>',
      none: '<path d="M5 27V6h22v21H5Zm0-9h22M16 6v12M9 10h3m8 0h3M10 23h12"/>'
    };
    return `<svg viewBox="0 0 32 32" aria-hidden="true">${paths[kind] || paths.large}</svg>`;
  }
  function optionCard(key, value, title, description, icon) {
    const chosen = state.prefs[key] === value;
    return `<button type="button" class="option-card ${chosen ? 'selected' : ''}" data-pref="${key}" data-value="${value}" aria-pressed="${chosen}"><span class="option-illustration">${illustration(icon)}</span><span class="option-copy"><strong>${title}</strong><small>${description}</small></span><span class="option-check">${chosen ? '✓' : ''}</span></button>`;
  }
  function renderWizard() {
    const labels = ['和谁住', '怎样住', '亲近自然', '迎向光'];
    $('stepNav').innerHTML = labels.map((label, i) => `<button class="step-item ${state.step === i ? 'active' : ''} ${state.step > i || state.completed ? 'complete' : ''}" data-step="${i}" ${state.step === i ? 'aria-current="step"' : ''}><span class="step-number">${state.step > i ? '✓' : '0' + (i + 1)}</span>${label}</button>`).join('');
    const heading = (number, title, desc) => `<p class="question-eyebrow">WISH ${number} / 04</p><h2>${title}</h2><p class="question-description">${desc}</p>`;
    const content = [
      () => heading('01', '这个家，想和谁一起住？', '让空间先认识你，再慢慢长成家的样子。') + `<div class="option-list">${optionCard('household', 'solo', '一个人的小天地', '自在独处，留一点松弛', 'solo')}${optionCard('household', 'couple', '两个人，刚刚好', '分享日常，也拥有自己', 'couple')}${optionCard('household', 'family', '热闹的一家人', '让陪伴和成长都有位置', 'family')}</div>`,
      () => heading('02', '把空间，留给喜欢的日常。', '客厅大一点，还是给生活多一点留白？') + `<div class="two-options living-options">${optionCard('living', 'large', '大客厅', '36 m² · 四人餐厨起居', 'large')}${optionCard('living', 'small', '小客厅', '3 × 3 m · 起居与单人餐写', 'small')}${optionCard('living', 'medium', '多用客厅', '3 × 4.5 m · 餐写与待客', 'large')}</div><div class="number-label"><span>需要几间睡房？</span><small>2人睡房 13.5 m² / 单人 9 m²</small></div><div class="number-options" aria-label="睡房数量">${[1, 2, 3, 4].map(n => `<button class="${state.prefs.bedrooms === n ? 'selected' : ''}" data-pref="bedrooms" data-value="${n}" aria-pressed="${state.prefs.bedrooms === n}">${n} 间</button>`).join('')}</div><div class="number-label"><span>其中几间用单人小睡房？</span><small>3 × 3 m · 其余保留2人睡房</small></div><div class="number-options" aria-label="单人小睡房数量">${Array.from({length:state.prefs.bedrooms+1},(_,n)=>`<button class="${(state.prefs.singleBedrooms||0)===n?'selected':''}" data-pref="singleBedrooms" data-value="${n}" aria-pressed="${(state.prefs.singleBedrooms||0)===n}">${n} 间</button>`).join('')}</div><p class="orientation-note">${state.prefs.living === 'large' ? '大客厅采用四人标准布局，包含起居、餐区与开放厨房。' : '小客厅和多用客厅另配独立厨房；餐写桌错时共用，固定办公或多人聚餐需另行讨论。'}</p>`,
      () => heading('03', '把一点自然，带回家。', '晾晒、种花、发呆。留一处和户外相遇的角落。') + `<div class="two-options">${optionCard('outdoor', 'balcony', '一个阳台', '接住风与日常', 'balcony')}${optionCard('outdoor', 'garden', '一片花园', '让生活长出绿意', 'garden')}${optionCard('outdoor', 'both', '两个都想要', '多一点亲近自然', 'both')}${optionCard('outdoor', 'none', '这次先不要', '把心思留给室内', 'none')}</div>`,
      () => heading('04', '希望客厅，迎向哪一边？', '选一个朝向，也选一种与光相处的方式。') + `<div class="orientation-grid">${[['south', '↓', '南向', '把向阳面留给日常'], ['east', '→', '东向', '期待清晨的第一束光'], ['west', '←', '西向', '喜欢傍晚的温柔'], ['north', '↑', '北向', '偏爱宁静的角落']].map(([v, arrow, title, desc]) => `<button class="orientation-card ${B.preference(state.conversation) === v ? 'selected' : ''}" data-pref="orientation" data-value="${v}" aria-pressed="${B.preference(state.conversation) === v}"><span>${arrow}</span><div><strong>${title}</strong><small>${desc}</small></div></button>`).join('')}</div><p class="orientation-note">确认住户的主要朝向与楼栋位置，外窗优先迎向该侧，主入口随住户位置朝向核心筒（当前${entryName()}侧）。<br>实际采光还会受场地、气候与遮挡影响。</p>${state.completed ? '<div class="completion-hint">✓ 愿望已拼成。现在可以拖动右侧的积木，再把细节变成你喜欢的样子。</div>' : ''}`
    ];
    $('wizardContent').innerHTML = content[state.step]();
    $('wizardActions').innerHTML = `${state.step > 0 ? '<button class="back-button" id="prevStep">上一步</button>' : ''}<button class="primary-button" id="nextStep">${state.step === 3 ? (state.completed ? '去画布，继续自由拼搭' : '这就是我想住的家') : ['接下来，聊聊空间', '接下来，留一点自然', '最后，选一个朝向'][state.step]}<span>↗</span></button>`;
    const actualLiving = state.rooms.filter(r => r.type.startsWith('living'));
    const livingSummary = actualLiving.length ? actualLiving.length === 1 ? E.TYPES[actualLiving[0].type].name : `${actualLiving.length} 个客厅` : '尚无客厅';
    const actualBalconies = state.rooms.filter(r => r.type === 'balcony').length, actualGardens = state.rooms.filter(r => r.type === 'garden').length;
    const outdoorSummary = [actualBalconies ? `${actualBalconies} 个阳台` : '', actualGardens ? `${actualGardens} 片花园` : ''].filter(Boolean).join(' · ') || '专注室内';
    $('wishChips').innerHTML = [HOUSEHOLDS[state.prefs.household], livingSummary, `${E.getStats(state.rooms).bedrooms} 间睡房`, outdoorSummary, `${DIRECTIONS[state.prefs.orientation]}向偏好`].map(s => `<span>${s}</span>`).join('');
  }

  function roomLabel(room) {
    const same = state.rooms.filter(r => r.type === room.type && (!room.functionPlan || r.functionPlan?.id === room.functionPlan.id));
    return (room.type === 'livingLarge' && !room.functionPlan ? '大客厅 · 餐厨' : E.getDefinition(room).name) + (same.length > 1 ? ' ' + String(same.findIndex(r => r.id === room.id) + 1).padStart(2, '0') : '');
  }
  function roomMarkup(room, exporting = false) {
    const w = room.w * GRID, h = room.h * GRID, type = E.getDefinition(room);
    const isOutdoor = ['balcony', 'garden'].includes(room.type);
    const detail = interiorPlan?.byRoom[room.id];
    const labelWidth = Math.min(w - 9, Math.max(39, roomLabel(room).length * 7 + 12));
    const label = D.labelPosition(room, detail, labelWidth / GRID, 25 / GRID);
    const labelY = view === 'blocks' && !exporting ? h / 2 : label.y * GRID;
    const labelX = view === 'blocks' && !exporting ? w / 2 : label.x * GRID;
    const small = Math.min(w, h) <= 40;
    const area = (room.w * room.h * E.CELL_METERS ** 2).toFixed(1);
    const color = type.color;
    let drawing = `<rect class="room-outline" x=".6" y=".6" width="${w - 1.2}" height="${h - 1.2}" rx="1.5" fill="${color}"/>`;
    if (view === 'plan' || exporting) {
      if (showClearances && D.useZones && (exporting || compactView[room.id]!=='stowed')) drawing += D.useZones(detail, GRID);
      if (showClearances && selected === room.id && D.accessRoutes && (exporting || compactView[room.id]!=='stowed')) drawing += D.accessRoutes(detail, GRID);
      if(room.type==='livingSmall' && (showClearances || selected===room.id))drawing += `<g class="compact-edge-route" pointer-events="none" aria-label="沿边通路，净宽0.9米">${(detail?.edgeCirculation||[]).map(r=>`<rect x="${r.x*GRID}" y="${r.y*GRID}" width="${r.w*GRID}" height="${r.h*GRID}" fill="#83c9c018" stroke="#83c9c0" stroke-width=".4" stroke-dasharray="2 2"><title>沿边通路 · 0.9 m · 与展开桌椅使用区分开</title></rect>`).join('')}</g>`;
      drawing += D.furniture(detail, GRID, {state:exporting?'expanded':compactView[room.id]||'expanded'});
    }
    else drawing += `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="url(#moduleGrid)" opacity=".4"/>`;
    drawing += `<rect class="room-label-bg" x="${labelX - labelWidth / 2}" y="${labelY - 12}" width="${labelWidth}" height="25" rx="2" fill="${color}" opacity=".94" pointer-events="none"/>`;
    drawing += `<text class="room-label" x="${labelX}" y="${labelY - (small ? 1 : 2)}" text-anchor="middle" ${small ? 'style="font-size:8px"' : ''}>${esc(roomLabel(room))}</text><text class="room-area" x="${labelX}" y="${labelY + (small ? 8 : 10)}" text-anchor="middle">${view === 'blocks' && !exporting ? `${room.w / E.MODULE_CELLS} × ${room.h / E.MODULE_CELLS} 单元` : `${area} m²`}</text>`;
    if (selected === room.id && !exporting) drawing += `<g class="room-grip">${[w / 2 - 4, w / 2, w / 2 + 4].map(x => `<circle cx="${x}" cy="6" r=".9"/>`).join('')}</g>`;
    return `<g id="room-${esc(room.id)}" class="room ${selected === room.id && !exporting ? 'selected' : ''}" data-room="${esc(room.id)}" data-type="${room.type}" transform="translate(${room.x * GRID} ${room.y * GRID})" role="button" tabindex="0" aria-label="${esc(roomLabel(room))}，${area} 平方米，点击选择后使用方向键移动">${drawing}</g>`;
  }
  function planBounds(rooms = state.rooms) { return E.getBounds([...rooms, ...E.getEntranceZones(rooms, entrySide())]); }
  function getViewBox() {
    if (!baseBox) {
      const b = showBuildingExtent ? E.getBounds([...state.rooms, ...B.siteObstacles(buildingPlacement())]) : planBounds(), aspect = Math.max(.7, $('canvasWrap').clientWidth / $('canvasWrap').clientHeight);
      let height = Math.max(290, b.height * GRID + 108), width = Math.max(390, b.width * GRID + 135, height * aspect);
      height = Math.max(height, width / aspect); width = height * aspect;
      baseBox = { cx: (b.minX + b.maxX) / 2 * GRID, cy: (b.minY + b.maxY) / 2 * GRID, width, height };
    }
    const width = baseBox.width / zoom, height = baseBox.height / zoom;
    return { x: baseBox.cx - width / 2, y: baseBox.cy - height / 2, width, height };
  }
  function dimensionMarkup(rooms = state.rooms) {
    if (!rooms.length) return '';
    const b = E.getBounds(rooms), left = b.minX * GRID, top = b.minY * GRID, right = b.maxX * GRID, bottom = b.maxY * GRID, dimensionBottom = planBounds(rooms).maxY * GRID;
    return `<g aria-hidden="true"><path class="dimension-line" d="M${left} ${dimensionBottom + 11}v9m0-4H${right}m0-5v9M${left - 11} ${top}h-9m4 0V${bottom}m-5 0h9"/><text class="dimension-text" x="${(left + right) / 2}" y="${dimensionBottom + 28}" text-anchor="middle">${(b.width * E.CELL_METERS).toFixed(1)} m</text><text class="dimension-text" transform="translate(${left - 23} ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle">${(b.height * E.CELL_METERS).toFixed(1)} m</text></g>`;
  }
  function compassMarkup(box) {
    const unit = box.height / $('canvasWrap').clientHeight, x = box.x + 39 * unit, y = box.y + 83 * unit;
    return `<g transform="translate(${x} ${y}) scale(${unit})" aria-label="北向固定为屏幕上方"><text class="compass-label" text-anchor="middle" y="-20">N</text><path d="M0-12-5 4 0 1 5 4 0-12Z" fill="#8b9c77"/><path d="M0 1v13" stroke="#a2ad92" stroke-width=".8"/><circle cx="0" cy="0" r="17" fill="none" stroke="#d9e0ce" stroke-width=".7"/></g>`;
  }
  function lightMarkup() {
    if (!state.rooms.length) return '';
    const b = E.getBounds(state.rooms), x = (b.minX + b.maxX) / 2 * GRID, y = (b.minY + b.maxY) / 2 * GRID;
    let tx = x, ty = planBounds().maxY * GRID + 42;
    if (state.prefs.orientation === 'north') ty = b.minY * GRID - 26;
    if (state.prefs.orientation === 'east') { tx = b.maxX * GRID + 38; ty = y; }
    if (state.prefs.orientation === 'west') { tx = b.minX * GRID - 48; ty = y; }
    return `<g transform="translate(${tx} ${ty})" aria-hidden="true"><circle cx="0" cy="0" r="4.5" fill="none" stroke="#c1ad76" stroke-width=".7"/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<path d="M0-7v-2.3" transform="rotate(${a})" stroke="#c1ad76" stroke-width=".65"/>`).join('')}<text x="13" y="2" font-size="5.7" fill="#a9a17e">${DIRECTIONS[state.prefs.orientation]}向偏好</text></g>`;
  }
  let orientationExpanded = false;
  function directionButtons(selectedDirection) {
    return Object.entries(B.names).map(([direction, name]) => `<button data-building-direction="${direction}" aria-pressed="${direction === selectedDirection}">${name}向 · ${['east','west'].includes(direction) ? '短边 1 户' : '长边 2 户'}</button>`).join('');
  }
  function renderOrientation() {
    const direction = B.preference(state.conversation);
    $('orientationPrompt').innerHTML = direction && !orientationExpanded ? `<p>住户朝向已确认：${B.names[direction]}向。<button data-edit-orientation>更改朝向 ↗</button></p>` :
      `<p>画平面前，先决定你的家朝向哪一边。也可以在对话里说出偏好；没有明确偏好时，请先选一个方向试试。</p><div class="building-choices">${directionButtons(direction)}<button data-clear-orientation>暂不决定</button></div>`;
    $('orientationPrompt').querySelectorAll('button').forEach(button => button.disabled = !!chatFlight);
  }
  function chooseOrientation(direction, slot) {
    if (!B.names[direction] || chatFlight) return;
    const before = clone(state);
    state.conversation.orientationPreference = { status: 'confirmed', direction, source: 'choice', reason: '用户在朝向选择题中确认' };
    state.conversation.householdSlot = B.lots.find(l => l.id === slot && l.side === direction)?.id || B.lots.find(l => l.side === direction).id;
    state.conversation.requirements = state.conversation.requirements.filter(r => r.id !== 'orientation');
    if (state.conversation.requirements.length < 24) state.conversation.requirements.push({ id: 'orientation', label: B.names[direction] + '向住户', kind: 'layout', status: 'pending', value: direction, text: '用户明确选择的住户朝向' });
    state.prefs.orientation = direction; state.prefs.entranceSide = entrySide(); orientationExpanded = false;
    // Selecting an orientation alone must not generate unapproved default rooms.
    try {
      state.buildingPlacement = B.placement(state.rooms, state.conversation, state.buildingPlacement);
      syncCoreEntrance();
    } catch (_) { state = before; notify('当前模块暂时无法放进该分户界面，原方案已保留。请先减少沿楼栋方向的占宽。'); return; }
    baseBox = null; render(); persist();
    notify('已选择' + B.selectedLot(state.conversation).label + '；核心筒与邻居禁拼范围已同步。');
  }
  function buildingStatus(rooms) {
    const a = B.assess(rooms, state.conversation, buildingPlacement());
    if (!a.lot) return '朝向待确认：请先选住户方向，楼栋图会标出你的家与其余五户邻居。旧方案的默认朝南不等于已确认偏好。';
    if (a.status === 'empty') return '已选 ' + a.lot.label + '，可以继续聊需求。';
    const conflicts = rooms.filter(r => !allowedByBuilding(r));
    const side = B.boundary(buildingPlacement()).coreSide;
    const size = '核心筒按 24 × 12 m 实际范围检查，五户邻居暂按图示 6 m 进深；空白角部不再设分户禁区。';
    return size + (conflicts.length ? ' 当前有 '+conflicts.length+' 个模块与楼栋占用范围或入口位置冲突。' : ' 当前模块未占用核心筒和邻居。') + ' 室内 '+a.areaM2+' m²；主入口朝'+B.names[side]+'。贴核心筒、邻居的墙段不开窗，家具随有效外墙重排。家具间距和通路问题仅提示待调整，不阻止生成；无中空规则仍须满足。';
  }
  function renderBuilding(rooms = state.rooms) {
    const a = B.assess(rooms, state.conversation, buildingPlacement()), direction = B.preference(state.conversation);
    $('buildingContext').innerHTML = `<div class="building-heading"><strong>核心筒 24 × 12 m / 外围六户</strong><button data-export-building>导出楼栋图 ↓</button></div>${B.svg(rooms, state.conversation, buildingPlacement())}<div class="building-choices">${B.lots.map(l => `<button data-building-slot="${l.id}" aria-pressed="${a.lot?.id === l.id}">${l.label}${a.lot?.id === l.id ? ' · 你的家' : ''}</button>`).join('')}</div><p class="building-note">${direction ? '已选' + B.names[direction] + '向；其余五户为邻居。' : '先从对话理解朝向；尚未确认时可在上方点选。'}24 × 12 m 是中央核心筒尺寸。短边各 1 户、长边各 2 户，住户都在外侧；沿核心筒每户参考界面 12 m；邻居暂示进深 6 m。核心筒与邻居实际图示范围禁止拼接；范围之外仍可扩展。</p><p class="draft-status" data-status="${a.status}">${esc(buildingStatus(rooms))}</p>`;
    $('buildingContext').querySelectorAll('button').forEach(button => button.disabled = !!chatFlight);
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-clear-orientation]') && !chatFlight) {
      state.conversation.orientationPreference = { status: 'unknown', direction: null }; state.conversation.householdSlot = null;
      state.conversation.requirements = state.conversation.requirements.filter(r => r.id !== 'orientation');
      orientationExpanded = false; render(); persist(); notify('朝向保留为待确认，现有草案仍保留。'); return;
    }
    const direction = event.target.closest('[data-building-direction]');
    const slot = event.target.closest('[data-building-slot]');
    if (direction) chooseOrientation(direction.dataset.buildingDirection);
    if (slot) { const lot = B.lots.find(l => l.id === slot.dataset.buildingSlot); if (lot) chooseOrientation(lot.side, lot.id); }
    if (event.target.closest('[data-edit-orientation]')) { orientationExpanded = true; renderOrientation(); }
    if (event.target.closest('[data-export-building]')) {
      const graphic = B.svg(state.rooms, state.conversation, buildingPlacement()).replace('viewBox=', 'width="1120" height="640" viewBox=');
      download('愿居-六户楼栋.svg', graphic, 'image/svg+xml;charset=utf-8');
    }
  });
  function renderPlan(rooms = state.rooms) {
    state.prefs.entranceSide = entrySide();
    if (B.preference(state.conversation)) state.prefs.orientation = B.preference(state.conversation);
    state.buildingPlacement = buildingPlacement();
    renderBuilding(rooms);
    interiorPlan = I.analyze(rooms, state.prefs, { obstacles: B.siteObstacles(buildingPlacement()) });
    $('clearanceLegend').hidden = !showClearances || view !== 'plan';
    $('clearanceButton').disabled = view !== 'plan';
    if ($('designPanel').hidden) { renderSelection(); return; }
    const box = getViewBox();
    $('planSvg').setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
    $('planSvg').innerHTML = D.DEFS + `<style>${D.STYLES}</style>${B.boundarySvg(buildingPlacement(), box, GRID)}${dimensionMarkup(rooms)}${lightMarkup()}${D.entrances(E.getEntranceZones(rooms, entrySide()), GRID, interiorPlan.byRoom)}${rooms.map(r => roomMarkup(r)).join('')}${view === 'plan' ? rooms.map(r => D.openings(r, interiorPlan.byRoom[r.id], rooms, GRID)).join('') : ''}${compassMarkup(box)}`;
    $('emptyState').hidden = !!state.rooms.length;
    $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
    $('zoomInButton').disabled = zoom >= 1.8; $('zoomOutButton').disabled = zoom <= .6;
    renderSelection();
  }
  function renderSelection() {
    const room = state.rooms.find(r => r.id === selected); $('selectionCard').hidden = !room;
    if (!room) return;
    const detail = interiorPlan.byRoom[room.id];
    const windows = [...new Set((detail?.windows || []).map(w => DIRECTIONS[w.side]))].join('、');
    const notes = (detail?.notes || []).slice(0, 6);
    $('selectionCard').innerHTML = `<div class="selection-heading"><strong>${esc(roomLabel(room))}</strong><button class="inline-action" id="deselectButton" aria-label="取消选择">×</button></div><p>${(room.w * E.CELL_METERS).toFixed(1)} × ${(room.h * E.CELL_METERS).toFixed(1)} m · ${(room.w * room.h * E.CELL_METERS ** 2).toFixed(1)} m²</p><p class="selection-detail">${windows ? `${windows}侧外窗` : ['garden', 'balcony'].includes(room.type) ? '户外空间' : '暂无可用外窗'}${room.type.startsWith('living') ? ` · ${entryName()}侧主入口` : ''}</p>${notes.map(note => `<p class="selection-note">${esc(note)}</p>`).join('')}<div class="selection-actions"><button id="rotateButton">${svgIcon('rotate')}旋转</button><button id="deleteButton">${svgIcon('trash')}移除</button></div>`;
    $('selectionCard').insertAdjacentHTML('beforeend', '<button class="inline-action furniture-inspect" id="inspectFurnitureButton">查看家具尺寸与间距 ↗</button>');
    if (detail?.windowStrategy && detail.windowStrategy.mode !== 'outdoor') {
      $('selectionCard').querySelector('.selection-detail').insertAdjacentHTML('afterend', `<div class="selection-window"><span>开窗依据 · ${(detail.windows || []).length} 处外窗</span><p>${esc(detail.windowStrategy.reason)}</p></div>`);
    }
    if (detail?.livingProgram) {
      const program = detail.livingProgram;
      const arrangement = detail.livingLayout?.type === 'compact' && detail.feasibility?.status === 'fit' && Number.isFinite(detail.livingLayout.sofaBackClearanceM) ? `<p>餐厨相邻 · 集中起居<br>沙发离墙摆放，背后预留 ${detail.livingLayout.sofaBackClearanceM.toFixed(1)} m 通道。</p>` : '';
      $('selectionCard').querySelector('.selection-detail').insertAdjacentHTML('beforebegin', `<div class="selection-program"><span>四人标准模块</span><p>用餐 ${program.placedDiningSeats} / ${program.diningSeats} 席 · 起居 ${program.placedLoungeSeats} / ${program.loungeSeats} 席</p>${arrangement}</div>`);
    }
    if (detail?.compactProgram) {
      const program = detail.compactProgram;
      $('selectionCard').querySelector('.selection-detail').insertAdjacentHTML('beforebegin', `<div class="selection-program"><span>起居 + 餐写两用</span><p>${esc(program.use)}<br>可达桌位 ${program.reachableSeats} / ${program.requestedSeats} 席 · 用餐与办公错时共桌</p></div>`);
      if(room.type==='livingSmall'){
        const mode=compactView[room.id]||'expanded';
        $('selectionCard').insertAdjacentHTML('beforeend', `<div class="selection-program"><span>餐写桌状态</span><div class="view-tabs" aria-label="餐写桌状态"><button data-compact-view="stowed" aria-pressed="${mode==='stowed'}" class="${mode==='stowed'?'active':''}">收起休息</button><button data-compact-view="expanded" aria-pressed="${mode==='expanded'}" class="${mode==='expanded'?'active':''}">展开使用</button></div><p>${program.foldable ? mode==='stowed'?'桌椅挂收 · 墙边深 0.15 m':'桌面 1 × 0.5 m · 折叠椅展开' : '餐写桌暂未找到可用位置'}<br>${program.occupiedClear ? '使用区与 0.9 m 沿边通路分开' : '展开使用时通路待调整'}<br>${program.daylightReady?'已有直接外窗':'需先留出朝外采光面'}</p><button class="inline-action" id="improveSmallLivingButton">重排采光与通路 ↗</button></div>`);
      }
    }
    const trip=P.measure(state.rooms,interiorPlan).routes.find(r=>r.roomId===room.id);
    if(trip){const via=trip.via.map(id=>E.getDefinition(state.rooms.find(r=>r.id===id)).name).join(' → ');$('selectionCard').insertAdjacentHTML('beforeend',`<p class="selection-detail">${trip.reachable?`客厅入口 → 此门口：约 ${trip.distanceM.toFixed(1)} m${via?`<br>经过：${esc(via)}`:' · 直接到达'}`:'客厅至此门口的步行通路待调整'}</p>`);}
    if (detail?.accessibility) {
      $('selectionCard').querySelector('.selection-actions').insertAdjacentHTML('beforebegin', `<p class="selection-access" data-attention="${detail.accessibility.anchor === 'door' && detail.accessibility.status !== 'fit'}">${esc(accessSummary(detail.accessibility))}</p>`);
    }
  }
  function accessSummary(access) {
    if (access.issues?.some(issue => issue.code === 'access-disconnected')) return '尚未连通主入口，需先连接模块。';
    if (access.anchor !== 'door') return '尚无可用门口，通达性待核对。';
    const targets = access.targets || [], reached = targets.filter(target => target.reachable === true).length;
    return access.status === 'fit' ? `从门口可走到 ${reached} 处使用位置。` : targets.some(target => target.reachable === false) ? `从门口可达 ${reached} / ${targets.length} 处使用位置，需调整通路。` : '部分设备的使用位置尚待确认。';
  }
  function clearanceText(rule) {
    const parts = [];
    if (rule.frontM) parts.push(`前方 ${rule.frontM.toFixed(2)} m`);
    if (rule.sideM) parts.push(rule.wallSide ? `${DIRECTIONS[rule.wallSide]}侧贴墙，另一侧 ${rule.sideM.toFixed(2)} m` : `两侧各 ${rule.sideM.toFixed(2)} m`);
    if (rule.backM) parts.push(`后方 ${rule.backM.toFixed(2)} m`);
    return parts.join(' / ') || '按实际用途确认';
  }
  function openFurnitureGuide(allRooms = false) {
    const rooms = selected && allRooms !== true ? state.rooms.filter(room => room.id === selected) : state.rooms;
    $('furnitureActual').innerHTML = rooms.map(room => {
      const detail = interiorPlan.byRoom[room.id], items = detail?.furniture || [];
      const issues = detail?.feasibility?.issues || [];
      const messages = [...new Set(issues.map(issue => issue.message || issue.reason).filter(Boolean))];
      const missing = Math.max(0, (detail?.feasibility?.requestedCount || items.length) - items.length);
      const access = detail?.accessibility;
      const accessDetails = access ? `<div class="access-audit"><p>${esc(accessSummary(access))}</p>${access.targets?.length ? `<ul>${access.targets.map(target => `<li>${esc(target.label)}：${target.reachable === true ? '可走到' : target.reachable === false ? '通路受阻' : '待核对'}</li>`).join('')}</ul>` : ''}</div>` : '';
      const rows = items.map(item => {
        const rule = R.resolve(item);
        const actualClearances = { ...rule, ...Object.fromEntries(['frontM', 'sideM', 'backM'].filter(key => Number.isFinite(item[key]) && item[key] >= 0).map(key => [key, item[key]])) };
        const space = item.paired ? '已计入对应桌子的座椅使用区' : clearanceText(actualClearances);
        return `<tr><td>${esc(item.label || rule.label)}${rule.verified === false ? '<br>尺寸待确认' : ''}</td><td>${(item.w * E.CELL_METERS).toFixed(2)} × ${(item.h * E.CELL_METERS).toFixed(2)} m</td><td>${esc(space)}</td></tr>`;
      }).join('');
      return `<details class="furniture-room-audit" data-attention="${!!(missing || messages.length)}" ${(selected && allRooms !== true) || messages.length ? 'open' : ''}><summary>${esc(roomLabel(room))}<span class="audit-count">已绘制 ${items.length} 件</span>${missing || messages.length ? `<span class="attention-tag">${missing ? `${missing} 件未放下` : `${messages.length} 项待确认`}</span>` : ''}</summary>${messages.length ? `<ul>${messages.map(message => `<li>${esc(message)}</li>`).join('')}</ul>` : '<p>当前摆法按设定尺寸与使用空间绘制；可点「使用间距」查看预留位置。</p>'}${accessDetails}${items.length ? `<div class="furniture-table-wrap"><table><thead><tr><th>已画出的家具</th><th>图上占地宽 × 深</th><th>使用空间</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>当前模块没有可绘制的家具。</p>'}</details>`;
    }).join('');
    $('furnitureRulesTable').innerHTML = Object.values(R.PROFILES).map(profile => `<tr><td>${esc(profile.label)}</td><td>${profile.widthM.toFixed(2)} × ${profile.depthM.toFixed(2)} m</td><td>${esc(clearanceText(profile))}</td></tr>`).join('');
    $('furnitureGuideDialog').showModal();
  }
  function renderStats() {
    const stats = E.getStats(state.rooms), validation = E.validateLayout(state.rooms);
    $('interiorArea').textContent = stats.interiorArea.toFixed(1); $('outdoorArea').textContent = stats.outdoorArea.toFixed(1); $('bedroomCount').textContent = stats.bedrooms;
    const disconnected = validation.disconnected.length;
    const voids=E.enclosedVoids(state.rooms);
    $('planStatus').classList.toggle('warning', !!disconnected||!!voids.length);
    $('planStatus').innerHTML = `<i></i>${!state.rooms.length ? '等待第一块积木' : disconnected ? `${disconnected} 个模块待连接` : voids.length ? `存在 ${voids.length} 处中空 <button id="closeVoidsButton">消除中空 ↗</button>` : '模块已连接 · 无中空'}`;
    $('closeVoidsButton')?.addEventListener('click',()=>{const fixed=E.closeVoids(state.rooms,entrySide(),allowedByBuilding);if(!fixed){notify('需要调整多个模块才能消除中空，请通过换个拼法重排。');return;}commit(()=>{state.rooms=fixed.rooms;state.manual=true;selected=null;supersedeProposals();},'已移动或旋转一个模块消除中空，尺寸和数量不变，可撤销。',true);});
    const travel=P.measure(state.rooms,interiorPlan);
    $('circulationSummary').textContent=travel.total?`从客厅入口到各模块门口 · 可达 ${travel.reachable}/${travel.total} · 平均 ${travel.averageM.toFixed(1)} m / 最远 ${travel.maxM.toFixed(1)} m${travel.reachable<travel.total?' · 部分通路待调整':''}`:'生成后计算客厅到各模块的通路';
    $('circulationSummary').title='按已画门洞与家具、0.60米步行包络、0.15米网格估算；不穿墙，不计不可达房间；非施工或无障碍验算。';
    $('planStatus').title = '门窗与家具为自动概念布置；完整交通、净宽与具体居住需求仍需细化。';
    const notes = Object.values(interiorPlan.byRoom).flatMap(detail => detail.notes || []);
    const furnitureIssues = Object.values(interiorPlan.byRoom).reduce((count, detail) => count + (detail.feasibility?.issues?.length || 0), 0);
    $('detailStatus').textContent = furnitureIssues ? `${furnitureIssues} 项家具摆放待调整 · 查看家具尺寸` : notes.length ? `${notes.length} 处细节待调整 · 选中模块查看` : '家具尺寸与使用空间已纳入布置';
    $('detailStatus').dataset.attention = String(furnitureIssues > 0);
    if (furnitureIssues) $('detailStatus').innerHTML = `<span class="attention-tag">! ${furnitureIssues}</span> 家具摆放待调整 ↗`;
    $('entryMigration').hidden = !entryMigration || entryMigration.side !== entrySide();
    $('entryMigration').dataset.attention = String(!!entryMigration?.failed);
    $('entryRuleLabel').textContent = `${entryName()}侧主入口${B.selectedLot(state.conversation) ? ' · 朝向核心筒' : ''} / 1.2 m 预留`;
    document.querySelectorAll('[data-entry-name]').forEach(el => el.textContent = entryName());
    if (entryMigration) $('entryMigrationText').textContent = entryMigration.failed ? `原方案已保留，${entryName()}侧入口仍有遮挡，请手动移开入口带内的模块。` : `为留出${entryName()}侧入口，已移开旧方案中的 ${entryMigration.count} 个模块。`;
    $('moduleMigration').hidden = !moduleMigration;
    $('moduleMigration').dataset.attention = String(!!moduleMigration?.failed);
    $('moduleMigrationText').textContent = moduleMigration?.failed ? '原方案的尺寸转换未完成，已保留原方案备份。' : moduleMigration?.kind === 'bedroom-size' ? '睡房已扩为 3 × 4.5 m，拼接位置已调整，原方案与对话已保留。' : '旧方案已转换为 3 m 标准单元，对话已保留。';
  }
  function renderTray() {
    $('moduleTray').innerHTML = Object.entries(E.TYPES).map(([key, type]) => {
      const w = type.unitW * 20, h = type.unitH * 20;
      const lines = [...Array(Math.max(0, Math.ceil(type.unitW) - 1))].map((_, i) => `<path d="M${(i + 1) * 20} 0v${h}"/>`).join('') + [...Array(Math.max(0, Math.ceil(type.unitH) - 1))].map((_, i) => `<path d="M0 ${(i + 1) * 20}h${w}"/>`).join('');
      return `<div class="module-family"><button class="module-card" draggable="true" data-type="${key}" aria-label="添加${type.name}，${type.unitW}乘${type.unitH}标准单元"><span class="module-add">+</span><span class="module-mini"><svg viewBox="-2 -2 44 44" aria-hidden="true"><g transform="translate(${(40 - w) / 2} ${(40 - h) / 2})"><rect width="${w}" height="${h}" fill="${type.color}" stroke="#c0fe04" stroke-width="1"/><g stroke="#34451b" stroke-width="1">${lines}</g></g></svg></span><strong>${type.name}</strong><b class="module-unit">${type.unitW} × ${type.unitH} 单元</b><small>${(type.w * E.CELL_METERS).toFixed(1)} × ${(type.h * E.CELL_METERS).toFixed(1)} m</small></button>${state.functionLibrary.filter(p=>p.parentType===key).map(p=>`<article class="module-subtype" draggable="true" data-function-module="${esc(p.id)}" tabindex="0" aria-label="${esc(p.title)}，${esc(type.name)}子类型，可拖入平面"><span>↳ ${esc(p.title)}</span><small>${p.widthUnits*3} × ${p.heightUnits*3} m</small><div><button data-add-function="${esc(p.id)}" title="添加子类型">＋</button><button data-open-sketch="${esc(p.id)}" title="查看子类型">查看</button></div></article>`).join('')}</div>`;
    }).join('');
  }
  function renderFunctionLibrary() {
    renderTray();
    const library = state.functionLibrary;
    $('functionModuleDock').hidden = !library.length;
    $('functionModuleTray').innerHTML = [...library].reverse().map(plan => `<article class="function-module-card" draggable="true" data-function-module="${esc(plan.id)}" tabindex="0" aria-label="${esc(plan.title)}，${plan.widthUnits}乘${plan.heightUnits}单元，可拖入平面；按回车添加"><span class="function-module-grip" aria-hidden="true">⠿</span><div><strong>${esc(plan.title)}</strong><small>${plan.widthUnits} × ${plan.heightUnits} 单元 · ${(plan.widthUnits * plan.heightUnits * 9).toFixed(1)} m²</small></div><button data-add-function="${esc(plan.id)}" aria-label="添加${esc(plan.title)}到主平面" title="自动找一个拼接位置">＋</button><button data-open-sketch="${esc(plan.id)}" aria-label="查看${esc(plan.title)}草图" title="查看草图">↗</button></article>`).join('');
    $('functionLibraryCount').textContent = library.length;
    $('functionArchiveCount').textContent = `${library.length} 张已收藏`;
    $('functionLibraryEmpty').hidden = library.length > 0;
    $('functionLibraryBody').hidden = library.length === 0;
    if (!library.some(plan => plan.id === selectedFunction)) selectedFunction = library.at(-1)?.id || null;
    $('functionSketchList').innerHTML = [...library].reverse().map(plan => `<button class="function-list-item${plan.id === selectedFunction ? ' active' : ''}" data-open-sketch="${esc(plan.id)}" aria-pressed="${plan.id === selectedFunction}"><span>${esc(plan.title)}</span><small>${plan.parentType?esc(E.TYPES[plan.parentType].name)+'的子类型 · ':''}${plan.widthUnits} × ${plan.heightUnits} 单元 · ${(plan.widthUnits * plan.heightUnits * 9).toFixed(1)} m²</small></button>`).join('');
    const plan = library.find(item => item.id === selectedFunction);
    $('functionSketchDetail').innerHTML = plan ? `<div class="function-detail-heading"><div><span>FUNCTION STUDY / 3 M SYSTEM</span><h3>${esc(plan.title)}</h3></div><span class="function-saved">已收藏</span></div><p class="function-description">${plan.parentType?`<strong>${esc(E.TYPES[plan.parentType].name)} → ${esc(plan.title)}</strong><br>`:''}${esc(plan.description)}</p><div class="function-drawing">${F.renderSvg(plan)}</div><div class="function-detail-meta"><span>${plan.widthUnits} × ${plan.heightUnits} 标准单元</span><span>${(plan.widthUnits * 3).toFixed(1)} × ${(plan.heightUnits * 3).toFixed(1)} m</span></div>${plan.notes.length ? `<ul class="function-notes">${plan.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}<div class="function-placement-actions"><button data-add-function="${esc(plan.id)}">放入主平面 ＋</button><button data-stage-function="${esc(plan.id)}">展开平面，拖动拼接 ↗</button>${plan.parentType?`<button data-replace-function="${esc(plan.id)}">用于选中的房间</button>`:''}</div><div class="function-actions"><button data-download-sketch="${esc(plan.id)}">下载草图 SVG ↓</button><button data-discuss-sketch="${esc(plan.id)}">继续聊这个功能 ↗</button></div><p class="function-footnote">加入主平面后，门窗和家具随拼接调整。已放入的模块独立保存；草图更新后可移除旧模块，再加入新版。</p>` : '';
    showSketchChecks();
  }
  function showSketchChecks() {
    const plan = state.functionLibrary.find(item => item.id === selectedFunction);
    if (!plan?.checks?.length) return;
    const messages = [...new Set(plan.checks.map(check => check.reason.includes(check.label) ? check.reason : `「${check.label}」${check.reason}`))];
    const heading = plan.unplaced?.length ? `这张草图还有 ${plan.unplaced.length} 件设施待安放` : '尺寸与摆位核对';
    const needsAttention = plan.checks.some(check => check.code !== 'layout-adjusted');
    $('functionSketchDetail').querySelector('.function-description')?.insertAdjacentHTML('afterend', `<div class="furniture-room-audit" data-attention="${needsAttention}"><strong>${heading}</strong>${needsAttention ? '<span class="attention-tag">待确认</span>' : ''}<ul>${messages.map(message => `<li>${esc(message)}</li>`).join('')}</ul><p>上面的文字保留原始愿望；是否能落实，以实际尺寸核对和当前图形为准。</p></div>`);
  }
  function openFunctionLibrary(id) {
    if (id) selectedFunction = id;
    renderFunctionLibrary();
    if (!$('functionLibraryDialog').open) $('functionLibraryDialog').showModal();
  }
  function render() {
    renderWizard(); renderPlan(); renderStats(); renderChat(); renderRequirements(); renderFunctionLibrary();
    $('planIndex').textContent = '方案 ' + String(state.variant + 1).padStart(2, '0'); $('planTitle').textContent = state.title;
    $('undoButton').disabled = !history.length; $('redoButton').disabled = !future.length;
    $('summaryStatus').textContent = state.manual ? '手动拼搭中' : '实时预览';
  }
  function syncPreferences() {
    supersedeProposals();
    const bedroomCount = state.rooms.filter(E.isBedroom).length;
    if (bedroomCount >= 1 && bedroomCount <= 4) state.prefs.bedrooms = bedroomCount;
    state.prefs.singleBedrooms=Math.min(state.prefs.bedrooms,state.rooms.filter(r=>r.type==='bedroomSingle').length);
    const living = state.rooms.find(r => r.type.startsWith('living'));
    if (living) state.prefs.living = ({livingLarge:'large',livingSmall:'small',livingMedium:'medium'}[living.type]);
    state.prefs.gardenCount=Math.max(1,Math.min(8,state.rooms.filter(r=>r.type==='garden').length));
    state.prefs.balconyCount=Math.max(1,Math.min(8,state.rooms.filter(r=>r.type==='balcony').length));
    const balcony = state.rooms.some(r => r.type === 'balcony'), garden = state.rooms.some(r => r.type === 'garden');
    state.prefs.outdoor = balcony ? (garden ? 'both' : 'balcony') : garden ? 'garden' : 'none';
    S.syncManualRequirements(state.conversation,state.prefs,state.rooms);
    state.conversation.moduleCounts=M.counts(state.rooms);
    for(const [present,key] of [[garden,'gardenCourtyard'],[balcony,'balconyBedroom']])if(!present){state.constraints[key]=false;state.conversation.requirements=state.conversation.requirements.filter(r=>r.id!==key);} 
  }
  function placementMessage(candidate) {
    const blocked = B.violation(candidate, buildingPlacement()) || B.entryViolation(candidate, buildingPlacement());
    if (blocked) return blocked;
    const rooms = state.rooms.filter(room => room.id !== candidate.id).concat(candidate);
    if(E.enclosedVoids(rooms).length)return '这样拼会围出内部中空，请调整相邻模块。';
    return E.entranceConflicts(rooms, entrySide()).length ? `客厅${entryName()}侧是主入口，1.2 米入口带不能拼接模块。` : '这里与模块重叠或超出范围，换个位置试试。';
  }
  function addModule(type, position) {
    if (!B.preference(state.conversation)) { renderOrientation(); notify('先确认住户朝向，再添加空间。'); return; }
    if (!Object.hasOwn(E.TYPES, type)) return;
    if (state.rooms.length >= 40) { notify('这一版先放 40 块积木，试着整理一下现有空间。'); return; }
    const definition = E.TYPES[type];
    let found;
    try { found = position || E.findFreePosition(type, state.rooms, entrySide(), allowedByBuilding); } catch (_) { notify('分户允许范围内没有可用位置，请先整理模块。'); return; }
    const room = { id: 'module-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), type, ...found, w: definition.w, h: definition.h, rotation: 0 };
    if (Math.abs(room.x) > MAX_COORD || Math.abs(room.y) > MAX_COORD) { notify('已到拼搭范围边缘，试着把模块移近一些。'); return; }
    if (!canPlace(room)) { notify(placementMessage(room)); return; }
    commit(() => { state.rooms.push(room); state.manual = true; selected = room.id; syncPreferences(); }, `已添加${definition.name}，拖动它试试。`, true);
  }
  function addFunctionModule(id, position) {
    if (!B.preference(state.conversation)) { renderOrientation(); notify('先确认住户朝向，再添加空间。'); return; }
    const plan = state.functionLibrary.find(item => item.id === id);
    if (!plan) return;
    if (state.rooms.length >= 40) { notify('这一版先放 40 块积木，试着整理一下现有空间。'); return; }
    let room;
    try {
      room = E.createCustomRoom(plan, 'function-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6));
      Object.assign(room, position || E.findFreePosition(room, state.rooms, entrySide(), allowedByBuilding));
    } catch (_) { notify('附近没有可用位置，请先整理模块或拖到空白区域。'); return; }
    if (Math.abs(room.x) > MAX_COORD || Math.abs(room.y) > MAX_COORD) { notify('已到拼搭范围边缘，试着把模块移近一些。'); return; }
    if (!canPlace(room)) { notify(placementMessage(room)); return; }
    commit(() => { state.rooms.push(room); state.manual = true; selected = room.id; syncPreferences(); }, `已把「${plan.title}」放入主平面，可以移动、旋转和拼接。`, true);
    $('functionLibraryDialog').close();
    document.dispatchEvent(new CustomEvent('wishouse:reveal-plan', { detail: { focus: false } }));
  }
  function replaceFunctionModule(id){
    const room=state.rooms.find(r=>r.id===selected),plan=state.functionLibrary.find(p=>p.id===id);
    if(!room){notify('请先在平面中选中要修改的房间。');$('functionLibraryDialog').close();document.dispatchEvent(new CustomEvent('wishouse:reveal-plan'));return;}
    try{
      const tx=M.compile([{action:'replace',type:'custom',count:1,roomId:room.id,sketchId:id,anchorId:null}],state.rooms,state.functionLibrary);
      const result=M.execute(state.rooms,tx,state.prefs,state.constraints,state.conversation,buildingPlacement());
      if(!result.ok){notify(result.reason);return;}
      commit(()=>{state.rooms=result.rooms;state.manual=true;syncPreferences();},`已将选中房间替换为「${plan.title}」，${result.reassembled?`已重新拼接，移动了 ${result.movedIds.length} 个模块`:'其余模块保留'}。`,true);
      $('functionLibraryDialog').close();document.dispatchEvent(new CustomEvent('wishouse:reveal-plan'));
    }catch(error){notify(error.message);}
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-replace-function]');if(button&&!chatFlight)replaceFunctionModule(button.dataset.replaceFunction);});
  function stageFunctionModule(id) {
    $('functionLibraryDialog').close();
    document.dispatchEvent(new CustomEvent('wishouse:reveal-plan', { detail: { focus: false } }));
    requestAnimationFrame(() => {
      const card = [...$('functionModuleTray').children].find(item => item.dataset.functionModule === id);
      card?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      card?.focus({ preventScroll: true });
      notify('抓住功能卡拖入画布，贴到模块边缘即可拼接。');
    });
  }
  function rotateSelected() {
    if (!selected) return;
    const next = E.rotateRoom(state.rooms, selected, entrySide());
    if (!next || E.enclosedVoids(next).length || next.some(r => Math.abs(r.x) > MAX_COORD || Math.abs(r.y) > MAX_COORD || !allowedByBuilding(r))) { notify('旋转会碰到模块、入口净空或楼栋分户禁区，先移开一点。'); return; }
    commit(() => { state.rooms = next; state.manual = true; }, '模块已旋转 90°');
  }
  function deleteSelected() {
    if (!selected) return;
    if(E.enclosedVoids(state.rooms.filter(r=>r.id!==selected)).length){notify('移除后会留下内部中空，请先调整相邻模块。');return;}
    commit(() => { state.rooms = state.rooms.filter(r => r.id !== selected); selected = null; state.manual = true; syncPreferences(); }, '已移除模块，可以撤销恢复。', true);
  }
  function clientToSvg(clientX, clientY) {
    const point = $('planSvg').createSVGPoint(); point.x = clientX; point.y = clientY;
    return point.matrixTransform($('planSvg').getScreenCTM().inverse());
  }
  function startDrag(event) {
    if (event.button !== 0 || drag) return;
    const target = event.target.closest('[data-room]');
    if (!target) { if (selected) { selected = null; renderPlan(); } return; }
    event.preventDefault();
    const room = state.rooms.find(r => r.id === target.dataset.room), point = clientToSvg(event.clientX, event.clientY);
    selected = room.id;
    drag = { id: room.id, original: { ...room }, startX: event.clientX, startY: event.clientY, offsetX: point.x - room.x * GRID, offsetY: point.y - room.y * GRID, moved: false, pointerId: event.pointerId, nextX: room.x, nextY: room.y };
    renderPlan(); $('planSvg').setPointerCapture(event.pointerId);
  }
  function dragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4 && !drag.moved) return;
    drag.moved = true;
    const previousX = drag.nextX, previousY = drag.nextY;
    const point = clientToSvg(event.clientX, event.clientY);
    drag.nextX = Math.round((point.x - drag.offsetX) / GRID / E.HALF_MODULE_CELLS) * E.HALF_MODULE_CELLS; drag.nextY = Math.round((point.y - drag.offsetY) / GRID / E.HALF_MODULE_CELLS) * E.HALF_MODULE_CELLS;
    if (previousX === drag.nextX && previousY === drag.nextY) return;
    const proposed = { ...drag.original, x: drag.nextX, y: drag.nextY };
    renderPlan(state.rooms.map(room => room.id === drag.id ? proposed : room));
    const node = $('room-' + drag.id);
    node.classList.add('dragging'); node.classList.toggle('invalid', !canPlace(proposed, drag.id));
  }
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag; drag = null;
    if ($('planSvg').hasPointerCapture(event.pointerId)) $('planSvg').releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel' || !current.moved || (current.nextX === current.original.x && current.nextY === current.original.y)) { renderPlan(); $('room-' + selected)?.focus({ preventScroll: true }); return; }
    const next = E.moveRoom(state.rooms, current.id, current.nextX, current.nextY, entrySide());
    if (!next || E.enclosedVoids(next).length || !allowedByBuilding({ ...current.original, x: current.nextX, y: current.nextY }) || Math.abs(current.nextX) > MAX_COORD || Math.abs(current.nextY) > MAX_COORD) { renderPlan(); notify(placementMessage({ ...current.original, x: current.nextX, y: current.nextY }) + ' 已放回原位。'); return; }
    commit(() => { state.rooms = next; state.manual = true; }, undefined, true);
    $('room-' + selected)?.focus({ preventScroll: true });
  }
  function download(name, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportSvg() {
    if (!state.rooms.length) { notify('先放一块空间积木，再导出平面。'); return; }
    interiorPlan = I.analyze(state.rooms, state.prefs, { obstacles: B.siteObstacles(buildingPlacement()) });
    const stats = E.getStats(state.rooms), bounds = planBounds(), width = Math.max(600, bounds.width * GRID + 140), height = bounds.height * GRID + 550;
    const tx = (width - bounds.width * GRID) / 2 - bounds.minX * GRID, ty = 442 - bounds.minY * GRID;
    const buildingGraphic = B.svg(state.rooms, state.conversation, buildingPlacement()).replace('viewBox=', 'x="32" y="70" width="' + (width - 64) + '" height="300" viewBox=');
    const statusLines = [...buildingStatus(state.rooms)].join('').match(/.{1,55}/g) || [];
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 2}" height="${height * 2}" viewBox="0 0 ${width} ${height}"><style>${D.STYLES}text{font-family:'Microsoft YaHei','PingFang SC',sans-serif}.room-outline{stroke:#69785c;stroke-width:1.3}.furniture{stroke:#9ca48d;fill:none;stroke-width:.8}.furniture-fill{fill:#ffffff4a}.garden-plant{stroke:#97a379;fill:#adb98944;stroke-width:.7}.room-label{font-size:9px;fill:#57614c}.room-area{font-size:6px;fill:#8a927e}.dimension-line{stroke:#a8b497;stroke-width:.6;fill:none}.dimension-text{font-size:7px;fill:#8c9c79}</style><rect width="100%" height="100%" fill="#fafbf7"/><text x="32" y="33" font-size="17" fill="#415637">愿居 / ${esc(state.title)}</text><text x="32" y="53" font-size="9" fill="#8f9d80">室内模块 ${stats.interiorArea.toFixed(1)} m² · 户外模块 ${stats.outdoorArea.toFixed(1)} m² · ${stats.bedrooms} 间睡房 · ${B.preference(state.conversation) ? DIRECTIONS[B.preference(state.conversation)] + "向已确认" : "朝向待确认"}</text><g transform="translate(${width - 36} 36)"><text x="0" y="-11" text-anchor="middle" font-size="9" fill="#7a8f64">N</text><path d="M0-5-5 10 0 7 5 10Z" fill="#7a8f64"/></g>${buildingGraphic}${statusLines.slice(0, 4).map((line, index) => `<text x="32" y="${382 + index * 11}" font-size="8" fill="#7b3653">${esc(line)}</text>`).join('')}<g transform="translate(${tx} ${ty})">${B.boundarySvg(buildingPlacement(), { x: bounds.minX * GRID - 35, y: bounds.minY * GRID - 28, width: bounds.width * GRID + 70, height: bounds.height * GRID + 56 }, GRID)}${dimensionMarkup()}${D.entrances(E.getEntranceZones(state.rooms, entrySide()), GRID, interiorPlan.byRoom)}${state.rooms.map(r => roomMarkup(r, true)).join('')}${state.rooms.map(r => D.openings(r, interiorPlan.byRoom[r.id], state.rooms, GRID)).join('')}</g><text x="32" y="${height - 30}" font-size="8" fill="#9aa58e">概念模块平面 · 标准单元 = 3 × 3 m · 面积不含墙体 · 尚未完成结构与完整交通校核</text><text x="32" y="${height - 16}" font-size="7" fill="#a8b09e">WISHOUSE — A LITTLE WISH, A PLACE TO LIVE.</text></svg>`;
    const withGrid = markup.replace('<style>', D.DEFS + '<style>');
    download(`${state.title.replace(/[<>:"/\\|?*]/g, '')}-平面.svg`, withGrid, 'image/svg+xml;charset=utf-8'); notify('平面已导出为可缩放的 SVG 文件。');
  }

  $('stepNav').addEventListener('click', event => { const btn = event.target.closest('[data-step]'); if (!btn) return; state.step = Number(btn.dataset.step); renderWizard(); persist(); });
  $('wizardContent').addEventListener('click', event => {
    const btn = event.target.closest('[data-pref]'); if (!btn) return;
    const key = btn.dataset.pref, value = ['bedrooms','singleBedrooms'].includes(key) ? Number(btn.dataset.value) : btn.dataset.value;
    if (key === 'orientation') { chooseOrientation(value); return; }
    if (state.prefs[key] === value) return;
    const change = { [key]: value };
    if (key === 'household') { change.bedrooms = { solo: 1, couple: 2, family: 3 }[value]; }
    if(change.bedrooms!==undefined)change.singleBedrooms=Math.min(state.prefs.singleBedrooms||0,change.bedrooms);
    regenerate(change);
  });
  $('wizardActions').addEventListener('click', event => {
    if (event.target.closest('#prevStep')) state.step = Math.max(0, state.step - 1);
    if (event.target.closest('#nextStep')) {
      if (state.step < 3) state.step++;
      else { if (!B.preference(state.conversation)) { notify('先确认住户朝向。'); return; } state.completed = true; notify('愿望已经成形。试试拖动模块，让这个家更像你。'); document.dispatchEvent(new CustomEvent('wishouse:reveal-plan'));  }
    }
    renderWizard(); persist();
  });
  $('wishForm').addEventListener('submit', event => {
    event.preventDefault(); sendWish($('wishInput').value);
  });
  $('wishInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); $('wishForm').requestSubmit(); } });
  $('wishInput').addEventListener('input', () => { state.chatDraft = $('wishInput').value; renderChatControls(); persist(); });
  $('cancelChatButton').addEventListener('click', () => cancelChat());
  $('retryChatButton').addEventListener('click', () => { if (state.pendingChat) sendWish(state.pendingChat.text, true); });
  $('checkModelButton').addEventListener('click', checkModelStatus);
  $('modelChoice').addEventListener('change', () => {
    if (chatFlight) return;
    preferredModel=$('modelChoice').value;
    try { localStorage.setItem('wishouse.model',preferredModel); } catch {}
    modelState.ready=false; checkModelStatus();
  });
  function setInputMode(mode) { state.inputMode = mode; renderChat(mode === 'chat'); persist(); if (mode === 'chat') $('wishInput').focus({ preventScroll: true }); }
  $('workspaceChatButton').addEventListener('click', () => setInputMode('chat'));
  $('chatModeButton').addEventListener('click', () => setInputMode('chat'));
  $('guideModeButton').addEventListener('click', () => setInputMode('guide'));
  $('backToChatButton').addEventListener('click', () => setInputMode('chat'));
  document.querySelector('.input-mode-tabs').addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setInputMode(state.inputMode === 'guide' ? 'chat' : 'guide'); $(state.inputMode === 'guide' ? 'guideModeButton' : 'chatModeButton').focus(); } });
  document.addEventListener('click', event => {
    const prompt = event.target.closest('[data-chat-prompt]'); if (prompt) sendWish(prompt.dataset.chatPrompt);
    const sketch = event.target.closest('[data-open-sketch]'); if (sketch) openFunctionLibrary(sketch.dataset.openSketch);
    const addFunction = event.target.closest('[data-add-function]'); if (addFunction) addFunctionModule(addFunction.dataset.addFunction);
    const stageFunction = event.target.closest('[data-stage-function]'); if (stageFunction) stageFunctionModule(stageFunction.dataset.stageFunction);
    const exportSketch = event.target.closest('[data-download-sketch]');
    if (exportSketch) {
      const plan = state.functionLibrary.find(item => item.id === exportSketch.dataset.downloadSketch);
      if (plan) { download(`${plan.title.replace(/[<>:"/\\|?*]/g, '')}-功能草图.svg`, F.renderSvg(plan, { export: true }), 'image/svg+xml;charset=utf-8'); notify('功能草图已下载。'); }
    }
    const discuss = event.target.closest('[data-discuss-sketch]');
    if (discuss) {
      const plan = state.functionLibrary.find(item => item.id === discuss.dataset.discussSketch);
      if (plan) {
        $('functionLibraryDialog').close();
        if (state.conversation.contextScope) state.conversation.contextScope.functionIds = [...new Set([...state.conversation.contextScope.functionIds, plan.id])];
        state.chatDraft = (state.chatDraft ? state.chatDraft + '\n' : '') + `我想继续调整「${plan.title}」：`;
        state.chatDraft = state.chatDraft.slice(0, 1200); $('wishInput').value = state.chatDraft;
        setInputMode('chat'); $('wishInput').focus();
      }
    }
    const revise=event.target.closest('[data-revise-proposal]');
    if(revise&&!chatFlight){$('wishInput').value='我想调整刚才的方案：';state.chatDraft=$('wishInput').value;$('wishInput').focus();renderChatControls();persist();}
    const reject=event.target.closest('[data-reject-proposal]');
    if(reject&&!chatFlight){const m=state.conversation.messages.find(m=>m.id===reject.dataset.rejectProposal);if(m&&!m.applied){m.superseded=true;m.choices=[];m.applicationNote='你选择暂不修改，当前平面保持不变。';renderChat(true);persist();}}
    const apply = event.target.closest('[data-apply-proposal]'); if (apply) applyProposal(apply.dataset.applyProposal);
    const remove = event.target.closest('[data-remove-requirement]');
    if (remove) { if (chatFlight) cancelChat('需求已更新，可以按新的需求重新回答。'); const id = remove.dataset.removeRequirement; state.conversation.requirements = state.conversation.requirements.filter(item => item.id !== id); if (Object.hasOwn(state.constraints, id)) state.constraints[id] = false; supersedeProposals(); renderChat(); renderRequirements(); persist(); notify('已移除这项需求，现有模块保持原位。'); }
  });
  function restartConversation() {
    if (!conversationBackup) conversationBackup = clone({ conversation: state.conversation, chatDraft: state.chatDraft, pendingChat: state.pendingChat, constraints: state.constraints });
    cancelChat('', true);
    state.conversation = C.newSession(); state.constraints = cleanConstraints();
    state.chatDraft = ''; state.pendingChat = null; chatError = ''; $('wishInput').value = '';
    setInputMode('chat'); renderPlan(); renderRequirements(); renderChat(true); persist();
  }
  $('clearChatButton').addEventListener('click', restartConversation);
  $('sharePlanWithChat').addEventListener('click', () => {
    if (chatFlight || !state.conversation.contextScope) return;
    state.conversation.contextScope.planShared = true;
    renderChat(); persist(); notify('已将当前平面带入这次对话，旧聊天记录和未选中的草图仍不读取。');
  });
  $('undoClearChatButton').addEventListener('click', () => {
    if (!conversationBackup) return;
    cancelChat('', true);
    Object.assign(state, clone(conversationBackup)); conversationBackup = null;
    $('wishInput').value = state.chatDraft;
    chatError = state.pendingChat ? '已恢复上一次对话。未完成的回答可以重新回答。' : '';
    setInputMode('chat'); renderPlan(); renderRequirements(); renderChat(true); persist();
  });
  $('optimizeRoutesButton').addEventListener('click', async()=>{
    $('optimizeRoutesButton').disabled=true;$('alternateButton').disabled=true;notify('正在比较客厅到各模块的通路…');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{
      const result=M.optimizeLayout(state.rooms,state.prefs,state.constraints,state.conversation,buildingPlacement());
      if(!result.ok){notify(result.reason);return;}
      if(!result.movedIds.length){notify('当前候选中没有找到更好的动线，保留现有平面。');return;}
      commit(()=>{state.rooms=result.rooms;state.manual=true;selected=null;supersedeProposals();},`已重排 ${result.movedIds.length} 个模块，保留全部功能与尺寸；客厅到模块最远约 ${result.after.maxM.toFixed(1)} m。`,true);
    }finally{$('optimizeRoutesButton').disabled=false;$('alternateButton').disabled=false;}
  });
  const recentLayouts=[];
  $('alternateButton').addEventListener('click', async()=>{
    $('alternateButton').disabled=true;$('optimizeRoutesButton').disabled=true;notify('正在挑选另一种可行拼法…');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{
      const oldKey=M.layoutKey(state.rooms),result=M.optimizeLayout(state.rooms,state.prefs,state.constraints,state.conversation,buildingPlacement(),{randomize:true,recent:recentLayouts});
      if(!result.ok){notify(result.reason);return;}
      if(!result.movedIds.length){notify('暂时没有找到不同且动线相近的可行拼法，保留当前方案。');return;}
      commit(()=>{state.rooms=result.rooms;state.variant++;state.manual=true;selected=null;supersedeProposals();},result.reused?'已换成另一种可行拼法；近期候选已轮过，开始重新选择。':'已随机换一种拼法，保留全部模块、尺寸与功能。',true);
      recentLayouts.push(oldKey,M.layoutKey(result.rooms));if(recentLayouts.length>16)recentLayouts.splice(0,recentLayouts.length-16);
    }finally{$('alternateButton').disabled=false;$('optimizeRoutesButton').disabled=false;}
  });
  $('moduleTray').addEventListener('click', event => { const target = event.target.closest('[data-type]'); if (target) addModule(target.dataset.type); });
  $('moduleTray').addEventListener('dragstart', event => { const target = event.target.closest('[data-type]'); if (!target) return; event.dataTransfer.setData('application/x-wishouse-module', target.dataset.type); event.dataTransfer.effectAllowed = 'copy'; });
  let libraryDrag = null;
  function clearLibraryDrop() { $('canvasWrap').classList.remove('drop-active'); $('moduleDropPreview')?.remove(); }
  function libraryDropPosition(event, shape) {
    const point = clientToSvg(event.clientX, event.clientY);
    return { x: Math.round((point.x / GRID - shape.w / 2) / E.HALF_MODULE_CELLS) * E.HALF_MODULE_CELLS, y: Math.round((point.y / GRID - shape.h / 2) / E.HALF_MODULE_CELLS) * E.HALF_MODULE_CELLS };
  }
  document.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-function-module]');
    const plan = state.functionLibrary.find(item => item.id === card?.dataset.functionModule);
    if (!plan) return;
    libraryDrag = E.createCustomRoom(plan, 'drop-preview');
    event.dataTransfer.setData('application/x-wishouse-function', plan.id);
    event.dataTransfer.effectAllowed = 'copy';
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('[data-function-module]')) { event.preventDefault(); addFunctionModule(event.target.dataset.functionModule); }
  });
  document.addEventListener('dragend', () => { libraryDrag = null; clearLibraryDrop(); });
  $('canvasWrap').addEventListener('dragover', event => {
    if (!Array.from(event.dataTransfer.types).some(type => ['application/x-wishouse-module', 'application/x-wishouse-function'].includes(type))) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('canvasWrap').classList.add('drop-active');
    if (!libraryDrag) return;
    const candidate = { ...libraryDrag, ...libraryDropPosition(event, libraryDrag) };
    const valid = Math.abs(candidate.x) <= MAX_COORD && Math.abs(candidate.y) <= MAX_COORD && canPlace(candidate);
    let preview = $('moduleDropPreview');
    if (!preview) { preview = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); preview.id = 'moduleDropPreview'; preview.setAttribute('pointer-events', 'none'); $('planSvg').appendChild(preview); }
    Object.entries({ x: candidate.x * GRID, y: candidate.y * GRID, width: candidate.w * GRID, height: candidate.h * GRID, 'data-valid': valid, fill: valid ? '#c0fe0430' : '#ef886540', stroke: valid ? '#c0fe04' : '#ef8865', 'stroke-width': 2, 'stroke-dasharray': '5 3' }).forEach(([key, value]) => preview.setAttribute(key, value));
  });
  $('canvasWrap').addEventListener('dragleave', event => { if (!$('canvasWrap').contains(event.relatedTarget)) clearLibraryDrop(); });
  $('canvasWrap').addEventListener('drop', event => {
    event.preventDefault(); clearLibraryDrop();
    const id = event.dataTransfer.getData('application/x-wishouse-function');
    const plan = state.functionLibrary.find(item => item.id === id);
    if (plan) { const shape = E.createCustomRoom(plan, 'drop-preview'); addFunctionModule(id, libraryDropPosition(event, shape)); }
    else { const type = event.dataTransfer.getData('application/x-wishouse-module'); if (Object.hasOwn(E.TYPES, type)) addModule(type, libraryDropPosition(event, E.TYPES[type])); }
    libraryDrag = null;
  });
  $('planSvg').addEventListener('pointerdown', startDrag); $('planSvg').addEventListener('pointermove', dragMove); $('planSvg').addEventListener('pointerup', endDrag); $('planSvg').addEventListener('pointercancel', endDrag);
  $('planSvg').addEventListener('keydown', event => {
    const target = event.target.closest('[data-room]'); if (!target) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selected = target.dataset.room; renderPlan(); $('room-' + selected)?.focus(); }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault(); selected = target.dataset.room; const room = state.rooms.find(r => r.id === selected);
    if (Math.abs(room.x + delta[0]) > MAX_COORD || Math.abs(room.y + delta[1]) > MAX_COORD) { notify('已到拼搭范围边缘，换个方向试试。'); return; }
    const next = E.moveRoom(state.rooms, selected, room.x + delta[0], room.y + delta[1], entrySide());
    if (!next || E.enclosedVoids(next).length || !allowedByBuilding({ ...room, x: room.x + delta[0], y: room.y + delta[1] })) { notify(placementMessage({ ...room, x: room.x + delta[0], y: room.y + delta[1] })); return; }
    commit(() => { state.rooms = next; state.manual = true; }, undefined, true); $('room-' + selected)?.focus({ preventScroll: true });
  });
  $('selectionCard').addEventListener('click', event => {
    const modeButton=event.target.closest('[data-compact-view]');
    if(modeButton){compactView[selected]=modeButton.dataset.compactView;renderPlan();return;}
    if(event.target.closest('#improveSmallLivingButton')){
      try{
        const revised=B.improveSmallLiving(state.rooms,state.conversation,buildingPlacement(),entrySide());
        localStorage.setItem(SMALL_LIVING_BACKUP,JSON.stringify(state));
        commit(()=>{state.rooms=revised.rooms;state.buildingPlacement=revised.placement;state.manual=true;compactView[selected]='expanded';},'已为小客厅留出采光面并重排门口，可撤销。',true);
      }catch(_){notify('暂未找到保留全部模块的采光拼法，原方案已保留。');}
      return;
    }
    if (event.target.closest('#rotateButton')) rotateSelected();
    if (event.target.closest('#deleteButton')) deleteSelected();
    if (event.target.closest('#deselectButton')) { selected = null; renderPlan(); }
  });
  $('undoButton').addEventListener('click', undo); $('redoButton').addEventListener('click', redo);
  $('zoomInButton').addEventListener('click', () => { zoom = Math.min(1.8, +(zoom + .15).toFixed(2)); renderPlan(); });
  $('zoomOutButton').addEventListener('click', () => { zoom = Math.max(.6, +(zoom - .15).toFixed(2)); renderPlan(); });
  $('buildingExtentButton').addEventListener('click', () => { showBuildingExtent = !showBuildingExtent; $('buildingExtentButton').setAttribute('aria-pressed', String(showBuildingExtent)); baseBox = null; zoom = 1; renderPlan(); });
  $('fitButton').addEventListener('click', () => { zoom = 1; baseBox = null; renderPlan(); });
  $('clearanceButton').addEventListener('click', () => { showClearances = !showClearances; $('clearanceButton').setAttribute('aria-pressed', String(showClearances)); renderPlan(); });
  $('furnitureGuideButton').addEventListener('click', openFurnitureGuide);
  $('detailStatus').addEventListener('click', () => openFurnitureGuide(true));
  $('selectionCard').addEventListener('click', event => { if (event.target.closest('#inspectFurnitureButton')) openFurnitureGuide(); });
  function switchView(next) { view = next; $('planViewButton').classList.toggle('active', view === 'plan'); $('blockViewButton').classList.toggle('active', view === 'blocks'); $('planViewButton').setAttribute('aria-pressed', view === 'plan'); $('blockViewButton').setAttribute('aria-pressed', view === 'blocks'); renderPlan(); }
  $('planViewButton').addEventListener('click', () => switchView('plan')); $('blockViewButton').addEventListener('click', () => switchView('blocks'));
  $('helpButton').addEventListener('click', () => $('helpDialog').showModal());
  $('renameButton').addEventListener('click', () => { $('nameInput').value = state.title; $('renameDialog').showModal(); $('nameInput').select(); });
  $('renameForm').addEventListener('submit', event => { event.preventDefault(); const name = $('nameInput').value.trim(); if (!name) return; commit(() => { state.title = name; }); $('renameDialog').close(); });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $('confirmAccept').addEventListener('click', () => { $('confirmDialog').close(); const action = confirmAction; confirmAction = null; action?.(); });
  $('saveButton').addEventListener('click', () => { download(`${state.title.replace(/[<>:"/\\|?*]/g, '')}.wishouse.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8'); notify('方案已保存，之后可以通过「载入方案」继续设计。'); });
  $('exportButton').addEventListener('click', exportSvg);
  $('openFunctionLibraryButton').addEventListener('click', () => openFunctionLibrary());
  $('backupFunctionLibrary').addEventListener('click', () => $('saveButton').click());
  $('collectFunctionSketches').addEventListener('click', () => {
    if (chatFlight || !modelState.ready) return;
    $('functionLibraryDialog').close();
    sendWish('请整理这段对话里我已经明确提出、六种基础模块之外的空间功能。为每个功能画一张概念功能平面并收入草图库；已有同名草图就更新。不要把你建议但我没确认的功能当成我的需求。');
  });
  $('functionEmptyChatButton').addEventListener('click', () => { $('functionLibraryDialog').close(); setInputMode('chat'); $('wishInput').focus(); });
  $('downloadModuleBackup').addEventListener('click', () => { if (moduleMigration?.original) download(moduleMigration.kind === 'bedroom-size' ? '睡房扩大前.wishouse.json' : '尺寸标准化前.wishouse.json', JSON.stringify(moduleMigration.original, null, 2), 'application/json;charset=utf-8'); });
  $('dismissModuleMigration').addEventListener('click', () => { dismissModuleNotice(); renderStats(); });
  $('downloadEntryBackup').addEventListener('click', () => { if (entryMigration?.original) download('入口调整前.wishouse.json', JSON.stringify(entryMigration.original, null, 2), 'application/json;charset=utf-8'); });
  $('dismissEntryMigration').addEventListener('click', () => { dismissEntryNotice(); renderStats(); });
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 1500000) throw new Error('文件太大');
      const data = JSON.parse(await file.text()); if (!validDesign(data)) throw new Error('格式或模块无效');
      askReplace('载入保存的方案？', `将打开「${data.title}」，替换当前画布、聊天记录和需求清单。`, () => commit(() => { dismissEntryNotice(); dismissModuleNotice(); conversationBackup = null; const library = state.functionLibrary; state = cleanDesign(data); state.functionLibrary = F.mergeLibrary(library, state.functionLibrary); legacyEntryOriginal = !Object.hasOwn(DIRECTIONS, data.prefs.entranceSide) ? { ...clone(data), prefs: { ...data.prefs, entranceSide: 'south' } } : null; enforceEntryRule(); chatNoticeTone = 'note'; chatError = state.pendingChat ? '载入的对话有一条尚未完成的回答，可以继续回答。' : ''; selected = null; $('wishInput').value = state.chatDraft; }, '方案与对话已载入，可以继续拼搭。', true), '载入方案');
    } catch (_) { notify('没有读懂这个文件，请选择从愿居保存的有效 JSON 方案。'); }
    event.target.value = '';
  });
  $('resetButton').addEventListener('click', () => askReplace('重新开始一个愿望？', '清空当前平面、对话、需求和功能草图库，从空白开始。需要继续旧方案时，请先保存方案。', () => commit(() => { dismissEntryNotice(); dismissModuleNotice(); conversationBackup = null; state = freshState(); chatError = ''; selected = null; $('wishInput').value = ''; }, '新的空白，新的可能。', true), '重新开始'));
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || $('designPanel').hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    if (event.key === 'Delete' || event.key === 'Backspace') { if (selected) { event.preventDefault(); deleteSelected(); } }
    if (event.key.toLowerCase() === 'r' && selected && !event.ctrlKey && !event.metaKey) rotateSelected();
    if (event.key === 'Escape') { selected = null; renderPlan(); }
  });
  document.addEventListener('wishouse:plan-open', () => { zoom = 1; baseBox = null; renderPlan(); renderChat(true); });
  document.addEventListener('wishouse:plan-close', () => renderChat(true));
  // Integration point for a future entrance selector; daylight orientation stays independent.
  window.WishouseDesign = Object.freeze({
    setEntranceSide(side) {
      if (!Object.hasOwn(DIRECTIONS, side)) throw new TypeError('入口方向必须是 north、east、south 或 west');
      if (B.selectedLot(state.conversation) && side !== entrySide()) throw new Error('当前主入口随核心筒方向自动同步，请通过住户位置调整。');
      if (side === entrySide()) return { entranceSide: side, movedModuleCount: 0 };
      const original = clone(state), repaired = E.repairEntrance(state.rooms, side);
      repaired.rooms = B.fit(repaired.rooms, buildingPlacement(), side);
      if (E.entranceConflicts(repaired.rooms, side).length) throw new Error('没有找到可用的入口净空');
      commit(() => {
        dismissEntryNotice(); state.prefs.entranceSide = side; state.rooms = repaired.rooms;
        state.manual = true; supersedeProposals();
        if (repaired.movedIds.length) {
          entryMigration = { original, side, count: repaired.movedIds.length };
          try { localStorage.setItem(ENTRY_BACKUP, JSON.stringify(entryMigration)); } catch (_) { storageWorks = false; }
        }
      }, `主入口已调整到${DIRECTIONS[side]}侧。`, true);
      return { entranceSide: side, movedModuleCount: repaired.movedIds.length };
    }
  });
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!drag) { baseBox = null; renderPlan(); } }, 100); }).observe($('canvasWrap'));
  $('wishInput').value = state.chatDraft;
  renderTray(); render(); renderChat(true);
  document.fonts?.ready.then(() => { $('chatMessages').scrollTop = $('chatMessages').scrollHeight; });
  checkModelStatus();
})();

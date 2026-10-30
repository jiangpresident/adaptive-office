(function (root, factory) {
  'use strict';
  var engine = typeof module === 'object' && module.exports ? require('./engine.js') : root.WishEngine;
  var api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishConversation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  var MAX_MESSAGES = 60, MAX_REQUIREMENTS = 24;
  var NUMBERS = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  var FENGSHUI_IDS = ['fengshui', 'separateKitchenBedroom', 'compactFootprint', 'entryStove', 'bedDoor', 'headboard'];
  var ENUMS = {
    household: ['solo', 'couple', 'family'], living: ['large', 'small', 'medium'],
    outdoor: ['none', 'balcony', 'garden', 'both'], orientation: ['south', 'west', 'north', 'east'],
    lifestyle: ['relaxed', 'social', 'quiet']
  };
  function cleanText(value, limit) { return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit) : ''; }
  function normalizePrefs(input) {
    var prefs = Object.assign({}, E.DEFAULTS);
    if (!input || typeof input !== 'object') return prefs;
    Object.keys(ENUMS).forEach(function (key) { if (ENUMS[key].indexOf(input[key]) >= 0) prefs[key] = input[key]; });
    if (['north', 'east', 'south', 'west'].indexOf(input.entranceSide) >= 0) prefs.entranceSide = input.entranceSide;
    var count = Number(input.bedrooms);
    if (Number.isFinite(count)) prefs.bedrooms = Math.max(1, Math.min(4, Math.round(count)));
    prefs.singleBedrooms=Math.max(0,Math.min(prefs.bedrooms,Math.round(Number(input.singleBedrooms)||0)));
    ['gardenCount','balconyCount'].forEach(function(key){prefs[key]=Math.max(1,Math.min(8,Math.round(Number(input[key])||1)));});
    return prefs;
  }
  function cleanProposal(input) {
    if (!input || typeof input !== 'object' || !input.prefs || typeof input.prefs !== 'object') return null;
    var result = { prefs: normalizePrefs(input.prefs), constraints: {
      separateKitchenBedroom: !!(input.constraints && input.constraints.separateKitchenBedroom === true),
      compactFootprint: !!(input.constraints && input.constraints.compactFootprint === true),
      gardenCourtyard: !!(input.constraints && input.constraints.gardenCourtyard === true),
      balconyBedroom: !!(input.constraints && input.constraints.balconyBedroom === true)
    } };
    if(input.routeRequests){var routing=(typeof module==='object'?require('./module-edits.js'):globalThis.WishModuleEdits).cleanRoutes(input.routeRequests);if(!routing)return null;result.routeRequests=routing;}
    if(input.replaceAll===true)result.replaceAll=true;
    if(input.moduleEdits){
      var M=typeof module==='object'?require('./module-edits.js'):globalThis.WishModuleEdits;
      var transaction=M.clean(input.moduleEdits);if(!transaction)return null;result.moduleEdits=transaction;
    }
    if(typeof input.reviewSignature==='string')result.reviewSignature=input.reviewSignature.slice(0,200);
    if(input.orientationChange&&ENUMS.orientation.includes(input.orientationChange.direction))result.orientationChange={status:'confirmed',direction:input.orientationChange.direction,source:'dialogue',reason:cleanText(input.orientationChange.reason,180)};
    if(input.orientationOnly===true&&result.orientationChange)result.orientationOnly=true;
    return result;
  }
  // Model intent is a draft. Only a deliberate UI approval can execute it.
  function stageForReview(current,incoming){
    var next=cleanConversation(incoming),latest=next.messages.at(-1),M=typeof module==='object'?require('./module-edits.js'):globalThis.WishModuleEdits;
    if(!latest||latest.role!=='assistant')return next;
    var oldRequirement=current.conversation.requirements.find(r=>r.id==='orientation'&&ENUMS.orientation.includes(r.value));
    var oldOrientation=current.conversation.orientationPreference||(oldRequirement?{status:'confirmed',direction:oldRequirement.value}:{status:'unknown',direction:null}),newOrientation=next.orientationPreference;
    if(newOrientation?.status==='confirmed'&&newOrientation.direction!==oldOrientation?.direction){
      if(!latest.proposal){latest.proposal={prefs:{...current.prefs,orientation:newOrientation.direction},constraints:{...current.constraints},orientationOnly:true};latest.applied=false;latest.superseded=false;}
      latest.proposal.orientationChange=newOrientation;
    }
    next.orientationPreference=oldOrientation||null;next.householdSlot=current.conversation.householdSlot||null;
    if(latest.proposal&&!latest.applied){latest.planAction='propose';latest.proposal.reviewSignature=M.signature(current.rooms);}
    return cleanConversation(next);
  }
  function choice(label, text) { return { label: label, text: text || label }; }
  var WELCOME = '你好，我是愿居的设计搭子。这个家，你最想照顾哪一种生活？\n可以从一家人的日常说起，也可以聊采光、安静、收纳或风水讲究。我们一起把想法理清，再决定怎样拼进平面。';
  var OLD_WELCOME = '你好，我是愿居的设计搭子。先说说你想怎么生活：和谁住、需要几间睡房，或有没有特别在意的事？也可以聊风水偏好。\n现在是本地规则对话原型；我会把能调整的平面需求做成建议，细节和暂时没理解的内容会留下来继续问你。';
  function createConversation() {
    return { messages: [{ id: 'm-1', role: 'assistant', text: WELCOME, choices: [choice('两个人住', '两个人住，先讨论是否共用一间2人睡房'), choice('我在意风水'), choice('先聊生活习惯', '我想先说生活习惯')] }], requirements: [], pendingQuestion: null, orientationPreference: null, householdSlot: null };
  }
  function cleanOccupancy(input){
    if(!input||typeof input!=='object')return null;
    const count=n=>Number.isInteger(n)&&n>=0&&n<=40?n:null;
    return {residentCount:count(input.residentCount),guestCount:count(input.guestCount),residentSharingEvidence:cleanText(input.residentSharingEvidence,120),residentRelationship:['couple','roommates','other','unspecified'].includes(input.residentRelationship)?input.residentRelationship:'unspecified',residentSleeping:['shared','separate','unspecified'].includes(input.residentSleeping)?input.residentSleeping:'unspecified',residentBedroom:['default','single','double','custom'].includes(input.residentBedroom)?input.residentBedroom:'default',guestSleeping:['shared','separate','unspecified'].includes(input.guestSleeping)?input.guestSleeping:'unspecified',reason:cleanText(input.reason,180)};
  }
  function cleanConversation(input) {
    if (!input || typeof input !== 'object') return createConversation();
    var messages = [], requirements = [], seen = Object.create(null);
    (Array.isArray(input.messages) ? input.messages : []).slice(-MAX_MESSAGES).forEach(function (message) {
      if (!message || (message.role !== 'assistant' && message.role !== 'user')) return;
      var text = cleanText(message.text, 1800);
      if (!messages.length && message.role === 'assistant' && text === OLD_WELCOME) text = WELCOME;
      if (!text) return;
      var result = { id: 'm-' + (messages.length + 1), role: message.role, text: text };
      if (message.role === 'assistant') {
        var choices = (Array.isArray(message.choices) ? message.choices : []).slice(0, 4).map(function (item) {
          if (!item || typeof item !== 'object') return null;
          var label = cleanText(item.label, 50), answer = cleanText(item.text, 300);
          return label && answer ? choice(label, answer) : null;
        }).filter(Boolean);
        if (choices.length) result.choices = choices;
        var sketchIds = (Array.isArray(message.functionSketchIds) ? message.functionSketchIds : []).filter(function (id, index, ids) {
          return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id) && ['__proto__', 'prototype', 'constructor'].indexOf(id) < 0 && ids.indexOf(id) === index;
        }).slice(0, 4);
        if (sketchIds.length) result.functionSketchIds = sketchIds;
        var proposal = cleanProposal(message.proposal);
        if (proposal) { result.proposal = proposal; result.applied = message.applied === true; result.superseded = message.superseded === true; result.planAction = message.planAction === 'apply' ? 'apply' : 'propose'; }
        if (message.noChange === true) result.noChange = true;
        if (message.applicationNote) result.applicationNote = cleanText(message.applicationNote, 600);
      }
      messages.push(result);
    });
    (Array.isArray(input.requirements) ? input.requirements : []).slice(-MAX_REQUIREMENTS).forEach(function (requirement) {
      if (!requirement || typeof requirement !== 'object') return;
      var id = cleanText(requirement.id, 80), label = cleanText(requirement.label, 160);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || /^(?:__proto__|prototype|constructor)$/.test(id) || !label || seen[id]) return;
      seen[id] = true;
      var result = { id: id, label: label, kind: ['layout', 'detail', 'note'].indexOf(requirement.kind) >= 0 ? requirement.kind : 'note', status: 'pending' };
      if (['pending', 'met', 'partial', 'unmet', 'satisfied', 'not-applied', 'recorded'].indexOf(requirement.status) >= 0) result.status = requirement.status;
      if (requirement.text) result.text = cleanText(requirement.text, 600);
      if (['gardenCount','balconyCount'].includes(id) && Number.isInteger(requirement.value) && requirement.value>=1 && requirement.value<=8) result.value=requirement.value;
      if (id === 'singleBedrooms' && Number.isInteger(requirement.value) && requirement.value>=0 && requirement.value<=40) result.value=requirement.value;
      if (id === 'bedrooms' && Number.isInteger(requirement.value) && requirement.value >= 0 && requirement.value <= 40) result.value = requirement.value;
      if (Array.isArray(ENUMS[id]) && ENUMS[id].indexOf(requirement.value) >= 0) result.value = requirement.value;
      requirements.push(result);
    });
    var pending = null;
    if (input.pendingQuestion && typeof input.pendingQuestion === 'object' && ['bedrooms', 'outdoor', 'orientation', 'living', 'fengshui', 'lifestyle', 'clarify'].indexOf(input.pendingQuestion.key) >= 0) {
      pending = { key: input.pendingQuestion.key, prompt: cleanText(input.pendingQuestion.prompt, 300) };
    }
    return { messages: messages.length ? messages : createConversation().messages, requirements: requirements, pendingQuestion: pending,
      ...(cleanOccupancy(input.occupancy)?{occupancy:cleanOccupancy(input.occupancy)}:{}),
      ...(input.moduleCounts&&Object.keys(E.TYPES).concat('custom').every(k=>Number.isInteger(input.moduleCounts[k])&&input.moduleCounts[k]>=0&&input.moduleCounts[k]<=40)?{moduleCounts:{...input.moduleCounts}}:{}),
      ...(input.contextScope?.isolated === true ? { contextScope: { isolated: true, planShared: input.contextScope.planShared === true, replaceAll: input.contextScope.replaceAll === true,
        functionIds: [...new Set((Array.isArray(input.contextScope.functionIds) ? input.contextScope.functionIds : []).filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)))].slice(-120) } } : {}),
      orientationPreference: input.orientationPreference && input.orientationPreference.status === 'confirmed' && ENUMS.orientation.indexOf(input.orientationPreference.direction) >= 0 ?
        { status: 'confirmed', direction: input.orientationPreference.direction, source: input.orientationPreference.source === 'choice' ? 'choice' : 'dialogue', reason: cleanText(input.orientationPreference.reason, 180) } :
        input.orientationPreference ? { status: 'unknown', direction: null } : null,
      householdSlot: ['W1', 'N1', 'N2', 'E1', 'S1', 'S2'].indexOf(input.householdSlot) >= 0 ? input.householdSlot : null };
  }
  function newSession() {
    return Object.assign(createConversation(), { contextScope: { isolated: true, planShared: false, functionIds: [] } });
  }
  // Enforce the same boundary in the browser payload and the local model adapter.
  function requestContext(input) {
    var conversation = cleanConversation(input.conversation), scope = conversation.contextScope;
    if (!scope?.isolated) return Object.assign({}, input, { conversation: conversation });
    var prefs = scope.planShared ? input.prefs : Object.assign({}, E.DEFAULTS, { entranceSide: normalizePrefs(input.prefs).entranceSide });
    if (conversation.orientationPreference?.status === 'confirmed') prefs = Object.assign({}, prefs, { orientation: conversation.orientationPreference.direction });
    return Object.assign({}, input, { conversation: conversation, prefs: prefs,
      rooms: scope.planShared ? input.rooms : [],
      buildingPlacement: scope.planShared ? input.buildingPlacement : null,
      constraints: scope.planShared ? input.constraints : constraintsFrom(conversation.requirements),
      functionLibrary: (Array.isArray(input.functionLibrary) ? input.functionLibrary : []).filter(function (p) { return p && scope.functionIds.indexOf(p.id) >= 0; }) });
  }
  function number(value) { return /^\d+$/.test(value) ? Number(value) : NUMBERS[value]; }
  function nextId(messages) {
    return 'm-' + (messages.reduce(function (max, message) { return Math.max(max, Number(message.id.slice(2)) || 0); }, 0) + 1);
  }
  function noteId(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return 'note-' + (hash >>> 0).toString(36);
  }
  function constraintsFrom(requirements) {
    return {
      separateKitchenBedroom: requirements.some(function (item) { return item.id === 'separateKitchenBedroom'; }),
      compactFootprint: requirements.some(function (item) { return item.id === 'compactFootprint'; })
    };
  }
  function respond(rawText, currentPrefs, input) {
    var conversation = cleanConversation(input), text = cleanText(rawText, 1200);
    if (!text) return { conversation: conversation, proposal: null };
    var priorMessages = conversation.messages.slice(), pending = conversation.pendingQuestion;
    var current = normalizePrefs(currentPrefs), base = current, hasPendingProposal = false;
    // Continue the latest draft even before the user applies it. Once applied, the live plan is authoritative.
    for (var i = priorMessages.length - 1; i >= 0; i--) {
      if (priorMessages[i].proposal && !priorMessages[i].superseded) {
        if (!priorMessages[i].applied) { base = normalizePrefs(priorMessages[i].proposal.prefs); hasPendingProposal = true; }
        break;
      }
    }
    var normalized = text.replace(/别要/g, '不要').replace(/卧房|寝室/g, '卧室');
    var contextResolved = false, ambiguousPronoun = false;
    if (/它|那个|这个/.test(normalized)) {
      var focus = null;
      for (var p = priorMessages.length - 1; p >= 0; p--) {
        if (priorMessages[p].role !== 'user') continue;
        var terms = priorMessages[p].text.match(/大客厅|小客厅|客厅|睡房|卧室|阳台|花园|厨房/g) || [];
        var unique = terms.filter(function (term, index) { return terms.indexOf(term) === index; });
        if (unique.length === 1) focus = unique[0];
        if (unique.length) break;
      }
      if (focus) { normalized = normalized.replace(/它|那个|这个/g, focus); contextResolved = true; }
      else ambiguousPronoun = true;
    }
    if (pending && pending.key === 'bedrooms' && /^\s*[一二两三四五六七八九十\d]+\s*(?:间|个)?\s*[吧。！]?\s*$/.test(normalized)) {
      normalized = normalized.replace(/[吧。！\s]/g, '').replace(/间|个/g, '') + '间睡房'; contextResolved = true;
    }
    if (pending && pending.key === 'orientation' && /^[东南西北](?:边|面|向)?[吧。！]?$/.test(normalized)) { normalized = '客厅朝' + normalized[0]; contextResolved = true; }
    if (pending && pending.key === 'living' && /^(?:大|小)(?:的|一点|一些)?[吧。！]?$/.test(normalized)) { normalized = normalized[0] + '客厅'; contextResolved = true; }
    if (pending && pending.key === 'outdoor') {
      if (/^(?:都要|两个都要|都想要)[。！]?$/.test(normalized)) { normalized = '要阳台和花园'; contextResolved = true; }
      if (/^(?:都不要|不要|不需要|没有)[。！]?$/.test(normalized)) { normalized = '不要阳台和花园'; contextResolved = true; }
    }
    if (pending && pending.key === 'fengshui' && /要加入这个拼搭条件/.test(pending.prompt) && /^(?:好|好的|可以|要|是|加入)[。！!]?$/ .test(normalized)) {
      normalized = '睡房不要挨着厨房'; contextResolved = true;
    }
    normalized = normalized.replace(/(?:卧室|睡房)(?:想要|需要|要|设|留|有|是)?\s*([零一二两三四五六七八九十\d]+)\s*(?:间|个)/g, '$1间睡房');
    normalized = normalized.replace(/(?:改成|改为|换成|改要|减到|加到)\s*([零一二两三四五六七八九十\d]+)\s*间(?=$|[，。！？；,!?;\s])/g, '$1间睡房');
    var requirements = conversation.requirements, acknowledgments = [], limits = [], recognizedSpecial = [], unknown = [], removed = [];
    var actionable = false, needsCount = false;
    function add(id, label, kind, original) {
      var existing = requirements.find(function (item) { return item.id === id; });
      var result = { id: id, label: label, kind: kind || 'note', status: 'pending', text: original || text };
      if (existing) Object.assign(existing, result); else requirements.push(result);
    }
    function remove(id) {
      var existing = requirements.find(function (item) { return item.id === id; });
      if (existing) { removed.push(existing.label); requirements.splice(requirements.indexOf(existing), 1); }
    }
    function acknowledge(value) { if (acknowledgments.indexOf(value) < 0) acknowledgments.push(value); }
    function limit(value) { if (limits.indexOf(value) < 0) limits.push(value); }
    if (!hasPendingProposal && input && input.activeConstraints) {
      if (input.activeConstraints.separateKitchenBedroom === true && !requirements.some(function (item) { return item.id === 'separateKitchenBedroom'; })) add('separateKitchenBedroom', '厨房与睡房不共边', 'layout', '当前平面的拼搭条件');
      if (input.activeConstraints.compactFootprint === true && !requirements.some(function (item) { return item.id === 'compactFootprint'; })) add('compactFootprint', '尽量紧凑、减少轮廓缺角', 'layout', '当前平面的拼搭条件');
    }
    var clauses = normalized.split(/[，。！？；,!?;\n]|但是|不过|而是|并且|以及|而且|还要/).map(function (clause) { return clause.trim(); }).filter(Boolean);
    var omitClauses = Object.create(null);
    clauses.forEach(function (clause, index) {
      if (/(?:不用|不要|不需要|不必|无需|取消|不再|不考虑|不讲究|不在意).{0,8}风水|风水.{0,6}(?:不用|不要|不需要|取消)/.test(clause)) {
        FENGSHUI_IDS.forEach(remove); actionable = true; acknowledge('已从需求清单移除风水相关偏好'); omitClauses[index] = true; recognizedSpecial.push(index); return;
      }
      if (/(?:不要|不需要|不用|取消|无需|不必|不在意|不考虑|不讲究).{0,8}(?:动静分区|卧厨分离|远离厨房|远离卧室|远离睡房|方正|少缺角|紧凑)|(?:动静分区|卧厨分离|方正|少缺角).{0,5}(?:不用|不要|不需要|取消)/.test(clause)) {
        if (/方正|缺角|紧凑/.test(clause)) { remove('compactFootprint'); acknowledge('不再把轮廓紧凑作为拼搭条件'); }
        else { remove('separateKitchenBedroom'); acknowledge('不再要求厨房与睡房分开'); }
        actionable = true; omitClauses[index] = true; recognizedSpecial.push(index); return;
      }
      if (/(?:不用|不要|取消|无需|不必).{0,8}(?:门不对床|床不对门|床头靠墙|门不对灶|入户避灶)/.test(clause)) {
        if (/床头/.test(clause)) remove('headboard'); else if (/灶/.test(clause)) remove('entryStove'); else remove('bedDoor');
        acknowledge('已移除这项细节偏好'); omitClauses[index] = true; recognizedSpecial.push(index); return;
      }
      var positiveSeparation = /动静分区|卧厨分离|(?:卧室|睡房).{0,12}(?:远离|离开|不挨|不要挨|不靠|不要靠|不相邻|不邻|别挨).{0,6}厨房|厨房.{0,12}(?:远离|离开|不挨|不要挨|不靠|不要靠|不相邻|不邻|别挨).{0,6}(?:卧室|睡房)/.test(clause);
      if (positiveSeparation) {
        add('separateKitchenBedroom', '厨房与睡房不共边', 'layout', clause); actionable = true;
        acknowledge('把“睡房远离厨房”转成厨房与睡房不共边的拼搭条件'); recognizedSpecial.push(index);
      }
      if (/方正|少缺角|减少凹角|减少缺角|轮廓紧凑/.test(clause)) {
        add('compactFootprint', '尽量紧凑、减少轮廓缺角', 'layout', clause); actionable = true;
        acknowledge('优先尝试更紧凑、缺角更少的轮廓'); limit('模块尺寸固定，方正程度会在应用后检查，可能只能部分满足。'); recognizedSpecial.push(index);
      }
      if (/(?:卧室|睡房).{0,8}(?:挨着|紧挨|靠着|相邻).{0,5}厨房|厨房.{0,8}(?:挨着|紧挨|靠着|相邻).{0,5}(?:卧室|睡房)/.test(clause) && !positiveSeparation) {
        remove('separateKitchenBedroom'); actionable = true;
        add('adjacentKitchenBedroom', '希望厨房靠近睡房', 'detail', clause);
        limit('厨房靠近睡房的具体位置已记下，当前还不能保证这个相邻关系。'); recognizedSpecial.push(index);
      }
      if (/入户|大门|开门|门口/.test(clause) && /灶|厨房/.test(clause)) {
        add('entryStove', /不要|不能|避免|不对|避|不见|不正对/.test(clause) ? '入户门不正对灶位' : '入户门与厨房、灶位关系待确认', 'detail', clause);
        limit('入户门、灶台还没有建模，这一项先保留为细化要求，暂时不能检查。'); recognizedSpecial.push(index);
      }
      if (/床/.test(clause) && /门/.test(clause) && !/床头/.test(clause)) {
        add('bedDoor', /不要|不能|避免|不对|避|不正对/.test(clause) ? '床不正对门' : '床与房门关系待确认', 'detail', clause);
        limit('床和房门还没有建模，位置偏好已记下，暂时不能检查。'); recognizedSpecial.push(index);
      }
      if (/床头/.test(clause) && /墙|靠|实/.test(clause)) {
        add('headboard', '床头靠墙偏好待细化', 'detail', clause);
        limit('床头和墙体细节尚未建模，这项会留在待细化需求里。'); recognizedSpecial.push(index);
      }
      if (/南北通透|穿堂风|对流|交叉通风/.test(clause)) {
        add('ventilation', '南北通透 / 自然通风', 'detail', clause);
        limit('通透性需要门窗、开口和周边条件，当前模块平面不能验证。'); recognizedSpecial.push(index);
      }
      if (/老人|长辈|父母|无障碍|轮椅|适老/.test(clause)) {
        add('accessibility', '适老与无障碍通行', 'detail', clause);
        limit('适老偏好已记下；通道净宽、门槛和卫浴还需要进一步设计。'); recognizedSpecial.push(index);
      }
      if (/宠物|猫|狗/.test(clause)) {
        add('pets', '宠物活动与安全', 'detail', clause);
        limit('已记下宠物需求；活动区、阳台防护等细节还不能自动布置。'); recognizedSpecial.push(index);
      }
      if (/做饭|下厨|烹饪|中餐|油烟|开放式厨房|封闭式厨房/.test(clause)) {
        add('cooking', '烹饪习惯与厨房使用', 'detail', clause);
        limit('方案默认已有厨房；开放或封闭、排烟和操作台还没有建模。'); recognizedSpecial.push(index);
      }
      if (/种花|种菜|园艺|养花|种植/.test(clause)) {
        add('gardening', '园艺与种植空间', 'detail', clause);
        limit('种植需求已记下，可以先选择阳台或花园；种植设施和日照条件还需要细化。'); recognizedSpecial.push(index);
      }
      if (/在家办公|居家办公|远程办公|书房|工作室|工作区/.test(clause)) {
        add('workspace', '居家办公 / 书房用途', 'detail', clause);
        limit('目前没有独立书房模块，可以先预留一间睡房再细化用途。'); recognizedSpecial.push(index);
      }
      if (/小学|上学|孩子.{0,6}(?:学习|读书)|读书风水|书桌|文昌/.test(clause)) {
        add('study', '孩子学习与书桌布置', 'detail', text);
        limit('已记下孩子学习和书桌布置的需求。书桌、门窗和独立学习区尚未建模，可以先预留睡房模块并考虑安静的位置；当前不能评估文昌、运势或学习成绩。'); recognizedSpecial.push(index);
      }
      if (/预算|省钱|低成本|便宜|造价|[\d一二两三四五六七八九十]+\s*万/.test(clause)) {
        add('budget', '预算目标：' + clause.slice(0, 100), 'note', clause);
        limit('预算已记下；没有材料、地区和造价数据，暂时不能估价。'); recognizedSpecial.push(index);
      }
      if (/面积|[\d一二两三四五六七八九十]+\s*(?:平米|平方米|㎡|平(?:以内|左右|米)?)/.test(clause)) {
        add('areaTarget', '面积目标：' + clause.slice(0, 100), 'detail', clause);
        limit('面积目标会保留；模块尺寸固定，当前不能保证指定面积，画布会显示实际面积。'); recognizedSpecial.push(index);
      }
    });
    var parserText = clauses.filter(function (_, index) { return !omitClauses[index]; }).join('，');
    // A negative count is a rejection, never an instruction to set that count.
    parserText = parserText.replace(/(?:不要|不想要|不需要|不是|不做|别要)\s*([一二两三四五六七八九十\d]+)\s*(?:间|个)?\s*(?:卧室|睡房|房间|房|室)/g, function () { needsCount = true; return ''; });
    parserText = parserText.replace(/(?:不要|不喜欢|不想要|不需要|不爱)\s*(?:安静|聚会|会客|热闹|社交|独处|阅读|看书|休闲)/g, '');
    var relative = [], relativePattern = /(?:再加|再增|加上|增加|加|多|减少|减掉|去掉|少)\s*([一二两三四五六七八九十\d]+)\s*(?:间|个)\s*(?!阳台|花园|厨房|客厅|书房|工作室|卫生间|浴室)(?:卧室|睡房|房间)?/g;
    parserText = parserText.replace(relativePattern, function (match, value) {
      relative.push({ amount: number(value), negative: /减少|减掉|去掉|^少/.test(match) }); return '';
    });
    if (/坐北朝南/.test(parserText)) parserText = parserText.replace(/坐北朝南/g, '客厅朝南');
    var parsed = E.parseWish(parserText, base), prefs = parsed.prefs;
    if (relative.length) {
      relative.forEach(function (change) {
        if (!Number.isFinite(change.amount)) return;
        var requested = prefs.bedrooms + (change.negative ? -change.amount : change.amount);
        prefs.bedrooms = Math.max(1, Math.min(4, requested));
        if (requested < 1 || requested > 4) limit('当前睡房数量支持 1–4 间，已经保留在支持范围内。');
      });
      acknowledge('睡房调整为 ' + prefs.bedrooms + ' 间'); actionable = true; needsCount = false;
      if (relative.some(function (change) { return change.amount > 3; })) limit('当前睡房数量支持 1–4 间。');
    }
    var countMatch = parserText.match(/([零一二两三四五六七八九十\d]+)\s*(?:间|个)?\s*(?:卧室|睡房|房间|房|室)/);
    if (countMatch) { needsCount = false; if (number(countMatch[1]) < 1 || number(countMatch[1]) > 4) limit('当前睡房数量支持 1–4 间，建议按支持范围生成。'); }
    var hasParsed = parsed.recognized.length > 0;
    if (hasParsed) { actionable = true; parsed.recognized.forEach(acknowledge); }
    var touched = {
      bedrooms: !!countMatch || relative.length > 0,
      household: parsed.recognized.some(function (label) { return /独居生活|两人生活|家庭生活/.test(label); }),
      living: parsed.recognized.some(function (label) { return /大客厅|小客厅/.test(label); }),
      outdoor: parsed.recognized.some(function (label) { return /阳台|花园/.test(label); }),
      orientation: parsed.recognized.some(function (label) { return /客厅朝/.test(label); }),
      lifestyle: parsed.recognized.some(function (label) { return /轻松休闲|喜欢相聚|喜欢安静/.test(label); })
    };
    var labels = {
      bedrooms: prefs.bedrooms + ' 间睡房', household: { solo: '一个人住', couple: '两个人住', family: '家庭共同居住' }[prefs.household],
      living: {large:'大客厅',small:'小客厅',medium:'多用客厅'}[prefs.living], outdoor: { none: '不设阳台和花园', balcony: '阳台', garden: '花园', both: '阳台和花园' }[prefs.outdoor],
      orientation: '客厅朝' + { south: '南', north: '北', east: '东', west: '西' }[prefs.orientation],
      lifestyle: { relaxed: '偏好轻松休闲', social: '偏好会客社交', quiet: '偏好安静' }[prefs.lifestyle]
    };
    Object.keys(touched).forEach(function (key) {
      if (!touched[key]) return;
      add(key, labels[key], key === 'lifestyle' || key === 'household' ? 'note' : 'layout');
      requirements.find(function (item) { return item.id === key; }).value = prefs[key];
    });
    if (touched.lifestyle) limit('生活方式先作为设计偏好保存；隔音、家具和活动动线还不能自动验证。');
    var fengshui = /风水/.test(normalized) && !clauses.some(function (clause, index) { return omitClauses[index] && /风水/.test(clause); });
    if (fengshui) { add('fengshui', '关注风水相关空间偏好', 'note'); limit('我可以把风水偏好转成可讨论的空间条件；这不代表运势或健康效果。'); }
    var conversational = /^(?:好(?:的|啊)?|谢谢|明白了|知道了|嗯|可以|行|继续|还有呢|你好|嗨)[呀啊吧。！!]*$/.test(normalized);
    var confirmation = /^(?:按(?:这些|这个|上面|刚才的?)(?:需求|建议|想法)?(?:来|生成|生成方案)?|生成(?:一个)?方案|可以|好|好的|就这样|按这个来)[吧。！!]*$/.test(normalized) && requirements.length > 0;
    if (confirmation && !actionable) {
      actionable = true; acknowledge('沿用已经明确的房间配置和拼搭条件');
      if (requirements.some(function (item) { return item.kind === 'detail' || /^note-/.test(item.id); })) limit('清单里的待细化和待澄清内容仍会保留，这次生成不会自动落实这些细节。');
    }
    var lifestylePrompt = /^(?:我想|想|先)?(?:先)?(?:说|聊)(?:一下)?生活习惯$|我想先说生活习惯/.test(normalized);
    var countPrompt = /几间睡房|几间卧室|睡房数量/.test(normalized) && !touched.bedrooms;
    var orientationPrompt = /确定.*朝向|朝哪|怎么朝|什么朝向/.test(normalized) && !touched.orientation;
    clauses.forEach(function (clause, index) {
      if (omitClauses[index] || conversational || confirmation || lifestylePrompt || countPrompt || orientationPrompt || contextResolved) return;
      // Keep mixed unsupported requirements even when another part of the sentence was understood.
      var unsupported = /卫生间|卫浴|厕所|浴室|储物|储藏|衣帽|洗衣|车库|地下室|楼梯|电梯|复式|挑高|露营|玻璃|拱|圆形|弧形|材料|木头|混凝土|颜色|北欧|日式|风格|落地窗|窗|采光|西晒|隔音|保温|节能|坡屋顶|天井|天窗|门/.test(clause);
      var special = recognizedSpecial.indexOf(index) >= 0;
      var minimal = clause.replace(/我(?:们)?|想(?:要)?|希望|需要|打算|最好|请|帮我|然后|以及|而且|并且|再|也|要|有|一个|一些|一点|这个|那个|的|比较|能|可以|都|和|与|及|带|加|不|考虑|讲究|在意|风水|坐北朝南|[\s、：:]/g, '');
      minimal = minimal.replace(/[零一二两三四五六七八九十\d]+\s*(?:间|个)?\s*(?:卧室|睡房|房间|房|室)/g, '')
        .replace(/(?:大|小|宽敞|紧凑)?客厅|阳台|花园|露台|庭院|(?:朝向?|面向?|向)[东南西北]|[东南西北]向|两个人|一个人|两人住|一人住|独居|自己住|夫妻|情侣|二人|两口子|一家[一二两三四五六七八九\d]+口|一家人|家庭|孩子|小孩|父母|亲子|放松|休闲|悠闲|惬意|慵懒|聚会|会客|朋友|热闹|社交|安静|独处|阅读|看书|静谧|生活/g, '')
        .replace(/再加|增加|减少|减掉|去掉|不要|取消|不需要|多|少|住|间|个|[一二两三四\d]|吧|了/g, '');
      // Specific detail handlers preserve their exact original text; do not duplicate it as an unknown note.
      var extraUnsupported = /卫生间|厕所|浴室|储物|储藏|衣帽|洗衣|车库|地下室|楼梯|电梯|复式|挑高|玻璃|拱|圆形|弧形|材料|木头|混凝土|颜色|北欧|日式|风格|落地窗|西晒|隔音|保温|节能|坡屋顶|天井|天窗/.test(clause);
      if ((unsupported && (!special || extraUnsupported)) || (!special && minimal.length > 1 && !(fengshui && /风水/.test(clause)))) {
        add(noteId(clause), '待澄清：' + clause.slice(0, 100), 'note', clause); unknown.push(clause);
      }
    });
    if (ambiguousPronoun) { add(noteId(text), '待澄清：' + text.slice(0, 100), 'note', text); unknown.push(text); }
    if (needsCount) acknowledge('你不想要这个睡房数量，我先保留原数量');
    if (removed.length && !acknowledgments.length) acknowledge('已移除：' + removed.join('、'));
    if (unknown.length) limit('“' + unknown[0].slice(0, 80) + '”我还不能完整转成平面条件，已原文保留为待澄清需求。');
    var question = null, choices = [];
    function ask(key, prompt, answers) { question = { key: key, prompt: prompt }; choices = answers; }
    var hasSeparation = requirements.some(function (item) { return item.id === 'separateKitchenBedroom'; });
    if (needsCount || countPrompt || (touched.household && !touched.bedrooms && !requirements.some(function (item) { return item.id === 'bedrooms'; }))) {
      ask('bedrooms', '你想保留几间睡房？', [choice('1 间', '1'), choice('2 间', '2'), choice('3 间', '3'), choice('4 间', '4')]);
    } else if (fengshui && !recognizedSpecial.length) {
      ask('fengshui', '你最在意哪一项？也可以直接说你的具体讲究。', [choice('厨房与睡房分开', '睡房不要挨着厨房'), choice('轮廓尽量方正', '希望平面方正、少缺角'), choice('入户门不对灶', '入户门不要正对灶台'), choice('床不对门', '床不要正对房门')]);
    } else if (lifestylePrompt || (conversational && !requirements.length)) {
      ask('lifestyle', '你平时更接近哪种生活？', [choice('安静休息', '我希望家里安静'), choice('朋友常来', '我经常在家和朋友聚会'), choice('在家办公'), choice('和父母一起住')]);
    } else if (/在家办公|居家办公|书房|工作室/.test(normalized) && !touched.bedrooms) {
      ask('bedrooms', '包括将来兼作书房的空间，一共需要几间睡房模块？', [choice('2 间', '2'), choice('3 间', '3'), choice('4 间', '4')]);
    } else if (/小学|上学|孩子.{0,6}(?:学习|读书)|读书风水|书桌|文昌/.test(normalized) && !touched.bedrooms) {
      ask('fengshui', '学习空间想先预留一个房间，还是先让睡房避开厨房？', [choice('增加一间兼作书房', '再增加一间睡房兼作书房'), choice('先让睡房远离厨房', '睡房不要挨着厨房')]);
    } else if (/种花|种菜|园艺|养花|种植/.test(normalized) && !touched.outdoor) {
      ask('outdoor', '想把种植放在阳台，还是留一块花园？', [choice('阳台种植', '要阳台，不要花园'), choice('留一块花园', '要花园，不要阳台'), choice('两者都要', '都要')]);
    } else if (/做饭|下厨|烹饪|中餐|油烟/.test(normalized) && !hasSeparation) {
      ask('fengshui', '可以先让睡房避开厨房的共用墙。要加入这个拼搭条件吗？', [choice('让睡房远离厨房', '睡房不要挨着厨房'), choice('先不限制位置', '不要动静分区')]);
    } else if (touched.lifestyle && prefs.lifestyle === 'quiet' && !hasSeparation) {
      ask('fengshui', '可以先让睡房避开厨房的共用墙。要加入这个拼搭条件吗？', [choice('加入卧厨分离', '睡房不要挨着厨房'), choice('先不限制', '不要动静分区')]);
    } else if (orientationPrompt) {
      ask('orientation', '希望客厅主要朝哪个方向？', [choice('朝南', '南'), choice('朝东', '东'), choice('朝北', '北'), choice('朝西', '西')]);
    } else if (unknown.length) {
      ask('clarify', ambiguousPronoun ? '这里的“它”是指哪个空间？请直接写房间名称。' : '这条需求更影响房间数量、空间关系，还是需要以后细化的细节？你可以再说具体一点。', [choice('先确定睡房数量', '我想确定几间睡房'), choice('先确定朝向', '我想确定客厅朝向'), choice('继续说其他想法', '继续')]);
    } else if (/预算|省钱|面积|平米|平方米|㎡/.test(normalized) && !touched.living) {
      ask('living', '想先用小客厅试试更紧凑的组合吗？', [choice('用小客厅'), choice('保留大客厅', '要大客厅')]);
    } else if (/几间睡房|几间卧室|睡房数量/.test(normalized) && !touched.bedrooms) {
      ask('bedrooms', '你想保留几间睡房？', [choice('1 间', '1'), choice('2 间', '2'), choice('3 间', '3'), choice('4 间', '4')]);
    } else if (/确定.*朝向|朝哪|怎么朝|什么朝向/.test(normalized) && !touched.orientation) {
      ask('orientation', '希望客厅主要朝哪个方向？', [choice('朝南', '南'), choice('朝东', '东'), choice('朝北', '北'), choice('朝西', '西')]);
    } else if (touched.bedrooms && !requirements.some(function (item) { return item.id === 'outdoor'; })) {
      ask('outdoor', '户外空间想选哪一种？', [choice('阳台', '要阳台，不要花园'), choice('花园', '要花园，不要阳台'), choice('两者都要', '都要'), choice('暂时不要', '都不要')]);
    } else if (conversational) {
      ask('clarify', '继续说说你在意的空间，或应用上一条建议到平面。', [choice('客厅朝南'), choice('增加一间睡房'), choice('我在意风水')]);
    }
    var proposal = actionable ? { prefs: normalizePrefs(prefs), constraints: constraintsFrom(requirements) } : null;
    var paragraphs = [];
    if (acknowledgments.length) paragraphs.push(acknowledgments.join('；') + '。');
    if (!acknowledgments.length && !limits.length && question) paragraphs.push('我们可以一步步确定。');
    if (proposal) paragraphs.push('我把这些整理成了待应用建议。点击“应用到平面”后才会重新拼搭；其他已有偏好会一起保留。');
    if (limits.length) paragraphs.push(limits.join('\n'));
    if (question) paragraphs.push(question.prompt);
    if (!paragraphs.length) paragraphs.push('这条想法先留下来。可以继续告诉我房间数量、朝向，或两个空间希望靠近还是分开。');
    conversation.messages.push({ id: nextId(conversation.messages), role: 'user', text: text });
    var assistant = { id: nextId(conversation.messages), role: 'assistant', text: paragraphs.join('\n\n') };
    if (choices.length) assistant.choices = choices;
    if (proposal) assistant.proposal = cleanProposal(proposal);
    conversation.messages.push(assistant);
    conversation.messages = conversation.messages.slice(-MAX_MESSAGES);
    // Preserve layout rules first when the note list fills up.
    if (requirements.length > MAX_REQUIREMENTS) requirements = requirements.filter(function (item) { return item.kind === 'layout'; }).concat(requirements.filter(function (item) { return item.kind !== 'layout'; }).slice(-(MAX_REQUIREMENTS - requirements.filter(function (item) { return item.kind === 'layout'; }).length))).slice(0, MAX_REQUIREMENTS);
    conversation.requirements = requirements;
    conversation.pendingQuestion = question;
    return { conversation: conversation, proposal: proposal };
  }
  return { cleanOccupancy:cleanOccupancy, stageForReview: stageForReview, createConversation: createConversation, newSession: newSession, requestContext: requestContext, cleanConversation: cleanConversation, respond: respond };
});

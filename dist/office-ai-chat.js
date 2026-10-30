(function(){
  'use strict';
  const $=id=>document.getElementById(id),M=window.OfficeModel,bridge=window.OfficeAI;
  const panel=document.createElement('section');panel.id='officeAIChat';panel.setAttribute('aria-label','办公楼 GPT 对话');
  panel.innerHTML=`<div class="office-ai-toolbar"><span id="officeAIConnection" role="status">正在检查 GPT…</span><button id="officeAIReconnect" type="button">重连</button><button id="officeAIReset" type="button">重新对话</button></div>
    <label>本次需求范围<select id="officeAIScope"><option value="floor">当前楼层</option><option value="user">当前用户</option><option value="building">整栋楼</option></select></label><p id="officeAISelection"></p>
    <div id="officeAIMessages" role="log" aria-live="polite"></div>
    <div class="office-ai-topics"><button type="button" data-office-prompt="会议空间有点挤，花园用得不多，能帮我调整一下吗？">会议与花园</button><button type="button" data-office-prompt="这里工作不太舒服。">模糊需求测试</button></div>
    <form id="officeAIForm"><label for="officeAIInput">告诉我你的办公需求</label><textarea id="officeAIInput" rows="3" maxlength="3000" placeholder="例如：大家讨论总坐不下，花园倒是很少用。"></textarea><div class="office-ai-actions"><button id="officeAISend" type="submit">发送需求 ↗</button><button id="officeAIStop" type="button" hidden>停止</button></div></form>
    <label for="officeAIMultiplier">需求放大 <output id="officeAIMultiplierValue">×1</output></label><input id="officeAIMultiplier" type="range" min="1" max="100" step="1" value="1"><p class="office-ai-disclosure">在原有需求上加入 1–100 份反馈；保留每位用户原有权重。基准为 100 份演示权重，不代表实际人数。生成建议后，拖动倍率即可比较预览。</p>
    <p id="officeAIStatus" role="status"></p><div id="officeAIProposal" hidden></div>
    <p class="office-ai-disclosure">需求、最近对话和所选范围的模块数量摘要会发送至 OpenAI。GPT 建议五项需求权重；确认应用前不会修改已保存的楼体。</p>`;
  $('chatPanel').before(panel);
  let messages=[],request=null,epoch=0,proposal=null,lastText="",cached=null,rescaling=false,applyingTrace=null;
  const language=()=>window.OfficeI18n?.language||'zh';
  const localized=(zh,en)=>language()==='en'?en:zh;
  const historyKey='adaptive-office.chat.v1';
  try{const raw=JSON.parse(localStorage.getItem(historyKey)||'[]');if(Array.isArray(raw))messages=raw.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-40);}catch{}
  function save(){try{localStorage.setItem(historyKey,JSON.stringify(messages.slice(-40)));}catch{}}
  function append(role,content){messages.push({role,content});save();render();}
  function render(){
    const log=$('officeAIMessages');log.replaceChildren();
    const shown=messages.length?messages:[{role:'assistant',content:localized('你好，说说你希望怎样使用这栋办公楼。我会先提出建议并预览，等你确认后再调整模块。','Hello! Tell me how you would like to use this office building. I will preview a proposal and wait for your confirmation before changing the modules.')}];
    shown.forEach(m=>{const item=document.createElement('div');item.className='office-ai-message '+m.role;const label=document.createElement('strong');label.textContent=m.role==='user'?'你':'办公楼助手';const body=document.createElement('p');body.textContent=m.content;item.append(label,body);log.append(item);});log.scrollTop=log.scrollHeight;
  }
  function selection(){const c=bridge.getContext();c.weights=Object.fromEntries(M.KEYS.map(k=>[k,Number($('demand-'+k).value)]));return c;}
  function selectionLabel(){const {state,selection:s}=selection(),f=state.floors[s.floorIndex],u=f.users.find(u=>u.id===s.userId);$('officeAISelection').textContent=s.scope==='building'?`全楼 ${state.floors.length} 层（各层总量保持不变）`:`${f.id} · ${f.name}${s.scope==='user'?' / '+u.name:''} · 在右侧选择楼层和用户`;}
  function notice(text){$('officeAIStatus').textContent=text;}
  function clear(){proposal=null;cached=null;$('officeAIProposal').hidden=true;bridge.clearPreview();}
  function stop(){epoch++;request?.abort();request=null;setBusy(false);}
  function setBusy(busy){$('officeAISend').disabled=busy;$('officeAIStop').hidden=!busy;}
  async function connect(){
    $('officeAIConnection').textContent='正在检查 GPT…';
    try{const r=await fetch('/api/office/status'),data=await r.json();$('officeAIConnection').textContent=data.ready?`GPT 已连接 · ${data.model}`:data.message||'GPT 尚未就绪';}
    catch{$('officeAIConnection').textContent='办公服务未连接，请重启办公楼启动程序。';}
  }
  function showProposal(result,details){
    proposal={details};const box=$('officeAIProposal');box.replaceChildren();box.hidden=false;
    const title=document.createElement('strong');title.textContent='AI 建议 · 3D 正在预览，尚未应用';box.append(title);
    const reason=document.createElement('p');reason.textContent=result.reason;box.append(reason);
    const weightTable=document.createElement('table');
    const wh=document.createElement('tr');['需求维度','当前权重','AI 建议'].forEach(t=>{const th=document.createElement('th');th.textContent=t;wh.append(th);});weightTable.append(wh);
    M.KEYS.forEach(k=>{const row=document.createElement('tr');[M.PROGRAMS[k].label,details.currentWeights[k],result.weights[k]].forEach(t=>{const td=document.createElement('td');td.textContent=t;row.append(td);});weightTable.append(row);});box.append(weightTable);
    const explanation=document.createElement('p');explanation.textContent=localized(`原有需求 100 份 + 新反馈 ${details.multiplier} 份。表中为所选范围的平均权重，各用户分别在自身原值上调整，未提及的维度保持不变。是否应用？`,`Baseline: 100 demand units + ${details.multiplier} new feedback units. These are average weights for the selected scope. Each user's weights adjust from their own baseline; unmentioned dimensions stay unchanged. Apply this proposal?`);box.append(explanation);
    const disclosure=document.createElement('details'),toggle=document.createElement('summary');toggle.textContent=`查看模块数量变化（${details.changes.length} 个模块）`;disclosure.append(toggle);box.append(disclosure);
    const table=document.createElement('table'),head=document.createElement('tr');['用途','当前','建议后'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th);});table.append(head);
    M.KEYS.forEach(k=>{const row=document.createElement('tr');[M.PROGRAMS[k].label,details.before[k],details.after[k]].forEach(t=>{const td=document.createElement('td');td.textContent=t;row.append(td);});table.append(row);});disclosure.append(table);
    const summary=document.createElement('p');summary.textContent=`影响 ${details.affectedFloors.join('、')}：${details.changes.length} 个模块转用途；${details.moved.length} 个模块按花园末端规则重排。黄框表示用途变化，橙框表示位置重排。小幅权重变化可能尚不足以改变整数模块数量。`;disclosure.append(summary);
    const apply=document.createElement('button');apply.type='button';apply.id='officeAIApply';apply.textContent='确认应用到 3D';apply.onclick=()=>{try{applyingTrace={format:'office-ai-run-v1',prompt:result.requestRecord?.message||lastText,language:result.requestRecord?.language||language(),history:result.requestRecord?.history||[],context:selection().selection,multiplier:details.multiplier,feedback:result.feedback,currentWeights:details.currentWeights,weights:result.weights,reply:result.reply,reason:result.reason,model:result.model,baseline:selection().state,initialLogistics:window.OfficeTower.captureLogistics(),requestedAt:result.requestRecord?.requestedAt};bridge.apply();}catch(e){applyingTrace=null;clear();notice(e.message);}};
    const cancel=document.createElement('button');cancel.type='button';cancel.id='officeAICancel';cancel.textContent='取消预览';cancel.onclick=()=>{clear();append('assistant',localized('这次建议已取消，楼体未修改。','This proposal has been cancelled. The building is unchanged.'));notice('已取消预览。');};box.append(apply,cancel);
  }
  function previewCached(){
    if(!cached)return;const c=cached,now=selection();
    if(c.snapshot!==JSON.stringify(now.state)||JSON.stringify(c.captured.selection)!==JSON.stringify(now.selection)||JSON.stringify(c.captured.weights)!==JSON.stringify(now.weights)){clear();notice('模型、范围或权重已改变，请重新发送。');return;}
    const multiplier=Number($('officeAIMultiplier').value),p=M.proposeFeedback(now.state,now.selection,c.result.feedback,multiplier);
    rescaling=true;try{const details=bridge.preview(c.result.feedback,c.snapshot,c.captured.selection,multiplier);showProposal({...c.result,weights:p.weights},{...details,currentWeights:p.currentWeights,multiplier});notice('这是增量需求预览，确认后才会保存。');}finally{rescaling=false;}
  }
  async function send(){
    const text=$('officeAIInput').value.trim();lastText=text;if(!text||request)return;
    clear();const captured=selection(),snapshot=JSON.stringify(captured.state),selectedKey=JSON.stringify(captured.selection),prior=messages.slice(-12),multiplier=Number($('officeAIMultiplier').value);
    append('user',text);$('officeAIInput').value='';const token=++epoch;request=new AbortController();setBusy(true);notice(localized('GPT 正在理解需求并检查模块数量…','GPT is interpreting your request and checking module counts…'));
    try{
      const response=await fetch('/api/office/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:request.signal,body:JSON.stringify({message:text,history:prior,state:captured.state,context:captured.selection,weights:captured.weights,multiplier,language:language()})});
      const result=await response.json();if(token!==epoch)return;
      if(!response.ok)throw Error(result.message||'办公需求请求失败。');
      const now=selection();if(snapshot!==JSON.stringify(now.state)||selectedKey!==JSON.stringify(now.selection)||JSON.stringify(captured.weights)!==JSON.stringify(now.weights))throw Error('等待回复期间模型、楼层或范围已改变。本次结果已丢弃，请重新发送需求。');
      if(result.kind==='proposal'){
        result.requestRecord={message:text,history:prior,language:language(),requestedAt:new Date().toISOString()};cached={result,snapshot,captured};append('assistant',result.reply);previewCached();
      }else{append('assistant',result.reply);notice(result.kind==='clarify'?'请补充说明，楼体未修改。':'楼体未修改。');}
    }catch(e){if(token===epoch){notice(e.name==='AbortError'?'已停止，楼体未修改。':e.message);$('officeAIInput').value=text;}}
    finally{if(token===epoch){request=null;setBusy(false);}}
  }
  $('officeAIForm').addEventListener('submit',e=>{e.preventDefault();send();});
  $('officeAIInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
  $('officeAIStop').onclick=()=>{stop();notice('已停止请求，楼体未修改。');};
  $('officeAIReconnect').onclick=connect;
  $('officeAIReset').onclick=()=>{stop();clear();try{if(messages.length)localStorage.setItem(historyKey+'.before-reset',JSON.stringify(messages));}catch{}messages=[];save();render();notice('已重开对话，当前楼体保留。');};
  $('officeAIScope').value=$('officeScope').value;
  $('officeAIScope').onchange=()=>{$('officeScope').value=$('officeAIScope').value;$('officeScope').dispatchEvent(new Event('change'));};
  $('officeScope').addEventListener('change',()=>{stop();clear();$('officeAIScope').value=$('officeScope').value;selectionLabel();notice('聊天与五维面板的需求范围已同步。');});
  $('officeAIMultiplier').oninput=()=>{$('officeAIMultiplierValue').textContent='×'+$('officeAIMultiplier').value;if(cached){try{previewCached();}catch(e){clear();notice(e.message);}return;}stop();clear();if(!$('officeAIInput').value.trim())$('officeAIInput').value=lastText;notice('已设置反馈份数，请发送需求。');};
  panel.querySelectorAll('[data-office-prompt]').forEach(b=>b.onclick=()=>{$('officeAIInput').value=window.OfficeI18n?.t(b.dataset.officePrompt)||b.dataset.officePrompt;$('officeAIInput').focus();});
  document.addEventListener('office:ai-preview',e=>{
    if(rescaling)return;cached=null;
    if(e.detail.status==='applied'){if(applyingTrace){try{localStorage.setItem('adaptive-office.last-ai-run',JSON.stringify({...applyingTrace,target:selection().state,completedAt:new Date().toISOString()}));}catch{}applyingTrace=null;}proposal=null;$('officeAIProposal').hidden=true;append('assistant',localized(`已确认应用：${e.detail.count} 个模块转换用途。可以用右侧“撤销”恢复。`,`Applied: ${e.detail.count} modules changed use. You can restore the previous state with Undo.`));notice('已应用并保存。');}
    else if(e.detail.status==='cleared'&&!proposal){applyingTrace=null;notice('当前楼体已保留，可继续输入需求。');}
    else if(e.detail.status==='transporting'){proposal=null;$('officeAIProposal').hidden=true;notice('已确认，正在搬运模块；完成后保存。');}
    else if(proposal){proposal=null;$('officeAIProposal').hidden=true;notice('预览已取消或失效，请重新生成建议。');}
  });
  // Existing model controls invalidate pending proposals through the bridge.
  new MutationObserver(selectionLabel).observe($('officeViewLabel'),{childList:true});
  $('officeUser').addEventListener('change',selectionLabel);
  document.addEventListener('office:language',()=>{
    if(request){stop();$('officeAIInput').value=lastText;notice(localized('语言已切换，请重新发送需求。','Language changed. Please resend your request.'));}
    if(!messages.length)render();
  });
  render();selectionLabel();connect();
}());

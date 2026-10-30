(function(){
  'use strict';
  const A=window.OfficeArchives,M=window.OfficeModel,$=id=>document.getElementById(id),KEY='adaptive-office.snapshots.v1';
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  $('officeLegend').insertAdjacentHTML('afterend',`<section class="office-counts office-archives" aria-label="楼体存档">
    <h3>楼体存档</h3><p>保存已确认的模块用途、楼层和挂接位置。未应用的 AI 预览不计入存档。</p>
    <div class="office-inputs"><label>存档名称<input id="archiveName" maxlength="80" placeholder="例如：方案 1 · 调整前"></label></div>
    <div class="office-actions"><button id="archiveSave" class="office-button office-primary">保存当前楼体为新存档</button><button id="archiveSaveAs" class="office-button">当前楼体另存到文件夹</button><button id="archiveUndoDelete" class="office-button" hidden>撤销删除存档</button><button id="archiveImport" class="office-button">导入存档</button><button id="archiveKeepLatest" class="office-button">只保留最新存档</button><button id="archiveUndoCleanup" class="office-button" hidden>撤销存档清理</button></div>
    <input id="archiveFile" type="file" accept=".json,application/json" hidden>
    <div id="archiveList"></div>
    <div class="office-inputs"><label>起点存档<select id="archiveFrom"></select></label><label>目标存档<select id="archiveTo"></select></label></div>
    <button id="archivePair" class="office-button">导出起点 → 目标</button><button id="dispatchPlan" class="office-button">计算两存档调度</button><button id="dispatchConfirm" class="office-button" disabled>确认并播放调度</button>
    <p>存档列表保存在本浏览器；点击「另存到文件夹」选择电脑上的保存位置。删除仅移除列表存档，可撤销，不删除已另存的文件。选择起点与目标，先计算搬运步骤，再确认播放。完成后才保存目标楼体。</p>
    <p id="archiveStatus" role="status" aria-live="polite"></p></section>`);
  let archives=[],readable=true;
  const say=t=>$('archiveStatus').textContent=t;
  try{archives=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(archives))throw Error();archives=archives.map(A.read);}catch{readable=false;archives=[];say('已有存档无法读取，已保留原始资料，暂停写入。');}
  function write(next){try{localStorage.setItem(KEY,JSON.stringify(next));archives=next;render();return true;}catch{say('浏览器空间不足，未写入存档。请先下载当前方案备份。');return false;}}
  function render(){
    const from=$('archiveFrom').value,to=$('archiveTo').value;
    $('archiveList').innerHTML=archives.length?archives.map(a=>`<article class="office-archive-row"><div><strong>${esc(a.name)}</strong><small>${esc(new Date(a.createdAt).toLocaleString())} · ${a.building.floors.length} 层 · ${a.summary.cubes} 个模块</small></div><div class="office-actions"><button class="office-button" data-export="${esc(a.id)}">下载</button><button class="office-button" data-save-as="${esc(a.id)}">另存到文件夹</button><button class="office-button" data-delete="${esc(a.id)}">删除</button><button class="office-button" data-restore="${esc(a.id)}">恢复此存档</button></div></article>`).join(''):'<p>暂无存档。先保存当前楼体，再调整并保存第二个版本。</p>';
    const options=archives.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${a.summary.cubes} ${window.OfficeI18n?.language==='en'?'modules':'模块'} · ${esc(new Date(a.createdAt).toLocaleTimeString())}</option>`).join('');
    $('archiveFrom').innerHTML=options;$('archiveTo').innerHTML=options;
    if(archives.some(a=>a.id===from))$('archiveFrom').value=from;
    $('archiveTo').value=archives.some(a=>a.id===to)?to:(archives.at(-1)?.id||'');
    $('archiveKeepLatest').disabled=!readable||archives.length<2;$('archiveUndoCleanup').hidden=!localStorage.getItem(KEY+'.before-cleanup');
    $('archiveUndoDelete').hidden=!localStorage.getItem(KEY+'.deleted');$('archiveSaveAs').disabled=!readable;
    $('archiveSave').disabled=!readable;$('archiveImport').disabled=!readable;updatePair();
  }
  function updatePair(){$('archivePair').disabled=archives.length<2||$('archiveFrom').value===$('archiveTo').value;$('dispatchPlan').disabled=$('archivePair').disabled;$('dispatchConfirm').disabled=true;}
  function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('archiveSave').onclick=()=>{try{const a=A.create(window.OfficeTower.getState(),$('archiveName').value||`存档 ${archives.length+1}`,crypto.randomUUID(),new Date().toISOString());try{const trace=JSON.parse(localStorage.getItem('adaptive-office.last-ai-run')||'null');if(trace&&JSON.stringify(trace.target)===JSON.stringify(a.building))a.aiRun=trace;}catch{}if(write([...archives,a])){$('archiveName').value='';$('archiveTo').value=a.id;updatePair();say(`已保存「${a.name}」：${a.summary.cubes} 个模块，当前楼体未改变。`);}}catch(e){say(e.message);}};
  async function saveAs(a){
    const filename=a.name.replace(/[\\/:*?"<>|]/g,'_')+'.json';
    if(!window.showSaveFilePicker){say('此浏览器不支持选择文件夹。请使用「下载」，或在 Chrome / Edge 中打开本页面后选择保存位置。');return false;}
    try{
      const handle=await window.showSaveFilePicker({id:'office-building-archives',suggestedName:filename,types:[{description:window.OfficeI18n.t('楼体存档 JSON'),accept:{'application/json':['.json']}}]});
      const writable=await handle.createWritable();
      try{await writable.write(JSON.stringify(a,null,2));await writable.close();}catch(e){await writable.abort().catch(()=>{});throw e;}
      say(`已将「${a.name}」保存到所选位置：${handle.name}。`);return true;
    }catch(e){say(e.name==='AbortError'?'已取消另存。':`另存失败：${e.message}`);return false;}
  }
  $('archiveSaveAs').onclick=()=>{try{const a=A.create(window.OfficeTower.getState(),$('archiveName').value||`存档 ${archives.length+1}`,crypto.randomUUID(),new Date().toISOString());saveAs(a);}catch(e){say(e.message);}};
  $('archiveList').onclick=e=>{
    const b=e.target.closest('button');if(!b)return;
    const a=archives.find(a=>a.id===(b.dataset.export||b.dataset.restore||b.dataset.saveAs||b.dataset.delete));if(!a)return;
    if(b.dataset.export)download(a.name,a);
    else if(b.dataset.saveAs)saveAs(a);
    else if(b.dataset.delete){
      try{const deleted=JSON.parse(localStorage.getItem(KEY+'.deleted')||'[]');deleted.push(a);localStorage.setItem(KEY+'.deleted',JSON.stringify(deleted));if(write(archives.filter(v=>v.id!==a.id)))say(`已从列表删除「${a.name}」，可撤销删除。当前楼体和电脑上的文件未改变。`);}catch{say('无法保存删除备份，存档未删除。');}
    }else if(confirm(window.OfficeI18n.t(`恢复「${a.name}」到当前楼体？恢复后可用“撤销”返回。`))){try{window.OfficeTower.restoreArchive(a.building);say(`已恢复「${a.name}」，可撤销。`);}catch(e){say(e.message);}}
  };
  $('archiveUndoDelete').onclick=()=>{
    try{const deleted=JSON.parse(localStorage.getItem(KEY+'.deleted')||'[]');if(!deleted.length)return;const a=A.read(deleted[deleted.length-1]);if(archives.some(v=>v.id===a.id)){say('此存档已在列表中。');return;}if(write([...archives,a])){deleted.pop();if(deleted.length)localStorage.setItem(KEY+'.deleted',JSON.stringify(deleted));else localStorage.removeItem(KEY+'.deleted');render();say(`已恢复「${a.name}」。`);}}catch{say('无法恢复删除的存档，现有存档未改变。');}
  };
  $('archiveFrom').onchange=updatePair;$('archiveTo').onchange=updatePair;
  $('archivePair').onclick=()=>{try{const p=A.pair(archives.find(a=>a.id===$('archiveFrom').value),archives.find(a=>a.id===$('archiveTo').value));download(`${p.from.name} → ${p.to.name}-调度输入`,p);say('已导出两个完整楼体状态，等待调度系统计算搬运方案。');}catch(e){say(e.message);}};
  $('archiveImport').onclick=()=>$('archiveFile').click();
  $('archiveFile').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>10*1024*1024)throw Error('请选择 10 MB 以内的存档。');const raw=JSON.parse(await file.text());const imported=(raw.format==='office-dispatch-request-v1'?[raw.from,raw.to]:[raw]).map(A.read);const next=[...archives];for(const a of imported){const old=next.find(x=>x.id===a.id);if(old){if(JSON.stringify(old)!==JSON.stringify(a))throw Error('存档编号冲突，未导入。');}else next.push(a);}if(write(next))say('存档已导入，当前楼体未改变。');}catch(e){say(e.message);}};
  $('archiveKeepLatest').onclick=()=>{
    if(!readable||archives.length<2)return;
    const latest=archives.reduce((a,b)=>Date.parse(b.createdAt)>=Date.parse(a.createdAt)?b:a);
    try{localStorage.setItem(KEY+'.before-cleanup',JSON.stringify(archives));if(write([latest]))say(`已只保留「${latest.name}」。可以撤销本次清理。`);}catch{say('无法保存清理备份，未清理任何存档。');}
  };
  $('archiveUndoCleanup').onclick=()=>{
    try{const previous=JSON.parse(localStorage.getItem(KEY+'.before-cleanup'));if(!Array.isArray(previous))throw Error();const merged=[...archives];for(const a of previous.map(A.read))if(!merged.some(x=>x.id===a.id))merged.push(a);if(write(merged)){localStorage.removeItem(KEY+'.before-cleanup');render();say('已恢复清理前的存档。');}}catch{say('无法读取清理备份，现有存档未改变。');}
  };
  $('dispatchPlan').onclick=()=>{const from=archives.find(a=>a.id===$('archiveFrom').value),to=archives.find(a=>a.id===$('archiveTo').value);if(!from||!to||from.id===to.id)return;document.dispatchEvent(new CustomEvent('office:archive-plan',{detail:{from,to}}));};
  $('dispatchConfirm').onclick=()=>document.dispatchEvent(new CustomEvent('office:archive-confirm'));
  // Use the same validated archive planner as the full editing interface.
  function demoPair(){
    const from=archives.find(a=>a.name==='均衡基础版 · 自动屋面花园');
    const candidates=archives.filter(a=>a.aiRun&&JSON.stringify(a.aiRun.baseline)===JSON.stringify(from?.building));
    const to=candidates.find(a=>a.id==='3154f267-6bb7-453e-a624-4717b7c9990c')||candidates.find(a=>a.name==='Classroom AI · Meetings ×20');
    return {from,to};
  }
  window.OfficeDemoArchives={scenario(){const {from,to}=demoPair();return to?{name:to.name,prompt:to.aiRun.prompt,multiplier:to.aiRun.multiplier,scope:to.aiRun.context.scope,model:to.aiRun.model}:null;},
  reset(){const {from,to}=demoPair();if(!from||!to)throw Error('Save an AI-generated target from the baseline first.');window.OfficeTower.restoreDemo(from.building,to.aiRun.initialLogistics);},
  prepare(){
    const {from,to}=demoPair();
    if(!from||!to)throw Error('Save an AI-generated target from the baseline first.');
    if(JSON.stringify(window.OfficeTower.captureLogistics())!==JSON.stringify(to.aiRun.initialLogistics))throw Error('Reset to demo baseline first to restore the recorded stock.');
    $('archiveFrom').value=from.id;$('archiveTo').value=to.id;updatePair();$('dispatchPlan').click();
    if($('dispatchConfirm').disabled)throw Error($('logisticsStatus').textContent||'Unable to prepare this transition.');
    return {from:from.summary.cubes,to:to.summary.cubes,name:to.name};
  },play(){if($('dispatchConfirm').disabled)throw Error('Prepare the transition again before playing.');$('dispatchConfirm').click();}};
  document.addEventListener('office:language',()=>{const disabled=$('dispatchConfirm').disabled;render();$('dispatchConfirm').disabled=disabled;});
  render();
}());

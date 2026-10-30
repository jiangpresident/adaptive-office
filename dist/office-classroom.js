(function(){
'use strict';
const $=id=>document.getElementById(id);
const toggle=document.createElement('button');toggle.id='classroomToggle';toggle.className='office-button';toggle.textContent='课堂演示 / Presentation';toggle.setAttribute('aria-pressed','false');document.querySelector('.site-header').append(toggle);
const bar=document.createElement('section');bar.id='classroomBar';bar.hidden=true;
bar.innerHTML=`<div><span class="classroom-kicker">CLASSROOM DEMO</span><h2>From baseline to recorded AI target</h2><p>Balanced baseline · Automatic roof gardens → Recorded AI target</p></div><div class="classroom-actions"><button id="classroomReset">Reset to demo baseline</button><button id="classroomPrepare">Preview saved transition</button><button id="classroomPlay" disabled>Play recorded result</button><label>Speed <select id="classroomSpeed"><option value="3">×3</option><option value="10">×10</option><option value="30">×30</option></select></label><button id="classroomEditing" aria-expanded="false">Show editing controls</button></div><details id="classroomRecord"><summary>Recorded prompt &amp; multiplier</summary><p id="classroomPrompt"></p><p id="classroomMeta"></p><p>Playback uses the saved AI result. It does not call GPT again. Unchanged demand weights do not guarantee unchanged module counts; modules follow relative weights.</p><button id="classroomLoadPrompt">Load prompt into chat</button></details><p id="classroomStatus" role="status">Reset to demo baseline, preview, then play the recorded AI result.</p>`;
$('officeWorkspace').prepend(bar);
let active=false;
function showRecord(){const record=window.OfficeDemoArchives.scenario();$('classroomPrompt').textContent=record?.prompt||'No recorded AI target yet.';$('classroomMeta').textContent=record?`Feedback ×${record.multiplier} · Scope: ${record.scope} · Model: ${record.model} · Target: ${record.name}`:'';}
showRecord();
$('classroomReset').onclick=()=>{try{window.OfficeDemoArchives.reset();showRecord();$('officeAIScope').value='building';$('officeAIScope').dispatchEvent(new Event('change'));$('classroomPrepare').click();}catch(e){$('classroomStatus').textContent=e.message;}};
$('classroomLoadPrompt').onclick=()=>{const record=window.OfficeDemoArchives.scenario();if(!record)return;$('officeAIScope').value=record.scope;$('officeAIScope').dispatchEvent(new Event('change'));$('officeAIMultiplier').value=record.multiplier;$('officeAIMultiplier').dispatchEvent(new Event('input'));$('officeAIInput').value=record.prompt;$('classroomStatus').textContent='Recorded prompt loaded. Sending it makes a new live GPT request; use Play recorded result for the rehearsed animation.';};

function setMode(value){active=value;document.body.classList.toggle('classroom-mode',value);document.body.classList.remove('classroom-editing');bar.hidden=!value;toggle.setAttribute('aria-pressed',String(value));toggle.textContent=value?'Exit presentation':'课堂演示 / Presentation';$('classroomEditing').textContent='Show editing controls';$('classroomEditing').setAttribute('aria-expanded','false');
 if(value){$('officeLanguage').value='en';$('officeLanguage').dispatchEvent(new Event('change'));}
 try{localStorage.setItem('adaptive-office.classroom',value?'1':'0');}catch{}
 window.dispatchEvent(new Event('resize'));
}
toggle.onclick=()=>setMode(!active);
$('classroomSpeed').onchange=()=>{$('logisticsSpeed').value=$('classroomSpeed').value;$('logisticsSpeed').dispatchEvent(new Event('input'));};
$('classroomEditing').onclick=()=>{const open=document.body.classList.toggle('classroom-editing');$('classroomEditing').textContent=open?'Hide editing controls':'Show editing controls';$('classroomEditing').setAttribute('aria-expanded',String(open));window.dispatchEvent(new Event('resize'));};
$('classroomPrepare').onclick=()=>{try{
 if(!$('logisticsPause').disabled)throw Error('Finish or cancel the current dispatch before preparing the saved transition.');
 showRecord();const counts=window.OfficeDemoArchives.prepare();$('classroomPlay').disabled=false;
 $('classroomStatus').textContent=`Ready: ${counts.from} → ${counts.to} modules. Capacity checked. Play starts from the saved baseline and applies the recorded AI target on completion.`;
 $('officeHome').click();
}catch(e){$('classroomPlay').disabled=true;$('classroomStatus').textContent=window.OfficeI18n.t(e.message);}};
$('classroomPlay').onclick=()=>{try{window.OfficeDemoArchives.play();$('classroomPlay').disabled=true;$('classroomStatus').textContent=$('logisticsPause').disabled?'Unable to start. Prepare the transition again.':'Playing baseline → recorded AI target. Playback controls are below the 3D view.';}catch(e){$('classroomStatus').textContent=window.OfficeI18n.t(e.message);}};
new MutationObserver(()=>{if($('dispatchConfirm').disabled)$('classroomPlay').disabled=true;}).observe($('dispatchConfirm'),{attributes:true,attributeFilter:['disabled']});
try{if(localStorage.getItem('adaptive-office.classroom')==='1')setMode(true);}catch{}
}());

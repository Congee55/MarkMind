/* MarkMind 3.3 — isolated AI title editor UI; shares the 3.2 shell. */
'use strict';
const R=MarkMindRename;
let renameModeUI='folder', renameFolderUI='', renameCheckedUI=new Set();
let renamePlanUI=null, renameStatusUI={status:'idle'}, renameHasCheckpointUI=false,renameHasUndoUI=false;
let renameSourceLimitUI=12, renamePersistUI=0, renameScopeErrorUI='';
const renameRunningUI=()=>['running','applying','undoing'].includes(renameStatusUI?.status);
function renameIsWorking(){return renameRunningUI();}
function activeRenameItems(){
  if(!state)return [];
  if(renameModeUI==='folder')return renameFolderUI?R.scopeItems(state,{mode:'folder',folderId:renameFolderUI}):[];
  return state.bookmarks;
}
function chosenRenameItems(){return activeRenameItems().filter(b=>renameCheckedUI.has(String(b.id)));}
function scopeForNaming(){
  if(renameModeUI==='folder')return {mode:'folder',folderId:renameFolderUI,bookmarkIds:chosenRenameItems().map(b=>b.id)};
  return {mode:'selected',bookmarkIds:chosenRenameItems().map(b=>b.id)};
}
function setRenameMode(mode){
  if(renameRunningUI()||isWorking()||!['folder','selected'].includes(mode))return;
  if(renameModeUI!==mode){
    renameModeUI=mode;renameCheckedUI=new Set();renameSourceLimitUI=12;
    if(renamePlanUI)void clearRenamePreview();
  }
  updateRenameDraft();renderRenameUI();
}
function setRenameFolder(id,auto=false){
  if(renameRunningUI()||isWorking()||!state)return;
  if(id && !state.folders.some(f=>String(f.id)===String(id)))return;
  if(renameFolderUI!==String(id)){
    renameFolderUI=String(id);renameSourceLimitUI=12;
    renameCheckedUI=new Set(R.scopeItems(state,{mode:'folder',folderId:renameFolderUI}).map(b=>b.id));
    if(renamePlanUI)void clearRenamePreview();
    updateRenameDraft();
  }
  interpretRenameInstruction();renderRenameUI();
}
function updateRenameDraft(){
  clearTimeout(renamePersistUI);
  renamePersistUI=setTimeout(()=>{
    storage().set({renameDraft:{mode:renameModeUI,folderId:renameFolderUI,selectedIds:[...renameCheckedUI],instruction:$('renameInstruction').value}}).catch(()=>{});
  },250);
}
async function clearRenamePreview(){
  if(renameRunningUI())return;
  renamePlanUI=null;renameStatusUI={status:'idle'};
  const res=await chrome.runtime.sendMessage({type:'clearRename'}).catch(e=>({ok:false,error:e.message}));
  if(!res?.ok)notify(res?.error||'无法重置命名方案',true);
  renderRenameUI();
}
function folderLabel(f){return [f.path,f.title].filter(Boolean).join(' / ');}
function renderFolderOptions(){
  const select=$('renameFolderSelect'),prior=select.value;
  select.textContent='';
  const defaultOpt=node('option','', '请选择文件夹');defaultOpt.value='';select.append(defaultOpt);
  for(const f of (state?.folders||[]).slice().sort((a,b)=>folderLabel(a).localeCompare(folderLabel(b),'zh-CN'))){
    const opt=node('option','',folderLabel(f));opt.value=f.id;select.append(opt);
  }
  select.value=renameFolderUI||'';
  const current=state?.folders.find(f=>String(f.id)===String(renameFolderUI));
  $('renameFolderPickerText').textContent=current?folderLabel(current):'选择文件夹';
  $('renameFolderPickerBtn').disabled=renameRunningUI();
}
function interpretRenameInstruction(){
  renameScopeErrorUI='';
  const text=$('renameInstruction').value.trim();
  const found=R.inferFolder(text,state?.folders||[],E.canonicalName);
  if(renameModeUI==='folder'){
    if(found.ambiguous && !found.candidates.some(f=>String(f.id)===String(renameFolderUI))){renameScopeErrorUI='指令涉及多个同名或不同文件夹，请在上方手动选定唯一目录。';}
    else if(found.folderId && !renameFolderUI){setRenameFolder(found.folderId,true);return;}
    else if(found.folderId && renameFolderUI!==found.folderId){
      const named=state.folders.find(f=>f.id===found.folderId);
      renameScopeErrorUI=`指令指向「${named?.title||'另一个目录'}」，当前选择的是其他文件夹。请统一范围。`;
    }
  }else if(found.ambiguous){
    renameScopeErrorUI='指令提及多个文件夹；请选择「按文件夹」并明确范围，或删除文件夹限制。';
  }else if(found.folderId){
    const wrong=chosenRenameItems().filter(b=>!R.isInsideFolder(b,found.folderId,state.folders));
    if(wrong.length)renameScopeErrorUI=`所选书签有 ${wrong.length} 条不属于指令指定的文件夹。请调整勾选范围。`;
  }
  renderRenameHint();updateRenameButtons();
}
function renderRenameHint(){
  const hint=$('renameScopeHint');
  const selected=chosenRenameItems().length;
  const folder=state?.folders.find(f=>String(f.id)===String(renameFolderUI));
  if(renameScopeErrorUI){hint.textContent=renameScopeErrorUI;hint.classList.add('warn');return;}
  hint.classList.remove('warn');
  if(renameModeUI==='folder'&&folder){hint.textContent=`范围已锁定：${folderLabel(folder)} · 已选 ${selected} 条（含子目录），不会修改其他文件夹。`;}
  else if(renameModeUI==='selected'){hint.textContent=`已勾选 ${selected} 条。AI 只能处理这些书签，不会修改未勾选的网页。`;}
  else hint.textContent='选择一个文件夹，或勾选需要优化的书签。';
}
function renderRenameSource(){
  const target=$('renameSourceList');target.textContent='';
  const items=activeRenameItems(),filter=$('renameSearch').value.trim().toLowerCase();
  const matches=items.filter(b=>[b.title,b.url,b.path].some(x=>String(x||'').toLowerCase().includes(filter)));
  $('renameCount').textContent=chosenRenameItems().length+' 条已选';
  if(!items.length){target.append(node('div','rename-empty',renameModeUI==='folder'?'请选择包含书签的文件夹。':'书签库为空。'));return;}
  if(!matches.length){target.append(node('div','rename-empty','没有匹配的书签'));return;}
  for(const b of matches.slice(0,renameSourceLimitUI)){
    const row=node('label','rename-source-item'),check=node('input');check.type='checkbox';check.checked=renameCheckedUI.has(b.id);check.disabled=renameRunningUI();
    check.setAttribute('aria-label','选择 '+b.title);
    check.addEventListener('change',()=>{
      if(check.checked)renameCheckedUI.add(b.id);else renameCheckedUI.delete(b.id);
      if(renamePlanUI)void clearRenamePreview();
      updateRenameDraft();renderRenameHint();updateRenameButtons();$('renameCount').textContent=chosenRenameItems().length+' 条已选';
    });
    const text=node('span','rename-source-text');const name=node('strong','',b.title);name.title=b.title;
    const where=node('small','',[b.path,b.domain].filter(Boolean).join(' · '));where.title=where.textContent;
    text.append(name,where);row.append(check,text);target.append(row);
  }
  if(matches.length>renameSourceLimitUI){
    const more=node('button','rename-more',`显示更多 · 还有 ${matches.length-renameSourceLimitUI} 条`);
    more.type='button';more.addEventListener('click',()=>{renameSourceLimitUI+=30;renderRenameSource();});target.append(more);
  }
}
function renameSelectedChanges(){
  return (renamePlanUI?.items||[]).filter(i=>i.selected&&R.normalizeTitle(i.newTitle)&&R.normalizeTitle(i.newTitle)!==i.oldTitle).length;
}
function renderRenameResults(){
  const target=$('renameResultList');target.textContent='';
  const items=renamePlanUI?.items||[];
  $('renameReviewCount').textContent=renameSelectedChanges()+' 条准备修改';
  for(const item of items){
    const row=node('div','rename-result-item'+(item.status!=='ready'?' pending':''));
    const check=node('input');check.type='checkbox';check.checked=Boolean(item.selected);check.disabled=renameRunningUI();check.title='应用这条新名称';
    check.setAttribute('aria-label','修改 '+item.oldTitle);
    const body=node('div','rename-result-content');
    const old=node('span','rename-result-old','原名：'+item.oldTitle);old.title=item.oldTitle;
    const inp=node('input');inp.type='text';inp.maxLength=88;inp.value=item.newTitle;inp.placeholder='输入新的书签名称';inp.disabled=renameRunningUI();inp.setAttribute('aria-label','新名称：'+item.oldTitle);
    const reason=node('small','rename-reason',item.reason||'可手动修改后选择此条');
    check.addEventListener('change',()=>{item.selected=check.checked;persistRenamePlanUI();$('renameReviewCount').textContent=renameSelectedChanges()+' 条准备修改';updateRenameButtons();});
    inp.addEventListener('input',()=>{
      item.newTitle=inp.value;
      if(item.newTitle.trim()!==item.oldTitle&&R.normalizeTitle(item.newTitle)){item.selected=true;check.checked=true;}
      persistRenamePlanUI();$('renameReviewCount').textContent=renameSelectedChanges()+' 条准备修改';updateRenameButtons();
    });
    body.append(old,inp,reason);row.append(check,body);target.append(row);
  }
  if(!items.length)target.append(node('div','rename-empty','未生成命名建议，请重新分析。'));
}
let renamePlanTimerUI=0;
function persistRenamePlanUI(){
  clearTimeout(renamePlanTimerUI);
  renamePlanTimerUI=setTimeout(()=>storage().set({renamePlan:renamePlanUI}).catch(()=>{}),230);
}
function renderRenameUI(){
  if(!$('renameFolderSelect'))return;
  const previewing=Boolean(renamePlanUI && !['applied','undoing'].includes(renameStatusUI?.status));
  document.querySelector('.rename-page').classList.toggle('has-review',previewing);
  if(previewing){
    const folder=state?.folders.find(f=>String(f.id)===String(renamePlanUI.scope?.folderId));
    $('renameLockText').textContent=renamePlanUI.scope.mode==='folder' ? ('仅处理：'+(folder?folderLabel(folder):'指定文件夹')+' · '+renamePlanUI.items.length+' 条') : ('仅处理已选的 '+renamePlanUI.items.length+' 条书签');
  }
  document.querySelectorAll('[data-rename-mode]').forEach(b=>{const on=b.dataset.renameMode===renameModeUI;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));b.disabled=renameRunningUI();});
  $('renameFolderSection').classList.toggle('hidden',renameModeUI!=='folder');
  $('renameFolderSelect').disabled=renameRunningUI();
  $('renameInstruction').disabled=renameRunningUI();
  $('renameToggleAll').disabled=renameRunningUI();
  renderFolderOptions();
  if(renamePlanUI && !['applied','undoing'].includes(renameStatusUI?.status)){
    $('renameSourceBox').classList.add('hidden');$('renameReviewBox').classList.remove('hidden');
    renderRenameResults();
  }else{
    $('renameSourceBox').classList.remove('hidden');$('renameReviewBox').classList.add('hidden');
    renderRenameSource();
  }
  const chosen=chosenRenameItems().length,all=activeRenameItems().length;
  $('renameToggleAll').textContent=chosen===all&&all?'取消全选':'全选';
  $('renameResetBtn').classList.toggle('hidden',!renamePlanUI&&!renameHasCheckpointUI);
  $('renameUndoBtn').classList.toggle('hidden',!renameHasUndoUI);
  if(renameStatusUI?.status==='error'){
    const hint=$('renameScopeHint');hint.textContent='后台命名遇到问题：'+(renameStatusUI.error||'未知错误')+(renameHasCheckpointUI?'。可以从上次进度继续':'');hint.classList.add('warn');
  }else renderRenameHint();
  updateRenameButtons();
}
function updateRenameButtons(){
  const button=$('renameActionBtn');if(!button)return;
  button.classList.toggle('hidden',activeTab!=='rename'||(typeof aiWorkflowUI!=='undefined'&&aiWorkflowUI!=='rename'));
  const busyOther=busy||isRunningAnalysis()||backupTask?.status==='running';
  const status=renameStatusUI?.status||'idle';
  if(['running','applying','undoing'].includes(status)){
    $('renameActionLabel').textContent=status==='running'?`后台优化中 ${renameStatusUI.completed||0}/${renameStatusUI.total||0}`:status==='undoing'?'正在恢复旧名称…':'正在修改名称…';
    button.disabled=true;
  }else if(renamePlanUI&&status==='completed'){
    $('renameActionLabel').textContent='确认修改 '+renameSelectedChanges()+' 条';
    button.disabled=busyOther||renameSelectedChanges()===0;
  }else if(status==='error'&&renameHasUndoUI&&!renameHasCheckpointUI){
    $('renameActionLabel').textContent='请先撤销中断的修改';button.disabled=true;
  }else if(renameHasCheckpointUI&&status==='error'){
    $('renameActionLabel').textContent='继续上次命名分析';button.disabled=busyOther;
  }else{
    $('renameActionLabel').textContent='生成命名建议';
    button.disabled=busyOther||!chosenRenameItems().length||Boolean(renameScopeErrorUI);
  }
  $('renameUndoBtn').disabled=busyOther||renameRunningUI();
  $('footerHint').textContent=activeTab==='rename'
    ? (status==='running'?'关闭弹窗后后台仍会继续':status==='completed'?'建议先核对新旧标题，再确认修改':'不会移动书签或修改网址')
    : $('footerHint').textContent;
}
async function startRenameOrApply(){
  if(isWorking()||renameScopeErrorUI)return;
  if(renamePlanUI&&renameStatusUI?.status==='completed')return showRenameConfirm();
  const scope=scopeForNaming();
  if(renameStatusUI?.status==='error'&&renameHasCheckpointUI){
    const result=await chrome.runtime.sendMessage({type:'startRename',resume:true});
    if(!result?.ok)notify(result.error||'无法恢复进度',true);else{renameStatusUI.status='running';renderRenameUI();}
    return;
  }
  if(!scope.bookmarkIds?.length){notify('请先选择书签或文件夹');return;}
  if(renameModeUI==='folder'&&!scope.folderId){notify('请选择要处理的文件夹');return;}
  const prefs=await storage().get(AI.keys);
  if(!AI.hasKey(prefs)){$('settingsDialog').showModal();notify('请先配置 AI 接口');return;}
  try{
    const res=await chrome.runtime.sendMessage({type:'startRename',scope,instruction:$('renameInstruction').value.trim()});
    if(!res?.ok)throw Error(res?.error||'无法开始分析');
    renamePlanUI=null;renameStatusUI={status:'running',completed:0,total:scope.bookmarkIds.length,message:'AI 正在后台生成新名称'};renameHasCheckpointUI=true;
    $('renameNavDot').classList.remove('hidden');
    renderRenameUI();updateButtons();notify('已启动后台命名，关闭弹窗不会丢失结果。');
  }catch(err){notify(err.message,true);}
}
function showRenameConfirm(){
  if(isWorking()||!renamePlanUI||!renameSelectedChanges())return;
  const num=renameSelectedChanges();
  const names=renamePlanUI.scope.mode==='folder'
    ? folderLabel(state.folders.find(f=>String(f.id)===String(renamePlanUI.scope.folderId))||{title:'原文件夹',path:''})
    : '手动勾选的书签';
  $('renameConfirmSummary').textContent=`仅修改「${names}」范围内 ${num} 条书签的标题。网址、文件夹及其他未选择书签均不改变。`;
  $('renameConfirmCheck').checked=false;$('renameConfirmBtn').disabled=true;$('renameConfirmDialog').showModal();
}
async function confirmRenameApply(){
  if(isWorking()||!renamePlanUI||!$('renameConfirmCheck').checked)return;
  try{
    clearTimeout(renamePlanTimerUI);await storage().set({renamePlan:renamePlanUI});
    const result=await chrome.runtime.sendMessage({type:'applyRename'});
    if(!result?.ok)throw Error(result?.error||'无法启动名称修改');
    $('renameConfirmDialog').close();
    renameStatusUI={status:'applying',total:result.count,completed:0};
    renderRenameUI();updateButtons();notify('已启动命名修改，结果和撤销记录保存在浏览器本地。');
  }catch(err){notify('命名修改失败：'+err.message,true);}
}
async function undoRenameUI(){
  if(isWorking()||!renameHasUndoUI)return;
  if(!confirm('撤销上次 AI 命名？仅恢复仍保持上次生成标题的书签，不影响后续手动改名的项目。'))return;
  try{
    const resp=await chrome.runtime.sendMessage({type:'undoRename'});
    if(!resp?.ok)throw Error(resp?.error||'撤销失败');
    renameHasUndoUI=false;renamePlanUI=null;renameStatusUI={status:'idle'};
    await refresh();renderRenameUI();notify(`已恢复 ${resp.restored} 条书签名称${resp.skipped?`，跳过 ${resp.skipped} 条`:''}`);
  }catch(err){notify('撤销失败：'+err.message,true);}
}
function setRenameBookmark(id){
  if(isWorking())return;
  renameModeUI='selected';renameFolderUI='';renameCheckedUI=new Set([String(id)]);renameSourceLimitUI=12;
  $('renameSearch').value='';
  if(renamePlanUI)void clearRenamePreview();
  updateRenameDraft();setTab('rename');
}

let renameResetAfterApplyUI=false;
async function resetRenameAfterApply(){
  if(renameResetAfterApplyUI)return;
  renameResetAfterApplyUI=true;
  try{
    const message=renameStatusUI.message||'书签命名已完成';
    let res;
    for(let attempt=0;attempt<12;attempt++){
      res=await chrome.runtime.sendMessage({type:'clearRename'});
      if(res?.ok)break;
      if(!/正在|进行中|后台任务|尚未|未完成|执行中/.test(String(res?.error||'')))break;
      await new Promise(r=>setTimeout(r,140));
    }
    if(!res?.ok)throw Error(res?.error||'无法清理旧方案');
    clearTimeout(renamePersistUI);clearTimeout(renamePlanTimerUI);
    renamePlanUI=null;renameStatusUI={status:'idle'};renameHasCheckpointUI=false;
    renameModeUI='folder';renameFolderUI='';renameCheckedUI=new Set();renameSourceLimitUI=12;
    $('renameInstruction').value='';$('renameSearch').value='';
    await storage().remove('renameDraft');
    renderRenameUI();updateButtons();
    if(activeTab==='rename')notify(message);
  }catch(error){console.error('命名重置失败',error);}
  finally{renameResetAfterApplyUI=false;}
}

async function initRenameUI(){
  const saved=await storage().get(['renameDraft']);
  if(saved.renameDraft){
    renameModeUI=saved.renameDraft.mode==='selected'?'selected':'folder';
    renameFolderUI=String(saved.renameDraft.folderId||'');
    renameCheckedUI=new Set((saved.renameDraft.selectedIds||[]).map(String));
    $('renameInstruction').value=String(saved.renameDraft.instruction||'').slice(0,350);
  }
  if(!state){state=E.scan(await chrome.bookmarks.getTree());}
  const result=await chrome.runtime.sendMessage({type:'getRenameState'}).catch(()=>null);
  if(result?.ok){
    renameStatusUI=result.state||{status:'idle'};renamePlanUI=result.plan||null;renameHasCheckpointUI=!!result.hasCheckpoint;renameHasUndoUI=!!result.undo;
    if(renamePlanUI){
      renameModeUI=renamePlanUI.scope?.mode||renameModeUI;
      renameFolderUI=String(renamePlanUI.scope?.folderId||'');
      renameCheckedUI=new Set(renamePlanUI.items.map(x=>String(x.id)));
      $('renameInstruction').value=renamePlanUI.instruction||'';
    }
  }
  $('renameFolderSelect').addEventListener('change',e=>setRenameFolder(e.target.value));
  document.querySelectorAll('[data-rename-mode]').forEach(b=>b.addEventListener('click',()=>setRenameMode(b.dataset.renameMode)));
  $('renameInstruction').addEventListener('input',()=>{interpretRenameInstruction();updateRenameDraft();});
  $('renameSearch').addEventListener('input',()=>{renameSourceLimitUI=12;renderRenameSource();});
  $('renameToggleAll').addEventListener('click',()=>{
    const all=activeRenameItems();const fully=all.length&&all.every(b=>renameCheckedUI.has(b.id));
    for(const b of all)fully?renameCheckedUI.delete(b.id):renameCheckedUI.add(b.id);
    if(renamePlanUI)void clearRenamePreview();
    renderRenameUI();updateRenameDraft();
  });
  $('renameActionBtn').addEventListener('click',startRenameOrApply);
  $('renameConfirmCheck').addEventListener('change',e=>{$('renameConfirmBtn').disabled=!e.target.checked||isWorking();});
  $('renameConfirmBtn').addEventListener('click',confirmRenameApply);
  $('renameUndoBtn').addEventListener('click',undoRenameUI);
  $('renameEditScopeBtn').addEventListener('click',async()=>{
    if(!confirm('返回编辑范围会清除当前命名建议，是否继续？'))return;
    await clearRenamePreview();
  });
  $('renameResetBtn').addEventListener('click',async()=>{
    if(renameHasCheckpointUI&&renameStatusUI.status==='error'){
      const res=await chrome.runtime.sendMessage({type:'discardRename'});
      if(!res?.ok)return notify(res?.error||'无法放弃任务',true);
      renameHasCheckpointUI=false;
    }
    await clearRenamePreview();
  });
  chrome.storage.onChanged.addListener(async (changes,area)=>{
    if(area!=='local')return;
    if(changes.renameState){
      renameStatusUI=changes.renameState.newValue||{status:'idle'};
      if(renameStatusUI.status==='error'){const status=await chrome.runtime.sendMessage({type:'getRenameState'}).catch(()=>null);renameHasCheckpointUI=!!status?.hasCheckpoint;}
      if(['completed','applied','idle'].includes(renameStatusUI.status))renameHasCheckpointUI=false;
      if(renameStatusUI.status==='applied'){await refresh();await resetRenameAfterApply();return;}
      renderRenameUI();updateButtons();
    }
    if(changes.renamePlan){
      const fresh=changes.renamePlan.newValue;
      // Don't recreate live input rows when the user saves a title edit.
      // Only a different plan or plan removal needs a full repaint.
      let changed=false;
      if(fresh && (!renamePlanUI || renamePlanUI.createdAt!==fresh.createdAt)){
        renamePlanUI=fresh;
        renameModeUI=fresh.scope?.mode||renameModeUI;
        renameFolderUI=String(fresh.scope?.folderId||renameFolderUI);
        renameCheckedUI=new Set(fresh.items.map(i=>String(i.id)));
        $('renameInstruction').value=fresh.instruction||'';
        changed=true;
      }else if(!fresh && renamePlanUI){renamePlanUI=null;changed=true;}
      if(changed){renderRenameUI();updateButtons();}
    }
    if(changes.renameUndo){renameHasUndoUI=!!changes.renameUndo.newValue;renderRenameUI();}
  });
  if(renameStatusUI.status==='applied')await resetRenameAfterApply();
  renderRenameUI();
}
document.addEventListener('DOMContentLoaded',()=>{void initRenameUI().catch(e=>console.error('命名页初始化失败',e));});

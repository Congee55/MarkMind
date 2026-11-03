/* MarkMind 3.4 — natural-language move editor and reusable searchable picker. */
'use strict';
const O = MarkMindOrganize;
let aiWorkflowUI='organize';
let orgFolderIdsUI=new Set(),orgBookmarkIdsUI=new Set(),orgParentIdUI='',orgPlanUI=null,orgStateUI={status:'idle'},orgUndoUI=false,orgCheckpointUI=false,orgApplyCheckpointUI=false,orgShowAllUI=false;
let pickerModeUI='source',pickerTypeUI='folders',pickerFolderIdsUI=new Set(),pickerBookmarkIdsUI=new Set(),pickerSingleIdUI='',pickerLimitUI=100;
let orgSaveTimerUI=0,orgPlanSaveTimerUI=0,orgWasAutoTargetUI=false;
const orgWorkingUI=()=>['running','applying','undoing'].includes(orgStateUI?.status);
const organizeIsWorking=()=>orgWorkingUI();
function orgCountScope(){return O.scopedBookmarks(state,{folderIds:[...orgFolderIdsUI],bookmarkIds:[...orgBookmarkIdsUI]}).length;}
function orgFolderById(id){return state?.folders?.find(f=>String(f.id)===String(id));}
function orgFolderLabel(f){return f?[f.path,f.title].filter(Boolean).join(' / '):'';}
function orgSaveDraft(){
 clearTimeout(orgSaveTimerUI);
 orgSaveTimerUI=setTimeout(()=>storage().set({organizeDraft:{folderIds:[...orgFolderIdsUI],bookmarkIds:[...orgBookmarkIdsUI],parentId:orgParentIdUI,targetName:$('orgTargetName').value,instruction:$('orgInstruction').value}}).catch(()=>{}),250);
}
function orgPersistPlan(){
 clearTimeout(orgPlanSaveTimerUI);orgPlanSaveTimerUI=setTimeout(()=>storage().set({organizePlan:orgPlanUI}).catch(()=>{}),180);
}
function orgInstructionEdited(){
 if(orgWorkingUI())return;
 const instruction=$('orgInstruction').value;
 const suggested=O.extractNewFolder(instruction);
 if(suggested&&(!$('orgTargetName').value.trim()||orgWasAutoTargetUI)){$('orgTargetName').value=suggested;orgWasAutoTargetUI=true;}
 const inferred=O.inferFolder(instruction,(state?.folders||[]).filter(f=>f.title!==suggested));
 if(!orgFolderIdsUI.size&&!orgBookmarkIdsUI.size&&inferred.folderId){
  orgFolderIdsUI.add(inferred.folderId);orgParentIdUI=inferred.folderId;
 }
 if(orgFolderIdsUI.size===1&&!orgParentIdUI)orgParentIdUI=[...orgFolderIdsUI][0];
 orgSaveDraft();orgRender();
}
function orgScopeText(){
 const nf=orgFolderIdsUI.size,nb=orgBookmarkIdsUI.size;
 if(!nf&&!nb)return '选择来源文件夹或单条书签';
 return `${nf} 个文件夹 · ${nb} 条单独书签 · 共 ${orgCountScope()} 条`;
}
function orgReviewSelectedCount(){return (orgPlanUI?.items||[]).filter(b=>b.selected).length;}
function renderOrgChips(){
 const box=$('orgScopeChips');box.textContent='';
 const labels=[...orgFolderIdsUI].map(id=>({id,kind:'folder',label:orgFolderLabel(orgFolderById(id))||'文件夹已删除'}))
  .concat([...orgBookmarkIdsUI].map(id=>({id,kind:'bookmark',label:state?.bookmarks.find(b=>b.id===id)?.title||'书签已删除'})));
 for(const ch of labels.slice(0,4)){
  const tag=node('span','scope-chip');tag.textContent=ch.label;tag.title=ch.label;
  const rm=node('button','','×');rm.type='button';rm.title='取消选择 '+ch.label;
  rm.addEventListener('click',()=>{
   if(orgWorkingUI())return;
   if(ch.kind==='folder')orgFolderIdsUI.delete(ch.id);else orgBookmarkIdsUI.delete(ch.id);
   if(orgParentIdUI===ch.id){orgParentIdUI=orgFolderIdsUI.size===1?[...orgFolderIdsUI][0]:'';}
   orgSaveDraft();orgRender();
  });
  tag.append(rm);box.append(tag);
 }
 if(labels.length>4)box.append(node('span','chip-more',`还有 ${labels.length-4} 项`));
}
function orgInstructionScope(){
 const text=$('orgInstruction').value.trim(),target=O.safeFolderName($('orgTargetName').value);
 const inferred=O.inferFolder(text,(state?.folders||[]).filter(f=>f.title!==target));
 const all=O.scopedBookmarks(state,{folderIds:[...orgFolderIdsUI],bookmarkIds:[...orgBookmarkIdsUI]});
 let folder=inferred.folderId;
 if(inferred.ambiguous){
  const chosen=inferred.candidates.filter(f=>orgFolderIdsUI.has(String(f.id)));
  if(chosen.length!==1)return {error:'指令可能指向多个同名文件夹，请在来源中仅选一个，并明确描述。',count:0};
  folder=String(chosen[0].id);
 }
 if(folder){
  const narrowed=all.filter(b=>O.isWithinFolder(b,folder,state?.folders||[]));
  if(!narrowed.length)return {error:'指令提到的文件夹不在所选来源范围内，请调整选择。',count:0};
  return {count:narrowed.length,narrowed:all.length>narrowed.length};
 }
 return {count:all.length,narrowed:false};
}
function orgHintMessage(){
 const scope=orgInstructionScope(),s=scope.count,name=O.safeFolderName($('orgTargetName').value),parent=orgFolderById(orgParentIdUI);
 if(orgStateUI.status==='error')return '任务中断：'+(orgStateUI.error||'未知错误')+((orgCheckpointUI||orgApplyCheckpointUI)?' · 可从上次进度继续':' · 请检查备份');
 if(scope.error)return scope.error;
 if(!s)return '选择要处理的文件夹或书签，或在上方描述想整理的内容。';
 if(!parent)return `已锁定 ${s} 条书签。还需要选择子文件夹的创建位置。`;
 if(!name)return `已锁定 ${s} 条书签。请填写要创建的子文件夹名称。`;
 return `${scope.narrowed?'指令已进一步缩小范围：':''}仅从 ${s} 条来源书签中筛选 → ${orgFolderLabel(parent)} / ${name}。其他保持原样。`;
}
function orgRender(){
 if(!$('organizeWorkflow'))return;
 const showReview=Boolean(orgPlanUI)&&['completed','applying','applied','undoing'].includes(orgStateUI?.status);
 $('orgEditor').classList.toggle('hidden',showReview);
 $('orgReview').classList.toggle('hidden',!showReview);
 $('orgUndoBtn').classList.toggle('hidden',!orgUndoUI);
 $('orgUndoBtn').disabled=isWorking()||orgWorkingUI()||orgApplyCheckpointUI;
 $('orgScopeText').textContent=orgScopeText();
 $('orgParentText').textContent=orgFolderById(orgParentIdUI)?orgFolderLabel(orgFolderById(orgParentIdUI)):'选择父文件夹';
 $('orgScopeBtn').disabled=orgWorkingUI();$('orgParentBtn').disabled=orgWorkingUI();
 $('orgTargetName').disabled=orgWorkingUI();$('orgInstruction').disabled=orgWorkingUI();
 $('orgHint').textContent=orgHintMessage();$('orgHint').classList.toggle('warn',orgStateUI.status==='error'||Boolean(orgInstructionScope().error));
 renderOrgChips();
 if(showReview){
  const parent=orgFolderById(orgPlanUI.targetParentId);
  $('orgReviewSummary').textContent=`${orgReviewSelectedCount()} 条 → ${orgFolderLabel(parent)||'原目标目录'} / ${orgPlanUI.targetName}`;
  $('orgMatched').textContent=`${orgReviewSelectedCount()} 条建议移动 · 共评估 ${orgPlanUI.items.length} 条`;
  $('orgShowAll').checked=orgShowAllUI;
  orgRenderReviewList();
 }
 orgUpdateButtons();
}
function orgRenderReviewList(){
 const list=$('orgResultList');list.textContent='';
 const items=(orgPlanUI?.items||[]).filter(x=>orgShowAllUI||x.suggested||x.selected);
 for(const item of items.slice(0,130)){
  const row=node('label','org-result-row');
  const check=node('input');check.type='checkbox';check.checked=Boolean(item.selected);check.disabled=orgWorkingUI();
  check.setAttribute('aria-label','移动 '+item.title);
  check.addEventListener('change',()=>{
   item.selected=check.checked;orgPersistPlan();
   $('orgMatched').textContent=`${orgReviewSelectedCount()} 条建议移动 · 共评估 ${orgPlanUI.items.length} 条`;
   $('orgReviewSummary').textContent=`${orgReviewSelectedCount()} 条 → ${orgFolderLabel(orgFolderById(orgPlanUI.targetParentId))} / ${orgPlanUI.targetName}`;
   orgUpdateButtons();
  });
  const inner=node('span','org-result-text');
  const title=node('strong','',item.title);title.title=item.title;
  const sub=node('small','',`${item.path||'根目录'} · ${item.reason||'用途不明确'}`);sub.title=sub.textContent;
  inner.append(title,sub);row.append(check,inner);list.append(row);
 }
 if(!items.length)list.append(node('div','rename-empty','AI 暂未发现明显相关的书签。可以勾选“显示未匹配”后逐条检查。'));
 if(items.length>130)list.append(node('div','rename-empty',`显示前 130 条，共 ${items.length} 条。可取消部分勾选后再执行。`));
}
function orgUpdateButtons(){
 const btn=$('orgActionBtn');if(!btn)return;
 btn.classList.toggle('hidden',activeTab!=='rename'||aiWorkflowUI!=='organize');
 const status=orgStateUI?.status||'idle';
 const otherBusy=busy||isRunningAnalysis()||backupTask?.status==='running'||(typeof renameIsWorking==='function'&&renameIsWorking());
 if(status==='running'){$('orgActionLabel').textContent=`后台筛选中 ${orgStateUI.completed||0}/${orgStateUI.total||0}`;btn.disabled=true;}
 else if(status==='applying'||status==='undoing'){$('orgActionLabel').textContent=status==='applying'?'正在移动书签…':'正在恢复原位置…';btn.disabled=true;}
 else if(status==='completed'&&orgPlanUI){$('orgActionLabel').textContent=`确认移动 ${orgReviewSelectedCount()} 条`;btn.disabled=otherBusy||orgReviewSelectedCount()===0;}
 else if(status==='error'&&(orgCheckpointUI||orgApplyCheckpointUI)){$('orgActionLabel').textContent=orgApplyCheckpointUI?'继续未完成的移动':'继续上次分析';btn.disabled=otherBusy;}
 else if(status==='error'&&orgUndoUI){$('orgActionLabel').textContent='请先检查上次操作';btn.disabled=true;}
 else{
  $('orgActionLabel').textContent='生成整理方案';
  btn.disabled=otherBusy||!orgInstructionScope().count||Boolean(orgInstructionScope().error)||!orgParentIdUI||!O.safeFolderName($('orgTargetName').value)||$('orgInstruction').value.trim().length<5;
 }
 if(activeTab==='rename'&&aiWorkflowUI==='organize'){
  $('footerHint').textContent=status==='running'?'已保存进度，关闭弹窗仍可继续':status==='completed'?'先核对书签，再确认移动':'AI 只建议，确认后才移动；默认先备份';
 }
}
async function orgStartOrApply(){
 if(isWorking())return;
 if(orgStateUI.status==='completed'&&orgPlanUI)return orgConfirmShow();
 if(orgStateUI.status==='error'&&(orgCheckpointUI||orgApplyCheckpointUI)){
  const res=await chrome.runtime.sendMessage({type:'resumeOrganize'});
  if(!res?.ok)return notify(res?.error||'恢复失败',true);
  orgStateUI.status=orgApplyCheckpointUI?'applying':'running';orgRender();return;
 }
 const scope={folderIds:[...orgFolderIdsUI],bookmarkIds:[...orgBookmarkIdsUI]};
 const target=O.safeFolderName($('orgTargetName').value),parentId=orgParentIdUI,instruction=$('orgInstruction').value.trim();
 try{
  const res=await chrome.runtime.sendMessage({type:'startOrganize',scope,parentId,targetName:target,instruction});
  if(!res?.ok)throw Error(res?.error||'后台整理未能启动');
  orgPlanUI=null;orgStateUI={status:'running',completed:0,total:res.total};orgCheckpointUI=true;
  orgRender();notify('AI 正在后台筛选相关书签，可以关闭弹窗。');
 }catch(e){notify(e.message,true);}
}
function orgConfirmShow(){
 if(!orgPlanUI||!orgReviewSelectedCount())return;
 const f=orgFolderById(orgPlanUI.targetParentId);
 $('orgConfirmSummary').textContent=`将在「${orgFolderLabel(f)}」下面使用子文件夹「${orgPlanUI.targetName}」，并将 ${orgReviewSelectedCount()} 条已审核的书签移动进去。其他书签保持原位置。`;
 $('orgConfirmCheck').checked=false;$('orgConfirmBtn').disabled=true;$('orgConfirmDialog').showModal();
}
async function orgConfirmApply(){
 if(!$('orgConfirmCheck').checked||!orgPlanUI)return;
 try{
  clearTimeout(orgPlanSaveTimerUI);await storage().set({organizePlan:orgPlanUI});
  const resp=await chrome.runtime.sendMessage({type:'applyOrganize'});
  if(!resp?.ok)throw Error(resp?.error||'无法启动移动');
  $('orgConfirmDialog').close();orgStateUI={status:'applying',completed:0,total:resp.count};orgRender();
  notify('已开始备份并移动，完成后可撤销。');
 }catch(e){notify(e.message,true);}
}
async function orgUndoLast(){
 if(isWorking()||!orgUndoUI)return;
 if(!confirm('撤销上次 AI 整理？只恢复此次实际移动且仍在目标目录的书签。'))return;
 try{
  const res=await chrome.runtime.sendMessage({type:'undoOrganize'});
  if(!res?.ok)throw Error(res.error||'撤销失败');
  orgUndoUI=false;orgPlanUI=null;orgStateUI={status:'idle'};await refresh();orgRender();
  notify(`已恢复 ${res.restored} 条，跳过 ${res.skipped} 条`);
 }catch(e){notify(e.message,true);}
}
async function orgEditScope(){
 if(orgWorkingUI())return;
 if(!confirm('编辑指令会清除当前移动建议，确定返回吗？'))return;
 let res;
    for(let attempt=0;attempt<12;attempt++){
      res=await chrome.runtime.sendMessage({type:'clearOrganize'});
      if(res?.ok)break;
      if(!/正在|进行中|后台任务|尚未|未完成|执行中/.test(String(res?.error||'')))break;
      await new Promise(r=>setTimeout(r,140));
    }
 if(!res?.ok)return notify(res.error||'无法清除方案',true);
 orgPlanUI=null;orgStateUI={status:'idle'};orgRender();
}
function setAiWorkflow(mode){
 if(!['organize','rename'].includes(mode))return;
 aiWorkflowUI=mode;
 document.querySelectorAll('[data-ai-workflow]').forEach(btn=>{const on=btn.dataset.aiWorkflow===mode;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));});
 $('organizeWorkflow').classList.toggle('hidden',mode!=='organize');
 $('renameWorkflow').classList.toggle('hidden',mode!=='rename');
 $('aiActionState').textContent=mode==='organize'?'智能移动':'优化命名';
 if(mode==='rename')renderRenameUI();else orgRender();
 if(typeof updateRenameButtons==='function')updateRenameButtons();
 orgUpdateButtons();
}

// Shared picker: contained, searchable, keyboard-accessible; no native giant dropdown.
function openScopePicker(mode){
 if(isWorking()||orgWorkingUI())return;
 pickerModeUI=mode;pickerTypeUI='folders';pickerLimitUI=100;
 pickerFolderIdsUI=new Set(mode==='source'?[...orgFolderIdsUI]:[]);
 pickerBookmarkIdsUI=new Set(mode==='source'?[...orgBookmarkIdsUI]:[]);
 pickerSingleIdUI=mode==='rename'?renameFolderUI:mode==='parent'?orgParentIdUI:'';
 $('pickerTitle').textContent=mode==='source'?'选择来源范围':mode==='parent'?'选择创建位置':'选择命名文件夹';
 $('pickerSubtitle').textContent=mode==='source'?'支持多选文件夹和单条书签；选择文件夹包括其全部子目录':mode==='parent'?'只选择一个现有文件夹，新的子文件夹会建在其下':'只选择一个文件夹，命名范围包含其子目录';
 $('pickerTabs').classList.toggle('hidden',mode!=='source');
 $('pickerSearch').value='';renderPicker();$('pickerDialog').showModal();$('pickerSearch').focus();
}
function pickerItems(){
 const term=$('pickerSearch').value.toLocaleLowerCase().trim();
 const list=pickerModeUI!=='source'||pickerTypeUI==='folders'
  ?(state?.folders||[]).map(f=>({...f,kind:'folder',label:f.title,sub:f.path||'书签根目录'}))
  :(state?.bookmarks||[]).map(b=>({...b,kind:'bookmark',label:b.title,sub:b.path||b.domain||'书签根目录'}));
 return list.filter(x=>[x.label,x.sub,x.url].some(t=>String(t||'').toLocaleLowerCase().includes(term)))
   .sort((a,b)=>{
    if(a.kind==='folder'&&b.kind==='folder')return (a.depth||0)-(b.depth||0)||a.label.localeCompare(b.label,'zh-CN');
    return a.label.localeCompare(b.label,'zh-CN');
   });
}
function renderPicker(){
 const count=pickerModeUI==='source'?(pickerFolderIdsUI.size+pickerBookmarkIdsUI.size):Number(Boolean(pickerSingleIdUI));
 $('pickerSelected').textContent=pickerModeUI==='source'?`已选择 ${pickerFolderIdsUI.size} 个文件夹 · ${pickerBookmarkIdsUI.size} 条书签`:`已选择 ${count} 个文件夹`;
 document.querySelectorAll('[data-picker-type]').forEach(btn=>btn.classList.toggle('active',btn.dataset.pickerType===pickerTypeUI));
 const results=pickerItems(),host=$('pickerList');host.textContent='';
 for(const x of results.slice(0,pickerLimitUI)){
  const selected=pickerModeUI==='source'?(x.kind==='folder'?pickerFolderIdsUI.has(x.id):pickerBookmarkIdsUI.has(x.id)):(pickerSingleIdUI===x.id);
  const row=node('label','picker-row'+(selected?' selected':''));
  const check=node('input');check.type=pickerModeUI==='source'?'checkbox':'radio';check.name=pickerModeUI==='source'?'picker-list-'+x.kind:'picker-radio';check.checked=selected;
  const body=node('span','picker-row-body');const title=node('strong','',x.label);title.title=x.label;
  const sub=node('small','',x.sub);sub.title=x.sub;body.append(title,sub);row.append(check,body);
  check.addEventListener('change',()=>{
   if(pickerModeUI==='source'){
    const set=x.kind==='folder'?pickerFolderIdsUI:pickerBookmarkIdsUI;
    check.checked?set.add(String(x.id)):set.delete(String(x.id));
   }else pickerSingleIdUI=String(x.id);
   renderPicker();
  });host.append(row);
 }
 if(!results.length)host.append(node('div','rename-empty','没有匹配的文件夹或书签'));
 if(results.length>pickerLimitUI){const more=node('button','rename-more',`显示更多（剩余 ${results.length-pickerLimitUI} 项）`);more.type='button';more.addEventListener('click',()=>{pickerLimitUI+=100;renderPicker();});host.append(more);}
 $('pickerClear').disabled=!count;
}
function pickerCommit(){
 if(pickerModeUI==='source'){
  orgFolderIdsUI=new Set(pickerFolderIdsUI);orgBookmarkIdsUI=new Set(pickerBookmarkIdsUI);
  if(orgFolderIdsUI.size===1&&!orgParentIdUI)orgParentIdUI=[...orgFolderIdsUI][0];
 }else if(pickerModeUI==='parent')orgParentIdUI=pickerSingleIdUI;
 else if(pickerModeUI==='rename'){setRenameFolder(pickerSingleIdUI);}
 $('pickerDialog').close();orgSaveDraft();orgRender();renderRenameUI();
}
function pickerClear(){
 if(pickerModeUI==='source'){pickerFolderIdsUI.clear();pickerBookmarkIdsUI.clear();}else pickerSingleIdUI='';
 renderPicker();
}

let orgResetAfterApplyUI=false;
async function orgResetAfterApply(){
 if(orgResetAfterApplyUI)return;
 orgResetAfterApplyUI=true;
 try{
  const message=orgStateUI.message||'书签移动已完成';
  const res=await chrome.runtime.sendMessage({type:'clearOrganize'});
  if(!res?.ok)throw Error(res?.error||'无法清理旧方案');
  clearTimeout(orgSaveTimerUI);clearTimeout(orgPlanSaveTimerUI);
  orgPlanUI=null;orgStateUI={status:'idle'};orgCheckpointUI=false;orgApplyCheckpointUI=false;
  orgFolderIdsUI=new Set();orgBookmarkIdsUI=new Set();orgParentIdUI='';orgWasAutoTargetUI=false;
  $('orgInstruction').value='';$('orgTargetName').value='';orgShowAllUI=false;
  await storage().remove('organizeDraft');
  orgRender();updateButtons();
  if(activeTab==='rename')notify(message);
 }catch(error){console.error('智能整理重置失败',error);}
 finally{orgResetAfterApplyUI=false;}
}

async function initOrganizeUI(){
 if(!state)state=E.scan(await chrome.bookmarks.getTree());
 const saved=await storage().get(['organizeDraft']);
 if(saved.organizeDraft){
  const draft=saved.organizeDraft;
  orgFolderIdsUI=new Set((draft.folderIds||[]).map(String));orgBookmarkIdsUI=new Set((draft.bookmarkIds||[]).map(String));
  orgParentIdUI=String(draft.parentId||'');$('orgTargetName').value=draft.targetName||'';$('orgInstruction').value=draft.instruction||'';
 }
 const response=await chrome.runtime.sendMessage({type:'getOrganizeState'}).catch(()=>null);
 if(response?.ok){orgStateUI=response.state||{status:'idle'};orgPlanUI=response.plan||null;orgUndoUI=!!response.undo;orgCheckpointUI=!!response.checkpoint;orgApplyCheckpointUI=!!response.applying;}
 document.querySelectorAll('[data-ai-workflow]').forEach(btn=>btn.addEventListener('click',()=>setAiWorkflow(btn.dataset.aiWorkflow)));
 $('orgScopeBtn').addEventListener('click',()=>openScopePicker('source'));
 $('orgParentBtn').addEventListener('click',()=>openScopePicker('parent'));
 $('renameFolderPickerBtn').addEventListener('click',()=>openScopePicker('rename'));
 $('orgInstruction').addEventListener('input',orgInstructionEdited);
 $('orgTargetName').addEventListener('input',()=>{orgWasAutoTargetUI=false;orgSaveDraft();orgRender();});
 $('orgActionBtn').addEventListener('click',orgStartOrApply);
 $('orgShowAll').addEventListener('change',e=>{orgShowAllUI=e.target.checked;orgRenderReviewList();});
 $('orgEditScopeBtn').addEventListener('click',orgEditScope);
 $('orgUndoBtn').addEventListener('click',orgUndoLast);
 $('orgConfirmCheck').addEventListener('change',e=>{$('orgConfirmBtn').disabled=!e.target.checked||isWorking();});
 $('orgConfirmBtn').addEventListener('click',orgConfirmApply);
 $('pickerCloseBtn').addEventListener('click',()=>$('pickerDialog').close());
 $('pickerDone').addEventListener('click',pickerCommit);
 $('pickerClear').addEventListener('click',pickerClear);
 $('pickerSearch').addEventListener('input',()=>{pickerLimitUI=100;renderPicker();});
 document.querySelectorAll('[data-picker-type]').forEach(btn=>btn.addEventListener('click',()=>{pickerTypeUI=btn.dataset.pickerType;pickerLimitUI=100;renderPicker();}));
 chrome.storage.onChanged.addListener(async(changes,area)=>{
  if(area!=='local')return;
  if(changes.organizeState){
   orgStateUI=changes.organizeState.newValue||{status:'idle'};
   if(orgStateUI.status==='error'){
    const response=await chrome.runtime.sendMessage({type:'getOrganizeState'}).catch(()=>null);orgCheckpointUI=!!response?.checkpoint;orgApplyCheckpointUI=!!response?.applying;
   }
   if(['completed','applied','idle'].includes(orgStateUI.status)){orgCheckpointUI=false;orgApplyCheckpointUI=false;}
   if(orgStateUI.status==='applied'){await refresh();await orgResetAfterApply();return;}
   orgRender();updateButtons();
  }
  if(changes.organizePlan){
   const fresh=changes.organizePlan.newValue;
   if(!fresh&&orgPlanUI)orgPlanUI=null;
   else if(fresh&&(!orgPlanUI||fresh.createdAt!==orgPlanUI.createdAt))orgPlanUI=fresh;
   orgRender();
  }
  if(changes.organizeUndo){orgUndoUI=!!changes.organizeUndo.newValue;orgRender();}
 });
 if(orgStateUI.status==='applied')await orgResetAfterApply();
 setAiWorkflow('organize');
}
document.addEventListener('DOMContentLoaded',()=>{void initOrganizeUI().catch(e=>console.error('智能整理初始化失败',e));});

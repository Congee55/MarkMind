/* MarkMind AI 3.1 — compact UI + background analysis */
'use strict';
const E = MarkMindEngine;
const B = MarkMindBackup;
const AI = MarkMindAI;
const $ = id => document.getElementById(id);
let snapshot = null, state = null, activePlan = null, analysisState = null, backupTask = null, restoreTarget = null;
let activeTab = 'home', libraryFilter = 'all', planFilter = 'all';
let busy = false, toastTimer = 0, pageLimit = 60, planPersistTimer = 0;
let editingFolderId = '', libraryFolderScope = '';

const storage = () => chrome.storage.local;
const makeIcon = id => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('class','icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg','use'); use.setAttribute('href','#i-'+id); svg.append(use); return svg;
};
const node = (tag, cls, content) => {
  const el = document.createElement(tag); if (cls) el.className = cls;
  if (content !== undefined) el.textContent = String(content); return el;
};
const isRunningAnalysis = () => analysisState?.status === 'running';
const isWorking = () => busy || isRunningAnalysis() || backupTask?.status==='running' || (typeof renameIsWorking==='function' && renameIsWorking()) || (typeof organizeIsWorking==='function' && organizeIsWorking());

function notify(message, error=false) {
  const t=$('toast'); t.textContent=message; t.classList.toggle('error',error); t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('visible'),4300);
}
function updateAssistantCancelButton(){
 const el=$('cancelAssistantAI');if(!el)return;
 const isRename=typeof aiWorkflowUI!=='undefined'&&aiWorkflowUI==='rename';
 const running=isRename ? (typeof renameStatusUI!=='undefined'&&renameStatusUI?.status==='running')
                        : (typeof orgStateUI!=='undefined'&&orgStateUI?.status==='running');
 el.classList.toggle('hidden',activeTab!=='rename'||!running);
}
function updateCancelButtons(){
 const visible=isRunningAnalysis()||Boolean(activePlan);
 $('cancelAnalysisBtn').classList.toggle('hidden',!visible);
 $('cancelAnalysisBtn').textContent=isRunningAnalysis()?'停止分析':'放弃本次方案';
 $('homeCancelAnalysisBtn').classList.toggle('hidden',!isRunningAnalysis());
 updateAssistantCancelButton();
}
async function cancelCurrentAnalysis(){
 const doing=isRunningAnalysis();
 if(!doing&&!activePlan)return;
 if(!confirm(doing?'停止本次 AI 分类并清除已生成的建议？书签不会被修改。':'放弃本次分类方案？所有尚未应用的建议将被清除，书签不会被修改。'))return;
 try{
  clearTimeout(planPersistTimer);
  const res=await chrome.runtime.sendMessage({type:'cancelAnalysis'});
  if(!res?.ok)throw Error(res?.error||'取消失败');
  activePlan=null;analysisState={status:'idle',message:''};
  $('planNavDot').classList.add('hidden');$('planCount').textContent='尚未分析';
  $('planSearch').value='';planFilter='all';pageLimit=60;
  document.querySelectorAll('[data-plan-filter]').forEach(b=>b.classList.toggle('active',b.dataset.planFilter==='all'));
  renderHomeState();renderPlan();updateCancelButtons();notify('本次分类分析已清除，书签保持不变');
 }catch(e){notify('无法取消：'+e.message,true);}
}
async function cancelAssistantAnalysis(){
 const rename=typeof aiWorkflowUI!=='undefined'&&aiWorkflowUI==='rename';
 const status=rename?renameStatusUI?.status:orgStateUI?.status;
 if(status!=='running')return;
 if(!confirm('停止当前 AI 分析？未应用的建议将清除，已保存的书签不会被修改。'))return;
 const type=rename?'cancelRename':'cancelOrganize';
 try{
  const r=await chrome.runtime.sendMessage({type});if(!r?.ok)throw Error(r?.error||'取消失败');
  if(rename){renamePlanUI=null;renameHasCheckpointUI=false;renameStatusUI={status:'idle'};renderRenameUI();}
  else{orgPlanUI=null;orgCheckpointUI=false;orgStateUI={status:'idle'};orgRender();}
  updateAssistantCancelButton();notify('已取消本次 AI 分析');
 }catch(e){notify(e.message,true);}
}
function updateButtons() {
  $('analyzeBtn').disabled = isWorking();
  $('applyBtn').disabled = isWorking() || !activePlan || E.summary(activePlan).selected===0;
  $('confirmApplyBtn').disabled = isWorking() || !$('confirmCheckbox').checked;
  $('undoBtn').disabled = isWorking();
  $('createBackupBtn').disabled = isWorking();
  $('restoreApplyBtn').disabled = isWorking() || !$('restoreCheckbox').checked;
  if (isRunningAnalysis()) $('analyzeLabel').textContent = '后台分析中';
  else if (busy) $('analyzeLabel').textContent = '处理中…';
  else $('analyzeLabel').textContent = activePlan ? '重新分析' : '开始 AI 精准分类';
  $('applyBtn').classList.toggle('hidden', activeTab!=='plan' || !activePlan || isRunningAnalysis());
  $('analyzeBtn').classList.toggle('hidden', activeTab==='rename');
  if(typeof updateRenameButtons==='function')updateRenameButtons();
  if(typeof orgUpdateButtons==='function')orgUpdateButtons();
  updateCancelButtons();
}
function setBusy(value) { busy = value; updateButtons(); }
function setTab(tab) {
  activeTab=tab;
  document.querySelectorAll('.tab').forEach(button => {
    const selected=button.dataset.tab===tab;
    button.classList.toggle('active', selected); button.setAttribute('aria-pressed',String(selected));
  });
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('hidden',p.dataset.page!==tab));
  $('mainScroll').scrollTop=0;
  updateButtons();
  if(tab==='library') renderLibrary();
  if(tab==='plan') renderPlan();
  if(tab==='backups') renderBackups();
  if(tab==='rename' && typeof renderRenameUI==='function') renderRenameUI();
  if(tab==='rename' && typeof orgRender==='function') orgRender();
}
function setProgress(done,total,message){
  const pct=Math.round(100*done/Math.max(1,total));
  $('progress').classList.remove('hidden'); $('progressFill').style.width=`${pct}%`; $('progressText').textContent=message;
  $('homeProgress').classList.remove('hidden'); $('homeProgressFill').style.width=`${pct}%`; $('homeProgressText').textContent=message;
}
function hideProgress(){ $('progress').classList.add('hidden'); $('homeProgress').classList.add('hidden'); }
async function persistPlanSoon(){
  clearTimeout(planPersistTimer);
  planPersistTimer = setTimeout(async()=>{
    try{ await storage().set({analysisPlan: activePlan}); }catch(_){ }
  },180);
}
function renderHomeState() {
  const badge=$('homeStateBadge'), title=$('analysisStatusTitle'), detail=$('analysisStatusDetail');
  if(backupTask?.status==='running'){
    badge.className='state-badge running';badge.textContent='处理中';title.textContent=backupTask.type==='restore'?'正在恢复':'正在备份';
    detail.textContent=backupTask.message||'后台任务进行中';hideProgress();
  } else if (isRunningAnalysis()) {
    badge.className='state-badge running'; badge.textContent='分析中';
    title.textContent='后台分析中';
    detail.textContent=analysisState?.message || '即使关闭弹窗，分析也会在后台继续。';
    setProgress(analysisState.completed||0, analysisState.total||1, analysisState.message||'正在分析…');
  } else if (analysisState?.status==='completed' && activePlan) {
    badge.className='state-badge done'; badge.textContent='已完成';
    title.textContent='分析完成';
    detail.textContent=`已处理 ${activePlan.total} 条 · ${activePlan.pending} 条建议核实。点击「分类」查看。`;
    hideProgress();
  } else if (analysisState?.status==='error') {
    badge.className='state-badge error'; badge.textContent='失败';
    title.textContent='分析未完成';
    detail.textContent=analysisState.error || '请检查 API 配置后重试。';
    hideProgress();
  } else {
    badge.className='state-badge idle'; badge.textContent='待分析';
    title.textContent='准备分析';
    detail.textContent='点击分析后可关闭弹窗，稍后查看结果。';
    hideProgress();
  }
}
async function refresh() {
  const tree=await chrome.bookmarks.getTree(); snapshot=tree;
  state=E.scan(tree);
  $('totalBookmarks').textContent=state.bookmarks.length;
  $('totalFolders').textContent=state.folders.length;
  $('totalProblems').textContent=state.duplicateNames.length+state.nestedDuplicates.length;
  const duplicates=state.duplicateNames.length, nested=state.nestedDuplicates.length;
  $('issueSummary').textContent=(duplicates||nested)
    ? `${duplicates} 组重复、${nested} 处嵌套`
    : '目录结构正常';
  $('homeBackupCount').textContent=B.list(snapshot).length+' 份';
  if(activeTab==='backups')renderBackups();
  if(activeTab==='library') renderLibrary();
  if(activeTab==='rename' && typeof renderRenameUI==='function')renderRenameUI();
  if(activeTab==='plan') renderPlan();
  if(activeTab==='backups') renderBackups();
}
function syncPlanHeader() {
  if(!activePlan){ updateButtons(); return; }
  const summary=E.summary(activePlan);
  $('planMatched').textContent=activePlan.items.filter(i=>!i.needsReview).length;
  $('planPending').textContent=activePlan.items.filter(i=>i.needsReview).length;
  $('planSelected').textContent=summary.selected;
  $('planCount').textContent=summary.total+' 条建议';
  $('footerHint').textContent=summary.pending ? `有 ${summary.pending} 条低置信度书签，默认不移动` : '检查完成后即可备份并应用';
  $('planNavDot').classList.toggle('hidden', !activePlan);
  renderDestinationTree();
  updateButtons();
}
function renderDestinationTree(){
  if(!activePlan)return;
  const layout=E.buildLayout(activePlan), grouped=new Map();
  for(const item of activePlan.items.filter(x=>x.selected)){
    if(!grouped.has(item.category)) grouped.set(item.category,{root:0,subs:new Map()});
    const group=grouped.get(item.category),target=E.destinationFor(item,layout);
    if(target.subcategory){group.subs.set(target.subcategory,(group.subs.get(target.subcategory)||0)+1);}
    else group.root++;
  }
  const target=$('treePreviewBody'); target.textContent='';
  for(const [category,info] of grouped){
    const group=node('div','tree-group'); group.append(node('strong','',`${category} · ${info.root+[...info.subs.values()].reduce((a,b)=>a+b,0)} 条`));
    for(const [name,count] of info.subs)group.append(node('span','tree-leaf',`${name} · ${count} 条`));
    target.append(group);
  }
  $('treeCount').textContent=grouped.size+' 个主文件夹 / '+[...grouped.values()].reduce((n,x)=>n+x.subs.size,0)+' 个子文件夹';
}
function renderLibrary() {
  if(!state)return;
  if(typeof renderLibraryTools==='function' && renderLibraryTools())return;
  const term=$('librarySearch').value.toLocaleLowerCase().trim();
  const target=$('libraryList'); target.textContent='';
  const matches = (text)=>String(text||'').toLocaleLowerCase().includes(term);
  let items=[];
  if(libraryFolderScope){
    const scope=state.folders.find(f=>f.id===libraryFolderScope);
    if(!scope){libraryFolderScope='';}else{
      const paths=new Map(state.folders.map(f=>[f.id,f]));
      const isUnder=(parentId)=>{const seen=new Set();while(paths.has(parentId)&&!seen.has(parentId)){if(parentId===libraryFolderScope)return true;seen.add(parentId);parentId=paths.get(parentId).parentId;}return parentId===libraryFolderScope;};
      items=state.bookmarks.filter(b=>isUnder(b.parentId)).map(b=>({...b,type:'bookmark',name:b.title,where:b.path||'书签根目录'}));
    }
  }
  if(!libraryFolderScope && libraryFilter==='folders') items=state.folders.map(f=>({...f, type:'folder',name:f.title,where:f.path||'根目录'}));
  else if(!libraryFolderScope && libraryFilter==='issues') {
    const problemIds=new Set([...state.duplicateNames.flatMap(d=>d.ids),...state.nestedDuplicates.map(f=>f.id)]);
    items=state.folders.filter(f=>problemIds.has(f.id)).map(f=>({...f,type:'folder',name:f.title,where:f.path||'根目录'}));
  } else if(!libraryFolderScope) {
    items=state.bookmarks.filter(b=>libraryFilter!=='root'||['1','2','3'].includes(b.parentId))
      .map(b=>({...b,type:'bookmark',name:b.title,where:b.path||'书签根目录'}));
  }
  items=items.filter(i=>matches(i.name)||matches(i.url)||matches(i.where));
  $('libraryCount').textContent=items.length+' 项';
  const chip=$('libraryFolderScopeBar');
  if(chip){chip.classList.toggle('hidden',!libraryFolderScope);
   const scope=state.folders.find(f=>f.id===libraryFolderScope);
   if(scope)$('libraryFolderScopeText').textContent='正在查看：'+scope.title+'（含子目录）';}
  for(const item of items.slice(0,pageLimit)){
    const row=node('div','library-item');
    const icon=node('span','item-letter');icon.append(makeIcon(item.type==='folder'?'folder':'bookmark'));
    const content=node('div','library-main'); const name=node('span','item-name',item.name);
    name.title=item.name;
    const meta=node('div','item-meta',item.where+(item.domain?' · '+item.domain:''));
    content.append(name,meta);row.append(icon,content);
    if(item.type==='bookmark'){
      const open=node('button','open-link');open.type='button'; open.title='打开书签';open.setAttribute('aria-label','打开 '+item.name);
      open.append(makeIcon('external'));open.addEventListener('click',()=>chrome.tabs.create({url:item.url}));
      const renameLink=node('button','open-link');renameLink.type='button';renameLink.title='编辑或删除书签';renameLink.setAttribute('aria-label','编辑 '+item.name);
      renameLink.append(makeIcon('edit'));renameLink.addEventListener('click',()=>openBookmarkEditor(item.id));
      row.append(renameLink,open);
    } else {
      const edit=node('button','open-link');edit.type='button';edit.title='编辑文件夹名称';edit.setAttribute('aria-label','编辑文件夹 '+item.name);edit.append(makeIcon('edit'));edit.addEventListener('click',()=>openFolderEditor(item.id));
      const show=node('button','open-link');show.type='button';show.title='查看此文件夹内的书签';show.setAttribute('aria-label','查看 '+item.name+' 内的书签');show.append(makeIcon('search'));
      show.addEventListener('click',()=>{libraryFolderScope=item.id;libraryFilter='all';$('librarySearch').value='';setLibraryFilter('all',true);});row.append(edit,show);
    }
    target.append(row);
  }
  if(!items.length)target.append(node('div','empty-list','没有找到匹配项目。试试更短的关键词。'));
  if(items.length>pageLimit) appendMore(target,items.length,()=>{pageLimit+=60;renderLibrary();});
}
function appendMore(target,total,onClick){
  const more=node('button','quiet-button',`显示更多 · 还有 ${total-pageLimit} 项`); more.type='button'; more.style.margin='8px auto'; more.addEventListener('click',onClick); target.append(more);
}
function setLibraryFilter(value,keepFolder=false) {
  libraryFilter=value;if(!keepFolder)libraryFolderScope='';pageLimit=60;
  document.querySelectorAll('[data-library-filter]').forEach(b=>b.classList.toggle('active',b.dataset.libraryFilter===value));
  renderLibrary();
}
function renderPlan() {
  if(!activePlan){$('planEmpty').classList.remove('hidden');$('planContent').classList.add('hidden');$('planCount').textContent=isRunningAnalysis()?'正在分析':'尚未分析';updateButtons();return;}
  $('planEmpty').classList.add('hidden');$('planContent').classList.remove('hidden');
  syncPlanHeader();
  const term=$('planSearch').value.trim().toLowerCase();
  const matches=x=>[x.title,x.url,x.originalPath,x.category,x.subcategory].some(v=>String(v||'').toLowerCase().includes(term));
  // Include UNSELECTED suggestions as well: previously pending bookmarks were invisible.
  const moveById=new Map(E.planForMoves(activePlan,state||{folders:[]}).map(x=>[x.id,x]));
  const items=activePlan.items.map(x=>moveById.get(x.id)||{...x,unchanged:true}).filter(x=>{
    if(planFilter==='pending'&&!x.needsReview)return false;
    if(planFilter==='changed'&&x.unchanged)return false;
    if(planFilter==='unselected'&&x.selected)return false;
    return matches(x);
  }).sort((a,b)=>(a.needsReview?0:1)-(b.needsReview?0:1));
  const target=$('planList');target.textContent='';
  for(const item of items.slice(0,pageLimit)) {
    const orig=activePlan.items.find(i=>i.id===item.id);
    const row=node('div','plan-item'+(item.needsReview?' is-pending':''));
    const checked=node('input');checked.type='checkbox';checked.checked=orig.selected;checked.title='参与整理';checked.setAttribute('aria-label','整理 '+item.title);
    checked.addEventListener('change',()=>{
      if(checked.checked&&orig.category==='其他'){checked.checked=false;notify('请先给这条书签选择准确分类，再勾选整理',true);return;}
      orig.selected=checked.checked;syncPlanHeader();persistPlanSoon();
    });
    const content=node('div','plan-item-content');const header=node('div','plan-item-header');
    const name=node('span','item-name',item.title);name.title=item.title;
    const conf=node('span','confidence'+(item.needsReview?' pending':''),item.needsReview?'待核实':(!item.selected?'不移动':item.reason==='已手动设置分类'?'已修正':'已分类'));
    header.append(name,conf);
    const path=node('div','plan-path',(item.originalPath||'根目录')+' · '+item.domain);path.title=path.textContent;
    const selectors=node('div','selectors');
    const cat=node('select'); cat.setAttribute('aria-label','一级分类：'+item.title);
    for(const c of Object.keys(E.TAXONOMY)){const opt=node('option','',c);opt.value=c;cat.append(opt);}    
    cat.value=orig.category;
    const sub=node('select'); sub.setAttribute('aria-label','二级分类：'+item.title);
    const fillSubs=()=>{ sub.textContent=''; for(const s of E.TAXONOMY[orig.category]) {const opt=node('option','',s);opt.value=s;sub.append(opt);} sub.value=orig.subcategory; };
    fillSubs();
    cat.addEventListener('change',()=>{
      orig.category=cat.value; orig.subcategory=E.TAXONOMY[cat.value][0]; orig.needsReview=cat.value==='其他';
      orig.reason='已手动设置分类'; if(orig.category!=='其他')orig.selected=true; checked.checked=orig.selected; fillSubs(); syncPlanHeader();
      row.classList.toggle('is-pending',orig.category==='其他');
      conf.textContent=orig.category==='其他'?'待核实':'已修改'; conf.classList.toggle('pending',orig.category==='其他');persistPlanSoon();
    });
    sub.addEventListener('change',()=>{orig.subcategory=sub.value;orig.reason='已手动设置分类';if(orig.category!=='其他')orig.needsReview=false;conf.textContent=orig.needsReview?'待核实':'已修正';conf.classList.toggle('pending',orig.needsReview);reason.textContent='已手动设置分类';syncPlanHeader();persistPlanSoon();});
    selectors.append(cat,sub);
    const reason=node('div','reason',item.reason||(item.unchanged?'当前目录正确':'按网站用途分类'));
    reason.title=reason.textContent;
    content.append(header,path,selectors,reason);
    if(item.needsReview && item.category!=='其他'){
      const accept=node('button','review-accept','确认该分类并参与整理');accept.type='button';
      accept.addEventListener('click',()=>{
        orig.needsReview=false;orig.selected=true;orig.reason='已人工确认分类';
        checked.checked=true;conf.textContent='已核实';conf.classList.remove('pending');
        row.classList.remove('is-pending');accept.remove();reason.textContent='已人工确认分类';
        syncPlanHeader();persistPlanSoon();
      });content.append(accept);
    }
    row.append(checked,content); target.append(row);
  }
  if(!items.length)target.append(node('div','empty-list','当前筛选下没有书签。'));
  if(items.length>pageLimit)appendMore(target,items.length,()=>{pageLimit+=60;renderPlan();});
}
function setPlanFilter(value){
  planFilter=value; pageLimit=60;
  document.querySelectorAll('[data-plan-filter]').forEach(b=>b.classList.toggle('active',b.dataset.planFilter===value));
  renderPlan();
}
let savedApiKeys={},savedApiModels={},savedLegacyDeepseek='',lastProvider='deepseek';
function updateProviderFields(){
  const provider=$('apiProviderSelect').value;
  const profile=AI.PROVIDERS[provider];
  $('apiKeyLabel').textContent=profile.name;
  $('apiKeyInput').value=savedApiKeys[provider]||(provider==='deepseek'?savedLegacyDeepseek:'')||'';
  $('apiKeyInput').placeholder=profile.placeholder;
  const models=$('modelSelect');models.textContent='';
  for(const [id,label] of profile.models){const opt=node('option','',label);opt.value=id;models.append(opt);}
  const custom=node('option','','自定义模型 ID');custom.value='__custom__';models.append(custom);
  const saved=savedApiModels[provider]||profile.model;
  if(profile.models.some(x=>x[0]===saved)){models.value=saved;$('customModelInput').classList.add('hidden');}
  else{models.value='__custom__';$('customModelInput').value=saved;$('customModelInput').classList.remove('hidden');}
  $('providerHint').textContent=`密钥只用于 ${profile.name} 的固定 HTTPS 接口；不同接口的密钥独立保存。`;
  $('settingsError').classList.add('hidden');
}
function preserveProviderFields(){
  const provider=$('apiProviderSelect').value;
  savedApiKeys[provider]=$('apiKeyInput').value.trim();
  const model=$('modelSelect').value;
  savedApiModels[provider]=model==='__custom__'?$('customModelInput').value.trim():model;
}
async function loadSettings(){
  const saved=await storage().get([...AI.keys,'backupEnabled','lastUndo','backupTask']);
  backupTask=saved.backupTask||null;
  savedApiKeys={...(saved.apiKeys||{})};
  savedApiModels={...(saved.apiModels||{})};
  savedLegacyDeepseek=saved.deepseekKey||'';
  const provider=AI.PROVIDERS[saved.apiProvider]?saved.apiProvider:'deepseek';
  if(!savedApiModels.deepseek)savedApiModels.deepseek=saved.model||AI.PROVIDERS.deepseek.model;
  if(savedApiModels.deepseek==='deepseek-chat')savedApiModels.deepseek='deepseek-flash';
  if(savedApiModels.deepseek==='deepseek-reasoner')savedApiModels.deepseek='deepseek-v4-pro';
  $('apiProviderSelect').value=provider;lastProvider=provider;
  $('backupToggle').checked=saved.backupEnabled!==false;
  updateProviderFields();
  const configured=AI.hasKey(saved);
  $('connectionLabel').classList.toggle('on',configured);
  $('connectionLabel').lastChild.textContent=configured?`${AI.PROVIDERS[provider].name} 已配置`:'未配置密钥';
  $('undoBtn').classList.toggle('hidden',!saved.lastUndo);
}
async function saveSettings(){
  preserveProviderFields();
  const provider=$('apiProviderSelect').value,err=$('settingsError');
  const model=savedApiModels[provider];
  const key=savedApiKeys[provider];
  if(!model||model.length>120||!/^[-./\w:]+$/.test(model)){
    err.textContent='请填写正确的模型 ID。';err.classList.remove('hidden');return;
  }
  if(key&&(key.length<8||/[\s]/.test(key))){
    err.textContent='API Key 格式似乎不完整，请核对。';err.classList.remove('hidden');return;
  }
  err.classList.add('hidden');
  try{
    // Keep legacy DeepSeek fields for existing configurations and compatible migrations.
    await storage().set({apiProvider:provider,apiKeys:savedApiKeys,apiModels:savedApiModels,
      deepseekKey:savedApiKeys.deepseek!==undefined?savedApiKeys.deepseek:savedLegacyDeepseek,model:savedApiModels.deepseek||AI.PROVIDERS.deepseek.model,
      backupEnabled:$('backupToggle').checked});
    $('settingsDialog').close();await loadSettings();notify('接口与设置已保存');
  }catch(e){notify('保存失败：'+e.message,true);}
}
async function invalidatePlanAfterFolderChange(){
 clearTimeout(planPersistTimer);
 const response=await chrome.runtime.sendMessage({type:'cancelAnalysis'});
 if(!response?.ok)throw Error(response?.error||'旧分类方案失效，请手动放弃并重新分析');
 activePlan=null;analysisState={status:'idle'};renderHomeState();updateButtons();
}
async function openFolderEditor(id){
 try{
  if(isWorking())throw Error('后台任务正在运行，请完成或取消后再编辑文件夹');
  const f=(await chrome.bookmarks.get(String(id)))[0];
  if(!f||f.url||['0','1','2','3'].includes(String(f.id))||/^(MarkMind Backup|MarkMind Archive)/.test(f.title||''))throw Error('该目录不支持在此编辑');
  editingFolderId=String(f.id);
  $('folderEditName').value=f.title||'';
  const children=await chrome.bookmarks.getChildren(editingFolderId);
  $('folderEditPath').textContent=children.length?`此文件夹包含 ${children.length} 个直接子项。可以改名；为避免误删，非空文件夹不可删除。`:'这是空文件夹。可以安全删除。';
  $('folderDeleteBtn').disabled=children.length>0;
  $('folderDeleteBtn').title=children.length?'只有空文件夹可以删除':'删除此空文件夹';
  $('folderEditError').classList.add('hidden');
  $('folderEditDialog').showModal();
 }catch(e){notify('打开文件夹失败：'+e.message,true);}
}
async function saveFolderEdit(){
 const name=$('folderEditName').value.trim(),err=$('folderEditError');
 if(!name||name.length>90){err.textContent='请输入 1–90 字的文件夹名称';err.classList.remove('hidden');return;}
 try{
  const f=(await chrome.bookmarks.get(editingFolderId))[0];
  if(!f||f.url||['0','1','2','3'].includes(String(f.id)))throw Error('文件夹不存在或不可修改');
  const siblings=await chrome.bookmarks.getChildren(f.parentId);
  if(siblings.some(n=>!n.url&&n.id!==f.id&&n.title===name))throw Error('同级已存在同名文件夹，请使用其他名称');
  await chrome.bookmarks.update(editingFolderId,{title:name});
  if(activePlan)await invalidatePlanAfterFolderChange();
  $('folderEditDialog').close();await refresh();notify('文件夹名称已更新');
 }catch(e){err.textContent=e.message;err.classList.remove('hidden');}
}
async function deleteEmptyFolder(){
 const err=$('folderEditError');
 try{
  const f=(await chrome.bookmarks.get(editingFolderId))[0];
  if(!f||f.url||['0','1','2','3'].includes(String(f.id)))throw Error('文件夹不可删除');
  if((await chrome.bookmarks.getChildren(editingFolderId)).length)throw Error('只能删除空文件夹');
  if(!confirm(`确认删除空文件夹「${f.title}」？`))return;
  await chrome.bookmarks.remove(editingFolderId);if(activePlan)await invalidatePlanAfterFolderChange();$('folderEditDialog').close();await refresh();notify('已删除空文件夹');
 }catch(e){err.textContent=e.message;err.classList.remove('hidden');}
}
let editingBookmarkId='';
async function openBookmarkEditor(id){
  try{
    const b=(await chrome.bookmarks.get(String(id)))[0];
    if(!b?.url)throw Error('书签不存在');
    editingBookmarkId=String(id);
    $('bookmarkEditName').value=b.title||'';
    $('bookmarkEditUrl').value=b.url||'';
    $('bookmarkEditPath').textContent='仅修改该书签；不会移动目录或更改其他条目。';
    $('bookmarkEditError').classList.add('hidden');
    $('bookmarkEditDialog').showModal();
  }catch(e){notify('无法打开编辑：'+e.message,true);}
}
async function saveBookmarkEdit(){
  const title=$('bookmarkEditName').value.trim(), url=$('bookmarkEditUrl').value.trim(), err=$('bookmarkEditError');
  if(!title){err.textContent='名称不能为空';err.classList.remove('hidden');return;}
  try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error();}
  catch(_){err.textContent='请输入有效的 http 或 https 网址';err.classList.remove('hidden');return;}
  try{
    const current=(await chrome.bookmarks.get(editingBookmarkId))[0];
    if(!current?.url)throw Error('该书签已经不存在');
    await chrome.bookmarks.update(editingBookmarkId,{title,url});
    $('bookmarkEditDialog').close();await refresh();notify('书签已保存');
  }catch(e){err.textContent=e.message;err.classList.remove('hidden');}
}
async function deleteBookmark(){
  try{
    const b=(await chrome.bookmarks.get(editingBookmarkId))[0];
    if(!b?.url)throw Error('该书签已经不存在');
    if(!confirm(`确认删除「${b.title}」？\n可在书签库中点击「撤销删除」找回。`))return;
    const restoreData={title:b.title,url:b.url,parentId:b.parentId,index:b.index,date:Date.now()};
    await storage().set({lastDeletedBookmark:restoreData});
    await chrome.bookmarks.remove(editingBookmarkId);
    if($('bookmarkEditDialog').open)$('bookmarkEditDialog').close();await refresh();await updateUndoDeleteButton();notify('书签已删除，可以点击「撤销删除」恢复');
  }catch(e){notify('删除失败：'+e.message,true);}
}
async function deleteBookmarkById(id){editingBookmarkId=String(id);return deleteBookmark();}
async function updateUndoDeleteButton(){
  const r=(await storage().get('lastDeletedBookmark')).lastDeletedBookmark;
  $('undoLastDeleteBtn').classList.toggle('hidden',!r);
}
async function undoBookmarkDelete(){
  const r=(await storage().get('lastDeletedBookmark')).lastDeletedBookmark;
  if(!r)return;
  try{
    let parentId=r.parentId;
    try{await chrome.bookmarks.get(parentId);}catch(_){parentId='2';}
    await chrome.bookmarks.create({parentId,title:r.title,url:r.url,index:r.index});
    await storage().remove('lastDeletedBookmark');await refresh();await updateUndoDeleteButton();notify('已恢复书签');
  }catch(e){notify('恢复失败：'+e.message,true);}
}
async function pullBackgroundState(){
  try{
    const res=await chrome.runtime.sendMessage({type:'getAnalysisState'});
    if(res?.ok){
      analysisState=res.state||{status:'idle'};
      activePlan=res.plan||null;
    }
  }catch(_){ analysisState=analysisState||{status:'idle'}; }
  renderHomeState();
  if(activePlan) syncPlanHeader(); else updateButtons();
}
async function analyze(){
  if(isWorking()) return;
  const saved=await storage().get(AI.keys);
  if(!AI.hasKey(saved)){ $('settingsDialog').showModal(); notify('请先配置 AI 接口和密钥'); return; }
  if(!state?.bookmarks.length){ notify('没有发现可分析的书签'); return; }
  try{
    const res=await chrome.runtime.sendMessage({type:'startAnalysis'});
    if(!res?.ok) throw new Error(res?.error||'无法启动分析');
    analysisState={status:'running',completed:0,total:state.bookmarks.length,message:'分析已在后台启动'};
    activePlan=null;
    await storage().remove('analysisPlan');
    renderHomeState(); updateButtons(); setTab('home');
    notify('已开始后台分析。关闭弹窗后仍会继续，稍后可回来查看结果。');
  }catch(error){ console.error(error); notify('无法启动分析：'+error.message,true); }
}

async function ensureTarget(rootId,category,subcategory,cache,created){
  const categoryKey=`${rootId}:${category}`,subKey=`${rootId}:${category}:${subcategory}`;
  if(cache.has(subKey))return cache.get(subKey);
  if(!cache.has(categoryKey)){
    const existing=(await chrome.bookmarks.getChildren(rootId)).find(n=>!n.url&&n.title===category);
    const id=existing?.id||(await chrome.bookmarks.create({parentId:rootId,title:category})).id;
    if(!existing)created.push(String(id));cache.set(categoryKey,String(id));
  }
  if(!subcategory) return cache.get(categoryKey);
  const parentId=cache.get(categoryKey);
  const existing=(await chrome.bookmarks.getChildren(parentId)).find(n=>!n.url&&n.title===subcategory);
  const id=existing?.id||(await chrome.bookmarks.create({parentId,title:subcategory})).id;
  if(!existing)created.push(String(id));cache.set(subKey,String(id));return String(id);
}
async function cleanupEmptyFolders(original, touched){
  const removed=[];
  const known=original.folders.slice().sort((a,b)=>b.depth-a.depth);
  const sameName=new Set(original.nestedDuplicates.map(f=>f.id));
  const duplicates=new Set(original.duplicateNames.flatMap(g=>g.ids.slice(1)));
  for(const folder of known){
    if(!touched.has(folder.id)&&!sameName.has(folder.id)&&!duplicates.has(folder.id))continue;
    try{const children=await chrome.bookmarks.getChildren(folder.id);if(children.length)continue;await chrome.bookmarks.remove(folder.id);removed.push(folder.id);}catch(e){ if(!/Can't find|not found|No node/i.test(e.message))throw e; }
  }
  return removed;
}
async function applyPlan(){
  if(isWorking() || !activePlan)return;
  const changes=E.planForMoves(activePlan,state);
  const selected=changes.filter(x=>x.selected);
  if(!selected.length){notify('请至少选择一条书签');return;}
  setBusy(true);$('confirmDialog').close();
  const beforeTree=await chrome.bookmarks.getTree();
  const prior=E.scan(beforeTree);
  const journal={version:3.2,createdAt:Date.now(),folders:prior.folders.map(f=>({id:f.id,title:f.title,parentId:f.parentId,rootId:f.rootId,index:f.index,depth:f.depth})),bookmarks:prior.bookmarks.map(b=>({id:b.id,parentId:b.parentId,title:b.title,index:b.index,rootId:b.rootId})),created:[],removed:[],status:'running'};
  try{
    const opts=await storage().get(['backupEnabled']);
    if(opts.backupEnabled!==false){setProgress(1,5,'正在复制原始书签到备份目录…');journal.backupId=(await B.create(beforeTree)).id;}    
    await storage().set({lastUndo:journal});
    const cache=new Map(),touched=new Set();let moved=0;
    for(const item of selected){
      const target=await ensureTarget(item.rootId,item.targetCategory,item.targetSubcategory,cache,journal.created);
      if(String(item.parentId)!==String(target)){
        await chrome.bookmarks.move(item.id,{parentId:target});moved++;
        let oldId=item.parentId;const fById=new Map(prior.folders.map(f=>[f.id,f]));
        while(fById.has(oldId)){touched.add(oldId);oldId=fById.get(oldId).parentId;}
      }
    }
    setProgress(4,5,'正在移除搬空的重复文件夹…');
    journal.removed=await cleanupEmptyFolders(prior,touched);
    journal.status='completed';await storage().set({lastUndo:journal});
    activePlan=null;analysisState={status:'idle'};
    await storage().remove(['analysisPlan']);
    await chrome.runtime.sendMessage({type:'clearAnalysis'}).catch(()=>{});
    await refresh();hideProgress();setBusy(false);setTab('home');
    $('undoBtn').classList.remove('hidden');renderHomeState();
    notify(`整理完成：移动 ${moved} 条，清理 ${journal.removed.length} 个空文件夹。`);
  }catch(error){
    console.error(error);journal.status='interrupted';
    try{await storage().set({lastUndo:journal});await refresh();}catch(_){ }
    activePlan=null;hideProgress();setBusy(false);setTab('home');
    $('undoBtn').classList.remove('hidden');renderHomeState();
    notify('整理中断，点击「撤销上次整理」恢复原目录：'+error.message,true);
  }
}
async function restoreJournal(){
  if(isWorking())return;
  const {lastUndo:j}=await storage().get(['lastUndo']);
  if(!j?.folders||!j?.bookmarks){notify('没有可恢复的上次整理记录');return;}
  if(!confirm('恢复上次整理前的书签目录？当前整理产生的空文件夹将被清理。'))return;
  setBusy(true);setProgress(1,4,'正在恢复旧文件夹…');
  try{
    const ids=new Map();const folderList=j.folders.slice().sort((a,b)=>a.depth-b.depth);
    for(const f of folderList){
      const parentId=ids.get(String(f.parentId))||String(f.parentId);
      let current; try{current=(await chrome.bookmarks.get(String(f.id)))[0];}catch(_){ }
      if(!current){ current=await chrome.bookmarks.create({parentId,title:f.title}); }
      else{ if(String(current.parentId)!==parentId)await chrome.bookmarks.move(current.id,{parentId}); if(current.title!==f.title)await chrome.bookmarks.update(current.id,{title:f.title}); }
      ids.set(String(f.id),String(current.id));
    }
    setProgress(2,4,'正在恢复书签位置…');
    const bookmarks=j.bookmarks.slice().sort((a,b)=>a.index-b.index);
    for(const b of bookmarks){
      let existing;try{existing=(await chrome.bookmarks.get(String(b.id)))[0];}catch(_){ }
      if(!existing) continue;
      const parentId=ids.get(String(b.parentId))||String(b.parentId);
      await chrome.bookmarks.move(existing.id,{parentId,index:b.index});
      if(existing.title!==b.title)await chrome.bookmarks.update(existing.id,{title:b.title});
    }
    setProgress(3,4,'正在清理本次新建的空目录…');
    for(const id of (j.created||[]).reverse()){
      try{if(!(await chrome.bookmarks.getChildren(id)).length)await chrome.bookmarks.remove(id);}catch(_){ }
    }
    await storage().remove('lastUndo');await refresh();
    $('undoBtn').classList.add('hidden');hideProgress();setBusy(false);notify('已恢复原来的文件夹与书签位置；备份副本仍保留。');
  } catch(error){ console.error(error); setBusy(false); hideProgress(); notify('恢复未完全成功，请检查备份：'+error.message,true); }
}
function showConfirm(){
  if(isWorking()||!activePlan)return;
  const s=E.summary(activePlan);if(!s.selected){notify('请选择要整理的书签');return;}
  $('confirmSummary').textContent=`将整理 ${s.selected} 条书签，主要使用 ${s.destinations} 个一级文件夹。${s.pending} 条需要核实的书签会保留原位（除非你手动勾选）。`;
  $('backupMessage').textContent=$('backupToggle').checked?'将先复制全部原始书签到「其他书签」，并保留撤销记录。':'已关闭完整备份。仍会保留操作撤销记录，但建议先开启备份。';
  $('confirmCheckbox').checked=false;$('confirmApplyBtn').disabled=true;$('confirmDialog').showModal();
}
function formatBackupDate(b){
  if(b.dateAdded)return new Date(b.dateAdded).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  return b.title.replace(/^.*?Backup\s*/, '').replace(/-(\d{2})-(\d{2})-(\d{2})$/, ' $1:$2:$3');
}
function renderBackups(){
  if(!snapshot)return;
  const backups=B.list(snapshot),box=$('backupList'); box.textContent='';
  $('backupCount').textContent=backups.length+' 份';
  $('homeBackupCount').textContent=backups.length+' 份';
  for(const b of backups){
    const card=node('div','backup-item');
    const icon=node('div','backup-icon');icon.append(makeIcon('folder'));
    const content=node('div','backup-info');
    content.append(node('strong','',formatBackupDate(b)),node('span','',`${b.count} 条书签 · ${b.folders} 个文件夹`));
    const action=node('button','restore-btn','恢复');action.type='button';action.disabled=isWorking();
    action.setAttribute('aria-label','恢复 '+b.title);
    action.addEventListener('click',()=>openRestore(b));
    card.append(icon,content,action);box.append(card);
  }
  if(!backups.length)box.append(node('div','backup-empty','尚无历史备份。点击上方按钮即可保存当前书签。'));
  chrome.storage.local.get(['lastRestore']).then(({lastRestore:r})=>{
    const el=$('restoreNotice');
    if(r?.status==='interrupted'){
      el.textContent=`上次恢复中断。原书签在 MarkMind Archive（ID ${r.archiveId}），请先检查该目录。`;
      el.classList.remove('hidden');
    }else el.classList.add('hidden');
  });
}
function openRestore(b){
  if(isWorking())return;
  try{
    const info=B.inspect(snapshot,b.id);
    restoreTarget=b.id;
    $('restoreSummary').textContent=`将恢复「${b.title}」中的 ${info.count} 条书签。请确认这是你想恢复的日期。`;
    $('restoreCheckbox').checked=false;
    $('restoreApplyBtn').disabled=true;
    $('restoreDialog').showModal();
  }catch(e){notify('无法直接恢复此备份：'+e.message,true);}
}
async function createBackup(){
  if(isWorking())return;
  try{
    const r=await chrome.runtime.sendMessage({type:'createBackup'});
    if(!r?.ok)throw Error(r?.error||'无法启动备份');
    backupTask={type:'create',status:'running',message:'正在创建完整备份'};
    renderBackups();updateButtons();notify('正在创建备份，完成后将在这里显示。');
  }catch(e){notify('备份失败：'+e.message,true);}
}
async function restoreBackup(){
  if(isWorking()||!restoreTarget||!$('restoreCheckbox').checked)return;
  try{
    const r=await chrome.runtime.sendMessage({type:'restoreBackup',backupId:restoreTarget});
    if(!r?.ok)throw Error(r?.error||'无法启动恢复');
    $('restoreDialog').close();
    backupTask={type:'restore',status:'running',message:'正在恢复历史备份'};
    renderBackups();updateButtons();notify('开始恢复。当前书签会先安全归档，完成后自动刷新。');
  }catch(e){notify('恢复失败：'+e.message,true);}
}
function bindStorageWatch(){
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if(areaName!=='local') return;
    if(changes.analysisState){ analysisState=changes.analysisState.newValue||{status:'idle'}; renderHomeState(); updateButtons(); if(analysisState.status==='completed') await refresh(); if(analysisState.status==='error') notify('分析失败：'+(analysisState.error||'未知错误'), true); }
    if(changes.analysisPlan){ activePlan=changes.analysisPlan.newValue||null; if(activePlan){ syncPlanHeader(); if(activeTab==='plan') renderPlan(); } else { $('planNavDot').classList.add('hidden'); if(activeTab==='plan') renderPlan(); } }
    if(changes.lastUndo){ $('undoBtn').classList.toggle('hidden', !changes.lastUndo.newValue); }
    if(changes.backupTask){
      backupTask=changes.backupTask.newValue;updateButtons();
      if(backupTask?.status==='completed'){
        await refresh();await pullBackgroundState();await updateUndoDeleteButton();if(activeTab==='backups')renderBackups();
        notify(backupTask.message+(backupTask.result?.count?` · ${backupTask.result.count} 条`:''));
      } else if(backupTask?.status==='error')notify(backupTask.message,true);
      if(activeTab==='backups')renderBackups();
    }
  });
  chrome.runtime.onMessage.addListener((message)=>{
    if(message?.type==='analysisUpdate'){ analysisState=message.state||analysisState; renderHomeState(); updateButtons(); }
  });
}

document.addEventListener('DOMContentLoaded',async()=>{
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
  document.querySelectorAll('[data-library-filter]').forEach(b=>b.addEventListener('click',()=>setLibraryFilter(b.dataset.libraryFilter)));
  document.querySelectorAll('[data-plan-filter]').forEach(b=>b.addEventListener('click',()=>setPlanFilter(b.dataset.planFilter)));
  $('settingsBtn').addEventListener('click',()=>{void loadSettings().then(()=>$('settingsDialog').showModal());});
  $('backupShortcut').addEventListener('click',()=>setTab('backups'));
  $('createBackupBtn').addEventListener('click',createBackup);
  $('restoreCheckbox').addEventListener('change',()=>updateButtons());
  $('restoreApplyBtn').addEventListener('click',restoreBackup);
  $('saveSettingsBtn').addEventListener('click',saveSettings);
  $('apiProviderSelect').addEventListener('change',()=>{savedApiKeys[lastProvider]=$('apiKeyInput').value.trim();savedApiModels[lastProvider]=$('modelSelect').value==='__custom__'?$('customModelInput').value.trim():$('modelSelect').value;lastProvider=$('apiProviderSelect').value;updateProviderFields();});
  $('modelSelect').addEventListener('change',()=>{$('customModelInput').classList.toggle('hidden',$('modelSelect').value!=='__custom__');});
  $('folderSaveBtn').addEventListener('click',saveFolderEdit);
  $('folderDeleteBtn').addEventListener('click',deleteEmptyFolder);
  $('bookmarkSaveBtn').addEventListener('click',saveBookmarkEdit);
  $('bookmarkDeleteBtn').addEventListener('click',deleteBookmark);
  $('undoLastDeleteBtn').addEventListener('click',undoBookmarkDelete);
  $('revealKeyBtn').addEventListener('click',()=>{$('apiKeyInput').type=$('apiKeyInput').type==='password'?'text':'password';});
  $('metricBookmarks').addEventListener('click',()=>{setLibraryFilter('all');setTab('library');});
  $('metricFolders').addEventListener('click',()=>{setLibraryFilter('folders');setTab('library');});
  $('metricProblems').addEventListener('click',()=>{setLibraryFilter('issues');setTab('library');});
  $('librarySearch').addEventListener('input',()=>{pageLimit=60;renderLibrary();});
  $('planSearch').addEventListener('input',()=>{pageLimit=60;renderPlan();});
  $('selectAllBtn').addEventListener('click',()=>{activePlan.items.forEach(x=>{if(x.category!=='其他')x.selected=true;});renderPlan();persistPlanSoon();});
  $('selectNoneBtn').addEventListener('click',()=>{activePlan.items.forEach(x=>x.selected=false);renderPlan();persistPlanSoon();});
  $('planGoAnalyze').addEventListener('click',()=>setTab('home'));
  $('cancelAnalysisBtn').addEventListener('click',cancelCurrentAnalysis);
  $('homeCancelAnalysisBtn').addEventListener('click',cancelCurrentAnalysis);
  $('cancelAssistantAI').addEventListener('click',cancelAssistantAnalysis);
  $('libraryFolderScopeClear').addEventListener('click',()=>{libraryFolderScope='';setLibraryFilter('folders');});
  $('analyzeBtn').addEventListener('click',analyze);
  $('applyBtn').addEventListener('click',showConfirm);
  $('confirmCheckbox').addEventListener('change',()=>updateButtons());
  $('confirmApplyBtn').addEventListener('click',applyPlan);
  $('undoBtn').addEventListener('click',restoreJournal);
  bindStorageWatch();
  try{ await loadSettings(); await refresh(); await pullBackgroundState();await updateUndoDeleteButton(); renderHomeState(); updateButtons(); }
  catch(error){ console.error(error); notify('无法读取书签：'+error.message,true); }
});

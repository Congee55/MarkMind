/* Search, semantic suggestions, and link-health tools for the bookmark library. */
'use strict';
let libraryModeUI='normal',deadFilterUI='dead',deadScanUI=null;
let bookmarkInsightsUI={}, semanticStateUI=null;
const deadLabel={dead:'疑似失效',unknown:'无法确认',alive:'正常',skipped:'未检查'};
const currentBookmarks=()=>state?.bookmarks||[];
function setLibraryMode(mode){
 if(!['normal','impression','deadlinks'].includes(mode))return;
 libraryModeUI=mode;
 document.querySelectorAll('[data-library-mode]').forEach(btn=>{const on=btn.dataset.libraryMode===mode;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));});
 $('librarySearchControls').classList.toggle('hidden',mode==='deadlinks');
 $('libraryList').classList.toggle('hidden',mode==='deadlinks');
 $('deadLinkPanel').classList.toggle('hidden',mode!=='deadlinks');
 $('libraryFilters').classList.toggle('hidden',mode!=='normal');
 $('impressionHint').classList.toggle('hidden',mode!=='impression');
 $('aiSearchStatus').classList.toggle('hidden',mode!=='impression');
 $('librarySearch').placeholder=mode==='impression'?'描述想找的网站功能，如 PDF 转换':'搜索标题、网址、所在文件夹';
 if(mode==='deadlinks')void loadDeadLinks();
 else {if(mode==='normal'){$('librarySearch').value='';$('aiSearchStatus').classList.add('hidden');}renderLibrary();}
}
function libraryBookmarkRow(item,reasons){
 const row=node('div','library-item');
 const ico=node('span','item-letter');ico.append(makeIcon('bookmark'));
 const main=node('div','library-main');
 const name=node('span','item-name',item.title);name.title=item.title;
 const meta=node('div','item-meta',reasons||`${item.path||'根目录'} · ${item.domain||''}`);
 main.append(name,meta);row.append(ico,main);
 const edit=node('button','open-link');edit.type='button';edit.title='就地编辑或删除';edit.setAttribute('aria-label','编辑 '+item.title);edit.append(makeIcon('edit'));edit.addEventListener('click',()=>openBookmarkEditor(item.id));
 const open=node('button','open-link');open.type='button';open.title='打开网页';open.setAttribute('aria-label','打开 '+item.title);open.append(makeIcon('external'));open.addEventListener('click',()=>chrome.tabs.create({url:item.url}));
 row.append(edit,open);return row;
}
function renderSemanticStatus(){
 if(libraryModeUI!=='impression')return;
 const q=$('librarySearch').value.trim();
 const el=$('aiSearchStatus');
 const matched=semanticStateUI?.query===q;
 $('aiImpressionBtn').disabled=semanticStateUI?.status==='running';
 $('cancelAISearchBtn').classList.toggle('hidden',semanticStateUI?.status!=='running');
 if(!q){el.textContent=semanticStateUI?.status==='running'?`正在后台查找「${semanticStateUI.query}」，可停止此任务`:'';el.classList.toggle('hidden',!el.textContent);return;}
 if(!matched){el.textContent=semanticStateUI?.status==='running'?`正在后台查找「${semanticStateUI.query}」，停止后可搜索新内容`:'可选用 AI 扩展搜索，结果会缓存 7 天';el.classList.remove('hidden');return;}
 const s=semanticStateUI;
 if(s.status==='running')el.textContent=`AI 正在查找 · ${s.done||0}/${s.total||0} 条，可关闭插件稍后查看`;
 else if(s.status==='completed')el.textContent=`AI 搜索完成 · ${s.hits?.length||0} 条匹配${s.fromCache?'（使用缓存）':''}`;
 else if(s.status==='error')el.textContent=`AI 搜索未完成：${s.error||'请重试'}`;
 else el.textContent='';
 el.classList.toggle('hidden',!el.textContent);
}
function renderLibraryTools(){
 if(libraryModeUI==='normal')return false;
 if(libraryModeUI==='deadlinks'){renderDeadLinks();return true;}
 const query=$('librarySearch').value.trim();
 const bookmarks=currentBookmarks().map(b=>({...b,impression:[bookmarkInsightsUI[b.id],activePlan?.items?.find(x=>x.id===b.id)?.reason].filter(Boolean).join(' · ')}));
 const local=MarkMindImpression.search(bookmarks,query,{limit:120});
 const byId=new Map(local.map(item=>[item.id,item]));
 if(semanticStateUI?.query===query){
  const bookmarkMap=new Map(bookmarks.map(b=>[b.id,b]));
  for(const x of semanticStateUI.hits||[]){
   const b=bookmarkMap.get(x.id);if(!b)continue;
   const existing=byId.get(x.id);
   if(existing){existing.score+=Math.round(100*x.confidence);existing.reasons=['AI · '+x.reason,...existing.reasons].slice(0,3);}
   else byId.set(x.id,{...b,score:100+Math.round(100*x.confidence),reasons:['AI · '+x.reason]});
  }
 }
 const results=[...byId.values()].sort((a,b)=>b.score-a.score||String(a.title).localeCompare(String(b.title),'zh-CN')).slice(0,140);
 $('libraryCount').textContent=query?`${results.length} 个匹配`:'印象搜索';
 const target=$('libraryList');target.textContent='';
 if(!query)target.append(node('div','impression-empty','例如：PDF 转换、英文打字、论文检索'));
 else if(!results.length)target.append(node('div','impression-empty','暂未找到相关书签。可点击「AI 扩展搜索」查找更多。'));
 else for(const item of results){target.append(libraryBookmarkRow(item,`${item.reasons.join(' · ')} · ${item.path||item.domain||'根目录'}`));}
 renderSemanticStatus();return true;
}
async function startAISearch(){
 const query=$('librarySearch').value.trim();
 if(!query){notify('先输入网站功能描述');$('librarySearch').focus();return;}
 try{
  const r=await chrome.runtime.sendMessage({type:'startSemanticSearch',query});
  if(!r?.ok)throw Error(r?.error||'无法启动搜索');
  if(r.cached){await loadSemanticState();notify('已读取上次 AI 检索结果');}
  else {semanticStateUI={status:'running',query,total:r.total||0,done:0,hits:[]};renderLibrary();notify('AI 已开始分析书签用途，结果会保存到本地。');}
 }catch(e){notify(e.message,true);}
}
async function loadSemanticState(){
 const saved=await chrome.storage.local.get(['semanticSearchTask','bookmarkInsights']);
 semanticStateUI=saved.semanticSearchTask||null;bookmarkInsightsUI=saved.bookmarkInsights||{};
 if(libraryModeUI==='impression')renderLibrary();
}
async function loadDeadLinks(){
 try{const resp=await chrome.runtime.sendMessage({type:'getDeadLinkScan'});if(resp?.ok)deadScanUI=resp.state||null;}catch(_){ }
 renderDeadLinks();
}
function renderDeadLinks(){
 if(libraryModeUI!=='deadlinks')return;
 const s=deadScanUI,working=s?.status==='running';
 $('libraryCount').textContent=s?(working?'检测中':s.status==='completed'?'已完成':'未完成'):'未检测';
 $('scanDeadLinksBtn').disabled=working;
 $('scanDeadLinksBtn').lastChild.textContent=working?'正在检测…':s?'重新检测':'开始检测';
 $('deadProgress').classList.toggle('hidden',!s);$('deadTotals').classList.toggle('hidden',!s);$('deadFilterRow').classList.toggle('hidden',!s);
 if(!s){$('deadResults').textContent='';return;}
 const progress=Math.round(100*(s.done||0)/Math.max(1,s.total||1));
 $('deadProgressFill').style.width=progress+'%';
 $('deadProgressText').textContent=s.status==='error'?'检测中断：'+(s.error||'未知错误'):s.status==='completed'?`已检测 ${s.done}/${s.total} 条 · 删除需确认`:`已检测 ${s.done}/${s.total} 条 · 可关闭弹窗`;
 const byId=new Map(currentBookmarks().map(b=>[b.id,b]));
 const available=(s.results||[]).filter(x=>byId.has(x.id));
 $('deadCount').textContent=available.filter(x=>x.status==='dead').length;
 $('unknownCount').textContent=available.filter(x=>x.status==='unknown').length;
 $('aliveCount').textContent=available.filter(x=>x.status==='alive').length;
 const filtered=available.filter(r=>deadFilterUI==='all'||r.status===deadFilterUI).slice(0,120);
 const target=$('deadResults');target.textContent='';
 if(!filtered.length){target.append(node('div','impression-empty',working?'正在检测，结果会陆续出现':deadFilterUI==='dead'?'目前没有发现明确失效的链接':'当前筛选下没有结果'));return;}
 for(const r of filtered){
  const b=byId.get(r.id);
  const row=node('div','library-item dead-item');
  const badge=node('span',`dead-badge ${r.status}`,r.code?String(r.code):(deadLabel[r.status]||'未知'));
  const main=node('div','library-main');main.append(node('span','item-name',b.title),node('div','item-meta',r.reason||deadLabel[r.status]));
  const edit=node('button','open-link');edit.type='button';edit.title='编辑名称或网址';edit.setAttribute('aria-label','编辑 '+b.title);edit.append(makeIcon('edit'));edit.addEventListener('click',()=>openBookmarkEditor(b.id));
  const remove=node('button','open-link danger-icon');remove.type='button';remove.title='删除书签（需确认）';remove.setAttribute('aria-label','删除 '+b.title);remove.append(makeIcon('trash'));remove.addEventListener('click',()=>deleteBookmarkById(b.id));
  const open=node('button','open-link');open.type='button';open.title='打开网页核实';open.setAttribute('aria-label','打开 '+b.title);open.append(makeIcon('external'));open.addEventListener('click',()=>chrome.tabs.create({url:b.url}));
  row.append(badge,main,edit,remove,open);target.append(row);
 }
 if(available.length>120)target.append(node('p','tool-hint','结果较多，先显示前 120 条。'));
}
async function startDeadLinkUI(){
 try{
  const granted=await chrome.permissions.request({origins:['http://*/*','https://*/*']});
  if(!granted){notify('未授权网站访问，无法检查链接状态',true);return;}
  const res=await chrome.runtime.sendMessage({type:'startDeadLinkScan'});
  if(!res?.ok)throw Error(res?.error||'无法启动检测');
  deadScanUI={status:'running',total:state?.bookmarks.length||0,done:0,dead:0,unknown:0,alive:0,results:[]};
  renderDeadLinks();notify('后台检测已启动。删除链接需要单独确认。');
 }catch(err){notify('无法检测：'+err.message,true);}
}
document.addEventListener('DOMContentLoaded',()=>{
 document.querySelectorAll('[data-library-mode]').forEach(b=>b.addEventListener('click',()=>setLibraryMode(b.dataset.libraryMode)));
 document.querySelectorAll('[data-dead-filter]').forEach(b=>b.addEventListener('click',()=>{deadFilterUI=b.dataset.deadFilter;document.querySelectorAll('[data-dead-filter]').forEach(i=>i.classList.toggle('active',i===b));renderDeadLinks();}));
 $('scanDeadLinksBtn').addEventListener('click',startDeadLinkUI);
 $('aiImpressionBtn').addEventListener('click',startAISearch);
 $('cancelAISearchBtn').addEventListener('click',async()=>{
  if(!confirm('停止本次 AI 扩展搜索？本地印象搜索仍可继续使用。'))return;
  const r=await chrome.runtime.sendMessage({type:'cancelSemanticSearch'}).catch(e=>({ok:false,error:e.message}));
  if(!r?.ok)return notify(r?.error||'取消失败',true);
  semanticStateUI=null;renderLibrary();notify('已停止 AI 扩展搜索');
 });
 void loadSemanticState();
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes.deadLinkScan){deadScanUI=changes.deadLinkScan.newValue||null;renderDeadLinks();}
  if(changes.semanticSearchTask){semanticStateUI=changes.semanticSearchTask.newValue||null;if(libraryModeUI==='impression')renderLibrary();}
  if(changes.bookmarkInsights){bookmarkInsightsUI=changes.bookmarkInsights.newValue||{};if(libraryModeUI==='impression')renderLibrary();}
 });
});

'use strict';
importScripts('ai-client.js','engine.js','backup.js','rename-engine.js','organize-engine.js','dead-links.js','dead-links-background.js','semantic-search-background.js');
const E=self.MarkMindEngine;
const AI=self.MarkMindAI;
const STORAGE=()=>chrome.storage.local;
const JOB='analysisJob', PLAN='analysisPlan', STATE='analysisState', ALARM='markmind-resume-analysis';
let running=false, backupBusy=false;
let analysisAbort=null, analysisCancelled=false;
const B=self.MarkMindBackup;
async function backupTask(type,backupId){
 if(backupBusy || running || namingBusy || renameApplyBusy || orgInMemoryBusy())throw Error('已有任务正在执行，请完成后再试');
 backupBusy=true;
 const task={type,status:'running',createdAt:Date.now(),message:type==='restore'?'正在恢复历史备份':'正在创建完整备份'};
 await STORAGE().set({backupTask:task});
 try{
  let result;
  if(type==='create'){result=await B.create(await chrome.bookmarks.getTree());}
  else if(type==='restore'){result=await B.restore(backupId);await STORAGE().remove(PLAN);await setState({status:'idle',completed:0,total:0,message:'已恢复备份，请重新分析',error:''});}
  else throw Error('无效任务');
  await STORAGE().set({backupTask:{...task,status:'completed',message:type==='create'?'备份创建成功':'备份恢复完成',result,updatedAt:Date.now()}});
 }catch(error){await STORAGE().set({backupTask:{...task,status:'error',message:String(error.message||error),updatedAt:Date.now()}});}
 finally{backupBusy=false;}
}

const pause=ms=>new Promise(r=>setTimeout(r,ms));
function systemPrompt(){
 const rules=Object.entries(E.TAXONOMY).filter(([c])=>c!=='其他').map(([c,s])=>`${c}: ${s.join('、')}`).join('\n');
 return `你是专业中文书签分类员。目标是准确、可用，优先选择一级主题，二级主题仅作候选标签，插件会按数量决定是否实际创建。\n可选一级及二级：\n${rules}\n对于每条书签，结合标题、域名、网址路径，原文件夹仅作辅助线索；不能假装看过网页正文。不要为了高分编造确定性。选择最符合网站主要用途的类别，优先明确的垂直类别，宁可留"其他"也不要误判。分类confidence是0至1的判断置信度；reason用一句短中文说明依据。每条都必须输出ID。\n只输出合法 JSON：{"items":[{"id":"123","category":"科研","subcategory":"文献论文","confidence":0.83,"reason":"论文检索网站"}]}。不输出 markdown 或 emoji。`;
}
async function setState(patch){
 const old=(await STORAGE().get(STATE))[STATE]||{};
 const state={...old,...patch,updatedAt:Date.now()};await STORAGE().set({[STATE]:state});
 return state;
}
async function ask(batch,prefs,attempt=0){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),80000);
 analysisAbort=ctrl;
 try {
  const payload=batch.map(b=>({id:b.id,title:b.title.slice(0,145),url:b.url.slice(0,380),domain:b.domain,oldPath:b.path.slice(0,170)}));
  const parsed=await AI.chatJSON(prefs,{system:systemPrompt(),user:{bookmarks:payload},max_tokens:6000,temperature:0.1,signal:ctrl.signal}).catch(async err=>{
    if(!analysisCancelled&&[429,500,502,503,504].includes(err.status)&&attempt<3){await pause(1600*(attempt+1));if(analysisCancelled)throw Error("用户已取消");return ask(batch,prefs,attempt+1);}
    throw err;
  });
  // The retry path returns the final validated array, not a raw response.
  if(Array.isArray(parsed))return parsed;
  if(!Array.isArray(parsed.items))throw Error('AI 返回格式不正确');
  const ids=new Set(batch.map(b=>b.id));return parsed.items.filter(i=>ids.has(String(i.id)));
 }finally{clearTimeout(timer);if(analysisAbort===ctrl)analysisAbort=null;}
}
async function begin(){
 const prior=(await STORAGE().get([JOB,STATE]))[JOB];
 if(backupBusy || namingBusy || renameApplyBusy || orgInMemoryBusy())throw Error('正在执行其他任务，请完成后再分析');
 if(running && analysisCancelled)throw Error('上一次分析正在停止，请稍后重试');
 if(running||prior){return {status:'running'};}
 const prefs=await STORAGE().get([...AI.keys,'customRule']);
 if(!AI.hasKey(prefs))throw Error('请先在设置中配置 AI 接口');
 const scan=E.scan(await chrome.bookmarks.getTree());
 if(!scan.bookmarks.length)throw Error('没有可分析的书签');
 analysisCancelled=false;
 const job={createdAt:Date.now(),bookmarks:scan.bookmarks,raw:[],next:0,batchSize:24};
 await STORAGE().set({[JOB]:job});
 await setState({status:'running',total:scan.bookmarks.length,completed:0,totalBatches:Math.ceil(scan.bookmarks.length/job.batchSize),completedBatches:0,message:'后台分析已启动',error:''});
 chrome.alarms.create(ALARM,{delayInMinutes:1,periodInMinutes:1});
 void pump();
 return {status:'started'};
}
async function pump(){
 if(running)return;
 running=true;
 try{
  let job=(await STORAGE().get(JOB))[JOB];
  if(!job)return;
  const prefs=await STORAGE().get([...AI.keys,'customRule']);
  if(!AI.hasKey(prefs))throw Error('API Key 已被移除，请重新设置');
  const totalBatches=Math.ceil(job.bookmarks.length/job.batchSize);
  while(job.next<job.bookmarks.length){
   if(analysisCancelled)return;
   const latest=(await STORAGE().get([JOB,STATE]));
   if(!latest[JOB]||latest[STATE]?.status!=='running')return;
   const i=job.next;
   await setState({status:'running',total:job.bookmarks.length,completed:i,totalBatches,completedBatches:Math.floor(i/job.batchSize),message:`正在分析 ${i}/${job.bookmarks.length} 条`});
   const raw=await ask(job.bookmarks.slice(i,i+job.batchSize),prefs);
   if(analysisCancelled || (await STORAGE().get(STATE))[STATE]?.status!=='running')return;
   job.raw.push(...raw); job.next=Math.min(job.bookmarks.length,i+job.batchSize);
   // Durable checkpoint after each batch: a suspended worker resumes this batch at worst.
   await STORAGE().set({[JOB]:job});
   await setState({status:'running',completed:job.next,completedBatches:Math.ceil(job.next/job.batchSize),message:`已完成 ${job.next}/${job.bookmarks.length} 条`});
  }
  if(analysisCancelled || (await STORAGE().get(STATE))[STATE]?.status!=='running')return;
  const fakeScan={bookmarks:job.bookmarks};
  const plan=E.makePlan(fakeScan,job.raw);
  // Save a completed plan before clearing resume metadata; both survive popup close.
  await STORAGE().set({[PLAN]:plan});
  const insights=(await STORAGE().get('bookmarkInsights')).bookmarkInsights||{};
  for(const item of plan.items)insights[item.id]=[item.category,item.subcategory,item.reason].filter(Boolean).join(' · ').slice(0,115);
  await STORAGE().set({bookmarkInsights:insights});
  await setState({status:'completed',total:plan.total,completed:plan.total,totalBatches,completedBatches:totalBatches,message:`分析完成：${plan.total} 条，${plan.pending} 条建议核实`,error:''});
  await STORAGE().remove(JOB);await chrome.alarms.clear(ALARM);
 }catch(err){
  if(analysisCancelled)return;
  await setState({status:'error',message:'分析中断，可继续上次进度',error:err?.name==='AbortError'?'API 请求超时':String(err.message||err)}).catch(()=>{});
  // Keep the checkpoint. A deliberate retry resumes from the previous successful batch.
  await chrome.alarms.clear(ALARM).catch(()=>{});
 }finally{
  if(analysisCancelled){
   await STORAGE().remove([JOB,PLAN]).catch(()=>{});
   await setState({status:'idle',total:0,completed:0,totalBatches:0,completedBatches:0,message:'',error:''}).catch(()=>{});
  }
  running=false;analysisAbort=null;
 }
}
async function resume(){
 const saved=await STORAGE().get([JOB,STATE]);
 if(!saved[JOB])return;
 if(saved[STATE]?.status==='error')return; // Require explicit user retry after API errors.
 await chrome.alarms.create(ALARM,{delayInMinutes:1,periodInMinutes:1});
 void pump();
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM)void resume();if(a.name===R_ALARM)void resumeNaming();if(a.name===ORG_ALARM)void orgResume();});
chrome.runtime.onStartup.addListener(()=>{void resume();void resumeNaming();void orgResume();});
chrome.runtime.onInstalled.addListener(()=>{void resume();void resumeNaming();void orgResume();});
chrome.runtime.onMessage.addListener((m,s,respond)=>{
 (async()=>{
  if(m?.type==='cancelSemanticSearch'){await semCancel();return respond({ok:true});}
  if(m?.type==='startSemanticSearch'){const result=await semStart(m.query);return respond({ok:true,...result});}
  if(m?.type==='getSemanticSearch'){const task=(await STORAGE().get(SEM_TASK))[SEM_TASK]||null;return respond({ok:true,task});}
  if(m?.type==='createBackup'||m?.type==='restoreBackup'){
   if(backupBusy||running||namingBusy||renameApplyBusy||orgInMemoryBusy())return respond({ok:false,error:'已有操作正在执行'});
   backupTask(m.type==='createBackup'?'create':'restore',m.backupId).catch(()=>{});
   return respond({ok:true,status:'started'});
  }
  if(m?.type==='startAnalysis'){
   if(namingBusy||renameApplyBusy||orgInMemoryBusy() || (await STORAGE().get(ORG_JOB))[ORG_JOB] || (await STORAGE().get(ORG_APPLY))[ORG_APPLY] || (await STORAGE().get(R_JOB))[R_JOB] || (await STORAGE().get(R_APPLY))[R_APPLY])return respond({ok:false,error:'AI 命名任务正在进行，请稍后再分类'});
   const v=(await STORAGE().get([JOB,STATE]));
   if(v[JOB]){
    await setState({status:'running',error:'',message:'正在继续上次分析…'});
    await chrome.alarms.create(ALARM,{delayInMinutes:1,periodInMinutes:1});
    void pump();return respond({ok:true,status:'resumed'});
   }
   const r=await begin();return respond({ok:true,...r});
  }
  if(m?.type==='startDeadLinkScan'){
   const r=await dlStart();return respond({ok:true,...r});
  }
  if(m?.type==='getDeadLinkScan'){
   return respond({ok:true,state:await dlRead()});
  }
  if(m?.type==='getAnalysisState'){
   const v=await STORAGE().get([STATE,PLAN,JOB]);
   if(v[JOB] && v[STATE]?.status==='running' && !running){void resume();}
   return respond({ok:true,state:v[STATE],plan:v[PLAN]||null,hasCheckpoint:!!v[JOB]});
  }
  if(m?.type==='startRename'){
   if(orgInMemoryBusy()||(await STORAGE().get([ORG_JOB,ORG_APPLY]))[ORG_JOB]||(await STORAGE().get(ORG_APPLY))[ORG_APPLY])return respond({ok:false,error:'AI 整理任务正在运行，请先完成'});
   if(m?.resume){const j=(await STORAGE().get(R_JOB))[R_JOB];if(!j)return respond({ok:false,error:'没有可继续的任务'});await renameState({status:'running',error:'',message:'正在继续命名分析'});await resumeNaming();return respond({ok:true,status:'resumed'});}
   const result=await startNaming(m.scope,m.instruction);return respond({ok:true,...result});
  }
  if(m?.type==='cancelRename'){
   if(renameApplyBusy || (await STORAGE().get(R_APPLY))[R_APPLY])return respond({ok:false,error:'正在实际修改标题，不能取消，请使用撤销功能'});
   renameCancelled=true;if(renameAbort)renameAbort.abort();
   await chrome.alarms.clear(R_ALARM);
   await STORAGE().remove([R_JOB,R_PLAN]);
   await renameState({status:'idle',message:'已取消本次 AI 命名',error:'',total:0,completed:0});
   return respond({ok:true});
  }
  if(m?.type==='getRenameState'){
   const data=await STORAGE().get([R_STATE,R_PLAN,R_JOB,R_UNDO,R_APPLY]);
   if(data[R_JOB]&&data[R_STATE]?.status==='running'&&!namingBusy)void resumeNaming();
   if(data[R_APPLY]&&data[R_STATE]?.status==='applying'&&!renameApplyBusy)void resumeNaming();
   return respond({ok:true,state:data[R_STATE]||{status:'idle'},plan:data[R_PLAN]||null,hasCheckpoint:!!data[R_JOB],undo:!!data[R_UNDO],applying:!!data[R_APPLY]});
  }
  if(m?.type==='applyRename'){
   const result=await startRenameApply();return respond({ok:true,...result});
  }
  if(m?.type==='undoRename'){
   const result=await undoRenames();return respond({ok:true,...result});
  }
  if(m?.type==='discardRename'){
   if(namingBusy||renameApplyBusy)return respond({ok:false,error:'任务还在进行中'});
   const current=await STORAGE().get([R_JOB,R_APPLY]);
   if(current[R_APPLY])return respond({ok:false,error:'有未完成的修改，请先撤销上次命名'});
   await STORAGE().remove([R_JOB,R_PLAN,R_STATE]);await chrome.alarms.clear(R_ALARM);
   await renameState({status:'idle',message:'已放弃旧任务',error:'',completed:0,total:0});return respond({ok:true});
  }
  if(m?.type==='clearRename'){
   const data=await STORAGE().get([R_JOB,R_APPLY]);
   if(namingBusy||renameApplyBusy||data[R_JOB]||data[R_APPLY])return respond({ok:false,error:'仍有未完成的命名任务'});
   await STORAGE().remove([R_PLAN,R_STATE]);return respond({ok:true});
  }
  if(m?.type==='cancelOrganize'){const result=await orgCancelAnalysis();return respond({ok:true,...result});}
  if(m?.type==='startOrganize'){
    const result=await orgStart(m.scope,m.parentId,m.targetName,m.instruction);return respond({ok:true,...result});
   }
   if(m?.type==='resumeOrganize'){
    const d=await STORAGE().get([ORG_JOB,ORG_APPLY,ORG_STATE]);
    if(!d[ORG_JOB]&&!d[ORG_APPLY])return respond({ok:false,error:'没有可继续的任务'});
    await orgSetState({status:d[ORG_APPLY]?'applying':'running',error:'',message:d[ORG_APPLY]?'正在继续移动未完成的书签':'正在继续分析'});
    void orgResume();return respond({ok:true});
   }
   if(m?.type==='getOrganizeState'){
    const d=await STORAGE().get([ORG_JOB,ORG_STATE,ORG_PLAN,ORG_APPLY,ORG_UNDO]);
    if((d[ORG_JOB]||d[ORG_APPLY])&&d[ORG_STATE]?.status!=='error')void orgResume();
    return respond({ok:true,state:d[ORG_STATE]||{status:'idle'},plan:d[ORG_PLAN]||null,undo:!!d[ORG_UNDO],checkpoint:!!d[ORG_JOB],applying:!!d[ORG_APPLY]});
   }
   if(m?.type==='applyOrganize'){const result=await orgApplyStart();return respond({ok:true,...result});}
   if(m?.type==='undoOrganize'){const result=await orgUndo();return respond({ok:true,...result});}
   if(m?.type==='clearOrganize'){
    if(orgInMemoryBusy())return respond({ok:false,error:'整理任务正在执行'});
    const d=await STORAGE().get([ORG_JOB,ORG_APPLY]);if(d[ORG_JOB]||d[ORG_APPLY])return respond({ok:false,error:'仍有未完成的任务'});
    await STORAGE().remove([ORG_STATE,ORG_PLAN]);return respond({ok:true});
   }
   if(m?.type==='discardOrganize'){
    if(orgInMemoryBusy())return respond({ok:false,error:'后台任务仍在运行'});
    const d=await STORAGE().get(ORG_APPLY);if(d[ORG_APPLY])return respond({ok:false,error:'移动任务正在执行，不能丢弃'});
    await STORAGE().remove([ORG_JOB,ORG_STATE,ORG_PLAN]);await chrome.alarms.clear(ORG_ALARM);
    await orgSetState({status:'idle',message:'已放弃分析',error:''});return respond({ok:true});
   }
   if(m?.type==='cancelAnalysis' || m?.type==='clearAnalysis'){
   // Cancel AI generation only. Never interrupt bookmark writes or backups.
   if(backupBusy || renameApplyBusy || orgApplyBusy)return respond({ok:false,error:'正在修改书签或备份，不能清除本次分类方案'});
   analysisCancelled=true;
   if(analysisAbort)analysisAbort.abort();
   await chrome.alarms.clear(ALARM);
   // A user-initiated cancel/discard clears the derived classification hints as well.
   // The internal clearAnalysis after a successful apply keeps those hints useful for impression search.
   await STORAGE().remove(m.type==='cancelAnalysis'?[JOB,PLAN,'bookmarkInsights']:[JOB,PLAN]);
   await setState({status:'idle',total:0,completed:0,totalBatches:0,completedBatches:0,message:'',error:''});
   return respond({ok:true});
  }
 })().catch(e=>respond({ok:false,error:String(e.message||e)}));return true;
});


/* Separate, scope-locked background naming workflow. A title task never moves bookmarks. */
const R=self.MarkMindRename;
const R_JOB='renameJob', R_PLAN='renamePlan', R_STATE='renameState', R_APPLY='renameApplyJob', R_UNDO='renameUndo';
const R_ALARM='markmind-resume-rename';
let namingBusy=false, renameApplyBusy=false;
let renameAbort=null, renameCancelled=false;
async function renameState(patch){
 const prev=(await STORAGE().get(R_STATE))[R_STATE]||{};
 const next={...prev,...patch,updatedAt:Date.now()};
 await STORAGE().set({[R_STATE]:next});return next;
}
function forbidOtherWork(){
 if(running||backupBusy||namingBusy||renameApplyBusy||orgInMemoryBusy())throw Error('另一项后台任务正在进行，请完成后再试');
}
async function askTitles(batch,prefs,instruction,attempt=0){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),80000);
 renameAbort=controller;
 const input=batch.map(b=>({id:b.id,title:b.title.slice(0,150),url:b.url.slice(0,380),folder:b.path.slice(0,160)}));
 try{
  const system=`你是认真严谨的书签标题编辑，仅建议更易识别、更短、更准确的书签标题。只允许修改传入的书签标题；不得提议移动、删除、分类或修改文件夹，不能追加未提供的 ID。目标：去除“Home/主页/首页”、多余营销文案、无意义长后缀，保留网站、期刊、工具的关键正式名称，专业术语准确，不要把不同网站统一改成同一标题。以中文为主，保留专有名词和真实英文名称。标题通常 6 到 32 个字符，最长 70 字；不加 emoji、编号、网址或未经证实的内容。你只看到了网址、现有标题、旧路径，不能假装访问或阅读过网页。用户自定义要求仅用于这些标题的写法，不得扩大作用范围。缺乏可靠依据时保留原名。
只输出 JSON，格式为 {"items":[{"id":"123","title":"学术资源｜ResearchGate","reason":"保留品牌与用途"}]}。务必包含所有输入 ID。`;
  const raw=await AI.chatJSON(prefs,{system,user:{instruction:String(instruction||'').slice(0,350),scopePolicy:'仅处理下列书签ID，其余任何书签禁止修改',bookmarks:input},max_tokens:5000,temperature:0.15,signal:controller.signal}).catch(async err=>{
    if(!renameCancelled&&[429,500,502,503,504].includes(err.status)&&attempt<2){await pause(1600*(attempt+1));if(renameCancelled)throw Error("用户已取消");return askTitles(batch,prefs,instruction,attempt+1);}
    throw err;
  });
  if(Array.isArray(raw))return raw;
  if(!Array.isArray(raw.items))throw Error('AI 命名建议格式不正确');
  const ids=new Set(batch.map(b=>String(b.id)));
  return raw.items.filter(x=>ids.has(String(x.id)));
 }finally{clearTimeout(timer);if(renameAbort===controller)renameAbort=null;}
}
async function startNaming(scope,instruction){
 forbidOtherWork();
 const saved=await STORAGE().get([R_JOB,R_APPLY,...AI.keys]);
 if(saved[R_JOB] || saved[R_APPLY])throw Error('已有未完成的命名任务');
 if(!AI.hasKey(saved))throw Error('请先在设置中配置 AI 接口');
 if(!scope||!['folder','selected'].includes(scope.mode))throw Error('请先选择操作范围');
 const current=E.scan(await chrome.bookmarks.getTree());
 const bookmarks=R.scopeItems(current,scope);
 if(!bookmarks.length)throw Error('所选范围内没有书签');
 if(bookmarks.length>2000)throw Error('本次最多分析 2000 条书签，请缩小范围');
 const job={version:1,scope,bookmarks,raw:[],next:0,batchSize:18,instruction:String(instruction||'').trim().slice(0,350),createdAt:Date.now()};
 renameCancelled=false;
 await STORAGE().remove(R_PLAN);
 await STORAGE().set({[R_JOB]:job});
 await renameState({status:'running',total:bookmarks.length,completed:0,message:`准备优化 ${bookmarks.length} 条书签名称`,error:'',scope});
 chrome.alarms.create(R_ALARM,{periodInMinutes:1});
 void pumpNaming();return {status:'started',count:bookmarks.length};
}
async function pumpNaming(){
 if(namingBusy||renameApplyBusy||running||backupBusy)return;
 namingBusy=true;
 try{
  let job=(await STORAGE().get(R_JOB))[R_JOB];if(!job)return;
  const prefs=await STORAGE().get(AI.keys);if(!AI.hasKey(prefs))throw Error('API Key 已被移除');
  while(job.next<job.bookmarks.length){
   if(renameCancelled || !(await STORAGE().get(R_JOB))[R_JOB])return;
   await renameState({status:'running',total:job.bookmarks.length,completed:job.next,message:`AI 命名中 · ${job.next}/${job.bookmarks.length}`});
   const results=await askTitles(job.bookmarks.slice(job.next,job.next+job.batchSize),prefs,job.instruction);
   if(renameCancelled || (await STORAGE().get(R_STATE))[R_STATE]?.status!=='running')return;
   job.raw.push(...results);job.next=Math.min(job.next+job.batchSize,job.bookmarks.length);
   await STORAGE().set({[R_JOB]:job});
   await renameState({status:'running',completed:job.next,message:`已分析 ${job.next}/${job.bookmarks.length} 条`});
  }
  if(renameCancelled || (await STORAGE().get(R_STATE))[R_STATE]?.status!=='running')return;
  const plan=R.makePlan(job.bookmarks,job.raw,job.scope,job.instruction);
  await STORAGE().set({[R_PLAN]:plan});
  await renameState({status:'completed',total:plan.items.length,completed:plan.items.length,message:`已生成 ${plan.items.filter(x=>x.selected).length} 条优化建议`,error:''});
  await STORAGE().remove(R_JOB);
  await chrome.alarms.clear(R_ALARM);
 }catch(err){
  if(renameCancelled)return;
  await renameState({status:'error',message:'命名分析中断，可继续进度',error:err?.name==='AbortError'?'API 请求超时':String(err.message||err)}).catch(()=>{});
  await chrome.alarms.clear(R_ALARM).catch(()=>{});
 }finally{
  if(renameCancelled){await STORAGE().remove([R_JOB,R_PLAN]).catch(()=>{});await renameState({status:'idle',total:0,completed:0,message:'已取消本次 AI 命名',error:''}).catch(()=>{});}
  namingBusy=false;renameAbort=null;
 }
}
async function resumeNaming(){
 const saved=await STORAGE().get([R_JOB,R_STATE,R_APPLY]);
 if(saved[R_APPLY]){if(saved[R_STATE]?.status!=='error')void pumpRenameApply();return;}
 if(!saved[R_JOB]||saved[R_STATE]?.status==='error')return;
 chrome.alarms.create(R_ALARM,{periodInMinutes:1});void pumpNaming();
}
async function startRenameApply(){
 forbidOtherWork();
 const current=await STORAGE().get([R_PLAN,R_JOB,R_APPLY,'backupEnabled']);
 if(current[R_JOB]||current[R_APPLY])throw Error('存在进行中的命名任务');
 const tree=await chrome.bookmarks.getTree();
 const items=R.validateEdits(current[R_PLAN],E.scan(tree));
 if(!items.length)throw Error('没有可修改的书签，或书签已经在别处被修改。请重新生成方案');
 const journal={status:'running',createdAt:Date.now(),items,backupId:null,processed:0};
 const apply={...journal,backupEnabled:current.backupEnabled!==false};
 await STORAGE().set({[R_UNDO]:journal,[R_APPLY]:apply});
 await renameState({status:'applying',total:items.length,completed:0,message:`准备修改 ${items.length} 条标题`,error:''});
 chrome.alarms.create(R_ALARM,{periodInMinutes:1});void pumpRenameApply();
 return {status:'started',count:items.length};
}
async function pumpRenameApply(){
 if(renameApplyBusy||running||backupBusy||namingBusy)return;
 renameApplyBusy=true;
 try{
  const task=(await STORAGE().get(R_APPLY))[R_APPLY];if(!task)return;
  if(task.backupEnabled&&!task.backupId){
   await renameState({status:'applying',message:'修改前正在创建完整书签备份…'});
   const backup=await B.create(await chrome.bookmarks.getTree());task.backupId=String(backup.id);
   await STORAGE().set({[R_APPLY]:task});
   const j=(await STORAGE().get(R_UNDO))[R_UNDO];await STORAGE().set({[R_UNDO]:{...j,backupId:task.backupId}});
  }
  let applied=task.applied||0,skipped=task.skipped||0;
  for(let i=task.processed;i<task.items.length;i++){
   const item=task.items[i];let found;
   try{found=(await chrome.bookmarks.get(item.id))[0];}catch(_){skipped++;}
   if(found){
    if(found.title===item.newTitle&&found.url===item.url)applied++;
    else if(found.title===item.oldTitle&&found.url===item.url&&String(found.parentId)===String(item.parentId)){
     // Validate scope again in case user moved the folder during execution.
     await chrome.bookmarks.update(item.id,{title:item.newTitle});applied++;
    }else skipped++;
   }
   task.processed=i+1;task.applied=applied;task.skipped=skipped;
   await STORAGE().set({[R_APPLY]:task});
   await renameState({status:'applying',completed:task.processed,total:task.items.length,message:`修改标题中 · ${task.processed}/${task.items.length}`});
  }
  const journal=(await STORAGE().get(R_UNDO))[R_UNDO];
  await STORAGE().set({[R_UNDO]:{...journal,status:'completed',processed:task.items.length,updatedAt:Date.now()}});
  await STORAGE().remove(R_APPLY);
  await renameState({status:'applied',completed:task.items.length,total:task.items.length,message:`命名完成 · ${applied} 条已更新${skipped?`，${skipped} 条因变动跳过`:''}`,error:''});
  await chrome.alarms.clear(R_ALARM);
 }catch(err){
  await renameState({status:'error',error:String(err.message||err),message:'命名操作中断，请先检查备份与撤销记录'});
  await chrome.alarms.clear(R_ALARM).catch(()=>{});
 }finally{renameApplyBusy=false;}
}
async function undoRenames(){
 forbidOtherWork();
 const saved=await STORAGE().get([R_UNDO,R_APPLY,R_STATE]);
 if(saved[R_APPLY]){
  if(saved[R_STATE]?.status==='error')await STORAGE().remove(R_APPLY);
  else throw Error('上次命名仍在执行，请先完成');
 }
 const journal=saved[R_UNDO];if(!journal?.items?.length)throw Error('没有可撤销的命名记录');
 renameApplyBusy=true;
 try{
  await renameState({status:'undoing',completed:0,total:journal.items.length,message:'正在恢复之前的书签标题…',error:''});
  let restored=0,skipped=0;
  for(const item of journal.items){
   let old;try{old=(await chrome.bookmarks.get(item.id))[0];}catch(_){skipped++;continue;}
   if(old?.url!==item.url || old.title!==item.newTitle){skipped++;continue;}
   await chrome.bookmarks.update(item.id,{title:item.oldTitle});restored++;
  }
  await STORAGE().remove([R_UNDO,R_PLAN]);
  await renameState({status:'idle',completed:0,total:0,message:`已恢复 ${restored} 条标题${skipped?`，${skipped} 条因后续修改跳过`:''}`,error:''});
  return {restored,skipped};
 }finally{renameApplyBusy=false;}
}

importScripts('organize-background.js');

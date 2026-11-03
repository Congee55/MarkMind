/* MarkMind 3.4 — background natural-language bookmark moving (scope locked) */
'use strict';
const O=self.MarkMindOrganize;
const ORG_JOB='organizeJob', ORG_STATE='organizeState', ORG_PLAN='organizePlan', ORG_APPLY='organizeApply', ORG_UNDO='organizeUndo', ORG_ALARM='markmind-organize';
let orgRunBusy=false, orgApplyBusy=false;
let orgAbort=null, orgCancelled=false;
const orgInMemoryBusy=()=>orgRunBusy||orgApplyBusy;
async function orgSetState(delta){
 const old=(await STORAGE().get(ORG_STATE))[ORG_STATE]||{status:'idle'};
 const fresh={...old,...delta,updatedAt:Date.now()};await STORAGE().set({[ORG_STATE]:fresh});return fresh;
}
async function orgForbidOtherTasks(){
 if(orgInMemoryBusy()||running||backupBusy||namingBusy||renameApplyBusy)throw Error('其他任务仍在进行');
 const saved=await STORAGE().get([JOB,R_JOB,R_APPLY,ORG_JOB,ORG_APPLY,'backupTask']);
 if(saved[JOB]||saved[R_JOB]||saved[R_APPLY]||saved[ORG_JOB]||saved[ORG_APPLY]||saved.backupTask?.status==='running')throw Error('仍有未完成的后台任务，请先处理');
}
async function orgAsk(batch,prefs,task,attempt=0){
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),80000);
 orgAbort=ctrl;
 try{
  const parsed=await AI.chatJSON(prefs,{
   system:"你是精确的书签筛选助手。请根据用户指令判断给出的每条书签是否直接属于需要移动到目标子文件夹的主题。只有明确相关才给 move=true；泛泛相关、无法推断、仅看原目录相关时给 move=false。依据仅限网址、标题、原路径，不可编造网页内容。不要对任何书签改名、改 URL 或创建目录。confidence 为 0 到 1 的小数，reason 是简短中文。对每个 id 给出结果，不可添加新 id。严格返回 JSON：{\"items\":[{\"id\":\"123\",\"move\":true,\"confidence\":0.92,\"reason\":\"打字练习网站\"}]}，不要输出其他内容。",
   user:{instruction:task.instruction,targetFolder:task.targetName,parentFolder:task.parentTitle,rule:'只判断这些已锁定来源书签是否符合目标主题，不可扩展任何范围',bookmarks:batch.map(b=>({id:b.id,title:b.title.slice(0,160),url:b.url.slice(0,420),path:b.path.slice(0,170)}))},
   max_tokens:5200,temperature:0.1,signal:ctrl.signal
  }).catch(async err=>{
   if(!orgCancelled&&[429,500,502,503,504].includes(err.status)&&attempt<2){await pause(1800*(attempt+1));if(orgCancelled)throw Error("用户已取消");return orgAsk(batch,prefs,task,attempt+1);}
   throw err;
  });
  if(Array.isArray(parsed))return parsed;
  if(!Array.isArray(parsed.items))throw Error('AI 筛选格式不正确');
  const ids=new Set(batch.map(b=>String(b.id)));
  return parsed.items.filter(x=>ids.has(String(x.id)));
 }finally{clearTimeout(timeout);if(orgAbort===ctrl)orgAbort=null;}
}
async function orgStart(scope,targetParentId,targetName,instruction){
 await orgForbidOtherTasks();
 const prefs=await STORAGE().get(AI.keys);
 if(!AI.hasKey(prefs))throw Error('请先在设置中配置 AI 接口');
 if(!instruction||String(instruction).trim().length<5)throw Error('请明确描述希望移动哪一类书签');
 const name=O.safeFolderName(targetName);
 if(!name)throw Error('请输入有效的子文件夹名称（最多 24 字）');
 const scan=E.scan(await chrome.bookmarks.getTree());
 const parent=scan.folders.find(f=>String(f.id)===String(targetParentId));
 if(!parent)throw Error('请选择有效的目标父文件夹');
 if(!scope||!Array.isArray(scope.folderIds)||!Array.isArray(scope.bookmarkIds))throw Error('请选择来源文件夹或书签');
 if(scope.folderIds.some(id=>!scan.folders.some(f=>String(f.id)===String(id)))||scope.bookmarkIds.some(id=>!scan.bookmarks.some(b=>String(b.id)===String(id))))throw Error('操作范围发生变化，请重新选择');
 let bookmarks=O.scopedBookmarks(scan,scope);
 // Natural-language folder references only narrow the already selected scope.
 // Never let a prompt add sources beyond explicit user selection.
 const mentioned=O.inferFolder(instruction,scan.folders.filter(f=>f.title!==name));
 let narrowedId=mentioned.folderId;
 if(mentioned.ambiguous){
  const chosen=mentioned.candidates.filter(f=>scope.folderIds.map(String).includes(String(f.id)));
  if(chosen.length!==1)throw Error('指令提到多个同名目录，请明确只选择一个来源文件夹');
  narrowedId=chosen[0].id;
 }
 if(narrowedId){
  bookmarks=bookmarks.filter(b=>O.isWithinFolder(b,narrowedId,scan.folders));
  if(!bookmarks.length)throw Error('指令所指文件夹不在当前选择范围内；请调整来源');
 }
 if(!bookmarks.length)throw Error('所选范围没有书签');
 if(bookmarks.length>1600)throw Error('单次最多处理 1600 条书签，请缩小范围');
 const job={version:1,createdAt:Date.now(),scope:{folderIds:scope.folderIds.map(String),bookmarkIds:scope.bookmarkIds.map(String)},parentId:String(parent.id),parentTitle:parent.title,targetName:name,instruction:String(instruction).trim().slice(0,450),bookmarks,raw:[],next:0,batchSize:24};
 orgCancelled=false;
 await STORAGE().set({[ORG_JOB]:job});await STORAGE().remove(ORG_PLAN);
 await orgSetState({status:'running',message:'正在准备 AI 整理建议',total:bookmarks.length,completed:0,error:''});
 await chrome.alarms.create(ORG_ALARM,{periodInMinutes:1});void orgPump();
 return {status:'started',total:bookmarks.length};
}
async function orgPump(){
 if(orgInMemoryBusy()||running||backupBusy||namingBusy||renameApplyBusy)return;
 orgRunBusy=true;
 try{
  const job=(await STORAGE().get(ORG_JOB))[ORG_JOB];if(!job)return;
  const prefs=await STORAGE().get(AI.keys);
  if(!AI.hasKey(prefs))throw Error('AI API Key 不可用');
  while(job.next<job.bookmarks.length){
   if(orgCancelled || !(await STORAGE().get(ORG_JOB))[ORG_JOB])return;
   await orgSetState({status:'running',message:`正在判断 ${job.next}/${job.bookmarks.length} 条`,total:job.bookmarks.length,completed:job.next,error:''});
   const answers=await orgAsk(job.bookmarks.slice(job.next,job.next+job.batchSize),prefs,job);
   if(orgCancelled || (await STORAGE().get(ORG_STATE))[ORG_STATE]?.status!=='running')return;
   job.raw.push(...answers);job.next=Math.min(job.bookmarks.length,job.next+job.batchSize);
   await STORAGE().set({[ORG_JOB]:job});
   await orgSetState({completed:job.next,message:`已分析 ${job.next}/${job.bookmarks.length} 条`});
  }
  if(orgCancelled || (await STORAGE().get(ORG_STATE))[ORG_STATE]?.status!=='running')return;
  const plan=O.makePlan(job.bookmarks,job.raw,job.scope,job.parentId,job.targetName,job.instruction);
  await STORAGE().set({[ORG_PLAN]:plan});await STORAGE().remove(ORG_JOB);
  await orgSetState({status:'completed',completed:plan.items.length,total:plan.items.length,message:`已筛出 ${plan.items.filter(i=>i.selected).length} 条相关书签，请检查移动方案`,error:''});
  await chrome.alarms.clear(ORG_ALARM);
 }catch(e){if(orgCancelled)return;await orgSetState({status:'error',error:e?.name==='AbortError'?'请求超时':String(e.message||e),message:'AI 整理中断，进度已保存'}).catch(()=>{});await chrome.alarms.clear(ORG_ALARM).catch(()=>{});}
 finally{
  if(orgCancelled){await STORAGE().remove([ORG_JOB,ORG_PLAN]).catch(()=>{});await orgSetState({status:'idle',message:'已取消 AI 整理分析',completed:0,total:0,error:''}).catch(()=>{});}
  orgRunBusy=false;orgAbort=null;
 }
}
async function orgResume(){
 const data=await STORAGE().get([ORG_JOB,ORG_APPLY,ORG_STATE]);
 if(data[ORG_APPLY]){if(data[ORG_STATE]?.status!=='error')void orgPumpApply();return;}
 if(data[ORG_JOB]&&data[ORG_STATE]?.status!=='error'){await chrome.alarms.create(ORG_ALARM,{periodInMinutes:1});void orgPump();}
}
async function orgApplyStart(){
 await orgForbidOtherTasksForApply();
 const data=await STORAGE().get([ORG_PLAN,ORG_JOB,ORG_APPLY,'backupEnabled']);
 if(data[ORG_JOB]||data[ORG_APPLY])throw Error('整理分析仍在进行');
 const scan=E.scan(await chrome.bookmarks.getTree());
 const validated=O.validate(data[ORG_PLAN],scan);
 if(!validated.items.length)throw Error('没有可移动的书签，请检查筛选结果');
 const journal={version:1,status:'running',createdAt:Date.now(),targetParentId:String(validated.parent.id),targetName:validated.targetName,items:validated.items,processed:0,destId:'',createdTarget:false,backupId:'',moved:0,skipped:0};
 await STORAGE().set({[ORG_UNDO]:journal,[ORG_APPLY]:{...journal,backupEnabled:data.backupEnabled!==false}});
 await orgSetState({status:'applying',completed:0,total:validated.items.length,message:'准备备份并移动书签',error:''});
 await chrome.alarms.create(ORG_ALARM,{periodInMinutes:1});void orgPumpApply();
 return {status:'started',count:validated.items.length};
}
async function orgForbidOtherTasksForApply(){
 if(orgInMemoryBusy()||running||backupBusy||namingBusy||renameApplyBusy)throw Error('其他任务正在进行');
 const data=await STORAGE().get([JOB,R_JOB,R_APPLY,ORG_JOB,ORG_APPLY]);
 if(data[JOB]||data[R_JOB]||data[R_APPLY]||data[ORG_JOB]||data[ORG_APPLY])throw Error('请先完成其他后台任务');
}
async function orgPumpApply(){
 if(orgInMemoryBusy()||running||backupBusy||namingBusy||renameApplyBusy)return;
 orgApplyBusy=true;
 try{
  const task=(await STORAGE().get(ORG_APPLY))[ORG_APPLY];if(!task)return;
  if(task.backupEnabled && !task.backupId){
   await orgSetState({status:'applying',message:'正在创建完整备份…'});
   const b=await B.create(await chrome.bookmarks.getTree());task.backupId=String(b.id);await STORAGE().set({[ORG_APPLY]:task});
  }
  let parent;try{parent=(await chrome.bookmarks.get(task.targetParentId))[0];}catch(_){}
  if(!parent || parent.url)throw Error('目标父文件夹已经不存在，请先检查书签');
  if(!task.destId){
   const existing=(await chrome.bookmarks.getChildren(parent.id)).find(n=>!n.url && n.title===task.targetName);
   if(existing){task.destId=String(existing.id);task.createdTarget=false;}
   else {const created=await chrome.bookmarks.create({parentId:parent.id,title:task.targetName});task.destId=String(created.id);task.createdTarget=true;}
   await STORAGE().set({[ORG_APPLY]:task});
  }
  // Save destination before moving: undo journal remains usable after service-worker shutdown.
  await STORAGE().set({[ORG_UNDO]:{...task,status:'running'}});
  for(let i=task.processed;i<task.items.length;i++){
   const item=task.items[i]; let fresh;
   try{fresh=(await chrome.bookmarks.get(item.id))[0];}catch(_){}
   if(fresh?.url===item.url && String(fresh.parentId)===String(task.destId))task.moved++;
   else if(fresh?.url===item.url && String(fresh.parentId)===String(item.parentId) && fresh.title===item.title){
    await chrome.bookmarks.move(item.id,{parentId:task.destId});task.moved++;
   }else task.skipped++;
   task.processed=i+1;
   await STORAGE().set({[ORG_APPLY]:task,[ORG_UNDO]:{...task,status:'running'}});
   await orgSetState({status:'applying',completed:task.processed,total:task.items.length,message:`移动中 ${task.processed}/${task.items.length}`});
  }
  await STORAGE().set({[ORG_UNDO]:{...task,status:'completed'}});
  await STORAGE().remove(ORG_APPLY);
  await orgSetState({status:'applied',completed:task.items.length,total:task.items.length,message:`完成：移动 ${task.moved} 条，跳过 ${task.skipped} 条`,error:''});
  await chrome.alarms.clear(ORG_ALARM);
 }catch(e){await orgSetState({status:'error',error:String(e.message||e),message:'移动中断；请检查备份并撤销'}).catch(()=>{});await chrome.alarms.clear(ORG_ALARM).catch(()=>{});}
 finally{orgApplyBusy=false;}
}
async function orgUndo(){
 if(orgInMemoryBusy()||running||backupBusy||namingBusy||renameApplyBusy)throw Error('其他任务仍在进行');
 const data=await STORAGE().get([ORG_UNDO,ORG_APPLY]);
 const journal=data[ORG_UNDO];if(!journal?.items?.length)throw Error('没有可撤销的整理记录');
 if(data[ORG_APPLY])throw Error('正在进行的移动任务尚未结束，请先检查后台任务');
 orgApplyBusy=true;
 try{
  await orgSetState({status:'undoing',message:'正在恢复原始位置…',completed:0,total:journal.items.length,error:''});
  let restored=0,skipped=0;
  // Moving back in original index order reduces order drift.
  const items=journal.items.slice().sort((a,b)=>a.index-b.index);
  for(let i=0;i<items.length;i++){
   const item=items[i];let fresh;
   try{fresh=(await chrome.bookmarks.get(item.id))[0];}catch(_){}
   if(fresh?.url===item.url && String(fresh.parentId)===String(journal.destId)){
    const source=(await chrome.bookmarks.get(item.parentId).catch(()=>[]))[0];
    if(source && !source.url){await chrome.bookmarks.move(item.id,{parentId:item.parentId,index:item.index});restored++;}else skipped++;
   }else skipped++;
   await orgSetState({completed:i+1,message:`正在恢复 ${i+1}/${items.length}`});
  }
  if(journal.createdTarget&&journal.destId){
   try{if(!(await chrome.bookmarks.getChildren(journal.destId)).length)await chrome.bookmarks.remove(journal.destId);}catch(_){}
  }
  await STORAGE().remove([ORG_UNDO,ORG_PLAN]);
  await orgSetState({status:'idle',completed:0,total:0,message:`已恢复 ${restored} 条，跳过 ${skipped} 条`,error:''});
  return {restored,skipped};
 }finally{orgApplyBusy=false;}
}

async function orgCancelAnalysis(){
 if(orgApplyBusy || (await STORAGE().get(ORG_APPLY))[ORG_APPLY])throw Error('正在实际移动书签，不能取消。可在完成后撤销移动');
 orgCancelled=true;
 if(orgAbort)orgAbort.abort();
 await chrome.alarms.clear(ORG_ALARM);
 await STORAGE().remove([ORG_JOB,ORG_PLAN]);
 await orgSetState({status:'idle',message:'已取消 AI 整理分析',completed:0,total:0,error:''});
 return {status:'cancelled'};
}

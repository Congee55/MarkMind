/* On-demand semantic expansion: explicit consent via button, limited bookmark metadata only.
   Never changes bookmarks. Checkpoints survive popup close and MV3 worker suspension. */
const SEM_TASK='semanticSearchTask', SEM_CACHE='semanticSearchCache', SEM_ALARM='markmind-semantic-search';
let semBusy=false, semAbort=null, semCancelled=false;
const semQuery=q=>String(q||'').trim().replace(/\s+/g,' ').slice(0,90);
async function semStart(query){
 query=semQuery(query);
 if(query.length<2)throw Error('请至少输入两个字描述网站功能');
 const current=(await STORAGE().get(SEM_TASK))[SEM_TASK];
 if(current?.status==='running'){
  if(current.query===query)return {status:'running',query};
  throw Error('已有其他印象搜索正在进行，请完成后重试');
 }
 if(semBusy)throw Error("上次 AI 搜索正在结束，请稍后再试");
 semCancelled=false;
 const prefs=await STORAGE().get(AI.keys);
 if(!AI.hasKey(prefs))throw Error('请先到设置中配置 AI 接口密钥');
 const fingerprint=AI.config(prefs).provider+':'+AI.config(prefs).model;
 const saved=(await STORAGE().get(SEM_CACHE))[SEM_CACHE]||{};
 const scan=E.scan(await chrome.bookmarks.getTree());
 let hash=2166136261;
 for(const b of scan.bookmarks){for(const c of String(b.id)+'|'+String(b.title)+'|'+String(b.url)+';'){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619)>>>0;}}
 const cacheKey=query.toLocaleLowerCase()+'|'+fingerprint+'|'+hash.toString(36);
 if(saved[cacheKey]&&Date.now()-saved[cacheKey].createdAt<7*86400*1000){
  const result={status:'completed',query,total:saved[cacheKey].total||0,done:saved[cacheKey].total||0,hits:saved[cacheKey].hits||[],fromCache:true,updatedAt:Date.now()};
  await STORAGE().set({[SEM_TASK]:result});
  return {status:'completed',cached:true};
 }
 const insights=(await STORAGE().get('bookmarkInsights')).bookmarkInsights||{};
 const list=scan.bookmarks.slice(0,800).map(b=>({id:b.id,title:String(b.title||'').slice(0,120),domain:b.domain,path:String(b.path||'').slice(0,110),url:String(b.url||'').slice(0,220),insight:String(insights[b.id]||'').slice(0,80)}));
 const task={status:'running',query,total:list.length,done:0,next:0,bookmarks:list,hits:[],createdAt:Date.now(),updatedAt:Date.now(),fingerprint,cacheKey,error:'',truncated:scan.bookmarks.length>800};
 await STORAGE().set({[SEM_TASK]:task});
 chrome.alarms.create(SEM_ALARM,{delayInMinutes:1,periodInMinutes:1});
 void semPump();return {status:'started',total:list.length,truncated:task.truncated};
}
async function semPump(){
 if(semBusy)return;semBusy=true;
 try{
  let task=(await STORAGE().get(SEM_TASK))[SEM_TASK];if(!task||task.status!=='running')return;
  const prefs=await STORAGE().get(AI.keys);
  if(!AI.hasKey(prefs))throw Error('AI 密钥不可用，请重新配置');
  while(task.next<task.bookmarks.length){
   if(semCancelled || (await STORAGE().get(SEM_TASK))[SEM_TASK]?.status!=='running')return;
   const batch=task.bookmarks.slice(task.next,task.next+35);
   const controller=new AbortController();semAbort=controller;
   const raw=await AI.chatJSON(prefs,{
    system:'你是谨慎的中文书签用途检索器。用户只记得网站能做什么，你要找出用途一致的站点，允许标题不同。只能根据标题、域名、网址与既有分类线索推断，不要声称阅读了网页正文。把模糊相关、未知、仅同文件夹的条目标记 match=false。只返回 JSON：{"items":[{"id":"123","match":true,"confidence":0.86,"reason":"提供PDF格式转换"}]}。必须为每条输入 ID 输出一项。绝不添加不存在的 ID。',
    user:{query:task.query,bookmarks:batch},temperature:0.1,max_tokens:3200,signal:controller.signal
   });
   if(semCancelled || (await STORAGE().get(SEM_TASK))[SEM_TASK]?.status!=='running')return;
   semAbort=null;
   if(!Array.isArray(raw?.items))throw Error('AI 检索结果格式错误');
   const allowed=new Set(batch.map(x=>String(x.id)));
   for(const x of raw.items){
    const id=String(x?.id||''),confidence=Number(x?.confidence)||0;
    if(allowed.has(id)&&x.match===true&&confidence>=0.65&&!task.hits.some(h=>h.id===id)){
     task.hits.push({id,confidence:Math.min(1,confidence),reason:String(x.reason||'AI 识别功能匹配').slice(0,70)});
    }
   }
   task.next+=batch.length;task.done=task.next;task.updatedAt=Date.now();
   await STORAGE().set({[SEM_TASK]:task});
  }
  if(semCancelled || (await STORAGE().get(SEM_TASK))[SEM_TASK]?.status!=='running')return;
  task.status='completed';task.updatedAt=Date.now();delete task.bookmarks;
  const cache=(await STORAGE().get(SEM_CACHE))[SEM_CACHE]||{};
  cache[task.cacheKey]={createdAt:Date.now(),hits:task.hits,total:task.total};
  const keys=Object.keys(cache).sort((a,b)=>cache[b].createdAt-cache[a].createdAt);
  for(const key of keys.slice(8))delete cache[key];
  await STORAGE().set({[SEM_CACHE]:cache,[SEM_TASK]:task});
  await chrome.alarms.clear(SEM_ALARM);
 }catch(error){
  if(semCancelled)return;
  const task=(await STORAGE().get(SEM_TASK))[SEM_TASK];
  if(task){task.status='error';task.error=String(error.message||error);task.updatedAt=Date.now();await STORAGE().set({[SEM_TASK]:task});}
  await chrome.alarms.clear(SEM_ALARM).catch(()=>{});
 }finally{
  if(semCancelled)await STORAGE().remove(SEM_TASK).catch(()=>{});
  semBusy=false;semAbort=null;
 }
}
async function semResume(){const task=(await STORAGE().get(SEM_TASK))[SEM_TASK];if(task?.status==='running')void semPump();}
chrome.alarms.onAlarm.addListener(a=>{if(a.name===SEM_ALARM)void semResume();});
chrome.runtime.onStartup.addListener(()=>{void semResume();});
chrome.runtime.onInstalled.addListener(()=>{void semResume();});

async function semCancel(){
 semCancelled=true;
 if(semAbort)semAbort.abort();
 await chrome.alarms.clear(SEM_ALARM);
 await STORAGE().remove(SEM_TASK);
 return {status:'cancelled'};
}

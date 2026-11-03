/* MV3 service worker task: read-only checks, durable checkpoints, alarm resume. */
const DL_KEY='deadLinkScan', DL_ALARM='markmind-deadlinks-resume';
let dlBusy=false;
async function dlRead(){return (await chrome.storage.local.get(DL_KEY))[DL_KEY]||null;}
async function dlWrite(state){await chrome.storage.local.set({[DL_KEY]:state});}
async function dlStart(){
 const prev=await dlRead();
 if(dlBusy||prev?.status==='running')return {status:'running'};
 const items=self.MarkMindEngine.scan(await chrome.bookmarks.getTree()).bookmarks.map(b=>({id:b.id,title:b.title,url:b.url,path:b.path}));
 const checkable=items.filter(b=>self.MarkMindDeadLinks.checkable(b.url));
 const skipped=items.length-checkable.length;
 const state={status:'running',createdAt:Date.now(),updatedAt:Date.now(),total:items.length,done:skipped,skipped,checked:0,dead:0,unknown:0,alive:0,next:0,queue:checkable,results:[],error:''};
 await dlWrite(state);
 await chrome.alarms.create(DL_ALARM,{delayInMinutes:1,periodInMinutes:1});
 void dlPump();return {status:'started',total:items.length};
}
async function dlPump(){
 if(dlBusy)return;
 dlBusy=true;
 try{
  let s=await dlRead();if(!s||s.status!=='running')return;
  while(s.next<s.queue.length){
   const batch=s.queue.slice(s.next,s.next+3);
   const checked=await Promise.all(batch.map(async b=>{
    try{return {...b,...await self.MarkMindDeadLinks.probe(b.url)};}
    catch(e){return {...b,status:'unknown',reason:'检测失败，需人工核实'};}
   }));
   for(const item of checked){
    s.results.push(item);
    if(item.status==='dead')s.dead++;
    else if(item.status==='alive')s.alive++;
    else if(item.status==='skipped')s.skipped++;
    else s.unknown++;
   }
   s.next+=batch.length;s.checked+=batch.length;s.done+=batch.length;s.updatedAt=Date.now();
   await dlWrite(s); // one checkpoint after every 3 URLs
  }
  s.status='completed';s.updatedAt=Date.now();await dlWrite(s);
  await chrome.alarms.clear(DL_ALARM);
 }catch(e){
  const s=await dlRead();if(s){s.status='error';s.error=String(e?.message||e);await dlWrite(s);}
  await chrome.alarms.clear(DL_ALARM);
 }finally{dlBusy=false;}
}
async function dlResume(){const s=await dlRead();if(s?.status==='running')void dlPump();}
chrome.alarms.onAlarm.addListener(a=>{if(a.name===DL_ALARM)void dlResume();});
chrome.runtime.onStartup.addListener(()=>{void dlResume();});
chrome.runtime.onInstalled.addListener(()=>{void dlResume();});

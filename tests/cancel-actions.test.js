'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const nodes=new Map(),store={deepseekKey:'sk-test',model:'deepseek-chat',backupEnabled:false};
const add=(id,title,parentId,url)=>{const x={id:String(id),title,parentId:parentId==null?undefined:String(parentId),index:0};if(url)x.url=url;nodes.set(x.id,x);};
add('0','',null);add('1','书签栏','0');add('2','其他书签','0');add('3','移动书签','0');
add('10','科研','1');add('11','学习','1');add('101','Nature','10','https://nature.com');add('102','TypingClub 打字','11','https://typingclub.com');
const tree=()=>{const m=new Map([...nodes.values()].map(x=>[x.id,{...x,...(x.url?{}:{children:[]})}]));for(const x of m.values())if(x.parentId)m.get(x.parentId).children.push(x);return [m.get('0')];};
const storage={async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(x=>[x,store[x]]));},async set(x){Object.assign(store,x);},async remove(keys){for(const x of Array.isArray(keys)?keys:[keys])delete store[x];}};
const listeners={};const chrome={storage:{local:storage},bookmarks:{getTree:async()=>tree(),get:async id=>[{...nodes.get(String(id))}]},alarms:{create(){},clear:async()=>true,onAlarm:{addListener:f=>listeners.alarm=f}},runtime:{onMessage:{addListener:f=>listeners.message=f},onStartup:{addListener(){}},onInstalled:{addListener(){}}}};
let requests=[];const context=vm.createContext({chrome,self:null,globalThis:null,URL,AbortController,clearTimeout,setTimeout,console,fetch:(_url,{signal})=>{
  requests.push(signal);
  return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})),{once:true}));
}});context.self=context;context.globalThis=context;
context.importScripts=(...names)=>{for(const n of names)vm.runInContext(fs.readFileSync(path.join(base,n),'utf8'),context,{filename:n});};
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),context,{filename:'background.js'});
const send=m=>new Promise((resolve,reject)=>{listeners.message(m,null,resolve);setTimeout(()=>reject(Error('timeout')),1000);});
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('timed out')};
(async()=>{
 let prior=0;
 // 1. classify: cancellation aborts the live network request and does not save a plan.
 assert.equal((await send({type:'startAnalysis'})).ok,true);
 await wait(()=>requests.length>prior);let signal=requests.at(-1);assert.equal(signal.aborted,false);
 assert.equal((await send({type:'cancelAnalysis'})).ok,true);
 await wait(()=>!vm.runInContext('running',context));assert.equal(signal.aborted,true);
 assert.equal(store.analysisState.status,'idle');assert.equal(store.analysisPlan,undefined);assert.equal(store.analysisJob,undefined);
 // 2. semantic expansion: remove its checkpoint and prevent its late AI response.
 prior=requests.length;assert.equal((await send({type:'startSemanticSearch',query:'PDF 转换'})).ok,true);
 await wait(()=>requests.length>prior);signal=requests.at(-1);
 assert.equal((await send({type:'cancelSemanticSearch'})).ok,true);
 await wait(()=>!vm.runInContext('semBusy',context));assert.equal(signal.aborted,true);assert.equal(store.semanticSearchTask,undefined);
 // 3. scoped title task: cancellation does not apply title changes.
 prior=requests.length;assert.equal((await send({type:'startRename',scope:{mode:'folder',folderId:'10',bookmarkIds:['101']},instruction:'优化标题'})).ok,true);
 await wait(()=>requests.length>prior);signal=requests.at(-1);
 assert.equal((await send({type:'cancelRename'})).ok,true);
 await wait(()=>!vm.runInContext('namingBusy',context));assert.equal(signal.aborted,true);
 assert.equal(store.renamePlan,undefined);assert.equal(store.renameJob,undefined);assert.equal(nodes.get('101').title,'Nature');
 // 4. scoped move suggestion: cancel without creating a folder or moving bookmarks.
 prior=requests.length;assert.equal((await send({type:'startOrganize',scope:{folderIds:['11'],bookmarkIds:[]},parentId:'11',targetName:'打字',instruction:'把学习文件夹里和打字相关的书签放进打字文件夹'})).ok,true);
 await wait(()=>requests.length>prior);signal=requests.at(-1);
 assert.equal((await send({type:'cancelOrganize'})).ok,true);
 await wait(()=>!vm.runInContext('orgRunBusy',context));assert.equal(signal.aborted,true);
 assert.equal(store.organizeJob,undefined);assert.equal(store.organizePlan,undefined);assert.equal(nodes.get('102').parentId,'11');
 // 5. discard saved completed plan, without affecting bookmark nodes.
 store.analysisPlan={items:[{id:'101',category:'科研'}]};store.analysisState={status:'completed'};store.bookmarkInsights={'101':'科研'};
 assert.equal((await send({type:'cancelAnalysis'})).ok,true);
 assert.equal(store.analysisPlan,undefined);assert.equal(store.bookmarkInsights,undefined);assert.equal(nodes.get('101').title,'Nature');
 console.log('PASS: running classification, semantic search, rename, organize cancel; completed plan discard; no bookmark mutation');
})().catch(e=>{console.error(e);process.exitCode=1});

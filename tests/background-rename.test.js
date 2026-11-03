'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const nodes=new Map();
const add=(id,title,parentId,url)=>{const n={id:String(id),title,parentId:parentId?String(parentId):undefined,index:0};if(url)n.url=url;nodes.set(n.id,n);return n;};
add('0','',null);add('1','书签栏','0');add('2','其他书签','0');add('3','移动书签','0');
add('10','科研','1');add('11','期刊','10');add('20','AI','1');
add('101','Home | Microbiome','11','https://microbiomejournal.biomedcentral.com');
add('102','Home | ResearchGate','10','https://www.researchgate.net');
add('201','Home | ChatGPT','20','https://chatgpt.com');
const getTree=()=>{
 const copies=new Map([...nodes.values()].map(n=>[n.id,{...n,...(n.url?{}:{children:[]})}]));
 for(const n of copies.values()){if(n.parentId&&copies.has(n.parentId))copies.get(n.parentId).children.push(n);}
 return [copies.get('0')];
};
const kv={deepseekKey:'sk-test',model:'deepseek-chat',backupEnabled:false};
const changes=[];
const local={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,kv[k]])),set:async obj=>{Object.assign(kv,obj);changes.push(obj);},remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete kv[k]}};
const listeners={};
const chrome={storage:{local},bookmarks:{getTree:async()=>getTree(),get:async id=>{const n=nodes.get(String(id));if(!n)throw Error('not found');return [{...n}];},update:async(id,v)=>{const n=nodes.get(String(id));if(!n)throw Error('not found');Object.assign(n,v);return {...n};}},alarms:{create:()=>{},clear:async()=>true,onAlarm:{addListener:f=>listeners.alarm=f}},runtime:{onMessage:{addListener:f=>listeners.message=f},onStartup:{addListener:f=>listeners.startup=f},onInstalled:{addListener:f=>listeners.installed=f}}};
const context=vm.createContext({self:null,globalThis:null,chrome,URL,AbortController,setTimeout,clearTimeout,console,
 fetch:async(url,{body})=>{const data=JSON.parse(body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({items:[
  ...data.messages[1].content&&JSON.parse(data.messages[1].content).bookmarks.map(b=>({id:b.id,title:`优化-${b.title}`,reason:'去除多余前缀'})),
  {id:'201',title:'越界改名',reason:'恶意越界结果'}
 ]})}}]})};}});
context.self=context;context.globalThis=context;
context.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(base,name),'utf8'),context,{filename:name});};
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),context,{filename:'background.js'});
async function send(data){return await new Promise((resolve,reject)=>{listeners.message(data,null,x=>resolve(x));setTimeout(()=>reject(new Error('message timeout')),1000);});}
async function wait(predicate,limit=50){for(let i=0;i<limit;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out waiting for state');}
(async()=>{
 const request={type:'startRename',scope:{mode:'folder',folderId:'10',bookmarkIds:['101','102']},instruction:'帮我优化科研文件夹下面的书签名称，不要动其他文件夹'};
 const started=await send(request);assert.equal(started.ok,true);
 await wait(()=>kv.renameState?.status==='completed').catch(e=>{console.log('debug state',kv.renameState);throw e;});
 assert.deepEqual(Array.from(kv.renamePlan.items,x=>String(x.id)),['101','102']);
 assert.equal(kv.renamePlan.items.every(x=>x.selected),true);
 assert.equal(nodes.get('201').title,'Home | ChatGPT');
 const applied=await send({type:'applyRename'});assert.equal(applied.ok,true);
 await wait(()=>kv.renameState?.status==='applied');
 assert.equal(nodes.get('201').title,'Home | ChatGPT');
 assert.equal(nodes.get('101').title,'优化-Home | Microbiome');
 assert.equal(nodes.get('102').title,'优化-Home | ResearchGate');
 assert.equal(nodes.get('101').parentId,'11');
 assert.equal(nodes.get('102').parentId,'10');
 const undone=await send({type:'undoRename'});assert.equal(undone.ok,true);assert.equal(undone.restored,2);
 assert.equal(nodes.get('101').title,'Home | Microbiome');
 assert.equal(nodes.get('102').title,'Home | ResearchGate');
 assert.equal(nodes.get('201').title,'Home | ChatGPT');
 console.log('PASS: background rename plan, out-of-scope AI response ignored, apply titles only, original folders intact, undo titles');
})().catch(e=>{console.error(e);process.exitCode=1});

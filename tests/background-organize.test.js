'use strict';
const assert=require('node:assert/strict');const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const nodes=new Map();let seq=300;
const add=(id,title,parentId,url)=>{const n={id:String(id),title,parentId:parentId==null?undefined:String(parentId),index:0};if(url)n.url=url;nodes.set(n.id,n);return n;};
add('0','',null);add('1','书签栏','0');add('2','其他书签','0');add('3','移动书签','0');
add('10','学习','1');add('11','课程','10');add('20','科研','1');
add('101','TypingClub 英文打字练习','11','https://www.typingclub.com');add('102','中文打字练习','10','https://www.typing.com');add('103','Coursera 在线课程','10','https://coursera.org');add('201','Nature','20','https://nature.com');
const tree=()=>{const cp=new Map([...nodes.values()].map(n=>[n.id,{...n,...(n.url?{}:{children:[]})}]));for(const n of cp.values())if(n.parentId)cp.get(n.parentId)?.children.push(n);return [cp.get('0')];};
const bookmarks={getTree:async()=>tree(),get:async id=>{const n=nodes.get(String(id));if(!n)throw Error('not found');return [{...n}];},getChildren:async id=>[...nodes.values()].filter(n=>n.parentId===String(id)).map(x=>({...x})),
 create:async ({parentId,title,url})=>{const id=String(++seq);return {...add(id,title,parentId,url)};},
 move:async(id,{parentId,index})=>{const n=nodes.get(String(id));if(!n)throw Error('not found');n.parentId=String(parentId);if(index!=null)n.index=index;return {...n};},
 update:async(id,{title})=>{const n=nodes.get(String(id));n.title=title;return {...n};},
 remove:async id=>{if([...nodes.values()].some(n=>n.parentId===String(id)))throw Error('not empty');nodes.delete(String(id));}};
const kv={deepseekKey:'sk-test',model:'deepseek-chat',backupEnabled:true};
const local={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,kv[k]])),set:async v=>Object.assign(kv,v),remove:async keys=>{for(const k of (Array.isArray(keys)?keys:[keys]))delete kv[k];}};
const listeners={};
const chrome={bookmarks,storage:{local},alarms:{create:()=>{},clear:async()=>true,onAlarm:{addListener:f=>listeners.alarm=f}},runtime:{onMessage:{addListener:f=>listeners.message=f},onStartup:{addListener:f=>listeners.startup=f},onInstalled:{addListener:f=>listeners.installed=f}}};
const context=vm.createContext({self:null,globalThis:null,chrome,URL,AbortController,setTimeout,clearTimeout,console,fetch:async(url,{body})=>{
 const b=JSON.parse(JSON.parse(body).messages[1].content).bookmarks;
 const decisions=b.map(row=>({id:row.id,move:/打字|TypingClub/i.test(row.title),confidence:.94,reason:'名称直接指向打字练习'}));
 decisions.push({id:'201',move:true,confidence:1,reason:'越界'});
 return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({items:decisions})}}]})};
}});context.self=context;context.globalThis=context;
context.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(base,name),'utf8'),context,{filename:name});};
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),context,{filename:'background.js'});
const send=m=>new Promise((resolve,reject)=>{listeners.message(m,null,x=>resolve(x));setTimeout(()=>reject(Error('timeout')),4000);});
const wait=async fn=>{for(let i=0;i<120;i++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error(`timeout state ${JSON.stringify(kv.organizeState)}`);};
(async()=>{
 const scope={folderIds:['10'],bookmarkIds:[]};
 const started=await send({type:'startOrganize',scope,parentId:'10',targetName:'打字',instruction:'新建一个打字子文件夹，把学习下面打字相关书签放进去'});
 assert.equal(started.ok,true);await wait(()=>kv.organizeState?.status==='completed');
 assert.equal(kv.organizePlan.items.filter(x=>x.selected).map(x=>x.id).join(','),'101,102');
 assert.equal(kv.organizePlan.items.some(x=>x.id==='201'),false);
 assert.equal(nodes.get('201').parentId,'20');
 const result=await send({type:'applyOrganize'});assert.equal(result.ok,true);
 await wait(()=>kv.organizeState?.status==='applied');
 const target=[...nodes.values()].find(n=>n.title==='打字'&&n.parentId==='10');assert(target);
 assert.equal(nodes.get('101').parentId,target.id);assert.equal(nodes.get('102').parentId,target.id);
 assert.equal(nodes.get('103').parentId,'10');assert.equal(nodes.get('201').parentId,'20');
 assert.equal(nodes.get('101').title,'TypingClub 英文打字练习');
 assert.equal(kv.organizeUndo.backupId!=='',true);
 const undone=await send({type:'undoOrganize'});assert.equal(undone.ok,true);
 assert.equal(undone.restored,2);
 assert.equal(nodes.get('101').parentId,'11');assert.equal(nodes.get('102').parentId,'10');
 assert.equal(nodes.has(target.id),false);
 const outside=await send({type:'startOrganize',scope:{folderIds:['20'],bookmarkIds:[]},parentId:'20',targetName:'打字',instruction:'在学习文件夹下面整理打字相关书签'});
 assert.equal(outside.ok,false);assert.match(outside.error,/不在当前选择范围/);
 const mixed=await send({type:'startOrganize',scope:{folderIds:['10','20'],bookmarkIds:[]},parentId:'10',targetName:'打字',instruction:'在学习文件夹下面新建一个打字子文件夹，只移动打字相关书签'});
 assert.equal(mixed.ok,true);await wait(()=>kv.organizeState?.status==='completed');
 assert.equal(kv.organizePlan.items.length,3);
 assert.equal(kv.organizePlan.items.some(x=>x.id==='201'),false);
 console.log('PASS: background AI filter, backup, target creation, selective move, unrelated folder unchanged, undo, scope conflict rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});

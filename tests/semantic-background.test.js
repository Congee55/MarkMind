'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('AI impression search validates IDs, persists checkpoint and reuses cache',async()=>{
 const store={apiProvider:'deepseek',deepseekKey:'sk-test',model:'deepseek-chat'};
 const listeners={};let requests=0;
 const nodes=[{id:'0',children:[{id:'1',title:'书签栏',parentId:'0',children:[
  {id:'11',title:'在线 PDF 工具',url:'https://pdf.example/convert',parentId:'1'},
  {id:'12',title:'视频剪辑',url:'https://video.example/edit',parentId:'1'}
 ]},{id:'2',title:'其他书签',parentId:'0',children:[]},{id:'3',title:'移动书签',parentId:'0',children:[]}]}];
 const storage={async get(k){let keys=Array.isArray(k)?k:[k];return Object.fromEntries(keys.map(x=>[x,store[x]]));},async set(o){Object.assign(store,o);},async remove(k){for(const x of Array.isArray(k)?k:[k])delete store[x];}};
 const chrome={storage:{local:storage},bookmarks:{getTree:async()=>nodes},alarms:{create(){},clear:async()=>true,onAlarm:{addListener:f=>listeners.alarm=f}},runtime:{onStartup:{addListener(){}},onInstalled:{addListener(){}}}};
 const A=require('../ai-client.js'),E=require('../engine.js');
 const ctx=vm.createContext({chrome,self:null,console,Date,AbortController,AI:{...A,async chatJSON(saved,options){requests++;return {items:[
  {id:'11',match:true,confidence:.97,reason:'PDF 转换功能'},
  {id:'12',match:false,confidence:.03,reason:'视频'},
  {id:'999',match:true,confidence:1,reason:'越界假结果'}
  ]};}},E,STORAGE:()=>chrome.storage.local});ctx.self=ctx;
 // The top-level const AI/E bindings are provided by the service worker; mirror in VM context.
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../semantic-search-background.js'),'utf8'),ctx);
 let res=await ctx.semStart('PDF 转换');assert.equal(res.status,'started');
 for(let i=0;i<40&&store.semanticSearchTask.status!=='completed';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(store.semanticSearchTask.status,'completed');
 assert.equal(Array.from(store.semanticSearchTask.hits,x=>x.id).join(','),'11');
 assert.equal(requests,1);
 res=await ctx.semStart('PDF 转换');assert.equal(res.cached,true);assert.equal(requests,1);
});

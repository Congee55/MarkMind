'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const E=require('../engine.js'),D=require('../dead-links.js');
test('dead-link background job checkpoints and only marks real 404/410',async()=>{
 const data={};
 const bookmarks={id:'0',children:[{id:'1',title:'书签栏',parentId:'0',children:[
  {id:'101',title:'正常',url:'https://one.example/a',parentId:'1'},
  {id:'102',title:'已失效',url:'https://two.example/missing',parentId:'1'},
  {id:'103',title:'受限',url:'https://three.example/protected',parentId:'1'},
  {id:'104',title:'内部',url:'http://localhost:8000',parentId:'1'}
 ]},{id:'2',title:'其他书签',parentId:'0',children:[]},{id:'3',title:'移动书签',parentId:'0',children:[]}]};
 const fakeD={...D,async probe(url){
  const code=url.includes('one')?200:url.includes('two')?404:403;
  return {...D.classify(code),code};
 }};
 const chrome={storage:{local:{async get(key){return {[key]:data[key]};},async set(obj){Object.assign(data,obj);}}},bookmarks:{async getTree(){return [bookmarks];}},alarms:{async create(){},async clear(){},onAlarm:{addListener(){}}},runtime:{onStartup:{addListener(){}},onInstalled:{addListener(){}}}};
 const ctx={chrome,self:{MarkMindEngine:E,MarkMindDeadLinks:fakeD},console,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dead-links-background.js'),'utf8'),ctx);
 const result=await ctx.dlStart();assert.equal(result.status,'started');
 for(let i=0;i<120&&data.deadLinkScan?.status!=='completed';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(data.deadLinkScan.status,'completed');
 assert.equal(data.deadLinkScan.total,4);
 assert.equal(data.deadLinkScan.skipped,1);
 assert.equal(data.deadLinkScan.dead,1);
 assert.equal(data.deadLinkScan.alive,1);
 assert.equal(data.deadLinkScan.unknown,1);
 assert.equal(data.deadLinkScan.done,4);
 assert.equal(data.deadLinkScan.results.length,3);
});

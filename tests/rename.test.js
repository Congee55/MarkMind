'use strict';
const assert=require('node:assert/strict');
const R=require('../rename-engine.js');
const E=require('../engine.js');
const tree=[{id:'0',title:'',children:[
{id:'1',title:'书签栏',children:[
 {id:'10',title:'科研',parentId:'1',children:[
  {id:'11',title:'期刊',parentId:'10',children:[{id:'111',title:'Home | Nature Reviews Microbiology',url:'https://www.nature.com/nrmicro/',parentId:'11'}]},
  {id:'112',title:'Home | ResearchGate',url:'https://www.researchgate.net',parentId:'10'}]},
 {id:'20',title:'AI',parentId:'1',children:[{id:'211',title:'Home | ChatGPT',url:'https://chatgpt.com',parentId:'20'}]},
 {id:'21',title:'MarkMind Backup 2026-11',parentId:'1',children:[{id:'212',title:'irrelevant',url:'https://evil.test',parentId:'21'}]}
]},{id:'2',title:'其他书签',children:[]},{id:'3',title:'移动书签',children:[]}]}];
const scan=E.scan(tree);
const scope={mode:'folder',folderId:'10'};
assert.deepEqual(R.scopeItems(scan,scope).map(b=>b.id).sort(),['111','112']);
assert.deepEqual(R.scopeItems(scan,{...scope,bookmarkIds:['111']}).map(b=>b.id),['111']);
assert.deepEqual(R.scopeItems(scan,{...scope,bookmarkIds:[]}).map(b=>b.id),[]);
const inferred=R.inferFolder('帮我修改科研文件夹下面的书签，对其中收藏的书签进行优化命名',scan.folders,E.canonicalName);
assert.equal(inferred.folderId,'10');
assert.equal(R.normalizeTitle('  微生物学综述 Nature Reviews Microbiology  '),'微生物学综述 Nature Reviews Microbiology');
assert.equal(R.normalizeTitle('https://bad.test'),'');
const books=R.scopeItems(scan,scope);
const proposed=R.makePlan(books,[
{id:'111',title:'Nature Reviews Microbiology｜微生物学综述',reason:'保留期刊名'},
{id:'112',title:'ResearchGate｜科研学术社区',reason:'减少多余前缀'},
{id:'211',title:'恶意越界改名',reason:'不允许修改'}],scope,'只修改科研文件夹');
assert.equal(proposed.items.length,2);
assert.equal(R.validateEdits(proposed,scan).length,2);
assert.equal(R.validateEdits(proposed,scan).some(x=>x.id==='211'),false);
const hacked={...proposed,items:[...proposed.items,{id:'211',parentId:'20',url:'https://chatgpt.com',oldTitle:'Home | ChatGPT',newTitle:'被越界改名',selected:true}]};
assert.equal(R.validateEdits(hacked,scan).length,2);
const moved={...scan,bookmarks:scan.bookmarks.map(b=>b.id==='111'?{...b,parentId:'20'}:b)};
assert.deepEqual(R.validateEdits(proposed,moved).map(x=>x.id),['112']);
const changed={...scan,bookmarks:scan.bookmarks.map(b=>b.id==='111'?{...b,title:'我手动修改过'}:b)};
assert.deepEqual(R.validateEdits(proposed,changed).map(x=>x.id),['112']);
console.log('PASS: folder scope, descendants, instruction inference, title sanitation, out-of-scope rejection, stale bookmark guard');

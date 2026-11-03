'use strict';
const assert=require('node:assert/strict');
const E=require('../engine.js'),O=require('../organize-engine.js');
const tree=[{id:'0',title:'',children:[{id:'1',title:'书签栏',children:[
 {id:'10',parentId:'1',title:'学习',children:[
  {id:'11',title:'课程',parentId:'10',children:[{id:'101',title:'TypingClub 打字练习',url:'https://typingclub.com',parentId:'11'}]},
  {id:'102',title:'中文打字训练',url:'https://typing.com',parentId:'10'},
  {id:'103',title:'Coursera 学习平台',url:'https://coursera.org',parentId:'10'}]},
 {id:'20',title:'科研',parentId:'1',children:[{id:'201',title:'科研资源',url:'https://nature.com',parentId:'20'}]}
]},{id:'2',title:'其他书签',children:[]},{id:'3',title:'移动书签',children:[]}]}];
const scan=E.scan(tree);
assert.equal(O.extractNewFolder('新建一个打字子文件夹，帮我把学习文件夹下面的打字相关书签放进去打字子文件夹'),'打字');
assert.equal(O.extractNewFolder('创建一个「阅读」子文件夹'),'阅读');
assert.equal(O.safeFolderName('../bad'),'');
assert.equal(O.safeFolderName('MarkMind Backup 2026'),'');
assert.equal(O.inferFolder('学习文件夹下面相关的书签',scan.folders).folderId,'10');
assert.deepEqual(O.scopedBookmarks(scan,{folderIds:['10','11'],bookmarkIds:['101','201']}).map(b=>b.id),['101','102','103','201']);
const scoped=O.scopedBookmarks(scan,{folderIds:['10'],bookmarkIds:[]});
const plan=O.makePlan(scoped,[
 {id:'101',move:true,confidence:0.95,reason:'打字练习'},
 {id:'102',move:true,confidence:0.89,reason:'键盘打字'},
 {id:'103',move:false,confidence:0.99,reason:'课程不是打字'},
 {id:'201',move:true,confidence:0.99,reason:'恶意返回不在允许范围'}
],{folderIds:['10'],bookmarkIds:[]},'10','打字','新建打字文件夹');
assert.equal(plan.items.length,3);assert.deepEqual(plan.items.filter(x=>x.selected).map(x=>x.id),['101','102']);
const evil={...plan,items:[...plan.items,{id:'201',selected:true,parentId:'20',title:'科研资源',url:'https://nature.com'}]};
assert.deepEqual(O.validate(evil,scan).items.map(x=>x.id),['101','102']);
const changed={...scan,bookmarks:scan.bookmarks.map(b=>b.id==='101'?{...b,parentId:'20'}:b)};
assert.deepEqual(O.validate(plan,changed).items.map(x=>x.id),['102']);
console.log('PASS: scope union, instruction parsing, out-of-scope AI IDs ignored, stale bookmark prevention');

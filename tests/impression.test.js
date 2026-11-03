'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const I=require('../impression-engine.js');
const B=[
 {id:'1',title:'文档在线工具',url:'https://www.ilovepdf.com/zh-cn',domain:'ilovepdf.com',path:'软件'},
 {id:'2',title:'校园研究生平台',url:'https://portal.edu.cn',domain:'portal.edu.cn',path:'校园'},
 {id:'3',title:'压缩图片',url:'https://tinypng.com/',domain:'tinypng.com',path:'设计'},
 {id:'4',title:'TypingClub',url:'https://www.typingclub.com/',domain:'typingclub.com',path:'学习'},
 {id:'5',title:'Google Scholar',url:'https://scholar.google.com',domain:'scholar.google.com',path:'科研'}
];
test('function impression locates a PDF site without PDF in title',()=>{
 const r=I.search(B,'pdf转换');assert.equal(r[0].id,'1');assert.ok(!r.some(x=>x.id==='2'));
});
test('images and typing by intent',()=>{
 assert.equal(I.search(B,'图片压缩')[0].id,'3');
 assert.equal(I.search(B,'打字练习')[0].id,'4');
 assert.equal(I.search(B,'查论文')[0].id,'5');
});
test('never adds bookmarks and no query returns empty',()=>{
 assert.deepEqual(I.search(B,''),[]);assert.equal(B.length,5);
});

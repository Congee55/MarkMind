'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../dead-links.js');
test('non-http and internal bookmarks are skipped',()=>{
 for(const u of ['chrome://extensions','file:///secret','http://localhost:4000','http://192.168.1.10','http://10.0.2.1','http://example.local'])assert.equal(D.checkable(u),false);
 assert.equal(D.checkable('https://example.org/link'),true);
});
test('HEAD false 404 corrected by GET 200',async()=>{
 const methods=[];
 const f=async(_u,o)=>{methods.push(o.method);return {status:o.method==='HEAD'?404:200,body:null};};
 const r=await D.probe('https://example.org/file',f);assert.equal(r.status,'alive');assert.deepEqual(methods,['HEAD','GET']);
});
test('only final 404 and 410 called dead; 403 unknown',async()=>{
 for(const n of [404,410])assert.equal((await D.probe('https://example.org',async()=>({status:n,body:null}))).status,'dead');
 const r=await D.probe('https://example.org',async()=>({status:403,body:null}));assert.equal(r.status,'unknown');
});
test('timeout/network cannot be marked dead',async()=>{
 const r=await D.probe('https://example.org',async()=>{throw Error('Failed to fetch')});assert.equal(r.status,'unknown');
});

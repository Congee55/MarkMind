'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../ai-client.js');
test('legacy DeepSeek remains default and provider keys never cross',()=>{
 const s={deepseekKey:'sk-legacy-secret',model:'deepseek-chat',apiProvider:'openai',apiKeys:{openai:'sk-openai-secret'}};
 assert.equal(A.config(s).key,'sk-openai-secret');
 assert.equal(A.config({...s,apiProvider:'deepseek'}).key,'sk-legacy-secret');
 assert.equal(A.config({...s,apiProvider:'openrouter'}).key,'');
 assert.equal(A.hasKey({...s,apiProvider:'openrouter'}),false);
 assert.equal(A.PROVIDERS.openai.url,'https://api.openai.com/v1/chat/completions');
});
test('chat only sends selected provider bearer key and fixed HTTPS endpoint',async()=>{
 const prior=global.fetch;let url='',opts;
 global.fetch=async(u,o)=>{url=u;opts=o;return {ok:true,json:async()=>({choices:[{message:{content:'```json\n{"items":[{"id":"1"}]}\n```'}}]})};};
 try{
  const out=await A.chatJSON({apiProvider:'qwen',apiKeys:{qwen:'sk-qwen',openai:'sk-openai'},apiModels:{qwen:'qwen-plus'}},{system:'输出 JSON',user:{bookmarks:[]}});
  assert.equal(url,A.PROVIDERS.qwen.url);assert.equal(opts.headers.Authorization,'Bearer sk-qwen');
  assert.equal(JSON.parse(opts.body).model,'qwen-plus');assert.equal(out.items[0].id,'1');
 }finally{global.fetch=prior;}
});
test('invalid content rejected',()=>assert.throws(()=>A.decode('not json')));

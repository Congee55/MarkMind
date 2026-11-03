/* Shared HTTPS transport for supported AI providers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MarkMindAI=api;})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 const PROVIDERS={
  deepseek:{name:'DeepSeek',url:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',placeholder:'sk-...',models:[['deepseek-flash','DeepSeek Flash · 快速'],['deepseek-v4-pro','DeepSeek V4 Pro · 高质量']]},
  openai:{name:'OpenAI',url:'https://api.openai.com/v1/chat/completions',model:'gpt-4.1-mini',placeholder:'sk-...',models:[['gpt-4.1-mini','GPT-4.1 mini'],['gpt-4.1','GPT-4.1'],['gpt-4o-mini','GPT-4o mini']]},
  openrouter:{name:'OpenRouter',url:'https://openrouter.ai/api/v1/chat/completions',model:'openai/gpt-4.1-mini',placeholder:'sk-or-...',models:[['openai/gpt-4.1-mini','GPT-4.1 mini'],['deepseek/deepseek-chat','DeepSeek']]},
  qwen:{name:'阿里云百炼',url:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',model:'qwen-plus',placeholder:'sk-...',models:[['qwen-plus','通义千问 Plus'],['qwen-turbo','通义千问 Turbo']]},
  siliconflow:{name:'硅基流动',url:'https://api.siliconflow.cn/v1/chat/completions',model:'deepseek-ai/DeepSeek-V4-Flash',placeholder:'sk-...',models:[['deepseek-ai/DeepSeek-V4-Flash','DeepSeek V4 Flash'],['Qwen/Qwen2.5-7B-Instruct','Qwen 2.5 7B']]}
 };
 const keys=['apiProvider','apiKeys','apiModels','deepseekKey','model'];
 function config(saved={}){
  const provider=Object.hasOwn(PROVIDERS,saved.apiProvider)?saved.apiProvider:'deepseek';
  const profile=PROVIDERS[provider];
  const map=saved.apiKeys||{};
  const key=String(Object.prototype.hasOwnProperty.call(map,provider)?(map[provider]||''):(provider==='deepseek'?saved.deepseekKey||'':'')).trim();
  const custom=String(saved.apiModels?.[provider]||(provider==='deepseek'?saved.model:'')||profile.model).trim();
  const model=provider==='deepseek'&&custom==='deepseek-chat'?'deepseek-flash':provider==='deepseek'&&custom==='deepseek-reasoner'?'deepseek-v4-pro':custom||profile.model;
  return {provider,name:profile.name,url:profile.url,key,model};
 }
 function hasKey(saved){return Boolean(config(saved).key);}
 function decode(content){
  if(typeof content!=='string'||!content.trim())throw Error('AI 返回了空内容');
  let c=content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(c);}catch(_){const a=c.indexOf('{'),b=c.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(c.slice(a,b+1));throw Error('AI 返回内容不是有效 JSON');}
 }
 async function chatJSON(saved,{system,user,max_tokens=3000,temperature=0.1,signal}={}){
  const c=config(saved);if(!c.key)throw Error(`请先配置 ${c.name} API Key`);
  // Do not allow user-entered endpoints: protects keys against arbitrary request destinations.
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+c.key};
  const body={model:c.model,max_tokens,temperature,messages:[{role:'system',content:system},{role:'user',content:typeof user==='string'?user:JSON.stringify(user)}]};
  if(c.provider==='deepseek'||c.provider==='openai'||c.provider==='openrouter'||c.provider==='qwen')body.response_format={type:'json_object'};
  const response=await fetch(c.url,{method:'POST',headers,body:JSON.stringify(body),signal});
  if(!response.ok){const err=await response.json().catch(()=>({}));const ex=Error(err?.error?.message||`${c.name} HTTP ${response.status}`);ex.status=response.status;throw ex;}
  const data=await response.json();return decode(data?.choices?.[0]?.message?.content);
 }
 return {PROVIDERS,keys,config,hasKey,decode,chatJSON};
});

/* Read-only link checks. HTTP 404 and 410 indicate potential dead links.
 * 403/429/login/timeout/network failures are uncertain, NEVER automatic deletions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MarkMindDeadLinks=api;})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 function checkable(url){
  try{
   const u=new URL(url);
   if(!['http:','https:'].includes(u.protocol))return false;
   const host=u.hostname.toLowerCase();
   if(u.username||u.password)return false;
   if(!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.lan')||host.endsWith('.internal')||host.endsWith('.intranet')||host.endsWith('.home.arpa'))return false;
   if(host.startsWith('[fc')||host.startsWith('[fd')||host.startsWith('[fe80'))return false;
   if(/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^::1$|^\[::1\]$|^198\.(?:18|19)\.|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host))return false;
   const v=/^172\.(\d+)\./.exec(host);if(v && +v[1]>=16 && +v[1]<=31)return false;
   return true;
  }catch(_){return false;}
 }
 function classify(status,error){
  if(error)return {status:'unknown',reason:error==='timeout'?'连接超时':'连接失败或被拦截'};
  if(status===404||status===410)return {status:'dead',reason:`HTTP ${status} · 页面不存在`};
  if(status>=200&&status<400)return {status:'alive',reason:`HTTP ${status} · 可访问`};
  if(status===401||status===403)return {status:'unknown',reason:`HTTP ${status} · 可能需要登录或禁止检测`};
  if(status===429)return {status:'unknown',reason:'HTTP 429 · 访问过于频繁'};
  return {status:'unknown',reason:`HTTP ${status||'?'} · 暂时无法确定`};
 }
 async function probe(url,fetchFn=fetch,timeoutMs=13000){
  if(!checkable(url))return {status:'skipped',reason:'内部地址或不支持检测'};
  async function once(method){
   const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),timeoutMs);
   try{
    const res=await fetchFn(url,{method,redirect:'follow',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:ctrl.signal});
    // Do not read bodies; no page contents are extracted.
    const code=res.status;try{await res.body?.cancel?.();}catch(_){ }
    return {code};
   }catch(e){return {error:e?.name==='AbortError'?'timeout':'network'};}
   finally{clearTimeout(timeout);}
  }
  const head=await once('HEAD');
  if(head.code>=200&&head.code<400)return {...classify(head.code),code:head.code};
  // HEAD can falsely return 404/403/405; confirm with a normal GET.
  const get=await once('GET');
  if(get.error)return {...classify(0,get.error),code:head.code||0};
  return {...classify(get.code),code:get.code};
 }
 return {checkable,classify,probe};
});

/* MarkMind 3.3 — folder-scoped title operations. Pure helpers for testability. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MarkMindRename=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const norm=s=>String(s||'').trim().toLocaleLowerCase().replace(/\s+/g,'');
const PROTECTED=/^\s*(?:📦\s*)?MarkMind (?:Backup|Archive)/i;
function normalizeTitle(raw){
  if(typeof raw!=='string')return '';
  const title=raw.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if(!title||title.length>88||/^\s*(?:https?:\/\/|www\.)/i.test(title)||/[<>]/.test(title))return '';
  return title;
}
function isInsideFolder(bookmark,folderId,folders){
  if(!bookmark||!folderId)return false;
  const map=new Map(folders.map(f=>[String(f.id),f]));
  let current=String(bookmark.parentId),safety=0;
  while(current&&safety++<70){
    if(current===String(folderId))return true;
    current=map.get(current)?.parentId;
  }
  return false;
}
function scopeItems(scan,scope){
  if(!scan || !scope)return [];
  if(scope.mode==='folder'){
    if(!scan.folders.some(f=>String(f.id)===String(scope.folderId)))return [];
    const narrowed=Array.isArray(scope.bookmarkIds)?new Set(scope.bookmarkIds.map(String)):null;
    return scan.bookmarks.filter(b=>isInsideFolder(b,scope.folderId,scan.folders)&&(!narrowed||narrowed.has(String(b.id))));
  }
  if(scope.mode==='selected'){
    const ids=new Set((scope.bookmarkIds||[]).map(String));
    return scan.bookmarks.filter(b=>ids.has(String(b.id)));
  }
  return [];
}
// Infers a folder only from an explicit user reference to a folder, not from broad semantic words.
function inferFolder(text,folders,canonicalName){
  const input=norm(text);
  if(!input)return {folderId:null,ambiguous:false,candidates:[]};
  const hits=folders.filter(f=>{
    const name=norm(f.title);
    const canon=norm(canonicalName ? canonicalName(f.title) : f.title);
    const names=[name,canon].filter(s=>s.length>=2);
    return names.some(n=>input.includes(n+'文件夹')||input.includes(n+'目录')||input.includes(n+'下面')||input.includes(n+'下的')||input.includes(n+'里的')||input.includes('修改'+n)||input.includes('优化'+n));
  });
  if(hits.length===1)return {folderId:String(hits[0].id),ambiguous:false,candidates:hits};
  return {folderId:null,ambiguous:hits.length>1,candidates:hits};
}
function makePlan(bookmarks,answers,scope,instruction){
  const allowed=new Map(bookmarks.map(b=>[String(b.id),b]));
  const raw=new Map();
  for(const d of answers||[]){const id=String(d?.id||'');if(allowed.has(id)&&!raw.has(id))raw.set(id,d);}
  return {version:1,createdAt:Date.now(),scope, instruction:String(instruction||'').slice(0,350),
    items:bookmarks.map(b=>{
      const proposed=normalizeTitle(raw.get(String(b.id))?.title);
      const valid=proposed && proposed!==b.title;
      return {id:String(b.id),url:b.url,parentId:String(b.parentId),oldTitle:b.title,
        newTitle:valid?proposed:b.title,selected:Boolean(valid),reason:String(raw.get(String(b.id))?.reason||'').slice(0,120),status:valid?'ready':'unchanged'};
    })};
}
function validateEdits(plan,scan){
  if(!plan?.items||!plan?.scope)throw Error('没有可执行的命名方案');
  const allowed=new Map(scopeItems(scan,plan.scope).map(b=>[String(b.id),b]));
  const seen=new Set(),out=[];
  for(const item of plan.items){
    if(!item.selected)continue;
    const id=String(item.id),original=allowed.get(id);
    if(!original||seen.has(id))continue;
    seen.add(id);
    if(String(original.parentId)!==String(item.parentId)||original.url!==item.url)continue;
    if(original.title!==item.oldTitle)continue; // Don't overwrite changes since plan generation.
    const title=normalizeTitle(item.newTitle);
    if(!title||title===original.title)continue;
    out.push({id,oldTitle:original.title,newTitle:title,url:original.url,parentId:String(original.parentId)});
  }
  return out;
}
return {normalizeTitle,isInsideFolder,scopeItems,inferFolder,makePlan,validateEdits,PROTECTED};
});

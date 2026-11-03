/* MarkMind 3.4 — scope-constrained custom folder operations. Pure functions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MarkMindOrganize=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const normalize=s=>String(s||'').replace(/\s+/g,'').toLocaleLowerCase();
function safeFolderName(text){
 if(/[\\/]/.test(String(text||'')))return '';
 const n=String(text||'').normalize('NFKC').replace(/[\u0000-\u001f\u007f\\/<>:"|?*]/g,'').replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]/gu,'').trim().replace(/\s+/g,' ');
 if(!n || n==='.' || n==='..' || n.length>24 || /^(?:MarkMind Backup|MarkMind Archive)/i.test(n))return '';
 return n;
}
function extractNewFolder(text){
 const line=String(text||'').slice(0,600);
 const hit=line.match(/(?:新建|创建|建立|添加|建)(?:一个|个)?(?:名为|叫作|叫做|叫)?\s*[「“"']?([\p{Script=Han}a-zA-Z\d _-]{1,24}?)[」”"']?\s*(?:子文件夹|文件夹|子目录|目录)/u);
 return safeFolderName(hit?.[1]||'');
}
function isWithinFolder(bookmark,folderId,folders){
 const map=new Map((folders||[]).map(f=>[String(f.id),f]));
 let id=String(bookmark?.parentId||''),n=0;
 while(id&&n++<90){if(id===String(folderId))return true;id=map.get(id)?.parentId;}
 return false;
}
function scopedBookmarks(scan,scope){
 if(!scan||!scope)return [];
 const folderIds=new Set((scope.folderIds||[]).map(String));
 const selectedIds=new Set((scope.bookmarkIds||[]).map(String));
 const folders=new Map(scan.folders.map(f=>[String(f.id),f]));
 // Unknown folder IDs must not expand the scope.
 for(const id of [...folderIds])if(!folders.has(id))folderIds.delete(id);
 return scan.bookmarks.filter(b=>{
  if(selectedIds.has(String(b.id)))return true;
  let parent=String(b.parentId),n=0;
  while(parent&&n++<90){if(folderIds.has(parent))return true;parent=folders.get(parent)?.parentId;}
  return false;
 });
}
function inferFolder(text,folders){
 const input=normalize(text);
 const candidates=folders.filter(f=>{
  const name=normalize(f.title);
  return name.length>=2&&[name+'文件夹',name+'目录',name+'下面',name+'下的',name+'里',name+'中'].some(token=>input.includes(token));
 });
 // Parent and similarly named subfolders in the same instruction are ambiguous.
 return {folderId:candidates.length===1?String(candidates[0].id):null,ambiguous:candidates.length>1,candidates};
}
function makePlan(bookmarks,raw,scope,parentId,targetName,instruction){
 const allowed=new Map(bookmarks.map(b=>[String(b.id),b]));
 const byId=new Map();
 for(const x of raw||[]){const id=String(x?.id||'');if(allowed.has(id)&&!byId.has(id))byId.set(id,x);}
 return {version:1,createdAt:Date.now(),scope:{folderIds:(scope.folderIds||[]).map(String),bookmarkIds:(scope.bookmarkIds||[]).map(String)},targetParentId:String(parentId),targetName:safeFolderName(targetName),instruction:String(instruction||'').slice(0,450),items:bookmarks.map(b=>{
  const d=byId.get(b.id)||{},confidence=Math.max(0,Math.min(1,Number(d.confidence)||0));
  const relevant=d.move===true && confidence>=.62 && String(d.reason||'').trim();
  return {id:String(b.id),title:b.title,url:b.url,parentId:String(b.parentId),index:b.index||0,path:b.path,confidence,selected:Boolean(relevant),reason:String(d.reason||'未确认相关性').slice(0,110),suggested:Boolean(relevant)};
 })};
}
function validate(plan,scan){
 if(!plan?.scope||!plan?.targetParentId||!plan?.targetName||!safeFolderName(plan.targetName))throw Error('缺少有效的目标文件夹');
 const parent=scan.folders.find(f=>String(f.id)===String(plan.targetParentId));
 if(!parent)throw Error('目标父文件夹已不存在');
 const allowed=new Map(scopedBookmarks(scan,plan.scope).map(b=>[String(b.id),b]));
 const seen=new Set();const out=[];
 for(const x of plan.items||[]){
  if(!x.selected)continue;
  const id=String(x.id),fresh=allowed.get(id);
  if(seen.has(id)||!fresh||fresh.url!==x.url||fresh.title!==x.title||String(fresh.parentId)!==String(x.parentId))continue;
  seen.add(id);
  out.push({id,title:fresh.title,url:fresh.url,parentId:fresh.parentId,index:fresh.index});
 }
 return {parent,items:out,targetName:safeFolderName(plan.targetName)};
}
return {safeFolderName,extractNewFolder,isWithinFolder,scopedBookmarks,inferFolder,makePlan,validate};
});

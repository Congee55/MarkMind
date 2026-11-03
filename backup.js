/* MarkMind history — backups are user-visible bookmark folders, never hidden data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MarkMindBackup=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const PREFIX='MarkMind Backup', ARCHIVE='MarkMind Archive';
const isBackup=t=>/^\s*(?:📦\s*)?MarkMind Backup(?:\b|\s|$)/i.test(String(t||''));
const isArchive=t=>/^\s*MarkMind Archive(?:\b|\s|$)/i.test(String(t||''));
const skip=t=>isBackup(t)||isArchive(t);
const roots=t=>(t?.[0]?.children||[]).filter(n=>['1','2','3'].includes(String(n.id)));
function list(tree){
 const out=[];
 function walk(n){
  if(!n||n.url)return;
  if(isBackup(n.title)){
   const groups=n.children||[];
   let count=0,folders=0;
   function tally(x){if(x.url)count++;else {folders++;for(const c of x.children||[])tally(c);}}
   for(const group of groups)tally(group);
   out.push({id:String(n.id),title:n.title||PREFIX,dateAdded:n.dateAdded||0,count,folders:Math.max(0,folders-groups.length),groups:groups.length,parentId:String(n.parentId)});
   return;
  }
  if(isArchive(n.title))return;
  for(const c of n.children||[])walk(c);
 }
 for(const r of roots(tree))walk(r);
 return out.sort((a,b)=>(b.dateAdded||0)-(a.dateAdded||0) || b.id.localeCompare(a.id));
}
const stamp=()=>new Date().toISOString().replace(/[T:.Z]/g,'-');
async function copyNode(source,dest,api){
 if(!source.url&&skip(source.title))return;
 if(source.url){await api.create({parentId:dest,title:source.title||source.url,url:source.url});return;}
 const folder=await api.create({parentId:dest,title:source.title||'未命名文件夹'});
 for(const child of source.children||[])await copyNode(child,String(folder.id),api);
}
async function create(tree,api=chrome.bookmarks){
 const rs=roots(tree);const dest=rs.find(r=>String(r.id)==='2')||rs[0];
 if(!dest)throw Error('未找到可保存备份的目录');
 const holder=await api.create({parentId:String(dest.id),title:`${PREFIX} ${stamp()}`});
 try{
  for(const r of rs){
   const group=await api.create({parentId:String(holder.id),title:r.title||'根目录'});
   for(const c of r.children||[])await copyNode(c,String(group.id),api);
  }
  return {id:String(holder.id),title:holder.title};
 }catch(e){throw Error(`备份未完成（备份目录 ${holder.id}，请检查后再试）：${e.message}`);}
}
function mapGroups(folder, rootNodes){
 if(!folder||!isBackup(folder.title))throw Error('选择的不是 MarkMind 历史备份');
 const groups=(folder.children||[]).filter(x=>!x.url);
 if(groups.length!==rootNodes.length)throw Error('备份结构不完整或浏览器根目录数量已变化，请使用手动恢复');
 // Older versions store original root title as group names in the exact original order.
 const matches=groups.every((g,i)=>g.title===rootNodes[i].title);
 if(matches)return groups;
 const map=new Map(groups.map(g=>[g.title,g]));
 if(map.size===groups.length&&rootNodes.every(r=>map.has(r.title)))return rootNodes.map(r=>map.get(r.title));
 throw Error('备份中的书签栏/其他书签名称无法与当前浏览器对应，请手动核对');
}
function inspect(tree,id){
 const all=tree?.[0];let selected=null;
 function visit(n){if(!n||selected)return;if(String(n.id)===String(id)){selected=n;return;}for(const c of n.children||[])visit(c);}
 visit(all);
 const rs=roots(tree);const groups=mapGroups(selected,rs);
 let count=0;const countLinks=n=>{if(n.url)count++;else for(const c of n.children||[])countLinks(c);};groups.forEach(countLinks);
 if(count===0)throw Error('这个备份中没有书签，已停止恢复以避免清空当前收藏');
 return {selected,roots:rs,groups,count};
}
// Recovery is loss-averse: archive current live bookmarks rather than deleting them.
async function restore(backupId,api=chrome.bookmarks,store=chrome.storage.local){
 const tree=await api.getTree(), inspected=inspect(tree,backupId);
 const rs=inspected.roots;
 const dest=rs.find(r=>String(r.id)==='2')||rs[0];
 const archive=await api.create({parentId:String(dest.id),title:`${ARCHIVE} ${stamp()}`});
 const journal={status:'running',backupId:String(backupId),archiveId:String(archive.id),createdAt:Date.now(),copied:0};
 await store.set({lastRestore:journal});
 try{
  const archiveGroups=[];
  for(const r of rs){archiveGroups.push(await api.create({parentId:String(archive.id),title:r.title||'根目录'}));}
  for(let i=0;i<rs.length;i++){
   const r=rs[i];
   // Captured tree precedes archive creation; exclude prior backups and previous recoveries.
   for(const n of r.children||[]){
    if(!n.url&&skip(n.title))continue;
    await api.move(String(n.id),{parentId:String(archiveGroups[i].id)});
   }
  }
  for(let i=0;i<rs.length;i++){
   for(const n of inspected.groups[i].children||[]){
    await copyNode(n,String(rs[i].id),api);
   }
  }
  journal.status='completed';journal.copied=inspected.count;await store.set({lastRestore:journal});
  return {count:inspected.count,archiveId:String(archive.id)};
 }catch(error){
  journal.status='interrupted';journal.error=String(error.message||error);await store.set({lastRestore:journal});
  throw Error(`恢复中断：${error.message}。操作前的书签已移至「${archive.title}」（ID: ${archive.id}），不要删除该文件夹。`);
 }
}
return {PREFIX,ARCHIVE,isBackup,isArchive,list,create,inspect,restore};
});

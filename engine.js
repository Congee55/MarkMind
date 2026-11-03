/* Bookmark scanning, classification rules, and destination planning. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MarkMindEngine=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const TAXONOMY=Object.freeze({
 'AI':['模型对话','AI应用','AI开发'],
 '科研':['文献论文','生物信息','实验分析','科研数据'],
 '校园':['校务服务','教学课程','研究生','实验平台'],
 '学习':['课程','教程','语言'],
 '开发':['代码工具','前后端','开源项目'],
 '软件':['软件下载','系统维护','软件服务'],
 '效率':['笔记知识','办公协作','自动化'],
 '设计':['界面设计','设计素材','创意工具'],
 '写作':['文档写作','翻译','内容创作'],
 '数据':['数据处理','可视化','统计'],
 '资讯':['科技资讯','综合资讯','行业资讯'],
 '社区':['交流论坛','问答社区','内容平台'],
 '影音':['视频','音频','娱乐'],
 '工作':['工作平台','项目管理','职业发展'],
 '购物':['电商','优惠比价','品牌官网'],
 '生活':['日常服务','旅行出行','健康医疗'],
 '财务':['金融服务','财经信息','账务工具'],
 '资源':['素材资源','在线工具','资源站'],
 '归档':['历史收藏','临时资料'],
 '其他':['待核实']
});
const ALIASES=Object.freeze({'ai工具与大模型':'AI','ai工具':'AI','人工智能':'AI','大模型':'AI','学术与科研':'科研','学术科研':'科研','科研学术':'科研','学校与教育':'校园','学校教育':'校园','学校':'校园','教育与学校':'校园','效率与软件工具':'效率','效率工具':'效率','归档与其他':'归档','其他归档':'归档','杂项':'其他','待确认':'其他','资讯与社区':'资讯'});
function cleanName(n){return String(n||'').replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]/gu,'').replace(/^[\s\-–—_·•|:：]+|[\s\-–—_·•|:：]+$/g,'').replace(/\s+/g,' ').trim();}
function canonicalName(n){const plain=cleanName(n).replace(/\s+/g,'').toLowerCase();return ALIASES[plain]||Object.keys(TAXONOMY).find(k=>k.toLowerCase()===plain)||cleanName(n);}
function eligibleRoots(tree){return(tree?.[0]?.children||[]).filter(c=>['1','2','3'].includes(String(c.id)));}
function isSafeBackup(n){return /^\s*(?:📦\s*)?MarkMind (?:Backup|Archive)/i.test(String(n||''));}
function scan(tree){
 const bookmarks=[],folders=[],allNodes=new Map();
 function walk(n,path,rootId,depth=0){
  if(!n || (!n.url&&isSafeBackup(n.title)))return;
  allNodes.set(String(n.id),n);const id=String(n.id);
  if(n.url){let domain='';try{domain=new URL(n.url).hostname.replace(/^www\./,'');}catch(_){ }
   bookmarks.push({id,title:n.title||domain||'未命名',url:n.url,domain,parentId:String(n.parentId),rootId,path,index:n.index||0});
  } else {
   if(!['0','1','2','3'].includes(id))folders.push({id,title:n.title||'未命名文件夹',parentId:String(n.parentId),rootId,path,depth,index:n.index||0});
   const newPath=['0','1','2','3'].includes(id)?'':[path,n.title].filter(Boolean).join(' / ');
   for(const ch of n.children||[])walk(ch,newPath,rootId,depth+1);
  }
 }
 for(const r of eligibleRoots(tree))walk(r,'',String(r.id),0);
 const dup=[],groups=new Map();
 for(const f of folders){const k=f.parentId+':'+canonicalName(f.title).toLowerCase();groups.set(k,[...(groups.get(k)||[]),f.id]);}
 for(const [key,ids] of groups)if(ids.length>1)dup.push({key,ids});
 const nested=folders.filter(f=>{const p=allNodes.get(f.parentId);return p && canonicalName(p.title)===canonicalName(f.title);});
 return {bookmarks,folders,rootCount:bookmarks.filter(b=>['1','2','3'].includes(b.parentId)).length,duplicateNames:dup,nestedDuplicates:nested,allNodes};
}
// Strong signals only; weak/unrecognized links are held in '其他' instead of guessed into niche subfolders.
const DOMAIN_RULES=[
 [/\b(arxiv\.org|pubmed\.ncbi\.nlm\.nih\.gov|scholar\.google\.|semanticscholar\.org|webofscience\.|sciencedirect\.com|nature\.com|science\.org|researchgate\.net)\b/i,'科研','文献论文'],
 [/(?:^|\.)(?:zju\.edu\.cn|edu\.cn|school\.edu|university\.edu)$|(?:教务|研究生院|学校门户|校园网)/i,'校园','校务服务'],
 [/(chatgpt\.com|chat\.openai\.com|deepseek\.com|claude\.ai|gemini\.google\.com|perplexity\.ai|poe\.com)/i,'AI','模型对话'],
 [/(github\.com|gitlab\.com|stackoverflow\.com|npmjs\.com|pypi\.org|developer\.mozilla\.org|docs\.python\.org)/i,'开发','开源项目'],
 [/(bilibili\.com|youtube\.com|netflix\.com|spotify\.com|music\.163\.com)/i,'影音','视频'],
 [/(taobao\.com|tmall\.com|jd\.com|amazon\.|pinduoduo\.com)/i,'购物','电商'],
 [/(zhihu\.com|reddit\.com|v2ex\.com|stackoverflow\.com\/questions)/i,'社区','问答社区'],
 [/(figma\.com|dribbble\.com|behance\.net|canva\.com)/i,'设计','界面设计'],
 [/(notion\.so|feishu\.cn|docs\.qq\.com|yuque\.com|flomoapp\.com)/i,'效率','笔记知识'],
 [/(coursera\.org|edx\.org|khanacademy\.org|mooc\.|icourse163\.org)/i,'学习','课程']
];
const KEYWORDS=[
 [/(ai|人工智能|大模型|llm|prompt|提示词|生成式)/i,'AI','AI应用'],
 [/(论文|期刊|文献|科研|实验|学术|生物信息|测序|基因|蛋白)/i,'科研','文献论文'],
 [/(校务|教务|校园|学校|研究生|浙大|学校邮箱)/i,'校园','校务服务'],
 [/(程序|代码|编程|github|python|javascript|开发|api接口)/i,'开发','代码工具'],
 [/(pdf|软件|下载|app应用|windows|macos|linux|安装包)/i,'软件','软件服务'],
 [/(笔记|待办|自动化|效率|协作|办公)/i,'效率','办公协作'],
 [/(绘画|配色|设计|字体|图标|原型)/i,'设计','设计素材'],
 [/(写作|排版|翻译|语法|文档)/i,'写作','文档写作'],
 [/(数据|统计|图表|可视化|csv|excel)/i,'数据','数据处理'],
 [/(新闻|资讯|快讯|科技动态)/i,'资讯','综合资讯'],
 [/(论坛|问答|社区|交流)/i,'社区','交流论坛'],
 [/(视频|音乐|电影|影视|动漫|播客)/i,'影音','视频'],
 [/(工作|招聘|实习|简历|求职)/i,'工作','职业发展'],
 [/(购物|商品|比价|折扣|优惠|淘宝|京东)/i,'购物','电商'],
 [/(旅游|机票|酒店|医院|健康|生活服务)/i,'生活','日常服务'],
 [/(金融|银行|基金|股票|投资|财务)/i,'财务','财经信息'],
 [/(素材|资源|图片下载|模板|工具箱)/i,'资源','素材资源']
];
function heuristic(b){
 const u=(b.domain||'')+' '+(b.url||'');
 for(const [re,category,subcategory] of DOMAIN_RULES)if(re.test(u))return {category,subcategory,confidence:.88,reason:'网站域名与用途特征明确'};
 const t=String(b.title||'');
 for(const [re,category,subcategory] of KEYWORDS)if(re.test(t))return {category,subcategory,confidence:.70,reason:'标题关键词'};
 const path=String(b.path||'');
 for(const [re,category,subcategory] of KEYWORDS)if(re.test(path))return {category,subcategory,confidence:.53,reason:'原文件夹提供辅助线索'};
 return null;
}
function validateDecision(data,b){
 let category=String(data?.category||'').trim(),subcategory=String(data?.subcategory||'').trim();
 let confidence=Math.max(0,Math.min(1,Number(data?.confidence)||0));
 let reason=String(data?.reason||'').slice(0,140);
 if(!TAXONOMY[category])category=canonicalName(category);
 let valid=Boolean(TAXONOMY[category]);
 const fallback=heuristic(b);
 if(!valid || category==='其他' || confidence<.42){
  if(fallback && (!valid || confidence<.42 || category==='其他')){
   category=fallback.category;subcategory=fallback.subcategory;confidence=Math.max(confidence,fallback.confidence);reason=reason||fallback.reason;
  }else{category='其他';subcategory='待核实';confidence=Math.min(confidence,.4);reason=reason||'信息不足，保持在其他';}
 } else if(!TAXONOMY[category].includes(subcategory))subcategory=TAXONOMY[category][0];
 const needsReview=category==='其他'||confidence<.53;
 return {id:b.id,title:b.title,url:b.url,domain:b.domain,originalPath:b.path,parentId:b.parentId,rootId:b.rootId,
  category,subcategory,confidence,needsReview,reason:reason||'结合标题与网址推断',selected:category!=='其他'};
}
function makePlan(s,decisions){const map=new Map();for(const x of decisions||[]){const id=String(x?.id||'');if(id&&!map.has(id))map.set(id,x);}const items=s.bookmarks.map(b=>validateDecision(map.get(b.id),b));return {items,total:items.length,pending:items.filter(x=>x.needsReview).length};}
function summary(p){const selected=p.items.filter(x=>x.selected);return {total:p.items.length,selected:selected.length,pending:selected.filter(x=>x.needsReview).length,destinations:new Set(selected.map(x=>x.category)).size};}
// Split a main category only when it is genuinely populous, and each subfolder has meaningful volume.
function buildLayout(plan){
 const byCat=new Map();for(const i of plan.items.filter(i=>i.selected&&i.category!=='其他')){
  if(!byCat.has(i.category))byCat.set(i.category,[]);byCat.get(i.category).push(i);
 }
 const split=new Map();
 for(const [cat,items] of byCat){
  if(items.length<70)continue;
  const counts=new Map();for(const i of items){counts.set(i.subcategory,(counts.get(i.subcategory)||0)+1);}
  const qualify=[...counts.entries()].filter(([,n])=>n>=18).sort((a,b)=>b[1]-a[1]).slice(0,4);
  if(qualify.length>=2 && qualify.reduce((sum,[,n])=>sum+n,0)>=Math.ceil(items.length*.55))split.set(cat,new Set(qualify.map(([n])=>n)));
 }
 return split;
}
function destinationFor(item, layout){const sub=(layout.get(item.category)||new Set()).has(item.subcategory)?item.subcategory:null;return {category:item.category,subcategory:sub};}
function planForMoves(plan, scanResult){
 const layout=buildLayout(plan);const folders=new Map(scanResult.folders.map(f=>[f.id,f]));
 return plan.items.filter(i=>i.selected).map(i=>{
  const {category,subcategory}=destinationFor(i,layout);const cur=folders.get(i.parentId);const grand=cur&&folders.get(cur.parentId);
  const unchanged=subcategory?Boolean(cur&&grand&&canonicalName(grand.title)===category&&cleanName(cur.title)===subcategory&&grand.parentId===i.rootId):Boolean(cur&&canonicalName(cur.title)===category&&cur.parentId===i.rootId);
  return {...i,targetCategory:category,targetSubcategory:subcategory,unchanged};
 });
}
return {TAXONOMY,ALIASES,cleanName,canonicalName,scan,heuristic,validateDecision,makePlan,summary,buildLayout,destinationFor,planForMoves};
});

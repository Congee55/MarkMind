/* MarkMind 3.5 — private, offline impression retrieval, no API calls. */
(function(root, factory){ const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api; root.MarkMindImpression=api; })(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 const TYPES=[
  {name:'PDF 转换',q:['pdf转换','pdf格式转换','pdf转word','pdf转图片','转pdf','pdf converter','格式转换网站'],hint:['pdf转','转换pdf','pdf转换','pdf convert','convert pdf','pdf to word','pdf2word','转换文档'],hosts:['ilovepdf','smallpdf','pdf24','pdfcandy','online2pdf','freepdfconvert','pdf2go','adobe.com/acrobat/online','convertio','cloudconvert','zamzar']},
  {name:'PDF 处理',q:['pdf合并','pdf拆分','pdf编辑','pdf压缩','pdf处理'],hint:['pdf编辑','pdf压缩','合并pdf','拆分pdf','pdf merger','pdf editor'],hosts:['ilovepdf','smallpdf','pdf24','pdfcandy','pdf2go']},
  {name:'图片压缩',q:['图片压缩','图像压缩','压缩图片','照片压缩','无损压缩','图片瘦身'],hint:['图片压缩','图像压缩','image compress','image optimizer','tiny png','压缩照片'],hosts:['tinypng','squoosh','compressjpeg','imagecompressor','tinyjpg','iloveimg']},
  {name:'图片处理',q:['图片编辑','在线修图','抠图','去背景','图片格式转换','图像处理'],hint:['图片编辑','抠图','去背景','修图','image editor','remove bg','图片转'],hosts:['remove.bg','photopea','pixlr','iloveimg','cleanup.pictures']},
  {name:'视频下载',q:['视频下载','下载视频','保存视频','视频网站下载'],hint:['视频下载','下载视频','video downloader','yt-dlp','youtube downloader'],hosts:['cobalt.tools','savefrom','y2mate','videodownloadhelper']},
  {name:'视频剪辑',q:['视频剪辑','视频编辑','在线视频编辑','视频制作','剪视频'],hint:['剪辑','视频制作','视频编辑','video editor','capcut'],hosts:['capcut','veed.io','clideo','kapwing']},
  {name:'在线翻译',q:['翻译网站','语言翻译','翻译工具','英文翻译','在线翻译','论文翻译'],hint:['翻译','translate','translator','deepl'],hosts:['deepl','translate.google','youdao','fanyi.baidu','immersivetranslate']},
  {name:'AI 对话',q:['ai聊天','聊天机器人','ai助手','大模型','ai对话','问答助手'],hint:['ai聊天','ai对话','大模型','智能助手','chatbot'],hosts:['chatgpt.com','chat.openai','claude.ai','gemini.google','deepseek.com','kimi.moonshot','doubao.com','perplexity.ai']},
  {name:'论文检索',q:['搜论文','查论文','论文搜索','论文检索','学术搜索','找文献','学术期刊'],hint:['论文检索','学术搜索','文献检索','research paper','scholar'],hosts:['scholar.google','pubmed.ncbi','semanticscholar','webofscience','scopus','cnki.net','wanfangdata','arxiv.org','biorxiv.org']},
  {name:'打字练习',q:['打字','打字练习','键盘练习','打字训练','学打字','提高打字速度'],hint:['打字','typing','键盘训练','键盘练习'],hosts:['typingclub','keybr.com','monkeytype','10fastfingers','typing.com']},
  {name:'思维导图',q:['思维导图','脑图','画脑图','mindmap','思维图'],hint:['思维导图','脑图','mindmap'],hosts:['xmind','mindmeister','whimsical','miro.com','processon.com']},
  {name:'在线笔记',q:['记笔记','在线笔记','笔记软件','知识库','笔记工具'],hint:['在线笔记','知识库','笔记应用','note taking'],hosts:['notion.so','obsidian.md','flomoapp','yuque.com','evernote.com']},
  {name:'在线设计',q:['在线设计','设计素材','平面设计','做海报','设计工具'],hint:['设计工具','模板设计','平面设计','在线设计'],hosts:['canva.com','figma.com','designmodo','photopea.com','pixso.cn']},
  {name:'代码工具',q:['代码编辑','开发工具','写代码','在线编程','代码仓库'],hint:['代码编辑','代码托管','开发工具','编程工具','code editor'],hosts:['github.com','gitlab.com','codepen.io','replit.com','codesandbox.io']},
  {name:'在线课程',q:['在线课程','上网课','课程学习','免费课程','教学视频'],hint:['在线课程','在线学习','课程平台','mooc'],hosts:['coursera.org','edx.org','udemy.com','icourse163.org','xuetangx.com']},
  {name:'网盘存储',q:['网盘','文件存储','云盘','云存储','文件分享'],hint:['云盘','网盘','文件存储','cloud storage'],hosts:['drive.google.com','pan.baidu.com','aliyundrive.com','dropbox.com','onedrive.live.com']}
 ];
 const norm=v=>String(v||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'').replace(/[：:，,。;；!！?？()（）_\-—]/g,'');
 const has=(hay,needle)=>hay.includes(norm(needle));
 function matchesQuery(type,q){return type.q.some(k=>has(norm(k),q)||has(q,k));}
 function typeEvidence(type,bookmark){
  const title=norm(bookmark.title),extra=norm(bookmark.impression),url=norm(bookmark.url),domain=norm(bookmark.domain || (()=>{try{return new URL(bookmark.url).hostname;}catch(_){return '';}})());
  const hostHits=type.hosts.some(x=>has(domain,x)||has(url,x));
  const wordHits=type.hint.some(x=>has(title,x)||has(url,x)||has(extra,x));
  return {hostHits,wordHits};
 }
 function search(bookmarks,query,{limit=80}={}){
  const q=norm(query);if(!q)return [];
  const concepts=TYPES.filter(t=>matchesQuery(t,q));
  const terms=q.split(/[\s/]+/).filter(Boolean);
  const out=[];
  for(const b of bookmarks||[]){
   if(!b.url)continue;
   const name=norm(b.title),url=norm(b.url),path=norm(b.path),domain=norm(b.domain),extra=norm(b.impression);
   let score=0;const reasons=[];
   if(name.includes(q)){score+=120;reasons.push('标题匹配');}
   if(domain.includes(q)||url.includes(q)){score+=90;reasons.push('网址匹配');}
   if(path.includes(q)){score+=28;reasons.push('目录关联');}
   if(extra.includes(q)){score+=72;reasons.push('分类线索');}
   for(const type of concepts){
    const e=typeEvidence(type,b);
    if(e.hostHits){score+=100;reasons.push(type.name+'网站');}
    else if(e.wordHits){score+=78;reasons.push(type.name+'功能');}
   }
   if(!concepts.length && terms.length>1){score+=terms.filter(t=>name.includes(t)||path.includes(t)).length*12;}
   if(score>0)out.push({...b,score,reasons:[...new Set(reasons)].slice(0,2),type:concepts[0]?.name||''});
  }
  return out.sort((a,b)=>b.score-a.score||String(a.title).localeCompare(String(b.title),'zh-CN')).slice(0,limit);
 }
 return {TYPES,search,norm,matchesQuery};
});

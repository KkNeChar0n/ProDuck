/** Runs inside the observed page. Copies rendered content, not application code or credentials. */
export const snapshotExpression = String.raw`(() => {
  const gaps = new Set(); let count = 0;
  const skip = new Set(['SCRIPT','STYLE','LINK','META','NOSCRIPT','TEMPLATE','OBJECT','EMBED']);
  const properties = ['display','position','flex-direction','flex-wrap','align-items','justify-content','gap','grid-template-columns','width','height','max-width','min-height','padding','margin','color','background-color','border','border-radius','font-family','font-size','font-weight','line-height','text-align','box-shadow','overflow'];
  function copy(node, depth=0) {
    if (node.nodeType===3) return document.createTextNode(node.textContent || '');
    if (node.nodeType!==1 || skip.has(node.tagName) || ['password','hidden','file'].includes(node.type)) return null;
    const style=getComputedStyle(node), box=node.getBoundingClientRect();
    if (style.display==='none' || style.visibility==='hidden') return null;
    if (++count>1500 || depth>40) { gaps.add('页面较大，HTML仅保留前1500个可见节点；可补充截图'); return null; }
    if (['CANVAS','IFRAME','VIDEO'].includes(node.tagName) || node.shadowRoot) {
      gaps.add(node.tagName+'内容无法完整转为静态HTML；请检查自动截图，必要时补充截图');
      const placeholder=document.createElement('div'); placeholder.textContent='['+node.tagName+'：请参考截图]'; placeholder.style.cssText='width:'+Math.min(box.width,2000)+'px;height:'+Math.min(box.height,1200)+'px;background:#eee'; return placeholder;
    }
    const tag = /^[a-z][a-z0-9]*$/.test(node.tagName.toLowerCase()) ? node.tagName.toLowerCase() : 'div';
    const out=document.createElement(tag==='form'?'div':tag);
    out.setAttribute('style',properties.map(p=>p+':'+style.getPropertyValue(p)).join(';'));
    if(node.tagName==='IMG') { gaps.add('图片使用占位，外部资源未打包；请参考截图'); out.setAttribute('alt',node.alt||'图片'); return out; }
    if(['INPUT','TEXTAREA','SELECT'].includes(node.tagName)) { const text=document.createElement('span'); text.textContent=String(node.value||node.placeholder||''); return text; }
    for(const child of node.childNodes) {const result=copy(child,depth+1);if(result)out.appendChild(result);}
    return out;
  }
  const body=copy(document.body); const title=document.createElement('title');title.textContent=document.title;
  let html='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'+title.outerHTML+'</head>'+ (body?.outerHTML||'<body></body>')+'</html>';
  if(html.length>1000000){html='';gaps.add('HTML超过大小限制，请使用截图补充');}
  return {html,captureNotes:[...gaps]};
})()`;

/* 注音經文 reader: loads books/index.json + books/<id>.json and lays the text out in the browser.
   直書 right-to-left, one character = one cell (漢字 + 注音 on its right), paginated by the visible viewport:
   one sheet (a page, or two side by side on wide screens — right page first) = one screen, a sentence is never
   split across pages, gaps between sheets, scroll-snap. Re-paginates on resize / rotation / A−A＋. */
(function(){
'use strict';
var D=document, R=D.documentElement, $=function(i){return D.getElementById(i);};
var sc=$('sc'), app=$('app');
var VF={'「':'﹁','」':'﹂','『':'﹃','』':'﹄','（':'︵','）':'︶','《':'︽','》':'︾','〈':'︿','〉':'﹀','【':'︻','】':'︼','〔':'︹','〕':'︺','—':'︱','…':'︙','─':'︱'};
var OPEN='「『（《〈【〔', END='，。、；：！？」』）》〉】〕';
var TONES='ˊˇˋ';
var st={book:null,items:[],sheets:[],pages:[],cur:0,s:0,spread:false,rt:0,imm:false,native:false};
/* corner ornament (捲草角花): drawn for the top-left corner, symmetric about its diagonal; the other corners are CSS mirror
   images. Heart with its tip in the corner and a spiral in each lobe; from it a scroll arm runs along each edge and
   ends in a curl. Double outline = a thick ink stroke with a thin paper-coloured stroke on top. */
var CN_HALF='M2 2C10 0 26 0 29 9C31 16 24 21 17 17'+                               // heart: upper half (tip in the corner -> lobe -> cleft)
  'M9 6C15 3 24 6 22 11C20.5 15 15 14.5 15.5 11C16 8.5 19 8.6 19 10.4'+           // spiral in the upper lobe
  'M17 17C24 19 28 14 33 11C38 8 44 8 47 10C51 13 49 19 44.5 18.5C41 18 41 13.5 44 13.3C46 13.2 46.5 15.4 45 16'+  // arm along the top edge, ending in a curl
  'M33 11C33.5 15 37 16.5 40 15.5'+                                                // small leaf on the arm
  'M47 10C49 6 52 3 56 2.2L64 2.2';                                                // tail running into the frame line
var CN_PATH=CN_HALF+' '+CN_HALF.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g,function(_,x,y){return y+' '+x;});   // mirror across the diagonal
var CORNER='<svg class="cn %C" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">'+
  '<path d="M0 0L54 0L54 12L22 12L12 22L12 54L0 54Z" style="fill:var(--paper)" stroke="none"/>'+   // the frame lines stop at the ornament
  '<path d="'+CN_PATH+'" stroke="currentColor" stroke-width="3"/><path d="'+CN_PATH+'" style="stroke:var(--paper)" stroke-width="1"/></svg>';
function cnum(n){var d='〇一二三四五六七八九';if(n<=10)return n===10?'十':d[n];if(n<20)return '十'+(n%10?d[n%10]:'');
  if(n<100)return d[Math.floor(n/10)]+'十'+(n%10?d[n%10]:'');var h=Math.floor(n/100),r=n%100;return d[h]+'百'+(r?(r<10?'〇'+d[r]:(r<20?'一':'')+cnum(r)):'');}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function cellHTML(ch,zy){
  if(ch==='\u3000'||ch===' ') return '<span class="c p sp"><span class="h">\u3000</span></span>';
  if(!zy||zy==='-') return '<span class="c p"><span class="h">'+esc(VF[ch]||ch)+'</span></span>';
  var light=zy.charAt(0)==='˙', b=zy.replace(/^˙/,''), t=TONES.indexOf(b.slice(-1))>=0?b.slice(-1):''; if(t) b=b.slice(0,-1);
  return '<span class="c"><span class="h">'+esc(ch)+'</span><span class="z" aria-hidden="true">'+(light?'<span class="l">˙</span>':'')+esc(b)+(t?'<span class="t">'+t+'</span>':'')+'</span></span>';
}
/* book -> items: {t:'brk', w} (start a new column, w = extra gap in columns), {t:'head', units}, {t:'sent', units}
   unit = {k: cells, html}; opening punctuation sticks to the next char, closing punctuation to the previous unit */
function toUnits(text,zy){
  var ch=Array.from(text), zs=String(zy).trim().split(/\s+/);
  if(zs.length!==ch.length) console.warn('zy count mismatch',text,ch.length,zs.length);
  var us=[],pend=[];
  ch.forEach(function(c,i){var z=zs[i]||'-', p=(z==='-');
    if(p&&OPEN.indexOf(c)>=0){pend.push([c,z]);return;}
    if(p&&us.length&&!pend.length&&c!=='\u3000'){us[us.length-1].push([c,z]);return;}
    us.push(pend.concat([[c,z]]));pend=[];});
  if(pend.length) us.push(pend);
  return us.map(function(u){return {k:u.length,cs:u,end:END.indexOf(u[u.length-1][0])>=0||u[u.length-1][0]==='\u3000',html:u.map(function(x){return cellHTML(x[0],x[1]);}).join('')};});
}
function sentences(us){var out=[],cur=[];us.forEach(function(u){cur.push(u);if(u.end){out.push(cur);cur=[];}});if(cur.length)out.push(cur);return out;}
function buildItems(b){
  var it=[], first=true;
  b.blocks.forEach(function(bl){
    if(bl.type==='heading'){ it.push({t:'brk',w:first?0:.5}); it.push({t:'head',units:toUnits(bl.lines[0][0],bl.lines[0][1])}); first=false; return; }
    if(bl.type==='section'){ it.push({t:'page'}); return; }
    it.push({t:'brk',w:first?0:.4});
    bl.lines.forEach(function(ln,j){
      if(j&&bl.type==='verse') it.push({t:'brk',w:0});
      var us=toUnits(ln[0],ln[1]);
      if(bl.type==='verse') it.push({t:'sent',units:us});            // a verse line is kept on one page
      else sentences(us).forEach(function(s){it.push({t:'sent',units:s});});
    });
    first=false;
  });
  return it;
}
/* ---- pagination ---- */
function px(){return parseFloat(getComputedStyle(R).getPropertyValue('--s'))||30;}
function metrics(){var cs=getComputedStyle(R);return {cw:parseFloat(cs.getPropertyValue('--cw'))||1.72,ch:parseFloat(cs.getPropertyValue('--ch'))||1.26};}
function defSize(){var w=window.innerWidth,h=window.innerHeight;return w>=900?Math.max(26,Math.min(36,Math.round(h/24))):Math.max(22,Math.min(30,Math.round(Math.min(w/13.5,h/27))));}
function sizeKey(){return 'reader.d.'+(window.innerWidth>=900?'w':'n');}   // A−/A＋ offset in px, on top of the book's scale
function bookScale(){var b=st.book,v=b&&+(b.scale||b.fontScale);return v>0.4&&v<2?v:1;}
function curSize(){return Math.max(16,Math.min(60,Math.round(defSize()*bookScale())+(st.d||0)));}
function leafSkeleton(cls){
  var l=D.createElement('div'); l.className='leaf'+(cls?' '+cls:'');
  l.innerHTML='<div class="side"><span class="sn"></span><span class="pg"></span></div><div class="fr">'+
    ['tr','tl','br','bl'].map(function(c){return CORNER.replace('%C',c);}).join('')+'<div class="bd"></div></div>';
  return l;
}
function paginate(anchor){
  var b=st.book; if(!b) return;
  var s=curSize(); st.s=s; R.style.setProperty('--s',s+'px');
  var W=sc.clientWidth, H=sc.clientHeight; if(H<120||W<120) return;
  var sp=W<600?8:14, gut=W<600?0:Math.round(s*.9);
  st.spread=W>=900&&W>H*1.15;
  sc.style.setProperty('--sp',sp+'px'); sc.style.setProperty('--gut',gut+'px');
  var LH=H-2*sp, LW=st.spread?Math.min((W-2*sp-gut)/2,LH*0.82):Math.min(W-2*sp,st.spread?9999:LH*0.9);
  if(!st.spread&&W>=600) LW=Math.min(W-2*sp,Math.max(LH*0.72,Math.min(W-2*sp,560)));
  if(W<600) LW=W-2*sp;
  // measure the text box of an empty leaf
  sc.innerHTML=''; var sh=D.createElement('div'); sh.className='sheet'; sh.style.height=H+'px'; var pr=leafSkeleton('r'); pr.style.width=LW+'px'; sh.appendChild(pr); sc.appendChild(sh);
  var fr=pr.querySelector('.fr'), padV=Math.round(s*1.05), padH=Math.round(s*.42);
  var BW=fr.clientWidth-2*padH, BH=fr.clientHeight-2*padV;
  var m=metrics(), cellH=s*m.ch, colW=s*m.cw+2*s*.12+1;
  var rows=Math.max(4,Math.floor(BH/cellH)), cols=Math.max(2,Math.floor(BW/colW));
  var cw=BW/cols;                      // columns spread evenly over the box (界行)
  var topPad=Math.max(0,(BH-rows*cellH)/2);
  // fill: pages = [{cols:[[html...]], title:bool}]
  var pages=[], pg=null, c=0, n=0, colArr=null;
  function newPage(){pg={cols:[],first:pages.length===0};pages.push(pg);c=0;n=0;colArr=null;}
  function newCol(extra){ if(colArr&&colArr.extra==null) {} colArr={u:[],ui:[],gap:extra||0,uid:[]}; pg.cols.push(colArr); c+=1+(extra||0); n=0; }
  newPage();
  // title page: 經名 + 譯者 columns
  var titleW=Math.min(cols-1, b.translator?2:1.3);
  pg.title=true; c=titleW; colArr=null;
  function sim(units,forceCol){ // columns this sentence needs from the current state; returns end c
    var cc=c, nn=n, has=!!colArr;
    if(forceCol||!has){cc+=1+(forceCol&&forceCol.w||0);nn=0;has=true;}
    units.forEach(function(u){ if(nn+u.k>rows){cc+=1;nn=0;} nn+=u.k; });
    return cc;
  }
  function put(units,forceCol){
    if(forceCol||!colArr) newCol(forceCol&&forceCol.w);
    units.forEach(function(u){ if(n+u.k>rows){ if(c+1>cols){newPage();} newCol(0);} colArr.u.push(u.html); colArr.ui.push(u.i); n+=u.k; });
  }
  var pendBrk=null, idx=0;
  st.items.forEach(function(it){
    if(it.t==='page'){ if(pg.cols.length||pg.title&&pg.cols.length) newPage(); pendBrk=null; return; }
    if(it.t==='brk'){ pendBrk={w:it.w}; return; }
    var units=it.units; units.forEach(function(u){u.i=idx++;});
    var fc=pendBrk; pendBrk=null;
    if(it.t==='head'){ fc=fc||{w:0}; }
    var endc=sim(units,fc);
    if(endc>cols && (pg.cols.length||pg.title)){
      // does not fit in what is left of this page: start the next page (a sentence is never split, unless it is longer than a page)
      var c0=c,n0=n,ca=colArr; newPage(); var endc2=sim(units,{w:0});
      if(endc2>cols){ /* longer than a page: flow across pages */ }
      put(units,{w:0});
    } else put(units,fc);
    if(it.t==='head'){ colArr.head=true; colArr=null; }
    units.forEach(function(u){ (colArr||pg.cols[pg.cols.length-1]).uid.push(u.i); });
  });
  st.pages=pages;
  // render
  sc.innerHTML=''; st.sheets=[];
  var per=st.spread?2:1, nS=Math.ceil(pages.length/per);
  for(var si=0;si<nS;si++){
    if(si){ var g=D.createElement('div'); g.className='gap'; g.setAttribute('aria-hidden','true'); var p1=si*per+1; g.textContent=per===2&&pages[p1]?cnum(p1)+'・'+cnum(p1+1):cnum(p1); sc.appendChild(g); }
    var sheet=D.createElement('div'); sheet.className='sheet'; sheet.style.height=H+'px'; sheet.dataset.i=si;
    for(var j=0;j<per;j++){
      var pi=si*per+j, P=pages[pi], leaf=leafSkeleton(per===2?(j===0?'r':''):'');
      leaf.style.width=LW+'px';
      if(!P){ leaf.classList.add('blank'); sheet.appendChild(leaf); continue; }
      leaf.dataset.p=pi;
      leaf.querySelector('.sn').textContent=b.short||b.title; leaf.querySelector('.pg').textContent=cnum(pi+1);
      var bd=leaf.querySelector('.bd'); bd.style.cssText='top:'+padV+'px;bottom:'+padV+'px;right:'+padH+'px;left:'+padH+'px';
      var h='';
      if(P.title){ var tfs=Math.min(s*1.3,rows*cellH*.94/(Array.from(b.title).length*1.18),cw*1.25*.8);
        h+='<div class="col tcol" style="width:'+(cw*(b.translator?1.25:1.3))+'px;height:'+(rows*cellH)+'px"><div class="tc" style="font-size:'+tfs.toFixed(1)+'px">'+esc(b.title)+'</div></div>';
        if(b.translator) h+='<div class="col tcol" style="width:'+(cw*.75)+'px;height:'+(rows*cellH)+'px;justify-content:flex-end"><div class="tt">'+esc(b.translator)+'</div></div>'; }
      P.cols.forEach(function(cl,k){ var w=cw;   // a block's first column: the extra gap goes on its right, between it and the previous block (as on the site's 經文 pages, .col.nb margin-right)
        h+='<div class="col'+(cl.head?' hd':'')+'" data-u="'+(cl.uid[0]!=null?cl.uid[0]:'')+'" style="width:'+w+'px;height:'+(rows*cellH+topPad)+'px;padding-top:'+topPad+'px;'+(cl.gap?'margin-right:'+(cw*cl.gap)+'px;':'')+'">'+cl.u.map(function(x,q){ return '<span class="u" data-i="'+cl.ui[q]+'">'+x+'</span>'; }).join('')+'</div>'; });
      bd.innerHTML=h;
      st.sheets.length; sheet.appendChild(leaf);
    }
    sc.appendChild(sheet); st.sheets.push(sheet);
  }
  // keep the reader's place
  var k=0; if(anchor!=null){ for(var q=0;q<pages.length;q++){ if(pages[q].cols.some(function(cl){return cl.uid.indexOf(anchor)>=0;})){k=Math.floor(q/per);break;} } }
  go(k,false);
  hook('layout');
}
function hook(n){ (window.__readerHooks||[]).forEach(function(f){ try{ f(n,st); }catch(e){ console.error(e); } }); }
function anchorNow(){ var sh=st.sheets[st.cur]; if(!sh) return null; var cl=sh.querySelectorAll('.col[data-u]'); for(var i=0;i<cl.length;i++){ if(cl[i].dataset.u!=='') return +cl[i].dataset.u; } return null; }
function relayout(){ paginate(anchorNow()); }
function later(){ clearTimeout(st.rt); st.rt=setTimeout(relayout,150); }
/* ---- paging ---- */
function label(){ var n=st.sheets.length, per=st.spread?2:1, a=st.cur*per+1, b=Math.min(st.pages.length,a+per-1);
  $('pn').textContent=n?(a===b?'第'+cnum(a)+'頁':'第'+cnum(a)+'・'+cnum(b)+'頁')+' ／ '+cnum(st.pages.length):'';
  $('pv').disabled=st.cur<=0; $('nx').disabled=st.cur>=n-1; }
window.__readerAPI={st:st,go:function(k,smooth){go(k,smooth);},relayout:function(){relayout();}};
function go(k,smooth){ var n=st.sheets.length; if(!n) return; k=Math.max(0,Math.min(n-1,k)); st.cur=k; sc.scrollTo({top:st.sheets[k].offsetTop,behavior:smooth?'smooth':'auto'}); label(); }
function step(d){ go(st.cur+d,true); }
sc.addEventListener('scroll',function(){ if(st.sf) return; st.sf=requestAnimationFrame(function(){ st.sf=0; var y=sc.scrollTop+sc.clientHeight*.4,k=0; for(var i=0;i<st.sheets.length;i++){ if(st.sheets[i].offsetTop<=y) k=i; else break; } st.cur=k; label(); }); },{passive:true});
$('pv').onclick=function(){step(-1);}; $('nx').onclick=function(){step(1);};
$('fm').onclick=function(){ zoom(-2); }; $('fp').onclick=function(){ zoom(2); };
function zoom(d){ var a=anchorNow(), b=Math.round(defSize()*bookScale()); st.d=Math.max(16-b,Math.min(60-b,(st.d||0)+d)); try{localStorage.setItem(sizeKey(),st.d);}catch(e){} paginate(a); }
/* ---- fullscreen: Fullscreen API (+webkit); iPhone Safari has no element fullscreen -> immersive mode (bars hidden) ---- */
function fsEl(){ return D.fullscreenElement||D.webkitFullscreenElement||null; }
function setImm(on){ st.imm=on; R.classList.toggle('imm',on); $('fx').hidden=!on; later(); }
function enterFs(){ var rq=R.requestFullscreen||R.webkitRequestFullscreen; st.native=false;
  if(rq&&(D.fullscreenEnabled||D.webkitFullscreenEnabled)){ try{ var p=rq.call(R); st.native=true; if(p&&p.catch) p.catch(function(){st.native=false;}); }catch(e){ st.native=false; } }
  setImm(true); try{sc.focus({preventScroll:true});}catch(e){} }
function exitFs(){ if(fsEl()){ var ex=D.exitFullscreen||D.webkitExitFullscreen; try{ var p=ex.call(D); if(p&&p.catch)p.catch(function(){}); }catch(e){} } st.native=false; setImm(false); }
function onFs(){ if(!fsEl()&&st.imm&&st.native){ st.native=false; setImm(false); } else later(); }
D.addEventListener('fullscreenchange',onFs); D.addEventListener('webkitfullscreenchange',onFs);
$('fs').onclick=function(){ st.imm?exitFs():enterFs(); }; $('fx').onclick=exitFs;
D.addEventListener('keydown',function(e){
  if(!st.book||e.ctrlKey||e.metaKey||e.altKey) return; var tn=(e.target&&e.target.tagName)||'';
  if(e.key==='Escape'||e.key==='Esc'){ if(st.imm){ e.preventDefault(); exitFs(); } return; }
  if(tn==='INPUT'||tn==='SELECT'||tn==='TEXTAREA') return;
  var k=e.key,d=0;
  if(k==='ArrowDown'||k==='ArrowLeft'||k==='PageDown') d=1;            // 直書: the next page is to the left / below
  else if(k==='ArrowUp'||k==='ArrowRight'||k==='PageUp') d=-1;
  else if(k===' '||k==='Spacebar'){ if(tn==='BUTTON') return; d=e.shiftKey?-1:1; }
  else if(k==='Home'){ e.preventDefault(); go(0,true); return; } else if(k==='End'){ e.preventDefault(); go(st.sheets.length-1,true); return; }
  if(d){ e.preventDefault(); step(d); }
});
window.addEventListener('resize',later); window.addEventListener('orientationchange',later);
if(window.visualViewport) window.visualViewport.addEventListener('resize',later);
/* ---- load ---- */
function getJSON(u){ return fetch(u,{cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error(u+' '+r.status); return r.json(); }); }
function library(idx){ app.hidden=true; $('libv').hidden=false; D.title='注音經文';
  $('libl').innerHTML=idx.books.map(function(b){ return '<li><a href="?book='+encodeURIComponent(b.id)+'">'+esc(b.title)+(b.note?'<small>'+esc(b.note)+'</small>':'')+'</a></li>'; }).join(''); }
var id=new URLSearchParams(location.search).get('book');
getJSON('books/index.json').then(function(idx){
  if(!id){ library(idx); return; }
  var e=idx.books.filter(function(b){return b.id===id;})[0];
  if(!e){ library(idx); return; }
  return getJSON('books/'+(e.file||(e.id+'.json'))).then(function(b){
    st.book=b; st.items=buildItems(b); D.title=b.title; $('bt').textContent=b.title;
    try{ var v=parseFloat(localStorage.getItem(sizeKey())); if(v>=-30&&v<=30) st.d=v; }catch(x){}
    paginate(null);
    if(D.fonts&&D.fonts.ready) D.fonts.ready.then(function(){ relayout(); });
    window.__reader=st; hook('book');
  });
}).catch(function(err){ D.body.insertAdjacentHTML('beforeend','<p style="position:fixed;top:40%;width:100%;text-align:center;font:16px system-ui">無法載入經文資料：'+esc(err.message)+'</p>'); });
})();

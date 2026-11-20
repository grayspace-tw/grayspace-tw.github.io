/* 注音經文 reader — 朗讀 (read aloud) with the browser's speech synthesis (zh-TW voice preferred).
   Text comes from the book data (漢字 only; the 注音 is never spoken). The text is split at punctuation into
   short phrases, one utterance per phrase, spoken one after another by this player:
     pause  = speechSynthesis.cancel() + remember the phrase index (the native pause()/resume() are not used)
     resume = speak that phrase again from its start (sentence-level precision)
   A generation counter makes the onend/onerror of a cancelled utterance a no-op.
   Pronunciation: optional books/<id>.tts.json (tools/gen_tts.py) lists TTS-only substitutions
   {from, to, zy}: where the text equals `from` and its 注音 equals `zy`, the voice is given `to` (a homophone
   with exactly the annotated reading), so it follows the book's 注音. Display text is never changed. */
(function(){
'use strict';
var D=document, $=function(i){return D.getElementById(i);};
var api=window.__readerAPI; if(!api) return;
var st=api.st, sc=$('sc');
var SS=window.speechSynthesis, UT=window.SpeechSynthesisUtterance;
var STOP='，。、；：！？', HAN=/[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{3ffff}]/u;
var RATES=[1,1.25,0.75];
var P={phr:[],u2p:{},idx:0,gen:0,state:'idle',rate:1,voice:null,subs:[],bookId:null,pausedSheet:-1,wd:0,errs:0,marked:[],cur:null,log:[],msgT:0};
try{ var r=parseFloat(localStorage.getItem('reader.ttsRate')); if(RATES.indexOf(r)>=0) P.rate=r; }catch(e){}
function log(ev,i,x){ P.log.push({t:Math.round(performance.now()),ev:ev,i:i,gen:P.gen,x:x}); if(P.log.length>3000) P.log.shift(); }

/* ---- UI ---- */
var tp=$('tp'), pl=$('tpl'), pp=$('tpp'), ps=$('tps'), pr=$('tpr'), msgEl=$('tmsg');
function msg(t,ms){ msgEl.textContent=t; msgEl.hidden=!t; clearTimeout(P.msgT); if(t) P.msgT=setTimeout(function(){ msgEl.hidden=true; },ms||6000); }
function ui(){
  var s=P.state, lab=s==='playing'?['⏸\uFE0E','暫停']:s==='paused'?['▶\uFE0E','繼續']:['▶\uFE0E','朗讀'];
  tp.innerHTML=lab[0]+'<span class="lt2"> '+lab[1]+'</span>'; tp.setAttribute('aria-label',lab[1]+(s==='idle'?'經文':'朗讀')); tp.setAttribute('aria-pressed',s==='playing'?'true':'false');
  pp.textContent=lab[0]+' '+lab[1]; pl.hidden=(s==='idle'); pr.textContent=P.rate+'×'; pr.setAttribute('aria-label','朗讀速度 '+P.rate+' 倍');
  D.documentElement.classList.toggle('tts-act',s!=='idle');
}

/* ---- phrases from the book data ---- */
function build(){
  P.phr=[]; P.u2p={};
  st.items.forEach(function(it){
    if(it.t!=='sent'&&it.t!=='head') return;
    var cur=[], n=0;
    function flush(){ if(cur.length){ var k=P.phr.length; P.phr.push({units:cur}); cur.forEach(function(u){ P.u2p[u.i]=k; }); } cur=[]; n=0; }
    it.units.forEach(function(u){ cur.push(u); n+=u.k; if(u.end||n>=48) flush(); });
    flush();
  });
}
function allowPinyin(){ return !!(P.voice&&/google/i.test(P.voice.name)); }   // numbered pinyin was only checked with Google voices
function spoken(ph){
  var ch=[], zy=[], tail='';
  ph.units.forEach(function(u){ u.cs.forEach(function(x){ var c=x[0], z=x[1];
    if(z&&z!=='-'){ ch.push(c); zy.push(z); tail=''; }
    else if(HAN.test(c)){ ch.push(c); zy.push('-'); tail=''; }
    else if(STOP.indexOf(c)>=0){ tail=c; } }); });
  var out=ch.slice(), done=[], text=ch.join('');
  P.subs.forEach(function(s){
    var L=Array.from(s.from).length, j=text.indexOf(s.from);
    var py=!HAN.test(s.to); if(py&&!allowPinyin()) return;
    while(j>=0){ var a=Array.from(text.slice(0,j)).length, ok=true;
      for(var q=a;q<a+L;q++) if(done[q]) ok=false;
      if(ok&&zy.slice(a,a+L).join(' ')===s.zy){ var to=Array.from(s.to);
        for(q=0;q<L;q++){ out[a+q]=(to.length===L&&!py)?to[q]:(q?'':' '+s.to.trim()+' '); done[a+q]=true; } }
      j=text.indexOf(s.from,j+1); }
  });
  return (out.join('').replace(/\s+/g,' ').trim()+tail);
}
function loadSubs(id){
  P.subs=[]; if(!id) return;
  fetch('books/'+encodeURIComponent(id)+'.tts.json',{cache:'no-cache'}).then(function(r){ return r.ok?r.json():null; }).then(function(j){
    if(!j||!Array.isArray(j.subs)||P.bookId!==id) return;
    P.subs=j.subs.filter(function(s){ return s&&s.from&&s.to&&s.zy; }).sort(function(a,b){ return Array.from(b.from).length-Array.from(a.from).length; });
  }).catch(function(){});   // a book without a map is read as written
}

/* ---- voice ---- */
function norm(l){ return String(l||'').replace(/_/g,'-').toLowerCase(); }
function pickVoice(){
  var vs=(SS&&SS.getVoices())||[]; if(!vs.length) return undefined;   // list not known (yet): use lang only
  var tw=vs.filter(function(v){ var l=norm(v.lang); return l==='zh-tw'||l.indexOf('zh-hant-tw')===0||l.indexOf('cmn-hant-tw')===0; });
  var pref=[/google/i,/美佳|mei-?jia/i,/hsiaochen|曉臻|hsiaoyu|曉雨|hanhan|涵涵|yating|雅婷|zhiwei|志瑋/i];
  for(var k=0;k<pref.length;k++){ for(var j=0;j<tw.length;j++) if(pref[k].test(tw[j].name)) return tw[j]; }
  if(tw.length) return tw[0];
  var zh=vs.filter(function(v){ var l=norm(v.lang); return (l.indexOf('zh')===0||l.indexOf('cmn')===0)&&!/hk|yue|mo$/.test(l); });
  return zh[0]||null;
}

/* ---- highlight + page follow ---- */
function unmark(){ P.marked.forEach(function(e){ e.classList.remove('tts-on'); }); P.marked=[]; }
function mark(i){
  unmark(); var ph=P.phr[i]; if(!ph) return null;
  ph.units.forEach(function(u){ var e=sc.querySelector('.u[data-i="'+u.i+'"]'); if(e){ e.classList.add('tts-on'); P.marked.push(e); } });
  return P.marked[0]||null;
}
function sheetOf(el){ var sh=el&&el.closest('.sheet'); return sh?st.sheets.indexOf(sh):-1; }
function follow(i){ var e=mark(i), k=sheetOf(e); if(k>=0&&k!==st.cur){ log('turn',i,k); api.go(k,true); } }
function firstOnSheet(k){
  var sh=st.sheets[k]; if(!sh) return 0; var us=sh.querySelectorAll('.u[data-i]'), m=Infinity;
  for(var q=0;q<us.length;q++) m=Math.min(m,+us[q].dataset.i);
  if(m===Infinity){ for(var s2=k+1;s2<st.sheets.length;s2++){ var f=st.sheets[s2].querySelector('.u[data-i]'); if(f){ m=+f.dataset.i; break; } } }
  return m===Infinity?0:(P.u2p[m]!=null?P.u2p[m]:0);
}

/* ---- player ---- */
function cancelNow(){ try{ SS.cancel(); }catch(e){} }
function speak(i,sync){
  var g=++P.gen; clearTimeout(P.wd); P.idx=i;
  if(i>=P.phr.length){ log('done',i); P.state='idle'; unmark(); ui(); msg('朗讀完畢'); return; }
  follow(i);
  var txt=spoken(P.phr[i]);
  if(!/[^\s，。、；：！？]/.test(txt)){ setTimeout(function(){ if(g===P.gen&&P.state==='playing') speak(i+1); },0); return; }
  var u=new UT(txt); u.lang=P.voice?P.voice.lang:'zh-TW'; if(P.voice) u.voice=P.voice; u.rate=P.rate;
  u.onstart=function(){ if(g===P.gen) log('start',i); };
  u.onend=function(){ if(g!==P.gen){ log('stale-end',i); return; } log('end',i); clearTimeout(P.wd); P.errs=0; if(P.state==='playing') speak(i+1); };
  u.onerror=function(e){ if(g!==P.gen) return; var er=e&&e.error; log('error',i,er);
    if(er==='interrupted'||er==='canceled') return;
    if(er==='not-allowed'){ P.gen++; P.state='paused'; P.pausedSheet=st.cur; ui(); msg('瀏覽器要先點一下才能朗讀，請再按「▶ 繼續」。'); return; }
    if(++P.errs>3){ stop(); msg('朗讀發生錯誤（'+er+'），已停止。'); return; }
    speak(i+1); };
  P.cur=u;   // keep a reference (Chrome may otherwise drop the events)
  function go(){ if(g!==P.gen||P.state!=='playing') return; log('speak',i,txt); SS.speak(u);
    var lim=8000+Array.from(txt).length*700/P.rate;   // no onend in time (engine stuck): skip to the next phrase
    P.wd=setTimeout(function(){ if(g!==P.gen||P.state!=='playing') return; log('watchdog',i); P.gen++; cancelNow(); setTimeout(function(){ if(P.state==='playing') speak(i+1); },150); },lim); }
  if(sync) go(); else setTimeout(go,0);
}
function start(i){
  P.state='playing'; ui();
  if(SS.speaking||SS.pending){ P.gen++; cancelNow(); var g=P.gen; setTimeout(function(){ if(g===P.gen&&P.state==='playing') speak(i,true); },120); }
  else speak(i,true);   // synchronously inside the tap: iOS only allows speech started by a user gesture
}
function play(){
  if(!SS||!UT){ msg('這個瀏覽器不支援朗讀（speechSynthesis）。'); return; }
  if(!st.book||!st.sheets.length) return;
  if(P.state==='playing') return;
  var v=pickVoice();
  if(v===null){ msg('這台裝置沒有中文語音，無法朗讀。可在系統設定加入「中文（臺灣）」語音後再試。',9000); return; }
  P.voice=v||null;
  if(v&&norm(v.lang)!=='zh-tw'&&norm(v.lang).indexOf('hant-tw')<0) msg('找不到臺灣國語語音，改用「'+v.name+'」，讀音可能不同。');
  if(!P.phr.length) build();
  var i=(P.state==='paused'&&st.cur===P.pausedSheet)?P.idx:firstOnSheet(st.cur);
  log(P.state==='paused'?'resume':'play',i,v?v.name:'(lang zh-TW)');
  start(i);
}
function pause(){ if(P.state!=='playing') return; P.gen++; clearTimeout(P.wd); P.state='paused'; P.pausedSheet=st.cur; cancelNow(); log('pause',P.idx); ui(); }
function stop(){ var was=P.state; P.gen++; clearTimeout(P.wd); P.state='idle'; P.pausedSheet=-1; cancelNow(); unmark(); if(was!=='idle') log('stop',P.idx); ui(); }
function setRate(){ P.rate=RATES[(RATES.indexOf(P.rate)+1)%RATES.length]; try{ localStorage.setItem('reader.ttsRate',P.rate); }catch(e){} log('rate',P.idx,P.rate); ui();
  if(P.state==='playing') start(P.idx); }
tp.onclick=function(){ P.state==='playing'?pause():play(); };
pp.onclick=tp.onclick; ps.onclick=stop; pr.onclick=setRate;
D.addEventListener('visibilitychange',function(){ if(D.hidden&&P.state==='playing'){ log('hidden',P.idx); pause(); } });
window.addEventListener('pagehide',function(){ stop(); });
D.addEventListener('click',function(e){ var a=e.target.closest&&e.target.closest('a[href]'); if(a&&P.state!=='idle'){ log('nav',P.idx,a.getAttribute('href')); stop(); } },true);
if(SS){ try{ SS.getVoices(); if(SS.addEventListener) SS.addEventListener('voiceschanged',function(){ if(P.state==='idle') P.voice=null; }); }catch(e){} }
(window.__readerHooks=window.__readerHooks||[]).push(function(n){
  if(n==='book'){ stop(); P.phr=[]; P.bookId=st.book&&st.book.id; loadSubs(P.bookId); }
  else if(n==='layout'&&P.phr.length){ if(P.state!=='idle'){ var e=mark(P.idx); if(P.state==='playing'){ var k=sheetOf(e); if(k>=0&&k!==st.cur) api.go(k,false); } else P.pausedSheet=st.cur; } }
});
if(st.book){ P.bookId=st.book.id; loadSubs(P.bookId); }
ui();
window.__tts={P:P,play:play,pause:pause,stop:stop,spoken:function(i){ if(!P.phr.length) build(); return spoken(P.phr[i]); },build:build,firstOnSheet:firstOnSheet};
})();

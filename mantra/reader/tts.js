/* 注音經文 reader — 朗讀 (read aloud) with the browser's speech synthesis (zh-TW voice preferred).
   Text comes from the book data (漢字 only; the 注音 is never spoken). The text is split at punctuation into
   short phrases, one utterance per phrase, spoken one after another by this player:
     pause  = speechSynthesis.cancel() + remember the phrase index (the native pause()/resume() are not used)
     resume = speak that phrase again from its start (sentence-level precision)
   A generation counter makes the onend/onerror of a cancelled utterance a no-op.
   Pronunciation: optional books/<id>.tts.json (tools/gen_tts.py) lists TTS-only substitutions
   {from, to, zy}: where the text equals `from` and its 注音 equals `zy`, the voice is given `to` (a homophone
   with exactly the annotated reading), so it follows the book's 注音. Display text is never changed.
   Tap/click a character: start (idle) or jump (playing/paused) to the phrase that contains it.
   經名: read first (phrase 0, from book.title + book.title_zy, highlighted on the title column) and again after the last sentence (closing 經名, same 注音); the 譯者 line is not read.
   Playback controls live in the top toolbar (the old bottom floating bar is gone, River 2026-11-21).
   Voice: a Taiwan Mandarin voice is chosen automatically (lang zh-TW / zh_TW / zh-Hant-TW / cmn-TW / cmn-Hant-TW, or a
   known Taiwan voice name); the list is re-read when the browser loads it late (voiceschanged).
   Beside the speed button: 女／男 and 臺／陸／港 (only options whose voices exist on this device). A change restarts
   the current sentence; choices are remembered (localStorage reader.ttsGender, reader.ttsRegion, reader.ttsVoice).
   Quotes/brackets never start a phrase on their own, and are never sent to the voice (River 2026-11-23).
   At 1.25×／1.5×, consecutive clauses (，、；：) are merged so the engine's own pauses scale with rate; 1× phrasing is unchanged. */
(function(){
'use strict';
var D=document, $=function(i){return D.getElementById(i);};
var api=window.__readerAPI; if(!api) return;
var st=api.st, sc=$('sc');
var SS=window.speechSynthesis, UT=window.SpeechSynthesisUtterance;
var STOP='，。、；：！？', HAN=/[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{3ffff}]/u;
var RATES=[1,1.25,1.5];   // River 2026-11-20: only 1×, 1.25×, 1.5× (rate passed as is)
var P={phr:[],u2p:{},idx:0,gen:0,state:'idle',rate:1,voice:null,region:'TW',gender:'F',subs:[],bookId:null,pausedSheet:-1,wd:0,errs:0,marked:[],cur:null,log:[],msgT:0};
try{ var r=parseFloat(localStorage.getItem('reader.ttsRate')); if(RATES.indexOf(r)>=0) P.rate=r; else if(!isNaN(r)) localStorage.setItem('reader.ttsRate','1'); }catch(e){}   // an old saved 2 / 0.75 / 0.5 -> 1×
var RKEY='reader.ttsRegion', GKEY='reader.ttsGender';
try{ var rg=localStorage.getItem(RKEY); if(rg==='TW'||rg==='CN'||rg==='HK') P.region=rg;
     var gg=localStorage.getItem(GKEY); if(gg==='F'||gg==='M') P.gender=gg; }catch(e){}
function log(ev,i,x){ P.log.push({t:Math.round(performance.now()),ev:ev,i:i,gen:P.gen,x:x}); if(P.log.length>3000) P.log.shift(); }

/* ---- UI ---- */
var tp=$('tp'), pl=$('tpl'), pp=$('tpp'), ps=$('tps'), pr=$('tpr'), pv=$('tpv'), msgEl=$('tmsg');
var VKEY='reader.ttsVoice';
function msg(t,ms){ msgEl.textContent=t; msgEl.hidden=!t; clearTimeout(P.msgT); if(t) P.msgT=setTimeout(function(){ msgEl.hidden=true; },ms||6000); }
function ui(){
  var s=P.state, lab=s==='playing'?['⏸\uFE0E','暫停']:s==='paused'?['▶\uFE0E','繼續']:['▶\uFE0E','朗讀'];
  tp.innerHTML=lab[0]+'<span class="lt2"> '+lab[1]+'</span>'; tp.setAttribute('aria-label',lab[1]+(s==='idle'?'經文':'朗讀')); tp.setAttribute('aria-pressed',s==='playing'?'true':'false');
  if(pp) pp.textContent=lab[0]+' '+lab[1];
  var ctl=$('tctl'); if(ctl) ctl.hidden=(s==='idle');
  if(pl) pl.hidden=true;   // floating bar removed (River 2026-11-21: it covered the text); controls live in #bar
  pr.textContent=P.rate+'×'; pr.setAttribute('aria-label','朗讀速度 '+P.rate+' 倍');
  D.documentElement.classList.toggle('tts-act',s!=='idle');
  voiceMenu();
}

/* ---- phrases from the book data ---- */
function phraseCap(){ return P.rate>=1.5?72:P.rate>=1.25?60:48; }
function unitInfo(u){
  var has=false, last='', space=false;
  (u.cs||[]).forEach(function(x){ var c=x[0]; if(c==='\u3000') space=true; if(c===' '||c==='\u3000') return; last=c; if(STOP.indexOf(c)>=0) has=true; });
  var close=!!last && '」』）》〉】〕'.indexOf(last)>=0;
  return {hasStop:has, last:last, spaceEnd:space&&!has&&!close, quoteOnly:close&&!has, sentEnd: /[。！？]/.test((u.cs||[]).map(function(x){return x[0];}).join('')), clauseEnd:has};
}
function itemLen(it){ var n=0; (it.units||[]).forEach(function(u){ n+=u.k; }); return n; }
function build(){
  P.phr=[]; P.u2p={};
  /* 經名 first (River 2026-11-20「經名 怎麼都沒唸」): one phrase from book.title + book.title_zy (the 注音 is not shown;
     tools/readings.py decides it like the text, tts.json subs cover it). The 譯者 line is not read (River). */
  var b=st.book, tc=b&&b.title?Array.from(b.title):[];
  function titlePhrase(end){ var tz=String(b.title_zy||'').trim().split(/\s+/);
    return {title:true,end:!!end,units:[{i:end?-2:-1,k:tc.length,end:true,cs:tc.map(function(c,q){ return [c,tz.length===tc.length?tz[q]:'-']; }).concat([['。','-']])}]}; }
  if(tc.length) P.phr.push(titlePhrase(false));
  var cap=phraseCap(), fast=P.rate>=1.25, mergeSent=P.rate>=1.5;
  var cur=[], n=0;
  function flush(){ if(cur.length){ var k=P.phr.length; P.phr.push({units:cur}); cur.forEach(function(u){ if(u.i!=null) P.u2p[u.i]=k; }); } cur=[]; n=0; }
  var items=st.items, pending=false;
  for(var ii=0;ii<items.length;ii++){
    var it=items[ii];
    if(it.t!=='sent'&&it.t!=='head') continue;
    var isHead=it.t==='head';
    if(isHead && cur.length) flush();
    it.units.forEach(function(u){
      if(cur.length && n+u.k>cap) flush();
      cur.push(u); n+=u.k;
      var inf=unitInfo(u);
      if(n>=cap){ flush(); return; }
      if(inf.quoteOnly) return;                 // 」／』／） alone: do not flush (River 2026-11-23)
      if(!fast){ if(inf.hasStop||inf.spaceEnd) flush(); return; }
      if(inf.sentEnd){
        if(mergeSent && !isHead && n<cap*0.55){ pending=true; return; }  // 1.5×: hold a short sentence to merge with the next
        flush(); pending=false;
      }
    });
    if(isHead){ flush(); pending=false; continue; }
    if(!fast){
      if(cur.length && unitInfo(cur[cur.length-1]).quoteOnly) continue; // stitch into the next item
      flush();
    } else if(pending){
      var nxt=null;
      for(var jj=ii+1;jj<items.length;jj++){ if(items[jj].t==='sent'||items[jj].t==='head'){ nxt=items[jj]; break; } }
      if(!nxt||nxt.t==='head'||n+itemLen(nxt)>cap){ flush(); pending=false; }
      /* else keep cur and fold the next short sentence into this utterance */
    } else if(!cur.length){ }
    else {
      /* 1.25×: flush at item end only if this item ended with 。！？ (already flushed) or was quote-only (carry) */
      if(cur.length && !unitInfo(cur[cur.length-1]).quoteOnly && !unitInfo(cur[cur.length-1]).clauseEnd && !unitInfo(cur[cur.length-1]).sentEnd)
        flush();  // verse line / no punct: keep 1×-style item boundary when it is not a clause
    }
  }
  flush();
  if(tc.length){ var last=''; if(P.phr.length&&!P.phr[P.phr.length-1].title) last=spoken(P.phr[P.phr.length-1]).replace(/[。．.\s　]/g,'');
    if(last!==tc.join('')) P.phr.push(titlePhrase(true)); }   // 經末再唸一次經名；原文最後一句已是經名則不重複

}
function allowPinyin(){ return !!(P.voice&&/google/i.test(P.voice.name)); }   // numbered pinyin was only checked with Google voices
var SKIP='「」『』﹁﹂﹃﹄（）()︵︶《》〈〉【】〔〕︽︾︿﹀︻︼︹︺';
function spoken(ph){
  var ch=[], zy=[];
  ph.units.forEach(function(u){ u.cs.forEach(function(x){ var c=x[0], z=x[1];
    if(SKIP.indexOf(c)>=0) return;   // never send quotes or brackets to the voice
    if(z&&z!=='-'){ ch.push(c); zy.push(z); }
    else if(HAN.test(c)){ ch.push(c); zy.push('-'); }
    else if(STOP.indexOf(c)>=0){ ch.push(c); zy.push('-'); }   // keep internal ，。、；：！？ (needed when faster rates merge clauses)
  }); });
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
  return out.join('').replace(/\s+/g,' ').trim();
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
var TWNAME=/臺灣|台灣|taiwan|國語|美佳|mei-?jia|hsiao-?chen|曉臻|hsiao-?yu|曉雨|yun-?jhe|雲哲|hanhan|涵涵|yating|雅婷|zhiwei|志瑋/i,
    CNNAME=/普通[话話]|mainland|china|中国|中國大陸|ting-?ting|婷婷|xiaoxiao|曉曉|晓晓|yunxi|li-?mu|sin-?ji|粤|粵|cantonese|hong ?kong|香港/i;
function isTW(v){ var l=norm(v.lang);
  if(/^(zh|cmn)(-hant)?-tw\b/.test(l)) return true;
  if(/^(zh|cmn)(-hant)?$/.test(l)||l==='') return TWNAME.test(v.name)&&!CNNAME.test(v.name);
  return false; }
function isHK(v){ var l=norm(v.lang), n=v.name||''; return /^(zh|cmn|yue)(-hant)?-(hk|mo)\b/.test(l)||/hk|yue/.test(l)||/香港|粵語|粤語|cantonese/i.test(n); }
function isCN(v){ if(isTW(v)||isHK(v)) return false; var l=norm(v.lang); return /^(zh|cmn)/.test(l)||/普通[话話]|mainland|中國大陸|中国大陆|xiaoxiao|曉曉|晓晓|ting-?ting|婷婷|yunxi/i.test(v.name||''); }
function isZh(v){ return isTW(v)||isCN(v)||isHK(v); }
function voices(){ try{ return (SS&&SS.getVoices())||[]; }catch(e){ return []; } }
function vid(v){ return v.voiceURI||v.name; }
function twRank(v){ var n=v.name, pref=[/google/i,/natural|online/i,/premium|enhanced|增強|高音質/i,/美佳|mei-?jia/i,/hsiao|曉|yunjhe|雲哲|hanhan|涵涵|yating|雅婷|zhiwei|志瑋/i];
  for(var k=0;k<pref.length;k++) if(pref[k].test(n)) return k; return pref.length; }
function voiceGender(v){ var n=v.name||'';
  if(/男|male|\bman\b|yun-?jhe|雲哲|zhiwei|志瑋|yunxi|雲希|yunyang|雲揚|kang-?kang|yunjian|雲健/i.test(n)) return 'M';
  if(/女|female|woman|girl|美佳|mei-?jia|hsiao-?chen|曉臻|hsiao-?yu|曉雨|yating|雅婷|hanhan|涵涵|ting-?ting|婷婷|xiao-?xiao|曉曉|晓晓|huihui|慧慧|google\s*(國語|普通话|普通話|粤語|粵語)/i.test(n)) return 'F';
  return ''; }
function voiceRegion(v){ return isTW(v)?'TW':isHK(v)?'HK':isCN(v)?'CN':''; }
function byRegion(reg){ return voices().filter(function(v){ return voiceRegion(v)===reg; }).sort(function(a,b){ return twRank(a)-twRank(b); }); }
function regionsAvail(){ return ['TW','CN','HK'].filter(function(r){ return byRegion(r).length; }); }
function gendersAvail(reg){ var vs=byRegion(reg||P.region), g={};
  vs.forEach(function(v){ var x=voiceGender(v); if(x) g[x]=true; });
  return ['F','M'].filter(function(x){ return g[x]; }); }
function sorted(){ var vs=voices(), tw=vs.filter(isTW), zh=vs.filter(function(v){ return !isTW(v)&&(isCN(v)||isHK(v)); });
  tw.sort(function(a,b){ return twRank(a)-twRank(b); }); return {tw:tw,zh:zh,all:vs}; }
function saved(){ try{ return localStorage.getItem(VKEY)||''; }catch(e){ return ''; } }
function pickVoice(){
  var rs=regionsAvail(); if(!rs.length){ var all=sorted(); return all.tw[0]||all.zh[0]||undefined; }
  if(rs.indexOf(P.region)<0) P.region=rs[0];
  var vs=byRegion(P.region), gs=gendersAvail(P.region);
  if(gs.length && gs.indexOf(P.gender)<0) P.gender=gs[0];
  var prefer=vs.filter(function(v){ var g=voiceGender(v); return !g||g===P.gender; });
  var pool=prefer.length?prefer:vs;
  var id=saved();
  if(id){ var m=pool.filter(function(v){ return vid(v)===id||v.name===id; })[0]; if(m) return m; }
  return pool[0]||vs[0]||null;
}
function speakLang(v){ return v?(isTW(v)?'zh-TW':isHK(v)?'zh-HK':isCN(v)?'zh-CN':String(v.lang).replace(/_/g,'-')):'zh-TW'; }
function shortName(v){ return String(v.name).replace(/^Microsoft\s+/,'').replace(/\s*Online\s*\(Natural\)/i,'').replace(/\s*-\s*Chinese.*$/i,'').replace(/\u00a0/g,' '); }
var LANG_LAB={TW:'臺',CN:'陸',HK:'港'}, LANG_ARIA={TW:'臺灣國語',CN:'大陸普通話',HK:'香港粵語'};
var GEN_LAB={F:'女',M:'男'}, GEN_ARIA={F:'女聲',M:'男聲'};
function applyVoice(restart){
  var v=pickVoice(); P.voice=v||null;
  try{ if(v) localStorage.setItem(VKEY,vid(v)); }catch(e){}
  voiceMenu();
  if(restart&&P.state==='playing'&&v){ log('voice',P.idx,v.name); start(P.idx); }
}
function voiceMenu(){
  var pg=$('tpgen'), pl=$('tplang'), rs=regionsAvail(), gs=gendersAvail(P.region);
  if(pl){ pl.hidden=rs.length<1; if(rs.indexOf(P.region)<0&&rs[0]) P.region=rs[0];
    pl.textContent=LANG_LAB[P.region]||'臺'; pl.title='地區：'+(LANG_ARIA[P.region]||''); pl.setAttribute('aria-label','朗讀地區：'+(LANG_ARIA[P.region]||''));
    pl.disabled=rs.length<2; }
  if(pg){ pg.hidden=gs.length<1; if(gs.indexOf(P.gender)<0&&gs[0]) P.gender=gs[0];
    pg.textContent=GEN_LAB[P.gender]||'女'; pg.title='性別：'+(GEN_ARIA[P.gender]||''); pg.setAttribute('aria-label','朗讀性別：'+(GEN_ARIA[P.gender]||''));
    pg.disabled=gs.length<2; }
  if(pv) pv.hidden=true;   // compact 女／男＋臺／陸／港 replace the long name list (still in the DOM, unused)
}
function onVoices(){
  if(P.state==='idle'){ P.voice=null; ui(); return; }
  var v=pickVoice();
  if(v&&v!==P.voice){ P.voice=v; log('voice',P.idx,v.name); if(P.state==='playing') start(P.idx); }
  ui();
}
function setRegion(){ var rs=regionsAvail(); if(rs.length<2) return; P.region=rs[(Math.max(0,rs.indexOf(P.region))+1)%rs.length];
  try{ localStorage.setItem(RKEY,P.region); }catch(e){} log('region',P.idx,P.region); applyVoice(true); ui(); }
function setGender(){ var gs=gendersAvail(P.region); if(gs.length<2) return; P.gender=gs[(Math.max(0,gs.indexOf(P.gender))+1)%gs.length];
  try{ localStorage.setItem(GKEY,P.gender); }catch(e){} log('gender',P.idx,P.gender); applyVoice(true); ui(); }

/* ---- highlight + page follow ---- */
function unmark(){ P.marked.forEach(function(e){ e.classList.remove('tts-on'); }); P.marked=[]; }
function mark(i){
  unmark(); var ph=P.phr[i]; if(!ph) return null;
  if(ph.title){ var t=sc.querySelector(ph.end?'.tcol .tc[data-end]':'.tcol .tc:not([data-end])'); if(t){ t.classList.add('tts-on'); P.marked.push(t); } return P.marked[0]||null; }
  ph.units.forEach(function(u){ var e=sc.querySelector('.u[data-i="'+u.i+'"]'); if(e){ e.classList.add('tts-on'); P.marked.push(e); } });
  return P.marked[0]||null;
}
function sheetOf(el){ var sh=el&&el.closest('.sheet'); return sh?st.sheets.indexOf(sh):-1; }
function follow(i){ var e=mark(i), k=sheetOf(e); if(k>=0&&k!==st.cur){ log('turn',i,k); api.go(k,true); } }
function firstOnSheet(k){
  var sh=st.sheets[k]; if(!sh) return 0;
  if(P.phr[0]&&P.phr[0].title&&!P.phr[0].end&&sh.querySelector('.tcol .tc:not([data-end])')) return 0;   // first page starts with the opening 經名
  var us=sh.querySelectorAll('.u[data-i]'), m=Infinity;
  for(var q=0;q<us.length;q++) m=Math.min(m,+us[q].dataset.i);
  if(m===Infinity){ for(var s2=k+1;s2<st.sheets.length;s2++){ var f=st.sheets[s2].querySelector('.u[data-i]'); if(f){ m=+f.dataset.i; break; } } }
  if(m===Infinity && sh.querySelector('.tcol .tc[data-end]')){
    for(var i=P.phr.length-1;i>=0;i--) if(P.phr[i].end) return i;   // last page is the closing 經名
  }
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
  var u=new UT(txt); u.lang=speakLang(P.voice); if(P.voice) u.voice=P.voice; u.rate=P.rate;
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
function play(at){
  if(!SS||!UT){ msg('這個瀏覽器不支援朗讀（speechSynthesis）。'); return; }
  if(!st.book||!st.sheets.length) return;
  if(P.state==='playing'&&at==null) return;
  var v=(P.state!=='idle'&&P.voice)?P.voice:pickVoice();
  if(v===null){ msg('這台裝置沒有中文語音，無法朗讀。可在系統設定加入「中文（臺灣）」語音後再試。',9000); return; }
  P.voice=v||null;
  if(v&&P.region==='TW'&&!isTW(v)) msg('這台裝置找不到臺灣國語語音，改用「'+v.name+'」，讀音可能不同。可在上方改地區，或照說明加裝臺灣語音。',9000);
  if(!P.phr.length) build();
  var i=at!=null?at:(P.state==='paused'&&st.cur===P.pausedSheet)?P.idx:firstOnSheet(st.cur);
  log(at!=null?'jump':P.state==='paused'?'resume':'play',i,v?v.name:'(lang zh-TW)');
  start(i);
}
function pause(){ if(P.state!=='playing') return; P.gen++; clearTimeout(P.wd); P.state='paused'; P.pausedSheet=st.cur; cancelNow(); log('pause',P.idx); ui(); }
function stop(){ var was=P.state; P.gen++; clearTimeout(P.wd); P.state='idle'; P.pausedSheet=-1; cancelNow(); unmark(); if(was!=='idle') log('stop',P.idx); ui(); }
function setRate(){
  var was=P.state, title=false, end=false, ui0=null;
  if(P.phr.length&&P.phr[P.idx]){ var ph=P.phr[P.idx]; title=!!ph.title; end=!!ph.end; ui0=ph.units&&ph.units[0]&&ph.units[0].i; }
  P.rate=RATES[(RATES.indexOf(P.rate)+1)%RATES.length]; try{ localStorage.setItem('reader.ttsRate',P.rate); }catch(e){}
  if(P.phr.length) build();
  var i=0;
  if(title){ for(var k=0;k<P.phr.length;k++) if(P.phr[k].title&&!!P.phr[k].end===end){ i=k; break; } }
  else if(ui0!=null&&P.u2p[ui0]!=null) i=P.u2p[ui0];
  P.idx=i; log('rate',i,P.rate); ui();
  if(was==='playing') start(i);
}
/* tap/click a character -> read from the phrase that contains it (the reader has no tap/swipe paging on the text) */
function phraseAt(el){
  if(!P.phr.length) build();
  var i=+el.dataset.i; if(P.u2p[i]!=null) return P.u2p[i];
  var us=sc.querySelectorAll('.u[data-i]');   // a unit outside any phrase (should not happen): next phrase after it
  for(var q=0;q<us.length;q++){ var j=+us[q].dataset.i; if(j>i&&P.u2p[j]!=null) return P.u2p[j]; }
  return null;
}
sc.addEventListener('click',function(e){
  if(e.button||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey) return;
  var tcel=e.target.closest&&e.target.closest('.tcol .tc');
  if(st.book&&tcel){ if(!P.phr.length) build();
    if(tcel.getAttribute('data-end')){ for(var i=P.phr.length-1;i>=0;i--) if(P.phr[i].end){ log('tap',i,'title-end'); play(i); return; } }
    else if(P.phr[0]&&P.phr[0].title){ log('tap',0,'title'); play(0); }
    return; }
  var el=e.target.closest&&e.target.closest('.u[data-i]'); if(!el||!st.book) return;
  var sel=window.getSelection&&window.getSelection(); if(sel&&!sel.isCollapsed&&String(sel).length) return;   // selecting text
  var k=phraseAt(el); if(k==null) return;
  log('tap',k,el.dataset.i);
  play(k);
});
tp.onclick=function(){ P.state==='playing'?pause():play(); };
if(pp) pp.onclick=tp.onclick; if(ps) ps.onclick=stop; if(pr) pr.onclick=setRate;
(function(){ var g=$('tpgen'), l=$('tplang'); if(g) g.onclick=setGender; if(l) l.onclick=setRegion; })();
D.addEventListener('visibilitychange',function(){ if(D.hidden&&P.state==='playing'){ log('hidden',P.idx); pause(); } });
window.addEventListener('pagehide',function(){ stop(); });
D.addEventListener('click',function(e){ var a=e.target.closest&&e.target.closest('a[href]'); if(a&&P.state!=='idle'){ log('nav',P.idx,a.getAttribute('href')); stop(); } },true);
if(SS){ try{ SS.getVoices(); if(SS.addEventListener) SS.addEventListener('voiceschanged',onVoices); else SS.onvoiceschanged=onVoices; }catch(e){} }
(window.__readerHooks=window.__readerHooks||[]).push(function(n){
  if(n==='book'){ stop(); P.phr=[]; P.bookId=st.book&&st.book.id; loadSubs(P.bookId); }
  else if(n==='layout'&&P.phr.length){ if(P.state!=='idle'){ var e=mark(P.idx); if(P.state==='playing'){ var k=sheetOf(e); if(k>=0&&k!==st.cur) api.go(k,false); } else P.pausedSheet=st.cur; } }
});
if(st.book){ P.bookId=st.book.id; loadSubs(P.bookId); }
ui();
window.__tts={P:P,pickVoice:pickVoice,isTW:isTW,isHK:isHK,isCN:isCN,voiceGender:voiceGender,voiceRegion:voiceRegion,play:play,pause:pause,stop:stop,spoken:function(i){ if(!P.phr.length) build(); return spoken(P.phr[i]); },build:build,firstOnSheet:firstOnSheet,phraseCap:phraseCap,unitInfo:unitInfo,setRate:setRate,setRegion:setRegion,setGender:setGender};
})();

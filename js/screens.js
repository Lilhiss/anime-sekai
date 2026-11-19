// v2 screen glue: landing/world, quiz, results, multiplayer hub, lobby room, solo setup, multiplayer quiz (moved out of index.html 2026-11-19; order matters)
/* ── LANDING v2 + WORLD — glue ────────────────────────────────
   Scales the fixed 1280x760 compositions to the viewport, hides #mainNav
   while the landing is up, and wires the globe / menu band to existing handlers. */
window.addEventListener('resize',lzFit);

/* App menu (41a): one button carrying the landing band's nav. Mounted into every
   [data-app-menu] host — multiplayer hub, lobby console, solo setup. */
const AM_HTML=`<button class="am-btn" onclick="amToggle(event)" aria-label="Menu" aria-expanded="false"><i class="ti ti-menu-2" style="font-size:19px"></i></button>
<div class="am-menu">
  <button class="am-mi" onclick="amClose();goProfile()"><i class="ti ti-user"></i> PROFILE</button>
  <button class="am-mi" onclick="amClose();enterWorld()"><i class="ti ti-world"></i> HOW TO PLAY</button>
  <div class="am-sep"></div>
  <button class="am-mi" onclick="toggleSound();amSync()"><i class="ti ti-volume am-sound-i"></i> SOUND <span class="am-val am-sound-v">ON</span></button>
  <button class="am-mi" onclick="event.stopPropagation();skCycleMotion()"><i class="ti ti-planet"></i> WORLD MOTION <span class="am-val am-motion-v">FULL</span></button>
  <button class="am-mi" onclick="amTheme(event)"><i class="ti ti-palette"></i> THEME <i class="ti ti-chevron-left" style="margin-left:auto"></i></button>
  <div class="drop am-drop"></div>
  <div class="am-sep"></div>
  <button class="am-mi am-auth"><i class="ti ti-login-2 am-auth-i"></i> <span class="am-auth-l">SIGN IN</span></button>
</div>`;
function amMount(){document.querySelectorAll('[data-app-menu]').forEach(w=>{if(!w.dataset.built){w.innerHTML=AM_HTML;w.dataset.built='1';}});amSync();}
function amSync(){
  const signedIn=(typeof currentUser!=='undefined'&&currentUser)||(typeof isGuest!=='undefined'&&isGuest);
  document.querySelectorAll('[data-app-menu]').forEach(w=>{
    const si=w.querySelector('.am-sound-i');if(si)si.className='ti am-sound-i '+(soundOn?'ti-volume':'ti-volume-off');
    const sv=w.querySelector('.am-sound-v');if(sv)sv.textContent=soundOn?'ON':'OFF';
    const mv=w.querySelector('.am-motion-v');if(mv)mv.textContent=(window.skMotion?window.skMotion():'full').toUpperCase();
    const ai=w.querySelector('.am-auth-i');if(ai)ai.className='ti am-auth-i '+(signedIn?'ti-logout':'ti-login-2');
    const al=w.querySelector('.am-auth-l');if(al)al.textContent=signedIn?'SIGN OUT':'SIGN IN';
    const ab=w.querySelector('.am-auth');
    if(ab)ab.setAttribute('onclick',signedIn?'amClose();signOut()':"amClose();choosePath('landing')");
  });
}
function amClose(){
  document.querySelectorAll('[data-app-menu]').forEach(w=>{
    w.querySelector('.am-menu')?.classList.remove('open');
    w.querySelector('.am-drop')?.classList.remove('open');
    const b=w.querySelector('.am-btn');if(b){b.classList.remove('open');b.setAttribute('aria-expanded','false');}
  });
}
function amToggle(e){
  if(e)e.stopPropagation();
  const w=e.target.closest('[data-app-menu]');if(!w)return;
  const m=w.querySelector('.am-menu'),b=w.querySelector('.am-btn');
  const open=!m.classList.contains('open');
  amClose();
  if(open){m.classList.add('open');b.classList.add('open');b.setAttribute('aria-expanded','true');amSync();}
}
function amTheme(e){
  if(e)e.stopPropagation();
  const d=e.target.closest('[data-app-menu]')?.querySelector('.am-drop');
  if(!d)return;
  if(!d.dataset.built&&typeof buildThemeDropHTML==='function'){d.innerHTML=buildThemeDropHTML();d.dataset.built='1';}
  d.classList.toggle('open');
}
document.addEventListener('click',e=>{if(!e.target.closest('[data-app-menu]'))amClose();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',amMount);else amMount();

function lzSyncAuth(){
  const label=document.getElementById('lzAuthLabel');
  const btn=document.getElementById('lzAuthBtn');
  const av=document.getElementById('lzAuthAv');
  if(!label||!btn)return;
  // Signed in or playing as guest: the pill becomes the profile link (avatar + name), so there is no separate PROFILE item.
  if(typeof currentUser!=='undefined'&&currentUser){
    lzAuthDone();
    label.removeAttribute('data-copy-key');
    label.textContent=String(currentUser);
    const guest=typeof isGuest!=='undefined'&&isGuest;
    const ib=window._inbox||{any:false,unread:0};
    const menu=true; // accounts always have Sign out in it; guests have Sign in
    btn.setAttribute('onclick',menu?'lzMeMenu(event)':'goProfile()');
    btn.classList.add('is-me');btn.title=menu?'':'Your profile';
    btn.classList.toggle('has-menu',menu);
    let bd=btn.querySelector('.lz-me-badge');
    if(!guest&&ib.unread>0){if(!bd){bd=document.createElement('span');bd.className='lz-me-badge';av&&av.after(bd);}bd.textContent=ib.unread>9?'9+':ib.unread;}else if(bd)bd.remove();
    btn.classList.toggle('is-guest',guest);
    let car=btn.querySelector('.lz-me-car');
    if(!car){car=document.createElement('i');car.className='ti ti-chevron-down lz-me-car';btn.appendChild(car);}
    if(av){
      const p=typeof pfPfpSrc==='function'?pfPfpSrc():null;
      av.style.background=p?p.bg:'linear-gradient(135deg,var(--accent),var(--aur2,var(--accent)))';
      av.innerHTML=p&&p.src?'<img src="'+p.src+'" alt="" style="object-fit:'+(p.preset?'contain':'cover')+'">':String(currentUser)[0].toUpperCase();
    }
  } else {
    label.setAttribute('data-copy-key','nav_signin');
    label.textContent=(typeof getSiteText==='function'?getSiteText('nav_signin'):'')||'SIGN IN';
    btn.setAttribute('onclick',"choosePath('landing')");
    btn.classList.remove('is-me');btn.title='';
    if(av)av.innerHTML='';
  }
}

/* Theme dropdown, anchored to the band and opening upward. */
function lzToggleTheme(e){
  if(e)e.stopPropagation();
  const d=document.getElementById('lzDrop');
  if(!d)return;
  if(!d.dataset.built&&typeof buildThemeDropHTML==='function'){d.innerHTML=buildThemeDropHTML();d.dataset.built='1';}
  d.classList.toggle('open');
  if(typeof applyTheme==='function')applyTheme();
}
document.addEventListener('click',e=>{
  const d=document.getElementById('lzDrop');
  if(d&&d.classList.contains('open')&&!d.contains(e.target)&&!e.target.closest('.lz-navitem'))d.classList.remove('open');
});

function lzSuggestTopic(){
  if(typeof openSubmitQuestion==='function'){
    openSubmitQuestion();
    if(typeof sqSwitchTab==='function')setTimeout(()=>sqSwitchTab('suggest'),0);
  }
}

/* The interior is permanently reachable (44a). */
function enterWorld(){
  if(window.__enteringWorld)return;
  var g=window.sekaiLandGlobe;
  if(g&&!window.__worldSpun){window.__enteringWorld=true;
    g.spinTo(0,1100,function(){window.__enteringWorld=false;window.__worldSpun=true;enterWorld();});return;}
  window.__worldSpun=false;
  if(window.sekaiTourGlobe)sekaiTourGlobe.setOff(0);
  try{localStorage.setItem('aqs_world_seen','1')}catch(e){}
  goStep('world');
  const m=document.getElementById('lzWorldMask'),f=document.getElementById('lzWorldFade');
  [m,f].forEach(el=>{if(el){el.style.animation='none';void el.offsetWidth;el.style.animation='';}});
}

/* goStep wrapper: nav visibility + refit, no change to the original. */
(function(){
  const orig=window.goStep;
  window.goStep=function(name){
    orig.apply(this,arguments);
    document.body.classList.toggle('on-landing',name==='landing'||name==='world');
    lzSyncAuth();
    requestAnimationFrame(lzFit);
  };
  const on=window.updateNav;
  if(on)window.updateNav=function(){on.apply(this,arguments);lzSyncAuth();};
})();

function _lzBoot(){
  document.body.classList.add('on-landing');
  lzFit();
  lzSyncAuth();
  requestAnimationFrame(lzFit);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(lzFit);
  /* First visit: no automatic trip into the world any more; the foxfire greeter
     (lzGreet, below) invites the player to tap the globe instead. */
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',_lzBoot,{once:true});
else _lzBoot();

/* ── QUIZ v2 glue (handoff sections 4, 6, 10, 11) ──────────────
   Layout-driven only: nothing here changes scoring, question selection,
   the retry-until-correct typing rule, or any server call. */
let qStreak=0, qResults=[], srTickInterval=null, srLockedPts=null;

function updateTimerBar(){
  const pct=Math.max(0,(timeLeft/raceTimeLimit)*100);
  const cls=pct<=20?'danger':pct<=50?'warn':'';
  const bar=document.getElementById('timerBar');
  if(bar){bar.style.height=pct+'%';bar.style.width='';bar.className='q-rail-fill '+cls;}
  const num=document.getElementById('timerNum');
  if(num){num.textContent=Math.ceil(timeLeft);num.className='q-rail-num '+cls;}
}

function renderPips(){
  const pips=document.getElementById('qPips'), pill=document.getElementById('qCount');
  if(!pips)return;
  const fixed=(typeof selectedMode!=='undefined'&&selectedMode!=='race'&&selectedMode!=='survival');
  const total=fixed?(selectedQuestionLimit||0):0;
  if(!fixed||!total){pips.innerHTML='';pips.style.display='none';if(pill)pill.style.display='';return;}
  pips.style.display='';if(pill)pill.style.display='none';
  pips.innerHTML=Array.from({length:total},(_,i)=>{
    const cls=i===qIndex?'current':qResults[i]===true?'done':qResults[i]===false?'wrong':'';
    return '<div class="q-pip '+cls+'"></div>';
  }).join('');
}

function renderRace(){
  const bar=document.getElementById('raceBar');
  if(!bar)return;
  const isRace=(typeof selectedMode!=='undefined'&&selectedMode==='race');
  bar.style.display=isRace?'':'none';
  if(!isRace)return;
  const target=(typeof soloRaceTarget!=='undefined'&&soloRaceTarget)||100;
  document.getElementById('raceTarget').textContent=target.toLocaleString();
  document.getElementById('raceLeader').textContent='';
  document.getElementById('raceFill').style.width=Math.min(100,(score/target)*100)+'%';
  const track=document.getElementById('raceTrack');
  track.querySelectorAll('.race-mk').forEach(n=>n.remove());
  const me=document.createElement('div');
  me.className='race-mk me';
  me.style.left=Math.min(100,(score/target)*100)+'%';
  me.textContent='★';
  track.appendChild(me);
}

/* Mode dressing — one class on the stage, per the handoff. */
function applyQuizMode(){
  const stage=document.getElementById('quizStage');
  if(!stage)return;
  const mode=(typeof selectedMode!=='undefined'&&selectedMode)||'classic';
  /* §7's format classes are set per question — preserve them across mode renders */
  const fmt=['fmt-scene','fmt-char','fmt-img'].filter(c=>stage.classList.contains(c));
  stage.className=['quiz-stage','mode-'+mode].concat(fmt).join(' ');
  const surv=mode==='survival';
  const sl=document.getElementById('survLives'), rw=document.getElementById('survRunWrap');
  if(sl)sl.style.display=surv?'':'none';
  if(rw)rw.style.display=surv?'':'none';
  const ld=document.getElementById('livesDisplay');
  if(ld)ld.style.display=surv?'none':'';
  if(surv){
    stage.classList.toggle('last-life',lives===1);
    const n=document.getElementById('survLivesN'), c=document.getElementById('survLivesCap');
    if(n)n.textContent=lives===1?'LAST LIFE':lives+' LIVES';
    if(c)c.textContent=lives===1?'ONE WRONG ANSWER ENDS THE RUN':'WRONG ANSWERS COST A LIFE';
    const run=document.getElementById('survRun');
    if(run)run.textContent=qResults.filter(r=>r===true).length;
  }
  const hl=document.getElementById('hudLabel');
  if(hl)hl.textContent=({race:'SCORE RACE',classic:'CLASSIC',survival:'SURVIVAL',potato:'HOT POTATO',slowreveal:'SLOW REVEAL'}[mode]||mode.toUpperCase());
  renderRace();
}

function renderStreak(){
  const d=document.getElementById('streakDisplay');
  if(!d)return;
  document.getElementById('streakVal').textContent=qStreak;
  d.style.visibility=qStreak>1?'visible':'hidden';
}

/* Rebuild the type well into the section-6 footprint, keeping every id the
   existing checkTypeAnswer()/timeOut() code looks up. */
function restyleTypeWell(){
  const wrap=document.querySelector('#answersGrid .type-wrap');
  if(!wrap||wrap.dataset.v2)return;
  const input=wrap.querySelector('#typeInput');
  if(!input)return;
  wrap.dataset.v2='1';
  wrap.innerHTML='';
  const row=document.createElement('div');row.className='type-row';
  const field=document.createElement('div');field.className='type-field';field.id='typeField';
  const icon=document.createElement('i');icon.className='ti ti-pencil';icon.style.cssText='font-size:26px;color:var(--accent)';
  input.className='type-input';input.setAttribute('maxlength','40');input.placeholder='Type your answer…';
  const count=document.createElement('div');count.className='type-count';count.id='typeCount';count.textContent='0 / 40';
  field.append(icon,input,count);
  const submit=document.createElement('button');
  submit.className='type-submit';submit.id='typeSubmitBtn';
  submit.innerHTML='SUBMIT <span class="type-kbd">⏎</span>';
  submit.onclick=()=>checkTypeAnswer();
  row.append(field,submit);
  const second=document.createElement('div');second.className='type-second';second.id='typeSecond';
  const hint=document.createElement('div');
  hint.id='typeWrongHint';hint.style.cssText='display:none;font:900 12px Nunito,sans-serif;color:#f87171';
  hint.innerHTML='<i class="ti ti-x" style="font-size:12px"></i> Not quite, try again!';
  second.appendChild(hint);
  wrap.append(row,second);
  input.addEventListener('input',()=>{count.textContent=input.value.length+' / 40';});
  input.addEventListener('keydown',e=>{if(e.key==='Enter')checkTypeAnswer();});
  const note=document.getElementById('qFuzzyNote');if(note)note.style.display='';
  setTimeout(()=>input.focus(),0);
}

/* The section-6 resolved states, driven from the existing feedback call. */
function resolveTypeField(correct,canonical,typed){
  const field=document.getElementById('typeField');
  if(!field)return;
  field.classList.add(correct?'correct':'wrong');
  const pts=(typeof lastPtsEarned!=='undefined'&&lastPtsEarned)||0;
  // A typed alt answer shows as itself; a miss lists the alt answers next to the main one
  const qd=typeof currentQData!=='undefined'?currentQData:null;
  if(correct&&qd&&qd._match&&qd._match.alt)canonical=qd._match.text;
  const alts=(!correct&&qd&&!qd.options&&Array.isArray(qd.alt_answers))?qd.alt_answers.map(e=>typeof e==='string'?e:e&&e.text).filter(Boolean):[];
  field.innerHTML=correct
    ? '<i class="ti ti-check" style="font-size:28px;color:#4ade80"></i>'
      +'<div style="flex:1;min-width:0;text-align:left"><div class="type-canon">'+canonical+'</div>'
      +(typed&&typed.toLowerCase()!==String(canonical).toLowerCase()?'<div class="type-typed">you typed <b>"'+typed+'"</b></div>':'')+'</div>'
      +(pts?'<div class="type-points">+'+pts+'</div>':'')
    : '<i class="ti ti-x" style="font-size:28px;color:#f87171"></i>'
      +'<div style="flex:1;min-width:0;text-align:left"><div class="type-miss">'+(typed&&typed!=='(timed out)'?typed:'no answer')+'</div></div>';
  const second=document.getElementById('typeSecond');
  if(second){
    second.innerHTML=correct?'':'<span class="type-second-label">THE ANSWER</span>'
      +'<div class="type-reveal"><span class="type-reveal-a">'+canonical+'</span>'
      +(alts.length?'<span class="type-reveal-or">also correct: '+alts.join(', ')+'</span>':'')+'</div>';
  }
  const submit=document.getElementById('typeSubmitBtn');
  if(submit){submit.innerHTML='NEXT <i class="ti ti-chevron-right" style="font-size:18px"></i>';submit.onclick=()=>nextQuestion();submit.disabled=false;}
  const note=document.getElementById('qFuzzyNote');if(note)note.style.display='none';
}

/* ── wrappers around the existing game functions ── */
(function(){
  const _showQuestion=window.showQuestion;
  window.showQuestion=function(qData){
    qResults.length=Math.max(qResults.length,0);
    const panel=document.getElementById('questionArea');
    if(panel)panel.classList.remove('correct','wrong','answered');
    const fb=document.getElementById('qCardFeedback');
    if(fb){fb.style.display='none';fb.className='q-feedback';}
    const nb=document.getElementById('qNextBar');if(nb)nb.style.display='none';
    const note=document.getElementById('qFuzzyNote');if(note)note.style.display='none';
    const r=_showQuestion.apply(this,arguments);
    restyleTypeWell();
    document.getElementById('questionText')?.classList.toggle('under-image',!!(qData&&qData.media_url));
    applyQuizMode();renderPips();renderStreak();
    return r;
  };

  const _showFeedback=window.showFeedback;
  window.showFeedback=function(correct,correctAns,userAns,override){
    qStreak=correct?qStreak+1:0;
    qResults[qIndex]=!!correct;
    const r=_showFeedback.apply(this,arguments);
    const panel=document.getElementById('questionArea');
    if(panel){panel.classList.remove('answered');panel.classList.add(correct?'correct':'wrong');}
    const fb=document.getElementById('qCardFeedback');
    if(fb){fb.style.display='flex';fb.className='q-feedback '+(correct?'correct-fb':'wrong-fb');}
    if(document.getElementById('typeField'))resolveTypeField(correct,correctAns,userAns);
    {const t=document.getElementById('fbTitle');if(t)t.style.display=(!correct&&!document.getElementById('typeField')&&t.textContent==='Wrong!')?'none':'';
     const ya=document.getElementById('fbYourAns');if(ya&&!document.getElementById('typeField'))ya.style.display='none';}
    document.querySelectorAll('#answersGrid .ans').forEach(el=>{
      if(!el.classList.contains('correct')&&!el.classList.contains('wrong'))el.classList.add('dim');
    });
    const picked=document.querySelector('#answersGrid .ans.correct,#answersGrid .ans.wrong');
    if(picked&&!picked.querySelector('.ans-flag')){
      const f=document.createElement('span');f.className='ans-flag';
      f.textContent=picked.classList.contains('correct')?'YOUR PICK ✓':'YOUR PICK ✗';
      picked.appendChild(f);
    }
    renderStreak();renderPips();applyQuizMode();
    return r;
  };

  const _startSolo=window.startSoloAutoNext;
  window.startSoloAutoNext=function(){
    const r=_startSolo.apply(this,arguments);
    const nb=document.getElementById('qNextBar'), fill=document.getElementById('qNextFill');
    if(nb)nb.style.display='flex';
    if(fill){
      fill.style.transition='none';fill.style.width='0';
      void fill.offsetWidth;
      fill.style.transition='width 5s linear';fill.style.width='100%';
    }
    return r;
  };

  const _next=window.nextQuestion;
  window.nextQuestion=function(){
    const nb=document.getElementById('qNextBar');if(nb)nb.style.display='none';
    return _next.apply(this,arguments);
  };

  const _goStep=window.goStep;
  window.goStep=function(name){
    const r=_goStep.apply(this,arguments);
    document.body.classList.toggle('in-game',name==='quiz'||name==='daily'||name==='daily-result');
    document.body.classList.toggle('on-results',name==='results');
    document.body.classList.toggle('on-hub',name==='multiplayer');
    if(name==='quiz'){qStreak=0;qResults=[];applyQuizMode();renderPips();renderStreak();}
    return r;
  };
})();

/* ── RESULTS v2 glue (handoff section 5) ──────────────────────
   renderResults() is left untouched; this runs after it and fills the two
   pieces the old layout had nowhere to put: the hero avatar and the
   best-streak tile (which falls back to lives left in survival). */
let qBestStreak=0;
(function(){
  const _fb=window.showFeedback;
  window.showFeedback=function(correct){
    const r=_fb.apply(this,arguments);
    if(typeof qStreak!=='undefined'&&qStreak>qBestStreak)qBestStreak=qStreak;
    return r;
  };
  const _rr=window.renderResults;
  window.renderResults=function(){
    const r=_rr.apply(this,arguments);
    const av=document.getElementById('winAvatar');
    if(av){
      const name=(typeof currentUser==='string'&&currentUser)||'You';
      const pfp=(typeof pfPfpSrc==='function'&&!isGuest)?pfPfpSrc():null;
      if(pfp&&pfp.src){av.style.background=pfp.bg||'';av.innerHTML='<img src="'+pfEsc(pfp.src)+'" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:'+(pfp.preset?'contain':'cover')+'" onerror="this.remove()">';}
      else{av.style.background=pfp&&pfp.preset?pfp.bg:'';av.textContent=String(name).trim().charAt(0).toUpperCase();}
      const badge=document.getElementById('winBadge');
      if(badge)badge.textContent=String(name).trim().slice(0,14).toUpperCase()||'YOUR RUN';
    }
    const isSurvival=(typeof selectedMode!=='undefined'&&selectedMode==='survival');
    const tile=document.getElementById('statLives'), label=document.getElementById('statLivesLabel');
    if(tile&&label){
      if(isSurvival){tile.textContent=lives+' ❤️';label.textContent='LIVES LEFT';tile.style.color='#f87171';}
      else{tile.textContent=qBestStreak;label.textContent='BEST STREAK';tile.style.color='#fbbf24';}
    }
    return r;
  };
  const _gs=window.goStep;
  window.goStep=function(name){
    if(name==='quiz')qBestStreak=0;
    return _gs.apply(this,arguments);
  };
})();

/* ── MULTIPLAYER HUB v2 glue (41a) ────────────────────────────
   Boxed code entry writes into the original #lobbyCodeInput, so joinLobby()
   and every error path are untouched. Pagination is client-side over the
   cards loadPublicLobbies() already rendered. */
const MP_MODE_TINT={race:'color-mix(in srgb,#a78bfa 12%,var(--bg2))',survival:'color-mix(in srgb,#f87171 12%,var(--bg2))',potato:'color-mix(in srgb,#fb923c 12%,var(--bg2))',slowreveal:'color-mix(in srgb,#fbbf24 12%,var(--bg2))'};
const MP_MODE_GLYPH={classic:'🎮',race:'⚡',survival:'❤️',potato:'🥔',slowreveal:'👁️'};
/* 41a: mode name + JOIN take the mode hue; classic stays grey. */
const MP_MODE_HUE={classic:'var(--muted)',race:'#a78bfa',survival:'#f87171',potato:'#fb923c',slowreveal:'#38bdf8'};

let mpCodeIdx=0, mpPageNum=0;
/* preview shortcut: press R on the lobby list to replay the unfurl (remove before launch) */
document.addEventListener('keydown',e=>{if(e.key!=='r'&&e.key!=='R')return;const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
  const pg=document.getElementById('page-multiplayer');if(!pg||!pg.offsetParent&&getComputedStyle(pg).position!=='fixed'||!pg.getClientRects().length)return;
  const L=document.getElementById('lobbyBrowseList');
  if(L&&!L.querySelector('.mp-scroll')){ /* no open lobbies: show demo scrolls so the look can be previewed */
    const D=[['Score Race','#E8A23A','Late night anime grind session','3/12'],['Survival','#D9467A','Shonen only','5/12 · 1 SEAT LEFT'],['Classic','#3F7FE0',"Kaito's Lobby",'2/12'],['Hot Potato','#E5583A','Spicy round','7/12'],['Slow Reveal','#2BB3A6','Guess the opening','4/12']];
    L.innerHTML=D.map(d=>'<div class="mp-card mp-scroll" style="--mc:'+d[1]+'"><div class="mps-art"><i class="mps-paper"><b></b><u></u></i><i class="mps-rl"></i><i class="mps-rd"></i><span class="mps-tag">'+d[0].toUpperCase()+'</span><div class="mps-body"><span class="mps-emo">'+({'Score Race':'⚡','Survival':'❤️','Classic':'🎮','Hot Potato':'🥔','Slow Reveal':'👁️'})[d[0]]+'</span><span class="mpc-name">'+d[2]+'</span><span class="mpc-players"><i class="ti ti-users"></i>'+d[3]+'</span><button class="mpc-join">JOIN</button></div></div></div>').join('');
  }
  [...pg.querySelectorAll('.mp-scroll')].filter(c=>c.style.display!=='none').forEach((c,i)=>{c.classList.remove('unfurl');void c.offsetWidth;c.style.setProperty('--d',(i*.12)+'s');c.classList.add('unfurl');});});

document.addEventListener('keydown',e=>{
  if(e.key!==' ')return;
  if(!document.getElementById('page-lobby-room')?.classList.contains('active'))return;
  if(typeof gsActiveTab!=='undefined'&&gsActiveTab!=='topic')return;
  const t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
  if(typeof gsHl!=='undefined'&&gsHl){e.preventDefault();gsAddHighlighted();}
});

/* ── LOBBY ROOM rail (36a): PLAYERS / CHAT ────────────────────
   Chat rides the existing lobby realtime channel as a 'chat' broadcast.
   A message that names a catalogue topic gets the host-only + TOPIC chip;
   once picked it reads ADDED, and an unmatched suggestion says so. */
var lrChatMsgs=[], lrRailView='players', lrChatSeen=0, lrChatLobby=null;
/* chat belongs to one lobby: entering a different lobby starts it empty (rejoining the same one keeps it) */
function lrChatResetFor(lobbyId){
  if(lrChatLobby===lobbyId)return;
  lrChatLobby=lobbyId;lrChatMsgs=[];lrChatSeen=0;
  const d=document.getElementById('lrChatDot');if(d)d.style.display='none';
  lrChatRender();
}
const LR_AV=['#a78bfa','#38bdf8','#f0abfc','#fbbf24','#4ade80','#fb923c'];
function lrAvColor(name){let s=0;for(const c of String(name||''))s=(s+c.charCodeAt(0))%997;return LR_AV[s%LR_AV.length];}
function lrEsc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function lrRailTab(v){
  lrRailView=v;
  {const pp=document.querySelector('#page-lobby-room .lr-players');if(pp)pp.classList.toggle('chat-on',v==='chat');}
  document.getElementById('lrTabPlayers').classList.toggle('on',v==='players');
  document.getElementById('lrTabChat').classList.toggle('on',v==='chat');
  document.getElementById('lobbyPlayerList').style.display=v==='players'?'':'none';
  document.getElementById('lrChat').style.display=v==='chat'?'flex':'none';
  if(v==='chat'){
    lrChatSeen=lrChatMsgs.length;
    document.getElementById('lrChatDot').style.display='none';
    lrChatRender();
    const i=document.getElementById('lrChatInput');if(i)setTimeout(()=>i.focus(),30);
  }
}
/* every catalogue series a message names ("bleach and naruto" → both); a shorter name that
   only appears inside a longer matched one (Naruto inside "Naruto Shippuden") doesn't count */
function lrChatMatches(text){
  const all=typeof animeTopics!=='undefined'?animeTopics:[];
  const t=String(text||'').toLowerCase();
  const hits=all.filter(x=>{const n=(x.name||'').toLowerCase();return n.length>2&&t.includes(n);})
    .sort((a,b)=>b.name.length-a.name.length);
  const kept=[];
  hits.forEach(x=>{const n=x.name.toLowerCase();if(!kept.some(k=>k.name.toLowerCase().includes(n)))kept.push(x);});
  return kept.sort((a,b)=>t.indexOf(a.name.toLowerCase())-t.indexOf(b.name.toLowerCase()));
}
/* the lobby's own topic list (falls back to the solo one outside a lobby) */
function lrPicked(t){return (typeof lobbyTopics!=='undefined'?lobbyTopics:(selectedTopics||[])).some(x=>x.key===t.key);}
function lrLooksLikeSuggestion(text){
  return /\b(can we|what about|how about|lets do|let's do|please|add|do)\b/i.test(String(text||''));
}
function lrChatRender(){
  const log=document.getElementById('lrChatLog');
  if(!log)return;
  if(!lrChatMsgs.length){
    log.innerHTML='';
    return;
  }
  const host=(typeof isHost!=='undefined'&&isHost);
  log.innerHTML=lrChatMsgs.map((m,i)=>{
    if(m.sys)return '<div class="lr-msg-sys"><i class="ti ti-crown" style="font-size:13px;color:#fbbf24"></i><span>'+m.text+'</span></div>';
    const topics=lrChatMatches(m.text);
    const missing=topics.filter(t=>!lrPicked(t));
    const isHostMsg=m.host;
    const col=lrAvColor(m.name);
    let tail='';
    if(topics.length&&!missing.length)tail='<span class="lr-msg-tag added"><i class="ti ti-check" style="font-size:10px"></i> ADDED</span>';
    else if(!topics.length&&lrLooksLikeSuggestion(m.text))tail='<span class="lr-msg-tag miss" onclick="suSuggest(\'\')"><i class="ti ti-alert-triangle" style="font-size:10px"></i> NOT IN CATALOGUE — SUGGEST IT?</span>';
    const chip=(host&&missing.length)
      ?'<button class="lr-msg-add" onclick="lrChatAddTopic('+i+')"><i class="ti ti-plus" style="font-size:11px"></i> '+(missing.length>1?missing.length+' TOPICS':'TOPIC')+'</button>':'';
    return '<div class="lr-msg'+(chip?' sug':'')+'">'
      +'<span class="lr-msg-av'+(isHostMsg?' host':'')+'" style="background:'+lrChatAvBg(m,col)+'">'+lrChatAvInner(m)+'</span>'
      +'<div class="lr-msg-b"><div class="lr-msg-hd"><span class="lr-msg-who" style="color:'+col+'">'+lrEsc(m.name)+'</span>'
      +(isHostMsg?'<span style="font-size:10px">👑</span>':'')
      +'<span class="lr-msg-t">'+lrEsc(m.at||'')+'</span></div>'
      +'<div class="lr-msg-x">'+lrEsc(m.text)+'</div>'+tail+'</div>'+chip+'</div>';
  }).join('');
  log.scrollTop=log.scrollHeight;
}
function lrChatAvSrc(m){
  let url=null;
  if(m.name===currentUser&&typeof currentPfp!=='undefined'&&currentPfp)url=currentPfp.type==='preset'?'preset:'+currentPfp.value:currentPfp.value;
  else{const p=(typeof lobbyPlayers!=='undefined'?lobbyPlayers:[]).find(x=>x.name===m.name);url=p&&p.avatar||null;}
  if(!url)return null;
  const preset=url.startsWith('preset:')&&typeof PFP_PRESETS!=='undefined'?PFP_PRESETS.find(p=>p.id===url.slice(7)):null;
  return preset?{src:preset.src,bg:preset.bg,fit:'contain'}:{src:url,fit:'cover'};
}
function lrChatAvBg(m,col){const a=lrChatAvSrc(m);return a&&a.bg?a.bg:col;}
function lrChatAvInner(m){
  const init=lrEsc((m.name||'?').charAt(0).toUpperCase());
  const a=lrChatAvSrc(m);
  if(!a||!a.src)return init;
  return '<img src="'+a.src+'" alt="" style="width:100%;height:100%;object-fit:'+a.fit+';border-radius:50%" onerror="this.replaceWith(\''+init+'\')">';
}
function lrChatAddTopic(i){
  const m=lrChatMsgs[i];if(!m)return;
  const add=lrChatMatches(m.text).filter(t=>!lrPicked(t));if(!add.length)return;
  // the lobby's picker (gsTopicToggle) — it updates lobbyTopics and broadcasts the change to everyone
  add.forEach(t=>{if(typeof gsTopicToggle==='function')gsTopicToggle(t.key,t.emoji||'',t.name,t.type||'anime');});
  const names=add.map(t=>'<b>'+lrEsc(t.name)+'</b>');
  const list=names.length>1?names.slice(0,-1).join(', ')+' and '+names[names.length-1]:names[0];
  lrChatPush({sys:true,text:lrEsc(currentUser||'The host')+' added '+list},true);
  lrChatRender();
}
function lrChatPush(m,broadcast){
  // every message carries an id, so our own broadcast echo (or a repeat) is never shown twice
  if(!m.id)m.id=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  if(lrChatMsgs.some(x=>x.id===m.id))return;
  lrChatMsgs.push(m);
  if(lrChatMsgs.length>120)lrChatMsgs.shift();
  if(broadcast){try{if(rtChannel)rtChannel.send({type:'broadcast',event:'chat',payload:m});}catch(e){}}
  if(lrRailView==='chat'){lrChatSeen=lrChatMsgs.length;lrChatRender();}
  else{const d=document.getElementById('lrChatDot');if(d&&!m.mine)d.style.display='block';}
}
function lrChatSend(){
  const i=document.getElementById('lrChatInput');
  const text=(i.value||'').trim();
  if(!text)return;
  i.value='';
  const at=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  lrChatPush({name:currentUser||'you',text,at,host:(typeof isHost!=='undefined'&&isHost),mine:true},true);
}

/* ── LOBBY ROOM header (27a) ───────────────────────────────────
   State eyebrow, live privacy segment, lock toggle. Privacy writes the same
   is_private column the create panel does; the lock is host-local state
   mirrored to guests over the existing settings_changed broadcast. */
var lobbyLocked=false;
function lrSyncHeader(){
  const eb=document.getElementById('lobbyStateEyebrow');
  if(!eb)return;
  const host=(typeof isHost!=='undefined'&&isHost);
  const inGame=(typeof lobbyInGame!=='undefined'&&lobbyInGame);
  const n=(typeof lobbyPlayers!=='undefined'&&lobbyPlayers)?lobbyPlayers.length:0;
  const state=inGame?'GAME IN PROGRESS':(lobbyLocked?'LOBBY CLOSED TO NEW PLAYERS':(n>1?'READY WHEN YOU ARE':'WAITING FOR PLAYERS'));
  eb.textContent=state+' · '+(host?"YOU'RE THE HOST":'YOU’RE A GUEST');
  const priv=(typeof lobbyIsPrivate!=='undefined'&&lobbyIsPrivate);
  document.getElementById('lrSegPublic').classList.toggle('on',!priv);
  document.getElementById('lrSegPrivate').classList.toggle('on',priv);
  const btn=document.getElementById('lobbyLockBtn');
  btn.classList.toggle('locked',lobbyLocked);
  document.getElementById('lobbyLockIcon').className='ti '+(lobbyLocked?'ti-lock':'ti-lock-open');
  document.getElementById('lobbyLockLabel').textContent=lobbyLocked?'LOBBY LOCKED':'LOBBY OPEN';
  btn.title=lobbyLocked?'Lobby locked — no new players':'Lobby open';
}
async function lrSetPrivacy(priv){
  if(typeof isHost==='undefined'||!isHost)return;
  if(lobbyIsPrivate===priv)return;
  lobbyIsPrivate=priv;
  if(typeof setPillPrivacy==='function')setPillPrivacy(priv);
  lrSyncHeader();
  if(typeof renderLobbyRoom==='function')renderLobbyRoom();
  try{
    if(!lobbyCode||SUPABASE_URL.includes('YOUR_PROJECT'))return;
    const token=await rtGetAuthToken();
    await fetch(`${SUPABASE_URL}/rest/v1/lobbies?code=eq.${encodeURIComponent(lobbyCode)}`,{
      method:'PATCH',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({is_private:priv})
    });
  }catch(e){console.warn('lrSetPrivacy',e);}
  if(typeof showLobbyToast==='function')showLobbyToast(priv?'🔒 Lobby is private — only the code gets people in.':'🌐 Lobby is public — it shows in the browser.','warning');
}
function lrToggleLock(){
  if(typeof isHost==='undefined'||!isHost)return;
  lobbyLocked=!lobbyLocked;
  lrSyncHeader();
  try{
    if(rtChannel)rtChannel.send({type:'broadcast',event:'settings_changed',payload:{lobbyLocked}});
  }catch(e){}
  if(typeof showLobbyToast==='function')showLobbyToast(lobbyLocked?'🔒 Lobby locked — no new players.':'🔓 Lobby open again.','warning');
}
/* 41a is a 3-wide board; how many ROWS fit is leftover flex space, not a viewport
   constant — so measure it and keep the pager in step with what's on screen.
   At 1280x760 this resolves to 41a's 3x3. */
let mpRows=3;
function mpPerPage(){return mpRows*2;}
function mpFitBoard(){
  const board=document.getElementById('lobbyBrowseList');
  if(!board)return;
  const floor=parseFloat(getComputedStyle(board).getPropertyValue('--mp-row'))||115;
  const gap=12;
  const cs=getComputedStyle(board);
  const inner=board.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  const rows=Math.max(1,Math.min(3,Math.floor((inner+gap)/(floor+gap))));
  if(rows!==mpRows||!board.style.gridTemplateRows){
    mpRows=rows;
    board.style.gridTemplateRows='repeat('+rows+',minmax('+floor+'px,1fr))';
  }
}
window.addEventListener('resize',()=>{mpFitBoard();if(typeof mpPage==='function')mpPage(0);});

function mpFocusCode(){
  const inp=document.getElementById('lobbyCodeInput');
  if(inp)inp.focus();
}
function mpRenderCode(){
  const inp=document.getElementById('lobbyCodeInput');
  const boxes=document.querySelectorAll('#mpBoxes .mp-box');
  if(!inp||!boxes.length)return;
  const raw=(inp.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
  const focused=document.activeElement===inp;
  boxes.forEach((b,i)=>{
    b.textContent=raw[i]||'';
    b.classList.toggle('filled',!!raw[i]);
    b.classList.toggle('active',focused&&i===Math.min(raw.length,4));
  });
  inp.value=raw;
}
(function(){
  const inp=document.getElementById('lobbyCodeInput');
  if(!inp)return;
  ['input','focus','blur','keyup','click'].forEach(ev=>inp.addEventListener(ev,()=>{
    if(ev==='input'&&typeof clearErr==='function')clearErr('lobbyJoinErr');
    mpRenderCode();
  }));
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')joinLobby();});
  mpRenderCode();
})();

function mpPage(delta){
  const list=document.getElementById('lobbyBrowseList');
  if(!list)return;
  mpFitBoard();
  const cards=[...list.querySelectorAll('.mp-card')];
  const pages=Math.max(1,Math.ceil(cards.length/mpPerPage()));
  mpPageNum=Math.min(pages-1,Math.max(0,mpPageNum+delta));
  cards.forEach((c,i)=>{c.style.display=Math.floor(i/mpPerPage())===mpPageNum?'':'none';});
  const pager=document.getElementById('mpPager');
  if(pager)pager.style.display=cards.length>mpPerPage()?'flex':'none';
  const label=document.getElementById('mpPagerLabel');
  if(label)label.textContent=(mpPageNum+1)+' / '+pages;
  const prev=document.getElementById('mpPrev'), next=document.getElementById('mpNext');
  if(prev)prev.disabled=mpPageNum===0;
  if(next)next.disabled=mpPageNum>=pages-1;
  const online=document.getElementById('mpOnlineLabel');
  if(online)online.textContent=cards.length+(cards.length===1?' LOBBY OPEN':' LOBBIES OPEN');
}
(function(){
  const _load=window.loadPublicLobbies;
  if(!_load)return;
  window.loadPublicLobbies=async function(){
    const r=await _load.apply(this,arguments);
    mpPageNum=0;mpPage(0);
    return r;
  };
})();

/* ── LOBBY ROOM v2 glue (27a / 27c) ───────────────────────────
   renderLobbyRoom() is untouched; this mirrors what it already computed into
   the new header, and switches the rail between host START and guest waiting. */
(function(){
  const _r=window.renderLobbyRoom;
  if(!_r)return;
  window.renderLobbyRoom=function(){
    const r=_r.apply(this,arguments);
    const page=document.getElementById('page-lobby-room');
    if(page)page.classList.toggle('is-guest',!(typeof isHost!=='undefined'&&isHost));
    const chip=document.getElementById('lobbyCodeChip');
    if(chip)chip.textContent=(typeof lobbyCode!=='undefined'&&lobbyCode)||'';
    lrSyncHeader();
    if(typeof lrChatRender==='function'&&lrRailView==='chat')lrChatRender();
    return r;
  };
  /* expiry pill only turns loud under a minute (27a) */
  const pill=document.getElementById('lobbyExpiryPill');
  const disp=document.getElementById('lobbyExpiryTimerDisplay');
  const mirror=document.getElementById('lobbyExpiryMirror');
  if(pill&&disp&&mirror){
    const sync=()=>{
      const t=(disp.textContent||'').trim();
      mirror.textContent=t||'—';
      const m=/^(\d+):(\d+)$/.exec(t);
      pill.classList.toggle('urgent',!!m&&Number(m[1])===0);
    };
    new MutationObserver(sync).observe(disp,{childList:true,characterData:true,subtree:true});
    sync();
  }

  /* "saved Ns ago" — #lobbySettingsLabel is rewritten on every live-sync payload,
     so its mutations are the honest signal that settings just synced. */
  const saved=document.getElementById('lobbySyncSaved');
  const label=document.getElementById('lobbySettingsLabel');
  if(saved&&label){
    let at=null, tick=null;
    const paint=()=>{
      if(at==null){saved.textContent='';return;}
      const n=Math.round((Date.now()-at)/1000);
      saved.textContent=n<2?'saved just now':'saved '+n+'s ago';
    };
    new MutationObserver(()=>{
      at=Date.now();paint();
      clearInterval(tick);tick=setInterval(paint,1000);
    }).observe(label,{childList:true,characterData:true,subtree:true});
  }
  const _gs=window.goStep;
  window.goStep=function(name){
    const r=_gs.apply(this,arguments);
    document.body.classList.toggle('on-lobby',name==='lobby-room');
    return r;
  };
})();

/* ── SOLO SETUP v2 glue (handoff section 12) ───────────────────
   One screen (24a) plus the 24b picker overlay. It calls the app's existing
   setters, so question loading and scoring are untouched; the footer dials
   write the same vars the game-settings modal does, and START goes straight
   to startQuiz(), bypassing that modal for solo.

   Section 12.1: formats are Text / Scene / Characters and "answer by" is a
   player toggle. The app's four format ids are the product of the two: */
const SU_FMT={
  text:{choose:'mc',   type:'type'},
  scene:{choose:null,  type:'scene'},   /* no MC scene questions exist */
  char:{choose:'char-mc',type:'char'}
};
const SU_FMT_D={
  text:'A plain question about a series, a character or a moment — no image.',
  scene:"A still from the episode — name the series, the moment or who's on screen.",
  char:'A cropped portrait — name the character on screen.'
};
const SU_FMT_LABEL={text:'TEXT',scene:'SCENE',char:'CHARACTERS'};
const SU_FMT_ICON={text:'ti-abc',scene:'ti-photo',char:'ti-user-square-rounded'};
const SU_MODES=[
  {id:'classic',emoji:'🎮',name:'Classic',sub:'RELAXED',
   desc:'Answer at your own pace. Every correct answer is worth a flat point, there are no lives to lose and nothing to race to.',
   tags:[['ti-coin','1 PT EACH'],['ti-heart-off','NO LIVES']]},
  {id:'race',emoji:'🏁',name:'Score Race',sub:'SPEED',
   desc:'The clock is the opponent. Fast answers are worth full points, slow ones pay less, and the run ends the moment you hit the target.',
   tags:[['ti-bolt','SPEED SCORED'],['ti-flag','RACE TO TARGET']]},
  {id:'survival',emoji:'❤️',name:'Survival',sub:'LIVES',
   desc:'No question limit — only lives. Every wrong answer or timeout costs one, and the run ends when the last one goes.',
   tags:[['ti-heart','LIVES AT STAKE'],['ti-infinity','NO QUESTION LIMIT']]}
];
let suFormat='text', suAnswerBy='choose', suModeI=0, suHl=null, suPending=[];

function _suEsc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function suMode(){return SU_MODES[suModeI];}
function suTopics(){return (typeof animeTopics!=='undefined'?animeTopics:[])||[];}
function suAppFormat(f){const m=SU_FMT[f||suFormat];return (suAnswerBy==='choose'&&m.choose)?m.choose:m.type;}
function suCountKey(f){const a=suAppFormat(f);return typeof cntFmtFor==='function'?cntFmtFor(a):a;}
function suCountOf(t,f){
  const k=suCountKey(f);
  // With specific parts picked, Text counts cover only those parts (what will actually be drawn)
  if(t&&(k==='mc'||k==='type')){
    const ids=activeTopicParts(t.name);
    if(ids.length)return (topicPartsByName[t.name]||[]).filter(p=>ids.includes(p.id)).reduce((a,p)=>a+(p[k]||0),0);
  }
  return t&&t.counts?(t.counts[k]||0):0;
}
/* counts are scoped to what will actually be drawn from (24a) */
function suScope(){
  const all=suTopics();
  if(isGeneralSelected||!(selectedTopics||[]).length)return all;
  return (selectedTopics||[]).map(t=>all.find(x=>x.key===t.key)).filter(Boolean);
}
function suTotal(f){return suScope().reduce((a,t)=>a+suCountOf(t,f),0);}

/* ── top pod ── */
function suSyncAnswerBy(){
  const m=SU_FMT[suFormat];
  const ch=document.getElementById('suAbChoose'), ty=document.getElementById('suAbType'), note=document.getElementById('suAbNote');
  const chooseOK=!!m.choose;
  if(!chooseOK&&suAnswerBy==='choose')suAnswerBy='type';
  ch.classList.toggle('off',!chooseOK);
  ch.classList.toggle('on',suAnswerBy==='choose'&&chooseOK);
  ty.classList.toggle('on',suAnswerBy==='type');
  note.textContent=chooseOK?"answering style doesn't change what's available"
                           :'scene questions are typed only — no multiple-choice stills yet';
  selectedFormat=SU_FMT[suFormat][suAnswerBy]||SU_FMT[suFormat].type;
}
function suPickFormat(f){suFormat=f;suSyncAnswerBy();suSync();}
function suPickAnswerBy(v){
  if(v==='choose'&&!SU_FMT[suFormat].choose)return;
  suAnswerBy=v;suSyncAnswerBy();suSync();
}

/* ── mode marquee ── */
function suModeStep(d){suModeI=(suModeI+d+SU_MODES.length)%SU_MODES.length;suSync();}
function suPickMode(id){const i=SU_MODES.findIndex(m=>m.id===id);if(i>=0){suModeI=i;suSync();}}
function suRenderModes(){
  const m=suMode();
  document.getElementById('suArtE').textContent=m.emoji;
  document.getElementById('suArtN').textContent=m.name.toUpperCase();
  document.getElementById('suModeIdx').textContent='MODE '+(suModeI+1)+' OF '+SU_MODES.length;
  document.getElementById('suPips').innerHTML=SU_MODES.map((x,i)=>'<i class="'+(i===suModeI?'on':'')+'"></i>').join('');
  document.getElementById('suModeT').textContent=m.name;
  document.getElementById('suModeD').textContent=m.desc;
  document.getElementById('suModeTags').innerHTML=m.tags.map(([ic,l])=>'<span class="su-mtag"><i class="ti '+ic+'"></i> '+l+'</span>').join('');
  document.getElementById('suThumbs').innerHTML=SU_MODES.map((x,i)=>
    '<button class="su-thumb'+(i===suModeI?' on':'')+'" onclick="suPickMode(\''+x.id+'\')">'
    +'<span class="su-thumb-e">'+x.emoji+'</span><span style="flex:1;min-width:0">'
    +'<span class="su-thumb-t" style="display:block">'+x.name+'</span>'
    +'<span class="su-thumb-s" style="display:block">'+(i===suModeI?'PLAYING':x.sub)+'</span></span></button>').join('');
}

/* ── footer dials (one slot is mode-dependent, one is always the clock) ── */
function suDialHTML(icon,vals,cur,fn,suffix){
  return '<i class="ti '+icon+'"></i><div class="su-dial-opts">'+vals.map(v=>
    '<button class="su-dial-opt'+(v===cur?' on':'')+'" onclick="'+fn+'('+v+')">'+v+(suffix||'')+'</button>').join('')+'</div>';
}
function suRenderDials(){
  const id=suMode().id;
  const A=document.getElementById('suDialA'), B=document.getElementById('suDialB');
  if(id==='race')A.innerHTML=suDialHTML('ti-flag',[500,1000,1500],soloRaceTarget,'suSetTarget');
  else if(id==='survival')A.innerHTML=suDialHTML('ti-heart',[1,3,5],selectedLives,'suSetLives');
  else A.innerHTML=suDialHTML('ti-list-numbers',[10,15,20],selectedQuestionLimit,'suSetQCount');
  B.innerHTML=suDialHTML('ti-clock',[15,20,30],raceTimeLimit,'suSetTimer');
}
function suSetQCount(v){selectedQuestionLimit=v;suSync();}
function suSetTarget(v){soloRaceTarget=v;suSync();}
function suSetLives(v){selectedLives=v;suSync();}
function suSetTimer(v){raceTimeLimit=v;suSync();}

/* Selected-topic chips. Big sets (a genre pick can add 60) show the first few,
   a "+N more" count and a Clear button so the footer doesn't swallow the screen. */
const SU_CHIP_CAP=8;
function suSelChipsHTML(sel,all){
  const chip=t=>{
    const full=all.find(x=>x.key===t.key), n=full?suCountOf(full):0;
    return '<span class="su-chip'+(n===0?' zero':'')+'">'+_suEsc(t.name)+' <span class="n">· '+n+'</span>'
      +'<button onclick="suToggle(\''+t.key+'\')" aria-label="Remove"><i class="ti ti-x" style="font-size:11px"></i></button></span>';
  };
  if(sel.length<=SU_CHIP_CAP)return sel.map(chip).join('');
  const shown=SU_CHIP_CAP-2;
  return sel.slice(0,shown).map(chip).join('')
    +'<span class="su-chip" title="'+_suEsc(sel.slice(shown).map(t=>t.name).join(', '))+'">+'+(sel.length-shown)+' more</span>'
    +'<button class="su-chip su-chip-clear" onclick="suClearTopics()"><i class="ti ti-trash" style="font-size:11px"></i> Clear all</button>';
}
function suClearTopics(){
  selectedTopics=[];
  renderSelectedTags();updateProceedBtn();suSync();
}

/* ── footer topics + the three-state count rule (section 12.3) ── */
function suFootSync(){
  const chips=document.getElementById('suChips'), note=document.getElementById('suNote'), start=document.getElementById('suStart');
  if(!chips)return;
  const all=suTopics(), sel=selectedTopics||[];
  chips.innerHTML=isGeneralSelected
    ? '<span class="su-chip">🌐 General Anime</span>'
    : suSelChipsHTML(sel,all);

  const total=suTotal();
  const counts=isGeneralSelected?[total]:sel.map(t=>{const f=all.find(x=>x.key===t.key);return f?suCountOf(f):0;});
  const empties=counts.filter(n=>n===0).length;
  const id=suMode().id;
  const clock=raceTimeLimit+'s a question';
  let blocked=false, html='';

  if(!isGeneralSelected&&!sel.length){
    isGeneralSelected=true;
    document.getElementById('suGeneral')?.classList.add('on');
    const tot=suTotal();
    html='<i class="ti ti-player-play" style="font-size:13px;flex:none"></i><span>Drawing '+selectedQuestionLimit+' from '+tot+' questions · '+clock+'</span>';
  } else if(total===0){
    blocked=true;
    const other=['text','scene','char'].filter(f=>f!==suFormat&&suTotal(f)>0).map(f=>'<b>'+(f==='char'?'Characters':f.charAt(0).toUpperCase()+f.slice(1))+'</b>');
    html='<i class="ti ti-alert-triangle" style="font-size:14px;color:#f87171;flex:none"></i><span>No <b>'+(SU_FMT_LABEL[suFormat].charAt(0)+SU_FMT_LABEL[suFormat].slice(1).toLowerCase())
      +'</b> questions exist for '+(sel.length>1?'these topics':'this topic')+' yet — '
      +(other.length?'switch to '+other.join(' or ')+', or ':'')+'add a topic that has some.</span>';
  } else {
    const scopeNote=empties?' · '+(counts.length-empties)+' of '+counts.length+' topics have questions':'';
    html='<i class="ti ti-player-play" style="font-size:13px;flex:none"></i><span>'
      +(id==='race' ? 'Racing to '+soloRaceTarget+' pts · '+clock
       :id==='survival' ? selectedLives+(selectedLives===1?' life':' lives')+' · '+clock+' · '+total+' in the pool'
       : 'Drawing '+selectedQuestionLimit+' from '+total+' questions · '+clock)
      +scopeNote+'</span>';
  }
  note.className='su-note'+(blocked?' warn':'');
  note.innerHTML=html;
  const partsEl=document.getElementById('suParts');
  if(partsEl)partsEl.innerHTML=isGeneralSelected?'':partsRowHTML(sel,soloTopicParts,suFormat==='text'?suCountKey(suFormat):suFormat==='char'?'char':null,'suTogglePart');
  start.disabled=blocked;
  start.innerHTML=blocked?'START':'START <span class="kbd">⏎</span>';
}

function suSync(){
  if(!document.getElementById('suFmts'))return;
  document.querySelectorAll('#suFmts .su-fmt').forEach(b=>{
    const f=b.dataset.f;
    b.classList.toggle('on',f===suFormat);
    const c=b.querySelector('.su-fmt-c');
    const n=suTotal(f);
    c.textContent=suTopics().length?(n+' QUESTION'+(n===1?'':'S')):'—';
  });
  document.getElementById('suFmtDesc').textContent=SU_FMT_D[suFormat];
  suRenderModes();suRenderDials();suFootSync();
  if(document.getElementById('suPicker').classList.contains('on'))suRenderTopics();
}

/* ── 24b picker ── */
function suOpenPicker(){
  document.getElementById('suPicker').classList.add('on');
  const b=document.getElementById('pkBadge');
  b.innerHTML='<i class="ti '+SU_FMT_ICON[suFormat]+'" style="font-size:13px"></i> '+SU_FMT_LABEL[suFormat];
  document.getElementById('pkSub').textContent=suTopics().length+' ANIME · COUNTS FOLLOW THE FORMAT';
  suRenderTopics();
  const s=document.getElementById('suSearch');if(s)setTimeout(()=>s.focus(),30);
}
function suClosePicker(){document.getElementById('suPicker').classList.remove('on');suSync();}

function suRenderTopics(){
  const list=document.getElementById('suList');
  if(!list)return;
  const q=(document.getElementById('suSearch').value||'').trim();
  const all=suTopics();
  const gen=document.getElementById('suGeneral');
  gen.classList.toggle('on',!!isGeneralSelected);
  document.getElementById('suGeneralC').textContent=all.length?all.reduce((a,t)=>a+suCountOf(t),0).toLocaleString():'';
  document.getElementById('pkSub').textContent=all.length+' ANIME · COUNTS FOLLOW THE FORMAT';

  if(!all.length){list.innerHTML='<div class="pk-pv-s">Loading topics…</div>';suPkFoot();return;}
  suRenderGenres();

  const items=all.filter(t=>t.name.toLowerCase().includes(q.toLowerCase()));
  /* 21a — the zero-result state IS the suggestion form */
  if(!items.length){
    list.innerHTML='<div class="pk-zero">'
      +'<div class="pk-zero-t">No topic called “'+_suEsc(q)+'”</div>'
      +'<div class="pk-zero-d">Nobody has written questions for it yet. Ask for it and it goes on the writing queue — duplicates merge into a vote count, so asking twice helps.</div>'
      +'<button class="pk-zero-b" onclick="suSuggest(\''+_suEsc(q).replace(/'/g,"\\'")+'\')">SUGGEST THIS TOPIC</button>'
      +(suPending.length?'<div class="pk-pending">'+suPending.map(p=>'<span class="su-chip zero">'+_suEsc(p)+' · PENDING</span>').join('')+'</div>':'')
      +'</div>';
    suPkFoot();return;
  }

  const sorted=items.slice().sort((a,b)=>{
    const ae=suCountOf(a)===0, be=suCountOf(b)===0;
    if(ae!==be)return ae?1:-1;
    return a.name.localeCompare(b.name);
  });
  let html='', letter=null;
  sorted.forEach(t=>{
    const n=suCountOf(t), empty=n===0;
    const L=empty?'—':t.name[0].toUpperCase();
    if(L!==letter){letter=L;html+='<div class="pk-div"><b>'+(empty?'NO QUESTIONS YET':L)+'</b><i></i></div>';}
    const on=(selectedTopics||[]).some(x=>x.key===t.key);
    html+='<div class="pk-row'+(on?' on':'')+(empty?' empty':'')+(suHl===t.key?' hl':'')+'"'
      +' onmouseenter="suHighlight(\''+t.key+'\')"'
      +(empty?'':' onclick="suToggle(\''+t.key+'\')"')
      +'><span class="ck">'+(on?'<i class="ti ti-check"></i>':(suHl===t.key?'<i class="ti ti-chevron-right"></i>':''))+'</span>'
      +'<span class="nm">'+_suEsc(t.name)+'</span><span class="ct">'+(empty?'—':n)+'</span></div>';
  });
  /* 21b — dashed suggest row as the last row of the list, browse state included */
  html+='<div class="pk-row suggest" onclick="suSuggest(\''+_suEsc(q).replace(/'/g,"\\'")+'\')">'
    +'<span class="ck"><i class="ti ti-plus" style="font-size:12px;color:var(--muted)"></i></span>'
    +'<span class="nm">'+(q?'Suggest “'+_suEsc(q)+'” as a new topic':'Not here? Suggest a title…')+'</span></div>';
  list.innerHTML=html;
  suPkFoot();
}

function suHighlight(key){
  suHl=key;
  const t=suTopics().find(x=>x.key===key);
  if(!t)return;
  document.querySelectorAll('#suList .pk-row').forEach(r=>r.classList.remove('hl'));
  applyPoster(document.getElementById('suPoster'),t);
  document.getElementById('suPvT').textContent=t.name;
  document.getElementById('suPvS').textContent='Series pool';
  const lead=suCountKey();
  const labels=[['mc','Text · MC'],['type','Text · TTA'],['scene','Scene'],['char','Characters']];
  document.getElementById('suPvCounts').innerHTML=labels.map(([k,l])=>{
    const n=t.counts?(t.counts[k]||0):0;
    return '<div class="pk-c'+(k===lead?' lead':'')+'"><span>'+l+'</span><b>'+(n||'—')+'</b></div>';
  }).join('');
  const st=document.getElementById('suPvState');
  const on=(selectedTopics||[]).some(x=>x.key===key);
  const empty=suCountOf(t)===0;
  st.className='pk-state'+(on?' in':'');
  st.innerHTML=empty
    ? '<i class="ti ti-ban" style="font-size:14px"></i> NOTHING TO DRAW YET'
    : (on ? '<i class="ti ti-check" style="font-size:14px"></i> IN YOUR SET<span class="kbd">click again to remove</span>'
          : '<i class="ti ti-arrow-left" style="font-size:14px"></i> CLICK THE TITLE TO ADD<span class="kbd">or SPACE</span>');
}
function suToggle(key){
  const t=suTopics().find(x=>x.key===key);
  if(!t)return;
  toggleTopic(t.key,t.emoji||'',t.name,t.type);
  suHighlight(key);suSync();
}
function suAddHighlighted(){if(suHl)suToggle(suHl);}

/* ── genre quick pick: tags come from topics.genres ── */
// A chip adds every topic with that genre that has questions in the current format
// (and picked parts) to the set; clicking it again when they're all in removes them.
const SU_GENRE_ORDER=['Adventure','Comedy','Drama','Fantasy','Romance','Sci-Fi','Supernatural','Superpowers','Mystery','Psychological','Horror','Historical','Military','School','Slice of Life','Sports','Isekai','Mecha','Games'];
// Tags kept in topics.genres but not shown as chips (Action covers ~60 of 103 series, owner 2026-11-18)
const SU_GENRE_HIDDEN=new Set(['Action']);
function suGenreTopics(g){return suTopics().filter(t=>(t.genres||[]).includes(g)&&suCountOf(t)>0);}
function suRenderGenres(){
  const box=document.getElementById('suGenres');
  if(!box)return;
  const used=new Set();suTopics().forEach(t=>(t.genres||[]).forEach(g=>{if(!SU_GENRE_HIDDEN.has(g))used.add(g);}));
  const genres=[...SU_GENRE_ORDER.filter(g=>used.has(g)),...[...used].filter(g=>!SU_GENRE_ORDER.includes(g)).sort()];
  const sel=new Set((selectedTopics||[]).map(t=>t.key));
  const chips=genres.map(g=>({g,list:suGenreTopics(g)})).filter(c=>c.list.length);
  box.innerHTML=chips.length?'<span class="pk-genres-l">GENRES</span>'+chips.map(({g,list})=>{
    const on=!isGeneralSelected&&list.every(t=>sel.has(t.key));
    return '<button type="button" class="pk-genre'+(on?' on':'')+'" onclick="suToggleGenre(\''+_suEsc(g).replace(/'/g,"\\'")+'\')"'
      +' title="'+(on?'Remove':'Add')+' every '+_suEsc(g)+' series">'+_suEsc(g)+'<span class="n">'+list.length+'</span></button>';
  }).join(''):'';
}
function suToggleGenre(g){
  const list=suGenreTopics(g);
  if(!list.length)return;
  if(isGeneralSelected){isGeneralSelected=false;updateGeneralUI();}
  const sel=new Set(selectedTopics.map(t=>t.key));
  if(list.every(t=>sel.has(t.key))){
    const drop=new Set(list.map(t=>t.key));
    selectedTopics=selectedTopics.filter(t=>!drop.has(t.key));
  }else{
    list.forEach(t=>{if(!sel.has(t.key))selectedTopics.push({key:t.key,emoji:t.emoji||'',name:t.name,type:t.type});});
  }
  renderSelectedTags();updateProceedBtn();suSync();
}

function suPkFoot(){
  const all=suTopics(), sel=selectedTopics||[];
  const chips=document.getElementById('pkChips');
  document.getElementById('pkSelN').textContent='SELECTED · '+(isGeneralSelected?'ALL':sel.length);
  chips.innerHTML=isGeneralSelected
    ? '<span class="su-chip">🌐 General Anime</span>'
    : suSelChipsHTML(sel,all);
  document.getElementById('pkTotal').textContent=suTotal().toLocaleString();
}

/* 22a / 21a — the suggestion sheet the picker hands off to */
function suSuggest(name){
  if(name)suPending=[...new Set(suPending.concat(name))];
  if(typeof openSubmitQuestion==='function'){
    openSubmitQuestion();
    if(typeof sqSwitchTab==='function')setTimeout(()=>sqSwitchTab('suggest'),0);
    const f=document.getElementById('sqSuggestTopic');
    if(f&&name)setTimeout(()=>{f.value=name;if(typeof sqSuggestTopicInput==='function')sqSuggestTopicInput();},60);
  }
  suRenderTopics();
}

/* ── remember last topics: saved when a solo game starts, pre-selected on the next visit ── */
const SU_LAST_KEY='as_last_topics';
let suLastRestored=false; // only once per page load, so Clear all / General stick for the session
function suSaveLastTopics(){
  try{
    const v=isGeneralSelected||!selectedTopics.length?{general:true}:{topics:selectedTopics.map(t=>({key:t.key,name:t.name,type:t.type}))};
    localStorage.setItem(SU_LAST_KEY,JSON.stringify(v));
  }catch(e){}
}
function suRestoreLastTopics(){
  if(suLastRestored)return;
  suLastRestored=true;
  if(selectedTopics.length)return; // something already picked (e.g. Play from the library)
  let v=null;
  try{v=JSON.parse(localStorage.getItem(SU_LAST_KEY)||'null');}catch(e){}
  if(!v||!Array.isArray(v.topics)||!v.topics.length)return;
  const all=suTopics();
  const list=all.length?v.topics.filter(t=>all.some(x=>x.key===t.key)):v.topics;
  if(!list.length)return;
  selectedTopics=list.map(t=>({key:t.key,emoji:'',name:t.name,type:t.type||'anime'}));
  isGeneralSelected=false;
}

/* ── enter / leave / start ── */
function suEnter(){
  suRestoreLastTopics();
  if(!selectedTopics.length)isGeneralSelected=true;
  suSyncAnswerBy();
  const st=(typeof dailyStreakInfo==='function')?dailyStreakInfo().streak:0;
  const s=document.getElementById('suStreakN');if(s)s.textContent=st;
  if(!suTopics().length&&typeof loadTopicsFromSupabase==='function'){
    loadTopicsFromSupabase();
    [400,1200,2600].forEach(ms=>setTimeout(suSync,ms));
  }
  suSync();
}
function suExit(){
  if(document.getElementById('suPicker').classList.contains('on')){suClosePicker();return;}
  goStep('landing');
}
function suStart(){
  if(document.getElementById('suStart').disabled)return;
  const m=suMode().id;
  suSaveLastTopics();
  pendingMode=m;pendingLobbyAfterTimeLimit=false;
  selectedFormat=SU_FMT[suFormat][suAnswerBy]||SU_FMT[suFormat].type;
  const badge=document.getElementById('selectedTopicBadge');
  if(badge){
    const pill=txt=>'<span style="display:inline-flex;align-items:center;gap:6px;background:var(--accent-soft);border:1px solid var(--border2);border-radius:99px;padding:5px 14px;font-size:12px;font-weight:800">'+_suEsc(txt)+'</span>';
    badge.innerHTML=isGeneralSelected?pill('🌐 General Anime'):(selectedTopics||[]).map(t=>pill(t.name)).join('');
    badge.style.display='flex';
  }
  mpShowCountdown(()=>startQuiz(m),null,{mode:m});
}

/* ── keep the app's own handlers in sync with this screen ── */
(function(){
  ['toggleTopic','toggleGeneral','renderSelectedTags','updateProceedBtn'].forEach(fn=>{
    const o=window[fn];
    if(!o)return;
    window[fn]=function(){const r=o.apply(this,arguments);suSync();return r;};
  });
  const _gs=window.goStep;
  window.goStep=function(name){
    /* the three old steps are one screen now */
    if(name==='format'||name==='mode'||name==='topic')name='setup';
    const r=_gs.call(this,name);
    document.body.classList.toggle('on-setup',name==='setup');
    document.body.classList.toggle('on-auth',name==='auth');
    if(name==='auth'&&typeof showAuthMode==='function')showAuthMode(null);
    if(name!=='setup')document.getElementById('suPicker').classList.remove('on');
    if(name==='setup')suEnter();
    return r;
  };
  /* marquee keys — only while the setup screen is the live view */
  document.addEventListener('keydown',e=>{
    if(!document.body.classList.contains('on-setup'))return;
    const t=e.target, typing=t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable);
    const pickerOpen=document.getElementById('suPicker').classList.contains('on');
    if(pickerOpen){
      if(e.key==='Escape'){e.preventDefault();suClosePicker();}
      else if(e.key===' '&&!typing&&suHl){e.preventDefault();suToggle(suHl);}
      return;
    }
    if(typing)return;
    if(e.key==='ArrowLeft'){e.preventDefault();suModeStep(-1);}
    else if(e.key==='ArrowRight'){e.preventDefault();suModeStep(1);}
    else if(e.key==='Enter'){e.preventDefault();suStart();}
  });
  suSyncAnswerBy();
})();

/* ── MP QUIZ v2 glue ─────────────────────────────────────────
   Adapts the untouched multiplayer game code to the v2 stage: vertical rail,
   mode classes, collapsible player column, §6 type well, feedback states. */
function mpRailTick(pct,secs){
  const bar=document.getElementById('mpTimerBar'),num=document.getElementById('mpTimerNum');
  const cls=pct<30?' danger':pct<60?' warn':'';
  if(bar){bar.style.height=pct+'%';bar.className='q-rail-fill'+cls;}
  if(secs==null&&lobbyMode!=='slowreveal'&&typeof raceTimeLimit!=='undefined')secs=raceTimeLimit;
  if(num){num.textContent=secs==null?'':Math.ceil(Math.max(0,secs));num.className='q-rail-num'+cls;}
}
const MP_MODE_LABEL={classic:'CLASSIC',race:'SCORE RACE',survival:'SURVIVAL',potato:'HOT POTATO',slowreveal:'SLOW REVEAL'};
function mpSetPlayersOpen(open){
  const col=document.getElementById('mpPlayers'),st=document.getElementById('mpQuizStage');
  if(!col||!st)return;
  col.classList.toggle('collapsed',!open);st.classList.toggle('players-open',open);
  const ch=document.getElementById('mpPlayersChev');if(ch)ch.className='ti ti-chevron-'+(open?'right':'left');
}
function mpTogglePlayers(){
  const col=document.getElementById('mpPlayers');const open=col.classList.contains('collapsed');
  mpSetPlayersOpen(open);
  try{localStorage.setItem('qPlayersOpen:mp',open?'1':'0')}catch(e){}
}
function mpApplyStage(){
  const st=document.getElementById('mpQuizStage');if(!st)return;
  const m=(typeof lobbyMode!=='undefined'&&lobbyMode)||'classic';
  Object.keys(MP_MODE_LABEL).forEach(k=>st.classList.toggle('mode-'+k,k===m));
  if(st.dataset.mode!==m){
    st.dataset.mode=m;
    let s=null;try{s=localStorage.getItem('qPlayersOpen:mp')}catch(e){}
    mpSetPlayersOpen(s!=='0');
  }
  st.classList.toggle('last-life',selectedMode==='survival'&&typeof lives!=='undefined'&&lives===1);
  const lbl=document.getElementById('mpHudLabel');if(lbl)lbl.textContent=MP_MODE_LABEL[m]||'';
  const t=document.getElementById('mpPlayersTitle');if(t)t.textContent=m==='potato'?'AROUND THE TABLE':'LIVE SCORES';
}
function mpRenderStrip(){
  const strip=document.getElementById('mpPlayersStrip');if(!strip||typeof lobbyPlayers==='undefined')return;
  const isHP=lobbyMode==='potato';
  const list=isHP&&hpTurnOrder.length?hpTurnOrder.map(n=>lobbyPlayers.find(p=>p.name===n)).filter(Boolean):[...lobbyPlayers].sort((a,b)=>b.score-a.score);
  const lead=isHP?null:list[0];
  const live=list.filter(p=>!p.quit);
  strip.innerHTML=list.map(p=>{
    const c='qp-chip'+(p===lead?' lead':'')+(p.name===currentUser?' me':'');
    const holding=isHP&&!p.eliminated&&hpActivePlayer().name===p.name;
    return '<div class="'+c+'" title="'+p.name+'" style="'+(p.quit||p.eliminated?'opacity:.4':'')+'"><div class="qp-chip-av">'+(holding?'<span class="hp-pt" aria-label="Hot potato"><span class="hp-pt-p">🥔</span><span class="hp-pt-tag"><b>爆</b></span></span>':(p.avatar?getLobbyAvatarHTML(p.avatar,'var(--bg3)',p.name[0].toUpperCase(),34).replace('class="lobby-player-avatar"','class="qp-chip-pic"'):p.name[0].toUpperCase()))+'</div><div class="qp-dot'+(p.roundAnswered?'':' thinking')+'"></div></div>';
  }).join('');
  const v=document.getElementById('mpPlayersV');if(v)v.textContent='LIVE · '+live.length;
  const ty=document.getElementById('mpPlayersTally');
  if(ty)ty.innerHTML=live.filter(p=>p.roundAnswered).length+'<span>/'+live.length+'</span>';
}
function mpRestyleTypeWell(){
  const wrap=document.querySelector('#mpAnswersGrid .type-wrap');
  if(!wrap||wrap.dataset.v2)return;
  const input=wrap.querySelector('#mpTypeInput'),submit=wrap.querySelector('#mpTypeSubmitBtn'),hint=wrap.querySelector('#mpTypeWrongHint');
  if(!input||!submit)return;
  wrap.dataset.v2='1';
  const waiting=input.disabled;
  input.removeAttribute('style');submit.removeAttribute('style');
  input.setAttribute('maxlength','40');
  const row=document.createElement('div');row.className='type-row';
  const field=document.createElement('div');field.className='type-field'+(waiting?' waiting':'');field.id='mpTypeField';
  const icon=document.createElement('i');icon.className='ti ti-'+(waiting?'lock':'pencil');icon.style.cssText='font-size:26px;color:'+(waiting?'var(--muted)':'var(--accent)');
  const count=document.createElement('div');count.className='type-count';count.textContent='0 / 40';
  field.append(icon,input,count);
  const isHP=lobbyMode==='potato';
  if(isHP&&!waiting)submit.className='potato-pass';
  submit.innerHTML=isHP?'PASS IT <i class="ti ti-arrow-right" style="font-size:20px"></i>':'SUBMIT <span class="type-kbd">⏎</span>';
  row.append(field,submit);
  const second=document.createElement('div');second.className='type-second';
  if(hint){hint.style.margin='0';second.appendChild(hint);}
  wrap.innerHTML='';wrap.append(row,second);
  input.addEventListener('input',()=>{count.textContent=input.value.length+' / 40';});
}
(function(){
  const panel=()=>document.getElementById('mpQPanel');
  const _sb=window.renderMPScoreboard;
  window.renderMPScoreboard=function(){const r=_sb.apply(this,arguments);mpApplyStage();mpRenderStrip();return r;};
  const _sq=window.mpShowQuestion;
  window.mpShowQuestion=function(qData){
    const p=panel();if(p)p.classList.remove('correct','wrong');
    const fb=document.getElementById('mpQCardFeedback');if(fb)fb.className='q-feedback';
    const r=_sq.apply(this,arguments);
    const st=document.getElementById('mpQuizStage');
    if(st){st.classList.remove('fmt-scene','fmt-char','fmt-img');
      if(qData&&qData.media_url){const f=selectedFormat||lobbyFormat;
        if(f==='scene')st.classList.add('fmt-scene');else if(f==='char'||f==='char-mc')st.classList.add('fmt-char');else st.classList.add('fmt-img');}}
    mpApplyStage();mpRestyleTypeWell();
    document.getElementById('mpQuestionText')?.classList.toggle('under-image',!!(qData&&qData.media_url));
    return r;
  };
  function mark(correct){
    const fb=document.getElementById('mpQCardFeedback');if(fb){fb.className='q-feedback '+(correct?'correct-fb':'wrong-fb');fb.dataset.info=(lobbyMode==='potato'||lobbyMode==='slowreveal')?'1':'';}
    const p=panel();if(p){p.classList.remove('correct','wrong');p.classList.add(correct?'correct':'wrong');}
    const tf=document.getElementById('mpTypeField');if(tf){tf.classList.remove('waiting');tf.classList.add(correct?'correct':'wrong');}
    document.querySelectorAll('#mpAnswersGrid .ans').forEach(el=>{if(!el.classList.contains('correct')&&!el.classList.contains('wrong'))el.classList.add('dim');});
  }
  const _fb=window.mpShowFeedback;
  window.mpShowFeedback=function(correct){const r=_fb.apply(this,arguments);mark(!!correct);const t=document.getElementById('mpFbTitle');if(t)t.style.display=(t.textContent==='Wrong!'||t.textContent==='Correct!')?'none':'';const ya=document.getElementById('mpFbYourAns');if(ya&&!document.getElementById('mpTypeField'))ya.style.display='none';return r;};
  if(window.srShowFeedback){const _s=window.srShowFeedback;window.srShowFeedback=function(correct){const r=_s.apply(this,arguments);mark(!!correct);return r;};}
  if(window.srStartReveal){const _r=window.srStartReveal;window.srStartReveal=function(){const st=document.getElementById('mpQuizStage');if(st)st.classList.remove('fmt-scene','fmt-char','fmt-img');const p=panel();if(p)p.classList.remove('correct','wrong');const r=_r.apply(this,arguments);mpApplyStage();return r;};}
  if(window.srRoundEnd){const _e=window.srRoundEnd;window.srRoundEnd=function(){const r=_e.apply(this,arguments);mark(false);return r;};}

  // auto-next fill follows the existing "Next in Ns" label
  const lab=document.getElementById('mpAutoNext'),fill=document.getElementById('mpNextFill');
  if(lab&&fill)new MutationObserver(()=>{
    const m=/Next in (\d+)s/.exec(lab.textContent||'')||(/Wrapping/.test(lab.textContent||'')?[0,5]:null);
    if(m&&!fill.dataset.run){
      fill.dataset.run='1';fill.style.transition='none';fill.style.width='0';void fill.offsetWidth;
      fill.style.transition='width '+m[1]+'s linear';fill.style.width='100%';
    } else if(!m&&!/Wrapping/.test(lab.textContent||'')){delete fill.dataset.run;fill.style.transition='none';fill.style.width='0';}
  }).observe(lab,{childList:true,characterData:true,subtree:true});

  // body chrome flags — mp pages are also reached through _origGoStep
  const sync=()=>{
    const q=document.getElementById('page-mp-quiz')?.classList.contains('active');
    const r=document.getElementById('page-mp-results')?.classList.contains('active');
    document.body.classList.toggle('on-mp-quiz',!!q);document.body.classList.toggle('on-mp-results',!!r);
    if(q)mpApplyStage();
  };
  ['page-mp-quiz','page-mp-results'].forEach(id=>{const el=document.getElementById(id);if(el)new MutationObserver(sync).observe(el,{attributes:true,attributeFilter:['class','style']});});
  sync();
})();

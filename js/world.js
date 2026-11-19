// Night/dusk/bright, tour, library, credits, about, landing greeter, sekai map, sky calendar (moved out of index.html 2026-11-19; order matters)
/* NIGHT / DUSK / BRIGHT — player's choice, whole site, saved on this device (as_depth).
   Night = the Moonlight theme as-is. Dusk/Bright = Moonlight's two hues as a lit ground (palVars). */
(function(){
const DEPTHS=[['Twilight','ti-sparkles']]; // single sky — the picker UI is hidden
const VARS=['--accent','--accent-soft','--bg','--bg2','--bg3','--border','--border2','--text','--muted','--faint','--orb1','--orb2','--orb3','--card-bg','--card-border','--aur2a','--aur2b','--aur2','--hover','--pal-grad','--pal-radial'];
let depth='Twilight';
if(!DEPTHS.some(d=>d[0]===depth))depth='Twilight';
const icon=()=>DEPTHS.find(d=>d[0]===depth)[1];
const menu=()=>'<div class="drop-section">Background</div>'+DEPTHS.map(([d,ic])=>'<button class="drop-row'+(d===depth?' active':'')+'" onclick="setDepth(\''+d+'\')"><div class="drop-row-left"><i class="ti '+ic+'" style="font-size:16px;width:18px"></i>'+d+'</div><i class="ti ti-check drop-check"></i></button>').join('');
function syncUI(){
  const dot=document.getElementById('lzThemeDot');
  if(dot){dot.style.background='none';dot.style.display='inline-flex';dot.style.alignItems='center';dot.style.justifyContent='center';dot.innerHTML='<i class="ti '+icon()+'" style="font-size:1.25em"></i>';dot.parentElement.title='Background: '+depth;dot.parentElement.setAttribute('aria-label','Background: '+depth);}
  const lz=document.getElementById('lzDrop');if(lz)lz.innerHTML=menu();
  const cd=document.getElementById('cdot');
  if(cd){cd.style.background='var(--bg3)';cd.style.display='flex';cd.style.alignItems='center';cd.style.justifyContent='center';cd.style.color='var(--text)';cd.innerHTML='<i class="ti '+icon()+'" style="font-size:16px"></i>';}
  const tl=document.getElementById('tlabel');if(tl)tl.textContent=depth;
  const dr=document.getElementById('drop');if(dr)dr.innerHTML=menu();
  document.querySelectorAll('#depthSeg button').forEach(b=>{const on=b.dataset.d===depth;b.style.background=on?'var(--accent)':'transparent';b.style.color=on?'var(--bg)':'var(--muted)';});
}
function apply(){
  const r=document.documentElement;
  VARS.forEach(v=>r.style.removeProperty(v));
  const w1=r.getAttribute('data-color')==='meadow';
  const lit=depth==='Dusk'||depth==='Bright';
  r.classList.toggle('pal-grad',!w1&&lit);
  if(!w1&&lit&&typeof palVars==='function'){const vs=palVars('#96C7FF','#b8a9ff',depth);Object.entries(vs).forEach(([k,v])=>r.style.setProperty(k,v));}
  r.setAttribute('data-depth',depth);
  syncUI();
}
window.setDepth=function(d){
  depth=d;try{localStorage.setItem('as_depth',d);}catch(e){}
  apply();
  document.getElementById('lzDrop')?.classList.remove('open');
  if(typeof closeDrop==='function')closeDrop();
  if(document.getElementById('page-profile')?.classList.contains('active')&&typeof renderProfile==='function')renderProfile();
};
window.buildThemeDropHTML=menu;
window.lzToggleTheme=function(e){if(e)e.stopPropagation();const d=document.getElementById('lzDrop');if(!d)return;d.innerHTML=menu();d.classList.toggle('open');};
const _at=window.applyTheme;if(typeof _at==='function')window.applyTheme=function(){const r=_at.apply(this,arguments);apply();return r;};
// main nav: bring the old theme button back as the background picker
const tw=document.getElementById('themeWrap');if(tw)tw.style.display='none';
// mobile drawer: segmented row under Sound effects
const st=document.getElementById('soundToggleDrawer');
if(false&&st&&!document.getElementById('depthSeg')){
  const row=document.createElement('div');row.className='toggle-row';row.style.cssText='padding:0 2px 10px;gap:10px';
  row.innerHTML='<span class="toggle-label"><i class="ti ti-moon" style="font-size:15px"></i> Background</span><div id="depthSeg" style="display:flex;gap:2px;padding:3px;border-radius:99px;background:var(--bg3)">'+DEPTHS.map(([d,ic])=>'<button data-d="'+d+'" onclick="setDepth(\''+d+'\')" title="'+d+'" aria-label="'+d+'" style="width:34px;height:30px;border:0;border-radius:99px;cursor:pointer;display:flex;align-items:center;justify-content:center"><i class="ti '+ic+'" style="font-size:15px"></i></button>').join('')+'</div>';
  st.closest('.toggle-row').after(row);
}
apply();
})();

/* ── TOUR (3a/4a) — foxfire walk + planet map. enterWorld() now opens this. ── */
(function(){
const S=document.getElementById('wtStage');if(!S)return;
const W=document.getElementById('wtWisp'),RING=document.getElementById('wtRing'),STARS=document.getElementById('wtStars');
let step=0,k=1,cur=true,hover=false;
try{cur=localStorage.getItem('aqs_foxfire_cursor')!=='0'}catch(e){}
S.classList.toggle('nocur',!cur);
const rnd=seed=>{let s=seed;return()=>(s=(s*9301+49297)%233280)/233280};
let r=rnd(3),sh='';
for(let i=0;i<130;i++){const z=r()<.15?3:r()<.5?2:1;sh+='<span style="position:absolute;left:'+(r()*100)+'%;top:'+(r()*62)+'%;width:'+z+'px;height:'+z+'px;border-radius:50%;background:#EEEFF6;animation:wtTw '+(2+r()*4)+'s '+(r()*4)+'s ease-in-out infinite"></span>';}
STARS.innerHTML=sh;
r=rnd(11);let rh='';
for(let i=0;i<200;i++){const a=-40+r()*200,rad=1200-(8+r()*90),z=2+r()*4;rh+='<span style="width:'+z+'px;height:'+z+'px;margin-left:'+(-z/2)+'px;background:'+(r()<.3?'#F6C98E':'#BCD8FA')+';opacity:'+(.15+r()*.3)+';transform:rotate('+a+'deg) translateY('+(-rad)+'px)"></span>';}
const SEG=16,DEG=26,N=5*SEG;
for(let i=0;i<=N;i++){const lan=i%SEG===0,px=lan?20:6;rh+='<span data-p="'+i+'" style="width:'+px+'px;height:'+px+'px;margin:'+(-px/2)+'px 0 0 '+(-px/2)+'px;transform:rotate('+(i*DEG/SEG)+'deg) translateY(-1200px);'+(lan?'border:2px solid #F6C98E;':'')+'transition:background .35s,box-shadow .35s"></span>';}
RING.innerHTML=rh;
const PATH=[...RING.querySelectorAll('[data-p]')];
const LABELS=['WELCOME','3 WAYS','MODES','LIBRARY','YOU','READY'];
document.getElementById('wtDots').innerHTML=LABELS.map((l,i)=>'<button class="wt-dot" onclick="wtGo('+i+')"><span></span>'+l+'</button>').join('');
const DOTS=[...document.querySelectorAll('#wtDots .wt-dot')];
const home=()=>step===6?[330,250]:[640,592];
function wispHome(){const [x,y]=home();W.style.transition='';W.style.left=x+'px';W.style.top=y+'px';}
function paint(){
  S.dataset.step=step;
  S.querySelectorAll('.wt-st').forEach(el=>{const i=+el.dataset.i;el.classList.toggle('on',i===step);el.classList.toggle('past',i<step);});
  const s3=Math.min(step,5);
  RING.style.transform='rotate('+(-s3*DEG)+'deg)';
  STARS.style.transform='translateX('+(-s3*220)+'px)';
  PATH.forEach((p,i)=>{const lan=i%SEG===0,lit=i<=step*SEG,rel=i-Math.max(0,step-1)*SEG;
    p.style.background=lit?'#F6C98E':(lan?'#1f2657':'#6f7cc4');
    p.style.boxShadow=lit?(lan?'0 0 24px #F6C98E,0 0 60px #F6C98E88':'0 0 10px #F6C98E'):'none';
    p.style.transitionDelay=lit?(0.5+Math.max(0,rel)*0.09)+'s':'0s';});
  DOTS.forEach((d,i)=>{d.style.color=i===step?'#EEEFF6':'#e2e6fb';d.firstChild.style.background=i<=step?'#F6C98E':'#5561ae';});
  const b=document.getElementById('wtBack');b.style.opacity=step===0?0:1;b.style.pointerEvents=step===0?'none':'auto';
  document.getElementById('wtNextL').textContent=step===0?'FOLLOW IT':step===5?'SEE THE WORLD':'ONWARD';
  if(step!==6)wtBoard(false);
  if(!hover||!cur)wispHome();
  if(step===6){try{localStorage.setItem('aqs_tour_done','1')}catch(e){}}
  if(window.sekaiTourGlobe)sekaiTourGlobe.setActive(step===6);
}
window.wtStep=()=>step;
window.wtGo=n=>{step=Math.max(0,Math.min(6,n));paint();};
window.wtBoard=v=>{const el=document.getElementById('wtBoard');el.classList.toggle('open',v===undefined?!el.classList.contains('open'):!!v);};
window.wtCursor=v=>{cur=!!v;S.classList.toggle('nocur',!cur);try{localStorage.setItem('aqs_foxfire_cursor',cur?'1':'0')}catch(e){}if(!cur)wispHome();};
window.wtFit=()=>{const bx=S.parentElement.getBoundingClientRect();if(!bx.width||!bx.height)return;k=Math.min(bx.width/1280,bx.height/780);S.style.transform='scale('+k+')';};
S.addEventListener('mousemove',e=>{if(!cur)return;hover=true;const rc=S.getBoundingClientRect();W.style.transition='none';W.style.left=((e.clientX-rc.left)/k)+'px';W.style.top=((e.clientY-rc.top)/k+20)+'px';});
S.addEventListener('mouseleave',()=>{hover=false;wispHome();});
document.addEventListener('keydown',e=>{
  if(!document.getElementById('page-tour').classList.contains('active'))return;
  if(e.target&&/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  if(e.key==='ArrowRight')wtGo(step+1);else if(e.key==='ArrowLeft')wtGo(step-1);else if(e.key==='Escape')wtBoard(false);
  else if((e.key==='r'||e.key==='R')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.target.isContentEditable){try{localStorage.removeItem('aqs_tour_done')}catch(_){}const st=document.getElementById('wtStage');if(st)st.classList.remove('wt-dragged');wtBoard(false);wtGo(0);}
});
window.wtSyncMe=function(){
  const nm=document.getElementById('wtMeName'),av=document.getElementById('wtMeAv'),btn=document.getElementById('wtMe');
  if(!nm)return;
  if(typeof currentUser!=='undefined'&&currentUser){
    nm.textContent=String(currentUser);btn.setAttribute('onclick','goProfile()');
    const p=typeof pfPfpSrc==='function'?pfPfpSrc():null;
    if(p&&p.src){av.style.background=p.bg;av.innerHTML='<img src="'+p.src+'" alt="" style="object-fit:'+(p.preset?'contain':'cover')+'">';}
    else{av.style.background=p&&p.preset?p.bg:'#96C7FF';av.textContent=String(currentUser)[0].toUpperCase();}
  } else {
    nm.textContent='Sign in';btn.setAttribute('onclick',"choosePath('landing')");
    av.style.background='#96C7FF';av.innerHTML='<i class="ti ti-user" style="font-size:22px"></i>';
  }
};
window.addEventListener('sekai-globe-drag',function(){var st=document.getElementById('wtStage');if(st)st.classList.add('wt-dragged');});
window.wtLoadSamples=async function(){
  if(window._wtSamples||typeof sb==='undefined'||!sb)return;window._wtSamples=true;
  const pick=a=>a&&a.length?a[Math.floor(Math.random()*a.length)]:null;
  const get=async(f,media)=>{try{let q=sb.from('questions').select('question,options,answer,media_url').eq('status','approved').eq('format',f);if(media)q=q.not('media_url','is',null);const{data}=await q.order('id',{ascending:true}).limit(1);return data&&data[0]||null;}catch(e){return null;}};
  const goku=async()=>{try{const{data}=await sb.from('questions').select('media_url').eq('status','approved').eq('format','char').ilike('answer','%goku%').not('media_url','is',null).order('id',{ascending:true}).limit(1);return data&&data[0]||null;}catch(e){return null;}};
  const [mc,ty,ch]=await Promise.all([get('mc'),get('type'),goku()]);
  const set=(id,v)=>{const el=document.getElementById(id);if(el&&v)el.textContent=v;};
  if(mc){let o=mc.options;if(typeof o==='string'){try{o=JSON.parse(o)}catch(e){o=null}}
    if(Array.isArray(o)&&o.length>=4){set('wtQmcText',mc.question);o.slice(0,4).forEach((t,i)=>set('wtQmcA'+i,typeof t==='string'?t:(t&&(t.text||t.label))||''));}}
  if(ty)set('wtQtypeText',ty.question);
  const im=(id,r)=>{const el=document.getElementById(id);if(el&&r&&r.media_url)el.src=r.media_url;};
  
};
window.enterWorld=function(){
  try{wtLoadSamples()}catch(e){}
  if(window.__enteringWorld||window._wtFlying)return;
  var lg=window.sekaiLandGlobe;
  if(lg&&!window.__worldSpun){window.__enteringWorld=true;
    lg.spinTo(0,1100,function(){window.__enteringWorld=false;window.__worldSpun=true;window.enterWorld();});return;}
  window.__worldSpun=false;
  if(window.sekaiTourGlobe){sekaiTourGlobe.setOff(0);if(lg)sekaiTourGlobe.setCloud(lg.getCloud());}
  try{localStorage.setItem('aqs_world_seen','1')}catch(e){}
  let done=false;try{done=localStorage.getItem('aqs_tour_done')==='1'}catch(e){}
  const target=done?6:0;
  const ball=document.getElementById('lzGlobeBall'),land=document.getElementById('page-landing'),stage=document.getElementById('lzStage');
  const calm=matchMedia('(prefers-reduced-motion: reduce)').matches; // World motion only governs page-to-page trips; entering the tour always animates
  const g=ball&&land&&land.classList.contains('active')?ball.getBoundingClientRect():null;
  const open=()=>{goStep('tour');
    // land on the step without the tour's own planet move (we just did it)
    S.classList.add('wt-instant');wtGo(target);S.offsetWidth;requestAnimationFrame(()=>requestAnimationFrame(()=>S.classList.remove('wt-instant')));};
  if(calm||!g||!g.width||window._wtFlying){open();return;}
  /* Landing → tour, one continuous move on the tour's REAL planet (so its clouds layer correctly):
     the tour is shown over the landing with its sky faded out; the sky fades in as the landing dissolves,
     the planet flies from the globe to its tour spot, and the tour's elements fade in while it settles. */
  window._wtFlying=true;
  const tour=document.getElementById('page-tour'),P=S.querySelector('.wt-planet'),SH=S.querySelector('.wt-shade'),SKY=S.children[0];
  const u=stage?getComputedStyle(stage).getPropertyValue('--u'):'1';
  const fr=[...(stage?stage.querySelectorAll('.wt-cl.front'):[])].map(c=>({r:c.getBoundingClientRect(),t:getComputedStyle(c).transform,k:c.cloneNode(true)}));
  tour.classList.add('active');document.body.classList.add('on-tour');
  wtFit();S.classList.add('wt-instant');wtGo(target);S.offsetWidth;
  const sr=S.getBoundingClientRect(),ks=sr.width/1280;
  const cx=(g.left+g.width/2-sr.left)/ks,cy=(g.top+g.height/2-sr.top)/ks,d=g.width/ks;
  const from='translate('+(cx-640)+'px,'+(cy-1830)+'px) scale('+(d/2400/(target===0?1.12:1))+')';
  const to=target===6?'translateY(-1390px) scale(.2417)':'none';
  const STARS2=document.getElementById('wtStars'),GLOW=S.children[1];
  const rest=[...S.children].filter(el=>el!==SKY&&el!==P&&el!==STARS2&&el!==GLOW);
  const FADE=800,MOVE=1450,DELAY=200,IN0=DELAY+MOVE*.45,INLEN=MOVE*.55+250;
  const anims=[];
  const A=(el,k,o)=>{const a=el.animate(k,Object.assign({fill:'both'},o));anims.push(a);return a;};
  A(tour,[{backgroundColor:'transparent'},{backgroundColor:'#1f2657'}],{duration:FADE,easing:'ease-in-out'});
  // sky, stars and horizon glow cross-fade with the landing's, so the night never drops out
  [SKY,STARS2,GLOW].forEach(el=>el&&A(el,[{opacity:0},{opacity:+getComputedStyle(el).opacity||1}],{duration:FADE,easing:'ease-in-out'}));
  if(stage)A(stage,[{opacity:1},{opacity:0}],{duration:FADE,easing:'ease-in-out'});
  ball.style.visibility='hidden';
  A(P,[{transform:from},{transform:to}],{duration:MOVE,delay:DELAY,easing:'cubic-bezier(.65,0,.35,1)'});
  if(target===0)A(SH,[{opacity:1},{opacity:0}],{duration:MOVE,delay:DELAY,easing:'ease-in-out'});
  rest.forEach(el=>{const o=+getComputedStyle(el).opacity;if(o>0)A(el,[{opacity:0},{opacity:o}],{duration:INLEN,delay:IN0,easing:'ease-out'});});
  // the landing's front clouds part instead of the planet popping through them
  const cw=document.createElement('div');cw.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:5;--u:'+u;tour.appendChild(cw);
  fr.forEach(({r,t,k},i)=>{k.style.cssText+=';position:fixed;left:'+r.left+'px;top:'+r.top+'px;animation:none;transform:'+(t==='none'?'':t);cw.appendChild(k);
    k.animate([{opacity:1,transform:(t==='none'?'':t)},{opacity:0,transform:(t==='none'?'':t)+' translateX('+(i?60:-60)+'px)'}],{duration:FADE*.8,easing:'ease-out',fill:'forwards'});});
  setTimeout(()=>{
    goStep('tour');
    anims.forEach(a=>a.cancel());cw.remove();
    if(stage)stage.getAnimations().forEach(a=>a.cancel());
    ball.style.visibility='';
    requestAnimationFrame(()=>requestAnimationFrame(()=>S.classList.remove('wt-instant')));
    window._wtFlying=false;
  },Math.max(DELAY+MOVE,IN0+INLEN)+30);
};
const og=window.goStep;
window.goStep=function(name){
  try{og.apply(this,arguments);}
  finally{
    document.body.classList.toggle('on-tour',name==='tour');
    if(name==='tour'){wtSyncMe();wtFit();requestAnimationFrame(wtFit);}
  }
};
window.addEventListener('resize',wtFit);
paint();
})();

/* LIBRARY — browse every approved series with its question counts.
   Topics come from loadTopicsFromSupabase() (the same list the Solo picker uses).
   Playing a card presets the Solo setup screen (series + a format that has questions)
   and goes through choosePath('solo'), so the sign-in / guest gate still applies. */
let libPrev='landing', libLoading=false, libOpenKey=null;
const LIB_FMTS=[['mc','TEXT · CHOOSE','ti-abc','#96C7FF'],['type','TEXT · TYPE','ti-keyboard','#BCD8FA'],['scene','SCENE','ti-photo','#F6C98E'],['char','CHARACTERS','ti-user-square-rounded','#F6A5B8']];
function libFind(key){return animeTopics.find(t=>t.key===key);}
function libSum(t){const c=t&&t.counts||{};return (c.mc||0)+(c.type||0)+(c.scene||0)+(c.char||0);}
function libImg(u){return String(u).replace(/"/g,'%22').replace(/'/g,'%27');}

function openLibrary(){
  const go=()=>goStep('library');
  if(typeof requestLobbyNav==='function')requestLobbyNav(go);else go();
}
function libBack(){goStep(libPrev&&libPrev!=='library'?libPrev:'landing');}
async function libEnter(){
  libRender();
  if(animeTopics.length||libLoading)return;
  libLoading=true;libRender();
  try{await loadTopicsFromSupabase();}finally{libLoading=false;}
  libRender();
}
function libClearSearch(){const s=document.getElementById('libSearch');s.value='';libRender();s.focus();}

function libCard(t){
  const n=libSum(t), c=t.counts||{}, e=_suEsc;
  const art=t.posters&&t.posters[0]
    ? '<img class="lib-poster" src="'+e(libImg(t.posters[0]))+'" alt="" loading="lazy" decoding="async">'
    : '<div class="lib-poster"><i class="ti ti-device-tv"></i></div>';
  const counts=!n?'<span class="lib-ct">No questions yet</span>'
    : [[(c.mc||0)+(c.type||0),'ti-abc','Text'],[c.scene||0,'ti-photo','Scene'],[c.char||0,'ti-user-square-rounded','Characters']]
      .filter(([v])=>v).map(([v,ic,l])=>'<span class="lib-ct" title="'+l+'"><i class="ti '+ic+'"></i>'+v+'</span>').join('');
  return '<button class="lib-card'+(n?'':' empty')+'" onclick="libOpen(\''+t.key+'\')">'+art
    +'<span class="lib-cbody"><span class="lib-name">'+e(t.name)+'</span><span class="lib-counts">'+counts+'</span></span></button>';
}
function libRender(){
  const body=document.getElementById('libBody');
  if(!body)return;
  const total=animeTopics.reduce((a,t)=>a+libSum(t),0);
  document.getElementById('libSub').textContent=animeTopics.length?animeTopics.length+' series · '+total.toLocaleString()+' questions':' ';
  const sIn=document.getElementById('libSearch'), q=(sIn.value||'').trim();
  sIn.parentElement.classList.toggle('has',!!q);
  if(!animeTopics.length){
    body.innerHTML=libLoading
      ? '<div class="lib-zero"><div class="spinner"></div><span>Opening the library…</span></div>'
      : '<div class="lib-zero"><b>The library is closed</b><span>The series list didn\'t load. Check your connection and try again.</span><button class="lib-suggest" onclick="libEnter()"><i class="ti ti-refresh"></i>Try again</button></div>';
    return;
  }
  const items=animeTopics.filter(t=>t.name.toLowerCase().includes(q.toLowerCase()));
  const byName=(a,b)=>a.name.localeCompare(b.name);
  const has=items.filter(t=>libSum(t)>0).sort(byName), none=items.filter(t=>!libSum(t)).sort(byName);
  const suggest='<div class="lib-foot"><button class="lib-suggest" onclick="libSuggest()"><i class="ti ti-message-plus"></i>'
    +(q?'Suggest “'+_suEsc(q)+'” as a new series':'Missing a favorite? Suggest it')+'</button></div>';
  if(!items.length){
    body.innerHTML='<div class="lib-zero"><b>No series called “'+_suEsc(q)+'”</b><span>Nobody has written questions for it yet. Suggest it and it goes on the writing list.</span></div>'+suggest;
    return;
  }
  let html='';
  if(!q)html+='<button class="lib-card all" onclick="libPlay(null)"><span class="lib-art"><i class="ti ti-stack-2"></i></span>'
    +'<span class="lib-cbody"><span class="lib-name">Everything</span><span class="lib-counts"><span class="lib-ct"><i class="ti ti-player-play"></i>Play the whole pool</span></span></span></button>';
  html+=has.map(libCard).join('');
  if(html)html='<div class="lib-grid">'+html+'</div>';
  if(none.length)html+='<div class="lib-div"><span>NO QUESTIONS YET</span><i></i></div><div class="lib-grid">'+none.map(libCard).join('')+'</div>';
  body.innerHTML=html+suggest;
}

function libOpen(key){
  const t=libFind(key);
  if(!t)return;
  libOpenKey=key;
  const n=libSum(t), c=t.counts||{};
  const p=document.getElementById('libDPoster');
  p.removeAttribute('style');p.innerHTML='';
  applyPoster(p,t);
  document.getElementById('libDName').textContent=t.name;
  document.getElementById('libDCounts').innerHTML=LIB_FMTS.map(([k,l,ic,col])=>{
    const v=c[k]||0;
    return '<div class="lib-dc'+(v?'':' zero')+'"><i class="ti '+ic+'" style="--c:'+col+'"></i><span>'+l+'<b>'+(v?v.toLocaleString():'—')+'</b></span></div>';
  }).join('');
  document.getElementById('libDNote').textContent=n
    ? n.toLocaleString()+' questions in all. Play picks a format that has questions; you can change it on the next screen.'
    : 'Nobody has written questions for this series yet. You could be the first.';
  document.getElementById('libDActs').innerHTML=n
    ? '<button class="lib-play" onclick="libPlay(\''+t.key+'\')"><i class="ti ti-player-play-filled" style="font-size:18px"></i>PLAY THIS SERIES</button>'
    : '<button class="lib-play alt" onclick="libClose();openSubmitQuestion()"><i class="ti ti-pencil-plus" style="font-size:18px"></i>SUBMIT A QUESTION</button>';
  document.getElementById('libSheet').classList.add('on');
  applyTheme();
}
function libClose(){libOpenKey=null;const s=document.getElementById('libSheet');if(s)s.classList.remove('on');}
function libPlay(key){
  const t=key?libFind(key):null;
  libClose();
  if(t){
    const c=t.counts||{};
    selectedTopics=[{key:t.key,emoji:t.emoji||'',name:t.name,type:t.type}];isGeneralSelected=false;
    if(c.mc){suFormat='text';suAnswerBy='choose';}
    else if(c.type){suFormat='text';suAnswerBy='type';}
    else if(c.char){suFormat='char';suAnswerBy='type';}
    else{suFormat='scene';suAnswerBy='type';}
  }else{selectedTopics=[];isGeneralSelected=true;}
  choosePath('solo');
}
function libSuggest(){
  const q=(document.getElementById('libSearch').value||'').trim();
  lzSuggestTopic();
  const f=document.getElementById('sqSuggestTopic');
  if(f&&q)setTimeout(()=>{f.value=q;if(typeof sqSuggestTopicInput==='function')sqSuggestTopicInput();},60);
}
(function(){
  const _gs=window.goStep;
  window.goStep=function(name){
    const cur=document.querySelector('.page.active'), curName=cur?cur.id.replace('page-',''):null;
    if(name==='library'&&curName&&curName!=='library'&&curName!=='auth')libPrev=curName;
    const r=_gs.apply(this,arguments);
    document.body.classList.toggle('on-library',name==='library');
    if(name==='library')libEnter();else libClose();
    return r;
  };
  document.addEventListener('keydown',e=>{
    if(!document.body.classList.contains('on-library'))return;
    if(e.key==='Escape'&&libOpenKey){e.preventDefault();libClose();}
  });
})();

/* CREDITS — the question writers list is live: approved questions with a submitted_by,
   counted per name. The owner's account is left out (owner's choice). */
const CRD_SKIP=['thewind'];
let crdPrev='landing', crdWriters=null, crdLoading=false;
function openCredits(){
  const go=()=>goStep('credits');
  if(typeof requestLobbyNav==='function')requestLobbyNav(go);else go();
}
function crdBack(){goStep(crdPrev&&crdPrev!=='credits'?crdPrev:'landing');}
async function crdLoadWriters(){
  if(crdLoading)return;
  crdLoading=true;crdRenderWriters();
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/questions?select=submitted_by&status=eq.approved&submitted_by=not.is.null`,{headers:{apikey:SUPABASE_ANON,Authorization:'Bearer '+SUPABASE_ANON}});
    const rows=r.ok?await r.json():null;
    if(Array.isArray(rows)){
      const m={};
      rows.forEach(x=>{const n=String(x.submitted_by||'').trim();if(n&&!CRD_SKIP.includes(n.toLowerCase()))m[n]=(m[n]||0)+1;});
      crdWriters=Object.entries(m).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    }
  }catch(e){}
  crdLoading=false;crdRenderWriters();
}
function crdRenderWriters(){
  const el=document.getElementById('crdWriters');
  if(!el)return;
  if(!crdWriters){
    el.innerHTML='<p class="crd-p">'+(crdLoading?'Gathering names…':'The list didn\'t load. Try again later.')+'</p>';
    return;
  }
  el.innerHTML=crdWriters.length
    ? '<div class="crd-names">'+crdWriters.map(([n,c])=>'<span class="crd-name">'+_suEsc(n)+'<b>'+c+'</b></span>').join('')+'</div>'
    : '<p class="crd-p"><b>No player-written questions yet.</b> Yours could be the first.</p>';
}
(function(){
  const _gs=window.goStep;
  window.goStep=function(name){
    const cur=document.querySelector('.page.active'), curName=cur?cur.id.replace('page-',''):null;
    if(name==='credits'&&curName&&curName!=='credits'&&curName!=='auth')crdPrev=curName;
    const r=_gs.apply(this,arguments);
    document.body.classList.toggle('on-credits',name==='credits');
    if(name==='credits')crdLoadWriters();
    return r;
  };
})();

/* ABOUT — replaces the old #aboutModal popup. */
let abPrev='landing';
function openAbout(){
  const go=()=>goStep('about');
  if(typeof requestLobbyNav==='function')requestLobbyNav(go);else go();
}
function abBack(){goStep(abPrev&&abPrev!=='about'?abPrev:'landing');}
(function(){
  const _gs=window.goStep;
  window.goStep=function(name){
    const cur=document.querySelector('.page.active'), curName=cur?cur.id.replace('page-',''):null;
    if(name==='about'&&curName&&curName!=='about'&&curName!=='auth')abPrev=curName;
    const r=_gs.apply(this,arguments);
    document.body.classList.toggle('on-about',name==='about');
    return r;
  };
})();

/* LANDING greeter — for players who have never entered the world in this browser
   (no aqs_world_seen), the foxfire floats in beside the globe 5 s after the landing
   is on screen and invites them to tap it. Leaving the landing or tapping hides it. */
(function(){
  const DELAY=5000;let t=null;
  const seen=()=>{try{return !!localStorage.getItem('aqs_world_seen');}catch(e){return true;}};
  function hide(){clearTimeout(t);t=null;const g=document.getElementById('lzGreet');if(g)g.classList.remove('on');}
  function arm(){
    hide();if(seen())return;
    t=setTimeout(()=>{
      const land=document.getElementById('page-landing');
      if(seen()||!land||!land.classList.contains('active'))return;
      const g=document.getElementById('lzGreet');if(g)g.classList.add('on');
    },DELAY);
  }
  window.lzGreetArm=arm;
  const _gs=window.goStep;
  window.goStep=function(name){const r=_gs.apply(this,arguments);if(name==='landing')arm();else hide();return r;};
  document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('#page-landing .lz-globe-hit,#lzGreet'))hide();},true);
  const boot=()=>{const land=document.getElementById('page-landing');if(land&&land.classList.contains('active'))arm();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

/* SEKAI — which place on the planet each page belongs to. Pages not listed hide the world. */
(function(){
  const PLACE={setup:'solo',topic:'solo',format:'solo',mode:'solo',quiz:'solo',results:'solo',
    multiplayer:'multiplayer','lobby-room':'multiplayer','mp-quiz':'multiplayer','mp-results':'multiplayer',
    daily:'daily','daily-result':'daily',leaderboard:'leaderboard',profile:'profile',auth:'signin',library:'library',credits:'credits',about:'about'};
  const ANGLE={solo:0,multiplayer:60,daily:120,leaderboard:180,profile:240,signin:300,library:330,credits:30,about:90};
  const DIM={quiz:1,'mp-quiz':1,daily:1,library:1,credits:1,about:1};
  const sk=document.getElementById('sekai'),pl=document.getElementById('skPlanet');
  if(!sk||!pl)return;
  let rot=0,cur=null,trips=0,lastStart=0,lastDur=0;
  const MKEY='aqs_world_motion';
  const motion=()=>{try{const v=localStorage.getItem(MKEY);return v==='subtle'||v==='off'?v:'full';}catch(e){return 'full';}};
  window.skMotion=motion;
  const applyMotion=()=>{const m=motion();sk.classList.toggle('m-off',m==='off');sk.classList.toggle('m-subtle',m==='subtle');};
  window.skCycleMotion=function(btn){const n={full:'subtle',subtle:'off',off:'full'}[motion()];try{localStorage.setItem(MKEY,n);}catch(e){}applyMotion();const L={full:'Full',subtle:'Subtle',off:'Off'};{const l=document.getElementById('skMotionLbl');if(l)l.textContent=L[n];}if(typeof amSync==='function')amSync();};
  applyMotion();
  if(typeof amSync==='function')try{amSync();}catch(e){}
  function sync(){
    const a=document.querySelector('.page.active');const id=a?a.id.replace('page-',''):'';
    const place=PLACE[id];
    document.body.classList.toggle('sk-on',!!place);
    sk.classList.toggle('dim',!!DIM[id]);
    if(!place||place===cur)return;
    const target=-ANGLE[place];
    if(cur===null){rot=target;pl.style.transition='none';pl.style.setProperty('--rot',rot+'deg');pl.offsetWidth;pl.style.transition='';}
    else{
      const d=((target-rot)%360+540)%360-180,m=motion(),now=performance.now();
      let dur=0.8+Math.abs(d)/180*0.6;               // 1. neighbour 0.8s … half a turn 1.4s
      if(trips===0)dur*=1.25;                          // 3. first trip of the visit is the showpiece
      else dur*=0.85;                                  //    later trips get quicker
      if(now-lastStart<lastDur*1000)dur=0.45;          // 2. still moving from the last trip → catch up fast
      if(m==='subtle')dur=Math.min(dur,0.5);
      if(m==='off')dur=0;
      pl.style.transitionDuration=dur+'s';
      rot+=d;pl.style.setProperty('--rot',rot+'deg');
      trips++;lastStart=now;lastDur=dur;
    }
    cur=place;sk.dataset.place=place;
  }
  const mo=new MutationObserver(sync);
  document.querySelectorAll('.page').forEach(p=>mo.observe(p,{attributes:true,attributeFilter:['class']}));
  sync();
})();

(function(){const n=new Date(),M=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],W=['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];const s=(i,v)=>{const e=document.getElementById(i);if(e)e.textContent=v};s('lzCalM',M[n.getMonth()]);s('lzCalD',n.getDate());s('lzCalW',W[n.getDay()]);})();

(function(){const c=document.getElementById('lzCal');if(!c||typeof LZ_SKY==='undefined')return;
const DEF={x:50,y:58,s:1,r:0,lock:false,fade:{shape:'linear',ang:180,s:100,e:100,cx:50,cy:50},look:{o:1,b:0}};
if(!LZ_SKY.cal)LZ_SKY.cal=JSON.parse(JSON.stringify(DEF));const P=LZ_SKY.cal;
if(P.r==null)P.r=0;if(P.t==null)P.t=0;if(!P.look)P.look={o:P.fade&&P.fade.o!=null?P.fade.o:1,b:P.fade&&P.fade.b||0};
P.fade=Object.assign({},DEF.fade,P.fade||{});delete P.fade.o;delete P.fade.b;
const GD={wm:{x:50,y:72,s:1,r:0},cal:{x:50,y:58,s:1,r:0}};
if(!P.style){P.g_cal={x:P.x,y:P.y,s:P.s,r:P.r};Object.assign(P,GD.wm);P.style='wm';}
const setStyle=v=>{if(v===P.style)return;P['g_'+P.style]={x:P.x,y:P.y,s:P.s,r:P.r};Object.assign(P,P['g_'+v]||GD[v]);P.style=v;};
const setDay=day=>{const n=new Date(),K=['','一','二','三','四','五','六','七','八','九'],k=v=>v<10?K[v]:(v>=20?K[Math.floor(v/10)]:'')+'十'+K[v%10];day=day||n.getDate();
  const d=document.getElementById('lzWmD'),j=document.getElementById('lzWmK'),cd=document.getElementById('lzCalD');if(d)d.textContent=day;if(cd)cd.textContent=day;if(j)j.textContent=k(n.getMonth()+1)+'月'+k(day)+'日';
  const pv=document.getElementById('lzCalPrev'),pb=document.getElementById('lzCalPrevV');if(pv)pv.value=day;if(pb)pb.textContent=day;};setDay();
let prevDay=0;document.addEventListener('input',e=>{if(e.target.id==='lzCalPrev'){prevDay=+e.target.value;setDay(prevDay);}},true);
const $=i=>document.getElementById(i);const st=c.closest('.lz-stage');const ed=()=>st&&st.classList.contains('lz-editing');
const get=k=>k.split('.').reduce((o,p)=>o[p],P);const put=(k,v)=>{const a=k.split('.');a.slice(0,-1).reduce((o,p)=>o[p],P)[a.at(-1)]=v;};
const save=()=>{try{lzSkySave()}catch(e){}};
let showG=true;
function ap(){c.style.setProperty('--cx',P.x+'%');c.style.setProperty('--cy',P.y+'%');c.style.setProperty('--cs',P.s);c.style.setProperty('--cr',P.r+'deg');c.style.setProperty('--ct',(P.t||0)+'deg');c.classList.toggle('locked',!!P.lock);c.classList.toggle('wm',P.style==='wm');
  document.querySelectorAll('[data-calstyle]').forEach(b=>{const on=P.style===b.dataset.calstyle;b.style.background=on?'#F6C98E':'#3d3960';b.style.color=on?'#1f2657':'#EEEFF6';});
  const m=lzFadeMask(P.fade);c.style.webkitMaskImage=m;c.style.maskImage=m;c.style.opacity=P.look.o;c.style.filter=P.look.b?'blur('+P.look.b+'px)':'';
  document.querySelectorAll('[data-cal]').forEach(i=>{const v=get(i.dataset.cal);if(document.activeElement!==i)i.value=v;});
  document.querySelectorAll('[data-calv]').forEach(b=>{const v=get(b.dataset.calv);b.textContent=Math.abs(v)<10&&v%1?(+v).toFixed(2):Math.round(v);});
  document.querySelectorAll('[data-calsh]').forEach(b=>{const on=P.fade.shape===b.dataset.calsh;b.style.background=on?'#F6C98E':'#3d3960';b.style.color=on?'#1f2657':'#EEEFF6';});
  const rad=P.fade.shape==='radial';document.querySelectorAll('[data-cal="fade.ang"],[data-cal="fade.cx"],[data-cal="fade.cy"]').forEach(i=>{const show=i.dataset.cal==='fade.ang'?!rad:rad;i.closest('label').style.display=show?'flex':'none';});
  if($('lzCalLock'))$('lzCalLock').checked=!!P.lock;}
ap();
document.addEventListener('input',e=>{const k=e.target.dataset&&e.target.dataset.cal;if(!k)return;put(k,+e.target.value);ap();save();},true);
document.addEventListener('change',e=>{if(e.target.id==='lzCalLock'){P.lock=e.target.checked;ap();save();}if(e.target.id==='lzCalGuideOn')showG=e.target.checked;},true);
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-calsh],[data-calreset],[data-calstyle]');if(!b)return;
  if(b.dataset.calstyle){setStyle(b.dataset.calstyle);ap();save();return;}
  if(b.dataset.calsh){const f=P.fade;f.shape=b.dataset.calsh;if(f.shape==='radial'&&f.s>=100&&f.e>=100){f.s=30;f.e=90;}if(f.shape==='linear'&&f.s<=0&&f.e<=0){f.s=100;f.e=100;}}
  else if(b.dataset.calreset==='sky'){P.fade={shape:'radial',ang:180,s:20,e:95,cx:50,cy:30};P.fade.shape='linear';P.fade.s=30;P.fade.e=96;P.look={o:.55,b:.6};}
  else if(b.dataset.calreset==='fade'){P.fade=JSON.parse(JSON.stringify(DEF.fade));P.look=JSON.parse(JSON.stringify(DEF.look));}
  else{const k=P.lock,sy=P.style;Object.assign(P,JSON.parse(JSON.stringify(DEF)),GD[sy]);P.lock=k;P.style=sy;}
  ap();save();},true);
/* gizmo: outline + resize corners + rotate knob + fade handles, drawn over the calendar in its own rotated frame */
const HS='position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:#F6C98E;color:#1f2657;font:900 10px Nunito,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #1f2657,0 2px 8px #0008;pointer-events:auto;user-select:none;touch-action:none';
const CS='position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;background:#fff;border:2px solid #1f2657;border-radius:3px;pointer-events:auto;touch-action:none';
const g=document.createElement('div');g.id='lzCalGizmo';g.style.cssText='position:fixed;z-index:99997;pointer-events:none;display:none;outline:1.5px dashed #F6C98E;transform-origin:50% 50%';
g.innerHTML='<div data-gl style="position:absolute;inset:0"></div><div style="position:absolute;left:50%;top:-30px;width:0;height:30px;border-left:1.5px solid #F6C98E"></div>'
 +'<div data-h="rot" title="Rotate (Shift snaps to 15°)" style="'+HS+';left:50%;top:-30px;cursor:grab;background:#EEEFF6">↻</div>'
 +['nw','ne','sw','se'].map(k=>'<div data-h="'+k+'" title="Resize" style="'+CS+';left:'+(k[1]==='w'?0:100)+'%;top:'+(k[0]==='n'?0:100)+'%;cursor:'+(k==='nw'||k==='se'?'nwse':'nesw')+'-resize"></div>').join('')
 +'<div data-h="fs" title="Solid edge" style="'+HS+';cursor:grab">S</div><div data-h="fe" title="Fully faded" style="'+HS+';cursor:grab">E</div><div data-h="fr" title="Fade direction" style="'+HS+';cursor:grab;background:#EEEFF6">⟳</div><div data-h="fc" title="Fade point" style="'+HS+';width:14px;height:14px;margin:-7px 0 0 -7px;cursor:grab"></div>';
document.body.appendChild(g);const q=s=>g.querySelector(s);
let W=0,H=0,CX=0,CY=0;
function draw(){if(!ed()||P.lock||c.offsetWidth===0){g.style.display='none';return;}
  const r=c.getBoundingClientRect();CX=r.left+r.width/2;CY=r.top+r.height/2;W=c.offsetWidth*P.s;H=c.offsetHeight*P.s;
  Object.assign(g.style,{display:'block',left:(CX-W/2)+'px',top:(CY-H/2)+'px',width:W+'px',height:H+'px',transform:'rotate('+P.r+'deg)'});
  const f=P.fade,T='rgba(255,70,170,.32)',G='#F6C98E',ln=p=>'transparent calc('+p+'% - 1px),'+G+' calc('+p+'% - 1px),'+G+' calc('+p+'% + 1px),transparent calc('+p+'% + 1px)';
  const show=(k,v)=>{q('[data-h="'+k+'"]').style.display=v&&showG?'flex':'none';};const at=(k,x,y)=>{const el=q('[data-h="'+k+'"]');el.style.left=x+'px';el.style.top=y+'px';};
  const gl=q('[data-gl]');gl.style.display=showG?'block':'none';
  if(f.shape==='radial'){const at0='circle at '+f.cx+'% '+f.cy+'%';gl.style.background='radial-gradient('+at0+','+ln(f.s)+'),radial-gradient('+at0+','+ln(f.e)+'),radial-gradient('+at0+','+T+' '+f.s+'%,transparent '+f.e+'%)';
    const cx=f.cx/100*W,cy=f.cy/100*H,RR=Math.max(...[[0,0],[W,0],[0,H],[W,H]].map(([x,y])=>Math.hypot(x-cx,y-cy)));
    show('fc',1);show('fr',0);show('fs',1);show('fe',1);at('fc',cx,cy);at('fs',cx+f.s/100*RR,cy);at('fe',cx+f.e/100*RR,cy+(Math.abs(f.e-f.s)<4?22:0));}
  else{gl.style.background='linear-gradient('+f.ang+'deg,'+ln(f.s)+'),linear-gradient('+f.ang+'deg,'+ln(f.e)+'),linear-gradient('+f.ang+'deg,transparent '+f.s+'%,'+T+' '+f.e+'%)';
    const an=f.ang*Math.PI/180,dx=Math.sin(an),dy=-Math.cos(an),L=Math.abs(W*dx)+Math.abs(H*dy);const pt=p=>[W/2+(p/100-.5)*L*dx,H/2+(p/100-.5)*L*dy];
    show('fc',0);show('fr',1);show('fs',1);show('fe',1);at('fs',...pt(f.s));at('fe',...pt(f.e+(Math.abs(f.e-f.s)<4?6:0)));const rr=Math.min(W,H)*.2+16;at('fr',W/2+dx*rr,H/2+dy*rr);}}
let loop=0;const tick=()=>{draw();loop=ed()?requestAnimationFrame(tick):0;};
new MutationObserver(()=>{ap();requestAnimationFrame(ap);if(ed()&&!loop)loop=requestAnimationFrame(tick);if(!ed()){g.style.display='none';prevDay=0;setDay();}else requestAnimationFrame(()=>setDay(prevDay));}).observe(st,{attributes:true,attributeFilter:['class']});
const local=e=>{const a=-P.r*Math.PI/180,x=e.clientX-CX,y=e.clientY-CY;return [x*Math.cos(a)-y*Math.sin(a)+W/2,x*Math.sin(a)+y*Math.cos(a)+H/2];};
let d=null;
g.addEventListener('pointerdown',e=>{const k=e.target.dataset&&e.target.dataset.h;if(!k)return;e.preventDefault();e.stopPropagation();e.target.setPointerCapture(e.pointerId);
  d={k,s:P.s,r:P.r,dist:Math.hypot(e.clientX-CX,e.clientY-CY)||1,ang:Math.atan2(e.clientY-CY,e.clientX-CX)};},true);
addEventListener('pointermove',e=>{if(!d)return;const f=P.fade,cl=v=>Math.round(Math.max(-50,Math.min(150,v)));
  if(d.k==='rot'){let r=d.r+(Math.atan2(e.clientY-CY,e.clientX-CX)-d.ang)*180/Math.PI;r=((r+540)%360)-180;if(e.shiftKey)r=Math.round(r/15)*15;P.r=Math.round(r);}
  else if(d.k.length===2&&'nwse'.includes(d.k[0])&&d.k[0]!=='f'){P.s=+Math.max(.3,Math.min(4,d.s*Math.hypot(e.clientX-CX,e.clientY-CY)/d.dist)).toFixed(2);}
  else{const [px,py]=local(e);
    if(f.shape==='radial'){const cx=f.cx/100*W,cy=f.cy/100*H;if(d.k==='fc'){f.cx=cl(px/W*100);f.cy=cl(py/H*100);}else{const RR=Math.max(...[[0,0],[W,0],[0,H],[W,H]].map(([x,y])=>Math.hypot(x-cx,y-cy)))||1;f[d.k==='fs'?'s':'e']=cl(Math.hypot(px-cx,py-cy)/RR*100);}}
    else{const an=f.ang*Math.PI/180,dx=Math.sin(an),dy=-Math.cos(an);if(d.k==='fr')f.ang=(Math.round(Math.atan2(px-W/2,-(py-H/2))*180/Math.PI)+360)%360;else if(d.k!=='fc'){const L=Math.abs(W*dx)+Math.abs(H*dy)||1;f[d.k==='fs'?'s':'e']=cl((((px-W/2)*dx+(py-H/2)*dy)/L+.5)*100);}}}
  ap();draw();},true);
addEventListener('pointerup',()=>{if(d){d=null;save();}if(m){m=null;c.style.cursor='';save();}},true);
let m=null;
c.addEventListener('pointerdown',e=>{if(!ed()||P.lock)return;e.preventDefault();e.stopPropagation();const r=c.parentElement.getBoundingClientRect();m={sx:e.clientX,sy:e.clientY,x:P.x,y:P.y,w:r.width,h:r.height};c.setPointerCapture(e.pointerId);c.style.cursor='grabbing';});
c.addEventListener('pointermove',e=>{if(!m)return;P.x=+(m.x+(e.clientX-m.sx)/m.w*100).toFixed(1);P.y=+(m.y+(e.clientY-m.sy)/m.h*100).toFixed(1);ap();});
c.addEventListener('wheel',e=>{if(!ed()||P.lock)return;e.preventDefault();P.s=+Math.max(.3,Math.min(4,P.s*(e.deltaY<0?1.05:.95))).toFixed(2);ap();save();},{passive:false});
})();

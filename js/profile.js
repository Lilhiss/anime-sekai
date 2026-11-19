// Profile v2 + public card, picture picker, name pill + menu, crop extras, theme test, palette maths (moved out of index.html 2026-11-19; order matters)
/* ── PROFILE v2 (58m) + PUBLIC CARD (59a) ──────────────────────
   Not tracked yet (needs Supabase): other players' daily streak, multiplayer
   wins/podiums, favourite topics, last-seen, friend requests. Their panels hide
   when the data is missing. window.pfExtra = {topics:[{name,games}], podiums:{first,second,third,of}}
   and profile columns daily_streak / mp_wins / mp_podiums / topics / last_seen light them up. */
let _pfPrev='landing';
function pfBack(){goStep(_pfPrev&&_pfPrev!=='profile'?_pfPrev:'landing');}
(function(){
  const _gs=window.goStep;
  window.goStep=function(name){
    const cur=document.querySelector('.page.active');
    const curName=cur?cur.id.replace('page-',''):null;
    if(name==='profile'&&curName&&curName!=='profile')_pfPrev=curName;
    const r=_gs.apply(this,arguments);
    document.body.classList.toggle('on-profile',name==='profile');
    pcClose();
    return r;
  };
})();
function pfEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function pfPfpSrc(){
  if(!currentPfp)return null;
  const preset=currentPfp.type==='preset'?PFP_PRESETS.find(p=>p.id===currentPfp.value):null;
  /* presets have no artwork yet (src:null): callers draw the player's initial on the preset colour */
  return {src:preset?(preset.src||null):currentPfp.value,preset:!!preset,bg:preset?(preset.bg||'var(--bg3)'):'var(--bg3)'};
}
function pfAuroraHTML(src,col,scale,col2){
  const s=scale||1,c=col||'var(--accent)',c2=col2||'var(--aur2)';
  return (src
    ?'<div class="img" style="background-image:url(&quot;'+pfEsc(src)+'&quot;)"></div>'
    :'<div class="b" style="left:'+(-120*s)+'px;top:'+(-160*s)+'px;width:'+(760*s)+'px;height:'+(760*s)+'px;background:'+c+';filter:blur('+(90*s)+'px);opacity:.55"></div><div class="b" style="left:'+(180*s)+'px;top:'+(320*s)+'px;width:'+(520*s)+'px;height:'+(520*s)+'px;background:'+c2+';filter:blur('+(110*s)+'px);opacity:.42"></div><div class="b" style="left:'+(640*s)+'px;top:'+(-200*s)+'px;width:'+(700*s)+'px;height:'+(500*s)+'px;background:color-mix(in srgb,'+c+' 50%,#000);filter:blur('+(140*s)+'px);opacity:.3"></div>')
    +'<div class="shade"></div>';
}
function pfDailyBest(){
  const days=[];
  try{for(let i=0;i<localStorage.length;i++){const m=/^daily_(\d{4})-(\d{2})-(\d{2})$/.exec(localStorage.key(i)||'');if(m)days.push(new Date(+m[1],+m[2]-1,+m[3]).getTime());}}catch(e){}
  days.sort((a,b)=>a-b);let best=0,run=0,prev=null;
  days.forEach(t=>{run=(prev!==null&&Math.round((t-prev)/86400000)===1)?run+1:1;best=Math.max(best,run);prev=t;});
  return best;
}
function pfDailyEntry(d){
  const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  try{const v=localStorage.getItem('daily_'+k);if(!v)return null;try{return JSON.parse(v)||{};}catch(e){return {};}}catch(e){return null;}
}
function pfAgo(h){
  if(h.played_at){
    const s=(Date.now()-new Date(h.played_at).getTime())/1000;
    if(s<3600)return Math.max(1,Math.round(s/60))+'m ago';
    if(s<86400)return Math.round(s/3600)+'h ago';
    if(s<172800)return 'yesterday';
    return Math.round(s/86400)+'d ago';
  }
  return h.date==='Just now'?'just now':(h.date||'');
}
function pfBars(list){const top=list[0].games||1;return list.map((t,i)=>'<div class="pf-bar"><span style="width:'+Math.round((t.games||top)/top*100)+'%"></span><div><b>'+(i+1)+'</b><em>'+pfEsc(t.name||t)+'</em>'+(t.games?'<i>'+t.games+' games</i>':'')+'</div></div>').join('');}
function pfContrib(username,cb){
  if(!username||typeof SUPABASE_URL==='undefined')return;
  fetch(SUPABASE_URL+'/rest/v1/questions?select=topic_value&status=eq.approved&submitted_by=eq.'+encodeURIComponent(username),{headers:{apikey:SUPABASE_ANON,Authorization:'Bearer '+SUPABASE_ANON}})
    .then(r=>r.ok?r.json():[]).then(rows=>{
      if(!Array.isArray(rows)||!rows.length)return;
      const tp=new Set(rows.map(r=>r.topic_value).filter(Boolean)).size;
      cb(rows.length+' question'+(rows.length===1?'':'s')+(tp?' · '+tp+' topic'+(tp===1?'':'s'):'')+' in the pool');
    }).catch(()=>{});
}
const PF_MODE={race:['Score Race','🏁'],classic:['Classic','🎮'],survival:['Survival','❤️'],potato:['Hot Potato','🥔'],daily:['Daily Quiz','📅']};
function pfModeKey(m){m=String(m||'').toLowerCase();if(m.includes('race'))return 'race';if(m.includes('surv'))return 'survival';if(m.includes('potato'))return 'potato';if(m.includes('daily'))return 'daily';return 'classic';}
function pfToggleMenu(e){e.stopPropagation();document.getElementById('pfMenu')?.classList.toggle('open');}
document.addEventListener('click',()=>document.getElementById('pfMenu')?.classList.remove('open'));

function pEl0(){return document.getElementById('pfPod');}
/* Long names stay on one line (profile title, player card): the font steps down until the name
   fits; below minPx the name part gets "…" but the guest #tag always stays visible. Full name on hover. */
function fitNameInto(el,name,minPx){
  if(!el)return;
  const full=String(name||''),m=full.match(/^(.*?)(#\d{4})?$/);
  el.classList.add('nm-fit');el.title=full;el.style.fontSize='';
  el.innerHTML='<span class="nm-base">'+pfEsc(m[1])+'</span>'+(m[2]?'<span class="gtag" style="opacity:.45">'+m[2]+'</span>':'');
  if(!el.offsetParent)return;
  const base=el.firstChild,tag=base.nextSibling;let fs=parseFloat(getComputedStyle(el).fontSize);
  // layout sizes (not getBoundingClientRect) so an opening scale animation can't skew it;
  // +1 covers the sub-pixel overflow that scrollWidth's rounding would hide
  const room=()=>el.clientWidth-parseFloat(getComputedStyle(el).paddingRight||0);
  const need=()=>base.scrollWidth-6+(tag?tag.offsetWidth+6:0);
  while(need()+1>room()&&fs>minPx){fs-=2;el.style.fontSize=fs+'px';}
}
function pfFitName(){
  const el=document.getElementById('pfName');if(!el)return;
  fitNameInto(el,el.dataset.full||el.textContent,28);
}
window.addEventListener('resize',()=>{if(document.getElementById('page-profile')?.classList.contains('active'))pfFitName();});
function renderProfile(){
  const user=currentUser||'Guest';
  const me=!isGuest&&!!currentUser;
  const pfp=pfPfpSrc();
  {const pp=pfPair(profileColorKey);document.getElementById('pfAurora').innerHTML=pp?pfAuroraHTML(null,pp[2],1,pp[3]):pfAuroraHTML(pfp&&pfp.src);}
  const av=document.getElementById('pfAvatar');
  document.getElementById('page-profile').classList.toggle('is-guest',!me);
  if(pfp&&pfp.src){av.style.background=pfp.bg;av.innerHTML='<img src="'+pfEsc(pfp.src)+'" alt="" style="object-fit:'+(pfp.preset?'contain':'cover')+'" onerror="this.remove()">';}
  else{av.style.background=pfp&&pfp.preset?pfp.bg:'';av.textContent=user[0].toUpperCase();}
  document.getElementById('pfName').dataset.full=user;pfFitName();
  document.getElementById('pfOnline').textContent=me?'ONLINE NOW':'GUEST · ON THIS BROWSER';
  document.querySelector('#page-profile .pf-online').style.color=me?'':'#fb923c';
  document.querySelector('#page-profile .pf-dot').style.cssText=me?'':'background:#fb923c;box-shadow:0 0 8px #fb923c';
  const since=document.getElementById('pfSince');if(!me)since.textContent='';
  if(me&&typeof sb!=='undefined'){sb.auth.getSession().then(({data})=>{const c=data?.session?.user?.created_at;if(c)since.textContent='· since '+new Date(c).toLocaleDateString(undefined,{month:'long',year:'numeric'});}).catch(()=>{});}
  document.getElementById('pfActions').innerHTML=!me?'':me
    ?'<button class="pf-btn pri" onclick="openEditProfile()"><i class="ti ti-pencil"></i> EDIT PROFILE</button><button class="pf-btn" onclick="pfToggleMenu(event)"><i class="ti ti-settings"></i> ACCOUNT SETTINGS</button><div class="pf-menu" id="pfMenu" onclick="event.stopPropagation()">'+(isGuest?'':'<button onclick="this.parentNode.classList.remove(\'open\');openRecoveryCode()"><i class="ti ti-key"></i> New recovery code</button>')+'<button onclick="this.parentNode.classList.remove(\'open\');signOut()"><i class="ti ti-logout"></i> Sign out</button><button class="danger" onclick="this.parentNode.classList.remove(\'open\');openDeleteAccount()"><i class="ti ti-trash"></i> Delete account</button></div>'
    :'<button class="pf-btn pri" onclick="goStep(\'auth\');showAuthMode(\'register\')"><i class="ti ti-user-plus"></i> CREATE ACCOUNT</button><button class="pf-btn" onclick="goStep(\'auth\');showAuthMode(\'signin\')"><i class="ti ti-login"></i> SIGN IN</button>';
  // perfectGames comes from user_stats (every game); the recent list only holds the last 10
  const perfect=Math.max(perfectGames||0,allHistory.filter(g=>g.total>0&&g.correct===g.total).length);
  // Pull this account's saved Daily days once, so the streak and week row match other devices
  if(me&&window._pfDailySyncedFor!==currentUserId){window._pfDailySyncedFor=currentUserId;
    dailySyncFromServer().then(n=>{if(n&&document.getElementById('page-profile')?.classList.contains('active'))renderProfile();});}
  document.getElementById('pfGames').textContent=parseInt(totalGames)||0;
  document.getElementById('pfPerfect').textContent='⭐ '+perfect;
  document.getElementById('pfAnswered').textContent=(totalAnswered||0).toLocaleString();
  document.getElementById('pfAcc').textContent=(totalAnswered?Math.round(totalCorrect/totalAnswered*100):0)+'%';
  const st=dailyStreakInfo();
  document.getElementById('pfDailyCur').textContent='🔥 '+st.streak;
  document.getElementById('pfDailyBest').textContent=Math.max(pfDailyBest(),st.streak);
  const DN=['SUN','MON','TUE','WED','THU','FRI','SAT'],t0=new Date();t0.setHours(0,0,0,0);
  let wk='';
  for(let i=6;i>=0;i--){
    const d=new Date(t0.getTime()-i*86400000),e=pfDailyEntry(d);
    const star=e&&e.total>0&&e.correct===e.total;
    wk+='<div class="pf-day'+(e?(star?' star':' hit'):'')+(i===0?' today':'')+'"><span>'+(e?(star?'⭐':'🔥'):'')+'</span><span>'+(i===0?'TODAY':DN[d.getDay()])+'</span></div>';
  }
  document.getElementById('pfWeek').innerHTML=wk;
  const ex=window.pfExtra||{};
  const most=Array.isArray(ex.topics)?ex.topics.slice(0,3):[];
  const pod=ex.podiums;
  const mid=document.getElementById('pfMid');
  mid.style.display=(most.length||pod||!me)?'':'none';
  mid.classList.toggle('one',!(most.length&&pod));
  const mEl=document.getElementById('pfMost');mEl.style.display=most.length?'':'none';
  if(!me&&!most.length&&!pod){mid.classList.remove('one');mEl.style.display='';pEl0().style.display='';mEl.innerHTML='<span class="pf-cap">PLAYS MOST</span>';pEl0().innerHTML='<span class="pf-cap">MULTIPLAYER PODIUMS</span>';}
  if(most.length)mEl.innerHTML='<span class="pf-cap">PLAYS MOST</span>'+pfBars(most);
  const pEl=document.getElementById('pfPod');if(me||pod||most.length)pEl.style.display=pod?'':'none';
  if(pod){const mx=Math.max(pod.first,pod.second,pod.third,1),hgt=n=>Math.round(12+n/mx*32);
    pEl.innerHTML='<div class="pf-row-hd"><span class="pf-cap">MULTIPLAYER PODIUMS</span><span class="pf-mono">of '+(pod.of||0)+'</span></div><div class="pf-podium">'
    +[[pod.second,'#cbd5e1',2],[pod.first,'#fbbf24',1],[pod.third,'#d8a06a',3]].map(([n,c,p])=>'<div><span style="color:'+c+'">'+n+'</span><div style="height:'+hgt(n)+'px;background:linear-gradient(180deg,'+c+','+c+'55)">'+p+'</div></div>').join('')+'</div>';}
  const rec=me?allHistory.slice(0,4):[];
  document.getElementById('pfRecentN').textContent=rec.length?'last '+rec.length:'';
  document.getElementById('pfRecent').innerHTML=rec.length?rec.map(g=>{
    const [label,ic]=PF_MODE[pfModeKey(g.mode)];
    const fmt=g.fmt||(typeof fmtLabels!=='undefined'&&fmtLabels[g.format])||g.format||'';
    const sub=(g.players?'Multiplayer · '+g.players+' players':'Solo')+(fmt?' · '+fmt:'')+(g.topic?' · '+g.topic:'');
    const sfx=n=>n+((n%100>10&&n%100<14)?'th':(['th','st','nd','rd'][n%10]||'th'));
    const win=g.place===1;
    const main=g.place?sfx(g.place):(g.total?g.correct+'/'+g.total:(g.score||0));
    const under=win?'WINNER':(g.score!=null?g.score+' pts':'');
    const gold=win?' style="color:#fbbf24"':'';
    return '<div class="pf-game"><span class="pf-game-ic">'+ic+'</span><div style="flex:1;min-width:0"><div class="pf-game-t">'+label+'</div><div class="pf-game-s">'+pfEsc(sub)+'</div></div><div class="pf-game-r"><div'+gold+'>'+main+'</div>'+(under?'<div'+gold+'>'+under+'</div>':'')+'</div><span class="pf-game-w">'+pfEsc(pfAgo(g))+'</span></div>';
  }).join(''):(me?'<div class="pf-empty">No games yet. <a onclick="choosePath(\'solo\')">Start playing</a></div>':'');
  const badge=document.getElementById('pfBadge');
  if(window._pfBadgeFor!==user){window._pfBadgeFor=user;badge.style.display='none';}
  if(me)pfContrib(currentUser,txt=>{document.getElementById('pfBadgeSub').textContent=txt;badge.style.display='inline-flex';});
  applyTheme();
}

/* PUBLIC CARD — 59a */
function pcClose(){const c=document.getElementById('playerCard');if(c)c.classList.remove('open');}
function pcFriend(btn){
  if(btn.classList.contains('sent'))return;
  const n=document.getElementById('playerCard').dataset.name;(window._pcSent=window._pcSent||new Set()).add(n);
  // TODO(backend): insert into friend_requests {from:currentUserId,to:userId}. Visual state only for now.
  btn.classList.add('sent');btn.innerHTML='<i class="ti ti-clock"></i>';btn.title='Friend request pending';btn.onclick=null;
}
async function openPlayerCard(name,anchor){
  const p=(typeof lobbyPlayers!=='undefined'?lobbyPlayers:[]).find(x=>x.name===name)||{name};
  const isMe=name===currentUser;
  const c=document.getElementById('playerCard');
  const pre=!isMe&&p.avatar&&p.avatar.startsWith('preset:')?PFP_PRESETS.find(q=>q.id===p.avatar.slice(7)):null;
  const img=isMe?pfPfpSrc()?.src:(p.avatar&&p.avatar.startsWith('preset:')?(pre&&pre.src)||null:(p.avatar||null));
  const col=p.color||'var(--accent)';
  const online=p.connected!==false&&!p.quit;
  let contrib=null,stats=null;
  const render=()=>{
    const s=stats;
    const acc=s&&s.total_answered?Math.round(s.total_correct/s.total_answered*100)+'%':(s?'—':'…');
    const topics=s&&Array.isArray(s.topics)?s.topics.slice(0,3):[];
    const mp=s&&(s.mp_wins!=null||s.mp_podiums!=null);
    const since=s&&s.created_at?new Date(s.created_at).toLocaleDateString(undefined,{month:'long',year:'numeric'}):null;
    const daily=isMe?dailyStreakInfo().streak:(s&&s.daily_streak!=null?s.daily_streak:null);
    const canFriend=!isMe&&!isGuest&&!!currentUser&&!!p.userId;
    const cp=isMe?pfPair(profileColorKey):pfPairByLead(p.color);
    c.innerHTML='<div class="pc-aur">'+(cp?pfAuroraHTML(null,cp[2],.45,cp[3]):pfAuroraHTML(img,col,.45))+'</div><div class="pc-body">'
      +(canFriend?(window._pcSent&&window._pcSent.has(name)?'<button class="pc-friend sent" title="Friend request pending"><i class="ti ti-clock"></i></button>':'<button class="pc-friend" title="Send friend request" onclick="pcFriend(this)"><i class="ti ti-user-plus"></i></button>'):'')
      +'<div class="pc-hd"><div class="pc-av" style="background:'+(img?'var(--bg3)':'linear-gradient(135deg,'+col+',var(--aur2))')+'">'+(img?'<img src="'+pfEsc(img)+'" alt="">':pfEsc(name[0].toUpperCase()))+'</div><div style="min-width:0;flex:1"><span class="pc-seen'+(online?' on':'')+'">'+(online?'ONLINE NOW':(s&&s.last_seen?'SEEN '+pfAgo({played_at:s.last_seen}).toUpperCase():'AWAY'))+'</span><div class="pc-name">'+pfEsc(name)+'</div></div></div>'
      +(contrib?'<div class="pc-badge"><span class="pc-badge-ic"><i class="ti ti-heart-handshake"></i></span><div><div class="pc-badge-t">CONTRIBUTOR</div><div class="pc-badge-s">'+pfEsc(contrib)+'</div></div></div>':'')
      +'<div class="pc-stats">'
        +'<div class="pc-panel pc-stat"><i class="ti ti-device-gamepad-2" style="color:var(--accent)"></i><div><div class="pc-stat-v">'+(s?(s.total_games||0):'…')+'</div><div class="pc-stat-l">games</div></div></div>'
        +'<div class="pc-panel pc-stat"><i class="ti ti-target-arrow" style="color:#4ade80"></i><div><div class="pc-stat-v">'+acc+'</div><div class="pc-stat-l">accuracy</div></div></div>'
        +'<div class="pc-panel pc-stat"><i class="ti ti-flame" style="color:#fb923c"></i><div><div class="pc-stat-v" style="color:#fb923c">'+(daily!=null?'🔥 '+daily:'—')+'</div><div class="pc-stat-l">daily streak</div></div></div>'
      +'</div>'
      +(mp?'<div class="pc-panel pc-mp"><span class="pc-cap">MULTIPLAYER</span><div><span style="color:#fbbf24">🥇 '+(s.mp_wins||0)+' <small>wins</small></span><span>'+(s.mp_podiums||0)+' <small>podiums</small></span></div></div>':'')
      +(topics.length?'<div class="pc-panel pc-most"><span class="pc-cap">PLAYS MOST</span>'+pfBars(topics.map(t=>typeof t==='string'?{name:t}:t))+'</div>':'')
      +(since?'<div class="pc-foot">Playing since '+since+'</div>':'')
      +'</div>';
    fitNameInto(c.querySelector('.pc-name'),name,16);
    // anchor beside the row: prefer the left side, fall back to right, clamp vertically
    const r=anchor.getBoundingClientRect(),w=c.offsetWidth,hh=c.offsetHeight;
    let x=r.left-w-14;if(x<12)x=Math.min(r.right+14,innerWidth-w-12);
    c.style.left=Math.max(12,x)+'px';c.style.top=Math.max(12,Math.min(r.top-20,innerHeight-hh-12))+'px';
  };
  const mine=isMe&&!isGuest?{total_games:totalGames,total_correct:totalCorrect,total_answered:totalAnswered}:null;
  stats=mine||(p.userId?null:{total_games:0});
  c.dataset.name=name;c.classList.add('open');render();
  const still=()=>c.dataset.name===name&&c.classList.contains('open');
  pfContrib(name,txt=>{if(still()){contrib=txt;render();}});
  if(p.userId&&typeof SUPABASE_URL!=='undefined'){
    try{
      const res=await fetch(SUPABASE_URL+'/rest/v1/profiles?select=*&id=eq.'+encodeURIComponent(p.userId)+'&limit=1',{headers:{apikey:SUPABASE_ANON,Authorization:'Bearer '+SUPABASE_ANON}});
      const row=(await res.json())?.[0];
      if(!still())return;
      const s=row?{...row,total_answered:row.total_answered??row.total_addressed}:{total_games:0};
      if(mine)Object.assign(s,mine);
      if(isMe&&!isGuest&&!s.created_at&&typeof sb!=='undefined'){const {data}=await sb.auth.getSession();s.created_at=data?.session?.user?.created_at;}
      if(!still())return;
      stats=s;render();
    }catch(e){if(still()&&!stats){stats={total_games:0};render();}}
  }
}
document.addEventListener('click',e=>{
  const c=document.getElementById('playerCard');if(!c)return;
  if(c.contains(e.target))return;
  const row=e.target.closest('#lobbyPlayerList .lobby-player,#mpFinalStandings .standing-row');
  if(row&&!e.target.closest('button,.lobby-kebab-wrap,.lobby-player-actions,[onclick]')){
    const n=row.dataset.playerName||row.dataset.name;
    if(n){if(c.classList.contains('open')&&c.dataset.name===n){pcClose();return;}openPlayerCard(n,row);return;}
  }
  pcClose();
},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')pcClose();});

/* PFP picker carousel. Arrows stage a preset; upload goes through the existing crop editor
   (its result lands in #pfpUploadImg, which we watch); Confirm still calls savePfp(). */
let pkIdx=0,pkTab='preset',pkOrig=null,pkUp=null;
function pkCycle(d){
  const L=PFP_PRESETS;if(!L.length)return;
  pkIdx=(pkIdx+d+L.length)%L.length;
  pfpPendingSelection={type:'preset',value:L[pkIdx].id};
  pkRender();
}
function pkSetTab(t){
  pkTab=t;
  if(t==='preset'){const L=PFP_PRESETS;pfpPendingSelection={type:'preset',value:L[pkIdx%L.length].id};}
  else pfpPendingSelection=pkUp?{...pkUp}:(pkOrig?{...pkOrig}:null);
  pkRender();
}
function pkRender(){
  const L=PFP_PRESETS,M=document.getElementById('pfpModal');if(!M)return;const $=id=>M.querySelector('#'+id);const disc=$('pkDisc');if(!disc)return;
  const pre=pkTab==='preset',up=!pre&&pkUp?(pfpUploadDataUrl||pkUp.value):null;
  $('pkTabUp').classList.toggle('on',!pre);$('pkTabPre').classList.toggle('on',pre);
  $('pkPrev').hidden=$('pkNext').hidden=!pre;$('pkUpBtn').hidden=pre||!up;
  disc.classList.toggle('empty',!pre&&!up);disc.style.color='';disc.onclick=pre?null:()=>document.getElementById('pfpFileInput').click();disc.style.cursor=pre?'':'pointer';
  const p=L[pkIdx%L.length];
  if(pre){disc.innerHTML=typeof auPresetDiscHTML==='function'?auPresetDiscHTML(p):'<img src="'+p.src+'" alt="">';disc.style.background=(p&&p.bg)||'var(--bg3)';}
  else if(up){disc.innerHTML='<img src="'+up+'" alt="" style="object-fit:cover">';disc.style.background='var(--bg3)';}
  else{disc.innerHTML='<i class="ti ti-photo-plus"></i>';disc.style.background='';}
  $('pkName').textContent=pre&&p?p.name:'';$('pkName').style.visibility='';$('pkName').style.display=pre?'':'none';
  $('pkSeries').textContent=pre&&p?p.series:'';$('pkSeries').style.visibility='';$('pkSeries').style.display=pre?'':'none';
  const col=pre&&p?(p.bg||'var(--accent)'):'var(--accent)';
  $('pkAur').innerHTML=(up?'<div class="img" style="background-image:url(&quot;'+up+'&quot;)"></div>':'<div class="b1" style="background:'+col+'"></div>')+'<div class="b2"></div><div class="shade"></div>';
  $('pkSub').innerHTML=pre?'':'<a onclick="document.getElementById(\'pfpFileInput\').click()">'+(up?'Click to change picture':'Click to upload a picture')+'</a><br>JPG, PNG or GIF · max 10MB';
  const pips=$('pkPips');pips.style.visibility='';pips.style.display=pre?'':'none';$('pkSub').style.display=pre?'none':'';
  pips.innerHTML=L.map((_,i)=>'<i class="'+(i===pkIdx?'on':'')+'"></i>').join('');
}
(function(){
  const _open=window.openPfpPicker;
  window.openPfpPicker=function(){
    const r=_open.apply(this,arguments);
    const cur=pfpPendingSelection;
    const i=cur&&cur.type==='preset'?PFP_PRESETS.findIndex(p=>p.id===cur.value):-1;
    pkIdx=i>=0?i:0;
    pkOrig=cur?{...cur}:null;pkUp=cur&&cur.type==='upload'?{...cur}:null;
    pkTab=cur&&cur.type==='preset'?'preset':'upload';
    pkRender();
    return r;
  };
  const img=document.getElementById('pfpUploadImg');
  if(img)new MutationObserver(()=>{if(document.getElementById('pfpModal').style.display!=='none'&&pfpPendingSelection&&pfpPendingSelection.type==='upload'){pkUp={...pfpPendingSelection};pkTab='upload';pkRender();}}).observe(img,{attributes:true,attributeFilter:['src']});
})();

function aurTest(v){document.documentElement.setAttribute('data-aur',v);try{localStorage.setItem('aur_test',v)}catch(e){}document.querySelectorAll('#aurTest [data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===v));}
const AUR_THEMES=[['midnight','#a78bfa','Ethereal'],['obsidian','#96C7FF','Moonlight'],['blossom','#f472b6','Blossom'],['abyss','#38bdf8','Abyss'],['inferno','#fb923c','Inferno'],['jade','#4ade80','Jade'],['arcane','#e879f9','Arcane']];
function aurTheme(){const i=AUR_THEMES.findIndex(t=>t[0]===currentColor);const n=AUR_THEMES[(i+1)%AUR_THEMES.length];setColor(n[0],n[1],n[2],null);if(document.getElementById('page-profile').classList.contains('active'))renderProfile();}
(function(){let v='a';try{v=localStorage.getItem('aur_test')||'a'}catch(e){}aurTest(v);})();

/* keep the pill's avatar in sync after picture changes */
(function(){const _a=window.afterPfpSave;if(typeof _a==='function')window.afterPfpSave=function(){const r=_a.apply(this,arguments);if(typeof lzSyncAuth==='function')lzSyncAuth();return r;};})();

/* the name pill's menu: View profile, Sign in (guests) or Sign out (accounts), Inbox, motion, Admin (opens upward, like the theme dropdown) */
function lzMeClose(){document.getElementById('lzMeMenu').classList.remove('open');}
function lzMeMenu(e){
  e.stopPropagation();
  const m=document.getElementById('lzMeMenu');
  if(m.classList.contains('open')){lzMeClose();return;}
  const guest=typeof isGuest!=='undefined'&&isGuest,ib=window._inbox||{any:false,unread:0},adm=typeof isAdmin!=='undefined'&&isAdmin;
  m.innerHTML='<button onclick="lzMeClose();goProfile()"><i class="ti ti-user"></i> View profile</button>'
    +(guest?'<button onclick="lzMeClose();goStep(\'auth\');showAuthMode(\'signin\')"><i class="ti ti-login"></i> Sign in</button>':'')
    +(!guest&&ib.any?'<button onclick="lzMeClose();openInboxModal()"><i class="ti ti-mail"></i> Inbox'+(ib.unread?'<span class="n">'+ib.unread+'</span>':'')+'</button>':'')
    +'<span class="sep"></span><button onclick="skCycleMotion(this)"><i class="ti ti-planet"></i> World motion: <b id="skMotionLbl" style="margin-left:auto">'+({full:'Full',subtle:'Subtle',off:'Off'}[window.skMotion?window.skMotion():'full'])+'</b></button>'
    +(!guest&&adm?'<span class="sep"></span><button onclick="lzMeClose();goAdmin()"><i class="ti ti-shield-lock"></i> Admin panel</button>':'')
    // Guests get no Sign out: it would drop their guest progress
    +(!guest?'<span class="sep"></span><button onclick="lzMeClose();signOut()"><i class="ti ti-logout"></i> Sign out</button>':'');
  m.classList.add('open');
  const r=e.currentTarget.getBoundingClientRect(),w=m.offsetWidth,hh=m.offsetHeight;
  m.style.left=Math.max(12,Math.min(r.left+r.width/2-w/2,innerWidth-w-12))+'px';
  m.style.top=(r.top-hh-10>12?r.top-hh-10:r.bottom+10)+'px';
}
document.addEventListener('click',e=>{if(!e.target.closest('#lzMeMenu'))lzMeClose();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')lzMeClose();});

/* crop editor extras: live previews + blurred backdrop, grid while dragging, keyboard, reset */
function crAfterDraw(){
  const src=document.getElementById('pfpCropCanvas');if(!src)return;
  ['crPrevL','crPrevM','crPrevS','pfpCropAur'].forEach(id=>{const c=document.getElementById(id);if(!c)return;const x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.drawImage(src,0,0,c.width,c.height);});
}
function crNudgeZoom(d){
  if(!_cropImg)return;
  const minScale=CROP_SIZE/Math.min(_cropImg.width,_cropImg.height);
  _applyCropZoom(_cropScale+d*minScale*0.15,CROP_SIZE/2,CROP_SIZE/2);
  crSyncSlider();
}
function crSyncSlider(){
  if(!_cropImg)return;
  const minScale=CROP_SIZE/Math.min(_cropImg.width,_cropImg.height);
  document.getElementById('pfpZoomSlider').value=Math.round(100+(_cropScale/minScale-1)*100);
}
function crReset(){
  if(!_cropImg)return;
  _cropScale=CROP_SIZE/Math.min(_cropImg.width,_cropImg.height);
  _cropX=(CROP_SIZE-_cropImg.width*_cropScale)/2;_cropY=(CROP_SIZE-_cropImg.height*_cropScale)/2;
  _drawCrop();crSyncSlider();
}
(function(){
  const _att=window._attachCropEvents;
  window._attachCropEvents=function(){
    const r=_att.apply(this,arguments);
    const canvas=document.getElementById('pfpCropCanvas'),view=document.getElementById('pfpCropViewport');
    // the canvas is drawn at CROP_SIZE but may be displayed smaller on phones: scale drag deltas to match
    const k=()=>CROP_SIZE/(canvas.getBoundingClientRect().width||CROP_SIZE);
    canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);_cropDragging=true;_cropLastX=e.clientX;_cropLastY=e.clientY;view.classList.add('dragging');canvas.style.cursor='grabbing';};
    canvas.onpointermove=e=>{if(!_cropDragging)return;const s=k();_cropX+=(e.clientX-_cropLastX)*s;_cropY+=(e.clientY-_cropLastY)*s;_cropLastX=e.clientX;_cropLastY=e.clientY;_clampCrop();_drawCrop();};
    canvas.onpointerup=canvas.onpointercancel=()=>{_cropDragging=false;view.classList.remove('dragging');canvas.style.cursor='grab';};
    const _wheel=canvas.onwheel;canvas.onwheel=e=>{_wheel(e);crSyncSlider();};
    canvas.ondblclick=crReset;
    const card=document.getElementById('pfpCropCard');
    card.onkeydown=e=>{
      const step=e.shiftKey?20:6;
      if(e.key==='ArrowLeft')_cropX+=step;else if(e.key==='ArrowRight')_cropX-=step;
      else if(e.key==='ArrowUp')_cropY+=step;else if(e.key==='ArrowDown')_cropY-=step;
      else if(e.key==='+'||e.key==='='){crNudgeZoom(1);e.preventDefault();return;}
      else if(e.key==='-'){crNudgeZoom(-1);e.preventDefault();return;}
      else if(e.key==='Enter'){confirmPfpCrop();return;}
      else if(e.key==='Escape'){closePfpCrop();return;}
      else return;
      e.preventDefault();_clampCrop();_drawCrop();
    };
    setTimeout(()=>card.focus(),30);
    return r;
  };
})();

(function(){const _o=window.openInboxModal;if(typeof _o!=='function')return;window.openInboxModal=async function(){const r=await _o.apply(this,arguments);if(window._inbox){window._inbox.unread=0;lzSyncAuth();}return r;};})();
(function(){const _c=window.checkAdminRole;if(typeof _c!=='function')return;window.checkAdminRole=async function(){const r=await _c.apply(this,arguments);if(typeof lzSyncAuth==='function')lzSyncAuth();return r;};})();

/* Palette maths for the Dusk/Bright backgrounds (palVars), used by the depth code below. */
function palHex(h){h=h.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}
function palMix(a,b,t){const A=palHex(a),B=palHex(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('');}
function palHsl(hex){let [r,g,b]=palHex(hex).map(v=>v/255);const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let hh=0,ss=0;const l=(mx+mn)/2;if(mx!==mn){const d=mx-mn;ss=l>.5?d/(2-mx-mn):d/(mx+mn);hh=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;hh*=60;}return [hh,ss,l];}
function palFromHsl(hh,ss,l){const k=n=>(n+hh/30)%12,a=ss*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return '#'+[f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');}
/* Night = near-black tinted. Dusk/Bright = the pair's own hues, saturated, at a deeper or richer lightness (not a lifted grey). */
function palGround(hex,sat,light){const [hh]=palHsl(hex);return palFromHsl(hh,sat,light);}
function palVars(L,S,depth){
  let bg,gL,gS;
  if(depth==='Night'||!depth){bg=palMix('#07060d',S,.07);gL=gS=bg;}
  else{const [sat,light]=depth==='Dusk'?[.62,.15]:[.78,.3];gL=palGround(L,sat,light);gS=palGround(S,sat,light);bg=palMix(gL,gS,.5);}
  const vivid=depth&&depth!=='Night';
  const bg2=vivid?palMix(bg,'#000000',.22):palMix(bg,'#ffffff',.045);
  const bg3=vivid?palMix(bg,'#000000',.12):palMix(bg,'#ffffff',.09);
  const border=palMix(bg,'#ffffff',vivid?.2:.15),border2=palMix(bg,'#ffffff',vivid?.3:.24);
  const text=vivid?'#ffffff':palMix('#f1eef8',S,.06),muted=vivid?palMix('#ffffff',bg,.28):palMix(text,bg,.4);
  return {'--accent':L,'--accent-soft':palMix(bg2,L,.18),'--bg':bg,'--bg2':bg2,'--bg3':bg3,'--border':border,'--border2':border2,'--text':text,'--muted':muted,'--faint':palMix(bg,'#ffffff',.08),
    '--orb1':L+'1c','--orb2':S+'14','--orb3':S+'0d','--card-bg':bg2+'99','--card-border':border+'cc','--aur2a':S,'--aur2b':S,'--aur2':S,'--hover':bg3,
    '--pal-grad':'linear-gradient(210deg,'+gL+' 0%,'+palMix(gL,gS,.5)+' 50%,'+gS+' 100%)',
    '--pal-radial':'radial-gradient(120% 95% at 50% 40%,'+palMix(gL,'#ffffff',.1)+' 0%,'+gL+' 28%,'+palMix(gL,gS,.55)+' 58%,'+gS+' 82%,'+palMix(gS,'#000000',.25)+' 100%)'};
}

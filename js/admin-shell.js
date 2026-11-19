// Admin panel v2 shell. NOT loaded for players: js/admin-stub.js loads it right after admin.js. The banned-player check moved to js/ban-check.js.
/* Admin panel v2 — sidebar shell, Home, Players, Live lobbies, Activity log.
   New server pieces live in supabase/admin-setup.sql. Existing sections are reused as-is. */
(function(){
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=id=>parseInt(($(id)?.textContent||'').replace(/\D/g,''))||0;
const PAL=['#96C7FF','#b8a9ff','#f9a8d4','#5eead4','#fcd34d','#fdba74','#86efac','#fca5a5','#a5f3fc','#c4b5fd'];
const col=s=>{let h=0;for(const c of String(s||''))h=(h*31+c.charCodeAt(0))|0;return PAL[Math.abs(h)%PAL.length];};
const ago=d=>{if(!d)return '—';const s=(Date.now()-new Date(d))/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';if(s<86400*30)return Math.floor(s/86400)+'d';return new Date(d).toLocaleDateString(undefined,{month:'short',year:'numeric'});};
const avHTML=(name,url,cls)=>'<span class="'+(cls||'adm-av')+'" style="background:'+col(name)+'">'+(url&&!/^preset:/.test(url)?'<img src="'+esc(url)+'" alt="" style="width:100%;height:100%;object-fit:cover">':esc((name||'?')[0].toUpperCase()))+'</span>';
const modeName=m=>(typeof lobbyModeLabel==='function'?lobbyModeLabel(m):m||'').replace(/\s*\p{Extended_Pictographic}/gu,'');
const setupMsg='<div class="adm-setup">This part needs the admin tables. Run <code>supabase/admin-setup.sql</code> in the Supabase SQL editor, then refresh.</div>';

const NAV=[
  [null,[['home','ti-home','Home']]],
  ['QUEUE',[['review','ti-inbox','Review','q'],['suggestions','ti-bulb','Suggestions','sg'],['messages','ti-mail','Messages','ms']]],
  ['LIBRARY',[['browse','ti-search','Questions'],['coverage','ti-layout-grid','Coverage'],['charlib','ti-user-circle','Characters'],['sky','ti-cloud','Sky characters']]],
  ['TOOLS',[['import','ti-file-upload','Import'],['romanize','ti-language','Romanize'],['leaks','ti-eye-off','Answer leaks'],['content','ti-typography','Site copy']]],
  ['COMMUNITY',[['players','ti-users','Players'],['lobbies','ti-broadcast','Live lobbies','lv']]],
  ['SYSTEM',[['audit','ti-history','Activity log']]]
];
const INFO={
  review:['Review','Approve, reject and resolve what players send in.'],
  browse:['Questions','Search, filter and edit the whole question bank.'],
  coverage:['Coverage','How many questions each topic has, per format.'],
  charlib:['Characters','The characters used in Name the Character.'],
  sky:['Sky characters','The faded figures in the main page sky. One solo character shows per visit.'],
  import:['Import','Add many questions at once, or send a batch through AI to rewrite.'],
  romanize:['Romanize','Find names with long vowels (ou, uu) and shorten them.'],
  leaks:['Answer leaks','Questions whose wording gives the answer away.'],
  content:['Site copy','Card titles, descriptions, and which formats and modes are open. Changes go live straight away.'],
  suggestions:['Suggestions','Topics players have asked for.'],
  messages:['Messages','From the contact form in the footer.'],
  players:['Players','Look people up, rename, reset pictures, ban.'],
  lobbies:['Live lobbies','Every open room. Refreshes every 10 seconds.'],
  audit:['Activity log','Every admin action and who did it.']
};
const NEW=['home','players','lobbies','audit','sky'];
let cur='home',lv=0,lobbyTimer=null;

function counts(){return{q:num('adminCountSubmitted')+num('adminCountReported')+num('adminCountSuspect'),sg:num('adminCountSuggestions'),ms:num('adminCountMessages'),lv};}
function renderNav(){
  const el=$('admNav');if(!el)return;const c=counts();
  el.innerHTML=NAV.map(([g,items])=>(g?'<div class="adm-g">'+g+'</div>':'')+items.map(([k,ic,l,ck])=>{
    const n=ck?c[ck]:0;const badge=!n?'':ck==='lv'?'<span class="adm-live"></span>':'<span class="adm-n">'+n+'</span>';
    return '<button class="adm-item'+(k===cur?' on':'')+'" onclick="admGo(\''+k+'\')"><i class="ti '+ic+'"></i><span>'+l+'</span>'+badge+'</button>';
  }).join('')).join('');
}
function renderLock(){
  const b=$('admLock');if(!b)return;
  const on=typeof _isAdminUnlocked==='function'&&_isAdminUnlocked();
  let left='';try{const ms=Math.max(0,_adminUnlockExpiry-Date.now());left=Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0');}catch(e){}
  b.classList.toggle('on',on);
  b.innerHTML=on?'<i class="ti ti-lock-open" style="font-size:14px"></i> Unlocked · '+left:'<i class="ti ti-lock" style="font-size:14px"></i> Locked · click to unlock';
}
window.admLockToggle=()=>{if(typeof _isAdminUnlocked==='function'&&_isAdminUnlocked()){_lockAdmin();}else requireAdminUnlock(()=>{});setTimeout(renderLock,50);};

const _origSwitch=window.switchAdminSection;
window.admGo=async function(k){
  cur=k;renderNav();
  const [t,d]=INFO[k]||['',''];
  $('admTitle').textContent=t;$('admDesc').textContent=d;$('admEyebrow').textContent='';
  const isNew=NEW.includes(k);
  NEW.forEach(s=>{const e=$('adm-'+s);if(e)e.style.display=s===k?'':'none';});
  $('admLegacy').style.display=isNew?'none':'';
  $('admMain').scrollTop=0;
  clearInterval(lobbyTimer);lobbyTimer=null;
  if(k==='home')return loadHome();
  if(k==='players')return loadPlayers();
  if(k==='lobbies'){lobbyTimer=setInterval(()=>{if($('page-admin')?.classList.contains('active')&&cur==='lobbies')loadLobbies();},10000);return loadLobbies();}
  if(k==='audit')return loadAudit();
  if(k==='sky')return skyAll();
  return _origSwitch(k);
};
window.switchAdminSection=function(s){return window.admGo(s);};

/* Sky characters — manages LZ_ROSTER (landing sky). Tuning happens in the real sky editor on the landing. */
let skySel=null,skyF='all',skyQv='';
const skySrc=c=>c.src||(c.custom?'':'assets/characters/'+c.id+'.png');
const skyName=c=>c.name||'Untitled';
const skyThumb=c=>skySrc(c)||(lzIsScene(c)&&(lzSceneLayers(c)[0]||{}).src)||'';
function skyAll(){if(!skySel||!LZ_ROSTER.some(c=>c.id===skySel))skySel=LZ_ROSTER[0]&&LZ_ROSTER[0].id;skyChips();skyGrid();skyDetail();}
function skyChips(){
  const n={all:LZ_ROSTER.length,live:LZ_ROSTER.filter(c=>c.on!==false).length,scenes:LZ_ROSTER.filter(lzIsScene).length};n.hidden=n.all-n.live;
  $('skyChips').innerHTML=[['all','All'],['live','Live'],['hidden','Hidden'],['scenes','Scenes']].map(([k,l])=>'<button class="adm-chip'+(skyF===k?' on':'')+'" onclick="skyFilter(\''+k+'\')">'+l+' '+n[k]+'</button>').join('');
}
function skyGrid(){
  const q=skyQv.trim().toLowerCase();
  const L=LZ_ROSTER.filter(c=>(skyF==='all'||(skyF==='scenes'?lzIsScene(c):(skyF==='live')===(c.on!==false)))&&(!q||(skyName(c)+' '+(c.series||'')).toLowerCase().includes(q)));
  $('skyGrid').innerHTML=L.length?L.map(c=>{const s=skyThumb(c),on=c.on!==false;
    return '<div class="sky-card'+(c.id===skySel?' sel':'')+(on?'':' off')+'" onclick="skyPick(\''+c.id+'\')">'
      +'<div class="sky-th">'+(s?'<img src="'+esc(s)+'" alt="" loading="lazy" style="object-position:'+Math.round((c.fx??.5)*100)+'% 0">':'<i class="ti ti-photo-plus"></i>')+'</div>'
      +(c.kind==='daily'?'<span class="sky-tag">DAILY HOST</span>':lzIsScene(c)?'<span class="sky-tag">SCENE</span>':c.solo?'':'<span class="sky-tag">CROWD ONLY</span>')
      +'<div class="sky-meta"><div><b>'+esc(skyName(c))+'</b><small>'+esc(c.series||'No series')+'</small></div>'
      +'<button class="sky-tg'+(on?' on':'')+'" title="'+(on?'Live — click to hide':'Hidden — click to show')+'" onclick="event.stopPropagation();skyToggle(\''+c.id+'\')"></button></div></div>';
  }).join(''):'<div class="adm-empty">No characters match.</div>';
}
function skyDetail(){
  const c=LZ_ROSTER.find(x=>x.id===skySel),el=$('skyDetail');
  if(!c){el.innerHTML='<div class="adm-panel"><div class="adm-empty">No characters yet. Add one to get started.</div></div>';return;}
  const s=skyThumb(c),on=c.on!==false,fx=Math.round((c.fx??.5)*100);
  const file='<input type="file" accept="image/png,image/webp" style="display:none" onchange="skyFile(this,\''+c.id+'\')">';
  el.innerHTML='<div class="adm-panel">'
    +(s?'<div class="sky-big"><div class="sky-fig"><img src="'+esc(s)+'" alt=""><span class="sky-fx" id="skyFxLine" style="left:'+fx+'%"></span></div></div>'
       :'<label class="sky-drop"><i class="ti ti-upload"></i><b>Upload a cut-out</b>'+(lzIsScene(c)?'Transparent PNG · group image · 1500px+ wide':'Transparent PNG · head and shoulders · 1000px+ tall')+file+'</label>')
    +'<div class="sky-hd"><h3>'+esc(skyName(c))+'</h3><span class="adm-mute">'+(on?'Live':'Hidden')+'</span><button class="sky-tg'+(on?' on':'')+'" onclick="skyToggle(\''+c.id+'\')"></button></div>'
    +'<div class="adm-field"><label>NAME</label><input id="skyName" value="'+esc(c.name||'')+'" placeholder="e.g. Levi" onchange="skySet(\''+c.id+'\',\'name\',this.value)"></div>'
    +'<div class="adm-field"><label>SERIES</label><input value="'+esc(c.series||'')+'" placeholder="e.g. Attack on Titan" onchange="skySet(\''+c.id+'\',\'series\',this.value)"></div>'
    +'<div class="adm-field"><label>TYPE</label><div class="adm-chips"><button class="adm-chip'+(!lzIsScene(c)&&c.kind!=='daily'&&c.solo?' on':'')+'" onclick="skyKind(\''+c.id+'\',0)">Solo character</button><button class="adm-chip'+(lzIsScene(c)?' on':'')+'" onclick="skyKind(\''+c.id+'\',1)">Multiplayer scene</button><button class="adm-chip'+(c.kind==='daily'?' on':'')+'" onclick="skyKind(\''+c.id+'\',2)">Daily host</button></div>'
    +'<div class="adm-mute" style="font-size:11px;margin-top:6px">'+(lzIsScene(c)?'Shown on the multiplayer side, one per visit, never the same twice in a row. Use one group image, or build it from layers with Tune in the sky. '+lzSceneLayers(c).length+' layer'+(lzSceneLayers(c).length===1?'':'s')+' so far.':(c.kind==='daily'?'Peeks out when you hover Daily Quiz. One host per day, the same for everyone. Pointing or waving poses work best.':'One shows on the solo side per visit.'))+'</div></div>'
    +(s&&!lzIsScene(c)&&c.kind!=='daily'?'<div class="adm-field"><label>FACE POSITION</label><input class="sky-range" type="range" min="0" max="100" value="'+fx+'" oninput="skyFx(\''+c.id+'\',this.value)" onchange="skyFx(\''+c.id+'\',this.value,1)"></div>':'')
    +'<div class="sky-acts">'+(s||lzIsScene(c)?'<button class="adm-btn pri" onclick="skyTune(\''+c.id+'\')"><i class="ti ti-adjustments"></i> Tune in the sky</button><label class="adm-btn"><i class="ti ti-replace"></i> Replace'+file+'</label>':'')
    +'<button class="adm-btn ghost-red" onclick="skyDel(\''+c.id+'\')"><i class="ti ti-trash"></i> Delete</button></div>'
    +(s?'<div class="adm-note">'+(lzIsScene(c)?'Upload at full size (1500px+ wide is ideal). ':'')+'Tune opens the main page with '+esc(skyName(c))+' in the sky and the sky editor open. Position, crop, fade and look are set there. Press Esc when done.</div>':'')
    +'</div>'
    +'<div class="adm-note">Saved in this browser for now. Once the <code>sky_characters</code> table is set up in Supabase, changes here go live for everyone. <button class="adm-link" style="margin:0" onclick="skyRestore()">Restore the original 14</button></div>'
    +'<div style="margin-top:10px"><button class="adm-btn" onclick="skyTuneCal()"><i class="ti ti-calendar"></i> Move the Daily calendar</button></div>';
}
const skySave=()=>{const ok=lzRosterSave();if(typeof lzRenderChars==='function')lzRenderChars(true);return ok;};
window.skyFilter=k=>{skyF=k;skyChips();skyGrid();};
window.skyFind=v=>{skyQv=v;skyGrid();};
window.skyPick=id=>{skySel=id;skyGrid();skyDetail();};
window.skyToggle=id=>{const c=LZ_ROSTER.find(x=>x.id===id);if(!c)return;if(c.on===false&&!skyThumb(c)){alert('Add an image'+(lzIsScene(c)?' or a layer':'')+' before showing this.');return;}c.on=c.on===false;skySave();skyAll();};
window.skySet=(id,k,v)=>{const c=LZ_ROSTER.find(x=>x.id===id);if(!c)return;c[k]=v;if(k==='name'&&c.custom)c.who=(v||c.id).toLowerCase().replace(/[^a-z0-9]+/g,'')||c.id;skySave();skyGrid();skyDetail();};
window.skyKind=(id,sc)=>{const c=LZ_ROSTER.find(x=>x.id===id);if(!c)return;if(sc===2){c.kind='daily';c.solo=0;}else if(sc){c.kind='scene';c.solo=0;}else{delete c.kind;c.solo=1;}skySave();skyAll();};
window.skyFx=(id,v,done)=>{const c=LZ_ROSTER.find(x=>x.id===id);if(!c)return;c.fx=v/100;const l=$('skyFxLine');if(l)l.style.left=v+'%';if(done){skySave();skyGrid();}};
window.skyFile=(input,id)=>{const f=input.files&&input.files[0];if(!f)return;const img=new Image();
  img.onload=()=>{const cc=LZ_ROSTER.find(x=>x.id===id);const k=lzIsScene(cc)?Math.min(1,2000/Math.max(img.naturalWidth,img.naturalHeight)):Math.min(1,1000/img.naturalHeight),cv=document.createElement('canvas');cv.width=Math.round(img.naturalWidth*k);cv.height=Math.round(img.naturalHeight*k);
    cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);URL.revokeObjectURL(img.src);
    const c=LZ_ROSTER.find(x=>x.id===id);if(!c)return;const prev=c.src;c.src=cv.toDataURL('image/webp',.85);if(!skySave()){c.src=prev;}skyAll();};
  img.src=URL.createObjectURL(f);};
window.skyAdd=()=>{const id='c'+Date.now().toString(36);LZ_ROSTER.unshift({id,who:id,name:'',series:'',fx:.5,solo:1,on:false,custom:1});skySel=id;skyF='all';skyQv='';$('skyQ').value='';skySave();skyAll();setTimeout(()=>$('skyName')&&$('skyName').focus(),0);};
window.skyDel=id=>{const c=LZ_ROSTER.find(x=>x.id===id);if(!c||!confirm('Delete '+skyName(c)+' from the sky? This cannot be undone.'))return;
  LZ_ROSTER.splice(LZ_ROSTER.indexOf(c),1);(c.layers||[]).forEach(l=>delete LZ_SKY.chars[l.id]);delete LZ_SKY.chars[id];lzSkySave();skySel=null;skySave();skyAll();};
window.skyRestore=()=>{if(!confirm('Put the original 14 characters back? Characters you added will be removed.'))return;LZ_ROSTER.length=0;JSON.parse(JSON.stringify(LZ_ROSTER_DEFAULT)).forEach(c=>LZ_ROSTER.push(c));skySel=null;skySave();skyAll();};
window.skyTuneCal=()=>{goStep('landing');setTimeout(()=>{window.lzSkyEditorOpen&&window.lzSkyEditorOpen();},450);};
window.skyTune=id=>{const c=LZ_ROSTER.find(x=>x.id===id);
  if(c&&c.kind==='daily'){window._lzForceDaily=id;goStep('landing');setTimeout(()=>{lzRenderChars(true);const st=document.getElementById('lzStage');if(st){st.classList.add('lz-daily-preview');setTimeout(()=>{st.classList.remove('lz-daily-preview');window._lzForceDaily=null;},6000);}},450);return;}const sc=lzIsScene(c);if(sc)window._lzForceScene=id;else window._lzForceSolo=id;
  goStep('landing');setTimeout(()=>{lzRenderChars(true);window.lzSkyEditorOpen&&window.lzSkyEditorOpen(sc?'mp':'solo');},450);};

const _origGoAdmin=window.goAdmin;
window.goAdmin=function(){const r=_origGoAdmin.apply(this,arguments);if(typeof isAdmin==='undefined'||isAdmin)window.admGo('home');return r;};
const _origLoad=window.loadAdminData;
window.loadAdminData=async function(){const r=await _origLoad.apply(this,arguments);renderNav();if(cur==='home')loadHome();return r;};

/* ── HOME ───────────────────────────── */
function loadHome(){
  const Q=[['submitted','SUBMITTED','ti-inbox','#F6C98E','adminCountSubmitted'],['reported','REPORTED','ti-alert-triangle','#f87171','adminCountReported'],['suspect','SUSPECT','ti-flag','#fbbf24','adminCountSuspect'],['suggestions','SUGGESTIONS','ti-bulb','#F6A5B8','adminCountSuggestions'],['messages','MESSAGES','ti-mail','#f472b6','adminCountMessages']];
  const tot=Q.reduce((s,x)=>s+num(x[4]),0);
  $('admEyebrow').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'});
  $('admTitle').textContent=tot?tot+(tot===1?' thing is':' things are')+' waiting on you':'All clear';
  $('admDesc').textContent='';
  $('admQueue').innerHTML=Q.map(([k,l,ic,c,id])=>'<button class="adm-qcard" style="--c:'+c+'" onclick="'+(k==='suggestions'||k==='messages'?"admGo('"+k+"')":"adminJump('"+k+"')")+'"><span class="glow"></span><span class="l"><i class="ti '+ic+'"></i>'+l+'</span><span class="n">'+num(id)+'</span></button>').join('');
  homeThin();homeLobbies();homeActivity();
}
function homeThin(){
  const m={};(typeof adminLite!=='undefined'?adminLite:[]).forEach(r=>{if(r.status!=='approved')return;const t=r.topic_value||'General anime';m[t]=(m[t]||0)+1;});
  const rows=Object.entries(m).sort((a,b)=>a[1]-b[1]).slice(0,4);
  $('admThin').innerHTML=rows.length?rows.map(([t,n])=>'<div class="adm-bar" onclick="admGo(\'coverage\')"><span>'+esc(t)+'</span><i><b style="width:'+Math.min(100,n)+'%"></b></i><em>'+n+'</em></div>').join(''):'<div class="adm-empty">Loading…</div>';
}
async function fetchLobbies(limit){
  const {data:lobs,error}=await sb.from('lobbies').select('id,code,lobby_name,host_username,format,mode,status,created_at,is_private').in('status',['waiting','active']).order('created_at',{ascending:false}).limit(limit||60);
  if(error)throw error;
  const ids=(lobs||[]).map(l=>l.id);let pl=[];
  if(ids.length){const {data}=await sb.from('lobby_players').select('lobby_id,user_id,username,is_host,connected,score').in('lobby_id',ids);pl=data||[];}
  const out=(lobs||[]).map(l=>({...l,players:pl.filter(p=>p.lobby_id===l.id)}));
  lv=out.length;renderNav();return out;
}
async function homeLobbies(){
  const el=$('admHomeLobbies');
  try{
    const L=await fetchLobbies(6);
    const n=L.reduce((s,l)=>s+l.players.length,0);
    $('admHomeLobbySum').textContent=L.length?L.length+' room'+(L.length===1?'':'s')+' · '+n+' player'+(n===1?'':'s'):'';
    el.innerHTML=L.length?L.slice(0,6).map(l=>'<div class="adm-lrow"><span class="adm-code">'+esc(l.code)+'</span><div class="m"><b>'+esc(modeName(l.mode))+'</b> <span class="adm-mute">· host '+esc(l.host_username||'?')+'</span><small>'+(l.status==='active'?'In game':'Waiting to start')+' · '+ago(l.created_at)+'</small></div><div class="adm-avs">'+l.players.slice(0,4).map(p=>avHTML(p.username)).join('')+'</div><span style="font:900 12px Nunito,sans-serif;min-width:18px;text-align:right">'+l.players.length+'</span></div>').join(''):'<div class="adm-empty">No open rooms right now.</div>';
  }catch(e){el.innerHTML='<div class="adm-empty">Couldn\'t load lobbies.</div>';}
}
const VERB={UNDID:['#F6C98E','ti-arrow-back-up'],'CLEARED REPORTS':['#fbbf24','ti-flag-off'],APPROVED:['#4ade80','ti-check'],REJECTED:['#f87171','ti-x'],DELETED:['#f87171','ti-trash'],BANNED:['#f87171','ti-ban'],UNBANNED:['#4ade80','ti-circle-check'],RENAMED:['#F6A5B8','ti-pencil'],'RESET PICTURE':['#F6A5B8','ti-photo-off'],'ENDED LOBBY':['#fbbf24','ti-door-exit'],IMPORTED:['#F6C98E','ti-file-upload'],REWROTE:['#F6C98E','ti-replace'],ROMANIZED:['#F6C98E','ti-language'],EDITED:['#EEEFF6','ti-pencil'],'SENT TO REVIEW':['#fbbf24','ti-rotate'],'CHANGED LEVEL':['#EEEFF6','ti-circle-half-2']};
const vc=a=>VERB[a]||['#c3caf0','ti-point'];
async function fetchAudit(limit,cat){
  let q=sb.from('admin_audit').select('*').order('at',{ascending:false}).limit(limit);
  if(cat&&cat!=='all')q=q.eq('category',cat);
  const {data,error}=await q;if(error)throw error;return data||[];
}
async function homeActivity(){
  const el=$('admHomeAct');
  try{
    const R=await fetchAudit(6);
    el.innerHTML=R.length?R.map(r=>{const [c,ic]=vc(r.action);return '<div class="adm-act"><i class="ti '+ic+'" style="color:'+c+'"></i><span><b>'+esc(r.actor===currentUserId?'You':r.actor_name||'Admin')+'</b> '+esc(r.action.toLowerCase())+' '+esc(r.target||'')+'</span><em>'+ago(r.at)+'</em></div>';}).join(''):'<div class="adm-empty">Nothing yet. Actions you take here will show up.</div>';
  }catch(e){el.innerHTML=setupMsg;}
}

/* ── PLAYERS ───────────────────────── */
const pl={q:'',f:'all',rows:[],sel:null,ban:false,t:null};
window.admPlSearch=v=>{pl.q=v.trim();clearTimeout(pl.t);pl.t=setTimeout(loadPlayers,280);};
window.admPlFilter=f=>{pl.f=f;loadPlayers();};
window.admPlPick=id=>{pl.sel=id;pl.ban=false;renderPlayers();};
async function loadPlayers(){
  $('admPlChips').innerHTML=[['all','All'],['registered','Registered'],['guests','Guests'],['banned','Banned']].map(([k,l])=>'<button class="adm-chip'+(pl.f===k?' on':'')+'" onclick="admPlFilter(\''+k+'\')">'+l+'</button>').join('');
  $('admPlRows').innerHTML='<div class="adm-empty" style="padding:18px">Loading…</div>';
  const {data,error}=await sb.rpc('admin_list_players',{p_search:pl.q,p_filter:pl.f,p_limit:150});
  if(error){$('admPlRows').innerHTML='<div style="padding:14px">'+setupMsg+'</div>';$('admPlDetail').innerHTML='';return;}
  pl.rows=data||[];
  if(!pl.rows.find(r=>r.id===pl.sel))pl.sel=pl.rows[0]?.id||null;
  renderPlayers();
}
function status(r){
  if(r.banned_until&&new Date(r.banned_until)>new Date())return ['Banned','#f87171'];
  if(r.kind==='guest')return ['Guest','#fb923c'];
  return [(Date.now()-new Date(r.last_seen||0))<15*60000?'● Online':'Offline',(Date.now()-new Date(r.last_seen||0))<15*60000?'#4ade80':'#c3caf0'];
}
function renderPlayers(){
  const G='grid-template-columns:minmax(0,1.8fr) 1fr 0.7fr 0.8fr 0.8fr';
  $('admPlRows').innerHTML='<div class="adm-tr hd" style="'+G+'"><span>PLAYER</span><span>STATUS</span><span>GAMES</span><span>JOINED</span><span>LAST SEEN</span></div>'+
    (pl.rows.length?pl.rows.map(r=>{const [st,sc]=status(r);return '<div class="adm-tr click'+(r.id===pl.sel?' sel':'')+'" style="'+G+'" onclick="admPlPick(\''+r.id+'\')"><div class="nm">'+avHTML(r.username,r.avatar_url)+'<span>'+esc(r.username)+'</span></div><span style="color:'+sc+'">'+st+'</span><span>'+(r.stats?.total_games??'—')+'</span><span style="color:#c3caf0">'+ago(r.joined)+'</span><span style="color:#c3caf0">'+ago(r.last_seen)+'</span></div>';}).join(''):'<div class="adm-empty" style="padding:18px">No players match.</div>');
  const r=pl.rows.find(x=>x.id===pl.sel),D=$('admPlDetail');
  if(!r){D.innerHTML='';return;}
  const [st,sc]=status(r),s=r.stats||{},acc=s.total_answered?Math.round(100*(s.total_correct||0)/s.total_answered)+'%':'—';
  const banned=r.banned_until&&new Date(r.banned_until)>new Date();
  let h='<div class="adm-card">'+avHTML(r.username,r.avatar_url,'big')+'<h3>'+esc(r.username)+'</h3><div style="font:800 12px Nunito,sans-serif;color:'+sc+'">'+st+(r.kind==='guest'?' · temporary':'')+'</div>'+
    '<div class="adm-stats"><div><b>'+(s.total_games??'—')+'</b><small>GAMES</small></div><div><b>'+acc+'</b><small>CORRECT</small></div><div><b>'+(s.best_score??'—')+'</b><small>BEST</small></div></div></div>';
  h+='<div class="adm-note">Joined '+(r.joined?new Date(r.joined).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'—')+' · last seen '+ago(r.last_seen)+(banned?'<br><b style="color:#fca5a5">Banned until '+new Date(r.banned_until).toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+'</b>'+(r.ban_reason?' · '+esc(r.ban_reason):''):'')+'</div>';
  if(pl.ban){
    h+='<div class="adm-field"><label>BAN FOR</label><select id="admBanLen"><option value="1">24 hours</option><option value="7" selected>7 days</option><option value="30">30 days</option><option value="36500">Forever</option></select></div>'+
       '<div class="adm-field"><label>REASON (SAVED IN THE ACTIVITY LOG)</label><input id="admBanReason" placeholder="e.g. Offensive names in chat"></div>'+
       '<div style="display:flex;gap:7px"><button class="adm-btn" style="flex:1" onclick="admPlBanForm(false)">Cancel</button><button class="adm-btn red" style="flex:1" onclick="admPlBan()"><i class="ti ti-ban"></i> Ban</button></div>';
  }else{
    h+='<div style="display:flex;gap:7px"><button class="adm-btn" style="flex:1" onclick="admPlRename()"><i class="ti ti-pencil"></i> Rename</button>'+(r.kind==='guest'?'':'<button class="adm-btn" style="flex:1" onclick="admPlResetPfp()"><i class="ti ti-photo-off"></i> Reset picture</button>')+'</div>'+
       (r.kind==='guest'?'':banned?'<button class="adm-btn" onclick="admPlUnban()"><i class="ti ti-circle-check"></i> Lift ban</button>':'<button class="adm-btn red" onclick="admPlBanForm(true)"><i class="ti ti-ban"></i> Ban player…</button>');
  }
  D.innerHTML=h;
}
window.admPlBanForm=v=>{pl.ban=v;renderPlayers();};
const rpcAct=(fn,args,msg)=>requireAdminUnlock(async()=>{const {error}=await sb.rpc(fn,args);if(error){alert(error.message);return;}if(typeof showAdminToast==='function')showAdminToast(msg);pl.ban=false;loadPlayers();});
window.admPlRename=()=>{const r=pl.rows.find(x=>x.id===pl.sel);if(!r)return;const n=prompt('New name for '+r.username,r.username);if(!n||n.trim()===r.username)return;rpcAct('admin_rename_player',{p_user:r.id,p_name:n.trim()},'Renamed');};
window.admPlResetPfp=()=>{const r=pl.rows.find(x=>x.id===pl.sel);if(!r||!confirm('Remove '+r.username+'\'s profile picture?'))return;rpcAct('admin_reset_avatar',{p_user:r.id},'Picture reset');};
window.admPlBan=()=>{const r=pl.rows.find(x=>x.id===pl.sel);if(!r)return;const days=+$('admBanLen').value;const until=new Date(Date.now()+days*86400000).toISOString();rpcAct('admin_ban_player',{p_user:r.id,p_until:until,p_reason:$('admBanReason').value.trim()||null},r.username+' banned');};
window.admPlUnban=()=>{const r=pl.rows.find(x=>x.id===pl.sel);if(!r)return;rpcAct('admin_ban_player',{p_user:r.id,p_until:null,p_reason:null},'Ban lifted');};

/* ── LIVE LOBBIES ───────────────────── */
let lbF='all';
window.admLbFilter=f=>{lbF=f;loadLobbies();};
async function loadLobbies(){
  const grid=$('admLbGrid');
  let L;try{L=await fetchLobbies(60);}catch(e){grid.innerHTML='<div class="adm-empty">Couldn\'t load lobbies.</div>';return;}
  const act=L.filter(l=>l.status==='active').length,wait=L.length-act;
  const n=L.reduce((s,l)=>s+l.players.length,0);
  if(cur==='lobbies')$('admDesc').textContent=L.length+' room'+(L.length===1?'':'s')+' · '+n+' player'+(n===1?'':'s')+' · refreshes every 10 seconds';
  $('admLbChips').innerHTML=[['all','All '+L.length],['active','In game '+act],['waiting','Waiting '+wait]].map(([k,l])=>'<button class="adm-chip'+(lbF===k?' on':'')+'" onclick="admLbFilter(\''+k+'\')">'+l+'</button>').join('');
  const S=L.filter(l=>lbF==='all'||l.status===lbF);
  grid.innerHTML=S.length?S.map(l=>{
    const on=l.players.filter(p=>p.connected!==false).length;
    const idle=l.status==='waiting'&&(Date.now()-new Date(l.created_at))>30*60000;
    const [txt,bg,c]=idle?['IDLE '+ago(l.created_at).toUpperCase(),'#fbbf241f','#fbbf24']:l.status==='active'?['IN GAME','#4ade801f','#4ade80']:['WAITING','#F6C98E1f','#F6C98E'];
    return '<div class="adm-lcard" style="--c:'+c+'"><span class="glow"></span>'+
      '<div style="display:flex;align-items:center;gap:10px"><span class="code">'+esc(l.code)+'</span>'+(l.is_private?'<i class="ti ti-lock" style="color:#c3caf0" title="Private"></i>':'')+'<span class="adm-pill" style="margin-left:auto;background:'+bg+';color:'+c+'">'+txt+'</span></div>'+
      '<div><h4>'+esc(l.lobby_name||modeName(l.mode))+'</h4><div class="sub">'+esc(modeName(l.mode))+' · host '+esc(l.host_username||'?')+' · opened '+ago(l.created_at)+' ago</div></div>'+
      '<div class="adm-names">'+(l.players.length?l.players.map(p=>'<span class="'+(p.is_host?'h':'')+(p.connected===false?' off':'')+'">'+(p.is_host?'👑 ':'')+esc(p.username)+(l.status==='active'&&p.score!=null?' · '+p.score:'')+'</span>').join(''):'<span class="off">Nobody here</span>')+'</div>'+
      '<div style="display:flex;align-items:center;gap:8px"><span class="adm-mute">'+on+' connected</span><button class="adm-btn ghost-red" style="margin-left:auto" onclick="admLbEnd(\''+l.id+'\',\''+esc(l.code)+'\')"><i class="ti ti-door-exit"></i> End room</button></div></div>';
  }).join(''):'<div class="adm-empty">No rooms here.</div>';
}
window.admLbEnd=(id,code)=>{if(!confirm('End room '+code+'? Everyone in it is sent back to the lobby list.'))return;requireAdminUnlock(async()=>{const {error}=await sb.rpc('admin_end_lobby',{p_lobby:id});if(error){alert(error.message.includes('function')?'Run supabase/admin-setup.sql first.':error.message);return;}if(typeof showAdminToast==='function')showAdminToast('Room '+code+' ended');loadLobbies();});};

/* ── ACTIVITY LOG ───────────────────── */
let auF='all';
window.admAuFilter=f=>{auF=f;loadAudit();};
async function loadAudit(){
  $('admAuChips').innerHTML=[['all','All'],['questions','Questions'],['players','Players'],['lobbies','Lobbies'],['imports','Imports'],['content','Site copy']].map(([k,l])=>'<button class="adm-chip'+(auF===k?' on':'')+'" onclick="admAuFilter(\''+k+'\')">'+l+'</button>').join('');
  const el=$('admAuRows');el.innerHTML='<div class="adm-empty" style="padding:18px">Loading…</div>';
  let R;try{R=await fetchAudit(300,auF);}catch(e){el.innerHTML='<div style="padding:14px">'+setupMsg+'</div>';return;}
  if(!R.length){el.innerHTML='<div class="adm-empty" style="padding:18px">Nothing logged yet.</div>';return;}
  const G='grid-template-columns:64px 150px 150px minmax(0,1fr) 80px';
  let day='',h='';
  R.forEach(r=>{
    const d=new Date(r.at),k=d.toDateString();
    if(k!==day){day=k;const t=new Date().toDateString(),y=new Date(Date.now()-86400000).toDateString();h+='<div class="adm-day">'+(k===t?'TODAY':k===y?'YESTERDAY':d.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}).toUpperCase())+'</div>';}
    const [c]=vc(r.action),who=r.actor===currentUserId?'You':r.actor_name||'Admin';
    h+='<div class="adm-tr" style="'+G+'"><span style="color:#a3abdf;font:700 12px ui-monospace,Menlo,monospace">'+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})+'</span><div class="nm">'+avHTML(who)+'<span>'+esc(who)+'</span></div><span class="adm-verb" style="background:'+c+'1f;color:'+c+'">'+esc(r.action)+'</span><span style="color:#d6dbf5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.target||'')+(r.details?' <span style="color:#a3abdf">· '+esc(r.details)+'</span>':'')+'</span>'+(r.undone_at?'<span style="justify-self:end;font:800 11px Nunito,sans-serif;color:#a3abdf">undone</span>':r.undo?'<button class="adm-link" style="justify-self:end;margin:0;font-weight:900;letter-spacing:.06em" onclick="admUndo('+r.id+')">UNDO</button>':'<span></span>')+'</div>';
  });
  el.innerHTML=h;
}

window.admUndo=id=>{if(!confirm('Undo this action?'))return;_rau(async()=>{const {error}=await sb.rpc('admin_undo',{p_id:id});if(error){alert(/function/.test(error.message)?'Run supabase/admin-setup-2.sql first.':error.message);return;}if(typeof showAdminToast==='function')showAdminToast('Undone');loadAudit();try{loadAdminData(true);}catch(e){}});};
/* ── Log existing admin actions ─────────
   Gated actions call requireAdminUnlock(cb) synchronously; the pending entry is written
   when cb actually runs (so a cancelled PIN prompt logs nothing). */
let pending=null;
const log=(e,undo)=>{try{sb.rpc('admin_log',{p_action:e[0],p_target:e[1]||null,p_details:e[2]||null,p_category:e[3]||'other',p_undo:undo||null}).then(()=>{if(cur==='home')homeActivity();if(cur==='audit')loadAudit();});}catch(x){}};
const _rau=window.requireAdminUnlock;
window.requireAdminUnlock=function(cb){const p=pending;pending=null;return _rau(p?async(...a)=>{let undo=null;try{if(p.snap)undo=await p.snap();}catch(x){}const r=await cb(...a);log(p.e,undo);return r;}:cb);};
const snapField=(ids,field)=>async()=>{const {data}=await sb.from('questions').select('id,'+field).in('id',ids);return data&&data.length?{kind:'field_rows',field,rows:data.map(x=>({id:String(x.id),v:x[field]}))}:null;};
const snapRows=ids=>async()=>{const {data}=await sb.from('questions').select('*').in('id',ids);return data&&data.length?{kind:'restore_rows',rows:data}:null;};
const bulkIds=()=>{try{return [..._bulkIds];}catch(e){return [];}};
const bulkN=()=>{try{return _bulkIds.size;}catch(e){return 0;}};
const qTarget=id=>{try{const q=(adminLite||[]).find(x=>String(x.id)===String(id));return q?'"'+String(q.question).slice(0,70)+'"':'question #'+id;}catch(e){return 'question #'+id;}};
const WRAP={
  adminApprove:id=>({e:['APPROVED',qTarget(id),null,'questions'],snap:snapField([id],'status')}),
  adminSendToReview:id=>({e:['SENT TO REVIEW',qTarget(id),null,'questions'],snap:snapField([id],'status')}),
  adminDelete:id=>({e:['DELETED',qTarget(id),null,'questions'],snap:snapRows([id])}),
  adminDismiss:id=>({e:['CLEARED REPORTS',qTarget(id),null,'questions']}),
  bulkApprove:()=>{const ids=bulkIds();return {e:['APPROVED',ids.length+' questions',null,'questions'],snap:snapField(ids,'status')};},
  bulkSendToReview:()=>{const ids=bulkIds();return {e:['SENT TO REVIEW',ids.length+' questions',null,'questions'],snap:snapField(ids,'status')};},
  bulkDelete:()=>{const ids=bulkIds();return {e:['DELETED',ids.length+' questions',null,'questions'],snap:snapRows(ids)};},
  bulkDiff:d=>{const ids=bulkIds();return {e:['CHANGED LEVEL',ids.length+' questions','to '+d,'questions'],snap:snapField(ids,'difficulty')};},
  adminImportConfirm:()=>{let n=0;try{n=_importParsed.length;}catch(e){}return {e:['IMPORTED',n+' questions',null,'imports']};},
  adminRewriteConfirm:()=>{let n=0;try{n=_rewriteParsed.filter(r=>!r.collision).length;}catch(e){}return {e:['REWROTE',n+' questions',null,'imports']};},
  confirmRomanize:()=>{let n=0;try{n=_romanizeCandidates.filter(r=>r.selected).length;}catch(e){}return {e:['ROMANIZED',n+' names',null,'content']};}
};
Object.entries(WRAP).forEach(([fn,mk])=>{
  const f=window[fn];if(typeof f!=='function')return;
  window[fn]=function(...a){pending=mk(...a);const r=f.apply(this,a);if(pending){const p=pending;pending=null;Promise.resolve(r).then(()=>log(p.e));}return r;};
});


/* ── keep sidebar in sync ───────────── */
function boot(){
  renderNav();renderLock();
  ['adminCountSubmitted','adminCountReported','adminCountSuspect','adminCountSuggestions','adminCountMessages'].forEach(id=>{const el=$(id);if(el)new MutationObserver(()=>{clearTimeout(boot.t);boot.t=setTimeout(()=>{renderNav();if(cur==='home'&&$('page-admin')?.classList.contains('active'))loadHome();},400);}).observe(el,{childList:true,characterData:true,subtree:true});});
  setInterval(()=>{if($('page-admin')?.classList.contains('active'))renderLock();},1000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

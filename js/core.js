// Shared state, theme, site text (moved out of index.html 2026-11-19; loads in its original place, order matters)
const PROFILE_PAIRS=[['moonlight','Moonlight','#96C7FF','#b8a9ff'],['emerald-sapphire','Emerald & Sapphire','#3b82f6','#34d399'],['ethereal','Ethereal','#a78bfa','#f472b6'],['honey-violet','Honey & Violet','#fcd34d','#a78bfa'],['sakura-night','Sakura Night','#f9a8d4','#7dd3fc'],['ember','Ember','#fb923c','#f43f5e'],['peach-fizz','Peach Fizz','#fed7aa','#f9a8d4'],['teal-plum','Teal & Plum','#2dd4bf','#a855f7'],['nebula','Nebula','#c4b5fd','#fca5a5'],['cotton-candy','Cotton Candy','#fbcfe8','#bfdbfe'],['dusk','Dusk','#93c5fd','#fdba74'],['aurora','Aurora','#86efac','#22d3ee'],['amethyst-gold','Amethyst & Gold','#a855f7','#fbbf24'],['ruby-rose-gold','Ruby & Rose Gold','#fdba74','#f43f5e']];
let profileColorKey='auto';try{profileColorKey=localStorage.getItem('as_pf_color')||'auto';}catch(e){}
function pfPair(k){return PROFILE_PAIRS.find(p=>p[0]===k)||null;}
function pfPairByLead(hex){if(!hex)return null;const h=String(hex).toLowerCase();return PROFILE_PAIRS.find(p=>p[2].toLowerCase()===h)||null;}
function pfPairLead(){const p=pfPair(profileColorKey);return p?p[2]:'#96c8ff';} // '#96c8ff' = no pair picked (looks like Moonlight, but isn't matched as one)
let isDark=true,currentColor='midnight',currentUser=null,currentUserId=null,isGuest=false,currentEmail=null,guestSessionId=null;
currentColor='meadow';isDark=true;
let selectedFormat='mc',selectedMode='race';
let selectedDifficulty='easy';
let score=0,lives=3,qIndex=0,timerInterval=null,timeLeft=20,answered=false;
// Mirrors lobbies.current_q_index in Supabase for RPC-driven multiplayer modes
// (Race/Classic/Survival, non-char-mc). Kept separate from qIndex — which stays
// purely local round bookkeeping for UI/history/caps — because mpDbQIndex is
// NEVER incremented locally; it's only ever set from an mp_advance_question or
// mp_submit_answer response, so it's always exactly what the server says,
// regardless of when/how qIndex gets bumped by the various trigger call sites.
let mpDbQIndex=0;
// The DB question index this client is currently showing (Race/Classic/Survival). Lets the
// question broadcast handler skip its own echo and anything stale, while still accepting a
// newer question from whichever client won the advance race, host or not.
let mpShownDbQIndex=0;
// Tracks which qIndex `answered` actually applies to. Needed because a mid-game
// rejoin re-renders the live question via mpShowQuestion(), which unconditionally
// resets answered=false — without this, a player who already answered correctly
// before disconnecting could answer the same question again on rejoin and be
// credited twice. See the game_state_snapshot handler for how this is used.
let answeredQIndex=-1;
let raceTimeLimit=20,pendingMode='race',questionStartTime=0,lastPtsEarned=0,pendingLobbyAfterTimeLimit=false;
let selectedQuestionLimit=10;
let soloRaceTarget=1000; // solo Score Race target score (50/75/100/150/custom)
let quizHistory=[],currentQData=null,prefetchedQuestion=null;
// Holds the in-flight Promise from an early mp_advance_question call, not just its
// resolved value — so mpHostFetchAndBroadcast can `await` it whether it's already
// resolved or still pending, rather than risking a second RPC call racing the first
// (the RPC is a real mutation, unlike fetchQuestion(), so it can't just be re-fired
// as a harmless fallback the way prefetchedQuestion's read-only pick can).
let prefetchedRpcPromise=null;
// Separately tracks the RESOLVED {data,error} once the prefetch actually completes,
// checked synchronously (no await) before ever touching prefetchedRpcPromise. This
// matters because `await` always yields to the browser at least once even on an
// already-resolved promise — unlike prefetchedQuestion's `||` short-circuit, which
// skips awaiting entirely when ready — so relying on `await prefetchedRpcPromise`
// alone would flash the loading spinner on every question, not just slow ones.
let prefetchedRpcResult=null;
let reportedQuestionIds=new Set(); // tracks IDs flagged in-game or via recap
// Hot Potato per-player round history — one entry per round, tagged with whichever
// player was actively holding the potato that round. Kept separate from quizHistory
// (which only reflects the local client's own answers) so the end-game recap can be
// filtered per player instead of showing every spectated round as a false "miss".
let hpHistory=[],mpRecapPlayer=null; // mpRecapPlayer: which player's turns the recap is currently showing
// Browsers throttle setInterval/setTimeout heavily on background tabs (Chrome can drop
// to ~1 fire/min), so a client that's tabbed out can silently miss a countdown hitting
// zero. Two places in MP depend on a countdown completing on the HOST's specific client
// to broadcast the next step — the question fuse (mpTimeOut) and the 5s "wrapping up"
// pause after every round (mpStartAutoNext's onDone) — so if the host is the one tabbed
// out, either one can freeze the game until they refocus. A dedicated Worker's timers
// aren't subject to that same throttling, so mpScheduleBackup() below is used purely as
// a reliable backup trigger alongside the existing setInterval/setTimeout paths, which
// still fire first in the normal (focused-tab) case.
let mpFuseToken=0,mpFusePending={},mpFuseWorker=null;
try{
  const _mpFuseWorkerSrc=`let t={};self.onmessage=function(e){const{id,ms}=e.data;if(t[id])clearTimeout(t[id]);t[id]=setTimeout(()=>{self.postMessage({id});delete t[id];},ms);};`;
  mpFuseWorker=new Worker(URL.createObjectURL(new Blob([_mpFuseWorkerSrc],{type:'application/javascript'})));
  mpFuseWorker.onmessage=(e)=>{
    const cb=mpFusePending[e.data.id];
    if(cb){delete mpFusePending[e.data.id];cb();}
  };
}catch(err){console.warn('mpFuseWorker unavailable, falling back to setInterval/setTimeout only',err);}
// Schedules cb to fire after ms via the backup Worker (no-op if the Worker failed to
// construct, e.g. in a sandboxed preview). Returns a token so the caller can cancel via
// mpCancelBackup if the round resolves before the backup would otherwise fire.
function mpScheduleBackup(ms,cb){
  if(!mpFuseWorker)return null;
  const id=++mpFuseToken;
  mpFusePending[id]=cb;
  mpFuseWorker.postMessage({id,ms});
  return id;
}
function mpCancelBackup(id){
  if(id!=null)delete mpFusePending[id];
}
let mpActiveFuseBackupId=null; // token for the currently-scheduled fuse backup, so it can be cancelled the instant a round resolves
let mpActiveAutoNextBackupId=null; // same idea, for the 5s "wrapping up" pause between rounds (see mpStartAutoNext)
let totalGames=0,bestScore=0,totalCorrect=0,totalAnswered=0,currentStreak=0,perfectGames=0;
let allHistory=[];

const accentHex={meadow:'#F6C98E',midnight:'#a78bfa',blossom:'#f472b6',abyss:'#38bdf8',inferno:'#fb923c',jade:'#4ade80',arcane:'#e879f9',obsidian:'#96C7FF'};
const g1=accentHex;
const g2={meadow:'#27306c',midnight:'#7c5cbf',blossom:'#be185d',abyss:'#1d4ed8',inferno:'#c2410c',jade:'#166534',arcane:'#9d174d',obsidian:'#2C2E3C'};
const colorNames={meadow:'Meadow night',midnight:'Ethereal',blossom:'Blossom',abyss:'Abyss',inferno:'Inferno',jade:'Jade',arcane:'Arcane',obsidian:'Moonlight'};
const fmtLabels={mc:'Multiple Choice',type:'Type the Answer',scene:'Guess the Scene',char:'Name the Character','char-mc':'Name the Character (MC)'};
const fmtIcons={mc:'ti-list',type:'ti-keyboard',scene:'ti-photo',char:'ti-user-circle'};
// Fallback prompt shown for "Guess the Scene" rows that don't carry their own
// question text (scene rows are expected to store this directly, but this
// covers any row uploaded without it).
const SCENE_DEFAULT_QUESTION='Which anime is this scene from?';

// ── SITE CONTENT (admin-editable cards) ────────────────────────
// Registry of every format/mode card the admin panel can edit. `title`/`desc`
// here are the fallback values used until (or unless) an override is loaded
// from Supabase. `group` is just for organizing the admin editor UI.
const CARD_REGISTRY=[
  {key:'fmt_mc',type:'fmt',id:'mc',group:'Format',title:'Multiple Choice',desc:'Four options, one correct answer. Pick wisely.',locked:false},
  {key:'fmt_type',type:'fmt',id:'type',group:'Format',title:'Type the Answer',desc:'No hints. Spell it out. True otaku mode.',locked:false},
  {key:'fmt_scene',type:'fmt',id:'scene',group:'Format',title:'Guess the Scene',desc:'Guess the anime from a single screenshot.',locked:false},
  {key:'fmt_char',type:'fmt',id:'char',group:'Format',title:'Name the Character',desc:'Can you name who\'s on screen? Prove it.',locked:false},
  {key:'mode_classic',type:'mode',id:'classic',group:'Mode',title:'Classic',desc:'Answer questions, 1 point each. No pressure, just how many can you get right?',locked:false},
  {key:'mode_race',type:'mode',id:'race',group:'Mode',title:'Score Race',desc:'Answer correctly to earn points. Race to the target score as fast as you can.',locked:false},
  {key:'mode_survival',type:'mode',id:'survival',group:'Mode',title:'Survival',desc:'You have 3 lives. Each wrong answer costs one. Survive as long as you can.',locked:false},
  {key:'mode_potato',type:'mode',id:'potato',group:'Mode (multiplayer only)',title:'Hot Potato',desc:'Pass it or lose a life',locked:false},
  {key:'mode_slowreveal',type:'mode',id:'slowreveal',group:'Mode (multiplayer only)',title:'Slow Reveal',desc:'Buzz in to answer',locked:false},
];
let siteCardConfig={}; // populated from Supabase; keyed by CARD_REGISTRY[].key -> {title,desc,locked}
function getCardConfig(key){
  const def=CARD_REGISTRY.find(c=>c.key===key);
  return {...def,...(siteCardConfig[key]||{})};
}
function isCardLocked(type,id){
  const reg=CARD_REGISTRY.find(c=>c.type===type&&c.id===id);
  return reg?getCardConfig(reg.key).locked===true:false;
}

// ── SITE CONTENT (admin-editable static copy) ──────────────────
// Registry of purely informational, static text blocks the admin panel can
// edit — landing hero copy, footer, How to Play / rules modal blurbs, and
// pure-copy empty states. Deliberately excludes anything functional: button
// labels, error/toast messages, and any string with a dynamic value (scores,
// counts, usernames) baked in — those carry real logic risk if edited freely
// and aren't worth the admin-editable surface area.
const TEXT_REGISTRY=[
  {key:'landing_headline',group:'Landing Page',label:'Hero headline',default:'Anime Sekai',multiline:false},
  {key:'landing_subhead',group:'Landing Page',label:'Hero subheadline',default:'Name the character, guess the anime, climb the ranks, solo or against your friends.',multiline:true},
  {key:'landing_tagline',group:'Landing Page',label:'Hero tagline',default:'Jump in free, no sign-up needed! 🎮',multiline:false},
  {key:'footer_brand',group:'Footer',label:'Footer brand text',default:'Anime Sekai',multiline:false},
  {key:'landing_hero_line',group:'Landing Page',label:'Hero line (under wordmark)',default:"Name the character, guess the anime, climb the ranks.",multiline:false},
  {key:'landing_globe_label',group:'Landing Page',label:'Globe label',default:"ENTER THE WORLD",multiline:false},
  {key:'landing_solo_eyebrow',group:'Landing — Solo',label:'Eyebrow',default:"ひとりで · ONE PLAYER",multiline:false},
  {key:'landing_solo_title',group:'Landing — Solo',label:'Title',default:"Solo Play",multiline:false},
  {key:'landing_solo_kana',group:'Landing — Solo',label:'Title kana',default:"ソロプレイ",multiline:false},
  {key:'landing_solo_desc',group:'Landing — Solo',label:'Description',default:"Just you against the questions. See how far you get.",multiline:true},
  {key:'landing_solo_cta',group:'Landing — Solo',label:'Call to action',default:"PLAY SOLO",multiline:false},
  {key:'landing_solo_meta',group:'Landing — Solo',label:'Meta line',default:"104 topics · 5 modes",multiline:false},
  {key:'landing_mp_eyebrow',group:'Landing — Multiplayer',label:'Eyebrow',default:"みんなで · UP TO 12",multiline:false},
  {key:'landing_mp_title',group:'Landing — Multiplayer',label:'Title',default:"Multiplayer",multiline:false},
  {key:'landing_mp_kana',group:'Landing — Multiplayer',label:'Title kana',default:"マルチプレイ",multiline:false},
  {key:'landing_mp_desc',group:'Landing — Multiplayer',label:'Description',default:"Make a lobby, share the code, settle it live.",multiline:true},
  {key:'landing_mp_cta',group:'Landing — Multiplayer',label:'Call to action',default:"FIND A GAME",multiline:false},
  {key:'landing_mp_meta',group:'Landing — Multiplayer',label:'Meta line',default:"63 online · 12 lobbies open",multiline:false},
  {key:'landing_daily_title',group:'Landing — Daily',label:'Title',default:"Daily Quiz",multiline:false},
  {key:'landing_daily_kana',group:'Landing — Daily',label:'Title kana',default:"デイリークイズ",multiline:false},
  {key:'landing_daily_desc',group:'Landing — Daily',label:'Description',default:"8 questions, the same set for everyone. One tap, no setup.",multiline:true},
  {key:'landing_daily_cta',group:'Landing — Daily',label:'Call to action',default:"PLAY TODAY'S",multiline:false},
  {key:'landing_daily_meta',group:'Landing — Daily',label:'Meta line',default:"4,812 played today",multiline:false},
  {key:'nav_howtoplay',group:'Menu Band',label:'How to play',default:"HOW TO PLAY",multiline:false},
  {key:'nav_leaderboard',group:'Menu Band',label:'Leaderboard',default:"LEADERBOARD",multiline:false},
  {key:'nav_profile',group:'Menu Band',label:'Profile',default:"PROFILE",multiline:false},
  {key:'nav_sound',group:'Menu Band',label:'Sound',default:"SOUND",multiline:false},
  {key:'nav_theme',group:'Menu Band',label:'Theme',default:"THEME",multiline:false},
  {key:'nav_signin',group:'Menu Band',label:'Sign in',default:"SIGN IN",multiline:false},
  {key:'world_back',group:'The World',label:'Back out',default:"BACK OUT",multiline:false},
  {key:'world_title',group:'The World',label:'Headline',default:"Welcome to the world",multiline:false},
  {key:'world_col1_title',group:'The World — Column 1',label:'Title',default:"Guess it from a still, a face, or a line",multiline:false},
  {key:'world_col1_lead',group:'The World — Column 1',label:'Body',default:"Questions come from 104 series — or the general pool for everything at once.",multiline:true},
  {key:'world_col1_item1',group:'The World — Column 1',label:'Detail 1',default:"scene stills",multiline:false},
  {key:'world_col1_item2',group:'The World — Column 1',label:'Detail 2',default:"character crops",multiline:false},
  {key:'world_col2_title',group:'The World — Column 2',label:'Title',default:"Alone, against friends, or with everyone",multiline:false},
  {key:'world_col2_lead',group:'The World — Column 2',label:'Body',default:"Same questions, different pressure — plus one daily set the whole site plays.",multiline:true},
  {key:'world_col2_item1',group:'The World — Column 2',label:'Detail 1',default:"solo · 5 modes",multiline:false},
  {key:'world_col2_item2',group:'The World — Column 2',label:'Detail 2',default:"private lobbies",multiline:false},
  {key:'world_col3_title',group:'The World — Column 3',label:'Title',default:"You set the shape of the game",multiline:false},
  {key:'world_col3_lead',group:'The World — Column 3',label:'Body',default:"Topics, length, time per question, and how you answer.",multiline:true},
  {key:'world_col3_item1',group:'The World — Column 3',label:'Detail 1',default:"pick your topics",multiline:false},
  {key:'world_col3_item2',group:'The World — Column 3',label:'Detail 2',default:"choose or type",multiline:false},
  {key:'world_cta',group:'The World',label:'Start button',default:"START PLAYING",multiline:false},
  {key:'world_cta_note',group:'The World',label:'Note under start',default:"everything above is set again on the screen before each game",multiline:true},
  {key:'world_link_about',group:'The World — Links',label:'About',default:"ABOUT",multiline:false},
  {key:'world_link_contact',group:'The World — Links',label:'Contact',default:"CONTACT",multiline:false},
  {key:'world_link_suggest',group:'The World — Links',label:'Suggest a topic',default:"SUGGEST A TOPIC",multiline:false},
  {key:'world_link_privacy',group:'The World — Links',label:'Privacy',default:"PRIVACY",multiline:false},
  {key:'htp_fmt_mc',group:'How to Play — Format',label:'Multiple Choice',default:'Players are shown a question with four answer options. Pick the correct one before the timer runs out.',multiline:true},
  {key:'htp_fmt_type',group:'How to Play — Format',label:'Type the Answer',default:'No options are shown. You must type the correct answer from memory. Partial matches and common aliases are accepted.',multiline:true},
  {key:'htp_fmt_scene',group:'How to Play — Format',label:'Guess the Scene',default:'A screenshot from an anime is shown. Type which series it\'s from before time runs out.',multiline:true},
  {key:'htp_fmt_char',group:'How to Play — Format',label:'Name the Character',default:'A character description or image is shown. Name the character correctly to score points.',multiline:true},
  {key:'htp_mode_classic',group:'How to Play — Mode',label:'Classic',default:'Answer at your own pace — every correct answer is worth a flat 10 points, no speed bonus. There are no lives to lose and no target to race to. The game simply runs through the set number of questions, and whoever has the most points at the end wins.',multiline:true},
  {key:'htp_mode_race',group:'How to Play — Mode',label:'Score Race',default:'A right answer is worth 50 pts, plus up to 50 more for speed: the more time left on the clock, the more you get. Answer instantly for 100, at the buzzer for 50. First to the target score wins.',multiline:true},
  {key:'htp_mode_survival',group:'How to Play — Mode',label:'Survival',default:'You start with 3 lives. Every wrong answer costs one life. Answer correctly to keep going. Lose all 3 and you\'re out. Last one standing wins.',multiline:true},
  {key:'htp_mode_potato',group:'How to Play — Mode',label:'Hot Potato',default:'A fuse counts down on a random player. Answer correctly to pass it to someone else. Answer wrong and you explode. Last player alive wins.',multiline:true},
  {key:'htp_mode_slowreveal',group:'How to Play — Mode',label:'Slow Reveal',default:'The question fades in word by word. Hit Buzz In when you think you know the answer. The reveal freezes and you have 5 seconds to type it. Get it right and earn a point. Get it wrong and you\'re locked out for that round. First to the target score wins.',multiline:true},
  {key:'htp_topic_general',group:'How to Play — Mode',label:'"General Anime" topic blurb',default:'General Anime: questions from across the entire anime universe.',multiline:true},
  {key:'solo_rules_classic',group:'Solo Mode Rules Popup',label:'Classic',default:'Every correct answer is worth exactly 1 point, no matter how fast you answer. There\'s no pressure and no penalty for taking your time. The game ends after the set number of questions, and your final score is just how many you got right.',multiline:true},
  {key:'solo_rules_race',group:'Solo Mode Rules Popup',label:'Score Race',default:'A right answer is worth 50 points, plus up to 50 more for speed: the more time left on the clock, the more you get. Answer instantly for 100, at the buzzer for 50. The game ends as soon as you reach the target score.',multiline:true},
  {key:'solo_rules_survival',group:'Solo Mode Rules Popup',label:'Survival',default:'You start with 3 lives. Every wrong answer or timeout costs one life. Answer correctly to keep going. Lose all 3 lives and the run ends. See how many questions you can survive.',multiline:true},
  {key:'voiding_info_body',group:'Info Popups',label:'Question Voiding explainer',default:'If a question seems wrong, players can flag it. Enough flags and the round gets skipped with no points lost.',multiline:true},
  {key:'lb_empty',group:'Empty States',label:'Leaderboard — no scores yet',default:'No scores yet. Be the first!',multiline:false},
  {key:'lobby_browse_empty_title',group:'Empty States',label:'Lobby browser — no open lobbies (title)',default:'😴 No open lobbies right now.',multiline:false},
  {key:'lobby_browse_empty_sub',group:'Empty States',label:'Lobby browser — no open lobbies (subtext)',default:'Create one and share the code with friends!',multiline:false},
  {key:'scene_hint_solo',group:'Game Settings',label:'Guess the Scene hint (solo game settings)',default:'Pulling from General Anime. Every anime has at least 25 screenshots to guess from.',multiline:true},
  {key:'scene_hint_lobby',group:'Game Settings',label:'Guess the Scene hint (multiplayer topic lock)',default:'Guess the Scene always plays General Anime. Every anime has at least 25 screenshots in the pool.',multiline:true},
];
let siteTextConfig={}; // populated from Supabase; keyed by TEXT_REGISTRY[].key -> string override
function getSiteText(key){
  const reg=TEXT_REGISTRY.find(t=>t.key===key);
  const val=siteTextConfig[key];
  return (val!==undefined&&val!==null&&val!=='')?val:(reg?reg.default:'');
}
// Patches textContent onto every static element tagged data-copy-key="...",
// plus the landing headline (handled separately so its two-tone accent word
// survives an override). Safe to call anytime — it only ever sets textContent,
// never innerHTML, so admin-entered copy can't inject markup.
function applySiteTextOverrides(){
  document.querySelectorAll('[data-copy-key]').forEach(el=>{
    el.textContent=getSiteText(el.getAttribute('data-copy-key'));
  });
  applyLandingHeadline();
}
function applyLandingHeadline(){
  const el=document.getElementById('entryTitleEl');
  if(!el)return;
  const words=getSiteText('landing_headline').trim().split(/\s+/).filter(Boolean);
  el.textContent='';
  if(!words.length)return;
  const last=words.pop();
  if(words.length)el.appendChild(document.createTextNode(words.join(' ')+' '));
  const span=document.createElement('span');
  span.textContent=last;
  el.appendChild(span);
}
async function loadSiteConfig(){
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/site_config?select=key,value&key=in.(cards,copy)`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}});
    const rows=res.ok?await res.json():[];
    siteCardConfig=(rows.find(r=>r.key==='cards')||{}).value||{};
    siteTextConfig=(rows.find(r=>r.key==='copy')||{}).value||{};
  }catch(e){ siteCardConfig={}; siteTextConfig={}; }
  applySiteCardOverrides();
  applySiteTextOverrides();
}
// Patches title/desc/locked state onto every rendered copy of a card (solo
// pages use [data-fmt]/[data-mode] on .fmt-card/.mode-card; the multiplayer
// lobby setup uses the same attributes on .gs-bigcard). Safe to call anytime,
// including after the lobby re-renders its grids.
function applySiteCardOverrides(){
  CARD_REGISTRY.forEach(reg=>{
    const cfg=getCardConfig(reg.key);
    const sel=reg.type==='fmt'?`[data-fmt="${reg.id}"]`:`[data-mode="${reg.id}"]`;
    document.querySelectorAll(sel).forEach(el=>{
      const titleEl=el.querySelector('.fmt-card-title,.mode-title,.gs-bc-title');
      const descEl=el.querySelector('.fmt-card-desc,.mode-desc,.gs-bc-desc');
      if(titleEl)titleEl.textContent=cfg.title;
      if(descEl)descEl.textContent=cfg.locked?'🔒 Coming soon':cfg.desc;
      el.classList.toggle('locked',!!cfg.locked);
    });
  });
  // Re-sync the lobby grid's own per-format compatibility locks (Slow Reveal/
  // Hot Potato depend on the chosen answer format) on top of admin overrides.
  if(typeof gsSyncUI==='function'&&document.getElementById('gsModeGrid'))gsSyncUI();
}
// Click dispatchers used by the solo Format/Mode cards — check the admin lock
// before doing anything (the .locked class also blocks clicks via CSS
// pointer-events, but this guards any programmatic/keyboard-triggered calls).
function fmtCardClick(fmt){
  if(isCardLocked('fmt',fmt))return;
  if(fmt==='char'){openCharFmtModal('solo');return;}
  selectFormat(fmt);
}
function modeCardClick(mode){
  if(isCardLocked('mode',mode))return;
  selectSoloMode(mode);
}
const keys=['A','B','C','D'];

function computeBadges(){
  const formatsPlayed=new Set(allHistory.map(h=>h.fmt));
  return [
    {emoji:'🎯',name:'First Strike',desc:'Complete your first quiz',unlocked:totalGames>=1},
    {emoji:'🔥',name:'On Fire',desc:'Score 80+ pts in one game',unlocked:bestScore>=80},
    {emoji:'💯',name:'Perfect',desc:'Score 100 pts',unlocked:bestScore>=100},
    {emoji:'⚡',name:'Speed Demon',desc:'Answer in under 5s 10 times',unlocked:false},
    {emoji:'❤️',name:'Survivor',desc:'Finish Survival with all 3 lives',unlocked:allHistory.some(h=>h.mode==='Survival'&&h.livesLeft===3)},
    {emoji:'📚',name:'Scholar',desc:'Play 20+ games',unlocked:totalGames>=20},
    {emoji:'🗾',name:'Otaku',desc:'Reach True Otaku rank',unlocked:bestScore>=90},
    {emoji:'🎭',name:'Versatile',desc:'Play all 4 formats',unlocked:formatsPlayed.size>=4},
  ];
}

function applyTheme(){
  const fy=document.getElementById('footerYear');if(fy)fy.textContent=new Date().getFullYear();
  const b=document.documentElement;
  currentColor='meadow';isDark=true;
  b.removeAttribute('data-theme');b.removeAttribute('data-color');
  if(isDark){if(currentColor!=='midnight'){b.setAttribute('data-theme','dark');b.setAttribute('data-color',currentColor)}}
  else{b.setAttribute('data-theme','light');if(currentColor!=='midnight')b.setAttribute('data-color',currentColor)}
  try{localStorage.setItem('as_theme',JSON.stringify({color:currentColor,dark:isDark}));}catch(e){}
  document.getElementById('modeToggle')?.classList.toggle('on',!isDark);
  const modeTogDrawer=document.getElementById('modeToggleDrawer');
  if(modeTogDrawer)modeTogDrawer.classList.toggle('on',!isDark);
  const cdot=document.getElementById('cdot');if(cdot)cdot.style.background=`linear-gradient(135deg,${g1[currentColor]},${g2[currentColor]})`;
  const tl=document.getElementById('tlabel');if(tl)tl.textContent=colorNames[currentColor];
  const light=!isDark;
  const lm=document.getElementById('logoMark');if(lm)lm.style.color='';
  const em=document.getElementById('entryLogoMark');if(em)em.style.color='';
  ['guestSubmitBtn','signinSubmitBtn','regSubmitBtn','nextBtn','playAgainBtn','profileCtaBtn'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.color=light?'#fff':'';
  });
  document.querySelectorAll('.type-submit,.form-submit').forEach(el=>el.style.color=light?'#fff':'');
  if(typeof updateSoundUI==='function')updateSoundUI();
}
function toggleMode(){isDark=!isDark;applyTheme()}
function setColor(c,h,n,el){currentColor=c;document.querySelectorAll('.drop-row').forEach(r=>r.classList.remove('active'));if(el)el.classList.add('active');applyTheme();closeDrop()}
function toggleDrop(){document.getElementById('drop').classList.toggle('open')}
function closeDrop(){document.getElementById('drop').classList.remove('open')}
document.addEventListener('click',e=>{const tw=document.getElementById('themeWrap');if(tw&&!tw.contains(e.target))closeDrop()});

const originalNavHTML=document.getElementById('navRight').innerHTML;
function buildThemeDropHTML(){
  return `<div class="drop-section" style="display:none">Mode</div>
    <div class="toggle-row" style="display:none"><span class="toggle-label"><i class="ti ti-sun" style="font-size:15px"></i> Light mode</span><button class="tog${!isDark?' on':''}" id="modeToggle" onclick="toggleMode()"></button></div>
    <div class="drop-sep" style="display:none"></div>
    <div class="drop-section">Color</div>
    ${[
      {k:'midnight',g:'#a78bfa,#7c5cbf'},
      {k:'blossom', g:'#f472b6,#be185d'},
      {k:'abyss',   g:'#38bdf8,#1d4ed8'},
      {k:'inferno', g:'#fb923c,#c2410c'},
      {k:'jade',    g:'#4ade80,#166534'},
      {k:'arcane',  g:'#e879f9,#9d174d'},
      {k:'obsidian',g:'#96C7FF,#171824'}
    ].map(({k,g})=>`<button class="drop-row${currentColor===k?' active':''}" onclick="setColor('${k}','${accentHex[k]}','${colorNames[k]}',this)"><div class="drop-row-left"><span class="theme-swatch" style="background:linear-gradient(135deg,${g})"></span>${colorNames[k]}</div><i class="ti ti-check drop-check"></i></button>`).join('')}`;
}
function updateNav(){
  // Sign-in state just changed (incl. session restore on load, when no goStep fires): refresh the landing rejoin pill
  if(typeof lzCheckRejoin==='function'&&document.getElementById('page-landing')?.classList.contains('active'))lzCheckRejoin();
  const nr=document.getElementById('navRight');
  if(currentUser){
    nr.innerHTML=`
      <button class="ghost-btn" id="inboxBtn" onclick="openInboxModal()" title="Inbox" style="display:none;position:relative;padding:7px 11px"><i class="ti ti-mail" style="font-size:16px"></i><span id="inboxDot" style="display:none;position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:#f87171;box-shadow:0 0 0 2px var(--bg2)"></span></button>
      <button class="ghost-btn" id="soundBtn" onclick="toggleSound()" title="Toggle sound" style="padding:7px 11px"><i class="ti ti-volume" id="soundBtnIcon" style="font-size:16px"></i></button>
      <div class="ctrl-wrap" id="themeWrap" style="display:none">
        <button class="theme-swatch-btn" id="cdot" onclick="toggleDrop()" style="background:linear-gradient(135deg,${g1[currentColor]},${g2[currentColor]})"></button>
        <span class="theme-swatch-tip" id="tlabel">${colorNames[currentColor]}</span>
        <div class="drop" id="drop">${buildThemeDropHTML()}</div>
      </div>
      <button class="ghost-btn" style="display:none" onclick="goStep('leaderboard')"><i class="ti ti-trophy" style="font-size:15px"></i> Leaderboard</button>
      <button class="ghost-btn" id="adminNavLink" onclick="goAdmin()" style="display:none;opacity:0;pointer-events:none;transition:opacity .3s ease"><i class="ti ti-shield" style="font-size:15px"></i> Admin</button>
      <div class="user-pill" onclick="goProfile()" style="cursor:pointer">
        ${getNavAvatarHTML(currentUser[0].toUpperCase())}${currentUser}${isGuest?' <span style="font-size:10px;opacity:.6">(guest)</span>':''}
      </div>
      <button class="ghost-btn" onclick="signOut()"><i class="ti ti-logout" style="font-size:15px"></i> Sign out</button>`;
    document.addEventListener('click',e=>{const tw=document.getElementById('themeWrap');if(tw&&!tw.contains(e.target))closeDrop()});
  } else {
    nr.innerHTML=originalNavHTML;
  }
  const _adminLink=document.getElementById('adminNavLink');
  if(_adminLink){_adminLink.style.display=isAdmin?'flex':'none';_adminLink.style.opacity=isAdmin?'1':'0';_adminLink.style.pointerEvents=isAdmin?'':'none';}
  applyTheme();
  if(typeof syncDrawerState==='function')syncDrawerState();
  if(currentUser&&!isGuest)checkInboxBadge();
}

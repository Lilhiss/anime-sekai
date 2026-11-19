// Supabase config and client (moved out of index.html 2026-11-19; order matters)
// ── SUPABASE CONFIG ───────────────────────────────────────────
// Replace these two values with your own from supabase.com
// Project Settings → API → Project URL and anon public key
const SUPABASE_URL  = 'https://ispagvwuxgbzzycdxdfx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzcGFndnd1eGdienp5Y2R4ZGZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4OTcwMDksImV4cCI6MjA5NDQ3MzAwOX0.COahnEHqu4R-_OBAJX1J-4qGk_Lo04SWKfNBfkYCTn0';
// Custom storage that never saves anonymous sessions to localStorage
// This prevents guest play from blocking real sign-in on the next visit
const anonSafeStorage = {
  getItem: (key) => {
    try{
      // Check sessionStorage first for anon sessions (survives refresh, not tab close)
      const sess = sessionStorage.getItem(key);
      if(sess){
        const parsed = JSON.parse(sess);
        if(parsed?.user?.is_anonymous === true) return sess;
      }
      return localStorage.getItem(key);
    }catch(e){ return null; }
  },
  setItem: (key, value) => {
    try{
      const parsed = JSON.parse(value);
      // Guests persist across tab close too (paired with the as_guest record)
      if(parsed?.user?.is_anonymous === true){ try{sessionStorage.removeItem(key);}catch(e){} }
      localStorage.setItem(key, value);
    }catch(e){ localStorage.setItem(key, value); }
  },
  removeItem: (key) => {
    try{ localStorage.removeItem(key); }catch(e){}
    try{ sessionStorage.removeItem(key); }catch(e){}
  }
};

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: anonSafeStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

// Site content (card titles/descriptions/locks) is public read data — load it
// regardless of sign-in state, so guests see the same overrides. loadSiteConfig
// is declared further down the page, so wait until the DOM (and therefore every
// inline script) has finished parsing before calling it.
function _bootSiteConfig(){if(!SUPABASE_URL.includes('YOUR_PROJECT')&&typeof loadSiteConfig==='function')loadSiteConfig();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',_bootSiteConfig,{once:true});
else _bootSiteConfig();

// ── SUPABASE AUTH ─────────────────────────────────────────────
// Every account signs in with <username>@animesekai.guest (usernames can't be changed),
// so the address comes straight from the username — no lookup, and no real emails kept.
function sbAuthEmail(username){return `${String(username).trim().toLowerCase()}@animesekai.guest`;}

// New accounts are made by upgrading this browser's guest (or a fresh one) in place:
// same user id, so the guest's games, Daily scores and avatar stay with the account.
async function sbCreateAccount(username, password){
  const email=sbAuthEmail(username);
  let {data:{session}}=await sb.auth.getSession();
  let u=session?.user;
  // A retry after a half-finished attempt already has the email set; otherwise start from a guest
  if(!u||!(u.is_anonymous||u.email===email)){
    const {data,error}=await sb.auth.signInAnonymously();
    if(error)throw error;
    u=data.user;
  }
  if(u.email!==email){
    const {error}=await sb.auth.updateUser({email});
    if(error)throw error;
  }
  const {error:pwErr}=await sb.auth.updateUser({password});
  if(pwErr)throw pwErr;
  const {error:nameErr}=await sb.rpc('finish_signup',{p_username:username});
  if(nameErr)throw nameErr;
  await sb.auth.refreshSession().catch(()=>{});
  return u;
}

async function sbSignIn(username, password){
  const{data,error}=await sb.auth.signInWithPassword({email:sbAuthEmail(username),password});
  if(error) throw error;
  return data.user;
}

async function sbSignOut(){
  try{ await sb.auth.signOut(); }catch(e){}
  // Explicitly clear the token in case the custom storage didn't catch it
  try{ localStorage.removeItem('sb-ispagvwuxgbzzycdxdfx-auth-token'); }catch(e){}
}

async function sbLoadProfile(userId){
  try{
    const [statsRes, profileRes]=await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/user_stats?select=*&id=eq.${userId}&limit=1`,
        {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}),
      fetch(`${SUPABASE_URL}/rest/v1/profiles?select=avatar_url,theme_color,hide_spoilers&id=eq.${userId}&limit=1`,
        {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}})
    ]);
    const [statsRows, profileRows]=await Promise.all([statsRes.json(), profileRes.json()]);
    const stats=Array.isArray(statsRows)&&statsRows[0]?statsRows[0]:null;
    if(!stats)return null;
    const avatar_url=(Array.isArray(profileRows)&&profileRows[0]?.avatar_url)||null;
    const email=null; // emails are no longer kept on profiles
    const theme_color=(Array.isArray(profileRows)&&profileRows[0]?.theme_color)||null;
    if(userId===currentUserId||!currentUserId){profileColorKey=pfPair(theme_color)?theme_color:'auto';try{localStorage.setItem('as_pf_color',profileColorKey);}catch(e){}}
    // A signed-in player's spoiler choice follows them across devices
    if(userId===currentUserId&&!isGuest&&Array.isArray(profileRows)&&typeof profileRows[0]?.hide_spoilers==='boolean'){
      soloHideSpoilers=profileRows[0].hide_spoilers;
      try{localStorage.setItem('as_hide_spoilers',soloHideSpoilers?'1':'0');}catch(e){}
      suSyncSpoilers();
    }
    return {...stats, avatar_url, email, theme_color};
  }catch(e){return null;}
}

async function sbSaveGame(userId, gameData){
  try{
    // RLS requires auth.uid() = user_id, so this must carry the player's session token, not the anon key
    const token=await rtGetAuthToken();
    const res=await fetch(`${SUPABASE_URL}/rest/v1/games`,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json','Prefer':'return=minimal'
      },
      body:JSON.stringify({
        user_id:userId,format:gameData.format,mode:gameData.mode,
        score:gameData.score,correct:gameData.correct,
        total:gameData.total,lives_left:gameData.livesLeft
      })
    });
    if(!res.ok)console.error('Save game error:',res.status);
  }catch(e){console.error('Save game error:',e);}
}

async function sbLoadHistory(userId){
  try{
    const res=await fetch(
      `${SUPABASE_URL}/rest/v1/games?select=*&user_id=eq.${userId}&order=played_at.desc&limit=10`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
    );
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(e){return [];}
}

async function sbLoadLeaderboard(){
  try{
    const res=await fetch(
      `${SUPABASE_URL}/rest/v1/leaderboard?select=*&limit=20`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
    );
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(e){return [];}
}

// ── SESSION RESTORE ───────────────────────────────────────────
// Guest (anonymous) sessions are kept across reloads on purpose: onAuthStateChange
// below pairs them with the as_guest record so a guest keeps their name and seat.
// Signing in or creating an account simply replaces the anonymous session.

// ── PRESENCE CLEANUP (replaces old IIFE + pagehide approach) ──
// Any stale pending_lobby_cleanup key left by a pre-Presence version is safe to
// ignore — we just clear it so it never accidentally fires old logic.
try{ sessionStorage.removeItem('pending_lobby_cleanup'); }catch(e){}

// Ensure these are defined before onAuthStateChange fires
if(typeof currentUser==='undefined')window.currentUser=null;
if(typeof currentUserId==='undefined')window.currentUserId=null;
if(typeof isGuest==='undefined')window.isGuest=false;
if(typeof currentPfp==='undefined')window.currentPfp=null;

sb.auth.onAuthStateChange(async (event, session) => {
  if(!session?.user){ lzAuthDone(); return; }

  // ── Anon session restored after refresh ──────────────────────
  // onAuthStateChange fires for anonymous users too, but we previously
  // ignored them. Repopulate currentUserId so rtGetOrCreateAnonSession
  // returns the correct id and lobby rejoin works correctly.
  if(session.user.is_anonymous){
    // INITIAL_SESSION can fire while the page is still parsing, before the later
    // script that declares currentUserId/isGuest (let) and guestLoad. Wait for it.
    if(document.readyState==='loading')await new Promise(r=>document.addEventListener('DOMContentLoaded',r,{once:true}));
    if(!currentUserId){
      currentUserId = session.user.id;
      try{ sessionStorage.setItem('guest_user_id', currentUserId); }catch(e){}
      const g=guestLoad();
      if(!currentUser&&g&&g.name&&(!g.uid||g.uid===currentUserId)){
        isGuest=true;guestSessionId=g.sid||guestSessionId;
        if(g.pfp)currentPfp=g.pfp;
        currentUser=g.name;
        guestResolveName(g.name).then(n=>{if(n!==currentUser&&isGuest){currentUser=n;guestSave();updateNav();}});
        guestSave();
        try{updateNav();}catch(e){}
        loadMyStats().catch(()=>{});
      }
      // A refresh no longer drops the player back into their lobby automatically: the landing
      // page's Rejoin pill (and the Multiplayer page's rejoin card) offer it while the seat lasts.
      if(typeof lzCheckRejoin==='function')lzCheckRejoin();
    }
    lzAuthDone();
    return;
  }

  // ── Registered user session restored ─────────────────────────
  if(!currentUser){
    const profile = await sbLoadProfile(session.user.id);
    if(profile){
      currentUser   = profile.username;
      currentUserId = session.user.id;
      currentEmail  = profile.email||null;
      if(profile.theme_color&&accentHex[profile.theme_color])currentColor=profile.theme_color;
      isGuest = false;
      totalGames    = parseInt(profile.total_games) || 0;
      bestScore     = parseInt(profile.best_score)  || 0;
      totalCorrect  = parseInt(profile.total_correct)|| 0;
      totalAnswered = parseInt(profile.total_answered)||0;
      perfectGames  = parseInt(profile.perfect_games) ||0;
      allHistory = await sbLoadHistory(currentUserId);
      // Restore avatar
      if(profile.avatar_url){
        if(profile.avatar_url.startsWith('preset:')){
          currentPfp={type:'preset',value:profile.avatar_url.slice(7)};
        } else {
          currentPfp={type:'upload',value:profile.avatar_url};
        }
      }
      updateNav();
      checkAdminRole();
      // Arrived via an invite link while already signed in — join now that the
      // session has restored (the boot router ran before currentUser was set).
      if(typeof pendingInviteCode!=='undefined'&&pendingInviteCode)afterAuth();
    }
  }
  lzAuthDone();
});

// ── LANDING ENTRANCE ANIMATION ────────────────────────────────
let _landingAnimated=false;
function _appReady(){
  if(_landingAnimated)return;
  _landingAnimated=true;

  const nav=document.getElementById('mainNav');
  const logo=document.getElementById('entryLogoMark');
  const wrap=document.getElementById('entryWrap');
  const floats=document.getElementById('landingFloats');

  // Step 1 — logo pops in
  if(logo){
    logo.style.opacity='1';
    // Re-trigger the logoPop animation by removing and re-adding the class
    logo.classList.remove('entry-logo-pop');
    void logo.offsetWidth;
    logo.classList.add('entry-logo-pop');
  }

  // Step 2 — after 180ms, nav + cards + floats fade in together
  setTimeout(()=>{
    if(nav){
      nav.classList.remove('nav-content-hidden');
      nav.querySelectorAll('.logo,.nav-right,.nav-hamburger').forEach(el=>{
        el.classList.add('landing-fadein-nav');
      });
    }
    if(wrap){wrap.style.opacity='1';wrap.classList.add('landing-fadein');}
    if(floats){floats.style.opacity='1';floats.classList.add('landing-fadein');}
  },180);
}

// Reveal the nav and landing content as soon as the DOM is parsed and fonts
// are ready — no need to wait for auth. Auth updates the nav button quietly
// in the background via updateNav() once it resolves.
function _triggerAppReady(){
  if(document.fonts&&document.fonts.ready){
    document.fonts.ready.then(()=>_appReady());
  } else {
    _appReady();
  }
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',_triggerAppReady,{once:true});
} else {
  _triggerAppReady();
}

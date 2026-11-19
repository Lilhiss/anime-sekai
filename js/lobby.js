// Lobbies, lobby settings, lobby list, host tools, multiplayer HUD (moved out of index.html 2026-11-19; loads in its original place, order matters)
// ── LOBBY / MULTIPLAYER ───────────────────────────────────────
let lobbyCode='',lobbyName='',lobbyPlayers=[],lobbyFormat='mc',lobbyMode='race',lobbyTopics=[],lobbyShelvedTopics=[],lobbyIsGeneral=true,intentionalLeave=false,lobbyIsPrivate=false,currentLobbyId=null;
let voidingEnabled=false; // host-controlled toggle; off by default
let lobbyShowTyping=true; // host-controlled toggle; on by default
let srTargetScore=10; // Slow Reveal: first to this many points wins
let mpRaceTarget=1000; // Multiplayer Score Race: first to cross this score wins
let mpTiebreakerPlayers=[]; // names of players in a tiebreaker round (empty = normal play)
let mpFlagsThisQuestion=new Set(); // distinct players who flagged current question
let mpFlagWindowOpen=false;        // true during the 4s window after reveal
let mpFlagWindowTimer=null;        // setTimeout that closes the flag window
let mpPreVoidSnapshot={};          // {name:{score,lives}} snapshot before question resolved
let mpPlayerFlagWindows={};        // rolling 3-slot flag history per player

// Host-disconnect grace period (Step 3)
// hostGraceTimer   — the 20s setTimeout that fires the election if the host doesn't return
// hostGraceCountdown — the 1s setInterval that ticks the visible pause banner countdown
let hostGraceTimer=null,hostGraceCountdown=null;

let heartbeatInterval=null;
// The server's cleanup job (pg_cron job 5) removes lobby players whose last_seen is older
// than 2 minutes. Browsers throttle timers in a tab hidden for 5+ minutes to about once a
// minute, so the cutoff is well above that, and coming back to the tab beats immediately.
async function sendHeartbeat(){
  if(!currentLobbyId||!currentUserId)return;
  await sb.from('lobby_players')
    .update({last_seen:new Date().toISOString()})
    .eq('lobby_id',currentLobbyId)
    .eq('user_id',currentUserId);
}
function startHeartbeat(){
  stopHeartbeat();
  heartbeatInterval=setInterval(sendHeartbeat,15000); // 15s: presence still feels live, ~3x fewer writes than 5s (Disk IO budget)
}
function stopHeartbeat(){
  if(heartbeatInterval){clearInterval(heartbeatInterval);heartbeatInterval=null;}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&heartbeatInterval)sendHeartbeat().catch(()=>{});});
// 5 characters, no vowels (no accidental words) and no look-alikes (0/O, 1/I/L). 28^5 ≈ 17M codes.
const CODE_CHARS='BCDFGHJKMNPQRSTVWXYZ23456789';
function generateCode(){let c='';for(let i=0;i<5;i++)c+=CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)];return c}
// Re-roll until the code isn't used by a waiting/active lobby (gives up after 6 tries).
async function generateUniqueCode(){
  let code=generateCode();
  if(SUPABASE_URL.includes('YOUR_PROJECT'))return code;
  for(let i=0;i<6;i++){
    try{
      const r=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?select=id&code=eq.${encodeURIComponent(code)}&status=in.(waiting,active)&limit=1`,{headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON}});
      const d=await r.json();
      if(!Array.isArray(d)||!d.length)return code;
    }catch(e){return code;}
    code=generateCode();
  }
  return code;
}
// Forgiving join: ignores case, spaces and dashes.
function normalizeLobbyCode(raw){return (raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5)}
function toggleLobbyPrivacy(){setPillPrivacy(!lobbyIsPrivate)}
function setPillPrivacy(isPrivate){
  lobbyIsPrivate=isPrivate;
  const pillPublic=document.getElementById('pillPublic');
  const pillPrivate=document.getElementById('pillPrivate');
  if(pillPublic)pillPublic.classList.toggle('active',!isPrivate);
  if(pillPrivate)pillPrivate.classList.toggle('active',isPrivate);
}
async function createLobby(){
  if(!currentUser){choosePath('create');return}
  lobbyInGame=false;
  const nameInput=document.getElementById('lobbyNameInput');
  lobbyName=(nameInput&&nameInput.value.trim())||`${currentUser}'s Lobby`;
  if(nameInput)nameInput.value='';
  lobbyCode=await generateUniqueCode();
  lobbyPlayers=[{name:currentUser,score:0,lives:3,isHost:true,color:pfPairLead(),eliminated:false,userId:currentUserId}];
  lobbyFormat=selectedFormat||'mc';lobbyMode=selectedMode||'race';
  lobbyShelvedTopics=[];
  isHost=true;
  goStep('lobby-room');
  rtCreateLobby();
}
async function joinLobby(){
  const code=normalizeLobbyCode(document.getElementById('lobbyCodeInput').value);
  if(code.length<5){showErr('lobbyJoinErr','lobbyJoinErrMsg','Please enter a valid lobby code.');return}
  if(!currentUser){choosePath('join');return}
  const joinBtn=document.querySelector('.lobby-code-btn');
  const origHTML=joinBtn?joinBtn.innerHTML:'';
  function lockBtn(){if(joinBtn){joinBtn.disabled=true;joinBtn.innerHTML='<i class="ti ti-loader-2" style="font-size:14px;animation:spin .8s linear infinite"></i>';}}
  function resetBtn(){if(joinBtn){joinBtn.disabled=false;joinBtn.innerHTML=origHTML;joinBtn.style.opacity='';joinBtn.style.cursor='';}}
  lockBtn();
  // Pre-check: fetch lobby and player count before attempting to join.
  // Must accept 'active' here too, mirroring rtJoinLobby's own lookup below —
  // this pre-check ran before rtJoinLobby was ever called, so its old
  // status==='waiting' gate was silently rejecting mid-countdown joins before
  // rtJoinLobby's race-check ever got a chance to run.
  try{
    const lobbyRes=await fetch(
      SUPABASE_URL+'/rest/v1/lobbies?select=id,mode,status&code=eq.'+encodeURIComponent(code)+'&limit=1',
      {headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON}}
    );
    const lobbyRows=await lobbyRes.json();
    const lobby=Array.isArray(lobbyRows)?lobbyRows[0]:null;
    if(!lobby||(lobby.status!=='waiting'&&lobby.status!=='active')){resetBtn();showErr('lobbyJoinErr','lobbyJoinErrMsg','Lobby not found. It may not exist or may have already ended.');return;}
    const countRes=await fetch(
      SUPABASE_URL+'/rest/v1/lobby_players?select=user_id&lobby_id=eq.'+lobby.id,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON}}
    );
    const countRows=await countRes.json();
    const maxPlayers=lobby.mode==='hp'?8:12;
    if(Array.isArray(countRows)&&countRows.length>=maxPlayers){
      if(joinBtn){joinBtn.disabled=true;joinBtn.innerHTML=origHTML;joinBtn.style.opacity='.5';joinBtn.style.cursor='not-allowed';}
      showErr('lobbyJoinErr','lobbyJoinErrMsg','This lobby is full ('+maxPlayers+'/'+maxPlayers+' players).');
      return;
    }
  }catch(e){resetBtn();}
  const ok=await rtJoinLobby(code);
  if(!ok){resetBtn();return;}
}

// ── LOBBY TIMER ───────────────────────────────────────────────
const LOBBY_TTL=10*60;
let lobbyTimerInterval=null;
let lobbyTimerSecondsLeft=LOBBY_TTL;
let lobbyWarningShown=false;
let lobbyExpiresAt=null;          // absolute expiry timestamp (ISO) shared by host + joiners
let nonHostTimerInterval=null;    // non-host countdown driven from lobbyExpiresAt
let lobbyInGame=false;            // true while a match is in progress — pauses the lobby timer

// Pass remainingSeconds to resume an inherited timer; omit (or pass null) to read
// expires_at from the DB (fresh host start). Falls back to LOBBY_TTL if unavailable.
async function startLobbyTimer(remainingSeconds){
  clearLobbyTimer();
  if(remainingSeconds!=null){
    // Inherited from a host_transferred broadcast — use it directly.
    lobbyTimerSecondsLeft=Math.max(1,Math.round(remainingSeconds));
    lobbyWarningShown=lobbyTimerSecondsLeft<=60;
  } else {
    // Fresh host start: derive remaining time from DB expires_at so a page-refresh
    // doesn't silently reset the clock.
    lobbyTimerSecondsLeft=LOBBY_TTL;
    lobbyWarningShown=false;
    if(!SUPABASE_URL.includes('YOUR_PROJECT')&&lobbyCode){
      try{
        const r=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?select=expires_at&code=eq.${encodeURIComponent(lobbyCode)}&limit=1`,
          {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}});
        const d=await r.json();
        const exp=Array.isArray(d)?d[0]?.expires_at:null;
        if(exp){
          const secsLeft=Math.round((new Date(exp)-Date.now())/1000);
          if(secsLeft>0&&secsLeft<LOBBY_TTL){
            lobbyTimerSecondsLeft=secsLeft;
            lobbyWarningShown=secsLeft<=60;
          }
        }
      }catch(e){}
    }
  }
  // If we're resuming mid-warning (e.g. page refresh with <60s left), show banner immediately
  if(lobbyTimerSecondsLeft<=60&&lobbyTimerSecondsLeft>0){
    showLobbyExpiryBanner(lobbyTimerSecondsLeft);
  }
  lobbyTimerInterval=setInterval(async()=>{
    lobbyTimerSecondsLeft--;
    // Broadcast 1-minute warning to all players
    if(lobbyTimerSecondsLeft===60&&!lobbyWarningShown){
      lobbyWarningShown=true;
      showLobbyToast('⏳ This lobby will close in 1 minute if the game hasn\'t started.','warning');
      if(rtChannel){
        rtChannel.send({type:'broadcast',event:'lobby_expiry_warning',payload:{remainingSeconds:60}});
      }
    }
    // Show/update the in-page countdown banner once we're in the warning window
    if(lobbyTimerSecondsLeft<=60&&lobbyTimerSecondsLeft>0){
      showLobbyExpiryBanner(lobbyTimerSecondsLeft);
    }
    if(lobbyTimerSecondsLeft<=0){
      hideLobbyExpiryBanner();
      clearLobbyTimer();
      if(isHost){
        // Notify non-host clients before tearing down so they show the expired modal
        // regardless of whether they were present when the 60-second warning fired.
        if(rtChannel)rtChannel.send({type:'broadcast',event:'lobby_expired',payload:{}});
        await rtDeleteLobby();
        intentionalLeave=true;
        if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
        isHost=false;
        goStep('multiplayer');
        setTimeout(()=>showLobbyExpiredModal(),300);
      }
    }
  },1000);
}

function clearLobbyTimer(){
  if(lobbyTimerInterval){clearInterval(lobbyTimerInterval);lobbyTimerInterval=null;}
  if(nonHostTimerInterval){clearInterval(nonHostTimerInterval);nonHostTimerInterval=null;}
  lobbyWarningShown=false;
  hideLobbyExpiryBanner();
}
// Non-hosts: count down to the lobby's absolute expires_at so the banner stays in
// sync with the host regardless of tab throttling or when the player joined.
function startNonHostExpiryWatch(){
  if(isHost||!lobbyExpiresAt)return;
  if(nonHostTimerInterval){clearInterval(nonHostTimerInterval);nonHostTimerInterval=null;}
  const tick=()=>{
    if(isHost){if(nonHostTimerInterval){clearInterval(nonHostTimerInterval);nonHostTimerInterval=null;}return;}
    const secsLeft=Math.round((new Date(lobbyExpiresAt)-Date.now())/1000);
    if(secsLeft<=0){hideLobbyExpiryBanner();if(nonHostTimerInterval){clearInterval(nonHostTimerInterval);nonHostTimerInterval=null;}return;}
    if(secsLeft<=60)showLobbyExpiryBanner(secsLeft);else hideLobbyExpiryBanner();
  };
  tick();
  nonHostTimerInterval=setInterval(tick,1000);
}

function showLobbyExpiryBanner(secsLeft){
  const banner=document.getElementById('lobbyExpiryBanner');
  const display=document.getElementById('lobbyExpiryTimerDisplay');
  if(!banner||!display)return;
  const m=Math.floor(secsLeft/60);
  const s=secsLeft%60;
  display.textContent=m>0?`${m}:${String(s).padStart(2,'0')}`:String(s);
  display.classList.toggle('urgent',secsLeft<=15);
  banner.classList.add('visible');
}

function hideLobbyExpiryBanner(){
  const banner=document.getElementById('lobbyExpiryBanner');
  if(banner)banner.classList.remove('visible');
}

function showLobbyActiveBanner(){
  const banner=document.getElementById('lobbyActiveBanner');
  if(banner)banner.classList.add('visible');
}
function hideLobbyActiveBanner(){
  const banner=document.getElementById('lobbyActiveBanner');
  if(banner)banner.classList.remove('visible');
}
// Manual escape hatch for the "stuck in lobby room" banner above.
function enterActiveLobbyGame(){
  hideLobbyActiveBanner();
  rtRejoinActiveLobby(lobbyCode);
}

function showLobbyExpiredModal(){
  const sub=document.getElementById('lobbyExpiredSub');
  const btn=document.getElementById('lobbyExpiredBtn');
  if(isHost){
    if(sub)sub.textContent='The lobby has expired. Create a new one to play with friends.';
    if(btn){btn.innerHTML='<i class="ti ti-plus" style="font-size:15px"></i> Create New Lobby';btn.onclick=()=>{document.getElementById('lobbyExpiredModal').classList.remove('open');createLobby();};}
  } else {
    if(sub)sub.textContent='The lobby has expired.';
    if(btn){btn.innerHTML='<i class="ti ti-layout-grid" style="font-size:15px"></i> Back to Multiplayer';btn.onclick=()=>{document.getElementById('lobbyExpiredModal').classList.remove('open');goStep('multiplayer');};}
  }
  document.getElementById('lobbyExpiredModal').classList.add('open');
  applyTheme();
}

function showLobbyToast(msg,type='warning'){
  // Remove any existing toast
  const existing=document.getElementById('lobbyToast');
  if(existing)existing.remove();
  const toast=document.createElement('div');
  toast.id='lobbyToast';
  const colors={warning:'#f59e0b',danger:'#ef4444'};
  const bg={warning:'rgba(245,158,11,.12)',danger:'rgba(239,68,68,.12)'};
  toast.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${bg[type]};border:1.5px solid ${colors[type]};color:${colors[type]};font-family:'Nunito',sans-serif;font-size:13px;font-weight:800;padding:12px 20px;border-radius:12px;z-index:9999;max-width:340px;text-align:center;backdrop-filter:blur(12px);box-shadow:0 4px 24px #0006;animation:toastIn .3s ease`;
  toast.textContent=msg;
  document.body.appendChild(toast);
  setTimeout(()=>{toast.style.opacity='0';toast.style.transition='opacity .4s';setTimeout(()=>toast.remove(),400);},(type==='danger'?4000:6000));
}
const fmtEmoji={mc:'📋',type:'⌨️',scene:'🎬',char:'👤','char-mc':'👤'};
const modeEmoji={classic:'🎮',race:'⚡',survival:'❤️',potato:'🥔',slowreveal:'👁️'};

// ── HOST GRACE PERIOD HELPERS (Step 3) ───────────────────────────────────────
const HOST_GRACE_SECONDS=20;

function showHostPauseBanner(secondsLeft){
  const banner=document.getElementById('hostPauseBanner');
  const timerEl=document.getElementById('hostPauseTimer');
  const subEl=document.getElementById('hostPauseSub');
  if(!banner)return;
  if(timerEl)timerEl.textContent=secondsLeft;
  if(subEl)subEl.textContent='Waiting to reconnect… If they don\'t return, a new host will be chosen.';
  banner.classList.add('visible');
}
function hideHostPauseBanner(){
  const banner=document.getElementById('hostPauseBanner');
  if(banner)banner.classList.remove('visible');
  clearTimeout(hostGraceTimer);
  clearInterval(hostGraceCountdown);
  hostGraceTimer=null;
  hostGraceCountdown=null;
}

// Called by the presence:leave active branch when the disconnected player was the host.
// Starts the 20s visible pause countdown; if the host doesn't return, runs self-election.
function startHostGracePeriod(goneHostName,goneHostUserId,lid){
  // Deduplicate — only one grace period runs at a time
  clearTimeout(hostGraceTimer);
  clearInterval(hostGraceCountdown);

  let secsLeft=HOST_GRACE_SECONDS;
  showHostPauseBanner(secsLeft);

  hostGraceCountdown=setInterval(()=>{
    secsLeft--;
    const timerEl=document.getElementById('hostPauseTimer');
    if(timerEl){
      timerEl.textContent=secsLeft;
      // Turn red for the last 5 seconds
      timerEl.classList.toggle('urgent',secsLeft<=5);
    }
    if(secsLeft<=0)clearInterval(hostGraceCountdown);
  },1000);

  hostGraceTimer=setTimeout(async()=>{
    clearInterval(hostGraceCountdown);
    hideHostPauseBanner();
    // Grace period expired — run self-election (same stable-order pattern as pre-game)
    if(!currentLobbyId||SUPABASE_URL.includes('YOUR_PROJECT'))return;
    try{
      const token=await rtGetAuthToken();
      const headers={'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`};
      // Fetch remaining connected rows ordered by joined_at (stable election order)
      const pRes=await fetch(
        `${SUPABASE_URL}/rest/v1/lobby_players?select=user_id,username&lobby_id=eq.${currentLobbyId}&connected=eq.true&order=joined_at.asc`,
        {headers}
      );
      const pData=await pRes.json();
      const remaining=(Array.isArray(pData)?pData:[]).filter(p=>p.user_id!==goneHostUserId);
      if(!remaining.length)return; // nobody left to elect
      const next=remaining[0];
      if(next.user_id!==currentUserId)return; // not our turn — the right client will claim it
      // Claim host: update both lobby_players and lobbies (host_id must be correct for the
      // reclaim-check in rtJoinLobby to work if the original host rejoins later as a player)
      const patchHeaders={...headers,'Content-Type':'application/json','Prefer':'return=minimal'};
      await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${currentLobbyId}`,
        {method:'PATCH',headers:patchHeaders,body:JSON.stringify({is_host:false})});
      await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${currentLobbyId}&user_id=eq.${currentUserId}`,
        {method:'PATCH',headers:patchHeaders,body:JSON.stringify({is_host:true})});
      await fetch(`${SUPABASE_URL}/rest/v1/lobbies?id=eq.${currentLobbyId}`,
        {method:'PATCH',headers:patchHeaders,body:JSON.stringify({host_id:currentUserId,host_username:currentUser})});
      isHost=true;
      lobbyPlayers.forEach(p=>{p.isHost=(p.userId===currentUserId);});
      // Broadcast so every remaining client updates their UI and knows who to watch for next_question
      if(rtChannel){
        rtChannel.send({type:'broadcast',event:'host_transferred',payload:{
          newHost:currentUser,
          reason:'grace_expired',
          originalHostName:goneHostName||'The host'
        }});
      }
      showLobbyToast(`👑 You're now the host!`,'warning');
      // The new host needs a game-state snapshot before driving — Step 4 will handle this
      // by responding to request_game_state. For now, request our own state from peers.
      setTimeout(()=>{
        if(lobbyMode==='slowreveal'){
          // Slow Reveal's mid-reveal state (the character-by-character animation and
          // any in-progress buzz-in) can't be reconstructed from a snapshot — and since
          // we're now the only host, nobody would ever answer a request_game_state
          // broadcast anyway. Other clients are already sitting in the "Catching up...
          // next round starts soon" spectator screen (see the game_state_snapshot
          // handler), so honor that by just starting a fresh round immediately instead
          // of waiting forever for a response that will never come.
          qIndex++;
          renderMPHUD();
          if(rtChannel)rtChannel.send({type:'broadcast',event:'sr_next_round',payload:{qIndex}});
          srHostFetchAndBroadcast();
        } else if(rtChannel){
          rtChannel.send({type:'broadcast',event:'request_game_state',payload:{userId:currentUserId,username:currentUser}});
        }
      },400);
    }catch(e){console.error('[hostGrace] election error',e);}
  },HOST_GRACE_SECONDS*1000);
}

// Cancels a running grace period when the host reconnects within the window.
function cancelHostGracePeriod(){
  clearTimeout(hostGraceTimer);
  clearInterval(hostGraceCountdown);
  hostGraceTimer=null;
  hostGraceCountdown=null;
  hideHostPauseBanner();
}

function refreshLobbyList(){
  const refreshIcon=document.getElementById('lobbyRefreshIcon');
  if(refreshIcon){refreshIcon.classList.add('spinning');setTimeout(()=>refreshIcon.classList.remove('spinning'),500);}
  loadPublicLobbies();
}
async function loadPublicLobbies(silent=false){
  const list=document.getElementById('lobbyBrowseList');
  const countLabel=document.getElementById('lobbyCountLabel');
  if(!list)return;

  if(!silent){
    list.innerHTML='<div class="lobby-list-loading"><div class="spinner"></div><span>Finding open games…</span></div>';
    countLabel.textContent='';
  }

  if(SUPABASE_URL.includes('YOUR_PROJECT')){
    list.innerHTML='<div class="lobby-list-empty">🔌 Connect Supabase to see live lobbies.</div>';
    return;
  }

  try{
    // Use anon key directly — lobbies list is public, no auth needed
    const res=await fetch(
      `${SUPABASE_URL}/rest/v1/lobbies?select=*&status=eq.waiting&is_private=eq.false&order=created_at.desc&limit=30`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
    );
    if(!res.ok){
      const errText=await res.text();
      console.error('loadPublicLobbies error:',res.status,errText);
      list.innerHTML=`<div class="lobby-list-empty">⚠️ Error ${res.status} loading lobbies.<br><span style="font-size:11px;margin-top:4px;display:block">${errText}</span></div>`;
      return;
    }
    const lobbies=await res.json();
    if(!Array.isArray(lobbies)||!lobbies.length){
      list.innerHTML='<div class="lobby-list-empty"><span class="mp-empty-t">'+_htmlEsc(getSiteText('lobby_browse_empty_title'))+'</span><span class="mp-empty-s">'+_htmlEsc(getSiteText('lobby_browse_empty_sub'))+'</span><button class="lobby-refresh-btn" onclick="refreshLobbyList()"><i class="ti ti-refresh" style="font-size:13px" id="lobbyRefreshIcon"></i> Refresh</button></div>';
      countLabel.textContent='0 open';
      return;
    }

    // Fetch player counts for all lobbies in one aggregated query
    const ids=lobbies.map(l=>l.id);
    let playerCounts={};
    try{
      const pcRes=await fetch(
        `${SUPABASE_URL}/rest/v1/lobby_players?select=lobby_id&lobby_id=in.(${ids.join(',')})`,
        {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`,'Prefer':'count=exact'}}
      );
      const pcData=await pcRes.json();
      if(Array.isArray(pcData))pcData.forEach(r=>{playerCounts[r.lobby_id]=(playerCounts[r.lobby_id]||0)+1;});
    }catch(e){console.warn('Player count fetch failed:',e);}

    list.innerHTML='';
    const seen=window._mpSeenLobbies;window._mpSeenLobbies=new Set([...(seen||[]),...lobbies.map(l=>l.id)]); /* unfurl only lobbies that appear while watching */
    const colors=['#a78bfa','#f472b6','#38bdf8','#fb923c','#4ade80','#e879f9'];
    lobbies.forEach((lobby,i)=>{
      const count=playerCounts[lobby.id]||0;
      const max=lobby.mode==='hp'?8:12;
      const full=count>=max;
      const hostInitial=(lobby.lobby_name||lobby.host_username||'?')[0].toUpperCase();
      const color=colors[i%colors.length];
      const fmt=lobby.format||'mc';
      const mode=lobby.mode||'race';
      const qCount=lobby.question_count||(mode==='race'?100:mode==='survival'||mode==='potato'?3:10);
      const livesCount=lobby.lives||(mode==='survival'||mode==='potato'?3:null);
      const fmtName={mc:'Multiple Choice',type:'Type Answer',scene:'Guess the Scene',char:'Name Character'}[fmt]||fmt;
      const modeName={classic:'Classic',race:'Score Race',survival:'Survival',potato:'Hot Potato',slowreveal:'Slow Reveal'}[mode]||mode;
      const timeBadge=(mode==='race'||mode==='survival'||mode==='classic')&&lobby.time_limit?`<span class="lobby-list-badge">⏱ ${lobby.time_limit}s</span>`:'';
      const goalBadge=mode==='survival'
        ?`<span class="lobby-list-badge">❤️ ${livesCount} Lives</span><span class="lobby-list-badge">📋 ${qCount}Q</span>`
        :mode==='race'?`<span class="lobby-list-badge">🏁 ${qCount} Pts</span>`
        :mode==='potato'?`<span class="lobby-list-badge">❤️ ${livesCount} Lives</span>`
        :mode==='slowreveal'?`<span class="lobby-list-badge">🎯 ${qCount} Pts</span>`
        :`<span class="lobby-list-badge">📋 ${qCount}Q</span>`;

      // 41a: the card IS the colour — mode hue mixed ~12% into the panel.
      const card=document.createElement('div');
      card.className='mp-card mp-scroll'+(full?' full':'')+(seen&&!seen.has(lobby.id)?' unfurl':'');
      const pill={classic:['#96C7FF','ti-cards'],race:['#F6C98E','ti-bolt'],survival:['#F6A5B8','ti-heart'],potato:['#FFC69A','ti-flame'],slowreveal:['#A8E3F5','ti-eye']}[mode]||['#F6C98E','ti-device-gamepad-2'];
      card.style.setProperty('--mc',({classic:'#3F7FE0',race:'#E8A23A',survival:'#D9467A',potato:'#E5583A',slowreveal:'#2BB3A6'})[mode]||'#E8A23A');
      const metaBits=[fmtName,[goalBadge,timeBadge].join('').replace(/<[^>]+>/g,' ').trim().replace(/\s+/g,' ')].filter(Boolean).join(' · ');
      const tag=full?'':(max-count===1?'1 SEAT LEFT':(lobby.status==='in_progress'?'IN PROGRESS':''));
      const lname=lobby.lobby_name || (lobby.host_username ? lobby.host_username+"'s Lobby" : lobby.code);
      card.innerHTML=`<div class="mps-art"><i class="mps-paper"><b></b><u></u></i><i class="mps-rl"></i><i class="mps-rd"></i><span class="mps-tag">${modeName.toUpperCase()}</span><div class="mps-body"><span class="mps-emo">${modeEmoji[mode]||'🎮'}</span>
        <span class="mpc-pill" style="background:${pill[0]}"><i class="ti ${pill[1]}"></i>${modeName.toUpperCase()}</span>
        <span class="mpc-name">${lname}</span>
        <span class="mpc-players"><i class="ti ti-users"></i>${count}/${max}${tag?` · ${tag}`:''}</span>
        ${full ? '<span class="mpc-join mpc-full">FULL</span>'
               : `<button class="mpc-join" onclick="joinLobbyById('${lobby.id}','${lobby.code}')">JOIN</button>`}</div></div>`;
      if(false) card.innerHTML=`
        <div class="mp-card-main">
          <div style="min-width:0">
            <div class="mp-card-name">${lobby.lobby_name || (lobby.host_username ? lobby.host_username+"'s Lobby" : lobby.code)}</div>
            <div class="mp-card-host">hosted by ${lobby.host_username||'—'}</div>
          </div>
          <div class="mp-card-line">
            <span class="mp-card-mode">${modeName}</span>
            <span class="mp-card-meta">${metaBits}</span>
          </div>
          <div class="mp-card-seats">
            <span class="mp-card-players">${count} / ${max}</span>
            ${tag?`<span class="mp-card-tag">${tag}</span>`:''}
          </div>
        </div>
        <div class="mp-card-col">
          <span class="mp-card-emoji">${MP_MODE_GLYPH[mode]||'🎮'}</span>
          ${full ? '<span class="mp-full-label">FULL</span>'
                 : `<button class="mp-card-join" onclick="joinLobbyById('${lobby.id}','${lobby.code}')">JOIN</button>`}
        </div>`;
      list.appendChild(card);
    });

    countLabel.textContent=`${lobbies.length} open`;
  }catch(e){
    console.error('loadPublicLobbies exception:',e);
    list.innerHTML='<div class="lobby-list-empty">⚠️ Couldn\'t load lobbies. Check your connection.</div>';
    countLabel.textContent='';
  }
}

async function joinLobbyById(lobbyId,code){
  if(!currentUser){choosePath('join');return;}
  const ok=await rtJoinLobby(code);
  if(!ok)return;
}

// ── IN-PROGRESS REJOIN CHECK ──────────────────────────────────
// Looks for a lobby_players row owned by the current user in an active lobby.
// If found, renders a distinct "Rejoin" card above the open-lobbies list.
// The public open-lobbies list is never modified — strangers cannot browse into
// someone else's live game; this card is strictly for lobbies the user was in.
// This player's seat in a game that's still running (their lobby_players row is kept for
// ~2 minutes after they quit or drop), or null. Shared by the Multiplayer page's rejoin
// card and the landing page's rejoin pill.
async function fetchActiveGameSeat(){
  if(!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT'))return null;
  const token=await rtGetAuthToken();
  const res=await fetch(
    `${SUPABASE_URL}/rest/v1/lobby_players?select=lobby_id,score,lives,lobbies!inner(id,code,lobby_name,host_username,format,mode,status)&user_id=eq.${encodeURIComponent(currentUserId)}&lobbies.status=in.(waiting,active)&limit=1`,
    {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}}
  );
  if(!res.ok)return null;
  const rows=await res.json();
  const row=Array.isArray(rows)&&rows[0];
  return row&&row.lobbies?row:null;
}
// Landing page: surface a running game right under the Daily Quiz, so a player who
// refreshed or left mid-game doesn't have to find the Multiplayer page's rejoin card.
async function lzCheckRejoin(){
  const el=document.getElementById('lzRejoin');if(!el)return;
  if(!currentUserId||lobbyInGame){el.style.display='none';return;}
  try{
    const row=await fetchActiveGameSeat();
    if(!row||lobbyInGame){el.style.display='none';return;}
    const lobby=row.lobbies;
    const modeName={classic:'Classic',race:'Score Race',survival:'Survival',potato:'Hot Potato',slowreveal:'Slow Reveal'}[lobby.mode]||'Multiplayer';
    el.dataset.code=lobby.code;el.dataset.status=lobby.status;
    const tt=document.getElementById('lzRejoinTitle');if(tt)tt.textContent=lobby.status==='waiting'?'Your lobby is still open':'Your game is still running';
    document.getElementById('lzRejoinSub').textContent=modeName+' · '+(lobby.lobby_name||((lobby.host_username||lobby.code)+"'s Lobby"));
    el.style.display='';
  }catch(e){el.style.display='none';}
}
async function lzRejoinClick(){
  const el=document.getElementById('lzRejoin');const code=el&&el.dataset.code;if(!code)return;
  el.style.display='none';
  const ok=await rejoinSeat(code,el.dataset.status).catch(()=>false);
  if(!ok)lzCheckRejoin(); // game ended or seat expired meanwhile: re-check rather than leave a dead button
}
/* Rejoin the lobby this player still has a seat in: a waiting lobby goes through the normal
   join (which restores host status), a running game through the mid-game rejoin. */
function rejoinSeat(code,status){return status==='waiting'?rtJoinLobby(code):rtRejoinActiveLobby(code);}
(function(){
  const _gs=window.goStep;
  window.goStep=function(name){const r=_gs.apply(this,arguments);if(name==='landing')lzCheckRejoin();return r;};
})();
async function checkForActiveGameRejoin(){
  const banner=document.getElementById('rejoinBanner');
  if(!banner)return;
  banner.style.display='none';
  banner.innerHTML='';
  if(!currentUserId)return; // signed-out / guest not yet initialised
  if(SUPABASE_URL.includes('YOUR_PROJECT'))return;
  try{
    const row=await fetchActiveGameSeat();
    if(!row)return;
    const lobby=row.lobbies;
    const fmt=lobby.format||'mc';
    const mode=lobby.mode||'race';
    const fmtName={mc:'Multiple Choice',type:'Type Answer',scene:'Guess the Scene',char:'Name Character','char-mc':'Name Char (MC)'}[fmt]||fmt;
    const modeName={classic:'Classic',race:'Score Race',survival:'Survival',potato:'Hot Potato',slowreveal:'Slow Reveal'}[mode]||mode;
    const lobbyLabel=lobby.lobby_name||(lobby.host_username?`${lobby.host_username}'s Lobby`:lobby.code);
    banner.innerHTML=`
      <div style="font-size:11px;font-weight:800;color:var(--accent);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <i class="ti ti-player-play" style="font-size:12px"></i> ${lobby.status==='waiting'?'Your lobby is still open':'Game in progress'}
      </div>
      <div class="rejoin-card">
        <div class="rejoin-card-pulse"></div>
        <div class="lobby-list-info">
          <div class="lobby-list-host">${lobbyLabel}</div>
          <div class="lobby-list-meta">
            <span class="lobby-list-badge">${fmtEmoji[fmt]||'🎮'} ${fmtName}</span>
            <span class="lobby-list-badge">${modeEmoji[mode]||'🏁'} ${modeName}</span>
            ${lobby.status==='waiting'?'':`<span class="lobby-list-badge">⚡ Score ${row.score||0}</span>`}
          </div>
        </div>
        <button class="rejoin-btn" onclick="rejoinSeat('${lobby.code}','${lobby.status}')">
          <i class="ti ti-refresh" style="font-size:13px"></i> Rejoin
        </button>
      </div>`;
    banner.style.display='block';
  }catch(e){
    console.warn('checkForActiveGameRejoin error:',e);
  }
}

(function(){
  function set(v){document.body.classList.toggle('qz-glass',v==='glass');try{localStorage.setItem('qz_glass_preview',v);}catch(e){}document.querySelectorAll('.qzg-switch button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));}
  window.qzgSet=set;
  function init(){
    const s=document.createElement('div');s.className='qzg-switch';
    s.innerHTML='<span>QUIZ BG</span><button data-v="flat" onclick="qzgSet(\'flat\')">Current</button><button data-v="glass" onclick="qzgSet(\'glass\')">Glass</button>';
    document.body.appendChild(s);
    set('glass');s.remove();return;
    setInterval(()=>{const vis=[...document.querySelectorAll('#page-quiz,#page-mp-quiz')].some(p=>p.offsetParent!==null||getComputedStyle(p).display!=='none');document.body.classList.toggle('qzg-visible',vis);},400);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
function bgvSet(v){
  const pg=document.getElementById('page-lobby-room');if(!pg)return;
  pg.classList.remove('bgv-glass','bgv-pattern','bgv-both','bgv-mixed');
  if(v!=='flat')pg.classList.add('bgv-'+v);
  try{localStorage.setItem('lr_bg_preview',v);}catch(e){}
  document.querySelectorAll('.bgv-switch button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
}
function bgvInit(){
  const pg=document.getElementById('page-lobby-room');
  if(pg&&!pg.classList.contains('bgv-mixed'))pg.classList.add('bgv-mixed');
}
function bgvInit_old(){
  if(document.querySelector('.bgv-switch'))return;
  const s=document.createElement('div');s.className='bgv-switch';
  s.innerHTML='<span>CONSOLE BG</span>'+[['flat','Current'],['glass','Glass'],['pattern','Pattern'],['both','Both'],['mixed','Mixed']].map(([v,l])=>'<button data-v="'+v+'" onclick="bgvSet(\''+v+'\')">'+l+'</button>').join('');
  document.body.appendChild(s);
  let v='both';try{v=localStorage.getItem('lr_bg_preview')||'both';}catch(e){}
  bgvSet(v);
}
function renderLobbyRoom(){
  bgvInit();
  try{if(typeof lrRailView!=='undefined'&&lrRailView==='chat'&&typeof lrChatMsgs!=='undefined'&&lrChatMsgs.length)setTimeout(lrChatRender,0);}catch(e){}
  if(typeof hideJoiningOverlay==='function')hideJoiningOverlay();
  hideLobbyActiveBanner();
  document.getElementById('lobbyCodeDisplay').textContent=lobbyName||lobbyCode;
  document.getElementById('lobbyCodeBig').textContent=lobbyCode;
  // Update visibility badge
  const badge=document.getElementById('lobbyVisibilityBadge');
  if(badge){
    if(lobbyIsPrivate){
      badge.className='lobby-visibility-badge private';
      badge.innerHTML='<i class="ti ti-lock" style="font-size:11px"></i> Private';
    } else {
      badge.className='lobby-visibility-badge public';
      badge.innerHTML='<i class="ti ti-world" style="font-size:11px"></i> Public';
    }
  }
  // Only auto-start the timer the first time this host opens the room.
  // If startLobbyTimer() was already called (e.g. inherited via host_transferred),
  // lobbyTimerInterval will be non-null and we skip — don't reset the clock.
  if(!lobbyInGame){
    if(isHost&&!lobbyTimerInterval)startLobbyTimer();
    else if(!isHost&&!nonHostTimerInterval)startNonHostExpiryWatch();
  }
  const maxPlayers=Math.min(lobbyMaxPlayers,lobbyMode==='hp'||lobbyMode==='potato'?8:12);
  document.getElementById('lobbyPlayerCount').textContent=lobbyPlayers.length;
  const lobbyMaxEl=document.getElementById('lobbyPlayerMax');
  if(lobbyMaxEl)lobbyMaxEl.textContent=maxPlayers;
  const timeLimitLabel=(lobbyMode==='race'||lobbyMode==='survival'||lobbyMode==='classic')?` · ${raceTimeLimit}s`:'';
  const qCountLabel=lobbyMode==='slowreveal'?` · First to ${srTargetScore}`:` · ${selectedQuestionLimit}Q`;
  document.getElementById('lobbySettingsLabel').textContent=fmtLabels[lobbyFormat]+' · '+lobbyModeLabel(lobbyMode)+qCountLabel+timeLimitLabel;
  updateLobbyTopicsLabel();
  const list=document.getElementById('lobbyPlayerList');
  // A re-render can be triggered mid-click by something unrelated to the host's action —
  // e.g. another player's 15-second heartbeat updating lobby_players.last_seen, which fires
  // the postgres_changes subscription and rebuilds this whole list from scratch. Remember
  // which player's kebab menu was open beforehand so we can restore it after rebuilding,
  // instead of it just vanishing out from under the host.
  const openKebabName=list.querySelector('.lobby-kebab-menu.open')?.closest('.lobby-player')?.dataset.playerName||null;
  list.innerHTML='';
  const _prevNames=window._prevLobbyNames||new Set();
  lobbyPlayers.forEach(p=>{
    const row=document.createElement('div');row.className='lobby-player'+(_prevNames.has(p.name)?'':' is-new');row.dataset.playerName=p.name;
    const isMe=p.name===currentUser;
    if(isMe)row.classList.add('lobby-player-me');
    const escapedName=p.name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    const hostActions=isHost&&!isMe
      ?`<div class="lobby-player-actions"><button class="lobby-action-btn" onclick="promptTransferHost('${escapedName}')" title="Make host"><i class="ti ti-crown" style="font-size:12px;color:#fbbf24"></i> Make Host</button><button class="lobby-action-btn kick" onclick="kickPlayer('${escapedName}')" title="Kick player"><i class="ti ti-user-minus" style="font-size:12px"></i> Kick</button></div><div class="lobby-kebab-wrap"><button class="lobby-kebab-btn" onclick="toggleLobbyKebab(this)" title="Player options">⋯</button><div class="lobby-kebab-menu"><button class="lobby-kebab-item" onclick="closeLobbyKebabs();promptTransferHost('${escapedName}')"><i class="ti ti-crown" style="font-size:13px;color:#fbbf24"></i> Make Host</button><button class="lobby-kebab-item danger" onclick="closeLobbyKebabs();kickPlayer('${escapedName}')"><i class="ti ti-user-minus" style="font-size:13px"></i> Kick</button></div></div>`
      :'';
    const avatarHtml=getLobbyAvatarHTML(p.avatar,p.color,p.name[0].toUpperCase(),45,!isMe&&p.hasPfp===true&&p.avatar===null);
    const avatarWrap=isMe
      ?`<div style="position:relative;cursor:pointer;flex-shrink:0" onclick="openPfpPicker()" title="Change profile picture">${avatarHtml}<div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0'"><i class="ti ti-pencil" style="font-size:13px;color:#fff"></i></div></div>`
      :avatarHtml;
    row.innerHTML=`${avatarWrap}<div class="lobby-player-name">${p.name}${isMe?' <span style="font-size:10px;color:var(--accent);font-weight:800;margin-left:4px">(you)</span>':''}</div>${p.isHost?'<span class="lobby-host-crown">👑</span><span class="lobby-player-badge">Host</span>':''}${hostActions}`;
    list.appendChild(row);
  });
  // Ghost "waiting" slots so the room visibly fills up as players join
  const ghostTarget=Math.min(maxPlayers,8);
  for(let i=lobbyPlayers.length;i<ghostTarget;i++){
    const g=document.createElement('div');g.className='lobby-slot-ghost';
    g.innerHTML='<div class="lobby-slot-ghost-av"><i class="ti ti-user-plus" style="font-size:15px"></i></div><span>Waiting for player…</span>';
    list.appendChild(g);
  }
  window._prevLobbyNames=new Set(lobbyPlayers.map(p=>p.name));
  // Reopen the kebab menu that was open before this rebuild, if that player is still here.
  if(openKebabName){
    const reopenMenu=list.querySelector(`.lobby-player[data-player-name="${CSS.escape(openKebabName)}"] .lobby-kebab-menu`);
    if(reopenMenu)reopenMenu.classList.add('open');
  }
  // Lock controls for non-host players
  const startBtn=document.getElementById('startLobbyBtn');
  const settingsBtn=document.getElementById('lobbySettingsBtn');
  if(!isHost){
    if(startBtn){startBtn.classList.add('lobby-guest-lock');startBtn.disabled=true;}
    if(settingsBtn){settingsBtn.style.opacity='0.4';settingsBtn.style.pointerEvents='none';settingsBtn.title='Only the host can change settings';}
  } else {
    if(startBtn){startBtn.classList.remove('lobby-guest-lock');startBtn.disabled=false;}
    if(settingsBtn){settingsBtn.style.opacity='';settingsBtn.style.pointerEvents='';settingsBtn.title='';}
  }
  // Smarter Start button: pulse when ready (2+ players), nudge to invite when alone
  const startHint=document.getElementById('startHint');
  if(startBtn)startBtn.classList.toggle('ready-pulse',isHost&&lobbyPlayers.length>=2);
  if(typeof lrUpdateStart==='function')lrUpdateStart();
  if(startHint){
    startHint.style.display='none';
  }
  // Reflect current settings in the inline options panel + lock it for non-hosts
  if(typeof gsSyncUI==='function')gsSyncUI();
  const optPanel=document.getElementById('lobbyOptionsPanel');
  if(optPanel)optPanel.classList.toggle('readonly',!isHost);
  const optLock=document.getElementById('lobbyOptionsLock');
  if(optLock)optLock.style.display=isHost?'none':'flex';
  // Update hint text
  const hint=document.getElementById('lobbySettingsHint');
  if(hint)hint.textContent=isHost?'Change format \u0026 mode before starting':'Only the host can change settings';
  applyTheme();
}
function copyLobbyCode(){
  navigator.clipboard.writeText(lobbyCode).catch(()=>{});
  const lbl=document.getElementById('copyCodeLabel');lbl.textContent='Copied!';
  const ic=lbl.previousElementSibling;if(ic)ic.className='ti ti-check';
  clearTimeout(copyLobbyCode._t);
  copyLobbyCode._t=setTimeout(()=>{lbl.textContent='Copy code';if(ic)ic.className='ti ti-copy';},1600);
}
function copyLobbyLink(){
  const link=window.location.origin+window.location.pathname+'?lobby='+encodeURIComponent(lobbyCode);
  navigator.clipboard.writeText(link).catch(()=>{});
  const lbl=document.getElementById('copyLinkLabel');
  if(lbl){lbl.textContent='Link copied!';setTimeout(()=>{lbl.textContent='Copy invite link'},2000);}
}
/* one write at a time: changes made while a write is in flight are merged and sent right after it,
   so quick clicks can't land out of order (an older write finishing last would undo a newer pick) */
let _plBusy=false,_plNext=null;
async function patchLobby(fields){
  if(!lobbyCode||!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  if(_plBusy){_plNext=Object.assign(_plNext||{},fields);return;}
  _plBusy=true;
  try{
    const token=await rtGetAuthToken();
    await fetch(`${SUPABASE_URL}/rest/v1/lobbies?code=eq.${encodeURIComponent(lobbyCode)}`,{
      method:'PATCH',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify(fields)
    });
  }catch(e){}
  _plBusy=false;
  if(_plNext){const f=_plNext;_plNext=null;patchLobby(f);}
}
function updateLobbyTopicsLabel(){
  const el=document.getElementById('lobbyTopicsLabel');
  if(!el)return;
  if(lobbyIsGeneral||lobbyTopics.length===0){
    el.textContent='🌐 General Anime';
  } else {
    el.textContent=lobbyTopics.map(t=>t.emoji+' '+t.name).join(', ');
  }
  el.style.display='block';
}
function lobbyModeLabel(m){return m==='classic'?'Classic':m==='race'?'Score Race':m==='survival'?'Survival':m==='slowreveal'?'Slow Reveal 👁️':m==='potato'?'Hot Potato 🥔':m}
function openHowToPlay(){
  const fmtDescs={
    mc:getSiteText('htp_fmt_mc'),
    type:getSiteText('htp_fmt_type'),
    scene:getSiteText('htp_fmt_scene'),
    char:getSiteText('htp_fmt_char')
  };
  const fmtIcons={mc:'ti-list',type:'ti-keyboard',scene:'ti-photo',char:'ti-user-circle'};
  const modeDescs={
    classic:getSiteText('htp_mode_classic'),
    race:getSiteText('htp_mode_race'),
    survival:getSiteText('htp_mode_survival'),
    potato:getSiteText('htp_mode_potato'),
    slowreveal:getSiteText('htp_mode_slowreveal')
  };
  const modeIcons={classic:'ti-device-gamepad-2',race:'ti-trophy',survival:'ti-heart',potato:'ti-flame',slowreveal:'ti-eye'};
  const modeEmojis={classic:'🎮',race:'⚡',survival:'❤️',potato:'🥔',slowreveal:'👁️'};
  const fmt=lobbyFormat||'mc';
  const mode=lobbyMode||'race';
  document.getElementById('htpFormatIcon').innerHTML='<i class="ti '+fmtIcons[fmt]+'" style="font-size:20px"></i>';
  document.getElementById('htpFormatName').textContent=fmtLabels[fmt]||fmt;
  document.getElementById('htpFormatDesc').textContent=fmtDescs[fmt]||'';
  document.getElementById('htpModeIcon').innerHTML=modeEmojis[mode]||'';
  document.getElementById('htpModeName').textContent=lobbyModeLabel(mode);
  document.getElementById('htpModeDesc').textContent=modeDescs[mode]||'';
  const topicText=(lobbyIsGeneral||lobbyTopics.length===0)
    ?getSiteText('htp_topic_general')
    :lobbyTopics.map(t=>(t.emoji?t.emoji+' ':'')+t.name).join(', ');
  document.getElementById('htpTopic').textContent=topicText;
  const modal=document.getElementById('howToPlayModal');
  modal.style.display='flex';
  applyTheme();
}
// ── Inline lobby "Game Settings" panel (accordion sections) ──
let gsActiveTab='format',gsTopicSub='general',gsTopicScrollTarget=0;
/* Restore the picker from lobbies.settings (see broadcastLobbySettings) when joining or rejoining. */
function applyLobbySettings(s){
  if(!s||typeof s!=='object')return;
  const n=(v,f)=>{if(typeof v==='number'&&isFinite(v))f(v);};
  if(Array.isArray(s.topics))lobbyTopics=s.topics.filter(t=>t&&t.key).map(t=>({key:t.key,name:t.name,type:t.type||'anime',emoji:t.emoji||''}));
  if(typeof s.isGeneral==='boolean')lobbyIsGeneral=s.isGeneral||!lobbyTopics.length;
  n(s.timeLimit,v=>raceTimeLimit=v);n(s.survivalLives,v=>selectedLives=v);n(s.survivalQuestionLimit,v=>survivalQuestionLimit=v);
  n(s.hpLives,v=>hpLives=v);n(s.hpFuseMin,v=>hpFuseMin=v);n(s.hpFuseMax,v=>hpFuseMax=v);
  n(s.srTargetScore,v=>srTargetScore=v);n(s.mpRaceTarget,v=>mpRaceTarget=v);n(s.questionLimit,v=>selectedQuestionLimit=v);
  n(s.pointsPerCorrect,v=>lobbyPointsPerCorrect=v);n(s.maxPlayers,v=>lobbyMaxPlayers=v);
  if(typeof s.voidingEnabled==='boolean')voidingEnabled=s.voidingEnabled;
  if(typeof s.showTyping==='boolean')lobbyShowTyping=s.showTyping;
  if(typeof s.lateJoin==='boolean')lobbyLateJoin=s.lateJoin;
  if(typeof s.autoAdvance==='boolean')lobbyAutoAdvance=s.autoAdvance;
  if(typeof s.locked==='boolean')window.lobbyLocked=s.locked;
  lobbyHideSpoilers=s.hideSpoilers===true;
  lobbyTopicParts=(s.topicParts&&typeof s.topicParts==='object'&&!Array.isArray(s.topicParts))?{...s.topicParts}:{};
}
function broadcastLobbySettings(changing){
  const isSR=lobbyMode==='slowreveal';
  const isRace=lobbyMode==='race';
  const isHP=lobbyMode==='potato';
  const isSurvival=lobbyMode==='survival';
  const qc=isSR?srTargetScore:isRace?mpRaceTarget:isHP?hpLives:isSurvival?survivalQuestionLimit:selectedQuestionLimit;
  // settings: everything the lobby's picker holds, saved on the row so a refreshed host or a
  // new joiner can restore it (applyLobbySettings); before this it lived only in the host's tab
  const settings={topics:(lobbyTopics||[]).map(t=>({key:t.key,name:t.name,type:t.type||'anime',emoji:t.emoji||''})),isGeneral:!!lobbyIsGeneral,
    timeLimit:raceTimeLimit,survivalLives:selectedLives,survivalQuestionLimit:survivalQuestionLimit,hpLives:hpLives,hpFuseMin:hpFuseMin,hpFuseMax:hpFuseMax,
    srTargetScore:srTargetScore,mpRaceTarget:mpRaceTarget,questionLimit:selectedQuestionLimit,voidingEnabled:voidingEnabled,showTyping:lobbyShowTyping,
    pointsPerCorrect:lobbyPointsPerCorrect,maxPlayers:lobbyMaxPlayers,lateJoin:lobbyLateJoin,autoAdvance:lobbyAutoAdvance,locked:!!window.lobbyLocked,
    hideSpoilers:!!lobbyHideSpoilers,topicParts:lobbyTopicPartsForSave()}; // mp_advance_question reads hideSpoilers and topicParts from this row
  if(isHost)patchLobby({format:lobbyFormat,mode:lobbyMode,question_count:qc,voiding_enabled:voidingEnabled,lives:(lobbyMode==='survival'?selectedLives:lobbyMode==='potato'?hpLives:null),settings});
  if(rtChannel){
    const _tsl=document.getElementById('gsTopicList');
    const payload={format:lobbyFormat,mode:lobbyMode,timeLimit:raceTimeLimit,questionCount:qc,topics:lobbyTopics,isGeneral:lobbyIsGeneral,changing:changing,activeTab:gsActiveTab,topicSub:gsTopicSub,topicScrollTop:_tsl?_tsl.scrollTop:0,survivalLives:selectedLives,survivalQuestionLimit:survivalQuestionLimit,hpLives:hpLives,hpFuseMin:hpFuseMin,hpFuseMax:hpFuseMax,voidingEnabled:voidingEnabled,showTyping:lobbyShowTyping};
    payload.pointsPerCorrect=lobbyPointsPerCorrect;payload.maxPlayers=lobbyMaxPlayers;payload.lateJoin=lobbyLateJoin;payload.autoAdvance=lobbyAutoAdvance;
    payload.hideSpoilers=!!lobbyHideSpoilers;
    payload.topicParts=lobbyTopicPartsForSave();
    if(isSR)payload.srTargetScore=srTargetScore;
    if(isRace)payload.mpRaceTarget=mpRaceTarget;
    rtChannel.send({type:'broadcast',event:'settings_changed',payload:payload});
  }
}
function gsUpdateHostLabel(){
  const isSR=lobbyMode==='slowreveal';
  const isRace=lobbyMode==='race';
  const isSurvivalMP=lobbyMode==='survival';
  const isHP=lobbyMode==='potato';
  const qLabel=isSR?` · First to ${srTargetScore}`:isRace?` · First to ${mpRaceTarget} pts`:isSurvivalMP?` · ${selectedLives}❤️ · ${survivalQuestionLimit}Q`:isHP?` · ${hpLives}❤️ · ${hpFuseMin}–${hpFuseMax}s`:` · ${selectedQuestionLimit}Q`;
  const tLabel=(isRace||isSurvivalMP||lobbyMode==='classic')?` · ${raceTimeLimit}s`:'';
  const el=document.getElementById('lobbySettingsLabel');
  if(el)el.textContent=fmtLabels[lobbyFormat]+' · '+lobbyModeLabel(lobbyMode)+qLabel+tLabel;
  if(typeof updateLobbyTopicsLabel==='function')updateLobbyTopicsLabel();
}
function gsSyncUI(){
  document.querySelectorAll('#gsFormatGrid [data-fmt]').forEach(b=>{
    const fmt=b.dataset.fmt;
    // char bigcard should appear selected for both char and char-mc
    b.classList.toggle('selected',fmt===lobbyFormat||(fmt==='char'&&lobbyFormat==='char-mc'));
  });
  document.querySelectorAll('#gsModeGrid [data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===lobbyMode));
  const srCard=document.querySelector('#gsModeGrid [data-mode="slowreveal"]');
  if(srCard){
    const srAdminLocked=isCardLocked('mode','slowreveal');
    const srLocked=srAdminLocked||lobbyFormat!=='type';
    srCard.classList.toggle('locked',srLocked);
    const srDescEl=srCard.querySelector('.gs-bc-desc');
    if(srDescEl)srDescEl.textContent=srAdminLocked?'🔒 Coming soon':srLocked?'🔒 Type the Answer only':getCardConfig('mode_slowreveal').desc;
  }
  const hpCard=document.querySelector('#gsModeGrid [data-mode="potato"]');
  if(hpCard){
    const hpAdminLocked=isCardLocked('mode','potato');
    const hpLocked=hpAdminLocked||!HP_ALLOWED_FORMATS.includes(lobbyFormat);
    hpCard.classList.toggle('locked',hpLocked);
    const hpDescEl=hpCard.querySelector('.gs-bc-desc');
    if(hpDescEl)hpDescEl.textContent=hpAdminLocked?'🔒 Coming soon':hpLocked?'🔒 No Multiple Choice':getCardConfig('mode_potato').desc;
  }
  document.querySelectorAll('#gsQGrid [data-q]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.q)===selectedQuestionLimit));
  document.querySelectorAll('#gsTimeGrid [data-t]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.t)===raceTimeLimit));
  document.querySelectorAll('#gsTargetGrid [data-sr]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.sr)===srTargetScore));
  document.querySelectorAll('#gsRaceTargetGrid [data-rt]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.rt)===mpRaceTarget));
  const livesPresets=[1,3,5];
  document.querySelectorAll('#gsLivesGrid [data-l]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.l)===selectedLives));
  const gsLivesCustomEl=document.getElementById('gsLivesCustom');
  if(gsLivesCustomEl){if(livesPresets.includes(selectedLives)){gsLivesCustomEl.value='';gsLivesCustomEl.classList.remove('selected');}else{gsLivesCustomEl.value=selectedLives;gsLivesCustomEl.classList.add('selected');document.querySelectorAll('#gsLivesGrid [data-l]').forEach(b=>b.classList.remove('selected'));}}
  document.querySelectorAll('#gsHPLivesGrid [data-hl]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.hl)===hpLives));
  const gsHPLivesCustomEl=document.getElementById('gsHPLivesCustom');
  if(gsHPLivesCustomEl){if(livesPresets.includes(hpLives)){gsHPLivesCustomEl.value='';gsHPLivesCustomEl.classList.remove('selected');}else{gsHPLivesCustomEl.value=hpLives;gsHPLivesCustomEl.classList.add('selected');document.querySelectorAll('#gsHPLivesGrid [data-hl]').forEach(b=>b.classList.remove('selected'));}}
  const hpMinEl=document.getElementById('gsHPFuseMin');const hpMaxEl=document.getElementById('gsHPFuseMax');
  // Don't stamp the stored value back into the field while it's focused — that's what was
  // making backspace look broken: every keystroke re-ran this render and overwrote the
  // box back to the old number before the user could see it was cleared.
  if(hpMinEl&&document.activeElement!==hpMinEl)hpMinEl.value=hpFuseMin;
  if(hpMaxEl&&document.activeElement!==hpMaxEl)hpMaxEl.value=hpFuseMax;
  const rtCustom=document.getElementById('gsRaceTargetCustom');
  if(rtCustom){const presets=[500,1000,1500];if(presets.includes(mpRaceTarget)){rtCustom.value='';}else{rtCustom.value=mpRaceTarget;}}
  const isSR=lobbyMode==='slowreveal';
  const isRace=lobbyMode==='race';
  const isSurvivalMP=lobbyMode==='survival';
  const isHP=lobbyMode==='potato';
  document.getElementById('gsQuestionsSection').style.display=(isSR||isRace||isSurvivalMP||isHP)?'none':'block';
  document.getElementById('gsLivesSection').style.display=isSurvivalMP?'block':'none';
  document.getElementById('gsSurvivalQSection').style.display=isSurvivalMP?'block':'none';
  document.getElementById('gsHPSection').style.display=isHP?'block':'none';
  document.getElementById('gsTimeSection').style.display=(isRace||isSurvivalMP||lobbyMode==='classic')?'block':'none';
  document.querySelectorAll('#gsSurvivalQGrid [data-sq]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.sq)===survivalQuestionLimit));
  document.getElementById('gsTargetSection').style.display=isSR?'block':'none';
  document.getElementById('gsRaceTargetSection').style.display=isRace?'block':'none';
  gsRenderTopic();
  if(typeof gsRenderFormatPane==='function')gsRenderFormatPane();
  if(typeof gsRenderModePane==='function')gsRenderModePane();
  if(typeof gsRenderSettings==='function'){gsSavedAt=Date.now();gsRenderSettings();}
  const topicPane=document.getElementById('gsTopicPane');
  const topicSceneNote=document.getElementById('gsTopicSceneNote');
  const isSceneFmt=lobbyFormat==='scene';
  if(topicPane)topicPane.classList.toggle('scene-locked',isSceneFmt);
  if(topicSceneNote){
    topicSceneNote.style.display=isSceneFmt?'flex':'none';
    if(isSceneFmt){
      const noteText=document.getElementById('gsTopicSceneNoteText');
      if(noteText)noteText.textContent=getSiteText('scene_hint_lobby');
    }
  }
  // Row summaries shown on each collapsed accordion head
  const setTxt=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const fmtRowE={mc:'📝',type:'⌨️',scene:'🎬',char:'🎭','char-mc':'🎭'},modeRowE={classic:'🎮',race:'🏁',survival:'❤️',potato:'🥔',slowreveal:'👁️'},modeRowName={classic:'Classic',race:'Score Race',survival:'Survival',potato:'Hot Potato',slowreveal:'Slow Reveal'};
  {const c=GS_FMT_CARDS.find(x=>x.id===(GS_FMT_BASE[lobbyFormat]||'text'));setTxt('gsValFormat',c?c.e+' '+c.name:'—');}
  setTxt('gsValMode',(modeRowE[lobbyMode]||'')+' '+(modeRowName[lobbyMode]||'—'));
  setTxt('gsValTopic',lobbyIsGeneral?'🌐 General Anime':((lobbyTopics&&lobbyTopics.length)?'🎬 '+lobbyTopics.length+' selected':'—'));
  setTxt('gsValSettings',isSR?('🎯 First to '+srTargetScore):isRace?('🏁 First to '+mpRaceTarget+' pts · '+raceTimeLimit+'s'):isSurvivalMP?('❤️ '+selectedLives+(selectedLives===1?' Life':' Lives')+' · '+survivalQuestionLimit+'Q · '+raceTimeLimit+'s'):isHP?('❤️ '+hpLives+(hpLives===1?' Life':' Lives')+' · '+hpFuseMin+'–'+hpFuseMax+'s fuse'):('⚙️ '+selectedQuestionLimit+' Qs · '+raceTimeLimit+'s'));
  gsRenderAcc();
  if(typeof gsRenderSettings==='function')gsRenderSettings();
  if(typeof gsRenderModePane==='function')gsRenderModePane();
}
function gsAfterChange(){
  if(lobbyMode==='slowreveal'&&lobbyFormat!=='type'){lobbyMode='race';selectedMode='race';}
  if(lobbyMode==='potato'&&!HP_ALLOWED_FORMATS.includes(lobbyFormat)){lobbyMode='race';selectedMode='race';}
  gsSyncUI();gsUpdateHostLabel();broadcastLobbySettings(true);
}
function pruneEmptyLobbyTopics(){
  // If topic data hasn't loaded yet, we can't tell empty from unloaded — skip rather than risk a false prune.
  if(!animeTopics.length)return;
  if(!lobbyTopics.length&&!lobbyShelvedTopics.length)return;
  const cntFmt=cntFmtFor(lobbyFormat);
  const seen=new Set();
  const candidates=[...lobbyTopics,...lobbyShelvedTopics].filter(t=>{
    if(seen.has(t.key))return false;
    seen.add(t.key);return true;
  });
  const kept=[],shelved=[];
  candidates.forEach(t=>{
    const full=animeTopics.find(x=>x.key===t.key);
    const cnt=full&&full.counts?full.counts[cntFmt]||0:0;
    if(cnt>0)kept.push(t);else shelved.push(t);
  });
  const newlyShelved=shelved.filter(t=>!lobbyShelvedTopics.some(s=>s.key===t.key));
  const restored=kept.filter(t=>lobbyShelvedTopics.some(s=>s.key===t.key));
  lobbyTopics=kept;
  lobbyShelvedTopics=shelved;
  if(!lobbyTopics.length&&(newlyShelved.length||restored.length))lobbyIsGeneral=true;
  if(newlyShelved.length&&restored.length){
    const removedLabel=newlyShelved.length===1?`"${newlyShelved[0].name}"`:`${newlyShelved.length} topics`;
    const restoredLabel=restored.length===1?`"${restored[0].name}"`:`${restored.length} topics`;
    showLobbyToast(`⚠️ ${removedLabel} removed (no questions in this format) · ✅ ${restoredLabel} back`,'warning');
  }else if(newlyShelved.length){
    const label=newlyShelved.length===1?`"${newlyShelved[0].name}"`:`${newlyShelved.length} topics`;
    showLobbyToast(`⚠️ ${label} — no questions in this format yet. They'll come back if you switch back.`,'warning');
  }else if(restored.length){
    const label=restored.length===1?`"${restored[0].name}"`:`${restored.length} topics`;
    showLobbyToast(`✅ ${label} back — available again in this format.`,'info');
  }
}
/* 27a FORMAT tab: the card picks the question kind, ANSWER BY picks how you reply;
   the app's four ids are the product of the two. */
const GS_FMT_BASE={mc:'text',type:'text',scene:'scene',char:'char','char-mc':'char'};
const GS_FMT_MAP={text:{choose:'mc',type:'type'},scene:{choose:null,type:'scene'},char:{choose:'char-mc',type:'char'}};
const GS_FMT_CARDS=[
  {id:'text',e:'💬',name:'Text',d:'Straight questions — no image, just the prompt.'},
  {id:'scene',e:'🎬',name:'Scene',d:"A still from the episode — name what's happening."},
  {id:'char',e:'🎭',name:'Characters',d:'A portrait crop — who is on screen?'}
];
function gsBaseFormat(){return GS_FMT_BASE[lobbyFormat]||'text';}
function gsAnswerBy(){return (lobbyFormat==='mc'||lobbyFormat==='char-mc')?'choose':'type';}
function gsBaseLocked(b){const m=GS_FMT_MAP[b];return (!m.choose||isCardLocked('fmt',m.choose))&&isCardLocked('fmt',m.type);}
function gsPickBase(b){
  const m=GS_FMT_MAP[b];
  let want=gsAnswerBy();
  if(want==='choose'&&(!m.choose||isCardLocked('fmt',m.choose)))want='type';
  const id=m[want]||m.type;
  if(isCardLocked('fmt',id))return;
  gsApplyFormat(id);
}
function gsPickAnswerBy(v){
  if(v==='choose'&&GS_TYPE_ONLY_MODES.includes(lobbyMode))return;
  const m=GS_FMT_MAP[gsBaseFormat()];
  const id=(v==='choose')?m.choose:m.type;
  if(!id||isCardLocked('fmt',id))return;
  gsApplyFormat(id);
}
function gsRenderFormatPane(){
  const grid=document.getElementById('gsFormatGrid');
  if(!grid)return;
  const base=gsBaseFormat(), ab=gsAnswerBy(), m=GS_FMT_MAP[base], modeBlocksMC=GS_TYPE_ONLY_MODES.includes(lobbyMode), chooseOK=!!m.choose&&!isCardLocked('fmt',m.choose)&&!modeBlocksMC;
  grid.innerHTML=GS_FMT_CARDS.map(c=>{
    const on=base===c.id, locked=gsBaseLocked(c.id);
    return '<div class="fm-card'+(on?' on':'')+(locked?' locked':'')+'" data-fmt="'+c.id+'" onclick="gsPickBase(\''+c.id+'\')">'
      +(on?'<span class="fm-check"><i class="ti ti-check" style="font-size:13px"></i></span>':'')
      +'<span class="fm-e">'+c.e+'</span><span class="fm-t">'+c.name+'</span>'
      +'<span class="fm-d">'+(locked?'🔒 Coming soon':c.d)+'</span></div>';
  }).join('');
  const abEl=document.getElementById('gsAnswerBy');if(!abEl)return;
  abEl.innerHTML='<span class="fm-ab-l">ANSWER STYLE</span>'
  +'<div class="fm-seg">'
  +'<button class="'+(ab==='choose'&&chooseOK?'on':'')+(chooseOK?'':' off')+'"'+(chooseOK?'':' title="'+(modeBlocksMC?(lobbyMode==='potato'?'Hot Potato':'Slow Reveal')+' is not available in Multiple Choice':'Scene questions are Type the Answer only')+'"')+' onclick="gsPickAnswerBy(\'choose\')"><i class="ti ti-list-check" style="font-size:13px"></i> MULTIPLE CHOICE</button>'
  +'<button class="'+(ab==='type'?'on':'')+'" onclick="gsPickAnswerBy(\'type\')"><i class="ti ti-keyboard" style="font-size:13px"></i> TYPE THE ANSWER</button>'
  +'</div>'
  ;
}
function gsApplyFormat(f){
  if(isCardLocked('fmt',f))return;
  lobbyFormat=f;selectedFormat=f;
  pruneEmptyLobbyTopics();
  if(gsModeFmtFix(lobbyMode)){lobbyMode='classic';selectedMode='classic';}
  if(f==='scene'){lobbyIsGeneral=true;lobbyTopics=[];lobbyShelvedTopics=[];gsTopicSub='general';}
  gsAfterChange();
}
function gsSetFormat(f){
  if(isCardLocked('fmt',f))return; // admin has this format locked ("coming soon")
  if(f==='char'){openCharFmtModal('lobby');return;}
  lobbyFormat=f;selectedFormat=f;
  pruneEmptyLobbyTopics();
  if(f==='scene'){
    // Guess the Scene has no per-anime topic pool yet, so it always plays General Anime.
    lobbyIsGeneral=true;lobbyTopics=[];lobbyShelvedTopics=[];gsTopicSub='general';
  }
  gsAfterChange();
}
const GS_TYPE_ONLY_MODES=['potato','slowreveal'];
function gsModeLockedByMC(m){return GS_TYPE_ONLY_MODES.includes(m)&&gsAnswerBy()==='choose';}
function gsModeFmtFix(m){
  if(m==='slowreveal'&&lobbyFormat!=='type')return 'type';
  if(m==='potato'&&!HP_ALLOWED_FORMATS.includes(lobbyFormat))return lobbyFormat==='char-mc'?'char':'type';
  return null;
}
function gsSetMode(m){if(isCardLocked('mode',m)||gsModeLockedByMC(m))return;
  const fix=gsModeFmtFix(m);
  if(fix){if(isCardLocked('fmt',fix))return;lobbyFormat=fix;selectedFormat=fix;if(typeof pruneEmptyLobbyTopics==='function')pruneEmptyLobbyTopics();}
  lobbyMode=m;selectedMode=m;if(m==='slowreveal'&&!srTargetScore)srTargetScore=10;gsAfterChange();}
function gsSetQuestions(n){selectedQuestionLimit=n;gsAfterChange();}
function gsSetLives(n){
  selectedLives=n;
  document.querySelectorAll('#gsLivesGrid [data-l]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.l)===n));
  const c=document.getElementById('gsLivesCustom');if(c){c.value='';c.classList.remove('selected');}
  gsAfterChange();
}
function gsSetLivesCustom(el){
  const v=Math.max(1,Math.min(20,parseInt(el.value)||1));
  selectedLives=v;
  if(el.value!==''&&parseInt(el.value)>20)el.value=20;
  document.querySelectorAll('#gsLivesGrid [data-l]').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
  gsAfterChange();
}
function gsSetTime(s){raceTimeLimit=s;gsAfterChange();}
// ── Survival MP question cap ──────────────────────────────────
let survivalQuestionLimit=20;
function gsSetSurvivalQ(n){
  survivalQuestionLimit=n;
  document.querySelectorAll('#gsSurvivalQGrid [data-sq]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.sq)===n));
  const c=document.getElementById('gsSurvivalQCustom');if(c){c.value='';c.classList.remove('selected');}
  gsAfterChange();
}
function gsSetSurvivalQCustom(el){
  const v=Math.max(1,Math.min(200,parseInt(el.value)||1));
  survivalQuestionLimit=v;
  if(el.value!==''&&parseInt(el.value)>200)el.value=200;
  document.querySelectorAll('#gsSurvivalQGrid [data-sq]').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
  gsAfterChange();
}
// ── Hot Potato settings ───────────────────────────────────────
const HP_ALLOWED_FORMATS=['type','char','scene']; // any format whose answering mechanism is typing — not mc/char-mc
let hpLives=3,hpFuseMin=5,hpFuseMax=10;
function gsSetHPLives(n){
  hpLives=n;
  document.querySelectorAll('#gsHPLivesGrid [data-hl]').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.hl)===n));
  const c=document.getElementById('gsHPLivesCustom');if(c){c.value='';c.classList.remove('selected');}
  gsAfterChange();
}
function gsSetHPLivesCustom(el){
  const v=Math.max(1,Math.min(20,parseInt(el.value)||1));
  hpLives=v;
  if(el.value!==''&&parseInt(el.value)>20)el.value=20;
  document.querySelectorAll('#gsHPLivesGrid [data-hl]').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
  gsAfterChange();
}
function gsHPFuseInput(el,which){
  // Field is now type="text" so backspace can empty it fully; strip anything non-numeric
  // that could get typed/pasted in (letters, decimals, minus signs, etc).
  el.value=el.value.replace(/[^0-9]/g,'');
  // Soft cap only: silently clamp if the typed number already exceeds 30.
  // Don't write back while the field is empty or the user is mid-edit.
  const v=parseInt(el.value);
  if(!isNaN(v)&&v>30)el.value='30';
  // Update internal state immediately so the summary label stays in sync,
  // but only if the field has a usable value.
  const minEl=document.getElementById('gsHPFuseMin');
  const maxEl=document.getElementById('gsHPFuseMax');
  const mn=parseInt(minEl.value);
  const mx=parseInt(maxEl.value);
  if(!isNaN(mn))hpFuseMin=Math.max(1,Math.min(30,mn));
  if(!isNaN(mx))hpFuseMax=Math.max(1,Math.min(30,mx));
  gsAfterChange();
}
function gsHPFuseCommit(which){
  // Full validation runs when either field loses focus.
  const minEl=document.getElementById('gsHPFuseMin');
  const maxEl=document.getElementById('gsHPFuseMax');
  if(!minEl||!maxEl)return;
  // Fall back to the field's own default (not the last committed value) when left blank,
  // so clearing the Min box and clicking away always lands back on 5, not whatever it was before.
  let mn=parseInt(minEl.value);
  let mx=parseInt(maxEl.value);
  if(isNaN(mn))mn=5;
  if(isNaN(mx))mx=10;
  // Clamp both to [1, 30]
  mn=Math.max(1,Math.min(30,mn));
  mx=Math.max(1,Math.min(30,mx));
  // Enforce at least 3-second gap between min and max — but the field the player just
  // edited is authoritative, and the OTHER field is the one that moves to follow it.
  // Only when following it would push past the 1–30 limits do we instead pull the
  // edited field back (e.g. typing Min=29 can't push Max past 30, so Min snaps to 27).
  if(mx-mn<3){
    if(which==='max'){
      const followMn=mx-3;
      if(followMn>=1){mn=followMn;}
      else{mn=1;mx=mn+3;}
    } else {
      // Default to treating Min as authoritative (covers which==='min' and any legacy
      // callers that don't pass a field, preserving the old fallback behavior).
      const followMx=mn+3;
      if(followMx<=30){mx=followMx;}
      else{mx=30;mn=mx-3;}
    }
  }
  hpFuseMin=mn;hpFuseMax=mx;
  minEl.value=mn;maxEl.value=mx;
  gsAfterChange();
}
// Keep gsSetHPFuse as an alias so any other internal callers still work
function gsSetHPFuse(){gsHPFuseCommit();}

function gsSetTarget(n){srTargetScore=n;gsAfterChange();}
function gsSetRaceTarget(n){mpRaceTarget=n;const c=document.getElementById('gsRaceTargetCustom');if(c)c.value='';gsAfterChange();}
function gsSetRaceTargetCustom(el){const v=parseInt(el.value);if(v>0){mpRaceTarget=v;document.querySelectorAll('#gsRaceTargetGrid [data-rt]').forEach(b=>b.classList.remove('selected'));}gsAfterChange();}
function gsToggleVoiding(){
  voidingEnabled=!voidingEnabled;
  const btn=document.getElementById('gsVoidingToggle');
  if(btn){btn.classList.toggle('on',voidingEnabled);btn.setAttribute('aria-pressed',voidingEnabled);}
  gsAfterChange();
}
function gsToggleShowTyping(){
  lobbyShowTyping=!lobbyShowTyping;
  const btn=document.getElementById('gsShowTypingToggle');
  if(btn){btn.classList.toggle('on',lobbyShowTyping);btn.setAttribute('aria-pressed',lobbyShowTyping);}
  gsAfterChange();
}
function gsSetGeneral(){lobbyIsGeneral=true;lobbyTopics=[];lobbyShelvedTopics=[];gsAfterChange();}
/* 36a folds the general/anime/genre subtabs into one list — kept as a shim so the
   settings_changed sync path still resolves. */
function gsTopicSubSwitch(sub){gsTopicSub=sub;gsRenderTopicList();}
function gsRenderTopic(){gsRenderTopicList();}
/* 35c: the settings a host sets for the room, whatever the mode. Numbers left,
   rules right, runtime in the corner. Per-mode numbers live in 35a's 6th cell. */
var lobbyPointsPerCorrect=100, lobbyMaxPlayers=12, lobbyLateJoin=true, lobbyAutoAdvance=true;
var gsSavedAt=0;
const GS_DEF={points:100,time:15,questions:10,max:12,late:true,voiding:false,typing:true,auto:true,spoilers:false};
function gsStep(label,sub,val,unit,fn,min,max){
  return '<div class="st-row"><div class="st-row-t"><b>'+label+'</b><span>'+sub+'</span></div>'
    +'<div class="st-step">'
    +'<button onclick="'+fn+'(-1)"'+(val<=min?' disabled':'')+'><i class="ti ti-minus" style="font-size:13px"></i></button>'
    +'<span class="v">'+val+(unit?'<i> '+unit+'</i>':'')+'</span>'
    +'<button onclick="'+fn+'(1)"'+(val>=max?' disabled':'')+'><i class="ti ti-plus" style="font-size:13px"></i></button>'
    +'</div></div>';
}
function gsTog(label,sub,on,fn){
  const L=window._gsLast,flip=L&&L.fn===fn&&(Date.now()-L.t<600);
  const shown=flip?!on:on;
  if(flip){window._gsLast=null;requestAnimationFrame(()=>requestAnimationFrame(()=>{document.querySelectorAll('#page-lobby-room .st-tog[data-flip]').forEach(b=>{b.classList.toggle('on');b.removeAttribute('data-flip');});}));}
  return '<div class="st-row"><div class="st-row-t"><b>'+label+'</b><span>'+sub+'</span></div>'
    +'<button class="st-tog'+(shown?' on':'')+'"'+(flip?' data-flip':'')+' onclick="window._gsLast={fn:\''+fn+'\',t:Date.now()};'+fn+'()" aria-pressed="'+(!!on)+'"></button></div>';
}
function gsRenderSettings(){
  const grid=document.getElementById('gsSettingsGrid');
  if(!grid)return;
  if(selectedQuestionLimit>50)selectedQuestionLimit=GS_DEF.questions; // solo Score Race leaves 99999 here
  const m=lobbyMode;
  const rows=[];
  const modeRow=(t,s,ctl)=>'<div class="st-row"><div class="st-row-t"><b>'+t+'</b><span>'+s+'</span></div>'+ctl+'</div>';
  // 60a order: 1 mode setting · 2 questions · 3 timer · 4 lobby size · 5 voiding · 6 answer attempts
  if(m==='race')rows.push(modeRow('Target score','First to reach it wins',gsDials([500,1000,1500],mpRaceTarget,'gsSetRaceTarget')));
  if(m==='slowreveal')rows.push(modeRow('Target score','First to reach it wins',gsDials([5,10,15],srTargetScore,'gsSetTarget')));
  if(m==='survival')rows.push(modeRow('Lives','Per player',gsDials([1,3,5],selectedLives,'gsSetLives')),modeRow('Questions','Most the run can last',gsDials([10,20,30],survivalQuestionLimit,'gsSetSurvivalQ')));
  if(m==='potato')rows.push(modeRow('Lives','Per player',gsDials([1,3,5],hpLives,'gsSetHPLives')),'<div class="st-row"><div class="st-row-t"><b>Fuse window</b><span>Bomb blows at a random second in this range</span></div>'
    +'<div class="st-fuse"><input type="text" inputmode="numeric" maxlength="2" value="'+hpFuseMin+'" oninput="gsHPFuseInput(this,\'min\')" onblur="gsHPFuseCommit(\'min\')" onfocus="this.select()" aria-label="Minimum fuse seconds">'
    +'<span>to</span><input type="text" inputmode="numeric" maxlength="2" value="'+hpFuseMax+'" oninput="gsHPFuseInput(this,\'max\')" onblur="gsHPFuseCommit(\'max\')" onfocus="this.select()" aria-label="Maximum fuse seconds"><span>sec</span></div></div>');
  if(m==='classic'||!m)rows.push(gsStep('Questions','The run ends after these',selectedQuestionLimit,'','gsNudgeQuestions',5,50));
  rows.push(gsStep('Answer timer','Per question, for everyone',raceTimeLimit,'sec','gsNudgeTime',5,60));
  rows.push(
    gsStep('Lobby size','Including you',lobbyMaxPlayers,'max','gsNudgeMax',2,12),
    gsTog('Question voiding','Players can void a bad question by majority',voidingEnabled,'gsToggleVoiding'),
    gsTog('Show answer attempts','Reveal what others typed after the answer',lobbyShowTyping,'gsToggleShowTyping'),
    gsTog('Hide spoilers','Skip questions that reveal twists, fates or hidden identities',lobbyHideSpoilers,'gsToggleHideSpoilers')
  );
  grid.innerHTML=rows.map((r,i)=>r.replace('<div class="st-row">','<div class="st-row"><span class="st-n">0'+(i+1)+'</span>')).join('');
  gsRenderEstimate();
  const saved=document.getElementById('gsSaved');
  if(saved)saved.textContent=gsSavedAt?('saved '+Math.max(1,Math.round((Date.now()-gsSavedAt)/1000))+'s ago'):'';
}
function gsRenderEstimate(){
  const est=document.getElementById('gsEstText'), pill=document.getElementById('gsEstMin');
  if(!est)return;
  const modeName={race:'Score Race',survival:'Survival',potato:'Hot Potato',slowreveal:'Slow Reveal',classic:'Classic'}[lobbyMode]||'game';
  let qs=selectedQuestionLimit;
  if(lobbyMode==='survival')qs=survivalQuestionLimit;
  else if(lobbyMode==='slowreveal')qs=srTargetScore*2;
  else if(lobbyMode==='race')qs=Math.max(5,Math.round(mpRaceTarget/Math.max(1,lobbyPointsPerCorrect)*10));
  const secs=qs*(lobbyMode==='potato'?(hpFuseMin+hpFuseMax)/2:raceTimeLimit)+qs*4;
  const mins=Math.max(1,Math.round(secs/60));
  pill.textContent='~'+mins+' min';
  est.textContent='A '+qs+'-question '+modeName+' at '+(lobbyMode==='potato'?'a '+hpFuseMin+'–'+hpFuseMax+'s fuse':raceTimeLimit+' seconds')+' runs about '+mins+' minute'+(mins===1?'':'s')+'.';
}
function gsNudgePoints(d){lobbyPointsPerCorrect=Math.max(10,Math.min(500,lobbyPointsPerCorrect+d*10));gsAfterChange();}
function gsNudgeTime(d){raceTimeLimit=Math.max(5,Math.min(60,raceTimeLimit+d*5));gsAfterChange();}
function gsNudgeQuestions(d){selectedQuestionLimit=Math.max(5,Math.min(50,selectedQuestionLimit+d*5));gsAfterChange();}
function gsNudgeMax(d){lobbyMaxPlayers=Math.max(2,Math.min(12,lobbyMaxPlayers+d));gsAfterChange();}
function gsToggleLateJoin(){lobbyLateJoin=!lobbyLateJoin;gsAfterChange();}
function gsToggleHideSpoilers(){lobbyHideSpoilers=!lobbyHideSpoilers;prefetchedQuestion=null;gsAfterChange();}
function gsResetDefaults(){
  lobbyPointsPerCorrect=GS_DEF.points;raceTimeLimit=GS_DEF.time;selectedQuestionLimit=GS_DEF.questions;
  lobbyMaxPlayers=GS_DEF.max;lobbyLateJoin=GS_DEF.late;voidingEnabled=GS_DEF.voiding;
  lobbyShowTyping=GS_DEF.typing;lobbyAutoAdvance=GS_DEF.auto;lobbyHideSpoilers=GS_DEF.spoilers;
  const v=document.getElementById('gsVoidingToggle');if(v){v.classList.toggle('on',voidingEnabled);v.setAttribute('aria-pressed',voidingEnabled);}
  const t=document.getElementById('gsShowTypingToggle');if(t){t.classList.toggle('on',lobbyShowTyping);t.setAttribute('aria-pressed',lobbyShowTyping);}
  gsAfterChange();
}

/* 35a: mode reads as a grid of consequences; the 6th cell carries whatever the
   picked mode needs, which keeps GAME SETTINGS from growing five conditional sections. */
const GS_MODES=[
  {id:'classic',e:'🎮',name:'Classic',d:'Everyone answers, one point per correct. Speed changes nothing.',n:'calmest mode'},
  {id:'race',e:'🏁',name:'Score Race',d:'Fastest correct answer scores most. Highest total when the target falls wins.'},
  {id:'survival',e:'❤️',name:'Survival',d:'Lives each. A wrong answer costs one — last player standing wins.',n:'eliminates players'},
  {id:'potato',e:'🥔',name:'Hot Potato',d:'A hidden fuse burns while you answer. Whoever holds it when it blows is out.',n:'fuse hidden from players'},
  {id:'slowreveal',e:'🌫',name:'Slow Reveal',d:'The question decays into view. Buzz early for more points, late for certainty.',n:'scene + character only'}
];
function gsDials(vals,cur,fn,suffix){
  return '<span class="md-dials">'+vals.map(v=>'<button class="md-dial'+(v===cur?' on':'')+'" onclick="event.stopPropagation();'+fn+'('+v+')">'+v+(suffix||'')+'</button>').join('')+'</span>';
}
function gsModeSettingsCell(){
  const m=lobbyMode;
  const name=(GS_MODES.find(x=>x.id===m)||{name:'Mode'}).name.toUpperCase();
  let rows='';
  if(m==='race')rows='<div class="md-row"><span>Target score</span>'+gsDials([500,1000,1500],mpRaceTarget,'gsSetRaceTarget')+'</div>';
  else if(m==='survival')rows='<div class="md-row"><span>Lives</span>'+gsDials([1,3,5],selectedLives,'gsSetLives')+'</div>'
    +'<div class="md-row"><span>Questions</span>'+gsDials([10,20,30],survivalQuestionLimit,'gsSetSurvivalQ')+'</div>';
  else if(m==='potato')rows='<div class="md-row"><span>Lives</span>'+gsDials([1,3,5],hpLives,'gsSetHPLives')+'</div>'
    +'<div class="md-set-note">Fuse window lives in GAME SETTINGS — it needs two numbers.</div>';
  else if(m==='slowreveal')rows='<div class="md-row"><span>Target score</span>'+gsDials([5,10,15],srTargetScore,'gsSetTarget')+'</div>';
  else rows='<div class="md-set-note">Classic has nothing extra to set — questions and the clock live in GAME SETTINGS.</div>';
  return '<div class="md-set"><span class="md-set-l">'+name+' SETTINGS</span>'+rows
    +'<span class="md-set-note">Each mode keeps its own settings. Switching back restores these.</span></div>';
}
function gsRenderModePane(){
  const grid=document.getElementById('gsModeGrid');
  if(!grid)return;
  grid.innerHTML=GS_MODES.map(m=>{
    const on=lobbyMode===m.id, mcLock=!on&&gsModeLockedByMC(m.id);
    return '<div class="md-card'+(on?' on':'')+(mcLock?' locked':'')+'"'+(mcLock?'':' onclick="gsSetMode(\''+m.id+'\')"')+'>'
      +(on?'<span class="md-check"><i class="ti ti-check" style="font-size:13px"></i></span>':'')
      +'<span class="md-e">'+m.e+'</span><span class="md-t">'+m.name+'</span>'
      +'<span class="md-d">'+m.d+'</span>'+(mcLock?'<span class="md-n md-lock">🔒 TYPE THE ANSWER ONLY</span>':m.n?'<span class="md-n">'+m.n+'</span>':'')+'</div>';
  }).join('');
}

/* 36a: the TOPIC tab is static markup — these render into it.
   Every count is scoped to the lobby's current format, because the number has to
   answer "can I run a game"; an all-format total overstates that. */
const GS_FMT_LABEL={mc:'TEXT',type:'TEXT',scene:'SCENE',char:'CHARACTERS','char-mc':'CHARACTERS'};
const GS_FMT_ICON={mc:'ti-abc',type:'ti-abc',scene:'ti-photo',char:'ti-user-square-rounded','char-mc':'ti-user-square-rounded'};
let gsHl=null;
function gsAllTopics(){return animeTopics||[];}
function gsCountOf(t,fmt){const k=cntFmtFor(fmt||lobbyFormat);return t&&t.counts?(t.counts[k]||0):0;}
function gsPoolTotal(){
  const all=gsAllTopics();
  const scope=(lobbyIsGeneral||!lobbyTopics.length)?all:lobbyTopics.map(t=>all.find(x=>x.key===t.key)).filter(Boolean);
  return scope.reduce((s,t)=>s+gsCountOf(t),0);
}
function gsBuildTopicContent(){gsRenderTopicList();}
function gsRenderTopicList(){
  const list=document.getElementById('gsTopicList');if(!list)return;
  const all=gsAllTopics();
  const lbl=GS_FMT_LABEL[lobbyFormat]||'TEXT';
  const scope=document.getElementById('gsTopicScope');
  if(scope)scope.innerHTML='<i class="ti '+(GS_FMT_ICON[lobbyFormat]||'ti-abc')+'" style="font-size:12px"></i> COUNTS ARE '+lbl+' QUESTIONS';
  const gen=document.getElementById('gsGeneralRow');
  if(gen)gen.classList.toggle('on',!!lobbyIsGeneral);
  const genC=document.getElementById('gsGeneralCount');
  if(genC)genC.textContent=all.length?all.reduce((s,t)=>s+gsCountOf(t),0).toLocaleString():'';

  if(!all.length){list.innerHTML='<div class="gs-topic-empty">Loading…</div>';gsRenderPicked();return;}
  const filter=(document.getElementById('gsTopicSearch')?.value||'').toLowerCase();
  const pickedKeys=new Set((lobbyTopics||[]).map(t=>t.key));
  if(gsPickedOnly&&!pickedKeys.size)gsPickedOnly=false;
  const po=document.getElementById('gsPickedOnlyBtn');
  if(po){po.classList.toggle('on',gsPickedOnly);po.disabled=!pickedKeys.size;const ic=po.querySelector('i');if(ic)ic.className='ti '+(gsPickedOnly?'ti-square-check':'ti-square');}
  const items=all.filter(t=>t.name.toLowerCase().includes(filter)&&(!gsPickedOnly||pickedKeys.has(t.key)));
  if(!items.length&&gsPickedOnly){list.innerHTML='<div class="gs-topic-empty">None of your picks match that.</div>';gsRenderPicked();return;}
  if(!items.length){
    list.innerHTML='<div class="gs-topic-empty">No topic matches that. <button class="tp-more" onclick="suSuggest(\'\')" style="margin-left:6px">SUGGEST IT</button></div>';
    gsRenderPicked();return;
  }
  const sorted=items.slice().sort((x,y)=>{
    const xe=gsCountOf(x)===0, ye=gsCountOf(y)===0;
    if(xe!==ye)return xe?1:-1;
    return x.name.localeCompare(y.name);
  });
  let html='', letter=null;
  sorted.forEach(t=>{
    const n=gsCountOf(t), empty=n===0;
    const L=empty?'—':t.name[0].toUpperCase();
    if(L!==letter){letter=L;html+='<div class="tp-div"><b>'+(empty?'NOTHING IN THIS FORMAT':L)+'</b><i></i></div>';}
    const on=lobbyTopics.some(s=>s.key===t.key);
    html+='<div class="tp-row'+(on?' on':'')+(empty?' empty':'')+(gsHl===t.key?' hl':'')+'"'
      +' onmouseenter="gsHighlight(\''+t.key+'\')"'
      +(empty?'':' onclick="gsTopicToggle(\''+t.key+'\',\''+(t.emoji||'')+'\',\''+String(t.name).replace(/'/g,"\\'")+'\',\''+(t.type||'anime')+'\')"')
      +'><span class="ck">'+(on?'<i class="ti ti-check"></i>':(gsHl===t.key?'<i class="ti ti-chevron-right"></i>':''))+'</span>'
      +'<span class="nm">'+t.name+'</span><span class="ct">'+(empty?'—':n)+'</span></div>';
  });
  list.innerHTML=html;
  if(!isHost&&gsTopicScrollTarget)list.scrollTop=gsTopicScrollTarget;
  gsRenderPicked();
  if(gsHl)gsHighlight(gsHl);
}
function gsHighlight(key){
  gsHl=key;
  const t=gsAllTopics().find(x=>x.key===key);
  if(!t)return;
  document.querySelectorAll('#gsTopicList .tp-row').forEach(r=>r.classList.remove('hl'));
  applyPoster(document.getElementById('gsPoster'),t);
  document.getElementById('gsPvName').textContent=t.name;
  document.getElementById('gsPvMeta').textContent='Series pool';
  const lead=cntFmtFor(lobbyFormat), n=gsCountOf(t);
  const big=document.getElementById('gsPvBig');
  big.style.display='flex';
  document.getElementById('gsPvBigN').textContent=n||'—';
  document.getElementById('gsPvBigL').textContent=(GS_FMT_LABEL[lobbyFormat]||'Text').charAt(0)+(GS_FMT_LABEL[lobbyFormat]||'TEXT').slice(1).toLowerCase()+' questions';
  const rows=[['mc','Text · MC'],['type','Text · TTA'],['scene','Scene'],['char','Characters']];
  document.getElementById('gsPvRows').innerHTML=rows.map(([k,l])=>{
    const c=t.counts?(t.counts[k]||0):0;
    return '<div class="tp-pv-row'+(k===lead?' lead':'')+'"><span>'+l+(k===lead?' <span class="playing">· PLAYING</span>':'')+'</span><b>'+(c||'—')+'</b></div>';
  }).join('');
  const add=document.getElementById('gsPvAdd');
  const on=lobbyTopics.some(s=>s.key===key);
  add.style.display=(n===0||!isHost)?'none':'flex';
  document.getElementById('gsPvAddLabel').textContent=on?'REMOVE THIS TOPIC':'ADD THIS TOPIC';
}
function gsAddHighlighted(){
  if(!gsHl||!isHost)return;
  const t=gsAllTopics().find(x=>x.key===gsHl);
  if(!t||gsCountOf(t)===0)return;
  gsTopicToggle(t.key,t.emoji||'',t.name,t.type||'anime');
}
/* 36b: the footer stays one line — chips then a +N MORE counter, never a wrap */
function gsRenderPicked(){
  const label=document.getElementById('gsPickedLabel');if(!label)return;
  const all=gsAllTopics();
  const sel=lobbyTopics||[];
  label.textContent='PICKED · '+(lobbyIsGeneral?'GENERAL':sel.length);
  const chips=document.getElementById('gsPickedChips');
  if(lobbyIsGeneral||!sel.length){
    chips.innerHTML=lobbyIsGeneral
      ?'<span class="tp-name">🌐 General Anime</span>'
      :'<span style="font-size:11px;font-weight:800;color:var(--muted)">Nothing picked — General Anime plays instead.</span>';
  } else {
    const recent=sel.slice().reverse();
    const shown=recent.slice(0,4), hidden=recent.length-shown.length;
    chips.innerHTML=shown.map((t,i)=>{
      const full=all.find(x=>x.key===t.key), n=full?gsCountOf(full):0;
      return (i?'<span class="tp-sep">·</span>':'')+'<span class="tp-name'+(n?'':' zero')+'">'+t.name+'</span>';
    }).join('')+(hidden>0?'<span class="tp-sep">·</span><span class="tp-more-t">+'+hidden+' more</span>':'');
  }
  gsRenderPickedPop();
  const partsEl=document.getElementById('gsParts');
  if(partsEl)partsEl.innerHTML=lobbyIsGeneral?'':partsRowHTML(sel,lobbyTopicParts,lobbyFormat,'gsTogglePart');
  lrUpdateStart();
  const total=gsPoolTotal();
  document.getElementById('gsPoolTotal').textContent=total.toLocaleString();
  document.getElementById('gsPoolLabel').textContent='questions · '+(lobbyIsGeneral||!sel.length?'General Anime':sel.length+' topic'+(sel.length===1?'':'s'));
}
var gsPickedOnly=false, gsPopOpen=false;
function gsTogglePickedOnly(){gsPickedOnly=!gsPickedOnly;gsRenderTopicList();}
function gsTogglePickedPop(force){gsPopOpen=force!=null?force:!gsPopOpen;gsRenderPickedPop();}
function gsClearPicked(){if(!isHost)return;lobbyTopics=[];lobbyIsGeneral=true;gsPopOpen=false;gsPickedOnly=false;gsAfterChange();}
function gsRenderPickedPop(){
  const pop=document.getElementById('gsPickedPop');if(!pop)return;
  const sel=(!lobbyIsGeneral&&lobbyTopics)||[];
  if(!gsPopOpen||!sel.length){pop.style.display='none';if(!sel.length)gsPopOpen=false;return;}
  const all=gsAllTopics();
  const rows=sel.map(t=>{const f=all.find(x=>x.key===t.key);return {t,n:f?gsCountOf(f):0};})
    .sort((a,b)=>(b.n>0)-(a.n>0)||b.n-a.n||a.t.name.localeCompare(b.t.name));
  const total=rows.reduce((s,r)=>s+r.n,0), zeros=rows.filter(r=>!r.n).length;
  const row=r=>'<div class="tp-pop-row'+(r.n?'':' zero')+'"><span class="nm">'+r.t.name+'</span><span class="ct">'+(r.n||'—')+'</span>'
    +(isHost?'<button onclick="gsTopicToggle(\''+r.t.key+'\',\'\',\''+String(r.t.name).replace(/'/g,"\\'")+'\',\''+(r.t.type||'anime')+'\')" aria-label="Remove"><i class="ti ti-x" style="font-size:12px"></i></button>':'')+'</div>';
  const has=rows.filter(r=>r.n), none=rows.filter(r=>!r.n);
  pop.innerHTML='<div class="tp-pop-hd"><span class="tp-pop-t">ALL '+sel.length+' PICKED</span><span class="tp-pop-s">'+sel.length+' topics · '+total.toLocaleString()+' questions</span>'
    +(isHost?'<button class="tp-pop-clear" onclick="gsClearPicked()">CLEAR ALL</button>':'<span style="margin-left:auto"></span>')
    +'<button class="tp-pop-x" onclick="gsTogglePickedPop(false)" aria-label="Close"><i class="ti ti-x" style="font-size:15px"></i></button></div>'
    +'<div class="tp-pop-list">'+has.map(row).join('')
    +(none.length?'<div class="tp-pop-div">NO QUESTIONS IN THIS FORMAT · '+none.length+'</div>'+none.map(row).join(''):'')+'</div>';
  pop.style.display='flex';
  const foot=pop.parentElement, clip=pop.closest('.gs-panel')||pop.closest('.lr-scroll');
  if(foot&&clip){const room=foot.getBoundingClientRect().top-clip.getBoundingClientRect().top-12;pop.style.maxHeight=Math.max(120,Math.min(300,room))+'px';}
}
document.addEventListener('click',e=>{if(gsPopOpen&&!e.target.closest('#gsPickedPop')&&!e.target.closest('.tp-more')){gsPopOpen=false;gsRenderPickedPop();}});
function lrUpdateStart(){
  const sum=document.getElementById('lrSummary'), btn=document.getElementById('startLobbyBtn');
  if(!sum)return;
  const fc=GS_FMT_CARDS.find(x=>x.id===(GS_FMT_BASE[lobbyFormat]||'text'));
  const md=GS_MODES.find(x=>x.id===lobbyMode)||{e:'',name:'—'};
  const sel=(!lobbyIsGeneral&&lobbyTopics)||[];
  const topics=sel.length?sel.length+' topic'+(sel.length===1?'':'s'):'General Anime';
  const length=lobbyMode==='race'?'to '+mpRaceTarget+' pts'
    :lobbyMode==='slowreveal'?'to '+srTargetScore+' pts'
    :lobbyMode==='survival'?selectedLives+(selectedLives===1?' life':' lives')
    :lobbyMode==='potato'?hpLives+(hpLives===1?' life':' lives')
    :selectedQuestionLimit+' questions';
  const clock=lobbyMode==='potato'?hpFuseMin+'–'+hpFuseMax+'s fuse':raceTimeLimit+'s';
  const loaded=animeTopics.length;
  const empty=loaded&&gsPoolTotal()===0;
  const parts=[(fc?fc.e+' ':'')+(fc?fc.name:'—'),md.e+' '+md.name,topics,length,clock];
  sum.classList.toggle('blocked',!!empty);
  sum.style.display=empty?'':'none';
  sum.innerHTML=empty
    ?'<span>⚠️ No <b>'+(fc?fc.name:'')+'</b> questions for '+(sel.length?'these topics':'this pool')+' — change the format or topics</span>'
    :'';
  if(btn&&isHost){btn.classList.toggle('no-pool',!!empty);btn.disabled=!!empty;if(empty)btn.classList.remove('ready-pulse');}
}
function gsTopicToggle(key,emoji,name,type){
  lobbyIsGeneral=false;
  const idx=lobbyTopics.findIndex(t=>t.key===key);
  if(idx>=0)lobbyTopics.splice(idx,1);else lobbyTopics.push({key,emoji,name,type});
  if(!lobbyTopics.length)lobbyIsGeneral=true;
  gsAfterChange();
}
let _gsTopicsLoading=null;
async function gsEnsureTopics(){
  if(animeTopics.length)return;
  if(!_gsTopicsLoading)_gsTopicsLoading=Promise.resolve(loadTopicsFromSupabase()).catch(()=>{}).finally(()=>{
    _gsTopicsLoading=null;
    gsRenderTopicList();
    if(typeof gsRenderPool==='function')try{gsRenderPool()}catch(e){}
  });
  return _gsTopicsLoading;
}
function gsRenderAcc(){
  const t=gsActiveTab||'format';
  document.querySelectorAll('#lobbyOptionsPanel .gs-tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===t));
  document.querySelectorAll('#lobbyOptionsPanel .gs-pane').forEach(el=>el.classList.toggle('active',el.dataset.pane===t));
}
function gsTab(name){
  gsActiveTab=name;
  gsRenderAcc();
  if(name==='topic')gsEnsureTopics();
  broadcastLobbySettings(true);
}
// Settings are now inline in the lobby room (no modal).
async function startLobbyGame(){
  if(!isHost)return;
  if(animeTopics.length&&gsPoolTotal()===0)return;
  lobbyInGame=true;
  clearLobbyTimer();
  selectedFormat=lobbyFormat;selectedMode=lobbyMode;
  // Sync topic state so fetchQuestion() uses the lobby's chosen topics, not stale solo state
  selectedTopics=lobbyTopics;isGeneralSelected=lobbyIsGeneral;
  const startingLives=lobbyMode==='survival'?selectedLives:lobbyMode==='potato'?hpLives:3;
  lobbyPlayers.forEach(p=>{p.score=0;p.lives=startingLives;p.eliminated=false;});
  score=0;lives=startingLives;qIndex=0;mpDbQIndex=0;mpShownDbQIndex=0;prefetchedRpcPromise=null;prefetchedRpcResult=null;answered=false;quizHistory=[];hpHistory=[];mpCancelBackup(mpActiveFuseBackupId);mpCancelBackup(mpActiveAutoNextBackupId);prefetchedQuestion=null;currentQData=null;reportedQuestionIds=new Set();mpAutoNextFiredForQ=null;
  hpActiveIdx=0;mpTiebreakerPlayers=[];hpTurnOrder=[];
  // In Hot Potato, shuffle the full player list once into hpTurnOrder so the
  // turn sequence is consistent across all clients and isn't just lobby join order
  if(lobbyMode==='potato'&&lobbyPlayers.length>0){
    const names=lobbyPlayers.map(p=>p.name);
    for(let i=names.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[names[i],names[j]]=[names[j],names[i]];}
    hpTurnOrder=names;
  }
  mpFlagsThisQuestion=new Set();mpFlagWindowOpen=false;mpPlayerFlagWindows={};
  mpSnapshotScores();
  // A rematch reuses this same lobby row rather than creating a fresh one, so
  // Supabase-side progression state (current_q_index/current_question/etc.),
  // scores (mp_submit_answer increments rather than sets), and question_answers
  // rows all carry over from the previous game unless explicitly cleared here.
  // Awaited before anything below reads that state, so the very first
  // mp_advance_question call of a new game never mistakes leftover state from
  // the last one for "already advanced".
  const{error:resetError}=await sb.rpc('mp_reset_lobby_progression',{p_lobby_id:currentLobbyId,p_starting_lives:startingLives});
  if(resetError)console.error('mp_reset_lobby_progression failed — proceeding anyway, same risk as before this existed:',resetError);
  rtSetLobbyStatus('active');
  document.getElementById('mpHudLabel').textContent=fmtLabels[selectedFormat]+' · '+lobbyModeLabel(selectedMode);
  document.getElementById('mpQBadge').textContent=fmtLabels[selectedFormat]+' · '+lobbyModeLabel(selectedMode);
  if(rtChannel){
    rtChannel.send({type:'broadcast',event:'game_started',payload:{format:lobbyFormat,mode:lobbyMode,players:lobbyPlayers,topics:lobbyTopics,isGeneral:lobbyIsGeneral,srTargetScore:srTargetScore,mpRaceTarget:mpRaceTarget,survivalLives:selectedLives,hpLives:hpLives,hpFuseMin:hpFuseMin,hpFuseMax:hpFuseMax,hpActiveIdx,hpTurnOrder,showTyping:lobbyShowTyping}});
    // No first-question prefetch here: mp_advance_question starts the server clock
    // when it runs, so calling it during the countdown cost the first question's
    // speed points. mpHostFetchAndBroadcast fetches it live when the countdown ends.
    // Show the countdown while still on the lobby page, then transition to mp-quiz
    // once it finishes. This prevents the quiz UI from flashing behind the overlay.
    const hpFirstHolder=lobbyMode==='potato'?(hpTurnOrder[0]||lobbyPlayers[hpActiveIdx]?.name):null;
    if(lobbyMode==='slowreveal'){
      mpShowCountdown(()=>{_origGoStep('mp-quiz');mpResetQuestionCard();renderMPHUD();srHostFetchAndBroadcast();},hpFirstHolder);
    } else {
      mpShowCountdown(()=>{_origGoStep('mp-quiz');mpResetQuestionCard();renderMPHUD();mpHostFetchAndBroadcast();},hpFirstHolder);
    }
  } else {
    mpShowCountdown(()=>{_origGoStep('mp-quiz');mpResetQuestionCard();renderMPHUD();mpLoadQuestion();});
  }
}

async function rtSetLobbyStatus(status){
  // Updates lobby status — 'active' hides it from the public list, 'finished' marks it done.
  // Must use a real session token here, not the raw anon key: every other write to this
  // table (create, delete, host-transfer) authenticates with rtGetAuthToken(), which
  // suggests lobbies' UPDATE policy checks auth.uid() = host_id. Authenticating with the
  // bare anon key resolves auth.uid() to null, so RLS silently filters the PATCH down to
  // zero affected rows — no error thrown, nothing to catch — and the lobby stays stuck at
  // 'waiting' in the DB forever while the host's local countdown runs as if it had started.
  // Using return=representation (instead of minimal) lets us detect that zero-rows case,
  // since a 0-row RLS filter still comes back as a normal 200/204, not a 4xx.
  if(SUPABASE_URL.includes('YOUR_PROJECT')||!lobbyCode)return;
  try{
    const token=await rtGetAuthToken();
    const res=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?code=eq.${encodeURIComponent(lobbyCode)}`,{
      method:'PATCH',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Prefer':'return=representation'},
      body:JSON.stringify({status})
    });
    const rows=res.ok?await res.json().catch(()=>[]):[];
    if(!Array.isArray(rows)||!rows.length){
      console.warn('rtSetLobbyStatus: PATCH affected 0 rows (likely rejected by RLS) — status='+status,res.status);
    }
  }catch(e){console.warn('rtSetLobbyStatus failed:',e);}
}

async function rtDeleteLobby(){
  // Deletes the lobby row. lobby_players rows are removed automatically
  // via ON DELETE CASCADE, so no separate player delete is needed.
  if(SUPABASE_URL.includes('YOUR_PROJECT')||!lobbyCode)return;
  try{
    const token=await rtGetAuthToken();
    await fetch(`${SUPABASE_URL}/rest/v1/lobbies?code=eq.${encodeURIComponent(lobbyCode)}`,{
      method:'DELETE',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Prefer':'return=minimal'}
    });
  }catch(e){console.warn('[rtDeleteLobby] failed:',e);}
}
// ── LOBBY LIST LIVE UPDATES ───────────────────────────────────
let lobbyListChannel = null;
function subscribeToLobbyList() {
  if (SUPABASE_URL.includes('YOUR_PROJECT')) return;
  if (lobbyListChannel) return;
  lobbyListChannel = sb.channel('public-lobby-list')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'lobbies'
    }, (change) => {
      const onMultiplayerPage = document.getElementById('page-multiplayer').classList.contains('active');
      if (!onMultiplayerPage) return;

      if (change.eventType === 'UPDATE') {
        // Surgically update just the affected card — no fetch, no spinner
        patchLobbyListCard(change.new);
      } else {
        // INSERT or DELETE — card count changes, reload silently (no spinner)
        loadPublicLobbies(true);
      }
    })
    // Also listen for lobby_players changes so player counts update in real time
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'lobby_players'
    }, async () => {
      const onMultiplayerPage = document.getElementById('page-multiplayer').classList.contains('active');
      if (!onMultiplayerPage) return;
      // Surgically patch just the player count on each visible card — no full re-render
      const cards = document.querySelectorAll('.lobby-list-card');
      if (!cards.length) return;
      // Collect visible lobby ids from join buttons
      const idMap={};
      cards.forEach(card=>{
        const btn=card.querySelector('button[onclick^="joinLobbyById"]');
        if(!btn)return;
        const match=btn.getAttribute('onclick').match(/joinLobbyById\('([^']+)','([^']+)'\)/);
        if(match)idMap[match[1]]={card,code:match[2]};
      });
      const ids=Object.keys(idMap);
      if(!ids.length)return;
      try{
        const pcRes=await fetch(
          `${SUPABASE_URL}/rest/v1/lobby_players?select=lobby_id&lobby_id=in.(${ids.join(',')})`,
          {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
        );
        const pcData=await pcRes.json();
        const counts={};
        if(Array.isArray(pcData))pcData.forEach(r=>{counts[r.lobby_id]=(counts[r.lobby_id]||0)+1;});
        ids.forEach(id=>{
          const {card}=idMap[id];
          const countEl=card.querySelector('.lobby-list-players');
          if(!countEl)return;
          const max=parseInt(countEl.textContent.split('/')[1])||12;
          const count=counts[id]||0;
          countEl.innerHTML=`<i class="ti ti-users" style="font-size:12px"></i> ${count}/${max}`;
          const full=count>=max;
          card.classList.toggle('lobby-guest-lock',full);
        });
      }catch(e){}
    })
    .subscribe();
}

function patchLobbyListCard(lobby) {
  // Find the card by its join button's lobby id
  const btn = document.querySelector(`button[onclick="joinLobbyById('${lobby.id}','${lobby.code}')"]`);
  const card = btn ? btn.closest('.lobby-list-card') : null;
  if (!card) { loadPublicLobbies(); return; } // card not visible — do a full reload
  const fmt = lobby.format || 'mc';
  const mode = lobby.mode || 'race';
  const qCount = lobby.question_count||(mode==='race'?100:mode==='survival'||mode==='potato'?3:10);
  const livesCount = lobby.lives||(mode==='survival'||mode==='potato'?3:null);
  const fmtName = {mc:'Multiple Choice',type:'Type Answer',scene:'Guess the Scene',char:'Name Character'}[fmt] || fmt;
  const modeName = {classic:'Classic',race:'Score Race',survival:'Survival',potato:'Hot Potato',slowreveal:'Slow Reveal'}[mode] || mode;
  const timeBadge = (mode==='race'||mode==='survival'||mode==='classic')&&lobby.time_limit?`<span class="lobby-list-badge">⏱ ${lobby.time_limit}s</span>`:'';
  const goalBadge = mode==='survival'
    ?`<span class="lobby-list-badge">❤️ ${livesCount} Lives</span><span class="lobby-list-badge">📋 ${qCount}Q</span>`
    :mode==='race'?`<span class="lobby-list-badge">🏁 ${qCount} Pts</span>`
    :mode==='potato'?`<span class="lobby-list-badge">❤️ ${livesCount} Lives</span>`
    :mode==='slowreveal'?`<span class="lobby-list-badge">🎯 ${qCount} Pts</span>`
    :`<span class="lobby-list-badge">📋 ${qCount}Q</span>`;
  const metaEl = card.querySelector('.lobby-list-meta');
  if (metaEl) {
    metaEl.innerHTML = `
      <span class="lobby-list-badge">${fmtEmoji[fmt]||'🎮'} ${fmtName}</span>
      <span class="lobby-list-badge">${modeEmoji[mode]||'🎮'} ${modeName}</span>
      ${goalBadge}
      ${timeBadge}`;
  }
  // Also refresh the player count from the DB so it doesn't go stale
  if (!SUPABASE_URL.includes('YOUR_PROJECT') && lobby.id) {
    fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=lobby_id&lobby_id=eq.${lobby.id}`, { headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`} })
      .then(r=>r.json()).then(rows=>{
        const count = Array.isArray(rows) ? rows.length : 1;
        const max = mode==='hp' ? 8 : 12;
        const countEl = card.querySelector('.lobby-list-players');
        if (countEl) countEl.innerHTML = `<i class="ti ti-users" style="font-size:12px"></i> ${count}/${max}`;
        // If lobby just filled up, lock the join button
        if (count >= max && btn) { btn.disabled = true; btn.textContent = 'Full'; btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }
      }).catch(()=>{});
  }
}

function unsubscribeFromLobbyList() {
  if (lobbyListChannel) { lobbyListChannel.unsubscribe(); lobbyListChannel = null; }
}

// Safe "Home" navigation — if the player is still attached to a lobby (e.g. they
// just finished a multiplayer game and the lobby room/channel are still live),
// show the stay/leave confirmation modal instead of leaving silently. Only
// truly outside a lobby/game does this go straight to landing.
function goHome(){
  requestLobbyNav(()=>goStep('landing'));
}

// Safe "Profile" navigation — same lobby/game guard as goHome(), since the
// Profile button in the nav (desktop pill, mobile drawer) is reachable while
// a player is sitting in a lobby room or mid multiplayer game.
function goProfile(){
  if(!isGuest&&!currentUser){pendingDestination='profile';goStep('auth');return;}
  requestLobbyNav(()=>goStep('profile'));
}

async function leaveLobbyRoom(){
  stopHeartbeat();
  clearLobbyTimer();
  cancelHostGracePeriod(); // tidy up any running grace period on explicit leave
  intentionalLeave=true;
  voidingEnabled=false; // reset so next lobby starts with the safe default
  lobbyShowTyping=true; // reset to default
  lobbyHideSpoilers=false; // next lobby starts with spoilers allowed, the default
  lobbyTopicParts={};
  currentLobbyId=null;
  try{ sessionStorage.removeItem('current_lobby_id'); }catch(e){}
  if(!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT')||!lobbyCode){
    if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
    isHost=false;
    goStep('landing');
    return;
  }
  const token=await rtGetAuthToken();
  let lid=null;
  try{
    const lRes=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?select=id&code=eq.${lobbyCode}&limit=1`,{headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
    const lData=await lRes.json();
    lid=Array.isArray(lData)?lData[0]?.id:null;
  }catch(e){}
  if(lid){
    try{await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lid}&user_id=eq.${currentUserId}`,{method:'DELETE',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Prefer':'return=minimal'}});}catch(e){}
    let remaining=[];
    try{
      const pRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=user_id,username&lobby_id=eq.${lid}&order=joined_at.asc&limit=1`,{headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
      remaining=await pRes.json();
    }catch(e){}
    const next=Array.isArray(remaining)&&remaining.length?remaining[0]:null;
    if(!next){
      await rtDeleteLobby();
    } else {
      if(isHost){
        try{
          await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lid}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:false})});
          await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lid}&user_id=eq.${next.user_id}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:true})});
        }catch(e){}
        if(rtChannel)rtChannel.send({type:'broadcast',event:'host_transferred',payload:{newHost:next.username,reason:'left',originalHostName:currentUser,remainingSeconds:lobbyTimerSecondsLeft}});
      } else {
        if(rtChannel)rtChannel.send({type:'broadcast',event:'player_left',payload:{name:currentUser}});
      }
    }
  }
  if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
  isHost=false;
  lobbyIsPrivate=false;
  goStep('landing');
}
function toggleLobbyKebab(btn){
  const menu=btn.nextElementSibling;
  const isOpen=menu.classList.contains('open');
  closeLobbyKebabs();
  if(!isOpen)menu.classList.add('open');
}
function closeLobbyKebabs(){
  document.querySelectorAll('.lobby-kebab-menu.open').forEach(m=>m.classList.remove('open'));
}
// Close kebab menus when clicking outside
document.addEventListener('click',e=>{
  if(!e.target.closest('.lobby-kebab-wrap'))closeLobbyKebabs();
});
let _transferTarget=null;
function promptTransferHost(name){
  if(!isHost)return;
  _transferTarget=name;
  document.getElementById('transferTargetName').textContent=name;
  document.getElementById('transferHostModal').style.display='flex';
  applyTheme();
}
async function confirmTransferHost(){
  if(!isHost||!_transferTarget)return;
  document.getElementById('transferHostModal').style.display='none';
  // Update local player list immediately for UI
  lobbyPlayers.forEach(p=>{p.isHost=(p.name===_transferTarget);});
  // Broadcast to all players BEFORE touching isHost so the broadcast still fires as host
  if(rtChannel){
    rtChannel.send({type:'broadcast',event:'host_transferred',payload:{newHost:_transferTarget,reason:'manual',remainingSeconds:lobbyTimerSecondsLeft}});
  }
  // Update Supabase — keep isHost=true until all writes are done so RLS passes
  if(currentUserId&&!SUPABASE_URL.includes('YOUR_PROJECT')){
    try{
      const token=await rtGetAuthToken();
      const lRes=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?select=id&code=eq.${lobbyCode}&limit=1`,{headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
      const lData=await lRes.json();
      const lid=Array.isArray(lData)?lData[0]?.id:null;
      if(lid){
        // Get the new host's user_id from the in-memory lobbyPlayers array — avoids
        // a round-trip DB lookup and the encodeURIComponent encoding issues that caused
        // the previous username-based query to silently return nothing.
        const newHostPlayer=lobbyPlayers.find(p=>p.name===_transferTarget);
        const newHostUid=newHostPlayer?.userId||null;
        if(newHostUid){
          // 1. Demote current host's own row
          const d1=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lid}&user_id=eq.${currentUserId}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:false})});
          if(!d1.ok)console.error('[Transfer] demote self failed:',d1.status,await d1.text());
          // 2. Promote new host's row
          const d2=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lid}&user_id=eq.${newHostUid}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:true})});
          if(!d2.ok)console.error('[Transfer] promote new host failed:',d2.status,await d2.text());
          // 3. Update lobbies.host_id LAST — isHost is still true here so RLS (auth.uid()=host_id) passes
          const d3=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?id=eq.${lid}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({host_id:newHostUid,host_username:_transferTarget})});
          if(!d3.ok)console.error('[Transfer] lobbies host_id update failed:',d3.status,await d3.text());
        } else {
          console.error('[Transfer] newHostUid not found in lobbyPlayers for',_transferTarget,lobbyPlayers);
        }
      }
    }catch(e){}
  }
  // All DB writes done — drop host status and stay in lobby as a regular player
  isHost=false;
  _transferTarget=null;
  renderLobbyRoom();
}
async function kickPlayer(name){
  if(!isHost)return;
  // Remove from local list
  lobbyPlayers=lobbyPlayers.filter(p=>p.name!==name);
  // Remove from Supabase and record in kicked_players
  if(currentUserId&&!SUPABASE_URL.includes('YOUR_PROJECT')){
    try{
      const token=await rtGetAuthToken();
      const lRes=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?select=id,kicked_players&code=eq.${lobbyCode}&limit=1`,{headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
      const lData=await lRes.json();
      const lobbyRow=Array.isArray(lData)?lData[0]:null;
      const lid=lobbyRow?.id;
      if(lid){
        // Delete the player row
        await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lid}&username=eq.${encodeURIComponent(name)}`,{method:'DELETE',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
        // Append their username to kicked_players so they can't rejoin
        const existing=Array.isArray(lobbyRow.kicked_players)?lobbyRow.kicked_players:[];
        if(!existing.includes(name)){
          await fetch(`${SUPABASE_URL}/rest/v1/lobbies?id=eq.${lid}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({kicked_players:[...existing,name]})});
        }
        // Broadcast with lobby_id so kicked player can delete their own row
        if(rtChannel)rtChannel.send({type:'broadcast',event:'player_kicked',payload:{kicked:name,lobby_id:lid}});
      }
    }catch(e){
      if(rtChannel)rtChannel.send({type:'broadcast',event:'player_kicked',payload:{kicked:name}});
    }
  } else {
    if(rtChannel)rtChannel.send({type:'broadcast',event:'player_kicked',payload:{kicked:name}});
  }
  renderLobbyRoom();
}

let hpActiveIdx=0;
let hpTurnOrder=[]; // shuffled array of player names, set at game start and used for the whole game
function hpActivePlayers(){return hpTurnOrder.map(n=>lobbyPlayers.find(p=>p.name===n)).filter(p=>p&&!p.eliminated)}
function hpActivePlayer(){
  const order=hpTurnOrder.length?hpTurnOrder:lobbyPlayers.map(p=>p.name);
  const total=order.length;
  if(!total)return lobbyPlayers[0]||{name:'?',color:'#888',lives:0,eliminated:false};
  let idx=hpActiveIdx%total;
  // Skip eliminated players — walk forward until we find a live one
  let guard=0;
  while(guard<total){
    const p=lobbyPlayers.find(lp=>lp.name===order[idx]);
    if(p&&!p.eliminated)return p;
    idx=(idx+1)%total;guard++;
  }
  return lobbyPlayers.find(p=>!p.eliminated)||lobbyPlayers[0];
}
function hpPeekNextPlayer(){
  // Returns the player who will hold the potato after the current holder, without advancing hpActiveIdx.
  const order=hpTurnOrder.length?hpTurnOrder:lobbyPlayers.map(p=>p.name);
  const total=order.length;
  if(total===0)return null;
  let next=(hpActiveIdx+1)%total;
  let guard=0;
  while(guard<total){
    const p=lobbyPlayers.find(lp=>lp.name===order[next]);
    if(p&&!p.eliminated)return p;
    next=(next+1)%total;guard++;
  }
  return null;
}
function hpIsMyTurn(){return lobbyMode==='potato'&&hpActivePlayer().name===currentUser}

function renderMPHUD(){
  const isHP=lobbyMode==='potato';
  const isSurvival=selectedMode==='survival';
  const isSR=lobbyMode==='slowreveal';
  const active=isHP?hpActivePlayer():null;
  const isMyTurn=isHP&&active.name===currentUser;

  // ── HP my-turn full-screen glow ──────────────────────────────
  document.body.classList.toggle('hp-my-turn',!!(isHP&&isMyTurn));

  // ── HP turn banner ────────────────────────────────────────────
  const banner=document.getElementById('hpTurnBanner');
  if(banner){
    if(isHP&&active){
      const heartsHTML=Array.from({length:hpLives},(_,j)=>{
        const lost=j>=active.lives;
        const prevL=hpPrevLives[active.name];
        const justLost=prevL!=null&&active.lives<prevL&&j===active.lives;
        return `<i class="ti ti-heart${justLost?' hp-life-lost':''}" style="font-size:14px;color:${lost?'var(--border2)':'#f87171'};${active.eliminated?'opacity:.3':''}"></i>`;
      }).join('');
      const eyebrow=isMyTurn?'🔥 Your turn. Type your answer!':'👀 Watching…';
      const sub=isMyTurn?'The potato is in your hands. Answer before it explodes!':'Waiting for '+active.name+' to answer…';
      const activeAvatarHTML=active.avatar&&!active.avatar.startsWith('preset:')
        ?`<img src="${active.avatar}" alt="${active.name}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);flex-shrink:0;${isMyTurn?'animation:hpPotatoBob 1.6s ease-in-out infinite':''}">`
        :`<div style="width:48px;height:48px;border-radius:50%;background:${active.color||'var(--accent)'};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Lilita One',cursive;font-size:20px;flex-shrink:0;border:2px solid var(--accent);${isMyTurn?'animation:hpPotatoBob 1.6s ease-in-out infinite':''}">${active.name[0].toUpperCase()}</div>`;
      banner.innerHTML=`<div class="hp-turn-banner ${isMyTurn?'my-turn':'their-turn'}">${activeAvatarHTML}<div class="hp-turn-body"><div class="hp-turn-eyebrow">${eyebrow}</div><div class="hp-turn-name">${active.name}</div><div class="hp-turn-sub">${sub}</div></div><div class="hp-turn-hearts">${heartsHTML}</div></div>`;
      banner.style.display='block';
    } else {
      banner.style.display='none';
    }
  }

  // ── Standard HUD ─────────────────────────────────────────────
  const displayScore=isHP
    ?'🥔 Hot Potato'
    :(isSurvival||lobbyMode==='classic')
      ? quizHistory.filter(h=>h.correct).length+' correct'
      :isSR
        ? score+' / '+srTargetScore+' pts'
        : score+' pts';
  document.getElementById('mpScoreDisplay').textContent=displayScore;
  document.getElementById('mpQCount').textContent='Q'+(qIndex+1);
  // Hearts move to the banner in HP mode
  const ld=document.getElementById('mpLivesDisplay');ld.innerHTML='';
  if(!isHP&&(selectedMode==='survival')){
    const maxHearts=selectedLives;
    for(let i=0;i<maxHearts;i++){const h=document.createElement('span');h.className='life'+(i>=lives?' lost':'');h.innerHTML='<i class="ti ti-heart"></i>';ld.appendChild(h)}
  }
  renderMPScoreboard();
}

function renderMPScoreboard(){
  const sb=document.getElementById('mpScoreboard');sb.innerHTML='';
  const isHP=lobbyMode==='potato';
  const isSurvival=selectedMode==='survival';
  const isTyping=(selectedFormat==='type'||selectedFormat==='char')&&selectedFormat!=='char-mc';
  const sorted=isHP
    // HP: render in shuffled turn order so Live Scores matches the hand-off sequence
    ?(hpTurnOrder.length?hpTurnOrder.map(n=>lobbyPlayers.find(p=>p.name===n)).filter(Boolean):[...lobbyPlayers])
    :isSurvival
      ?[...lobbyPlayers].sort((a,b)=>(a.eliminated===b.eliminated?0:a.eliminated?1:-1)||b.lives-a.lives||(b.roundPts||0)-(a.roundPts||0))
      :[...lobbyPlayers].sort((a,b)=>b.score-a.score);
  sorted.forEach((p,i)=>{
    const isMe=p.name===currentUser;
    const isActive=isHP&&!p.eliminated&&hpActivePlayer().name===p.name;
    const hasQuit=!!p.quit;
    const isOffline=!hasQuit&&p.connected===false;
    const row=document.createElement('div');row.className='mp-score-row'+(isMe?' me':'');
    if(hasQuit)row.style.opacity='.4';
    else if(isOffline)row.style.opacity='.6';
    if(isActive){
      row.classList.add('hp-active');
    }
    const ansIcon=p.roundAnswered&&!hasQuit?`<span style="font-size:11px;margin-right:4px">${p.roundCorrect?'<i class="ti ti-circle-check" style="color:#4ade80"></i>':'<i class="ti ti-circle-x" style="color:#f87171"></i>'}</span>`:'';
    // Only show +pts round meta in race mode
    const roundMeta=p.roundAnswered&&!isHP&&!hasQuit&&!isSurvival?`<div style="font-size:10px;color:var(--muted);margin-top:1px">${p.roundElapsed}s${lobbyMode==='classic'?'':' · +'+p.roundPts+'pts'}</div>`:'';
    const quitLabel=hasQuit?` <span style="font-size:10px;color:var(--muted)">🚪 left</span>`:'';
    // Draft treatment — offline ≠ quit: no strikethrough, since they may still rejoin.
    const offlineLabel=isOffline?` <span style="font-size:10px;color:var(--muted)" title="Disconnected (may still rejoin)"><i class="ti ti-wifi-off" style="font-size:10px"></i> offline</span>`:'';
    // Wrong attempt shown below name in typing modes (including HP), only while not yet answered, and only if show-typing is on
    const wrongAttempt=lobbyShowTyping&&(isTyping||isHP)&&!p.roundAnswered&&!hasQuit&&mpWrongAttempts[p.name]
      ?`<div style="font-size:10px;color:#f87171;font-weight:700;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px" title="${mpWrongAttempts[p.name]}">✗ ${mpWrongAttempts[p.name]}</div>`
      :'';
    // Detect life-loss this render cycle to trigger animation
    const prevLives=hpPrevLives[p.name];
    const lifeLost=isHP&&prevLives!=null&&p.lives<prevLives;
    if(isHP)hpPrevLives[p.name]=p.lives;
    const rightCol=isHP||isSurvival
      ?`<div style="display:flex;gap:3px">${Array.from({length:isHP?hpLives:selectedLives},(_,j)=>{const lost=j>=p.lives;const justLost=isHP&&lifeLost&&j===p.lives;return `<i class="ti ti-heart${justLost?' hp-life-lost':''}" style="font-size:11px;color:${lost?'var(--border2)':'#f87171'};${p.eliminated?'opacity:.3':''}"></i>`}).join('')}</div>`
      :`<div style="text-align:right"><div class="mp-score-pts">${p.score}</div>${roundMeta}</div>`;
    const scoreboardAvatarEl=getLobbyAvatarHTML(p.avatar||null,p.color,p.name[0].toUpperCase(),28);
    const scoreboardAvatarStyled=scoreboardAvatarEl.replace('class="lobby-player-avatar" style="',`class="mp-score-avatar" style="${p.eliminated||hasQuit?'opacity:.4;':''}`);
    row.innerHTML=`${isActive?'<div style="font-size:15px"><span class="hp-pt" aria-label="Hot potato"><span class="hp-pt-p">🥔</span><span class="hp-pt-tag"><b>爆</b></span></span></div>':'<div style="font-size:13px;width:18px;text-align:center;font-weight:800;color:var(--muted)">'+(isHP?(p.eliminated?'💀':'·'):isSurvival?(p.eliminated?'💀':'·'):('#'+(i+1)))+'</div>'}${scoreboardAvatarStyled}<div class="mp-score-name" style="${p.eliminated||hasQuit?'text-decoration:line-through;opacity:.4':''}"><div>${ansIcon}${p.name}${isMe?' (you)':''}${quitLabel}${offlineLabel}</div>${wrongAttempt}</div>${rightCol}`;
    sb.appendChild(row);
  });
}

async function mpQuitGame(){
  intentionalLeave=true;
  stopHeartbeat();
  cancelHostGracePeriod(); // tidy up any running grace period on explicit quit
  // Mark connected=false rather than deleting the row, so the player can rejoin
  // from the multiplayer lobby list. Other clients see the player_quit broadcast
  // and mark them as quit on the scoreboard. The row is retained so
  // checkForActiveGameRejoin() can surface the rejoin card.
  if(currentUserId&&currentLobbyId&&!SUPABASE_URL.includes('YOUR_PROJECT')){
    try{
      const token=await rtGetAuthToken();
      await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${currentLobbyId}&user_id=eq.${currentUserId}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({connected:false})});
    }catch(e){console.error('[mpQuitGame] error patching row',e);}
  }
  // A quitting host keeps their row (connected=false) and so stayed "host": Hot Potato,
  // Slow Reveal and char-mc froze, and nobody could start a rematch. Hand the role to the
  // longest-waiting player who's still connected, the same way leaving the lobby does.
  if(isHost&&currentLobbyId&&!SUPABASE_URL.includes('YOUR_PROJECT')){
    try{
      const token=await rtGetAuthToken();
      const H={'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'};
      const r=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=user_id,username&lobby_id=eq.${currentLobbyId}&user_id=neq.${currentUserId}&connected=not.is.false&order=joined_at.asc&limit=1`,{headers:H});
      const next=(await r.json())?.[0];
      if(next){
        await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${currentLobbyId}`,{method:'PATCH',headers:H,body:JSON.stringify({is_host:false})});
        await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${currentLobbyId}&user_id=eq.${next.user_id}`,{method:'PATCH',headers:H,body:JSON.stringify({is_host:true})});
        await fetch(`${SUPABASE_URL}/rest/v1/lobbies?id=eq.${currentLobbyId}`,{method:'PATCH',headers:H,body:JSON.stringify({host_id:next.user_id,host_username:next.username})});
        if(rtChannel)rtChannel.send({type:'broadcast',event:'host_transferred',payload:{newHost:next.username,reason:'left',originalHostName:currentUser,remainingSeconds:lobbyTimerSecondsLeft}});
      }
    }catch(e){console.error('[mpQuitGame] host handover failed',e);}
    isHost=false;
  }
  if(rtChannel){
    rtChannel.send({type:'broadcast',event:'player_quit',payload:{name:currentUser}});
  }
  // If everyone still playing has already answered, our leaving completes the round:
  // let the server resolve it now instead of the others waiting out the clock.
  if(currentLobbyId&&currentUserId&&!SUPABASE_URL.includes('YOUR_PROJECT')){
    try{await sb.rpc('mp_check_round',{p_lobby_id:currentLobbyId});}catch(e){}
  }
  if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
  goStep('multiplayer');
}

function mpShowQuestion(qData,hpFuse){
  answered=false;
  document.getElementById('mpQCardFeedback').style.display='none';
  const mpRwSQ=document.getElementById('mpReportWrap');if(mpRwSQ)mpRwSQ.style.display='none';
  document.getElementById('mpQuestionText').innerHTML=seriesTagHTML(qData)+spoilerTagHTML(qData)+(qData.question||'Question unavailable')+fallbackHintHTML(qData);
  setTopicMark('mpQPanel',qData);
  const mpImgWrap=document.getElementById('mpQImageWrap');
  const mpImgEl=document.getElementById('mpQImage');
  const grid=document.getElementById('mpAnswersGrid');grid.innerHTML='';grid.style.cssText='display:none';
  const isType=(selectedFormat==='type'||selectedFormat==='char'||selectedFormat==='scene')&&selectedFormat!=='char-mc'||(!qData.options&&typeof qData.answer==='string'&&selectedFormat!=='char-mc');
  const isHP=lobbyMode==='potato';
  const isMyTurn=!isHP||(hpActivePlayer().name===currentUser);

  const isBlocked=mpTiebreakerPlayers.length>0&&!mpTiebreakerPlayers.includes(currentUser);
  const isSurvivalElim=lobbyMode==='survival'&&(lobbyPlayers.find(p=>p.name===currentUser)?.eliminated||false);
  let mpFocusEl=null; // element to focus once the question is revealed (set below for type/HP input)

  let gridFinalCss=''; // final grid.style.cssText to apply once the question is revealed
  if(isSurvivalElim){
    // Show a spectator message — eliminated players can't answer
    gridFinalCss='display:flex;justify-content:center'; // override the 2-col answers grid so this centers across the full card width
    const msg=document.createElement('div');
    msg.style.cssText='text-align:center;padding:24px 16px;color:var(--muted);font-size:14px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:10px';
    msg.innerHTML=`<div style="font-size:32px">💀</div><div style="font-family:'Lilita One',cursive;font-size:16px;color:var(--text)">You've been eliminated</div><div>Spectating the remaining players…</div>`;
    grid.appendChild(msg);
  } else if(isType||isHP){
    // Hot Potato always uses type input; show disabled input if not your turn
    const wrap=document.createElement('div');wrap.className='type-wrap';
    const placeholder=isMyTurn?'Type your answer...':'Waiting for '+hpActivePlayer().name+'…';
    wrap.innerHTML=`<div class="type-input-row"><input id="mpTypeInput" class="type-input" type="text" placeholder="${placeholder}" autocomplete="off" ${isMyTurn&&!isBlocked?'':'disabled style="opacity:.5"'}><button class="type-submit" id="mpTypeSubmitBtn" onclick="mpCheckTypeAnswer()" ${isMyTurn&&!isBlocked?'':'disabled style="opacity:.5"'}><i class="ti ti-check" style="font-size:15px"></i> Submit</button></div><div id="mpTypeWrongHint" style="font-size:12px;color:#f87171;font-weight:700;display:none;margin-top:4px"><i class="ti ti-x" style="font-size:12px"></i> Not quite, try again!</div>`;
    grid.appendChild(wrap);applyTheme();
    if(isMyTurn&&!isBlocked){
      document.getElementById('mpTypeInput').addEventListener('keydown',e=>{if(e.key==='Enter')mpCheckTypeAnswer();});
      mpFocusEl=document.getElementById('mpTypeInput');
      if(isHP&&rtChannel){
        document.getElementById('mpTypeInput').addEventListener('input',e=>{
          const draft=e.target.value;
          hpTypingText[currentUser]=draft;
          rtChannel.send({type:'broadcast',event:'hp_typing',payload:{name:currentUser,text:draft}});
        });
      }
    }
  } else if(isBlocked){
    // Blocked spectator in tiebreaker — show a waiting message instead of answer buttons
    const names=mpTiebreakerPlayers.join(' vs ');
    const msg=document.createElement('div');
    msg.style.cssText='text-align:center;padding:24px 16px;color:var(--muted);font-size:14px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:10px';
    msg.innerHTML=`<div style="font-size:32px">⚔️</div><div style="font-family:\'Lilita One\',cursive;font-size:16px;color:var(--text)">Tiebreaker Round</div><div>${names} are tied. Watching them duel it out…</div>`;
    grid.appendChild(msg);
    // Record a pass for this round so the server can resolve it as soon as the tied
    // players answer, instead of waiting out the timer for spectators who never will.
    if(lobbyMode==='race'&&selectedFormat!=='char-mc'&&currentLobbyId&&currentUserId){
      sb.rpc('mp_submit_answer',{p_lobby_id:currentLobbyId,p_user_id:currentUserId,p_q_index:mpDbQIndex,p_choice_idx:-1,p_choice_text:null,p_mode:'pass'}).then(()=>{},()=>{});
    }
  } else {
    (qData.options||[]).forEach((opt,i)=>{
      const d=document.createElement('div');d.className='ans';
      d.innerHTML=`<span class="ans-key">${keys[i]}</span><span class="ans-text">${opt}</span>`;
      d.onclick=()=>mpAnswerMC(i,d,qData);grid.appendChild(d);
    });
  }
  quizHistory.push({q:qData.question,correctAns:qData.options?qData.options[qData.answer]:qData.answer,userAns:null,correct:null,id:qData.id||null,topic:qData.topic_value||null});
  // Hot Potato: every client (not just the active player) logs this round, tagged with
  // whichever player is holding the potato — see hpHistory declaration for why this is
  // kept separate from quizHistory.
  if(isHP){
    hpHistory.push({player:hpActivePlayer().name,q:qData.question,correctAns:qData.options?qData.options[qData.answer]:qData.answer,userAns:null,correct:null,id:qData.id||null,topic:qData.topic_value||null});
  }

  // Keep the "Generating question" spinner on screen — and the question text/answers
  // hidden — until the image (if any) has actually finished loading. Revealing the
  // text and image together avoids the layout jump/glitch of the card popping the
  // image in after the answers were already visible, and also means the timers below
  // never burn time on a blank image while it downloads.
  const revealMpQuestion=()=>{
    document.getElementById('mpQLoading').style.display='none';
    document.getElementById('mpQuestionText').style.display='block';
    grid.style.cssText=gridFinalCss;
    if(mpFocusEl)mpFocusEl.focus();
  };
  const beginMpTimers=()=>{
    revealMpQuestion();
    const questionTimeLimit=isHP?(hpFuse!=null?hpFuse:hpFuseMin+Math.random()*(hpFuseMax-hpFuseMin)):raceTimeLimit; // use host-broadcast fuse for HP
    // Hide the timer bar in Hot Potato — the fuse is intentionally secret
    const mpTimerWrapEl=document.getElementById('mpTimerWrap');
    if(mpTimerWrapEl)mpTimerWrapEl.style.display=isHP?'none':'';
    clearInterval(timerInterval);
    if(isBlocked){
      // Spectating a tiebreaker — show timer bar draining but don't fire mpTimeOut
      timeLeft=questionTimeLimit;questionStartTime=Date.now();
      const mpBar=document.getElementById('mpTimerBar');mpRailTick(100,null);
      timerInterval=setInterval(()=>{
        timeLeft=Math.max(0,questionTimeLimit-(Date.now()-questionStartTime)/1000);
        const pct=(timeLeft/questionTimeLimit)*100;
        mpRailTick(pct,timeLeft);
        if(timeLeft<=0)clearInterval(timerInterval); // just stop — host handles next step
      },100);
      return;
    }
    // Eliminated players in survival sit out the round — immediately mark answered
    // so the host's allAnswered check never waits on them
    if(isSurvivalElim){
      answered=true;
      const me=lobbyPlayers.find(p=>p.name===currentUser);
      if(me){me.roundAnswered=true;me.roundCorrect=false;me.roundPts=0;}
      if(rtChannel)rtChannel.send({type:'broadcast',event:'answer_submitted',payload:{name:currentUser,score:score,lives:lives,eliminated:true,roundAnswered:true,roundCorrect:false,roundPts:0,roundElapsed:0}});
      // Still drain the timer bar visually so the UI doesn't look frozen
      timeLeft=questionTimeLimit;questionStartTime=Date.now();
      const mpBar=document.getElementById('mpTimerBar');mpRailTick(100,null);
      timerInterval=setInterval(()=>{
        timeLeft=Math.max(0,questionTimeLimit-(Date.now()-questionStartTime)/1000);
        const pct=(timeLeft/questionTimeLimit)*100;
        mpRailTick(pct,timeLeft);
        if(timeLeft<=0)clearInterval(timerInterval);
      },100);
      return;
    }
    questionStartTime=Date.now();
    const mpBar=document.getElementById('mpTimerBar');mpRailTick(100,null);
    // Backup trigger — see mpFuseWorker declaration for why this is needed alongside
    // the setInterval below (the interval alone can stall if this tab is backgrounded).
    // Cancelled explicitly the moment the round resolves (see mpCancelBackup call sites)
    // rather than relying solely on the answered/token checks inside the callback.
    mpCancelBackup(mpActiveFuseBackupId);
    mpActiveFuseBackupId=mpScheduleBackup(Math.ceil(questionTimeLimit*1000)+150,()=>{
      if(!answered&&document.getElementById('page-mp-quiz')?.classList.contains('active'))mpTimeOut();
    });
    timerInterval=setInterval(()=>{
      timeLeft=Math.max(0,questionTimeLimit-(Date.now()-questionStartTime)/1000);
      const pct=(timeLeft/questionTimeLimit)*100;
      mpRailTick(pct,timeLeft);
      if(timeLeft<=0){clearInterval(timerInterval);mpTimeOut();}
    },100);
  };

  if(qData.media_url){
    mpImgEl.onload=null;mpImgEl.onerror=null;
    mpImgWrap.style.display='flex';mpImgEl.style.visibility='hidden';
    mpImgEl.onload=()=>{mpImgEl.style.visibility='visible';beginMpTimers();};
    mpImgEl.onerror=()=>{mpImgWrap.style.display='none';beginMpTimers();};
    mpImgEl.src=qData.media_url;
    if(mpImgEl.complete&&mpImgEl.naturalWidth>0){mpImgEl.onload=null;mpImgEl.onerror=null;mpImgEl.style.visibility='visible';beginMpTimers();}
  } else {
    mpImgWrap.style.display='none';mpImgEl.src='';
    beginMpTimers();
  }
}

async function mpAnswerMC(idx,el,qData){
  if(answered)return;
  if(mpTiebreakerPlayers.length>0&&!mpTiebreakerPlayers.includes(currentUser))return; // blocked in tiebreaker
  answered=true;answeredQIndex=qIndex;
  mpCancelBackup(mpActiveFuseBackupId);
  const allAns=document.querySelectorAll('#mpAnswersGrid .ans');allAns.forEach(a=>a.classList.add('locked'));
  const useRpc=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
  // Correctness is knowable the instant we know which option was picked — a plain
  // index compare against the same question snapshot the server has, with none of
  // the normalization ambiguity a typed answer carries. Reveal it immediately
  // instead of waiting on the mp_submit_answer round trip; only the authoritative
  // point value (and the score sync/broadcast that depends on it) waits below.
  const correct=idx===qData.answer;
  if(correct){el.classList.add('correct');if(lobbyMode==='potato')document.body.classList.remove('hp-my-turn');}else{el.classList.add('wrong');allAns[qData.answer].classList.add('correct');}
  quizHistory[quizHistory.length-1].userAns=qData.options[idx];quizHistory[quizHistory.length-1].correct=correct;
  mpShowFeedback(correct,qData.options[qData.answer],qData.options[idx],null,null,false,null,true);
  renderMPHUD();
  let mpPts;
  if(useRpc){
    const{data,error}=await sb.rpc('mp_submit_answer',{
      p_lobby_id:currentLobbyId,p_user_id:currentUserId,p_q_index:mpDbQIndex,
      p_choice_idx:idx,p_choice_text:null,p_mode:lobbyMode
    });
    if(!error&&data&&(data.accepted||data.reason==='already_answered')){
      mpPts=data.points;
      // A disagreement here would mean the client is holding a stale question the
      // server has already moved past — genuinely rare (see mpDbQIndex/stale_question
      // handling) rather than a normalization issue like the typed-answer case.
      if(data.correct!==correct)console.error('mp_submit_answer disagreed with local MC check — stale question?',data);
    } else {
      // Couldn't reach the server — fall back to local scoring rather than
      // stalling the score sync on a network blip. The reveal already fired.
      console.error('mp_submit_answer failed, scoring locally:',error||data);
      const mpElapsed=(Date.now()-questionStartTime)/1000;
      mpPts=lobbyMode==='race'?calcSpeedPoints(mpElapsed,raceTimeLimit):1;
    }
  } else {
    const mpElapsed=(Date.now()-questionStartTime)/1000;
    mpPts=selectedMode==='race'?calcSpeedPoints(mpElapsed,raceTimeLimit):1;
  }
  if(correct){score+=mpPts;lastPtsEarned=mpPts;}else{lives--;lastPtsEarned=0;}
  mpSyncFeedbackScore(correct,qData.options[idx]);
  renderMPHUD();
}

async function mpCheckTypeAnswer(){
  if(answered)return;
  if(mpTiebreakerPlayers.length>0&&!mpTiebreakerPlayers.includes(currentUser))return; // blocked in tiebreaker
  const input=document.getElementById('mpTypeInput');
  if(!input||!input.value.trim())return;
  const userAns=input.value.trim();
  // Local check first, same as before — this is what gates the free-retry UX
  // below (wrong guesses never touch the server at all, matching current
  // behaviour). mp_submit_answer only ever gets called once we're about to
  // accept and lock in an answer, since question_answers allows exactly one
  // submission per player per question — calling it on every wrong keystroke
  // would permanently record the first wrong guess and break retries.
  const match=answerMatch(userAns,currentQData);
  const correct=!!match;
  if(match)currentQData._match=match;
  const isHP=lobbyMode==='potato';
  if(!correct){
    sfxWrongAttempt();
    // Broadcast this wrong attempt so other players can see it in the scoreboard
    if(rtChannel){
      rtChannel.send({type:'broadcast',event:'wrong_attempt',payload:{name:currentUser,attempt:userAns}});
    }
    // Also update locally so the broadcaster sees their own attempt reflected
    mpWrongAttempts[currentUser]=userAns;
    renderMPScoreboard();
    // Wrong — shake, flash red, clear and allow retry
    // In Hot Potato the life is only lost when the fuse expires (mpTimeOut), not on each wrong guess
    const card=document.querySelector('#page-mp-quiz .q-card');
    input.classList.add('wrong-attempt');
    if(card)card.classList.add('shake');
    const hint=document.getElementById('mpTypeWrongHint');
    setWrongHint(hint,answerNameNudge(userAns,currentQData));
    setTimeout(()=>{
      input.classList.remove('wrong-attempt');
      if(card)card.classList.remove('shake');
      input.value='';
      input.focus();
    },400);
    return;
  }
  // Correct answer — lock and finalise
  answered=true;answeredQIndex=qIndex;
  mpCancelBackup(mpActiveFuseBackupId);
  input.disabled=true;
  document.getElementById('mpTypeSubmitBtn').disabled=true;
  const hint=document.getElementById('mpTypeWrongHint');if(hint)hint.style.display='none';
  if(isHP){
    input.classList.add('correct-input');
    const active=hpActivePlayer();
    document.body.classList.remove('hp-my-turn');
    // Only a correct answer reaches here; life-loss on wrong answers happens in mpTimeOut
    quizHistory[quizHistory.length-1].userAns=userAns;quizHistory[quizHistory.length-1].correct=true;
    const hpLastLocal=hpHistory[hpHistory.length-1];if(hpLastLocal){hpLastLocal.userAns=userAns;hpLastLocal.correct=true;}
    const correctAns=currentQData.options?currentQData.options[currentQData.answer]:currentQData.answer;
    mpShowFeedback(true,correctAns,userAns,null,active.name,false,hpPeekNextPlayer()?.name);
    renderMPHUD();
  } else {
    // Non-HP: only reaches here on a correct answer (wrong answers return early above).
    // checkAnswer() above has already settled correctness — the JS and SQL normalizers
    // were verified to match on 2026-09-09, so reveal instantly and let the RPC below
    // settle only the authoritative point value and score sync, same as mpAnswerMC.
    const useRpc=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
    input.classList.add('correct-input');
    quizHistory[quizHistory.length-1].userAns=userAns;quizHistory[quizHistory.length-1].correct=true;
    if(match.alt)quizHistory[quizHistory.length-1].correctAns=match.text;
    mpShowFeedback(true,currentQData.answer,userAns,null,null,false,null,true);
    renderMPHUD();
    let mpTaPts;
    if(useRpc){
      const{data,error}=await sb.rpc('mp_submit_answer',{
        p_lobby_id:currentLobbyId,p_user_id:currentUserId,p_q_index:mpDbQIndex,
        p_choice_idx:null,p_choice_text:userAns,p_mode:lobbyMode
      });
      if(!error&&data&&(data.accepted||data.reason==='already_answered')){
        mpTaPts=data.points;
        // Server disagreeing with our local check here would mean the two
        // normalizers have drifted apart since the 2026-09-09 verification —
        // the server is the one that actually pays out points, so its verdict
        // decides the score even though the reveal already fired.
        if(!data.correct)console.error('mp_submit_answer disagreed with local checkAnswer() — normalizer drift?',data);
        else if(data.matched!=null&&data.matched!==match.text)console.error('mp_match_answer matched a different answer than local answerMatch() — matcher drift?',data,match);
      } else {
        // Couldn't reach the server — fall back to local scoring rather than
        // stalling the score sync on a network blip. The reveal already fired.
        console.error('mp_submit_answer failed, scoring locally:',error||data);
        const mpTaElapsed=(Date.now()-questionStartTime)/1000;
        mpTaPts=lobbyMode==='race'?calcSpeedPoints(mpTaElapsed,raceTimeLimit):1;
      }
    } else {
      const mpTaElapsed=(Date.now()-questionStartTime)/1000;
      mpTaPts=selectedMode==='race'?calcSpeedPoints(mpTaElapsed,raceTimeLimit):1;
    }
    score+=mpTaPts;lastPtsEarned=mpTaPts;
    mpSyncFeedbackScore(true,userAns);
    renderMPHUD();
  }
}

function mpTimeOut(){
  if(answered){
    // Time's up but we'd already answered. Normally the round resolves when everyone has
    // answered; if someone left or froze mid-question that never happens, so the clock
    // running out must still move the game on. mp_advance_question picks a single winner,
    // so it's safe for every client to try.
    const _useRpcAT=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
    if(_useRpcAT&&mpAutoNextFiredForQ!==qIndex&&document.getElementById('page-mp-quiz')?.classList.contains('active')){
      mpAutoNextFiredForQ=qIndex;
      clearInterval(timerInterval);
      const _capAT=lobbyMode==='survival'?survivalQuestionLimit:selectedQuestionLimit;
      const _wipedAT=selectedMode==='survival'&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated);
      mpStartAutoNext(mpRpcAdvanceAndBroadcast,_wipedAT||(lobbyMode!=='race'&&(qIndex+1)>=_capAT));
    }
    return;
  }
  answered=true;answeredQIndex=qIndex;
  clearInterval(timerInterval);
  clearInterval(mpAutoNextInterval); // cancel any in-progress auto-next from all-answered path
  mpCancelBackup(mpActiveAutoNextBackupId);
  mpCancelBackup(mpActiveFuseBackupId);
  document.querySelectorAll('#mpAnswersGrid .ans').forEach(a=>a.classList.add('locked'));
  const inp=document.getElementById('mpTypeInput');
  if(inp){inp.disabled=true;inp.classList.remove('wrong-attempt');}
  const submitBtn=document.getElementById('mpTypeSubmitBtn');if(submitBtn)submitBtn.disabled=true;
  const hint=document.getElementById('mpTypeWrongHint');if(hint)hint.style.display='none';
  const correctAns=currentQData?(currentQData.options?currentQData.options[currentQData.answer]:currentQData.answer):'?';
  const isHP=lobbyMode==='potato';
  if(isHP){
    const active=hpActivePlayer();
    active.lives--;if(active.lives<=0)active.eliminated=true;
    renderMPHUD();
    const last=quizHistory[quizHistory.length-1];if(last){last.userAns='(timed out)';last.correct=false;}
    // Every client independently detects the fuse expiring at the same moment (see the
    // hpHistory declaration comment), so this stays in sync across all players without
    // needing a network round-trip.
    const hpLastTO=hpHistory[hpHistory.length-1];if(hpLastTO){hpLastTO.userAns='(timed out)';hpLastTO.correct=false;}

    // ── HP miss: vignette flash + card shake, then answer reveal ───
    sfxWrong();
    // Red vignette flash
    const vig=document.getElementById('hpMissVignette');
    if(vig){
      vig.classList.remove('active');
      void vig.offsetWidth; // force reflow to restart animation
      vig.classList.add('active');
      setTimeout(()=>vig.classList.remove('active'),460);
    }
    // Shake the q-card
    const mpQCardTO=document.querySelector('#page-mp-quiz .q-card');
    if(mpQCardTO){
      mpQCardTO.classList.add('shake');
      setTimeout(()=>mpQCardTO.classList.remove('shake'),420);
    }

    // Reveal the answer and show feedback bar, matching non-HP timeout behaviour.
    // Pass currentUser as playerName so mpShowFeedback skips its own sfxWrong —
    // we already fired it above for the vignette/shake sequence.
    mpShowFeedback(false,correctAns,'(timed out)',"Time's up!",currentUser);

    // Host decides: advance turn and fetch a fresh question
    mpStartAutoNext(()=>{
      if(!isHost)return;
      lobbyPlayers.forEach(p=>{mpRollingWindowRecord(p.name,mpFlagsThisQuestion.has(p.name)?'flagged':'null');});
      // Advance turn index
      const _hpTotalTO=hpTurnOrder.length||lobbyPlayers.length;
      hpActiveIdx=(hpActiveIdx+1)%_hpTotalTO;
      const remaining=hpActivePlayers();
      if(remaining.length<=1){
        if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
        else mpEndGame();return;
      }
      qIndex++;
      if(lobbyMode!=='race'&&lobbyMode!=='potato'&&qIndex>=selectedQuestionLimit){
        if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
        else mpEndGame();return;
      }
      if(rtChannel){rtChannel.send({type:'broadcast',event:'next_question',payload:{qIndex,hpActiveIdx,mpTiebreakerPlayers}});}
      else{mpLoadQuestion();}
    });
  } else {
    lives--;renderMPHUD();
    const last=quizHistory[quizHistory.length-1];
    if(last){last.userAns='(timed out)';last.correct=false;}
    mpShowFeedback(false,correctAns,'(timed out)',"Time's up!");
    // Auto-advance starts only once the question timer has expired for everyone
    const _capTO=lobbyMode==='survival'?survivalQuestionLimit:selectedQuestionLimit;
    const _survivalWipedTO=selectedMode==='survival'&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated);
    const _isLastQTO=_survivalWipedTO||(lobbyMode!=='race'&&lobbyMode!=='potato'&&(qIndex+1)>=_capTO);
    const _useRpcTO=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
    if(_useRpcTO){
      // Any client may win the advance; skip if the round-resolved path already took this question.
      if(mpAutoNextFiredForQ!==qIndex){mpAutoNextFiredForQ=qIndex;mpStartAutoNext(mpRpcAdvanceAndBroadcast,_isLastQTO);}
      return;
    }
    mpStartAutoNext(()=>{
      if(!isHost)return;
      // Record rolling window — question resolved normally (not voided)
      lobbyPlayers.forEach(p=>{mpRollingWindowRecord(p.name,mpFlagsThisQuestion.has(p.name)?'flagged':'null');});
      if(selectedMode==='survival'&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated)){if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});else mpEndGame();return;}
      if(selectedMode==='race'){const winner=mpCheckRaceWin();if(winner!==null){if(winner==='tiebreaker'){mpStartTiebreaker();return;}if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});else mpEndGame();return;}}
      qIndex++;
      if(lobbyMode!=='race'&&lobbyMode!=='potato'&&qIndex>=selectedQuestionLimit){if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});else mpEndGame();return;}
      if(rtChannel){rtChannel.send({type:'broadcast',event:'next_question',payload:{qIndex,hpActiveIdx,mpTiebreakerPlayers}});}
      else{mpLoadQuestion();}
    },_isLastQTO);
  }
}

(function(){
  const src=document.getElementById('mpQCount'),dst=document.getElementById('mpQCountBar');
  if(src&&dst){const sync=()=>{dst.textContent=src.textContent.replace(/^Q(\d+)\s*\/\s*(\d+)$/,'Question $1 / $2');};new MutationObserver(sync).observe(src,{childList:true,characterData:true,subtree:true});sync();}
  const qt=document.getElementById('mpQuestionText');
  if(qt)new MutationObserver(()=>{if(document.getElementById('mpQCardFeedback')?.style.display!=='block'){qBurstHide('mp');qFavSync('mp');}}).observe(qt,{childList:true,characterData:true,subtree:true});
})();
function mpShowFeedback(correct,correctAns,userAns,override,playerName,remote,nextPlayerName,deferScore){
  {const me=!playerName||playerName===currentUser;
   if(me&&userAns==='(timed out)')qBurstShow('cream','<img src="assets/ok/bikkuri.png" alt=""><small>TIME\'S UP</small>','mp');
   else if(me&&correct)qBurstShow('gold','<b>○</b><small>CORRECT</small>','mp');
   else qBurstHide('mp');}
  if(!playerName||playerName===currentUser){correct?sfxCorrect():sfxWrong();}
  const fb=document.getElementById('mpQCardFeedback');fb.style.display='block';
  // Show report button, reset flag state for this question
  const rw=document.getElementById('mpReportWrap');if(rw)rw.style.display='block';
  const rd=document.getElementById('mpReportDrop');if(rd)rd.classList.remove('open');
  const rb=document.getElementById('mpReportFlagBtn');if(rb){rb.innerHTML='<i class="ti ti-flag" style="font-size:13px"></i> Flag this question';rb.disabled=false;rb.style.opacity='1';rb.style.pointerEvents='';}
  // Open flag window — generous length so players have real time to read the reveal and react
  mpFlagWindowOpen=true;
  clearTimeout(mpFlagWindowTimer);
  mpFlagWindowTimer=setTimeout(()=>{
    mpFlagWindowOpen=false;
    if(rb&&!rb.disabled){rb.style.opacity='.4';rb.style.pointerEvents='none';}
  },4000);
  document.getElementById('mpFbIcon').innerHTML=correct?'<i class="ti ti-circle-check" style="color:#4ade80;font-size:20px"></i>':'<i class="ti ti-circle-x" style="color:#f87171;font-size:20px"></i>';
  const title=override||(playerName?(playerName+(correct?' got it!':' missed!')):correct?'Correct!':'Wrong!');
  document.getElementById('mpFbTitle').textContent=title;
  const ya=document.getElementById('mpFbYourAns');
  if(!correct&&userAns&&userAns!=='(timed out)'&&userAns!==correctAns){ya.textContent='Answer given: '+userAns;ya.style.display='block';}else{ya.style.display='none';}
  const isHP=lobbyMode==='potato';
  // deferScore: the correct/wrong reveal above is already firing off a locally-known
  // verdict (MC index compare, or a typed answer that already passed local checkAnswer()),
  // ahead of the mp_submit_answer round trip that decides the real point value. Show a
  // placeholder here instead of a stale lastPtsEarned from the previous question — the
  // real label (and the score sync/broadcast below) land once mpSyncFeedbackScore runs.
  document.getElementById('mpFbPts').textContent=deferScore
    ?(correct&&lobbyMode==='race'?'Scoring…':'')
    :mpFeedbackPtsLabel(correct,isHP,nextPlayerName);
  const mpSubEl=document.getElementById('mpFbSubmittedBy');
  // Reveal answer in the question card; submitted_by shown there instead of feedback bar
  const mpQCard=document.querySelector('#page-mp-quiz .q-card');
  const mpQText=document.getElementById('mpQuestionText');
  const mpSubBy=currentQData?.submitted_by?`<div class="q-answer-sub">Question submitted by <span class="q-answer-sub-name">${currentQData.submitted_by}</span></div>`:'';
  mpQText.innerHTML=`${sceneLogoHTML(currentQData)}${answerRevealHTML(correctAns,currentQData,currentQData&&currentQData._match)}${mpSubBy}${fallbackHintHTML(currentQData)}`;
  if(mpQCard)mpQCard.classList.add('answered');
  if(mpSubEl)mpSubEl.style.display='none';
  applyTheme();
  if(remote)return; // just displaying someone else's already-resolved answer — nothing of ours to sync or broadcast
  if(deferScore)return; // caller will call mpSyncFeedbackScore once mp_submit_answer resolves
  mpSyncFeedbackScore(correct,userAns,nextPlayerName);
}

// Shared label text for the feedback banner's points line — used both for an
// immediate (non-deferred) reveal and by mpSyncFeedbackScore once a deferred
// reveal's authoritative point value comes back from the server.
function mpFeedbackPtsLabel(correct,isHP,nextPlayerName){
  const mpPtsLabel=lastPtsEarned===10?'Perfect! ⚡':lastPtsEarned>=7?'Fast! 🔥':lastPtsEarned>=5?'Good 👍':lastPtsEarned>=4?'Nice try ⏱️':'Just in time ⏱️';
  const nextLabel=nextPlayerName?` Next up: ${nextPlayerName} 🥔`:'';
  return isHP&&correct?`Potato passes!${nextLabel}`:
    isHP?`Lost a life, potato passes!${nextLabel}`:
    correct&&lobbyMode==='race'?`+${lastPtsEarned} point${lastPtsEarned===1?'':'s'}: ${mpPtsLabel}`:
    '';
}

// Fills in the authoritative point label and performs the score/lives sync +
// broadcast that mpShowFeedback does immediately for a normal (non-deferred)
// call. Called once mp_submit_answer resolves for an answer whose visual
// reveal already fired instantly via mpShowFeedback(...,true).
function mpSyncFeedbackScore(correct,userAns,nextPlayerName){
  const isHP=lobbyMode==='potato';
  document.getElementById('mpFbPts').textContent=mpFeedbackPtsLabel(correct,isHP,nextPlayerName);
  if(correct&&lobbyMode==='race'&&lastPtsEarned)qBurstShow('gold','<b>'+lastPtsEarned+'</b><small>CORRECT</small>','mp');
  // Sync local score/lives into lobbyPlayers, then broadcast
  const me=lobbyPlayers.find(p=>p.name===currentUser);
  // In HP the authoritative lives count is on the lobbyPlayers entry (active.lives was
  // decremented there directly); the local `lives` scalar is never touched for HP and
  // would broadcast the wrong (starting) value if used.
  const broadcastLives=isHP?(me?.lives??lives):lives;
  const broadcastElim=isHP?(me?.eliminated||false):(me?.eliminated||false);
  if(me){me.score=score;me.roundAnswered=true;me.roundCorrect=correct;me.roundPts=lastPtsEarned||0;me.roundElapsed=Math.round((Date.now()-questionStartTime)/100)/10;}
  if(!isHP&&me){me.lives=lives;}
  if(me&&rtChannel){
    rtChannel.send({type:'broadcast',event:'answer_submitted',payload:{name:currentUser,score:me.score,lives:broadcastLives,eliminated:broadcastElim,roundAnswered:true,roundCorrect:me.roundCorrect,roundPts:me.roundPts,roundElapsed:me.roundElapsed,hpNextPlayer:nextPlayerName||null,hpUserAns:isHP?userAns:undefined}});
  }
}

function mpNextQuestion(){
  // Offline fallback only
  qIndex++;
  const isHP=lobbyMode==='potato';
  if(isHP){
    const _hpTotalNQ=hpTurnOrder.length||lobbyPlayers.length;
    hpActiveIdx=(hpActiveIdx+1)%_hpTotalNQ;
    if(hpActivePlayers().length<=1){mpEndGame();return;}
  } else {
    if(selectedMode==='survival'&&lives<=0){mpEndGame();return}
    if(selectedMode==='race'){const w=mpCheckRaceWin();if(w!==null){if(w==='tiebreaker'){mpStartTiebreaker();return;}mpEndGame();return;}}
  }
  mpLoadQuestion();
}

async function mpLoadQuestion(){
  answered=false;
  lobbyPlayers.forEach(p=>{p.roundAnswered=false;p.roundCorrect=false;p.roundPts=0;p.roundElapsed=0;});
  mpWrongAttempts={}; // clear wrong attempts for new question
  hpTypingText={};
  const hpBannerEl=document.getElementById('hpTurnBanner');if(hpBannerEl)hpBannerEl.style.display='none';
  document.getElementById('mpQCardFeedback').style.display='none';
  const mpRwLQ=document.getElementById('mpReportWrap');if(mpRwLQ)mpRwLQ.style.display='none';
  document.getElementById('mpAnswersGrid').innerHTML='';
  document.getElementById('mpQuestionText').style.display='none';
  document.getElementById('mpQLoading').style.display='flex';
  const _mpIwLQ=document.getElementById('mpQImageWrap');const _mpIeLQ=document.getElementById('mpQImage');
  if(_mpIwLQ){_mpIwLQ.style.display='none';}if(_mpIeLQ){_mpIeLQ.onload=null;_mpIeLQ.onerror=null;_mpIeLQ.src='';}
  const mpQCardLQ=document.querySelector('#page-mp-quiz .q-card');
  if(mpQCardLQ)mpQCardLQ.classList.remove('answered');
  renderMPHUD();
  if(lobbyMode==='potato'){
    const active=hpActivePlayer();
    const isMyTurn=active.name===currentUser;
    document.getElementById('mpQLoading').querySelector('.q-loading-text').textContent=
      isMyTurn?'Your turn! Loading question…':active.name+"'s turn…";
  }
  // Only fetch if offline — realtime uses mpHostFetchAndBroadcast
  if(!rtChannel){
    const qData=prefetchedQuestion||await fetchQuestion();
    // Bail if the player navigated away from the mp quiz page while this was loading
    if(!document.getElementById('page-mp-quiz')?.classList.contains('active'))return;
    prefetchedQuestion=null;currentQData=qData;
    const offlineFuse=lobbyMode==='potato'?(5+Math.random()*5):null;
    mpShowQuestion(qData,offlineFuse);
    fetchQuestion().then(q=>{prefetchedQuestion=q});
  }
}


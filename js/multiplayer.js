// Realtime, rejoining, multiplayer question flow, leaderboard (moved out of index.html 2026-11-19; loads in its original place, order matters)
// ── SUPABASE REALTIME ─────────────────────────────────────────
let rtChannel=null;
let isHost=false;
let mpAutoNextInterval=null;
let mpAutoNextPaused=false;
// Guards mpStartAutoNext against being triggered twice for the same qIndex.
// Two independent paths can call it: Hot Potato's own answer_submitted broadcast
// check (unchanged — HP isn't on mp_submit_answer/round_resolved_at yet), and the
// postgres_changes round_resolved_at check for Race/Classic/Survival. Neither path
// can ever fire for the other's mode (a lobby is one mode), but each still needs
// protecting against firing more than once for its own mode — e.g. a duplicate or
// out-of-order postgres_changes delivery for the same row.
let mpAutoNextFiredForQ=null;
// Set immediately before this client sends its own 'question' broadcast (RPC-advance
// path only — see the postgres_changes round-resolved handler). Since broadcast:{self:true}
// echoes it straight back, the 'question' handler checks this to skip re-processing its
// own send rather than assuming only the host ever sends one, now that any client can win
// the advance race. Cleared the moment that echo is seen.
let mpOwnQuestionBroadcastPending=false;
// Same idea for the RPC winner's own next_question echo: the sender already reset the
// round and rendered the new question, so the echo must not clear the card again.
let mpOwnNextQPending=false;
function mpResetRoundState(payload){
  hpActiveIdx=payload.hpActiveIdx||0;qIndex=payload.qIndex;
  mpTiebreakerPlayers=payload.mpTiebreakerPlayers||[];
  lobbyPlayers.forEach(p=>{p.roundAnswered=false;p.roundCorrect=false;p.roundPts=0;p.roundElapsed=0;});
  mpWrongAttempts={};hpTypingText={};mpAutoNextFiredForQ=null;
  mpFlagsThisQuestion=new Set();mpFlagWindowOpen=false;
  clearTimeout(mpFlagWindowTimer);mpFlagWindowTimer=null;
  mpSnapshotScores();
}
let mpWrongAttempts={}; // {playerName: lastWrongAttemptString} — cleared each question
let hpPrevLives={}; // {playerName: livesCount} — used to detect life-loss for animation
let hpTypingText={}; // {playerName: currentDraftString} — live keystrokes from potato holder

async function rtGetOrCreateAnonSession(){
  if(currentUserId)return currentUserId;
  try{
    // Check for an existing session first (anon session persisted in sessionStorage
    // across refresh). This prevents a new anon identity being created on every reload,
    // which would leave ghost rows in lobby_players and break host transfer.
    const {data:sessionData}=await sb.auth.getSession();
    if(sessionData?.session?.user){
      currentUserId=sessionData.session.user.id;
      try{ sessionStorage.setItem('guest_user_id', currentUserId); }catch(e){}
      return currentUserId;
    }
    // No existing session — create a fresh anon one
    const {data,error}=await sb.auth.signInAnonymously();
    if(error){console.error('Anon sign in error:',error.message);return null;}
    currentUserId=data.user?.id||null;
    if(currentUserId){
      try{ sessionStorage.setItem('guest_user_id', currentUserId); }catch(e){}
    }
    return currentUserId;
  }catch(e){
    console.error('rtGetOrCreateAnonSession failed:',e.message);
    return null;
  }
}

async function rtGetAuthToken(){
  try{
    const{data}=await sb.auth.getSession();
    if(data?.session?.access_token) return data.session.access_token;
    // Session missing or expired — attempt a silent refresh before falling back
    const{data:refreshed}=await sb.auth.refreshSession();
    if(refreshed?.session?.access_token) return refreshed.session.access_token;
  }catch(e){}
  return SUPABASE_ANON;
}

async function rtCreateLobby(){
  const uid=await rtGetOrCreateAnonSession();
  if(!uid){
    console.warn('No Supabase session — lobby will be local only');
    isHost=true;
    return; // Lobby still shows locally, just won't sync to other devices
  }
  const token=await rtGetAuthToken();
  // (profile rows are created by the database when the user is made)
  let lobbyId=null;
  try{
    const lobbyRes=await fetch(`${SUPABASE_URL}/rest/v1/lobbies`,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json','Prefer':'return=representation'
      },
      body:JSON.stringify({code:lobbyCode,host_id:uid,format:lobbyFormat,mode:lobbyMode,status:'waiting',host_username:currentUser,lobby_name:lobbyName,expires_at:new Date(Date.now()+10*60*1000).toISOString(),is_private:lobbyIsPrivate,question_count:(lobbyMode==='race'?mpRaceTarget:lobbyMode==='slowreveal'?srTargetScore:lobbyMode==='potato'?hpLives:lobbyMode==='survival'?survivalQuestionLimit:selectedQuestionLimit),lives:(lobbyMode==='survival'?selectedLives:lobbyMode==='potato'?hpLives:null)})
    });
    if(!lobbyRes.ok){console.error('Create lobby error:',lobbyRes.status);return;}
    const lobbyRows=await lobbyRes.json();
    lobbyId=Array.isArray(lobbyRows)?lobbyRows[0]?.id:lobbyRows?.id;
  }catch(e){console.error('Create lobby error:',e);return;}
  if(!lobbyId){console.error('Create lobby error: no id returned');return;}
  try{
    await fetch(`${SUPABASE_URL}/rest/v1/lobby_players`,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json','Prefer':'return=minimal'
      },
      body:JSON.stringify({lobby_id:lobbyId,user_id:uid,username:currentUser,color:pfPairLead(),is_host:true,score:0,lives:3})
    });
  }catch(e){}
  isHost=true;
  currentLobbyId=lobbyId;if(typeof lrChatResetFor==='function')lrChatResetFor(lobbyId);
  try{ sessionStorage.setItem('current_lobby_id', lobbyId); }catch(e){}
  rtSubscribe(lobbyId);
}

async function rtJoinLobby(code){
  // Clear stale player list immediately so the lobby room never flashes old players
  lobbyPlayers=[];
  const uid=await rtGetOrCreateAnonSession();
  if(!uid){showErr('lobbyJoinErr','lobbyJoinErrMsg','Could not connect. Please try again.');return false;}
  const token=await rtGetAuthToken();
  let lobby=null;
  try{
    // Accept 'active' here too, not just 'waiting'. rtSetLobbyStatus('active') fires
    // the instant the host clicks Start Game — well before the countdown animation
    // finishes — so a lobby is 'active' for the entire multi-second countdown, not
    // just the brief in-flight window the race-check below was built for. Filtering
    // to 'waiting' only meant anyone trying to join during that whole window got
    // bounced here with "already started" and never reached the race-check, which is
    // the only code that knows how to route a joiner into a lobby that's already live.
    const lobbyRes=await fetch(
      `${SUPABASE_URL}/rest/v1/lobbies?select=*&code=eq.${encodeURIComponent(code)}&status=in.(waiting,active)&limit=1`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}}
    );
    const lobbyRows=await lobbyRes.json();
    lobby=Array.isArray(lobbyRows)?lobbyRows[0]:null;
  }catch(e){}
  if(!lobby){showErr('lobbyJoinErr','lobbyJoinErrMsg','Lobby not found. It may not exist or may have already ended.');return false;}
  if(lobby.status==='active'&&['survival','potato','hp'].includes(lobby.mode)){
    showErr('lobbyJoinErr','lobbyJoinErrMsg',(lobby.mode==='survival'?'Survival':'Hot Potato')+" games can't be joined once they've started. Try again when this one ends.");
    return false;
  }
  lobbyExpiresAt=lobby.expires_at||null;
  lobbyInGame=false;
  // Block rejoining — check sessionStorage first (race-safe), then DB kicked_players array
  try{
    const kickedLobbies=JSON.parse(sessionStorage.getItem('kicked_from_lobbies')||'[]');
    if(kickedLobbies.includes(code)){showLobbyToast('🚫 You\'ve been removed from this lobby and cannot rejoin.','danger');return false;}
  }catch(e){}
  if(Array.isArray(lobby.kicked_players)&&lobby.kicked_players.includes(currentUser)){
    showLobbyToast('🚫 You\'ve been removed from this lobby and cannot rejoin.','danger');
    return false;
  }
  // Enforce mode-dependent player limit
  try{
    const countRes=await fetch(
      `${SUPABASE_URL}/rest/v1/lobby_players?select=user_id&lobby_id=eq.${lobby.id}`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}}
    );
    const countRows=await countRes.json();
    const maxPlayers=lobby.mode==='hp'?8:12;
    if(Array.isArray(countRows)&&countRows.length>=maxPlayers){
      showErr('lobbyJoinErr','lobbyJoinErrMsg',`This lobby is full (max ${maxPlayers} players for ${lobby.mode==='hp'?'Hot Potato':'this mode'}).`);
      return false;
    }
  }catch(e){}
  try{
    // Use upsert so a rejoining player (e.g. original host after refresh) never hits a dupe conflict
    const joinRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players`,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'
      },
      body:JSON.stringify({lobby_id:lobby.id,user_id:uid,username:currentUser,color:pfPairLead(),is_host:false,score:0,lives:3})
    });
    if(!joinRes.ok && joinRes.status !== 409){showErr('lobbyJoinErr','lobbyJoinErrMsg','Could not join. Please try again.');return false;}
  }catch(e){showErr('lobbyJoinErr','lobbyJoinErrMsg','Could not join. Please try again.');return false;}
  // Status check: the lookup above now accepts 'active' lobbies too, so this
  // covers two cases at once — (a) the lobby was already active when we looked
  // it up (the common case: joining mid-countdown), and (b) it flipped to active
  // during the several sequential awaited requests above (session, auth token,
  // profile upsert, player-count check, this insert) — the original narrow race.
  // Either way, the one-shot game_started broadcast already fired and is gone,
  // so route through the same path used for reconnecting mid-game instead of
  // landing in a lobby room that'll never advance.
  try{
    const raceCheck=await fetch(
      `${SUPABASE_URL}/rest/v1/lobbies?select=status&id=eq.${lobby.id}&limit=1`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}}
    );
    const raceRows=await raceCheck.json();
    if(Array.isArray(raceRows)&&raceRows[0]?.status==='active'){
      return await rtRejoinActiveLobby(code);
    }
  }catch(e){}
  isHost=false;lobbyCode=code;lobbyName=lobby.lobby_name||`${lobby.host_username||code}'s Lobby`;lobbyFormat=lobby.format;lobbyMode=lobby.mode;
  selectedFormat=lobby.format;selectedMode=lobby.mode;
  if(lobby.question_count&&lobby.mode==='classic')selectedQuestionLimit=lobby.question_count;
  if(lobby.time_limit)raceTimeLimit=lobby.time_limit;
  selectedFormat=lobby.format;selectedMode=lobby.mode;
  voidingEnabled=lobby.voiding_enabled===true;
  lobbyTopics=[];lobbyIsGeneral=true;applyLobbySettings(lobby.settings); // the host's saved picks, so a refreshed host gets them back
  currentLobbyId=lobby.id;if(typeof lrChatResetFor==='function')lrChatResetFor(lobby.id);
  try{ sessionStorage.setItem('current_lobby_id', lobby.id); }catch(e){}
  rtSubscribe(lobby.id);
  await rtRefreshPlayers(lobby.id,true); // immediate=true skips debounce so goStep sees populated lobbyPlayers
  // Navigate to lobby room only after players are loaded — prevents 0/12 flash
  goStep('lobby-room');

  // ── HOST RECLAIM ──────────────────────────────────────────────
  // Only reclaim if this user is still the designated host in the DB.
  // If host was manually transferred away, lobby.host_id will no longer
  // match uid, so we skip entirely and join as a regular player.
  if(uid===lobby.host_id){
    try{
      // Check who currently holds is_host. Look at every flagged seat: while we were away another
      // player may have promoted themselves while our own row kept its flag, leaving two "hosts".
      const curHostRes=await fetch(
        `${SUPABASE_URL}/rest/v1/lobby_players?select=user_id,username&lobby_id=eq.${lobby.id}&is_host=eq.true`,
        {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}}
      );
      const curHostData=await curHostRes.json();
      const flagged=Array.isArray(curHostData)?curHostData.map(r=>r.user_id):[];
      const curHostId=flagged.find(id=>id!==uid)||(flagged.includes(uid)?uid:null);
      // Only reclaim if nobody else currently holds host
      if(curHostId&&curHostId!==uid){
        // Transfer host: clear all flags, set ours
        await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lobby.id}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:false})});
        await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lobby.id}&user_id=eq.${uid}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:true})});
        await fetch(`${SUPABASE_URL}/rest/v1/lobbies?id=eq.${lobby.id}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({host_id:uid,host_username:currentUser})});
        isHost=true;
        // Broadcast so other players update their UI
        // rtChannel is subscribed above, give it a moment to connect
        setTimeout(()=>{
          if(rtChannel){
            rtChannel.send({type:'broadcast',event:'host_transferred',payload:{newHost:currentUser,reason:'reclaim',remainingSeconds:lobbyTimerSecondsLeft}});
          }
        },1200);
      } else {
        // Our own seat still holds host (the usual case after a refresh: the rejoin
        // insert above ignores the existing row), or nobody does (our seat was
        // cleaned up after 2 min away and re-inserted with is_host:false). Either
        // way we are the host; make sure our row says so too.
        isHost=true;
        if(!curHostId){
          await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lobby.id}&user_id=eq.${uid}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:true})});
          await rtRefreshPlayers(lobby.id,true);
        }
      }
      if(isHost&&document.getElementById('page-lobby-room')?.classList.contains('active')&&typeof renderLobbyRoom==='function')renderLobbyRoom();
    }catch(e){}
  }

  return true;
}

// ── REJOIN AN ACTIVE (MID-GAME) LOBBY ────────────────────────
// Called by the "Rejoin" card on the multiplayer hub AND by disconnectRejoin()
// when the saved lobby turns out to be active.  Unlike rtJoinLobby() this path:
//   • Accepts status='active' lobbies (rtJoinLobby only accepts 'waiting')
//   • Does NOT reset score/lives — reads existing row values instead
//   • Sets connected=true on the lobby_players row and broadcasts player_reconnected
//   • Navigates straight to page-mp-quiz, then requests a game-state snapshot (#4)
async function rtRejoinActiveLobby(code){
  const uid=await rtGetOrCreateAnonSession();
  if(!uid){showLobbyToast('⚠️ Could not connect. Please try again.','danger');return false;}
  const token=await rtGetAuthToken();
  // Fetch the lobby — must be active
  let lobby=null;
  try{
    const lobbyRes=await fetch(
      `${SUPABASE_URL}/rest/v1/lobbies?select=*&code=eq.${encodeURIComponent(code)}&status=eq.active&limit=1`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}}
    );
    const rows=await lobbyRes.json();
    lobby=Array.isArray(rows)?rows[0]:null;
  }catch(e){}
  if(!lobby){
    showLobbyToast('⚠️ Game not found or already finished.','danger');
    return false;
  }
  // Kick check
  try{
    const kickedLobbies=JSON.parse(sessionStorage.getItem('kicked_from_lobbies')||'[]');
    if(kickedLobbies.includes(code)){showLobbyToast('🚫 You\'ve been removed from this lobby and cannot rejoin.','danger');return false;}
  }catch(e){}
  if(Array.isArray(lobby.kicked_players)&&lobby.kicked_players.includes(currentUser)){
    showLobbyToast('🚫 You\'ve been removed from this lobby and cannot rejoin.','danger');
    return false;
  }
  // Confirm this user has a lobby_players row (must have been in this game)
  let existingRow=null;
  try{
    const rowRes=await fetch(
      `${SUPABASE_URL}/rest/v1/lobby_players?select=score,lives,is_host,eliminated&lobby_id=eq.${lobby.id}&user_id=eq.${encodeURIComponent(uid)}&limit=1`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}}
    );
    const rowData=await rowRes.json();
    existingRow=Array.isArray(rowData)?rowData[0]:null;
  }catch(e){}
  if(!existingRow){
    showLobbyToast('⚠️ You weren\'t part of this game. Ask for a lobby code to join a new one.','danger');
    return false;
  }
  // Mark connected=true on the existing row
  try{
    await fetch(
      `${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lobby.id}&user_id=eq.${encodeURIComponent(uid)}`,
      {method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Prefer':'return=minimal'},
       body:JSON.stringify({connected:true})}
    );
  }catch(e){console.warn('rtRejoinActiveLobby: could not set connected=true',e);}
  // Set local game state from lobby row — keep existing score/lives, don't reset
  isHost=existingRow.is_host||false;
  lobbyCode=code;
  lobbyName=lobby.lobby_name||`${lobby.host_username||code}'s Lobby`;
  lobbyFormat=lobby.format; selectedFormat=lobby.format;
  lobbyMode=lobby.mode;     selectedMode=lobby.mode;
  if(lobby.question_count&&lobby.mode==='classic')selectedQuestionLimit=lobby.question_count;
  if(lobby.time_limit)raceTimeLimit=lobby.time_limit;
  voidingEnabled=lobby.voiding_enabled===true;
  applyLobbySettings(lobby.settings);
  currentLobbyId=lobby.id;if(typeof lrChatResetFor==='function')lrChatResetFor(lobby.id);
  try{ sessionStorage.setItem('current_lobby_id', lobby.id); }catch(e){}
  // Subscribe to realtime channel before refreshing players
  rtSubscribe(lobby.id);
  await rtRefreshPlayers(lobby.id,true);
  // Broadcast reconnection so other clients clear the offline/quit indicator
  try{
    if(rtChannel){
      rtChannel.send({type:'broadcast',event:'player_reconnected',payload:{name:currentUser,userId:uid}});
      rtChannel.send({type:'broadcast',event:'player_rejoined',payload:{name:currentUser,userId:uid}});
    }
  }catch(e){}
  // Discard any stale question left over from before the disconnect — without this,
  // the old question's markup (still sitting in the DOM/currentQData from the last
  // render) flashes on screen for a moment before the snapshot below replaces it.
  currentQData=null;
  lobbyInGame=true;
  goStep('mp-quiz');
  document.getElementById('mpQCardFeedback').style.display='none';
  document.getElementById('mpAnswersGrid').innerHTML='';
  document.getElementById('mpQuestionText').style.display='none';
  document.getElementById('mpQLoading').style.display='flex';
  renderMPHUD();
  renderMPScoreboard();
  // Request a game-state snapshot from the host (Step 4 will handle the response;
  // for now the broadcast is sent so it's ready to be received once Step 4 lands)
  setTimeout(()=>{
    if(rtChannel)rtChannel.send({type:'broadcast',event:'request_game_state',payload:{userId:uid,username:currentUser}});
  },800);
  return true;
}

function showDisconnectModal(msg){
  const sub=document.getElementById('disconnectModalSub');
  if(sub)sub.textContent=msg||'Your connection to the lobby was lost. You can try rejoining or head back to multiplayer.';
  const rejoinBtn=document.getElementById('disconnectRejoinBtn');
  if(rejoinBtn)rejoinBtn.style.display=lobbyCode?'flex':'none';
  document.getElementById('disconnectModal').classList.add('open');
  applyTheme();
}

async function disconnectRejoin(){
  document.getElementById('disconnectModal').classList.remove('open');
  intentionalLeave=false; // reset so the channel error handler works again after rejoin
  if(!lobbyCode){goStep('multiplayer');return;}
  // Check whether the lobby is still waiting or already active — route accordingly
  let lobbyStatus=null;
  try{
    const token=await rtGetAuthToken();
    const res=await fetch(
      `${SUPABASE_URL}/rest/v1/lobbies?select=status&code=eq.${encodeURIComponent(lobbyCode)}&limit=1`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}}
    );
    const rows=await res.json();
    lobbyStatus=Array.isArray(rows)?rows[0]?.status:null;
  }catch(e){}
  if(lobbyStatus==='active'){
    const ok=await rtRejoinActiveLobby(lobbyCode);
    if(!ok){showDisconnectModal('Could not rejoin. The game may have ended.');}
  } else {
    const ok=await rtJoinLobby(lobbyCode);
    if(!ok){showDisconnectModal('Could not rejoin. The lobby may no longer exist.');}
  }
}

let _rtVisibilityAbort=null;
function rtSubscribe(lobbyId){
  if(rtChannel)rtChannel.unsubscribe();
  // Cancel any visibilitychange listeners from a previous session
  if(_rtVisibilityAbort){_rtVisibilityAbort.abort();}
  _rtVisibilityAbort=new AbortController();
  const _rtSignal={signal:_rtVisibilityAbort.signal};
  rtChannel=sb.channel(`lobby:${lobbyCode}`,{config:{broadcast:{self:true}}});
  // Also listen for changes on the lobbies row itself (e.g. updated_at bumped by the
  // refresh-cleanup IIFE) so remaining clients re-fetch players even when the
  // lobby_players DELETE event is silently dropped by Supabase Realtime.
  rtChannel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'lobbies',filter:`id=eq.${lobbyId}`},async(payload)=>{
    await rtRefreshPlayers(lobbyId);
    // Sync mpDbQIndex straight from the database, independent of the question
    // broadcast (see that handler for the broadcast-side sync, which stays primary
    // since it's what actually carries the question data itself). This is a
    // second, independent source for the index specifically — a dropped or
    // delayed broadcast can no longer leave mpDbQIndex stuck at a stale value,
    // since the client reads it here regardless of whether the broadcast ever
    // arrives. Applies to every client, including the host: now that any client
    // can win the mp_advance_question race, a host that loses a round's race
    // never gets its own {advanced:true} response to update mpDbQIndex from, so
    // it needs this fallback exactly as much as a non-host does. Only ever moves
    // forward: current_q_index is monotonic within a game, so a stray
    // earlier-numbered UPDATE (e.g. a reconnect re-delivering an old row state)
    // can't walk it backward.
    if(typeof payload?.new?.current_q_index==='number'&&payload.new.current_q_index>mpDbQIndex){
      mpDbQIndex=payload.new.current_q_index;
    }
    // Fallback for a dropped game_started broadcast: Supabase Realtime is already known
    // to silently drop one-shot events under load (see the lobby_players DELETE handling
    // elsewhere in this file). If we're still parked on the lobby room when the row
    // flips to 'active', the countdown broadcast never reached us — surface a manual
    // way in rather than leaving the player stranded with no signal the game is live.
    if(!isHost&&!lobbyInGame&&payload?.new?.status==='active'){
      const inLobby=document.getElementById('page-lobby-room')?.classList.contains('active');
      if(inLobby)showLobbyActiveBanner();
    }
    // Server-authoritative round resolution for Race/Classic/Survival, on any
    // format that actually calls mp_submit_answer (useRpc — same check as the
    // RPC call sites and the answer_submitted fallback below, so this and that
    // fallback are always mutually exclusive, never both-or-neither for a given
    // round). Hot Potato and the char-mc format never reach the RPC at all and
    // stay on the answer_submitted-broadcast path — see that handler for why.
    // mp_submit_answer stamps round_resolved_at, inside its own locked
    // transaction, the moment it records whichever answer turns out to be the
    // last one needed — a fact decided once by the database, not reconstructed
    // independently by each client from a stream of broadcasts that can arrive
    // duplicated, out of order, or (with broadcast:{self:true}) echoed back to
    // their own sender. rtRefreshPlayers just ran above, so lobbyPlayers'
    // `eliminated` reflects the server's own bookkeeping, not a client guess.
    const _pgcUseRpc=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
    // Any client may now be the one that actually advances the round — not just the
    // host. mp_advance_question's row lock + p_expected_q_index check means every
    // client that reaches this branch can safely call it concurrently: exactly one
    // gets {advanced:true}, everyone else gets back {advanced:false,reason:'already_advanced'}
    // with the identical authoritative current_question. Win-check, elimination-check,
    // and every broadcast below are gated on that advanced:true response — not on
    // isHost — so exactly one client (whichever wins the race) is ever responsible
    // for this round's next_question/question/game_ended broadcasts, same single-sender
    // guarantee the old isHost gate gave, just decided by the DB instead of a fixed role.
    // Only for the question actually on screen: a late resolution notice for a round
    // we've already moved past would otherwise start a countdown that skips a question.
    if(_pgcUseRpc&&lobbyInGame&&payload?.new?.round_resolved_at&&mpAutoNextFiredForQ!==qIndex
       &&(typeof payload.new.current_q_index!=='number'||payload.new.current_q_index===mpShownDbQIndex)){
      mpAutoNextFiredForQ=qIndex;
      clearInterval(timerInterval); // stop the question timer early — leave the bar frozen wherever it was
      mpCancelBackup(mpActiveFuseBackupId);
      // If this was the last life of the last surviving player, treat it like the final
      // question so the auto-next label reads "Wrapping up…" instead of a numeric countdown.
      const _survivalWiped=selectedMode==='survival'&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated);
      const _capAN=lobbyMode==='survival'?survivalQuestionLimit:selectedQuestionLimit;
      const _isLastQ=_survivalWiped||(lobbyMode!=='race'&&(qIndex+1)>=_capAN);
      mpStartAutoNext(mpRpcAdvanceAndBroadcast,_isLastQ);
    }
  });
  rtChannel.on('postgres_changes',{event:'*',schema:'public',table:'lobby_players',filter:`lobby_id=eq.${lobbyId}`},async()=>{
    await rtRefreshPlayers(lobbyId);
    // If the host_transferred broadcast already handled this, lobbyPlayers will have a host — skip.
    if(isHost)return;
    const hasHost=lobbyPlayers.some(p=>p.isHost);
    if(hasHost)return;
    if(!lobbyPlayers.length)return;
    // Fallback self-election: re-fetch from DB with stable order to pick a single winner
    try{
      const token=await rtGetAuthToken();
      const pRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=user_id,username&lobby_id=eq.${lobbyId}&order=joined_at.asc&limit=1`,{headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
      const pData=await pRes.json();
      const first=Array.isArray(pData)?pData[0]:null;
      if(!first||first.user_id!==currentUserId)return; // not our turn to claim
      // Wait briefly then re-check — prevents two clients both winning the race
      // when they read the DB before either has written their claim.
      await new Promise(r=>setTimeout(r,200));
      // Re-confirm nobody else claimed host in the meantime
      const recheckRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=user_id&lobby_id=eq.${lobbyId}&is_host=eq.true&limit=1`,{headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
      const recheckData=await recheckRes.json();
      const alreadyClaimed=Array.isArray(recheckData)&&recheckData.length>0&&recheckData[0].user_id!==currentUserId;
      if(alreadyClaimed)return; // someone else already claimed it
      await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lobbyId}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:false})});
      await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lobbyId}&user_id=eq.${currentUserId}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({is_host:true})});
      await fetch(`${SUPABASE_URL}/rest/v1/lobbies?code=eq.${encodeURIComponent(lobbyCode)}`,{method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({host_id:currentUserId,host_username:currentUser})});
      isHost=true;
      lobbyPlayers.forEach(p=>{p.isHost=(p.name===currentUser);});
      renderLobbyRoom();
      showLobbyToast(`👑 The host left. You're now the host!`,'warning');
      if(rtChannel)rtChannel.send({type:'broadcast',event:'host_transferred',payload:{newHost:currentUser,reason:'left',originalHostName:'The host',remainingSeconds:lobbyTimerSecondsLeft}});
    }catch(e){}
  });
  rtChannel.on('broadcast',{event:'lobby_expiry_warning'},({payload})=>{
    if(!isHost)showLobbyToast('⏳ This lobby will close in 1 minute if the game hasn\'t started.','warning');
    // Fix #3: arm a failsafe so the lobby closes even if the host's tab crashes
    // before the 60-second countdown finishes. Only one non-host wins the
    // self-election (same pattern used in postgres_changes above).
    const remaining=typeof payload?.remainingSeconds==='number'?payload.remainingSeconds:60;
    // Non-hosts: drive the banner from the lobby's absolute expiry time so it stays
    // in sync with the host even if this tab was backgrounded/throttled.
    if(!isHost){
      if(!lobbyExpiresAt)lobbyExpiresAt=new Date(Date.now()+remaining*1000).toISOString();
      startNonHostExpiryWatch();
    }
    setTimeout(async()=>{
      // If we became host in the meantime, the timer is already running — skip.
      if(isHost)return;
      // Check if the lobby is still open in DB.
      if(SUPABASE_URL.includes('YOUR_PROJECT')||!lobbyCode)return;
      try{
        const token=await rtGetAuthToken();
        // Is there still an active host in the lobby?
        const lobbyRes=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?select=id,status&code=eq.${encodeURIComponent(lobbyCode)}&limit=1`,
          {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
        const lobbyData=await lobbyRes.json();
        const lobbyRow=Array.isArray(lobbyData)?lobbyData[0]:null;
        if(!lobbyRow||lobbyRow.status!=='waiting')return; // already gone or started
        // Use stable ordering to elect a single non-host enforcer.
        const pRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=user_id&lobby_id=eq.${lobbyRow.id}&order=joined_at.asc&limit=1`,
          {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`}});
        const pData=await pRes.json();
        const first=Array.isArray(pData)?pData[0]:null;
        if(!first||first.user_id!==currentUserId)return; // not our turn to enforce
        // We won the election — close the lobby.
        await rtDeleteLobby();
        intentionalLeave=true;
        if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
        goStep('multiplayer');
        setTimeout(()=>showLobbyExpiredModal(),300);
      }catch(e){}
    },(remaining+2)*1000); // +2 s buffer so the host always wins the race if present
  });
  rtChannel.on('broadcast',{event:'lobby_expired'},()=>{
    // Host broadcast this just before deleting the lobby — non-hosts navigate away
    // and show the expired modal. This catches players who joined after the
    // lobby_expiry_warning was sent and never had a failsafe timer armed.
    if(isHost)return; // host handles its own teardown in startLobbyTimer
    intentionalLeave=true;
    if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
    goStep('multiplayer');
    setTimeout(()=>showLobbyExpiredModal(),300);
  });
  rtChannel.on('broadcast',{event:'avatar_changed'},({payload})=>{
    const p=lobbyPlayers.find(lp=>lp.userId===payload.userId);
    if(!p)return;
    p.avatar=payload.avatar;p.hasPfp=!!payload.avatar;renderLobbyRoom();
    if(document.getElementById('page-mp-quiz').classList.contains('active'))renderMPScoreboard();
  });
  rtChannel.on('broadcast',{event:'avatar_removed'},({payload})=>{
    const p=lobbyPlayers.find(lp=>lp.userId===payload.userId);
    if(p){p.avatar=null;p.hasPfp=false;renderLobbyRoom();}
  });
  rtChannel.on('broadcast',{event:'game_started'},({payload})=>{
    // Host already ran this setup in startLobbyGame() and self:true would echo it back
    // with an empty onDone, clobbering the real mpHostFetchAndBroadcast callback
    if(isHost)return;
    lobbyInGame=true;clearLobbyTimer();
    selectedFormat=payload.format;selectedMode=payload.mode;
    lobbyFormat=payload.format;lobbyMode=payload.mode;
    lobbyPlayers=payload.players;
    selectedTopics=payload.topics||[];isGeneralSelected=payload.isGeneral??true;
    lobbyTopics=payload.topics||[];lobbyIsGeneral=payload.isGeneral??true;
    score=0;lives=3;qIndex=0;mpDbQIndex=0;mpShownDbQIndex=0;prefetchedRpcPromise=null;prefetchedRpcResult=null;answered=false;quizHistory=[];hpHistory=[];mpCancelBackup(mpActiveFuseBackupId);mpCancelBackup(mpActiveAutoNextBackupId);
    prefetchedQuestion=null;currentQData=null;mpAutoNextFiredForQ=null;
    hpActiveIdx=payload.hpActiveIdx??0;
    hpTurnOrder=Array.isArray(payload.hpTurnOrder)&&payload.hpTurnOrder.length?payload.hpTurnOrder:lobbyPlayers.map(p=>p.name);
    mpWrongAttempts={};mpTiebreakerPlayers=[];
    mpFlagsThisQuestion=new Set();mpFlagWindowOpen=false;mpPlayerFlagWindows={};
    mpSnapshotScores();
    if(payload.srTargetScore)srTargetScore=payload.srTargetScore;
    if(payload.mpRaceTarget)mpRaceTarget=payload.mpRaceTarget;
    if(payload.survivalLives!=null)selectedLives=payload.survivalLives;
    if(payload.survivalQuestionLimit!=null)survivalQuestionLimit=payload.survivalQuestionLimit;
    if(payload.hpLives!=null)hpLives=payload.hpLives;
    if(payload.hpFuseMin!=null)hpFuseMin=payload.hpFuseMin;
    if(payload.hpFuseMax!=null)hpFuseMax=payload.hpFuseMax;
    if(payload.showTyping!=null)lobbyShowTyping=payload.showTyping;
    if(payload.pointsPerCorrect!=null)lobbyPointsPerCorrect=payload.pointsPerCorrect;
    if(payload.maxPlayers!=null)lobbyMaxPlayers=payload.maxPlayers;
    if(payload.lateJoin!=null)lobbyLateJoin=payload.lateJoin;
    if(payload.autoAdvance!=null)lobbyAutoAdvance=payload.autoAdvance;
    if(payload.hideSpoilers!=null)lobbyHideSpoilers=!!payload.hideSpoilers;
    lives=payload.mode==='survival'?selectedLives:payload.mode==='potato'?hpLives:3;
    document.getElementById('mpHudLabel').textContent=fmtLabels[selectedFormat]+' · '+lobbyModeLabel(selectedMode);
    document.getElementById('mpQBadge').textContent=fmtLabels[selectedFormat]+' · '+lobbyModeLabel(selectedMode);
    // Tell the room this client got the start signal (drives the ready row on the countdown card)
    if(rtChannel&&currentUser)rtChannel.send({type:'broadcast',event:'countdown_ready',payload:{name:currentUser}});
    // Non-hosts: show countdown while still on lobby page, transition when done
    const hpFirstHolder=payload.mode==='potato'?(hpTurnOrder[0]||lobbyPlayers[hpActiveIdx]?.name):null;
    mpShowCountdown(()=>{_origGoStep('mp-quiz');mpResetQuestionCard();renderMPHUD();
      // The host fetches question 1. If it hasn't arrived shortly after the countdown
      // (host dropped right at the start), fetch it ourselves: same one-winner RPC as
      // every later question, so this never double-advances.
      if((lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc'){
        setTimeout(()=>{mpEnsureFirstQuestion().catch(()=>{});},1500);
      }
    },hpFirstHolder);
  });
  rtChannel.on('broadcast',{event:'question'},({payload})=>{
    // Whichever client just won the round-advance race (host or not) already
    // rendered this locally at the send site — see mpOwnQuestionBroadcastPending.
    const _useRpcQ=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
    if(_useRpcQ){
      // Any client (host included) may lose the advance race, so everyone accepts a
      // question that's newer than the one on screen. An older or equal index is our
      // own echo (broadcast self:true) or a late duplicate. The old `if(isHost)return`
      // left a host that lost the race frozen on the previous question.
      if(typeof payload.mpDbQIndex!=='number'||payload.mpDbQIndex<=mpShownDbQIndex)return;
      mpShownDbQIndex=payload.mpDbQIndex;
    } else {
      if(mpOwnQuestionBroadcastPending){mpOwnQuestionBroadcastPending=false;return;}
      if(isHost)return; // Hot Potato/char-mc legacy path: host already called mpShowQuestion directly in mpHostFetchAndBroadcast
    }
    currentQData=payload.qData;qIndex=payload.qIndex;
    // mpDbQIndex was previously never updated on non-host clients at all — it stayed
    // at its initial 0 for the entire game, so every non-host mp_submit_answer call
    // was rejected as stale_question starting from the very first question (DB's
    // current_q_index jumps from 0 to 1 as soon as that first question is set). This
    // was invisible before this migration because the old broadcast-driven trigger
    // never checked whether mp_submit_answer actually succeeded — it advanced off
    // roundAnswered flags regardless, and the "scoring locally" fallback silently
    // covered for the RPC failing on every question, for every non-host player.
    if(typeof payload.mpDbQIndex==='number')mpDbQIndex=payload.mpDbQIndex;
    mpShowQuestion(payload.qData,payload.hpFuse);renderMPHUD();
  });
  rtChannel.on('broadcast',{event:'wrong_attempt'},({payload})=>{
    // Only show wrong attempts for typing formats; skip if that player already answered correctly
    const p=lobbyPlayers.find(lp=>lp.name===payload.name);
    if(p&&!p.roundAnswered){
      mpWrongAttempts[payload.name]=payload.attempt;
      renderMPScoreboard();
    }
  });
  rtChannel.on('broadcast',{event:'hp_typing'},({payload})=>{
    if(payload.name===currentUser)return; // ignore own echo
    hpTypingText[payload.name]=payload.text;
    // Show the live draft in the disabled answer input that spectators see — only if show-typing is on
    if(lobbyShowTyping){const inp=document.getElementById('mpTypeInput');if(inp&&inp.disabled){inp.value=payload.text;}}
  });
  rtChannel.on('broadcast',{event:'answer_submitted'},({payload})=>{
    const p=lobbyPlayers.find(lp=>lp.name===payload.name);
    if(p){p.score=payload.score;p.lives=payload.lives;p.eliminated=payload.eliminated||(selectedMode==='survival'&&payload.lives<=0)||false;p.roundAnswered=true;p.roundCorrect=payload.roundCorrect;p.roundPts=payload.roundPts||0;p.roundElapsed=payload.roundElapsed||0;}
    // Clear wrong attempt and typing preview once they've locked in a final answer
    if(mpWrongAttempts[payload.name])delete mpWrongAttempts[payload.name];
    if(hpTypingText[payload.name]){
      delete hpTypingText[payload.name];
      const inp=document.getElementById('mpTypeInput');
      if(inp&&inp.disabled)inp.value='';
    }
    renderMPScoreboard();
    // Hot Potato: only the active player can ever answer a given round, so everyone
    // else is purely a spectator. Previously they only got a quiet checkmark icon in
    // the side scoreboard — give them the same prominent "X got it!" reveal the active
    // player sees locally. Also stop everyone's own fuse countdown here: each client
    // runs its own local timer that independently calls mpTimeOut() when it hits zero
    // (that's how the wrong/timeout case already stays in sync across clients), but if
    // we don't clear it now, a spectator whose own timer hasn't reached zero yet could
    // fire a stale timeout — and a duplicate life loss — a moment after the correct
    // answer already resolved the round.
    if(lobbyMode==='potato'){
      clearInterval(timerInterval);
      mpCancelBackup(mpActiveFuseBackupId);
      // Sync this round into hpHistory for spectating clients — the active player's own
      // client already logged it locally in mpCheckTypeAnswer, so only fill it in here if
      // it's still unresolved (guards against double-processing on the sender's own client).
      const hpLastSync=hpHistory[hpHistory.length-1];
      if(hpLastSync&&hpLastSync.correct===null&&payload.roundCorrect){
        hpLastSync.correct=true;hpLastSync.userAns=payload.hpUserAns||hpLastSync.correctAns;
      }
      if(payload.name!==currentUser){
        const correctAns=currentQData?(currentQData.options?currentQData.options[currentQData.answer]:currentQData.answer):'?';
        // Only show feedback reveal for a correct answer — misses use the vignette/shake path instead
        if(payload.roundCorrect){
          mpShowFeedback(payload.roundCorrect,correctAns,null,null,payload.name,true,payload.hpNextPlayer||null);
        } else {
          // HP miss on a spectating client: vignette flash + shake, no answer reveal
          sfxWrong();
          const vigR=document.getElementById('hpMissVignette');
          if(vigR){vigR.classList.remove('active');void vigR.offsetWidth;vigR.classList.add('active');setTimeout(()=>vigR.classList.remove('active'),460);}
          const mpQCardR=document.querySelector('#page-mp-quiz .q-card');
          if(mpQCardR){mpQCardR.classList.add('shake');setTimeout(()=>mpQCardR.classList.remove('shake'),420);}
        }
      }
    }
    // Host checks if all active players have answered — if so, advance early.
    // This is now the fallback path, for anything that never calls mp_submit_answer
    // and therefore never gets a round_resolved_at stamped: Hot Potato (not wired to
    // the RPC path at all), and — this is the piece I missed on the first pass of
    // this migration — the char-mc format, which is scored entirely client-side
    // regardless of mode (see the useRpc check below, same one mpStartAutoNext and
    // the answer-submit call sites already use). Race/Classic/Survival on any other
    // format DO call mp_submit_answer, so for those the trigger lives in the
    // postgres_changes listener on `lobbies`, keyed off round_resolved_at — see
    // that handler. Gating on useRpc here (instead of just lobbyMode==='potato')
    // keeps this path in sync with whichever rounds actually reach the RPC.
    const isHP=lobbyMode==='potato';
    const useRpc=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
    // RPC modes: when the last survivor loses their final life, don't wait for the timer
    // or the server's round_resolved signal — stop the clock and wrap up now.
    if(useRpc&&lobbyInGame&&selectedMode==='survival'&&mpAutoNextFiredForQ!==qIndex&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated)){
      mpAutoNextFiredForQ=qIndex;
      clearInterval(timerInterval);
      mpCancelBackup(mpActiveFuseBackupId);
      mpStartAutoNext(mpRpcAdvanceAndBroadcast,true);
    }
    if(isHost&&!useRpc){
      const activePlayers=isHP
        ?[hpActivePlayer()]  // HP: only the active player needs to answer
        :lobbyPlayers.filter(lp=>!lp.eliminated&&!lp.quit);
      const allAnswered=activePlayers.length>0&&activePlayers.every(lp=>lp.roundAnswered);
      // For HP misses, mpTimeOut already owns the advance path (it set roundAnswered via the
      // answer_submitted broadcast but handles auto-next itself). Only trigger the early-advance
      // here for HP on a CORRECT answer — misses must not fire a second mpStartAutoNext.
      const isHPMiss=isHP&&payload.name===hpActivePlayer().name&&!payload.roundCorrect;
      // If this was the last life of the last surviving player, treat it like the final
      // question so the auto-next label reads "Wrapping up…" instead of a numeric countdown.
      const _survivalWipedAN=selectedMode==='survival'&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated);
      if((allAnswered||_survivalWipedAN)&&!isHPMiss&&mpAutoNextFiredForQ!==qIndex){
        mpAutoNextFiredForQ=qIndex;
        clearInterval(timerInterval); // stop the question timer early — leave the bar frozen wherever it was
        mpCancelBackup(mpActiveFuseBackupId);
        const _capAN=lobbyMode==='survival'?survivalQuestionLimit:selectedQuestionLimit;
        const _isLastQ=_survivalWipedAN||(!isHP&&lobbyMode!=='race'&&(qIndex+1)>=_capAN);
        mpStartAutoNext(()=>{
          if(!isHost)return;
          // Record rolling window — question resolved normally (not voided)
          lobbyPlayers.forEach(p=>{mpRollingWindowRecord(p.name,mpFlagsThisQuestion.has(p.name)?'flagged':'null');});
          // Now that the reveal + wrap-up pause has played, actually end the game if every
          // non-quit survival player is eliminated.
          if(selectedMode==='survival'&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated)){
            if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
            else mpEndGame();return;
          }
          if(isHP){
            const _hpTotal=hpTurnOrder.length||lobbyPlayers.length;
            hpActiveIdx=(hpActiveIdx+1)%_hpTotal;
            const remaining=hpActivePlayers();
            if(remaining.length<=1){
              if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
              else mpEndGame();return;
            }
          } else {
            if(selectedMode==='race'){const winner=mpCheckRaceWin();if(winner!==null){if(winner==='tiebreaker'){mpStartTiebreaker();return;}if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});else mpEndGame();return;}}
          }
          qIndex++;
          const _survivalCap=lobbyMode==='survival'?survivalQuestionLimit:selectedQuestionLimit;
          if(lobbyMode!=='race'&&lobbyMode!=='potato'&&qIndex>=_survivalCap){if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});else mpEndGame();return;}
          if(rtChannel){rtChannel.send({type:'broadcast',event:'next_question',payload:{qIndex,hpActiveIdx,mpTiebreakerPlayers}});}
          else{mpLoadQuestion();}
        },_isLastQ);
      }
    }
  });
  rtChannel.on('broadcast',{event:'next_question'},({payload})=>{
    // Our own echo (RPC winner) — already reset and rendered at the send site.
    if(mpOwnNextQPending){mpOwnNextQPending=false;return;}
    mpResetRoundState(payload);
    document.getElementById('mpQCardFeedback').style.display='none';
    const mpRwNQ=document.getElementById('mpReportWrap');if(mpRwNQ)mpRwNQ.style.display='none';
    const mpAnNQ=document.getElementById('mpAutoNext');if(mpAnNQ)mpAnNQ.textContent='';
    document.getElementById('mpQuestionText').style.display='none';
    document.getElementById('mpAnswersGrid').innerHTML='';
    document.getElementById('mpQLoading').style.display='flex';
    const _mpIw=document.getElementById('mpQImageWrap');const _mpIe=document.getElementById('mpQImage');
    if(_mpIw){_mpIw.style.display='none';}if(_mpIe){_mpIe.onload=null;_mpIe.onerror=null;_mpIe.src='';}
    const mpQCard=document.querySelector('#page-mp-quiz .q-card');
    if(mpQCard)mpQCard.classList.remove('answered');
    // RPC-eligible modes (Race/Classic/Survival, non-char-mc) are fully handled by
    // whichever client won the mp_advance_question race — it already has the new
    // question and broadcasts it immediately after this event (see the
    // postgres_changes round-resolved handler). Calling mpHostFetchAndBroadcast
    // here for those modes would re-call the RPC a second time with an
    // already-stale expected index and silently double-advance the round. Hot
    // Potato and char-mc never reach that RPC path at all and still rely on this
    // host-only re-fetch exactly as before.
    const _useRpcNQ=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
    if(isHost&&!_useRpcNQ)mpHostFetchAndBroadcast();
  });
  rtChannel.on('broadcast',{event:'show_auto_next'},({payload})=>{
    if(isHost)return; // host already runs its own countdown
    // Stop the local question timer bar — all players have answered — but leave it frozen wherever it stopped
    clearInterval(timerInterval);
    mpCancelBackup(mpActiveFuseBackupId);
    let t=payload.seconds||5;
    const el=document.getElementById('mpAutoNext');
    if(el)el.textContent=payload.isLastQuestion?'Wrapping up…':`Next in ${t}s`;
    clearInterval(mpAutoNextInterval);
    if(payload.isLastQuestion)return; // host handles navigation, clients just show the label
    mpAutoNextInterval=setInterval(()=>{
      t--;
      if(el)el.textContent=t>0?`Next in ${t}s`:'';
      if(t<=0)clearInterval(mpAutoNextInterval);
    },1000);
  });
  rtChannel.on('broadcast',{event:'game_ended'},({payload})=>{
    lobbyPlayers=payload.players;mpEndGame();
  });
  rtChannel.on('broadcast',{event:'question_flagged'},({payload})=>{
    if(!isHost)return;
    if(!mpFlagWindowOpen)return; // window closed, ignore late flags
    if(mpFlagsThisQuestion.has(payload.name))return; // duplicate
    mpFlagsThisQuestion.add(payload.name);
    // Always record the flag for the rolling anti-abuse window regardless of voiding setting
    mpRollingWindowRecord(payload.name,'flag');
    // If voiding is disabled, the flag is a silent report only — never trigger a void
    if(!voidingEnabled)return;
    const threshold=mpGetVoidThreshold();
    if(mpFlagsThisQuestion.size>=threshold){
      // Threshold met — void the question
      mpFlagWindowOpen=false;clearTimeout(mpFlagWindowTimer);
      clearInterval(mpAutoNextInterval); // cancel auto-next
      mpCancelBackup(mpActiveAutoNextBackupId);
      mpVoidQuestion();
      // Broadcast void to all clients
      rtChannel.send({type:'broadcast',event:'question_voided',payload:{
        players:lobbyPlayers,questionId:currentQData?.id,flaggers:Array.from(mpFlagsThisQuestion)
      }});
      // Record non-void slot for non-flaggers and proceed to next question after brief pause
      setTimeout(()=>{
        lobbyPlayers.forEach(p=>{if(!mpFlagsThisQuestion.has(p.name))mpRollingWindowRecord(p.name,'null');});
        qIndex++;
        if(lobbyMode!=='race'&&lobbyMode!=='potato'&&qIndex>=selectedQuestionLimit){
          rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});return;
        }
        rtChannel.send({type:'broadcast',event:'next_question',payload:{qIndex,hpActiveIdx,mpTiebreakerPlayers}});
      },3000);
    }
  });
  rtChannel.on('broadcast',{event:'question_voided'},({payload})=>{
    if(isHost)return; // host already handled it
    lobbyPlayers=payload.players;
    // Revert local score/lives from snapshot
    const mySnap=mpPreVoidSnapshot[currentUser];
    if(mySnap){score=mySnap.score;lives=mySnap.lives;}
    renderMPHUD();renderMPScoreboard();
    // Mark flaggers' windows as null (exempted), others also null (question didn't count)
    const flaggers=new Set(payload.flaggers||[]);
    lobbyPlayers.forEach(p=>mpRollingWindowRecord(p.name,'null'));
    // Show void banner
    const el=document.getElementById('mpAutoNext');
    if(el)el.innerHTML='<span style="color:#f87171">⚠️ Question voided. Flagged by multiple players, no points awarded.</span>';
    // Close flag button
    const rb=document.getElementById('mpReportFlagBtn');
    if(rb){rb.disabled=true;rb.style.opacity='.4';rb.style.pointerEvents='none';}
  });
  // ── Slow Reveal broadcasts ──────────────────────────────────────
  rtChannel.on('broadcast',{event:'sr_question'},({payload})=>{
    if(isHost)return;
    currentQData=payload.qData;qIndex=payload.qIndex;
    document.getElementById('mpQLoading').style.display='none';
    document.getElementById('mpQCardFeedback').style.display='none';
    renderMPHUD();
    srStartReveal(payload.qData,payload.startTime);
  });
  rtChannel.on('broadcast',{event:'sr_buzz'},({payload})=>{
    if(!isHost)return;
    srHandleBuzz(payload.name,payload.charIndex);
  });
  rtChannel.on('broadcast',{event:'sr_buzz_granted'},({payload})=>{
    if(isHost)return;
    srApplyBuzzGranted(payload.name,payload.charIndex);
  });
  rtChannel.on('broadcast',{event:'sr_buzz_result'},({payload})=>{
    // Every client — including the host — applies the result only from this
    // broadcast (self:true means the sender gets their own event back too).
    // Previously the host applied results locally and directly whenever it
    // was the one who answered/timed out, and this listener ignored the
    // broadcast entirely (`if(isHost)return`), so a non-host's answer never
    // reached the host: no score update, and no unlock of the buzz button
    // (the host's local 5s countdown just kept running to its natural end).
    srApplyBuzzResult(payload.name,payload.correct,payload.timedOut,payload.answer,payload.buzzRatio||0);
  });
  rtChannel.on('broadcast',{event:'sr_post_reveal'},({payload})=>{
    if(isHost)return;
    srRunPostRevealTimer(payload.seconds||10);
  });
  rtChannel.on('broadcast',{event:'sr_round_end'},({payload})=>{
    if(isHost)return;
    clearInterval(srRevealInterval);srRevealInterval=null;
    clearInterval(srPostRevealTimer);srPostRevealTimer=null;
    clearInterval(srBuzzCountdown);srBuzzCountdown=null;
    srRoundActive=false;
    srRoundEnd(null,payload.correctAns||null);
  });
  rtChannel.on('broadcast',{event:'sr_next_round'},({payload})=>{
    if(isHost)return;
    qIndex=payload.qIndex;
    srClearReveal();
    // Snapshot scores at the start of each new SR round so that a void can roll
    // back to exactly here, not to a stale snapshot from a previous round.
    // Also reset flag state so a window from the previous round can't carry over.
    mpSnapshotScores();
    mpFlagsThisQuestion=new Set();
    mpFlagWindowOpen=false;
    clearTimeout(mpFlagWindowTimer);
    document.getElementById('mpQCardFeedback').style.display='none';
    document.getElementById('mpAnswersGrid').innerHTML='';
    document.getElementById('mpQuestionText').style.display='none';
    document.getElementById('mpQLoading').style.display='flex';
    const qCard=document.querySelector('#page-mp-quiz .q-card');
    if(qCard)qCard.classList.remove('answered');
    // Also hide the flag button between rounds
    const rwNR=document.getElementById('mpReportWrap');if(rwNR)rwNR.style.display='none';
    renderMPHUD();
  });
  rtChannel.on('broadcast',{event:'countdown_ready'},({payload})=>{if(payload?.name){window._cdReady.add(payload.name);mpCdRenderReady();}});
  rtChannel.on('broadcast',{event:'game_cancelled'},()=>{
    if(isHost)return; // host handles this in mpCancelCountdown directly
    clearInterval(_countdownTick);_countdownTick=null;clearTimeout(_cdGoTimer);_cdGoTimer=null;window._cdReady.clear();
    document.getElementById('mpCountdownOverlay').style.display='none';
    document.getElementById('mpCountdownCancelBtn').style.display='none';
    // Reset state and return to lobby room to wait for the host's next start
    lobbyPlayers.forEach(p=>{p.score=0;p.lives=3;p.eliminated=false;});
    score=0;lives=3;qIndex=0;mpDbQIndex=0;mpShownDbQIndex=0;prefetchedRpcPromise=null;prefetchedRpcResult=null;answered=false;quizHistory=[];hpHistory=[];mpCancelBackup(mpActiveFuseBackupId);mpCancelBackup(mpActiveAutoNextBackupId);
    goStep('lobby-room');
  });
  rtChannel.on('broadcast',{event:'res_float'},({payload})=>{if(typeof mrShowFloat==='function')mrShowFloat(payload);});
  rtChannel.on('broadcast',{event:'res_back'},({payload})=>{if(typeof mrMarkBack==='function')mrMarkBack(payload&&payload.name);});
  rtChannel.on('broadcast',{event:'return_to_lobby'},()=>{
    if(isHost)return; // host navigated itself in mpReturnToLobby
    lobbyPlayers.forEach(p=>{p.score=0;p.lives=lobbyMode==='potato'?hpLives:lobbyMode==='survival'?selectedLives:3;p.eliminated=false;p.quit=false;});
    score=0;lives=lobbyMode==='potato'?hpLives:lobbyMode==='survival'?selectedLives:3;
    qIndex=0;mpDbQIndex=0;mpShownDbQIndex=0;prefetchedRpcPromise=null;prefetchedRpcResult=null;answered=false;quizHistory=[];hpHistory=[];mpCancelBackup(mpActiveFuseBackupId);mpCancelBackup(mpActiveAutoNextBackupId);prefetchedQuestion=null;currentQData=null;
    stopHeartbeat();startHeartbeat();
    goStep('lobby-room');
  });
  rtChannel.on('broadcast',{event:'host_transferred'},async({payload})=>{
    lobbyPlayers.forEach(p=>{p.isHost=(p.name===payload.newHost);});
    // Always hide the pause banner — transfer resolves the grace period regardless of reason
    hideHostPauseBanner();
    if(currentUser===payload.newHost){
      isHost=true;
      // Resume the timer from wherever the outgoing host was — not a fresh 10 min.
      const inherited=typeof payload.remainingSeconds==='number'&&payload.remainingSeconds>0
        ?payload.remainingSeconds:null;
      // Update expires_at in DB so future refreshes read the correct time. Must use a real
      // session token here, not the raw anon key — see rtSetLobbyStatus for why: if the
      // lobbies UPDATE policy checks auth.uid() = host_id, the anon key silently resolves
      // to no rows affected instead of erroring, leaving the DB expiry stale.
      if(inherited&&!SUPABASE_URL.includes('YOUR_PROJECT')&&lobbyCode){
        const newExpiry=new Date(Date.now()+inherited*1000).toISOString();
        const token=await rtGetAuthToken();
        fetch(`${SUPABASE_URL}/rest/v1/lobbies?code=eq.${encodeURIComponent(lobbyCode)}`,{
          method:'PATCH',
          headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Prefer':'return=minimal'},
          body:JSON.stringify({expires_at:newExpiry})
        }).catch(()=>{});
      }
      if(payload.reason==='reclaim'){
        showLobbyToast(`👑 Host returned. They've reclaimed the lobby.`,'warning');
      } else if(payload.reason==='left'){
        showLobbyToast(`👑 The host left. You're now the host!`,'warning');
      } else if(payload.reason==='grace_expired'){
        showLobbyToast(`👑 You're now the host. Requesting game state...`,'warning');
        // request_game_state was already broadcast in startHostGracePeriod; no duplicate needed
      } else {
        // Manual transfer
        showLobbyToast(`👑 You're now the host!`,'warning');
      }
      // startLobbyTimer is called by renderLobbyRoom when isHost&&!lobbyTimerInterval,
      // but we need to pass the inherited seconds. Clear first so the guard triggers correctly.
      clearLobbyTimer();
      startLobbyTimer(inherited);
    } else {
      isHost=false;
      if(payload.reason==='left'){
        showLobbyToast(`👑 ${payload.originalHostName||'The host'} left. ${payload.newHost} is now the host.`,'warning');
      } else if(payload.reason==='grace_expired'){
        showLobbyToast(`👑 ${payload.originalHostName||'The host'} disconnected. ${payload.newHost} is now the host.`,'warning');
      } else if(payload.reason==='reclaim'){
        showLobbyToast(`👑 ${payload.newHost} has reclaimed host.`,'warning');
      }
      // No toast for manual transfer — the outgoing host already knows, others don't need notifying
    }
    renderLobbyRoom();
  });
  rtChannel.on('broadcast',{event:'chat'},({payload})=>{
    if(!payload)return;
    if(payload.mine&&payload.name===currentUser)return; // our own echo
    if(typeof lrChatPush==='function')lrChatPush(Object.assign({},payload,{mine:false}));
  });
  rtChannel.on('broadcast',{event:'settings_changed'},({payload})=>{
    if(isHost)return;
    if(typeof lrHostEditing==='function')lrHostEditing(payload);
    // Keep local settings in sync so the read-only options panel reflects the host's live picks
    if(payload.format)lobbyFormat=payload.format;
    if(payload.mode)lobbyMode=payload.mode;
    if(payload.mode==='classic'&&payload.questionCount!=null)selectedQuestionLimit=payload.questionCount;
    if(payload.timeLimit!=null)raceTimeLimit=payload.timeLimit;
    if(payload.srTargetScore!=null)srTargetScore=payload.srTargetScore;
    if(payload.mpRaceTarget!=null)mpRaceTarget=payload.mpRaceTarget;
    if(payload.survivalLives!=null)selectedLives=payload.survivalLives;
    if(payload.survivalQuestionLimit!=null)survivalQuestionLimit=payload.survivalQuestionLimit;
    if(payload.hpLives!=null)hpLives=payload.hpLives;
    if(payload.hpFuseMin!=null)hpFuseMin=payload.hpFuseMin;
    if(payload.hpFuseMax!=null)hpFuseMax=payload.hpFuseMax;
    if(payload.isGeneral!=null)lobbyIsGeneral=payload.isGeneral;
    if(payload.lobbyLocked!=null){window.lobbyLocked=payload.lobbyLocked;if(typeof lrSyncHeader==='function')lrSyncHeader();}
    if(payload.topics){lobbyTopics=payload.topics;if(typeof lrChatRender==='function'&&typeof lrRailView!=='undefined'&&lrRailView==='chat')lrChatRender();} // refresh the chat's ADDED tags
    if(payload.activeTab!==undefined)gsActiveTab=payload.activeTab;
    if(!isHost&&payload.topicScrollTop!=null)gsTopicScrollTarget=payload.topicScrollTop;
    if(payload.topicSub!==undefined&&payload.topicSub!==gsTopicSub){gsTopicSub=payload.topicSub;gsBuildTopicContent();}
    if(!isHost&&payload.topicScrollTop!=null){const _l=document.getElementById('gsTopicList');if(_l)_l.scrollTop=payload.topicScrollTop;}
    if(payload.voidingEnabled!=null){
      voidingEnabled=payload.voidingEnabled;
      const btn=document.getElementById('gsVoidingToggle');
      if(btn){btn.classList.toggle('on',voidingEnabled);btn.setAttribute('aria-pressed',voidingEnabled);}
    }
    if(payload.showTyping!=null){
      lobbyShowTyping=payload.showTyping;
      const btn=document.getElementById('gsShowTypingToggle');
      if(btn){btn.classList.toggle('on',lobbyShowTyping);btn.setAttribute('aria-pressed',lobbyShowTyping);}
    }
    if(payload.hideSpoilers!=null)lobbyHideSpoilers=!!payload.hideSpoilers;
    if(payload.topicParts&&typeof payload.topicParts==='object')lobbyTopicParts={...payload.topicParts};
    if(typeof gsSyncUI==='function')gsSyncUI();
    const label=document.getElementById('lobbySettingsLabel');
    const hint=document.getElementById('lobbySettingsHint');
    const spinner=document.getElementById('lobbyChangingSpinner');
    const settingsBtn=document.getElementById('lobbySettingsBtn');
    const topicsLabel=document.getElementById('lobbyTopicsLabel');
    const timeLimitLabel=(payload.mode==='race'||payload.mode==='survival'||payload.mode==='classic')?` · ${payload.timeLimit}s`:'';
    const qCountLabel=payload.mode==='race'?` · First to ${payload.mpRaceTarget||mpRaceTarget} pts`:payload.mode==='slowreveal'?` · First to ${payload.srTargetScore||srTargetScore}`:` · ${payload.questionCount||selectedQuestionLimit}Q`;

    if(payload.changing){
      // ── Live update: show real settings as host changes them ──────────
      if(spinner)spinner.style.display='none';
      if(settingsBtn)settingsBtn.style.display='none';
      if(hint)hint.style.display='none';

      // Flash the label only when format/mode/count actually changed
      if(label){
        const newLabelText=fmtLabels[payload.format]+' · '+lobbyModeLabel(payload.mode)+qCountLabel+timeLimitLabel;
        if(label.textContent!==newLabelText){
          label.textContent=newLabelText;
          label.classList.remove('lobby-label-flash');
          void label.offsetWidth;
          label.classList.add('lobby-label-flash');
        }
      }

      // Only update topics when there's something meaningful to show.
      // An empty topics array with isGeneral=false is a transient reset
      // while the host navigates between settings pages — skip it to
      // avoid showing a confusing blank or "General Anime" flash mid-flow.
      if(topicsLabel){
        const topics=payload.topics||[];
        const isGeneral=payload.isGeneral??true;
        const hasContent=isGeneral||topics.length>0;
        if(hasContent){
          topicsLabel.style.display='block';
          if(isGeneral){
            topicsLabel.innerHTML='<span class="lobby-live-tag">✨ General Anime</span>';
          } else {
            // Each tag pops in with a staggered delay so they appear one by one
            topicsLabel.innerHTML=topics.map((t,i)=>
              `<span class="lobby-live-tag" style="animation-delay:${i*60}ms">${t.emoji} ${t.name}</span>`
            ).join(' ');
          }
        }
        // If hasContent is false (empty, non-general mid-flow) — leave whatever
        // was shown before untouched so the display doesn't flicker.
      }

    } else {
      // ── Final commit: host confirmed settings ─────────────────────────
      lobbyFormat=payload.format;lobbyMode=payload.mode;raceTimeLimit=payload.timeLimit;
      if(payload.srTargetScore)srTargetScore=payload.srTargetScore;
      if(payload.mpRaceTarget)mpRaceTarget=payload.mpRaceTarget;
      if(payload.survivalLives!=null)selectedLives=payload.survivalLives;
      if(payload.survivalQuestionLimit!=null)survivalQuestionLimit=payload.survivalQuestionLimit;
      if(payload.hpLives!=null)hpLives=payload.hpLives;
      if(payload.hpFuseMin!=null)hpFuseMin=payload.hpFuseMin;
      if(payload.hpFuseMax!=null)hpFuseMax=payload.hpFuseMax;
      if(payload.questionCount&&payload.mode==='classic')selectedQuestionLimit=payload.questionCount;
      lobbyTopics=payload.topics||[];lobbyIsGeneral=payload.isGeneral??true;
      selectedTopics=lobbyTopics;isGeneralSelected=lobbyIsGeneral;
      if(spinner)spinner.style.display='none';
      if(label){label.classList.remove('lobby-label-flash');label.style.color='';label.textContent=fmtLabels[payload.format]+' · '+lobbyModeLabel(payload.mode)+qCountLabel+timeLimitLabel;}
      if(hint)hint.style.display='';
      if(settingsBtn)settingsBtn.style.display='';
      if(topicsLabel){
        topicsLabel.style.display='block';
        if(lobbyIsGeneral||lobbyTopics.length===0){topicsLabel.textContent='General Anime';}
        else{topicsLabel.textContent=lobbyTopics.map(t=>t.emoji+' '+t.name).join(', ');}
      }
    }
  });
  rtChannel.on('broadcast',{event:'player_left'},({payload})=>{
    // Update every remaining player's UI — not just the host's.
    // The refresh-cleanup path sends this broadcast so all clients stay in sync.
    lobbyPlayers=lobbyPlayers.filter(p=>p.name!==payload.name);
    renderLobbyRoom();
  });
  rtChannel.on('broadcast',{event:'player_disconnected'},({payload})=>{
    // Mid-game connection drop — keep the player's row/score/lives, just grey them
    // out on the scoreboard. Distinct from player_quit (permanent) and player_left
    // (pre-game only) — this player may still rejoin (see the rejoin flow, which
    // sends player_reconnected to clear this flag).
    const p=lobbyPlayers.find(p=>p.userId===payload.userId||p.name===payload.name);
    if(p)p.connected=false;
    renderMPScoreboard();
  });
  rtChannel.on('broadcast',{event:'player_reconnected'},({payload})=>{
    // Clear offline indicator on the scoreboard for the returning player.
    const p=lobbyPlayers.find(p=>p.userId===payload.userId||p.name===payload.name);
    if(p)p.connected=true;
    renderMPScoreboard();
    // If this was the host reconnecting within the grace window, cancel the election.
    const wasHost=p?.isHost||false;
    if(wasHost&&(hostGraceTimer||hostGraceCountdown)){
      cancelHostGracePeriod();
      showLobbyToast(`🔄 Host reconnected. Game continues!`,'warning');
    }
  });
  rtChannel.on('broadcast',{event:'player_rejoined'},({payload})=>{
    // A player who previously quit has rejoined. Clear their quit flag so they
    // reappear as active on the scoreboard.
    const p=lobbyPlayers.find(lp=>lp.userId===payload.userId||lp.name===payload.name);
    if(p){p.quit=false;p.connected=true;}
    renderMPScoreboard();
  });
  // ── STATE SNAPSHOT (Step 4) ────────────────────────────────────────────────
  // A client that just rejoined mid-game (rtRejoinActiveLobby) or was just
  // elected host (startHostGracePeriod) sends request_game_state to ask for
  // a full picture of the current question and all mode variables. Any client
  // that currently has the live question loaded can answer — not only the
  // self-perceived host. This matters when the HOST is the one rejoining: their
  // own lobby_players row can still say is_host=true (e.g. they reconnected
  // within the grace window, before any election ran), so their local isHost
  // flips true on rejoin — but their currentQData was just wiped by the reload,
  // and every other client's isHost is false, so nobody would ever answer a
  // host-gated request. Gating on "do I actually have the data" instead fixes
  // that deadlock while still working for the ordinary non-host rejoin case.
  rtChannel.on('broadcast',{event:'request_game_state'},({payload})=>{
    if(!currentQData)return; // we don't have a live question ourselves — can't help
    // Compute how much time is left on the current question so the rejoining
    // client's timer bar reflects reality rather than resetting to 100 %.
    const snapRemainingTime=Math.max(0,timeLeft);
    rtChannel.send({type:'broadcast',event:'game_state_snapshot',payload:{
      // Question
      qIndex,
      mpDbQIndex, // the server's question index: without it a rejoiner's answer is rejected as stale
      currentQData,
      snapRemainingTime,
      // Format / mode / topic
      selectedFormat,
      selectedMode,
      lobbyMode,
      lobbyTopics,
      lobbyIsGeneral,
      // Scoring targets
      srTargetScore,
      mpRaceTarget,
      selectedLives,
      // Hot Potato
      hpLives,
      hpFuseMin,
      hpFuseMax,
      hpActiveIdx,
      hpTurnOrder,
      // Tiebreaker
      mpTiebreakerPlayers,
      // Let the receiver know who the snapshot is for (informational only)
      forUserId:payload.userId||null
    }});
  });

  // Receiving end: a game-state snapshot arrived (we are the rejoining client or
  // newly elected host).  Apply every field then render the live question.
  // Exception: Slow Reveal mid-reveal state cannot be reconstructed from a
  // snapshot (character-by-character animation + buzz-in state are ephemeral).
  // In that case, drop the client into a visible spectator state rather than
  // half-rendering a broken question.
  rtChannel.on('broadcast',{event:'game_state_snapshot'},({payload})=>{
    // Ignore only if we're host AND already have a live question (we sent this
    // ourselves, or became host between sending the request and receiving the
    // echo). A rejoining original host can still be isHost=true with no
    // currentQData yet (see the request_game_state handler above) — that case
    // must fall through and apply the snapshot like any other rejoiner, or
    // they'd be stuck staring at the loading spinner forever.
    if(isHost&&currentQData)return;

    // Apply all mode/topic/scoring fields
    if(payload.selectedFormat)  { selectedFormat=payload.selectedFormat;  lobbyFormat=payload.selectedFormat; }
    if(payload.selectedMode)    { selectedMode=payload.selectedMode;      lobbyMode=payload.lobbyMode||payload.selectedMode; }
    if(payload.lobbyMode)       lobbyMode=payload.lobbyMode;
    if(Array.isArray(payload.lobbyTopics))  lobbyTopics=payload.lobbyTopics;
    if(typeof payload.lobbyIsGeneral==='boolean') lobbyIsGeneral=payload.lobbyIsGeneral;
    if(payload.srTargetScore!=null)  srTargetScore=payload.srTargetScore;
    if(payload.mpRaceTarget!=null)   mpRaceTarget=payload.mpRaceTarget;
    if(payload.selectedLives!=null)          selectedLives=payload.selectedLives;
    if(payload.survivalQuestionLimit!=null)  survivalQuestionLimit=payload.survivalQuestionLimit;
    if(payload.hpLives!=null)                hpLives=payload.hpLives;
    if(payload.hpFuseMin!=null)      hpFuseMin=payload.hpFuseMin;
    if(payload.hpFuseMax!=null)      hpFuseMax=payload.hpFuseMax;
    if(payload.hpActiveIdx!=null)    hpActiveIdx=payload.hpActiveIdx;
    if(Array.isArray(payload.hpTurnOrder)&&payload.hpTurnOrder.length) hpTurnOrder=payload.hpTurnOrder;
    if(Array.isArray(payload.mpTiebreakerPlayers)) mpTiebreakerPlayers=payload.mpTiebreakerPlayers;
    if(payload.qIndex!=null)         qIndex=payload.qIndex;
    // Server question index: mp_submit_answer rejects any other index as stale, so a rejoiner
    // left on their pre-disconnect value had their answers dropped (and scored only locally).
    if(typeof payload.mpDbQIndex==='number'&&payload.mpDbQIndex>=mpDbQIndex){mpDbQIndex=payload.mpDbQIndex;mpShownDbQIndex=payload.mpDbQIndex;}

    // Slow Reveal: we cannot reconstruct the character-reveal animation or buzz-in
    // state from a snapshot.  Show a spectator holding message instead and wait for
    // the host to advance to the next round naturally.
    if(lobbyMode==='slowreveal'){
      document.getElementById('mpQLoading').style.display='none';
      document.getElementById('mpQCardFeedback').style.display='none';
      document.getElementById('mpAnswersGrid').innerHTML='';
      const qt=document.getElementById('mpQuestionText');
      if(qt){
        qt.style.display='block';
        qt.innerHTML='<span style="color:var(--muted);font-size:15px;font-weight:700">⏳ Catching up. Next round starts soon...</span>';
      }
      renderMPHUD();
      renderMPScoreboard();
      return;
    }

    // All other modes: apply the question and start the timer from the remaining
    // time the host reported, not from the full question duration.
    if(!payload.currentQData)return; // no question data — nothing to show
    currentQData=payload.currentQData;

    // Did we already answer THIS question before disconnecting? answered/answeredQIndex
    // are plain JS globals that survive a same-tab quit+rejoin (mpQuitGame never resets
    // them), so if they still point at the qIndex we're about to redisplay, this player
    // already banked their points for it. Capture that BEFORE calling mpShowQuestion()
    // below, since mpShowQuestion() unconditionally resets answered=false to build a
    // fresh, clickable answer grid — without this guard a rejoining player could answer
    // the same question a second time and be credited points twice.
    const alreadyAnsweredThisQ=(answered&&answeredQIndex===payload.qIndex);

    // Override questionStartTime so the local timer starts mid-flight.
    // mpShowQuestion() calls questionStartTime=Date.now() internally, which would
    // reset to 100 %.  We patch it back immediately after so the bar reflects reality.
    const snapRemaining=typeof payload.snapRemainingTime==='number'?payload.snapRemainingTime:raceTimeLimit;
    mpShowQuestion(currentQData, lobbyMode==='potato'?snapRemaining:null);

    if(alreadyAnsweredThisQ){
      // Re-lock: block another submission and swap the freshly-built clickable
      // grid/input for a plain "already answered" reveal instead of letting the
      // player interact with a question they've already scored.
      answered=true;answeredQIndex=payload.qIndex;
      mpCancelBackup(mpActiveFuseBackupId);
      document.querySelectorAll('#mpAnswersGrid .ans').forEach(a=>a.classList.add('locked'));
      const rjInput=document.getElementById('mpTypeInput');if(rjInput)rjInput.disabled=true;
      const rjSubmitBtn=document.getElementById('mpTypeSubmitBtn');if(rjSubmitBtn)rjSubmitBtn.disabled=true;
      const rjCorrectAns=currentQData.options?currentQData.options[currentQData.answer]:currentQData.answer;
      const mpQCardRJ=document.querySelector('#page-mp-quiz .q-card');if(mpQCardRJ)mpQCardRJ.classList.add('answered');
      const mpQTextRJ=document.getElementById('mpQuestionText');
      if(mpQTextRJ){
        mpQTextRJ.innerHTML=`<div class="q-answer-reveal">${rjCorrectAns}</div>${fallbackHintHTML(currentQData)}<div style="margin-top:8px;font-size:12px;color:var(--muted);font-weight:700">✅ You already answered this question</div>`;
      }
    }

    // Back-calculate questionStartTime so the draining interval sees the right elapsed time.
    // mpShowQuestion set questionStartTime=Date.now(), so we subtract the already-elapsed portion.
    const alreadyElapsed=raceTimeLimit-snapRemaining;
    questionStartTime=Date.now()-alreadyElapsed*1000;
    timeLeft=snapRemaining;

    renderMPHUD();
    renderMPScoreboard();
  });

  rtChannel.on('broadcast',{event:'player_quit'},({payload})=>{
    // Mid-game quit — keep the player visible but mark them as quit
    const p=lobbyPlayers.find(p=>p.name===payload.name);
    if(p){p.quit=true;}
    renderMPScoreboard();
  });
  rtChannel.on('broadcast',{event:'player_kicked'},async({payload})=>{
    if(currentUser===payload.kicked){
      intentionalLeave=true;
      if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
      clearLobbyTimer();
      // Record the kicked lobby code in sessionStorage so rejoin is blocked even if DB write races
      try{
        const kicked=JSON.parse(sessionStorage.getItem('kicked_from_lobbies')||'[]');
        if(lobbyCode&&!kicked.includes(lobbyCode)){kicked.push(lobbyCode);sessionStorage.setItem('kicked_from_lobbies',JSON.stringify(kicked));}
      }catch(e){}
      // Delete own lobby_players row so we don't phantom-appear in counts
      if(currentUserId&&!SUPABASE_URL.includes('YOUR_PROJECT')&&payload.lobby_id){
        try{
          const token=await rtGetAuthToken();
          await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${payload.lobby_id}&user_id=eq.${currentUserId}`,{method:'DELETE',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Prefer':'return=minimal'}});
        }catch(e){}
      }
      lobbyPlayers=[];
      lobbyCode='';
      // Navigate to multiplayer first, then show modal on top
      goStep('multiplayer');
      document.getElementById('kickedModal').classList.add('open');
      applyTheme();
      return;
    }
    // For other players, just remove them from the list
    lobbyPlayers=lobbyPlayers.filter(p=>p.name!==payload.kicked);
    renderLobbyRoom();
  });
  // ── PRESENCE — reliable disconnect/refresh/close detection ──────────────────
  // Each client tracks itself on the channel. When a WebSocket drops for any reason
  // (refresh, tab close, crash, bfcache restore), Supabase fires a `leave` event on
  // all remaining subscribers immediately — no pagehide, no sessionStorage needed.
  rtChannel.on('presence',{event:'join'},({newPresences})=>{
    // Instantly apply avatars from the presence payload so the lobby player list
    // shows avatars immediately — before rtRefreshPlayers completes its DB fetch.
    if(!Array.isArray(newPresences))return;
    let changed=false;
    for(const p of newPresences){
      if(!p.userId)continue;
      const existing=lobbyPlayers.find(lp=>lp.userId===p.userId);
      if(existing){
        if(p.avatar&&!existing.avatar){existing.avatar=p.avatar;changed=true;}
        if(typeof p.hasPfp==='boolean'&&existing.hasPfp===undefined){existing.hasPfp=p.hasPfp;changed=true;}
      }
    }
    if(changed)renderLobbyRoom();
  });

  rtChannel.on('presence',{event:'leave'},async({leftPresences})=>{
    if(intentionalLeave){return;}
    if(SUPABASE_URL.includes('YOUR_PROJECT')||!lobbyCode){return;}

    for(const presence of leftPresences){
      const goneUserId=presence.userId;
      const goneUsername=presence.username;
      if(!goneUserId){continue;}

      if(goneUserId===currentUserId){continue;}

      // If the user is still in presenceState they just re-tracked (e.g. avatar change) not a real disconnect
      const stillPresent=Object.values(rtChannel.presenceState()||{}).flat().some(p=>p.userId===goneUserId);
      if(stillPresent){continue;}

      const token=await rtGetAuthToken();
      const headers={'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Prefer':'return=minimal'};

      // 1. Resolve lobby id + status — status decides whether a disconnect is a soft
      //    "offline" flag (mid-game) or the original hard delete (pre-game waiting room).
      let lid=null,lobbyStatus=null;
      try{
        const lRes=await fetch(`${SUPABASE_URL}/rest/v1/lobbies?select=id,status&code=eq.${encodeURIComponent(lobbyCode)}&limit=1`,{headers});
        const lData=await lRes.json();
        lid=Array.isArray(lData)?lData[0]?.id:null;
        lobbyStatus=Array.isArray(lData)?lData[0]?.status:null;
      }catch(e){}
      if(!lid) continue;

      // ── MID-GAME DISCONNECT (status==='active') ───────────────────────────────
      // A connection drop during an active game must NOT delete the player's row —
      // score/lives are durable progress, not throwaway lobby-room state. Flag them
      // offline instead so other clients can grey them out on the scoreboard, and
      // leave host reassignment entirely to the active-game grace-period logic that
      // owns that decision (not handled here).
      if(lobbyStatus==='active'){
        try{
          const chkRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=user_id,connected&user_id=eq.${encodeURIComponent(goneUserId)}&lobby_id=eq.${lid}&limit=1`,{headers});
          const chkData=await chkRes.json();
          if(!Array.isArray(chkData)||!chkData.length){continue;}
          if(chkData[0].connected===false){continue;}
        }catch(e){console.error('[presence:leave] active — error checking row',e);continue;}

        try{
          await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?user_id=eq.${encodeURIComponent(goneUserId)}&lobby_id=eq.${lid}`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({connected:false})});
        }catch(e){console.error('[presence:leave] active — error marking offline',e);}

        const offlinePlayer=lobbyPlayers.find(p=>p.userId===goneUserId);
        if(offlinePlayer)offlinePlayer.connected=false;
        if(rtChannel)rtChannel.send({type:'broadcast',event:'player_disconnected',payload:{name:goneUsername,userId:goneUserId}});

        // If the disconnected player was the host, start the 20s grace period.
        // The grace period is run on every remaining connected client so that if
        // the first-in-line client is also gone, the next one can take over.
        const wasHost=lobbyPlayers.find(p=>p.userId===goneUserId)?.isHost||false;
        if(wasHost){
          const inMpQuiz=document.getElementById('page-mp-quiz').classList.contains('active');
          if(inMpQuiz){
            startHostGracePeriod(goneUsername,goneUserId,lid);
          }
        }

        // Empty-lobby cleanup mid-game is row-based, not presence-based — everyone
        // being briefly offline must not delete the lobby out from under them. This
        // only fires once every connected lobby_players row is actually gone (i.e. the
        // last remaining player disconnected or quit).
        try{
          const remRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=user_id&lobby_id=eq.${lid}&connected=eq.true`,{headers});
          const remData=await remRes.json();
          if(!Array.isArray(remData)||!remData.length){
            await fetch(`${SUPABASE_URL}/rest/v1/lobbies?id=eq.${lid}`,{method:'DELETE',headers});
          }
        }catch(e){}

        renderMPScoreboard();
        continue;
      }

      // ── PRE-GAME DISCONNECT (status==='waiting') — unchanged existing behavior ──
      // 2. Check if the player is still in DB (they may have already cleaned up themselves
      //    e.g. via leaveLobbyRoom in another tab, or a duplicate presence leave).
      let wasThisPlayerHost=false;
      try{
        const chkRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=is_host&user_id=eq.${encodeURIComponent(goneUserId)}&lobby_id=eq.${lid}&limit=1`,{headers});
        const chkData=await chkRes.json();
        if(!Array.isArray(chkData)||!chkData.length){continue;}
        wasThisPlayerHost=chkData[0]?.is_host||false;
      }catch(e){console.error('[presence:leave] error checking row',e);continue;}

      // 3. Delete their player row
      try{
        const delRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?user_id=eq.${encodeURIComponent(goneUserId)}&lobby_id=eq.${lid}`,{method:'DELETE',headers});
      }catch(e){console.error('[presence:leave] error deleting row',e);}

      // 4. Update local player list immediately so the UI is responsive
      lobbyPlayers=lobbyPlayers.filter(p=>p.userId!==goneUserId);

      // 5. Check who remains — explicitly exclude the gone user in case Supabase
      //    serves a stale read and their row still appears after the DELETE.
      let remaining=[];
      try{
        const pRes=await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?select=user_id,username&lobby_id=eq.${lid}&order=joined_at.asc`,{headers});
        const pData=await pRes.json();
        remaining=(Array.isArray(pData)?pData:[]).filter(p=>p.user_id!==goneUserId);
      }catch(e){}

      if(!remaining.length){
        // Nobody left — only this observer (us) could be remaining, but we already
        // filtered ourselves out above. If the lobby is empty, delete it.
        try{
          await fetch(`${SUPABASE_URL}/rest/v1/lobbies?id=eq.${lid}`,{method:'DELETE',headers});
        }catch(e){}
        // We're alone now — treat as if the lobby closed
        intentionalLeave=true;
        if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
        clearLobbyTimer();
        goStep('multiplayer');
        return;
      }

      // 6. If the disconnected player was the host, elect the first remaining player as host.
      //    Use the same stable-order self-election as the existing postgres_changes path —
      //    only the client whose userId matches the first remaining row claims host.
      if(wasThisPlayerHost){
        const next=remaining[0];
        if(next.user_id===currentUserId){
          try{
            await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lid}`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({is_host:false})});
            await fetch(`${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lid}&user_id=eq.${currentUserId}`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({is_host:true})});
            await fetch(`${SUPABASE_URL}/rest/v1/lobbies?id=eq.${lid}`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({host_id:currentUserId,host_username:currentUser})});
          }catch(e){console.error('[presence:leave] error claiming host',e);}
          isHost=true;
          intentionalLeave=false;
          lobbyPlayers.forEach(p=>{p.isHost=(p.userId===currentUserId);});
          if(rtChannel)rtChannel.send({type:'broadcast',event:'host_transferred',payload:{newHost:currentUser,reason:'left',originalHostName:goneUsername||'The host',remainingSeconds:lobbyTimerSecondsLeft}});
          clearLobbyTimer();
          startLobbyTimer(lobbyTimerSecondsLeft||null);
        } else {
          if(rtChannel)rtChannel.send({type:'broadcast',event:'player_left',payload:{name:goneUsername}});
        }
      } else {
        if(rtChannel)rtChannel.send({type:'broadcast',event:'player_left',payload:{name:goneUsername}});
      }

      renderLobbyRoom();
    }
  });

  rtChannel.subscribe(async(status)=>{
    if(status==='SUBSCRIBED'){
      // Track ourselves so the presence `leave` handler on other clients fires when we disconnect
      if(currentUserId){
        // Include avatar in presence so other clients get it instantly on join,
        // without waiting for the DB join in rtRefreshPlayers (eliminates 3-5s delay).
        let presenceAvatar=null;
        if(currentPfp){
          presenceAvatar=currentPfp.type==='preset'?'preset:'+currentPfp.value:currentPfp.value;
        }
        _pfpLastTrackAt=Date.now();
        await rtChannel.track({userId:currentUserId,username:currentUser,avatar:presenceAvatar,hasPfp:!!currentPfp});
      }
      startHeartbeat();
    }
    if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
      if(intentionalLeave){intentionalLeave=false;return;} // user left on purpose, skip modal
      const inMpQuiz=document.getElementById('page-mp-quiz').classList.contains('active');
      const inLobby=document.getElementById('page-lobby-room').classList.contains('active');
      if(inMpQuiz||inLobby){
        showDisconnectModal();
      }
    }
  });

  // Also detect tab visibility change — if guest comes back after hiding tab mid-game
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&rtChannel){
      const inMpQuiz=document.getElementById('page-mp-quiz').classList.contains('active');
      const inLobby=document.getElementById('page-lobby-room').classList.contains('active');
      if((inMpQuiz||inLobby)&&rtChannel.state!=='joined'){
        showDisconnectModal();
      }
    }
  },{..._rtSignal,once:false});

  // Detect tab visibility change for the HOST — re-validate lobby against DB when
  // they return to a tab that may have been throttled/suspended by the browser.
  document.addEventListener('visibilitychange',async()=>{
    if(_rtVisibilityAbort?.signal.aborted)return;
    if(document.visibilityState!=='visible'||!isHost||!lobbyCode)return;
    const inLobby=document.getElementById('page-lobby-room').classList.contains('active');
    if(!inLobby)return;
    if(SUPABASE_URL.includes('YOUR_PROJECT'))return;
    try{
      const r=await fetch(
        `${SUPABASE_URL}/rest/v1/lobbies?select=expires_at,status&code=eq.${encodeURIComponent(lobbyCode)}&limit=1`,
        {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
      );
      const d=await r.json();
      const lobby=Array.isArray(d)?d[0]:null;
      // Lobby is gone or expired in the DB
      if(!lobby||lobby.status!=='waiting'||new Date(lobby.expires_at)<=new Date()){
        clearLobbyTimer();
        await rtDeleteLobby().catch(()=>{});
        intentionalLeave=true;
        if(rtChannel){rtChannel.unsubscribe();rtChannel=null;}
        isHost=false;
        goStep('multiplayer');
        setTimeout(()=>showLobbyExpiredModal(),300);
        return;
      }
      // Lobby still alive — recalibrate the local countdown to match DB truth,
      // correcting for however long the tab was throttled.
      const secsLeft=Math.round((new Date(lobby.expires_at)-Date.now())/1000);
      if(secsLeft>0){
        clearLobbyTimer();
        startLobbyTimer(secsLeft);
      }
    }catch(e){}
  },{..._rtSignal,once:false});
}

let _refreshPlayersTimer=null;
// Apply avatars from the Realtime presence state snapshot to lobbyPlayers.
// Called after rtRefreshPlayers populates the list from the DB — covers the case
// where presence fired before the DB row existed, so the presence:join patch
// found no entry to update and the avatar was silently dropped.
function applyPresenceAvatars(){
  if(!rtChannel)return;
  const state=rtChannel.presenceState();
  if(!state)return;
  let changed=false;
  for(const presences of Object.values(state)){
    for(const p of presences){
      if(!p.userId)continue;
      const player=lobbyPlayers.find(lp=>lp.userId===p.userId);
      if(player){
        // hasPfp:false means the player explicitly removed their avatar
        if(p.hasPfp===false){if(player.avatar||player.hasPfp){player.avatar=null;player.hasPfp=false;changed=true;}}
        else if(p.avatar&&!player.avatar){player.avatar=p.avatar;player.hasPfp=true;changed=true;}
      }
    }
  }
  return changed;
}

async function rtRefreshPlayers(lobbyId,immediate=false){
  // Debounce: if multiple postgres_changes events fire in quick succession (e.g.
  // a player leave triggers both a DELETE on lobby_players and an UPDATE on lobbies),
  // only run the last one — avoids racing the DELETE commit and showing stale data.
  // Pass immediate=true to skip the debounce (used on initial join).
  if(immediate){
    try{
      const res=await fetch(
        `${SUPABASE_URL}/rest/v1/lobby_players?select=*,profiles(avatar_url)&lobby_id=eq.${lobbyId}&order=joined_at.asc`,
        {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
      );
      const data=await res.json();
      if(Array.isArray(data)&&data.length){
        lobbyPlayers=data.map(p=>({name:p.username,color:p.color,isHost:p.is_host,score:p.score,lives:p.lives,eliminated:p.eliminated,userId:p.user_id,avatar:p.profiles?.avatar_url||null,connected:p.connected!==false}));
        // If we locally know we're host, correct any stale DB read that may not reflect it yet
        if(isHost) lobbyPlayers.forEach(p=>{p.isHost=(p.userId===currentUserId);});
        applyPresenceAvatars();
        lobbyPlayers.forEach(p=>{if(removedAvatarUserIds.has(p.userId)){p.avatar=null;p.hasPfp=false;}});
      }
    }catch(e){}
    return;
  }
  clearTimeout(_refreshPlayersTimer);
  _refreshPlayersTimer=setTimeout(async()=>{
    // Don't refresh if we've already left the lobby
    const inLobby=document.getElementById('page-lobby-room').classList.contains('active');
    if(!inLobby)return;
    try{
      const res=await fetch(
        `${SUPABASE_URL}/rest/v1/lobby_players?select=*,profiles(avatar_url)&lobby_id=eq.${lobbyId}&order=joined_at.asc`,
        {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
      );
      const data=await res.json();
      if(!Array.isArray(data)||!data.length)return;
      lobbyPlayers=data.map(p=>({name:p.username,color:p.color,isHost:p.is_host,score:p.score,lives:p.lives,eliminated:p.eliminated,userId:p.user_id,avatar:p.profiles?.avatar_url||null,connected:p.connected!==false}));
      // If we locally know we're host, correct any stale DB read that may not reflect it yet
      if(isHost) lobbyPlayers.forEach(p=>{p.isHost=(p.userId===currentUserId);});
      applyPresenceAvatars();
      // Keep removals sticky: DB may return stale avatar_url before PATCH commits
      lobbyPlayers.forEach(p=>{if(removedAvatarUserIds.has(p.userId)){p.avatar=null;p.hasPfp=false;}});
      renderLobbyRoom();
    }catch(e){}
  },300); // 300 ms debounce gives the DB DELETE time to commit
}

function mpResetQuestionCard(){
  document.getElementById('mpQuestionText').style.display='none';
  document.getElementById('mpQuestionText').innerHTML='';
  document.getElementById('mpAnswersGrid').innerHTML='';
  document.getElementById('mpQCardFeedback').style.display='none';
  document.getElementById('mpQLoading').style.display='flex';
  const _mpIw=document.getElementById('mpQImageWrap');const _mpIe=document.getElementById('mpQImage');
  if(_mpIw){_mpIw.style.display='none';}if(_mpIe){_mpIe.onload=null;_mpIe.onerror=null;_mpIe.src='';}
  const mpQCard=document.querySelector('#page-mp-quiz .q-card');
  if(mpQCard)mpQCard.classList.remove('answered');
}

async function mpHostFetchAndBroadcast(){
  // Race/Classic/Survival share a timer-or-all-answered shape that maps onto one
  // idempotent RPC. char-mc is excluded even in those modes — its MC options are
  // built from AniList/Jikan distractors client-side, which the RPC's question
  // snapshot has no way to carry. Hot Potato/Slow Reveal stay on the legacy path
  // entirely — turn-order/buzz-in progression is a different shape, handled separately.
  const useRpc=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
  let qData,hpFuse=null;
  if(useRpc){
    let data,error;
    if(prefetchedRpcResult){
      // Already resolved — use it directly with no await at all. `await` yields
      // to the browser at least once even on an already-resolved promise, which
      // would paint the loading spinner for a frame on literally every question;
      // this synchronous path is what actually avoids that, not just the prefetch
      // timing itself.
      ({data,error}=prefetchedRpcResult);
      prefetchedRpcPromise=null;prefetchedRpcResult=null;
    } else if(prefetchedRpcPromise){
      // Genuinely still in flight (slow connection, or needed sooner than usual)
      // — this is the one case actually worth a loading state.
      document.getElementById('mpQLoading').style.display='flex';
      ({data,error}=await prefetchedRpcPromise);
      prefetchedRpcPromise=null;prefetchedRpcResult=null;
    } else {
      // No prefetch available at all — the auto-next pause was skipped for some
      // reason. Falls back to a live call here, same as before this prefetch existed.
      document.getElementById('mpQLoading').style.display='flex';
      const topic=selectedTopics.length>0?selectedTopics[Math.floor(Math.random()*selectedTopics.length)]:null;
      ({data,error}=await sb.rpc('mp_advance_question',{
        p_lobby_id:currentLobbyId,
        p_expected_q_index:mpDbQIndex,
        p_format:selectedFormat,
        p_topic_type:topic?topic.type:null,
        p_topic_value:topic?topic.name:null,
        p_exclude_ids:quizHistory.map(h=>h.id).filter(id=>id!=null),
        p_time_limit:raceTimeLimit
      }));
    }
    if(error||!data||(!data.advanced&&data.reason!=='already_advanced')){
      // Couldn't reach the server or it rejected the call outright (not just
      // "someone already advanced it") — fall back to the old local pick so the
      // game doesn't stall. This is the one remaining client-trusted path for
      // this step; a network blip here shouldn't be able to freeze the lobby.
      console.error('mp_advance_question failed, falling back to local pick:',error||data);
      document.getElementById('mpQLoading').style.display='flex';
      qData=prefetchedQuestion||await fetchQuestion();
    } else {
      // Either we advanced it, or the server tells us someone/something else
      // already did — either way this response is the real current state, so
      // adopt it rather than trusting our own guess.
      mpDbQIndex=data.q_index;
      qData=data.current_question;
      mpShownDbQIndex=mpDbQIndex; // so our own broadcast echo is ignored
    }
  } else {
    if(!prefetchedQuestion)document.getElementById('mpQLoading').style.display='flex';
    qData=prefetchedQuestion||await fetchQuestion();
    hpFuse=lobbyMode==='potato'?(hpFuseMin+Math.random()*(hpFuseMax-hpFuseMin)):null; // host generates fuse so all clients sync
  }
  prefetchedQuestion=null;
  currentQData=qData;
  rtChannel.send({type:'broadcast',event:'question',payload:{qData,qIndex,hpFuse,mpDbQIndex}});
  // Supabase does not echo broadcasts to the sender — host must show the question itself
  document.getElementById('mpQLoading').style.display='none';
  mpShowQuestion(qData,hpFuse);renderMPHUD();
}

let _countdownTick=null;
let _cdGoTimer=null;window._cdReady=window._cdReady||new Set();
function mpCdAvatarHTML(p,col,nm){
  if(!p.avatar)return '<div class="mp-cd-av" style="background:'+col+'">'+pfEsc(nm.slice(0,2).toUpperCase())+'</div>';
  return getLobbyAvatarHTML(p.avatar,col,pfEsc(nm[0].toUpperCase()),42).replace('class="lobby-player-avatar"','class="mp-cd-av"');
}
function mpCdRenderReady(){
  const wrap=document.getElementById('mpCdReady'),lbl=document.getElementById('mpCdReadyLbl');if(!wrap)return;
  const ps=(lobbyPlayers||[]).filter(p=>!p.quit);
  const isOk=p=>p.isHost||p.name===currentUser||window._cdReady.has(p.name);
  if(wrap.dataset.built!=='1'){
    const cols=['#F6C98E','#96C7FF','#F6A5B8','#7ae0a3','#c3caf0','#b8a9ff'];
    wrap.innerHTML=ps.map((p,i)=>{const nm=String(p.name||'?');return '<div class="mp-cd-p'+(isOk(p)?' ok':'')+'" data-n="'+pfEsc(nm)+'">'+mpCdAvatarHTML(p,cols[i%cols.length],nm)+'<img class="ok-mark" src="assets/ok/maru.png" alt=""><span>'+pfEsc(nm)+'</span></div>';}).join('');
    wrap.dataset.built='1';
  } else {
    wrap.querySelectorAll('.mp-cd-p').forEach(el=>{const p=ps.find(x=>String(x.name)===el.dataset.n);el.classList.toggle('ok',!!p&&isOk(p));});
  }
  if(lbl)lbl.textContent='READY · '+ps.filter(isOk).length+' / '+ps.length;
}
function mpShowCountdown(onDone,hpFirstHolder,solo){
  closePfpPicker();
  clearTimeout(_cdGoTimer);_cdGoTimer=null;
  const overlay=document.getElementById('mpCountdownOverlay');
  const numEl=document.getElementById('mpCountdownNum');
  const lblEl=document.getElementById('mpCountdownLabel');
  const cancelBtn=document.getElementById('mpCountdownCancelBtn');
  const potatoEl=document.getElementById('hpHolderPotato');
  const burst=document.getElementById('mpCdBurst'),burstImg=document.getElementById('mpCdBurstImg');
  const isHP=!!hpFirstHolder;
  const isHolder=isHP&&hpFirstHolder===currentUser;
  const mode=solo?solo.mode:(lobbyMode||selectedMode);
  overlay.classList.remove('hp-holder','leaving');
  if(potatoEl)potatoEl.style.display='none';
  document.getElementById('mpCdTitle').textContent=(solo?({race:'Score Race',classic:'Classic',survival:'Survival'}[mode]||lobbyModeLabel(mode)):lobbyModeLabel(mode))+(fmtLabels[selectedFormat]?' · '+fmtLabels[selectedFormat]:'');
  let topic='';try{const gen=solo?(isGeneralSelected||!(selectedTopics&&selectedTopics.length)):(lobbyIsGeneral||!(lobbyTopics&&lobbyTopics.length));topic=gen?getSiteText('htp_topic_general'):(solo?selectedTopics:lobbyTopics).map(t=>t.name).join(', ');}catch(e){}
  document.getElementById('mpCdTopic').textContent=topic&&topic!=='htp_topic_general'?'Topic · '+topic:'';
  const readyBox=document.getElementById('mpCdReady');
  readyBox.dataset.built='';
  if(readyBox.parentElement)readyBox.parentElement.style.display=solo?'none':'flex';
  if(!solo)mpCdRenderReady();
  overlay.style.display='flex';
  if(cancelBtn)cancelBtn.style.display=(isHost&&!solo)?'inline-flex':'none';
  const setNum=(v,go)=>{numEl.textContent=v;numEl.classList.toggle('go',!!go);if(burstImg)burstImg.src=go?'assets/ok/burst-gold.png':'assets/ok/burst-cream.png';if(burst){burst.classList.remove('pop');void burst.offsetWidth;burst.classList.add('pop');}};
  // multiplayer 5s; solo 3s and skippable
  let count=solo?3:5;
  setNum(count);
  if(isHP){
    if(isHolder){
      overlay.classList.add('hp-holder');
      if(potatoEl)potatoEl.style.display='block';
      lblEl.innerHTML='<span style="font-size:17px;font-weight:900">You\'re holding it first!</span>';
    } else {
      lblEl.innerHTML='🥔 <span style="font-weight:900">'+pfEsc(hpFirstHolder)+'</span> starts with the potato!';
    }
  } else {
    lblEl.innerHTML=solo?'<span style="font-size:13px;font-weight:800;opacity:.75;letter-spacing:.04em">Click or press Space to skip</span>':'';
  }
  const unbindSkip=()=>{overlay.removeEventListener('pointerdown',skip);document.removeEventListener('keydown',skipKey,true);};
  const skip=()=>{if(count<=0)return;count=1;tick();};
  const skipKey=e=>{if(e.code==='Space'||e.key==='Enter'){e.preventDefault();e.stopPropagation();skip();}};
  if(solo){overlay.addEventListener('pointerdown',skip);document.addEventListener('keydown',skipKey,true);}
  const tick=()=>{
    count--;
    if(count<=0){
      unbindSkip();
      clearInterval(_countdownTick);_countdownTick=null;
      setNum('GO!',true);
      if(solo)lblEl.textContent='';
      if(cancelBtn)cancelBtn.style.display='none';
      _cdGoTimer=setTimeout(()=>{
        overlay.classList.add('leaving');
        onDone();
        _cdGoTimer=setTimeout(()=>{
          _cdGoTimer=null;
          overlay.style.display='none';
          overlay.classList.remove('leaving','hp-holder');
          if(potatoEl)potatoEl.style.display='none';
          window._cdReady.clear();
        },380);
      },650);
      return;
    }
    setNum(count);
  };
  clearInterval(_countdownTick);
  _countdownTick=setInterval(tick,1000);
}

function mpCancelCountdown(){
  if(!isHost)return;
  clearInterval(_countdownTick);_countdownTick=null;clearTimeout(_cdGoTimer);_cdGoTimer=null;window._cdReady.clear();
  document.getElementById('mpCountdownOverlay').style.display='none';
  document.getElementById('mpCountdownCancelBtn').style.display='none';
  // Notify all other clients to dismiss their countdown and return to lobby
  if(rtChannel){
    rtChannel.send({type:'broadcast',event:'game_cancelled',payload:{}});
  }
  // Reset lobby state so the host can make changes and start again
  lobbyPlayers.forEach(p=>{p.score=0;p.lives=3;p.eliminated=false;});
  score=0;lives=3;qIndex=0;mpDbQIndex=0;mpShownDbQIndex=0;prefetchedRpcPromise=null;prefetchedRpcResult=null;answered=false;quizHistory=[];hpHistory=[];mpCancelBackup(mpActiveFuseBackupId);mpCancelBackup(mpActiveAutoNextBackupId);
  srClearReveal();
  rtSetLobbyStatus('waiting');
  goStep('lobby-room');
}

// Fires mp_advance_question early and tracks both the in-flight promise (for the
// rare case it's still pending when needed) and the resolved result (checked
// synchronously first, so a completed prefetch never has to go through an await
// at all — see prefetchedRpcResult's declaration for why that distinction matters).
// Winner-takes-the-round advance for Race/Classic/Survival (non-char-mc). Used when
// everyone has answered (round_resolved) and when the timer runs out.
async function mpRpcAdvanceAndBroadcast(advFrom){
      // advFrom = the question this round resolved (see mpStartAutoNext). If a newer
      // question is already on screen, someone else advanced: nothing to do.
      if(typeof advFrom==='number'&&mpShownDbQIndex>advFrom)return;
      const _expectedQ=typeof advFrom==='number'?advFrom:mpDbQIndex;
      // Survival wipe ends the game outright — no next question needed, so don't gate it
      // on winning the advance RPC (a failed/empty RPC used to leave everyone frozen).
      if(selectedMode==='survival'&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated)){
        if(isHost||!lobbyPlayers.some(lp=>lp.isHost&&!lp.quit)){
          if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
          else mpEndGame();
        }
        return;
      }
      // Race for the advance. Reuse a prefetch if mpStartAutoNext already kicked
      // one off for us; otherwise call it live (network hiccup, or the prefetch
      // hadn't started yet). p_expected_q_index is mpDbQIndex specifically —
      // the DB's own index, not the locally-tracked qIndex — matching every
      // other mp_advance_question call site in this file.
      const _topicAN=selectedTopics.length>0?selectedTopics[Math.floor(Math.random()*selectedTopics.length)]:null;
      let data,error;
      if(prefetchedRpcResult){
        ({data,error}=prefetchedRpcResult);
        prefetchedRpcPromise=null;prefetchedRpcResult=null;
      } else if(prefetchedRpcPromise){
        ({data,error}=await prefetchedRpcPromise);
        prefetchedRpcPromise=null;prefetchedRpcResult=null;
      } else {
        ({data,error}=await sb.rpc('mp_advance_question',{
          p_lobby_id:currentLobbyId,
          p_expected_q_index:_expectedQ,
          p_format:selectedFormat,
          p_topic_type:_topicAN?_topicAN.type:null,
          p_topic_value:_topicAN?_topicAN.name:null,
          p_exclude_ids:quizHistory.map(h=>h.id).filter(id=>id!=null),
          p_time_limit:raceTimeLimit
        }));
      }
      if(error||!data||!data.advanced){
        // We lost the race (or the call failed outright) — some other client is
        // the one responsible for this round's broadcasts, not us. Deliberately
        // no fallback here: a local-pick fallback only belongs to the single
        // client actually advancing, and per this response that isn't us.
        return;
      }
      mpDbQIndex=data.q_index;
      // We won — we're now the one client responsible for this round's side
      // effects. Recorded after winning, not before, so a losing client never
      // mutates rolling-window / elimination bookkeeping for a round it wasn't
      // asked to resolve.
      lobbyPlayers.forEach(p=>{mpRollingWindowRecord(p.name,mpFlagsThisQuestion.has(p.name)?'flagged':'null');});
      // Now that the reveal + wrap-up pause has played, actually end the game if every
      // non-quit survival player is eliminated.
      if(selectedMode==='survival'&&lobbyPlayers.filter(lp=>!lp.quit).every(lp=>lp.eliminated)){
        if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
        else mpEndGame();return;
      }
      // Tiebreakers ride on the question we just advanced to: set mpTiebreakerPlayers and
      // fall through to the normal broadcast below. (mpStartTiebreaker only sends
      // next_question, and in this RPC path nobody would then fetch the question.)
      mpTiebreakerPlayers=[];
      if(selectedMode==='race'){
        const winner=mpCheckRaceWin();
        if(winner==='tiebreaker')mpTiebreakerPlayers=mpTopTiedPlayers();
        else if(winner!==null){
          if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
          else mpEndGame();return;
        }
      }
      qIndex++;
      const _survivalCap=lobbyMode==='survival'?survivalQuestionLimit:selectedQuestionLimit;
      if(lobbyMode!=='race'&&qIndex>=_survivalCap){
        if(rtChannel)rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
        else mpEndGame();return;
      }
      currentQData=data.current_question;
      if(rtChannel){
        const _nqPayload={qIndex,hpActiveIdx,mpTiebreakerPlayers};
        mpResetRoundState(_nqPayload);
        mpOwnNextQPending=true;
        rtChannel.send({type:'broadcast',event:'next_question',payload:_nqPayload});
        document.getElementById('mpQCardFeedback').style.display='none';
        const _rwOwn=document.getElementById('mpReportWrap');if(_rwOwn)_rwOwn.style.display='none';
        const _anOwn=document.getElementById('mpAutoNext');if(_anOwn)_anOwn.textContent='';
        const _cardOwn=document.querySelector('#page-mp-quiz .q-card');if(_cardOwn)_cardOwn.classList.remove('answered');
        // We already have the winning RPC's question in hand — broadcast it now
        // rather than letting the next_question handler's legacy
        // if(isHost)mpHostFetchAndBroadcast() tail run: that path is reserved for
        // Hot Potato/char-mc's client-side pick and would otherwise re-call
        // mp_advance_question a second time with an already-stale
        // p_expected_q_index (mpDbQIndex was just updated above), advancing the
        // round twice. mpOwnQuestionBroadcastPending lets the question handler
        // skip our own echo (mpShownDbQIndex, checked in that handler).
        mpShownDbQIndex=mpDbQIndex;
        rtChannel.send({type:'broadcast',event:'question',payload:{qData:currentQData,qIndex,hpFuse:null,mpDbQIndex}});
        document.getElementById('mpQLoading').style.display='none';
        mpShowQuestion(currentQData,null);renderMPHUD();
      } else {
        mpLoadQuestion();
      }
}
// Non-host fallback for question 1 (see the game_started countdown callback). Only acts
// while nothing is on screen yet; adopts the existing question if the host already set it.
async function mpEnsureFirstQuestion(){
  if(!lobbyInGame||mpShownDbQIndex>0||!document.getElementById('page-mp-quiz')?.classList.contains('active'))return;
  const topic=selectedTopics.length>0?selectedTopics[Math.floor(Math.random()*selectedTopics.length)]:null;
  const{data,error}=await sb.rpc('mp_advance_question',{
    p_lobby_id:currentLobbyId,p_expected_q_index:0,p_format:selectedFormat,
    p_topic_type:topic?topic.type:null,p_topic_value:topic?topic.name:null,
    p_exclude_ids:[],p_time_limit:raceTimeLimit
  });
  if(error||!data||mpShownDbQIndex>0)return; // failed, or the host's broadcast landed meanwhile
  if(!data.advanced&&data.reason!=='already_advanced')return;
  mpDbQIndex=data.q_index;mpShownDbQIndex=mpDbQIndex;currentQData=data.current_question;
  if(data.advanced&&rtChannel)rtChannel.send({type:'broadcast',event:'question',payload:{qData:currentQData,qIndex,hpFuse:null,mpDbQIndex}});
  document.getElementById('mpQLoading').style.display='none';
  mpShowQuestion(currentQData,null);renderMPHUD();
}
function mpPrefetchNextQuestion(excludeIds){
  const topic=selectedTopics.length>0?selectedTopics[Math.floor(Math.random()*selectedTopics.length)]:null;
  const p=sb.rpc('mp_advance_question',{
    p_lobby_id:currentLobbyId,
    p_expected_q_index:mpDbQIndex,
    p_format:selectedFormat,
    p_topic_type:topic?topic.type:null,
    p_topic_value:topic?topic.name:null,
    p_exclude_ids:excludeIds,
    p_time_limit:raceTimeLimit
  });
  prefetchedRpcPromise=p;
  prefetchedRpcResult=null;
  p.then(result=>{
    // Guard against a stale/superseded prefetch overwriting a newer one —
    // only apply this if it's still the one currently in flight.
    if(prefetchedRpcPromise===p)prefetchedRpcResult=result;
  });
}
function mpStartAutoNext(onDone,isLastQuestion){
  clearInterval(mpAutoNextInterval);
  mpCancelBackup(mpActiveAutoNextBackupId);
  mpAutoNextPaused=false;
  let t=5,fired=false;
  // The question this pause is resolving, captured NOW. Reading mpDbQIndex when the
  // countdown ends instead let a slower client, which had already heard another
  // client's advance, ask to advance from the NEW index and skip a question.
  const advFrom=mpShownDbQIndex;
  // Kick off the next question's fetch now, in parallel with the 5s countdown,
  // instead of waiting until it ends. Skipped when this is the last question (no
  // "next" to prefetch) and for Slow Reveal, which has its own separate
  // host-fetch path (srHostFetchAndBroadcast) that doesn't consult this.
  if(!isLastQuestion&&lobbyMode!=='slowreveal'){
    const useRpc=(lobbyMode==='race'||lobbyMode==='classic'||lobbyMode==='survival')&&selectedFormat!=='char-mc';
    // Race/Classic/Survival deliberately do NOT prefetch: mp_advance_question starts
    // the question's server clock (question_started_at) the moment it runs, so calling
    // it during this 5s pause cost every player 2-3s of speed points on every question.
    // mpRpcAdvanceAndBroadcast calls it live when the countdown ends instead.
    if(!useRpc&&isHost){
      // Hot Potato/char-mc still pick client-side and stay host-only, unchanged.
      fetchQuestion().then(q=>{prefetchedQuestion=q});
    }
  }
  // For Hot Potato/char-mc, onDone only actually does anything on the host's
  // client (it broadcasts the next step) — so a backgrounded host stalling here
  // freezes the game exactly like a stalled fuse would. For RPC-eligible modes,
  // onDone races every client for the advance instead, so no single client
  // stalling here can freeze the round. See mpFuseWorker declaration for why the
  // Worker backup is immune to that either way. fireOnce() guards against both
  // paths ever firing.
  const fireOnce=()=>{
    if(fired)return;fired=true;
    mpCancelBackup(mpActiveAutoNextBackupId);
    onDone(advFrom); // only mpRpcAdvanceAndBroadcast reads it; other callbacks ignore it
  };
  const el=document.getElementById('mpAutoNext');
  if(el)el.textContent=isLastQuestion?'Wrapping up…':`Next in ${t}s`;
  if(rtChannel&&isHost){
    rtChannel.send({type:'broadcast',event:'show_auto_next',payload:{seconds:t,isLastQuestion:!!isLastQuestion}});
  }
  mpActiveAutoNextBackupId=mpScheduleBackup(5150,fireOnce);
  if(isLastQuestion){
    // Short delay then fire — no countdown needed
    setTimeout(()=>fireOnce(),5000);
    return;
  }
  mpAutoNextInterval=setInterval(()=>{
    if(mpAutoNextPaused)return;
    t--;
    if(el)el.textContent=t>0?`Next in ${t}s`:'';
    if(t<=0){clearInterval(mpAutoNextInterval);fireOnce();}
  },1000);
}

async function flagMpQuestion(){
  const btn=document.getElementById('mpReportFlagBtn');
  if(!btn||btn.disabled)return;
  if(!mpFlagWindowOpen)return;
  if(mpFlagsThisQuestion.has(currentUser))return;
  btn.disabled=true;
  btn.innerHTML='<i class="ti ti-flag" style="font-size:13px"></i> Flagged 🚩';
  const isCapped=mpPlayerIsCapped(currentUser);
  await submitQuestionReport(currentQData?.id,
    isCapped?'flag_capped':'other',
    isCapped?'Flagged while over rolling cap — not counted toward void tally':null);
  if(currentQData?.id)reportedQuestionIds.add(currentQData.id);
  if(isCapped){mpRollingWindowRecord(currentUser,'flagged');return;}
  if(rtChannel){
    rtChannel.send({type:'broadcast',event:'question_flagged',payload:{name:currentUser,questionId:currentQData?.id}});
  }
}

let mpRecapOpen=true;
let lobbyNavModalContext='mp'; // 'solo' or 'mp' — determines what the nav modal's Leave button does
function toggleMpRecap(){
  mpRecapOpen=!mpRecapOpen;
  document.getElementById('mpRecapList').style.display=mpRecapOpen?'flex':'none';
  document.getElementById('mpRecapToggleBtn').innerHTML=mpRecapOpen?'HIDE <i class="ti ti-chevron-up" style="font-size:14px"></i>':'SHOW <i class="ti ti-chevron-down" style="font-size:14px"></i>';
  document.getElementById('page-mp-results')?.classList.toggle('recap-open',mpRecapOpen);
}

function mpRecapAvatarHTML(name,size){
  const p=lobbyPlayers.find(lp=>lp.name===name);
  const raw=getLobbyAvatarHTML(p&&p.avatar||null,p&&p.color||'var(--accent)',(name[0]||'?').toUpperCase(),size);
  // Merge the size override into the style attribute getLobbyAvatarHTML already emits,
  // rather than appending a second style="" attribute (browsers only honor the first).
  return raw.replace('style="',`style="width:${size}px;height:${size}px;`);
}

function toggleMpRecapDropdown(e){
  if(e)e.stopPropagation();
  const menu=document.getElementById('mpRecapDDMenu');
  if(!menu)return;
  menu.style.display=menu.style.display==='none'?'block':'none';
}

function selectMpRecapPlayer(name){
  mpRecapPlayer=name;
  const menu=document.getElementById('mpRecapDDMenu');
  if(menu)menu.style.display='none';
  renderMpRecap();
}
document.addEventListener('click',e=>{
  const dd=document.getElementById('mpRecapPlayerSelect');
  const menu=document.getElementById('mpRecapDDMenu');
  if(dd&&menu&&menu.style.display!=='none'&&!dd.contains(e.target))menu.style.display='none';
});

function renderMpRecap(){
  const list=document.getElementById('mpRecapList');
  if(!list)return;
  const selectWrap=document.getElementById('mpRecapPlayerSelect');
  const titleEl=document.getElementById('mpRecapTitle');
  list.innerHTML='';
  mpRecapOpen=false;list.style.display='none';
  document.getElementById('page-mp-results')?.classList.remove('recap-open');
  const toggleBtn=document.getElementById('mpRecapToggleBtn');
  if(toggleBtn)toggleBtn.innerHTML='SHOW <i class="ti ti-chevron-down" style="font-size:14px"></i>';

  const isHP=lobbyMode==='potato';
  let data=quizHistory,labelName='You';
  if(isHP){
    // Hot Potato: only the active player ever answers a given round, so the recap is
    // scoped to one player's turns at a time via the dropdown below — defaults to your
    // own turns, with the option to check out anyone else's.
    const turnPlayers=(hpTurnOrder.length?hpTurnOrder:lobbyPlayers.map(p=>p.name)).filter(name=>hpHistory.some(h=>h.player===name));
    if(!mpRecapPlayer||!turnPlayers.includes(mpRecapPlayer))mpRecapPlayer=turnPlayers.includes(currentUser)?currentUser:(turnPlayers[0]||null);
    if(selectWrap){
      selectWrap.style.display=turnPlayers.length>1?'block':'none';
      const ddAvatar=document.getElementById('mpRecapDDAvatar');
      const ddName=document.getElementById('mpRecapDDName');
      if(ddAvatar)ddAvatar.innerHTML=mpRecapPlayer?mpRecapAvatarHTML(mpRecapPlayer,24):'';
      if(ddName)ddName.textContent=mpRecapPlayer===currentUser?'You':(mpRecapPlayer||'');
      const menu=document.getElementById('mpRecapDDMenu');
      if(menu){
        menu.innerHTML=turnPlayers.map(name=>`<div class="recap-dd-item ${name===mpRecapPlayer?'active':''}" onclick="selectMpRecapPlayer('${name.replace(/'/g,"\\'")}')">${mpRecapAvatarHTML(name,24)}<span>${name===currentUser?'You':name}</span></div>`).join('');
      }
    }
    labelName=mpRecapPlayer===currentUser?'You':(mpRecapPlayer||'');
    if(titleEl)titleEl.textContent=mpRecapPlayer===currentUser?'My Questions':(mpRecapPlayer?`${mpRecapPlayer}'s Questions`:'Answer Recap');
    data=hpHistory.filter(h=>h.player===mpRecapPlayer);
  } else {
    if(selectWrap)selectWrap.style.display='none';
    if(titleEl)titleEl.textContent='Answer Recap';
  }

  if(data.length===0){
    list.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;font-weight:700">No questions to show.</div>';
    return;
  }

  data.forEach((a,i)=>{
    const item=document.createElement('div');
    item.className='recap-item '+(a.correct?'correct':'wrong');
    item.innerHTML=`<div class="recap-num">${i+1}</div><div style="flex:1;min-width:0"><div class="recap-q">${a.q}</div><div class="recap-ans">${a.correct?`<span class="correct-ans"><i class="ti ti-check" style="font-size:11px"></i> ${a.correctAns}</span>`:''}${!a.correct&&a.userAns&&a.userAns!=='(timed out)'?`<span class="wrong-ans" style="text-decoration:none"><i class="ti ti-x" style="font-size:11px"></i> ${labelName}: ${a.userAns}</span>`:''}${!a.correct&&(!a.userAns||a.userAns==='(timed out)')?`<span style="color:var(--muted);font-size:11px;font-weight:700"><i class="ti ti-clock" style="font-size:11px"></i> Timed out</span>`:''}</div>${a.id?buildRecapReportUI(i,a.id):''}</div>${a.topic?`<span style="font-size:10px;font-weight:800;color:var(--muted);background:var(--bg3);border:1px solid var(--border);border-radius:99px;padding:2px 8px;white-space:nowrap;flex-shrink:0">${a.topic}</span>`:''}<span>${a.correct?'<i class="ti ti-circle-check" style="color:#4ade80;font-size:18px"></i>':'<i class="ti ti-circle-x" style="color:#f87171;font-size:18px"></i>'}</span>`;
    list.appendChild(item);
  });
}

// ── LEADERBOARD ──────────────────────────────────────────────
let lbTab='global';
function switchLbTab(tab){
  lbTab=tab;
  document.getElementById('lbTabGlobal').classList.toggle('active',tab==='global');
  document.getElementById('lbTabFriends').classList.toggle('active',tab==='friends');
  document.getElementById('lbGlobal').style.display=tab==='global'?'block':'none';
  document.getElementById('lbFriends').style.display=tab==='friends'?'block':'none';
  if(tab==='friends')renderFriendsLb();
}
async function renderLb(){
  const list=document.getElementById('lbGlobalList');
  list.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)"><div class="spinner" style="margin:0 auto 10px"></div>Loading…</div>';
  let data=await sbLoadLeaderboard();
  // Ensure current user appears if not in top 20
  if(currentUser&&!isGuest&&data.length&&!data.find(r=>r.username===currentUser)){
    data.push({username:currentUser,best_score:bestScore,total_games:totalGames,theme_color:currentColor});
  }
  list.innerHTML='';

  // Your rank card
  const youCard=document.getElementById('lbYouCard');
  const guestCta=document.getElementById('lbGuestCta');
  if(currentUser&&!isGuest&&data.length){
    const myIdx=data.findIndex(r=>r.username===currentUser);
    if(myIdx>=0){
      youCard.style.display='flex';
      document.getElementById('lbYouRank').textContent=myIdx===0?'🥇':myIdx===1?'🥈':myIdx===2?'🥉':'#'+(myIdx+1);
      document.getElementById('lbYouAvatar').textContent=currentUser[0].toUpperCase();
      document.getElementById('lbYouAvatar').style.background=accentHex[currentColor]||accentHex.midnight;
      document.getElementById('lbYouName').textContent=currentUser;
      document.getElementById('lbYouScore').textContent=data[myIdx].best_score+' pts';
    }
    guestCta.style.display='none';
  } else if(!currentUser||isGuest){
    youCard.style.display='none';
    guestCta.style.display='block';
  }

  data.forEach((p,i)=>{
    const rankClass=i===0?'gold':i===1?'silver':i===2?'bronze':'';
    const isMe=currentUser&&p.username===currentUser;
    const color=accentHex[p.theme_color]||accentHex.midnight;
    const row=document.createElement('div');row.className='lb-row'+(rankClass?' '+rankClass:'');row.style.animationDelay=(i*40)+'ms';
    if(isMe)row.style.borderColor='var(--accent)';
    row.innerHTML=`<div class="lb-rank ${rankClass}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</div><div class="lb-avatar" style="background:${color};color:#fff">${p.username[0].toUpperCase()}</div><div class="lb-info"><div class="lb-name">${p.username}${isMe?' <span style="font-size:10px;color:var(--accent);font-weight:800">(you)</span>':''}</div><div class="lb-meta">${p.total_games} games</div></div><div class="lb-score">${p.best_score}</div>`;
    list.appendChild(row);
  });
  if(!data.length)list.innerHTML='<div class="lb-empty">'+_htmlEsc(getSiteText('lb_empty'))+'</div>';
  applyTheme();
}
async function renderFriendsLb(){
  const list=document.getElementById('lbFriendsList');
  const empty=document.getElementById('lbFriendsEmpty');
  list.innerHTML='';
  if(!currentUser||isGuest){
    empty.style.display='block';
    empty.innerHTML='<div style="font-size:36px;margin-bottom:12px">🔒</div><div style="font-family:\'Lilita One\',cursive;font-size:18px;color:var(--text);margin-bottom:6px">Sign in to see friends</div><div style="font-size:13px;color:var(--muted)">Play with others in lobbies to see them here.</div>';
    return;
  }
  empty.style.display='none';
  // Pull users you've shared lobbies with as proxy friends
  if(!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT')){
    list.innerHTML='<div class="lb-empty" style="font-size:13px">Play multiplayer games to see others here.</div>';
    return;
  }
  list.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted)"><div class="spinner" style="margin:0 auto 10px"></div>Loading…</div>';
  try{
    // Find lobbies this user participated in
    const {data:myLobbies}=await sb.from('lobby_players').select('lobby_id').eq('user_id',currentUserId).limit(20);
    if(!myLobbies?.length){
      list.innerHTML='<div class="lb-empty" style="font-size:13px">Play multiplayer games to see others here.</div>';
      return;
    }
    const lobbyIds=myLobbies.map(l=>l.lobby_id);
    // Get all players from those lobbies (excluding self)
    const {data:others}=await sb.from('lobby_players').select('username,user_id,color').in('lobby_id',lobbyIds).neq('user_id',currentUserId);
    if(!others?.length){
      list.innerHTML='<div class="lb-empty" style="font-size:13px">No other players found yet. Invite friends!</div>';
      return;
    }
    // Deduplicate by user_id
    const unique=Object.values(others.reduce((acc,p)=>{acc[p.user_id]=p;return acc},{}));
    const userIds=unique.map(p=>p.user_id);
    // Get their stats
    const {data:stats}=await sb.from('user_stats').select('*').in('id',userIds);
    // Add yourself
    const myStats={id:currentUserId,username:currentUser,best_score:bestScore,total_games:totalGames,theme_color:currentColor};
    const allStats=[myStats,...(stats||[])].sort((a,b)=>(b.best_score||0)-(a.best_score||0));
    list.innerHTML='';
    document.getElementById('lbFriendsLabel').style.display='block';
    allStats.forEach((p,i)=>{
      const isMe=p.id===currentUserId;
      const color=accentHex[p.theme_color]||accentHex.midnight;
      const row=document.createElement('div');row.className='lb-row';
      if(isMe)row.style.borderColor='var(--accent)';
      const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1);
      const rankClass=i===0?'gold':i===1?'silver':i===2?'bronze':'';
      row.innerHTML=`<div class="lb-rank ${rankClass}">${medal}</div><div class="lb-avatar" style="background:${color};color:#fff">${p.username[0].toUpperCase()}</div><div class="lb-info"><div class="lb-name">${p.username}${isMe?' <span style="font-size:10px;color:var(--accent);font-weight:800">(you)</span>':''}</div><div class="lb-meta">${p.total_games||0} games played</div></div><div class="lb-score">${p.best_score||0}</div>`;
      list.appendChild(row);
    });
  }catch(e){
    list.innerHTML='<div class="lb-empty" style="font-size:13px">Could not load. Try again later.</div>';
  }
}
const _origGoStep=goStep;
goStep=function(name){
  // If navigating away from an active game/lobby session, clean up channel state
  // so the CLOSED status doesn't trigger the disconnect modal on the next page
  const leavingGame=document.getElementById('page-mp-quiz').classList.contains('active');
  const leavingLobby=document.getElementById('page-lobby-room').classList.contains('active');
  if((leavingGame||leavingLobby)&&name!=='mp-quiz'&&name!=='lobby-room'){
    intentionalLeave=true;
  }
  _origGoStep(name);
  if(name==='leaderboard'){lbTab='global';switchLbTab('global');renderLb();}
  if(name==='lobby-room')renderLobbyRoom();
  if(name==='multiplayer'){
    loadPublicLobbies();
    checkForActiveGameRejoin();
    subscribeToLobbyList();
    const input=document.getElementById('lobbyNameInput');
    if(input)input.placeholder=currentUser?`${currentUser}'s Lobby`:"My Lobby";
    // Reset privacy pills to default (public)
    setPillPrivacy(false);
    // Reset the join-by-code input and button so they're never stale on return
    const codeInput=document.getElementById('lobbyCodeInput');
    if(codeInput)codeInput.value='';
    const joinBtn=document.querySelector('.lobby-code-btn');
    if(joinBtn){joinBtn.disabled=false;joinBtn.innerHTML='<i class="ti ti-door-enter" style="font-size:15px"></i> Join';joinBtn.style.opacity='';joinBtn.style.cursor='';}
  } else {
    unsubscribeFromLobbyList();
  }
};


// Navigation guard, logo, tab-close fallback, mobile drawer (moved out of index.html 2026-11-19; loads in its original place, order matters)

applyTheme();

// ── LOBBY / GAME NAV GUARD ──────────────────────────────────────
// Any navigation away from an active lobby or game should be a deliberate
// choice, not silent. requestLobbyNav(afterLeave) checks whether the player
// is currently in the lobby room, a multiplayer quiz, or a solo quiz. If so,
// it shows a confirmation modal ("Stay" vs "Leave") instead of navigating
// immediately. If not, afterLeave() runs right away. afterLeave is whatever
// the caller actually wanted to do (go home, open Profile, sign out, etc.) —
// it always runs after the lobby is cleanly left via leaveLobbyRoom(), never
// before, so a player row is never abandoned mid-navigation.
let lobbyNavAfterLeave=null;
function isInActiveGameOrLobby(){
  const inLobby=document.getElementById('page-lobby-room').classList.contains('active');
  const inMpQuiz=document.getElementById('page-mp-quiz').classList.contains('active');
  const inMpResults=document.getElementById('page-mp-results').classList.contains('active');
  const inSoloQuiz=document.getElementById('page-quiz').classList.contains('active');
  return {inLobby,inMpQuiz,inMpResults,inSoloQuiz,any:inLobby||inMpQuiz||inMpResults||inSoloQuiz};
}
function requestLobbyNav(afterLeave){
  const state=isInActiveGameOrLobby();
  if(!state.any){
    if(afterLeave)afterLeave();else goStep('landing');
    return;
  }
  const title=document.getElementById('lobbyNavModalTitle');
  const sub=document.getElementById('lobbyNavModalSub');
  const stayLabel=document.getElementById('lobbyNavModalStayLabel');
  const leaveLabel=document.getElementById('lobbyNavModalLeaveLabel');
  if(state.inSoloQuiz){
    lobbyNavModalContext='solo';
    if(title)title.textContent='Still in a game!';
    if(sub)sub.textContent='Do you want to stay in the game or quit?';
    if(stayLabel)stayLabel.textContent='Stay in Game';
    if(leaveLabel)leaveLabel.textContent='Quit Game';
  } else if(state.inMpQuiz){
    lobbyNavModalContext='mp';
    if(title)title.textContent='Still in a game!';
    if(sub)sub.textContent='Do you want to stay in the game or quit?';
    if(stayLabel)stayLabel.textContent='Stay in Game';
    if(leaveLabel)leaveLabel.textContent='Quit Game';
  } else if(state.inMpResults){
    lobbyNavModalContext='mp';
    if(title)title.textContent='Still in the lobby!';
    if(sub)sub.textContent='The lobby is still open for another round. Leave it, or stay and play again?';
    if(stayLabel)stayLabel.textContent='Stay in Lobby';
    if(leaveLabel)leaveLabel.textContent='Leave Lobby';
  } else {
    lobbyNavModalContext='mp';
    if(title)title.textContent='Still in a lobby!';
    if(sub)sub.textContent='Do you want to stay in the lobby or leave it?';
    if(stayLabel)stayLabel.textContent='Stay in Lobby';
    if(leaveLabel)leaveLabel.textContent='Leave Lobby';
  }
  lobbyNavAfterLeave=afterLeave||null;
  document.getElementById('lobbyNavModal').style.display='flex';
  applyTheme();
}

// ── LOGO NAVIGATION INTERCEPT ─────────────────────────────────
function logoNav(){
  const lm=document.getElementById('logoMark');
  lm.classList.remove('logo-bounce');void lm.offsetWidth;lm.classList.add('logo-bounce');
  requestLobbyNav(()=>goStep('landing'));
}
function confirmLobbyNavLeave(){
  closeLobbyNavModal();
  const after=lobbyNavAfterLeave;
  lobbyNavAfterLeave=null;
  if(lobbyNavModalContext==='solo'){
    if(after)after();else goStep('landing');
    return;
  }
  leaveLobbyRoom().then(()=>{ if(after)after(); });
}
function closeLobbyNavModal(){
  lobbyNavAfterLeave=null;
  document.getElementById('lobbyNavModal').style.display='none';
}

// ── REFRESH / TAB-CLOSE FALLBACK ──────────────────────────────────────────
// Supabase Presence is the primary mechanism for detecting disconnects, but
// it relies on the WebSocket closing cleanly — which isn't guaranteed on a
// hard refresh or bfcache restore in all browsers. This pagehide handler fires
// synchronously before the page unloads and uses navigator.sendBeacon (fire-
// and-forget, survives page teardown) to DELETE the player row directly via the
// Supabase REST API, so the record is cleaned up even if Presence misfires.
window.addEventListener('pagehide', () => {
  if(intentionalLeave) return;           // already handled by leaveLobbyRoom()
  if(SUPABASE_URL.includes('YOUR_PROJECT')) return;

  // Read from sessionStorage — JS variables may be null/stale if the page
  // is reloading (e.g. currentLobbyId is null before the new session sets it).
  const lobbyIdToClean  = currentLobbyId  || sessionStorage.getItem('current_lobby_id');
  const userIdToClean   = currentUserId   || sessionStorage.getItem('guest_user_id');

  if(!lobbyIdToClean || !userIdToClean) return;

  // Clear sessionStorage now so a bfcache restore doesn't re-fire cleanup.
  try{ sessionStorage.removeItem('current_lobby_id'); }catch(e){}

  // Step 1 — DELETE our lobby_players row so remaining clients can detect the departure.
  // Uses a synchronous XHR (async:false) because fetch/sendBeacon are not guaranteed
  // to complete before the page tears down.
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('DELETE', `${SUPABASE_URL}/rest/v1/lobby_players?lobby_id=eq.${lobbyIdToClean}&user_id=eq.${userIdToClean}`, false);
    xhr.setRequestHeader('apikey', SUPABASE_ANON);
    xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON}`);
    xhr.setRequestHeader('Prefer', 'return=minimal');
    xhr.send();
  } catch(e) {}

  // Step 2 — PATCH lobbies.updated_at on the same lobby row.
  // Supabase Realtime sometimes silently drops the lobby_players DELETE change event
  // (observed as binary WS frames that don't decode to postgres_changes). Bumping
  // updated_at on the lobbies row guarantees that remaining clients' postgres_changes
  // UPDATE listener fires and triggers rtRefreshPlayers(), covering the gap.
  // Presence leave is the primary path; this is a belt-and-suspenders fallback.
  try {
    const xhr2 = new XMLHttpRequest();
    xhr2.open('PATCH', `${SUPABASE_URL}/rest/v1/lobbies?id=eq.${lobbyIdToClean}`, false);
    xhr2.setRequestHeader('apikey', SUPABASE_ANON);
    xhr2.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON}`);
    xhr2.setRequestHeader('Content-Type', 'application/json');
    xhr2.setRequestHeader('Prefer', 'return=minimal');
    xhr2.send(JSON.stringify({ updated_at: new Date().toISOString() }));
  } catch(e) {}
});

// ── MOBILE NAV DRAWER ─────────────────────────────────────────
function openNavDrawer(){
  document.getElementById('navDrawer').classList.add('open');
  document.getElementById('navOverlay').classList.add('open');
  document.body.style.overflow='hidden';
  syncDrawerState();
}
function closeNavDrawer(){
  document.getElementById('navDrawer').classList.remove('open');
  document.getElementById('navOverlay').classList.remove('open');
  document.body.style.overflow='';
}
function syncDrawerState(){
  // Sync light/dark toggle
  const isDark=document.documentElement.getAttribute('data-theme')==='dark'||!document.documentElement.getAttribute('data-theme');
  const tog=document.getElementById('modeToggleDrawer');
  if(tog)tog.classList.toggle('on',!isDark);
  // Sync user state
  const drawerUser=document.getElementById('navDrawerUser');
  const drawerUsername=document.getElementById('navDrawerUsername');
  const drawerSignin=document.getElementById('navDrawerSignin');
  const drawerSignout=document.getElementById('navDrawerSignout');
  if(currentUser&&!isGuest){
    drawerUser.style.display='block';
    drawerUsername.textContent=currentUser;
    drawerSignin.style.display='none';
    drawerSignout.style.display='flex';
  } else {
    drawerUser.style.display='none';
    drawerSignin.style.display='flex';
    drawerSignout.style.display='none';
  }
}

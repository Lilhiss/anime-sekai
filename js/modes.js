// Question voiding, race win, Slow Reveal (moved out of index.html 2026-11-19; loads in its original place, order matters)
// ── QUESTION VOIDING ─────────────────────────────────────────
function mpGetVoidThreshold(){
  const active=lobbyPlayers.filter(lp=>!lp.quit).length;
  if(active<=4)return 2;
  if(active<=8)return 3;
  return 4;
}
function mpSnapshotScores(){
  mpPreVoidSnapshot={};
  lobbyPlayers.forEach(p=>{mpPreVoidSnapshot[p.name]={score:p.score,lives:p.lives,eliminated:p.eliminated};});
}
function mpGetPlayerWindow(name){
  if(!mpPlayerFlagWindows[name])mpPlayerFlagWindows[name]=['null','null','null'];
  return mpPlayerFlagWindows[name];
}
function mpPlayerIsCapped(name){
  const w=mpGetPlayerWindow(name);
  return w.filter(s=>s==='flagged').length>=1;
}
function mpRollingWindowRecord(name,outcome){
  // outcome: 'flagged' | 'null'
  const w=mpGetPlayerWindow(name);
  w.shift();w.push(outcome);
  mpPlayerFlagWindows[name]=w;
}
function mpUpdateFlagCountUI(){
  const el=document.getElementById('mpFlagCount');
  if(!el)return;
  const threshold=mpGetVoidThreshold();
  const count=mpFlagsThisQuestion.size;
  if(count>0){el.textContent=`${count}/${threshold} flagged`;el.style.display='inline';}
  else{el.style.display='none';}
}
function mpVoidQuestion(){
  // Revert all players to pre-question scores
  lobbyPlayers.forEach(p=>{
    const snap=mpPreVoidSnapshot[p.name];
    if(snap){p.score=snap.score;p.lives=snap.lives;p.eliminated=snap.eliminated;}
  });
  // Revert local player's own score/lives
  const mySnap=mpPreVoidSnapshot[currentUser];
  if(mySnap){score=mySnap.score;lives=mySnap.lives;}
  renderMPHUD();renderMPScoreboard();
  // Mark contributing flaggers' window slots as null (exempted)
  mpFlagsThisQuestion.forEach(name=>mpRollingWindowRecord(name,'null'));
  // Record non-flaggers and capped flaggers as null for this question too (question didn't count)
  lobbyPlayers.forEach(p=>{if(!mpFlagsThisQuestion.has(p.name))mpRollingWindowRecord(p.name,'null');});
  // Show void banner in place of auto-next text
  const el=document.getElementById('mpAutoNext');
  if(el)el.innerHTML='<span style="color:#f87171">⚠️ Question voided. Flagged by multiple players, no points awarded.</span>';
  // Log to question_reports
  submitQuestionReport(currentQData?.id,'auto_voided_multi_flag',`Voided in lobby — ${mpFlagsThisQuestion.size} flags`);
}

// ── SCORE RACE WIN DETECTION ─────────────────────────────────
// Returns null if nobody has crossed the target yet (game continues).
// Returns 'tiebreaker' if 2+ players are tied at the top and all crossed.
// Returns a player object if there's a clear single winner.
// Called only by the host after each question resolves.
function mpCheckRaceWin(){
  const crossed=lobbyPlayers.filter(lp=>!lp.quit&&lp.score>=mpRaceTarget);
  if(crossed.length===0)return null; // nobody hit the target yet
  const topScore=Math.max(...crossed.map(lp=>lp.score));
  const leaders=crossed.filter(lp=>lp.score===topScore);
  if(leaders.length===1)return leaders[0]; // clear winner
  // Multiple players tied at the top — start a tiebreaker
  return 'tiebreaker';
}
// Names of the players (still in the game) tied for the top score; one name = clear leader.
function mpTopTiedPlayers(){
  const live=lobbyPlayers.filter(lp=>!lp.quit&&lp.connected!==false);
  if(!live.length)return [];
  const top=Math.max(...live.map(lp=>lp.score||0));
  return live.filter(lp=>(lp.score||0)===top).map(lp=>lp.name);
}
function mpStartTiebreaker(){
  // Only the players tied at the top score play the tiebreaker
  const topScore=Math.max(...lobbyPlayers.filter(lp=>!lp.quit).map(lp=>lp.score));
  mpTiebreakerPlayers=lobbyPlayers.filter(lp=>!lp.quit&&lp.score===topScore).map(lp=>lp.name);
  qIndex++;
  if(rtChannel){rtChannel.send({type:'broadcast',event:'next_question',payload:{qIndex,hpActiveIdx,mpTiebreakerPlayers}});}
  else{mpLoadQuestion();}
}

function mpReturnToLobby(){
  if(rtChannel)try{rtChannel.send({type:'broadcast',event:'res_back',payload:{name:currentUser}})}catch(e){}
  // Reset player state for a fresh game
  lobbyPlayers.forEach(p=>{p.score=0;p.lives=lobbyMode==='potato'?hpLives:lobbyMode==='survival'?selectedLives:3;p.eliminated=false;p.quit=false;});
  score=0;lives=lobbyMode==='potato'?hpLives:lobbyMode==='survival'?selectedLives:3;
  qIndex=0;mpDbQIndex=0;mpShownDbQIndex=0;prefetchedRpcPromise=null;prefetchedRpcResult=null;answered=false;quizHistory=[];hpHistory=[];mpCancelBackup(mpActiveFuseBackupId);mpCancelBackup(mpActiveAutoNextBackupId);prefetchedQuestion=null;currentQData=null;
  // Host broadcasts so all clients navigate back together
  if(isHost&&rtChannel){
    rtChannel.send({type:'broadcast',event:'return_to_lobby',payload:{}});
  }
  stopHeartbeat();startHeartbeat();
  goStep('lobby-room');
}

async function mpEndGame(){
  srClearReveal();
  document.body.classList.remove('hp-my-turn');
  clearInterval(timerInterval);clearInterval(mpAutoNextInterval);
  mpCancelBackup(mpActiveFuseBackupId);mpCancelBackup(mpActiveAutoNextBackupId);
  // Game's over — give the lobby a fresh 10 minutes so the results page isn't rushed
  lobbyInGame=false;
  lobbyExpiresAt=new Date(Date.now()+LOBBY_TTL*1000).toISOString();
  if(isHost&&!SUPABASE_URL.includes('YOUR_PROJECT')&&lobbyCode){
    // Real session token, not the raw anon key — see rtSetLobbyStatus for why: with an
    // auth.uid() = host_id RLS policy, the anon key silently resolves to zero rows
    // updated instead of erroring, leaving the lobby stuck at its mid-game status.
    const token=await rtGetAuthToken();
    fetch(`${SUPABASE_URL}/rest/v1/lobbies?code=eq.${encodeURIComponent(lobbyCode)}`,{
      method:'PATCH',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({expires_at:lobbyExpiresAt,status:'waiting'})
    }).catch(()=>{});
  }
  clearLobbyTimer();
  // Do NOT unsubscribe rtChannel here — keeping it alive lets the host broadcast
  // game_started again and all clients receive it when playing again from results.
  // The channel is only torn down when someone explicitly leaves the lobby.
  intentionalLeave=false;
  const isHP=lobbyMode==='potato';
  const isSurvival=selectedMode==='survival';
  const isSR=lobbyMode==='slowreveal';
  const me=lobbyPlayers.find(p=>p.name===currentUser);if(me&&!isHP)me.score=score;
  // Players who quit or dropped mid-game are tagged LEFT and ranked below everyone who
  // stayed, so a leaver can never be crowned the winner.
  const hasLeft=p=>!!p.quit||p.connected===false;
  const leftLast=(a,b)=>(hasLeft(a)===hasLeft(b)?0:hasLeft(a)?1:-1);
  const sorted=isHP
    ?[...lobbyPlayers].sort((a,b)=>leftLast(a,b)||(b.eliminated===a.eliminated?0:a.eliminated?1:-1)||b.lives-a.lives)
    :[...lobbyPlayers].sort((a,b)=>leftLast(a,b)||b.score-a.score);
  const winner=sorted[0];
  // Modes with a set number of questions (Classic, Survival) can end level: a shared top
  // score is a tie, not a win for whoever happens to sort first. Race/Slow Reveal end at a
  // target (Race has its own tiebreaker) and Hot Potato on lives, so they never tie here.
  const stayed=sorted.filter(p=>!hasLeft(p));
  const tied=(!isHP&&!isSR&&lobbyMode!=='race'&&stayed.length>1&&stayed[1].score===stayed[0].score)
    ?stayed.filter(p=>p.score===stayed[0].score):[];
  const isTie=tied.length>1, iTied=isTie&&tied.some(p=>p.name===currentUser);
  const iWon=!isTie&&winner.name===currentUser;
  const winnerAvatarHTML=getLobbyAvatarHTML(winner.avatar||null,winner.color,winner.name[0].toUpperCase(),80);
  const winnerAvatarStyled=winnerAvatarHTML.replace('class="lobby-player-avatar"','class="mp-winner-avatar"');
  document.getElementById('mpWinnerBadge').innerHTML=winnerAvatarStyled;
  {const rb=document.querySelector('#page-mp-results .mr-badge');if(rb)rb.textContent=isTie?'TIED':'WINNER';}
  document.getElementById('mpWinnerTitle').innerHTML=isTie?'It\'s a <span>Tie!</span>':iWon?'You <span>Win!</span>':`<span>${winner.name}</span> Wins!`;
  const isClassic=selectedMode==='classic';
  {const wp=document.getElementById('mpWinnerPts'),wd=document.getElementById('mpWinnerDot');const showPts=!isHP;if(wp)wp.textContent=showPts?(winner.score||0).toLocaleString()+(isClassic?' correct':' pts'):'';if(wd)wd.style.display=showPts?'':'none';}
  const others=n=>n===1?'1 other player':n+' other players';
  document.getElementById('mpWinnerSub').textContent=isTie
    ?(iTied?'You tied for first with '+others(tied.length-1)+'. Nice work!':tied.map(p=>p.name).join(' & ')+' share first place.')
    :iWon
    ?(isHP?'Last one standing. You survived the potato!':isSurvival?'Last one standing. Undefeated!':isSR?'First to '+srTargetScore+'. You buzzed in like a pro!':isClassic?'Most points at the end. Nice work!':'First to '+mpRaceTarget+' pts. Legendary run!')
    :'Better luck next time. Challenge them again!';
  const standings=document.getElementById('mpFinalStandings');standings.innerHTML='';
  let prevPos=0;
  sorted.forEach((p,i)=>{
    // Equal scores share a position (1, 1, 3) in tie-able modes; leavers always rank after
    const prev=sorted[i-1];
    const pos=(i>0&&!isHP&&!isSR&&lobbyMode!=='race'&&!hasLeft(p)&&!hasLeft(prev)&&prev.score===p.score)?prevPos:i+1;
    prevPos=pos;
    const isMe=p.name===currentUser;
    const row=document.createElement('div');row.className='standing-row'+(isMe?' me':'');row.dataset.name=p.name;
    const rightCol=isHP
      ?`<div style="display:flex;gap:3px;align-items:center">${p.eliminated?'💀':'❤️'.repeat(p.lives)}</div>`
      :isSurvival
      ?`<div style="display:flex;align-items:center;gap:6px"><div class="lb-score">${p.score} pts</div><div style="font-size:13px">${p.eliminated?'💀':'❤️'.repeat(p.lives)}</div></div>`
      :`<div class="lb-score">${p.score} ${isClassic?'correct':'pts'}</div>`;
    const meta=isSurvival?(p.eliminated?'Eliminated':'Survived'):isHP?(p.eliminated?'Eliminated':'Survived'):isSR?(p.score+' pt'+(p.score===1?'':'s')):'';
    const recapAvatarEl=getLobbyAvatarHTML(p.avatar||null,p.color,p.name[0].toUpperCase(),36);
    const recapAvatarStyled=recapAvatarEl.replace('class="lobby-player-avatar" style="','class="lb-avatar" style="width:36px;height:36px;'+(p.eliminated?'opacity:.5;':''));
    const leftTag=hasLeft(p)&&!isMe?' <span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:99px;font-size:10px;font-weight:900;letter-spacing:.08em;vertical-align:middle;background:color-mix(in srgb,var(--text) 12%,transparent);color:var(--muted)">LEFT</span>':'';
    row.innerHTML=`<div class="standing-pos">${pos}</div>${recapAvatarStyled}<div style="flex:1"><div class="lb-name">${p.name}${isMe?' (you)':''}${leftTag}</div><div class="lb-meta">${meta}</div></div>${rightCol}`;
    standings.appendChild(row);
  });
  if(iWon||iTied)launchConfetti();
  mpRecapPlayer=isHP?currentUser:null; // default HP recap to "my turns" each time results load
  renderMpRecap();
  _origGoStep('mp-results');applyTheme();
}

// ── SLOW REVEAL MODE ──────────────────────────────────────────
let srRevealInterval=null;
let srCharIndex=0;
let srChars=[];
let srStartTime=0;
let srBuzzedPlayer=null;
let srLockedPlayers=[];
let srBuzzCountdown=null;
let srBuzzTimeLeft=0;
let srPostRevealTimer=null;
// True from the moment a round's question is shown until it's won, timed out, or
// every player is locked out. Used to reject buzz-ins that arrive after a round
// has already ended (e.g. a client that hasn't yet processed the round-end
// broadcast) instead of letting them race against the next round's state.
let srRoundActive=false;
const SR_CHAR_INTERVAL=60;
// Max characters a single reveal tick is allowed to newly show. Caps the
// "catch up" jump after any delayed tick (see the two reveal loops below)
// so a late tick can never dump the whole remaining question at once.
const SR_MAX_REVEAL_PER_TICK=3;

async function srHostFetchAndBroadcast(){
  // Snapshot scores at the start of each SR round so a void rolls back to here,
  // not to a stale snapshot from a previous round. Reset flag state too.
  mpSnapshotScores();
  mpFlagsThisQuestion=new Set();
  mpFlagWindowOpen=false;
  clearTimeout(mpFlagWindowTimer);
  document.getElementById('mpQLoading').style.display='flex';
  document.getElementById('mpQuestionText').style.display='none';
  const qData=await fetchQuestion();
  currentQData=qData;
  const startTime=Date.now()+500;
  rtChannel.send({type:'broadcast',event:'sr_question',payload:{qData,qIndex,startTime}});
  srStartReveal(qData,startTime);
}

function srStartReveal(qData,startTime){
  srClearReveal();
  srBuzzedPlayer=null;
  srLockedPlayers=[];
  srBuzzTimeLeft=0;
  srRoundActive=true;
  // Build flat chars array from only the characters that will have spans —
  // spaces between words are rendered as text nodes (the ' ' in the join below),
  // never as spans, so they must NOT appear in srChars.  If srChars included
  // spaces the interval would call getElementById('src'+N) for a space, get null,
  // and the while-loop would silently burn through every remaining index in a
  // single tick, making the entire question appear at once.
  srChars=[];
  srCharIndex=0;
  answered=false;
  currentQData=qData;
  const textEl=document.getElementById('mpQuestionText');
  textEl.style.display='block';
  document.getElementById('mpQLoading').style.display='none';
  document.getElementById('mpQCardFeedback').style.display='none';
  const mpRw=document.getElementById('mpReportWrap');if(mpRw)mpRw.style.display='none';
  const qCard=document.querySelector('#page-mp-quiz .q-card');
  if(qCard)qCard.classList.remove('answered');
  // Wrap each word in an inline-block span so the browser wraps at word boundaries,
  // then split chars within each word into individual spans for the fade-in reveal.
  // charIdx counts only span-backed characters so it stays in sync with srChars.
  let charIdx=0;
  const words=qData.question.split(' ');
  textEl.innerHTML=spoilerTagHTML(qData)+words.map(word=>{
    const chars=word.split('').map(ch=>{
      srChars.push(ch); // only non-space chars go into the array
      const span=`<span class="sr-char" id="src${charIdx}">${ch}</span>`;
      charIdx++;
      return span;
    }).join('');
    return `<span class="sr-word-wrap">${chars}</span>`;
  }).join(' ');
  textEl.innerHTML+=fallbackHintHTML(qData);
  // Reset timer bar to full at question start; it will drain during the post-reveal window
  const mpBarSR=document.getElementById('mpTimerBar');
  mpRailTick(100,null);
  srRenderBuzzArea();
  srRevealInterval=setInterval(()=>{
    if(srBuzzedPlayer)return;
    const elapsed=Date.now()-startTime;
    const targetIdx=Math.floor(elapsed/SR_CHAR_INTERVAL);
    // Cap how many characters can become visible in a single tick. Without this,
    // if this tick is ever delayed for any reason (the window losing scheduling
    // priority while unfocused, a slow reflow, etc.), `elapsed` jumps way ahead
    // and the loop below would reveal the *entire remaining question* in one
    // frame instead of animating it. Capping means a late tick just trickles
    // through the backlog over the next few ticks — invisible to the user —
    // instead of ever dumping the whole thing at once.
    //
    // EXCEPT when wall-clock time says the reveal should already be fully
    // finished (targetIdx has reached the end). That happens when a tab is
    // backgrounded: browsers throttle setInterval for inactive tabs down to
    // roughly one tick a second (or less), so this callback might not fire
    // again until well past the reveal's total duration. Trickling 3 chars
    // per tick in that case would take many extra real seconds — or longer —
    // before srCharIndex ever reaches the end, and since only the host's own
    // completion triggers srStartPostRevealTimer() (which every other client
    // waits on), a backgrounded host tab would stall the timer for everyone,
    // not just themselves. So once we're genuinely past the finish line,
    // reveal every remaining character immediately instead of capping.
    if(targetIdx>=srChars.length){
      while(srCharIndex<srChars.length){
        const el=document.getElementById('src'+srCharIndex);
        if(el)el.classList.add('visible');
        srCharIndex++;
      }
    } else {
      let revealedThisTick=0;
      while(srCharIndex<=targetIdx&&srCharIndex<srChars.length&&revealedThisTick<SR_MAX_REVEAL_PER_TICK){
        const el=document.getElementById('src'+srCharIndex);
        if(el)el.classList.add('visible');
        srCharIndex++;
        revealedThisTick++;
      }
    }
    if(srCharIndex>=srChars.length){
      clearInterval(srRevealInterval);srRevealInterval=null;
      if(isHost)srStartPostRevealTimer();
    }
  },30);
}

const SR_POST_REVEAL_TIME=10; // seconds players have to answer after full reveal
function srStartPostRevealTimer(){
  if(!isHost)return;
  // Broadcast so all clients show the timer bar
  if(rtChannel)rtChannel.send({type:'broadcast',event:'sr_post_reveal',payload:{seconds:SR_POST_REVEAL_TIME}});
  srRunPostRevealTimer(SR_POST_REVEAL_TIME);
}
function srRunPostRevealTimer(seconds){
  clearInterval(srPostRevealTimer);
  const mpBar=document.getElementById('mpTimerBar');
  mpRailTick(100,null);
  const total=seconds*1000;
  // Wall-clock based instead of tick-counted (elapsed+=100 per fire) — a
  // backgrounded tab gets its setInterval throttled by the browser, so a
  // tick-counted timer silently freezes instead of catching up. Using
  // Date.now() means whenever this next fires, it correctly reflects how
  // much real time has actually passed.
  let startTs=Date.now();
  let pausedSince=null;
  srPostRevealTimer=setInterval(()=>{
    if(srBuzzedPlayer){
      // Pause visually while someone is answering — remember when the pause
      // began so we can shift startTs forward once it ends, rather than
      // losing track of how much of the pause was "free" time.
      if(pausedSince===null)pausedSince=Date.now();
      return;
    }
    if(pausedSince!==null){
      startTs+=(Date.now()-pausedSince);
      pausedSince=null;
    }
    const elapsed=Date.now()-startTs;
    const pct=Math.max(0,100-(elapsed/total)*100);
    if(mpBar){mpRailTick(pct,timeLeft);}
    if(elapsed>=total){
      clearInterval(srPostRevealTimer);srPostRevealTimer=null;
      if(isHost)srBroadcastRoundEnd(null);
    }
  },100);
}

function srRenderBuzzArea(){
  const grid=document.getElementById('mpAnswersGrid');
  grid.innerHTML='';
  grid.style.cssText='display:flex;flex-direction:column;align-items:center;gap:12px';
  const isLocked=srLockedPlayers.includes(currentUser);
  const isBuzzing=srBuzzedPlayer===currentUser;
  const someoneElseBuzzing=srBuzzedPlayer&&srBuzzedPlayer!==currentUser;
  if(isBuzzing){
    const wrap=document.createElement('div');
    wrap.innerHTML=`
      <div class="sr-buzzing-banner"><i class="ti ti-bolt" style="font-size:13px"></i> You buzzed in! Type fast!</div>
      <div class="sr-countdown" id="srCountdownDisplay">${srBuzzTimeLeft}</div>
      <div class="type-wrap" style="margin-top:12px">
        <div class="type-input-row">
          <input id="mpTypeInput" class="type-input" type="text" placeholder="Type your answer…" autocomplete="off">
          <button class="type-submit" id="mpTypeSubmitBtn" onclick="srSubmitAnswer()"><i class="ti ti-check" style="font-size:15px"></i> Submit</button>
        </div>
      </div>`;
    grid.appendChild(wrap);applyTheme();
    document.getElementById('mpTypeInput').addEventListener('keydown',e=>{if(e.key==='Enter')srSubmitAnswer();});
    document.getElementById('mpTypeInput').focus();
  } else if(someoneElseBuzzing){
    const wrap=document.createElement('div');
    wrap.innerHTML=`<div class="sr-buzzing-banner">⏳ <strong>${srBuzzedPlayer}</strong> is answering…</div>`;
    grid.appendChild(wrap);
  } else {
    const btnWrap=document.createElement('div');
    btnWrap.style.cssText='display:flex;justify-content:center;width:100%;margin-top:18px';
    const btn=document.createElement('button');
    btn.className='sr-buzz-btn';
    btn.id='srBuzzBtn';
    btn.style.margin='0';
    btn.disabled=isLocked;
    btn.innerHTML=isLocked
      ?'<span class="sr-locked-badge"><i class="ti ti-lock" style="font-size:11px"></i> Locked out</span>'
      :'<i class="ti ti-bolt" style="font-size:18px"></i> Buzz In';
    btn.onclick=()=>srBuzzIn();
    btnWrap.appendChild(btn);
    grid.appendChild(btnWrap);
  }
}

function srBuzzIn(){
  if(!srRoundActive||srBuzzedPlayer||srLockedPlayers.includes(currentUser))return;
  if(rtChannel){rtChannel.send({type:'broadcast',event:'sr_buzz',payload:{name:currentUser,charIndex:srCharIndex}});}
  if(isHost)srHandleBuzz(currentUser,srCharIndex);
}

function srHandleBuzz(name,wordIndex){
  if(!isHost)return;
  if(!srRoundActive)return; // round already ended (timed out / won / all locked) — reject late buzzes
  if(srBuzzedPlayer)return;
  if(srLockedPlayers.includes(name))return;
  rtChannel.send({type:'broadcast',event:'sr_buzz_granted',payload:{name,charIndex:wordIndex}});
  srApplyBuzzGranted(name,wordIndex);
}

function srApplyBuzzGranted(name,wordIndex){
  srBuzzedPlayer=name;
  srBuzzRatio=srChars.length>0?Math.min(1,wordIndex/srChars.length):0;
  clearInterval(srRevealInterval);srRevealInterval=null;
  for(let i=0;i<Math.min(wordIndex,srChars.length);i++){
    const el=document.getElementById('src'+i);
    if(el)el.classList.add('visible');
  }
  srCharIndex=Math.min(wordIndex,srChars.length);
  srRenderBuzzArea();
  srBuzzTimeLeft=5;
  const countEl=()=>document.getElementById('srCountdownDisplay');
  if(countEl())countEl().textContent=srBuzzTimeLeft;
  // Wall-clock based (see srRunPostRevealTimer) so a backgrounded tab catches
  // up to the correct remaining time instead of freezing at whatever count
  // it was on when the tab lost focus.
  const buzzStart=Date.now();
  const buzzTotal=5000;
  srBuzzCountdown=setInterval(()=>{
    const remaining=Math.max(0,Math.ceil((buzzTotal-(Date.now()-buzzStart))/1000));
    if(remaining!==srBuzzTimeLeft){
      srBuzzTimeLeft=remaining;
      if(countEl())countEl().textContent=srBuzzTimeLeft;
    }
    if(Date.now()-buzzStart>=buzzTotal){
      clearInterval(srBuzzCountdown);srBuzzCountdown=null;
      // Broadcast only — the sr_buzz_result listener applies it for every
      // client (including this host, via self:true), so there's one apply
      // path regardless of who buzzed in.
      if(isHost){
        rtChannel.send({type:'broadcast',event:'sr_buzz_result',payload:{name:srBuzzedPlayer,correct:false,timedOut:true,answer:'(timed out)',buzzRatio:srBuzzRatio}});
      }
    }
  },200);
}

let srBuzzRatio=0; // fraction of chars revealed when player buzzed in (0-1)
const removedAvatarUserIds=new Set(); // tracks players who explicitly removed their avatar
function srSubmitAnswer(){
  if(srBuzzedPlayer!==currentUser)return;
  clearInterval(srBuzzCountdown);srBuzzCountdown=null;
  const input=document.getElementById('mpTypeInput');
  const userAns=input?input.value.trim():'';
  if(!userAns)return;
  const correct=checkAnswer(userAns,currentQData);
  // Send only — the sr_buzz_result listener applies it for every client,
  // including this one (self:true), so there's a single apply path whether
  // the answerer is the host or a regular player.
  if(rtChannel){rtChannel.send({type:'broadcast',event:'sr_buzz_result',payload:{name:currentUser,correct,timedOut:false,answer:userAns,buzzRatio:srBuzzRatio}});}
}

function srApplyBuzzResult(name,correct,timedOut,userAns,buzzRatio){
  buzzRatio=buzzRatio||srBuzzRatio||0;
  clearInterval(srBuzzCountdown);srBuzzCountdown=null;
  const correctAns=currentQData.options?currentQData.options[currentQData.answer]:currentQData.answer;
  if(correct){
    srRoundActive=false;
    // Every client works out what the winner matched, so all reveals show the same answer
    const srMatch=userAns?answerMatch(userAns,currentQData):null;
    if(srMatch)currentQData._match=srMatch;
    const p=lobbyPlayers.find(lp=>lp.name===name);
    if(p)p.score++;
    if(name===currentUser)score++;
    renderMPHUD();
    renderMPScoreboard(); // update scoreboard immediately so everyone sees the new score
    // Clear the buzz area immediately so no other player can buzz in after the round is won
    const grid=document.getElementById('mpAnswersGrid');
    if(grid){grid.innerHTML='';grid.style.cssText='';}
    srShowFeedback(true,name,correctAns,userAns,false,buzzRatio);
    const winner=lobbyPlayers.find(lp=>lp.score>=srTargetScore);
    if(winner){
      // Same 5s "Wrapping up…" pause every other mode plays before ending the
      // game, so the winning answer stays on screen instead of instantly
      // cutting to the results page. srApplyBuzzResult runs on every client
      // (via the sr_buzz_result broadcast), so each client shows its own
      // local countdown the same way SR's normal round-advance below already
      // does — only the host actually broadcasts game_ended once it fires.
      mpStartAutoNext(()=>{
        if(!isHost)return;
        rtChannel.send({type:'broadcast',event:'game_ended',payload:{players:lobbyPlayers}});
        mpEndGame();
      },true);
      return;
    }
    mpStartAutoNext(()=>{
      if(!isHost)return;
      qIndex++;
      renderMPHUD();
      rtChannel.send({type:'broadcast',event:'sr_next_round',payload:{qIndex}});
      srHostFetchAndBroadcast();
    });
  } else {
    srBuzzedPlayer=null;
    if(!srLockedPlayers.includes(name))srLockedPlayers.push(name);
    srShowFeedback(false,name,correctAns,userAns,timedOut);
    // If every active player is now locked out, end the round immediately
    const activePlayers=lobbyPlayers.filter(lp=>!lp.quit&&!lp.eliminated);
    if(isHost&&activePlayers.length>0&&activePlayers.every(lp=>srLockedPlayers.includes(lp.name))){
      clearInterval(srPostRevealTimer);srPostRevealTimer=null;
      clearInterval(srRevealInterval);srRevealInterval=null;
      srBroadcastRoundEnd(correctAns);
      return;
    }
    // If the reveal was already complete before this buzz (the player buzzed
    // in during the post-reveal answer window), srApplyBuzzGranted only
    // paused the post-reveal timer — it never cleared its interval. That
    // paused timer will resume on its own from wherever it left off as soon
    // as srBuzzedPlayer is null (see srRunPostRevealTimer's pausedSince
    // logic above), so we must NOT call srStartPostRevealTimer() here: doing
    // so restarts the countdown from a fresh 10s and re-broadcasts it,
    // resetting the remaining time for every other player. Only re-run the
    // char-reveal loop (and start the post-reveal timer for the first time)
    // when the reveal genuinely hadn't finished yet at the moment of buzzing.
    if(srCharIndex<srChars.length){
      const startTime=Date.now()-(srCharIndex*SR_CHAR_INTERVAL);
      srRevealInterval=setInterval(()=>{
        const elapsed=Date.now()-startTime;
        const targetIdx=Math.floor(elapsed/SR_CHAR_INTERVAL);
        // Same per-tick cap as the main reveal loop in srStartReveal, with the
        // same backgrounded-tab exception — see the comment there for why a
        // tick that's already past the finish line must complete immediately
        // rather than trickle, since only the host's completion starts the
        // post-reveal timer for everyone.
        if(targetIdx>=srChars.length){
          while(srCharIndex<srChars.length){
            const el=document.getElementById('src'+srCharIndex);
            if(el)el.classList.add('visible');
            srCharIndex++;
          }
        } else {
          let revealedThisTick=0;
          while(srCharIndex<=targetIdx&&srCharIndex<srChars.length&&revealedThisTick<SR_MAX_REVEAL_PER_TICK){
            const el=document.getElementById('src'+srCharIndex);
            if(el)el.classList.add('visible');
            srCharIndex++;
            revealedThisTick++;
          }
        }
        if(srCharIndex>=srChars.length){
          clearInterval(srRevealInterval);srRevealInterval=null;
          if(isHost)srStartPostRevealTimer();
        }
      },30);
    }
    srRenderBuzzArea();
  }
}

function srShowFeedback(correct,name,correctAns,userAns,timedOut,buzzRatio){
  buzzRatio=buzzRatio||0;
  const fb=document.getElementById('mpQCardFeedback');fb.style.display='block';
  const qCard=document.querySelector('#page-mp-quiz .q-card');
  if(correct&&qCard)qCard.classList.add('answered');
  document.getElementById('mpFbIcon').innerHTML=correct
    ?'<i class="ti ti-circle-check" style="color:#4ade80;font-size:20px"></i>'
    :'<i class="ti ti-circle-x" style="color:#f87171;font-size:20px"></i>';
  const isMe=name===currentUser;
  const buzzLabel=correct?(buzzRatio<=0.3?'Lightning read!':buzzRatio<=0.6?'Early buzz!':'Good read!'):'';
  document.getElementById('mpFbTitle').textContent=correct
    ?(isMe?'Correct!':name+' got it!')
    :timedOut?(isMe?"Time's up. Locked out!":name+' ran out of time!')
    :(isMe?'Wrong. Locked out!':name+' missed it!');
  document.getElementById('mpFbPts').textContent=correct?buzzLabel:'';
  const ya=document.getElementById('mpFbYourAns');
  if(!correct&&userAns&&userAns!=='(timed out)'){ya.textContent='Answer given: '+userAns;ya.style.display='block';}
  else{ya.style.display='none';}
  const mpSubEl=document.getElementById('mpFbSubmittedBy');if(mpSubEl)mpSubEl.style.display='none';
  if(correct){
    const rows=document.querySelectorAll('#mpScoreboard .mp-score-row');
    rows.forEach(row=>{
      const nameEl=row.querySelector('.mp-score-name');
      if(nameEl&&nameEl.textContent.includes(name)){
        row.classList.remove('pulse');void row.offsetWidth;
        row.classList.add('pulse');
        setTimeout(()=>row.classList.remove('pulse'),700);
      }
    });
  }
  // Only complete the reveal and show the answer on a correct buzz.
  // On a wrong answer the char animation resumes (handled in srApplyBuzzResult)
  // and the answer stays hidden until srRoundEnd fires.
  // NOTE: the flag window is intentionally NOT opened here. A correct buzz proves
  // the question was answerable — losers flagging at this moment would be abusing
  // void to erase a legitimate win. Flagging is only available in srRoundEnd (the
  // "no one got it" path) where all players see the reveal together with no stakes.
  if(correct){
    srChars.forEach((_,i)=>{const el=document.getElementById('src'+i);if(el)el.classList.add('visible');});
    const mpQText=document.getElementById('mpQuestionText');
    const subBy=currentQData?.submitted_by?`<div class="q-answer-sub">Question submitted by <span class="q-answer-sub-name">${currentQData.submitted_by}</span></div>`:'';
    mpQText.innerHTML=`<div class="sr-full-question">${currentQData.question}</div><div class="sr-answer-divider"></div>${answerRevealHTML(correctAns,currentQData,currentQData&&currentQData._match)}${subBy}${fallbackHintHTML(currentQData)}`;
    applyTheme();
  }
}

// Ends the round for everyone, not just the host. Previously srRoundEnd() was
// only ever called locally by the host on timeout/all-locked-out, so no other
// client ever learned the round was over — their Buzz In button stayed live
// indefinitely and the answer reveal never appeared on their screen. This
// wraps every host-triggered round-end in a broadcast so all clients reveal
// together and stop accepting buzz-ins at the same moment.
function srBroadcastRoundEnd(correctAns){
  if(!isHost)return;
  srRoundActive=false;
  if(rtChannel)rtChannel.send({type:'broadcast',event:'sr_round_end',payload:{correctAns:correctAns||null}});
  srRoundEnd(null,correctAns);
}

function srRoundEnd(winner,correctAns){
  const fb=document.getElementById('mpQCardFeedback');fb.style.display='block';
  document.getElementById('mpFbIcon').innerHTML='<i class="ti ti-circle-x" style="color:#f87171;font-size:20px"></i>';
  document.getElementById('mpFbTitle').textContent='No one got it!';
  document.getElementById('mpFbPts').textContent='';
  const ya=document.getElementById('mpFbYourAns');ya.style.display='none';
  const mpSubEl=document.getElementById('mpFbSubmittedBy');if(mpSubEl)mpSubEl.style.display='none';
  srChars.forEach((_,i)=>{const el=document.getElementById('src'+i);if(el)el.classList.add('visible');});
  const mpQText=document.getElementById('mpQuestionText');
  const ans=correctAns||(currentQData?.options?currentQData.options[currentQData.answer]:currentQData?.answer)||'?';
  const subBy=currentQData?.submitted_by?`<div class="q-answer-sub">Question submitted by <span class="q-answer-sub-name">${currentQData.submitted_by}</span></div>`:'';
  mpQText.innerHTML=`<div class="sr-full-question">${currentQData.question}</div><div class="sr-answer-divider"></div><div class="q-answer-reveal">${ans}</div>${subBy}${fallbackHintHTML(currentQData)}`;
  document.getElementById('mpAnswersGrid').innerHTML='';
  // Show the flag button now that the answer is revealed
  const rwRE=document.getElementById('mpReportWrap');if(rwRE)rwRE.style.display='block';
  const rbRE=document.getElementById('mpReportFlagBtn');
  if(rbRE){rbRE.innerHTML='<i class="ti ti-flag" style="font-size:13px"></i> Flag this question';rbRE.disabled=false;rbRE.style.opacity='1';rbRE.style.pointerEvents='';}
  mpFlagWindowOpen=true;
  clearTimeout(mpFlagWindowTimer);
  mpFlagWindowTimer=setTimeout(()=>{
    mpFlagWindowOpen=false;
    if(rbRE&&!rbRE.disabled){rbRE.style.opacity='.4';rbRE.style.pointerEvents='none';}
  },4000);
  mpStartAutoNext(()=>{
    if(!isHost)return;
    qIndex++;
    renderMPHUD();
    rtChannel.send({type:'broadcast',event:'sr_next_round',payload:{qIndex}});
    srHostFetchAndBroadcast();
  });
  applyTheme();
}

function srClearReveal(){
  clearInterval(srRevealInterval);srRevealInterval=null;
  clearInterval(srBuzzCountdown);srBuzzCountdown=null;
  clearInterval(srPostRevealTimer);srPostRevealTimer=null;
  clearInterval(mpAutoNextInterval);mpAutoNextInterval=null;
  mpCancelBackup(mpActiveAutoNextBackupId);
  srRoundActive=false;
  srBuzzedPlayer=null;
  srLockedPlayers=[];
  srBuzzTimeLeft=0;
  srCharIndex=0;
  srChars=[];
}


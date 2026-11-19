// Inbox, profile, profile pictures, sign-in, recovery, invite links (moved out of index.html 2026-11-19; loads in its original place, order matters)
// ── INBOX (player reply notifications) ───────────────────────────────────────
async function checkInboxBadge(){
  if(!currentUserId||isGuest)return;
  try{
    const[{data:msgs},{data:suggs}]=await Promise.all([
      sb.from('contact_messages').select('id,reply,read_at').eq('user_id',currentUserId),
      sb.from('topic_suggestions').select('id,reply,read_at').eq('user_id',currentUserId)
    ]);
    const btn=document.getElementById('inboxBtn');
    const dot=document.getElementById('inboxDot');
    const repliedMsgs=(msgs||[]).filter(m=>m.reply);
    const repliedSuggs=(suggs||[]).filter(s=>s.reply);
    const hasReplied=repliedMsgs.length>0||repliedSuggs.length>0;
    const hasUnread=[...repliedMsgs,...repliedSuggs].some(m=>!m.read_at);
    window._inbox={any:hasReplied,unread:[...repliedMsgs,...repliedSuggs].filter(m=>!m.read_at).length};
    if(typeof lzSyncAuth==='function')lzSyncAuth();
    if(dot)dot.style.display=hasUnread?'block':'none';
    if(btn){
      const wasVisible=btn.style.display==='inline-flex';
      if(hasReplied&&!wasVisible){
        btn.style.display='inline-flex';
        btn.classList.remove('inbox-pop-out');
        void btn.offsetWidth; // force reflow
        btn.classList.add('inbox-pop-in');
      } else if(!hasReplied&&wasVisible){
        _hideInboxBtn(btn);
      }
    }
  }catch(e){}
}
function _hideInboxBtn(btn){
  if(!btn)return;
  btn.classList.remove('inbox-pop-in');
  void btn.offsetWidth;
  btn.classList.add('inbox-pop-out');
  btn.addEventListener('animationend',()=>{
    btn.style.display='none';
    btn.classList.remove('inbox-pop-out');
  },{once:true});
}
async function openInboxModal(){
  const modal=document.getElementById('inboxModal');
  const content=document.getElementById('inboxContent');
  if(!modal||!content)return;
  modal.style.display='flex';
  content.innerHTML='<div class="admin-empty">Loading\u2026</div>';
  applyTheme();
  if(!currentUserId){content.innerHTML='<div class="admin-empty" style="color:var(--muted)">Not signed in.</div>';return;}
  try{
    const[{data:msgData,error:msgErr},{data:suggData,error:suggErr}]=await Promise.all([
      sb.from('contact_messages').select('id,message,sent_at,reply,replied_at,read_at').eq('user_id',currentUserId),
      sb.from('topic_suggestions').select('id,topic,note,created_at,reply,replied_at,read_at,status').eq('user_id',currentUserId)
    ]);
    if(msgErr)throw msgErr;
    if(suggErr)throw suggErr;
    const repliedMsgs=(msgData||[]).filter(m=>m.reply&&m.replied_at).map(m=>({...m,_table:'contact_messages',_date:m.replied_at}));
    const repliedSuggs=(suggData||[]).filter(s=>s.reply&&s.replied_at).map(s=>({...s,_table:'topic_suggestions',_date:s.replied_at}));
    const all=[...repliedMsgs,...repliedSuggs].sort((a,b)=>new Date(b._date)-new Date(a._date));
    if(!all.length){
      content.innerHTML='<div class="admin-empty" style="color:var(--muted)">No replies yet.</div>';
      return;
    }
    content.innerHTML=all.map(item=>{
      const isMsg=item._table==='contact_messages';
      const isUnread=!item.read_at;
      const typeTag=isMsg
        ?'<span style="font-size:11px;font-weight:800;background:var(--bg3);border:1px solid var(--border2);color:var(--muted);border-radius:99px;padding:1px 8px">\u2709\uFE0F Message</span>'
        :`<span style="font-size:11px;font-weight:800;background:var(--accent-soft);border:1px solid var(--border2);color:var(--accent);border-radius:99px;padding:1px 8px">\u{1F4A1} Suggestion${item.status==='added'?' \u00b7 Added \u2713':item.status==='dismissed'?' \u00b7 Dismissed':''}</span>`;
      const bodyText=isMsg?(item.message||''):(item.topic||'')+(item.note?'\n'+item.note:'');
      return `<div id="inboxMsg_${item.id}" data-table="${item._table}" style="background:var(--bg3);border:1.5px solid ${isUnread?'var(--accent)':'var(--border)'};border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${typeTag}
          <span style="font-size:12px;color:var(--muted)">${item._date?new Date(item._date).toLocaleDateString():''}</span>
          ${isUnread?'<span style="font-size:11px;font-weight:800;color:#fff;background:var(--accent);border-radius:99px;padding:1px 8px">New reply</span>':''}
          <button onclick="deleteInboxMessage('${item.id}')" data-table="${item._table}" title="Delete this message" style="margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;padding:3px 5px;border-radius:7px;display:inline-flex;align-items:center;gap:4px;font-family:'Nunito',sans-serif;font-size:11px;font-weight:800;transition:color .15s,background .15s" onmouseover="this.style.color='#f87171';this.style.background='#f8717115'" onmouseout="this.style.color='var(--muted)';this.style.background='none'"><i class="ti ti-trash" style="font-size:13px"></i> Delete</button>
        </div>
        <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;word-break:break-word">${bodyText.replace(/</g,'&lt;')}</div>
        <div style="padding:10px 12px;background:var(--accent-soft);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;display:flex;flex-direction:column;gap:4px">
          <div style="font-size:11px;font-weight:800;color:var(--accent)">\u{1F4AC} Reply \u00b7 ${new Date(item.replied_at).toLocaleDateString()}</div>
          <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;word-break:break-word">${(item.reply||'').replace(/</g,'&lt;')}</div>
        </div>
      </div>`;
    }).join('');
    // Mark all unread items as read in both tables
    const unreadMsgIds=repliedMsgs.filter(m=>!m.read_at).map(m=>m.id);
    const unreadSuggIds=repliedSuggs.filter(s=>!s.read_at).map(s=>s.id);
    const markRead=[];
    if(unreadMsgIds.length)markRead.push(sb.from('contact_messages').update({read_at:new Date().toISOString()}).in('id',unreadMsgIds));
    if(unreadSuggIds.length)markRead.push(sb.from('topic_suggestions').update({read_at:new Date().toISOString()}).in('id',unreadSuggIds));
    if(markRead.length){
      await Promise.all(markRead);
      const dot=document.getElementById('inboxDot');
      if(dot)dot.style.display='none';
    }
  }catch(e){
    content.innerHTML='<div class="admin-empty" style="color:var(--muted)">&#x26A0;&#xFE0F; Couldn\'t load messages.</div>';
  }
}
async function deleteInboxMessage(id){
  if(!currentUserId)return;
  const el=document.getElementById('inboxMsg_'+id);
  const table=(el&&el.dataset.table)||'contact_messages';
  if(el){el.style.opacity='.4';el.style.pointerEvents='none';}
  try{
    await sb.from(table).delete().eq('id',id).eq('user_id',currentUserId);
    if(el)el.remove();
    // If inbox is now empty, show empty state
    const remaining=document.querySelectorAll('[id^="inboxMsg_"]');
    if(!remaining.length){
      document.getElementById('inboxContent').innerHTML='<div class="admin-empty" style="color:var(--muted)">No replies yet.</div>';
    }
  }catch(e){
    if(el){el.style.opacity='';el.style.pointerEvents='';}
  }
}
async function closeInboxModal(){
  document.getElementById('inboxModal').style.display='none';
  // Re-check whether any replied messages/suggestions still exist; hide button if none
  if(!currentUserId||isGuest)return;
  try{
    const[{data:msgs},{data:suggs}]=await Promise.all([
      sb.from('contact_messages').select('id,reply').eq('user_id',currentUserId),
      sb.from('topic_suggestions').select('id,reply').eq('user_id',currentUserId)
    ]);
    const btn=document.getElementById('inboxBtn');
    const dot=document.getElementById('inboxDot');
    const hasReplied=(msgs||[]).some(m=>m.reply)||(suggs||[]).some(s=>s.reply);
    if(dot)dot.style.display='none'; // unread dot always off after reading
    if(btn&&!hasReplied){
      _hideInboxBtn(btn);
    }
  }catch(e){}
}

function signOut(){
  const state=isInActiveGameOrLobby();
  const title=document.getElementById('signOutModalTitle');
  const sub=document.getElementById('signOutModalSub');
  if(state.any){
    if(title)title.textContent=state.inSoloQuiz||state.inMpQuiz?'Quit & sign out?':'Leave lobby & sign out?';
    if(sub)sub.textContent=state.inSoloQuiz||state.inMpQuiz
      ?'You\'re still in a game. Signing out will end it for you. You\'ll need to sign back in to access your profile and saved stats.'
      :'You\'re still in a lobby. Signing out will remove you from it. You\'ll need to sign back in to access your profile and saved stats.';
  } else {
    if(title)title.textContent='Sign out?';
    if(sub)sub.textContent='You\'ll need to sign back in to access your profile and saved stats.';
  }
  document.getElementById('signOutModal').style.display='flex';
  applyTheme();
}
function closeSignOutModal(){
  document.getElementById('signOutModal').style.display='none';
}
async function confirmSignOut(){
  closeSignOutModal();
  // Leave any active lobby/game cleanly before tearing down auth state —
  // leaveLobbyRoom() needs currentUserId, which confirmSignOut() clears below.
  if(isInActiveGameOrLobby().any){
    try{ await leaveLobbyRoom(); }catch(e){}
  }
  await sbSignOut().catch(()=>{});
  guestForget();
  profileColorKey='auto';try{localStorage.removeItem('as_pf_color');}catch(e){}
  currentUser=null;currentUserId=null;isGuest=false;currentPfp=null;currentEmail=null;
  totalGames=0;bestScore=0;totalCorrect=0;totalAnswered=0;currentStreak=0;perfectGames=0;
  allHistory=[];score=0;lives=3;qIndex=0;quizHistory=[];
  prefetchedQuestion=null;currentQData=null;
  clearInterval(timerInterval);
  // Clear all auth fields immediately on sign out so the next person
  // who opens the sign-in form never sees previous credentials
  ['siUser','siPass','regUser','regPass','guestName','forgotUser','forgotCode','forgotPass'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  updateNav();goStep('landing');
}

// ── RECOVERY CODE (Profile → Account settings) ───────────────
function openRecoveryCode(){
  document.getElementById('rcAsk').style.display='flex';
  document.getElementById('rcDone').style.display='none';
  clearErr('rcErr');
  document.getElementById('recoveryCodeModal').style.display='flex';
  applyTheme();
}
function closeRecoveryCode(){
  document.getElementById('recoveryCodeModal').style.display='none';
  document.getElementById('rcCode').textContent='—';
}
async function makeRecoveryCode(){
  const btn=document.getElementById('rcMakeBtn');
  btn.disabled=true;
  try{
    const {data,error}=await withTimeout(sb.rpc('new_recovery_code'));
    if(error||typeof data!=='string')throw new Error('Couldn\'t make a code. Please try again.');
    document.getElementById('rcCode').textContent=data;
    document.getElementById('rcAsk').style.display='none';
    document.getElementById('rcDone').style.display='flex';
  }catch(e){
    showErr('rcErr','rcErrMsg',e.message||'Something went wrong.');
  }finally{btn.disabled=false;}
}

// ── DELETE ACCOUNT ────────────────────────────────────────────
function openDeleteAccount(){
  const input=document.getElementById('deleteAccountConfirm');
  if(input){input.value='';input.placeholder=currentUser||'your username';}
  document.getElementById('deleteAccountErr').style.display='none';
  const btn=document.getElementById('deleteAccountBtn');
  btn.disabled=true;btn.style.opacity='.4';btn.style.cursor='not-allowed';
  document.getElementById('deleteAccountModal').style.display='flex';
  applyTheme();
}
function closeDeleteAccount(){
  const input=document.getElementById('deleteAccountConfirm');
  if(input)input.value='';
  document.getElementById('deleteAccountModal').style.display='none';
}
function onDeleteConfirmInput(el){
  const matches=el.value.trim()===currentUser;
  const btn=document.getElementById('deleteAccountBtn');
  btn.disabled=!matches;
  btn.style.opacity=matches?'1':'.4';
  btn.style.cursor=matches?'pointer':'not-allowed';
  document.getElementById('deleteAccountErr').style.display='none';
}
async function deleteAccount(){
  const btn=document.getElementById('deleteAccountBtn');
  btn.disabled=true;
  btn.innerHTML='<i class="ti ti-loader-2" style="font-size:16px;animation:spin .8s linear infinite"></i> Deleting…';

  try{
    // Re-authenticate to verify the password before deleting
    const{data:{session},error:authErr}=await sb.auth.getSession();
    if(authErr||!session)throw new Error('Session expired. Please sign in again.');

    // Call the Edge Function which handles the actual account deletion server-side
    const res=await fetch(`${SUPABASE_URL}/functions/v1/delete-account`,{
      method:'POST',
      headers:{
        'Authorization':`Bearer ${session.access_token}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({})
    });
    const result=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(result.error||'Deletion failed. Please try again.');

    // Clear session locally — don't call sbSignOut() since the auth user
    // was just deleted and the logout endpoint would return 403
    try{await sb.auth.setSession({access_token:'',refresh_token:''});}catch(_){}
    try{localStorage.removeItem('sb-'+new URL(SUPABASE_URL).hostname.split('.')[0]+'-auth-token');}catch(_){}
    currentUser=null;currentUserId=null;isGuest=false;currentPfp=null;
    totalGames=0;bestScore=0;totalCorrect=0;totalAnswered=0;currentStreak=0;perfectGames=0;
    allHistory=[];score=0;lives=3;qIndex=0;quizHistory=[];
    prefetchedQuestion=null;currentQData=null;
    clearInterval(timerInterval);
    ['siUser','siPass','regUser','regPass','guestName','forgotUser','forgotCode','forgotPass'].forEach(id=>{
      const el=document.getElementById(id);if(el)el.value='';
    });
    closeDeleteAccount();
    updateNav();
    goStep('landing');
    // Show a goodbye toast
    const toast=document.createElement('div');
    toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg2);border:1px solid var(--border2);color:var(--text);font-family:Nunito,sans-serif;font-size:14px;font-weight:700;padding:12px 24px;border-radius:99px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3)';
    toast.textContent='Your account has been deleted. Goodbye! 👋';
    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(),4000);
  }catch(e){
    const errMsg=document.getElementById('deleteAccountErrMsg');
    errMsg.textContent=e.message||'Something went wrong. Please try again.';
    document.getElementById('deleteAccountErr').style.display='flex';
    btn.disabled=false;
    btn.innerHTML='<i class="ti ti-trash" style="font-size:16px"></i> Delete';
    btn.style.opacity='1';
  }
}

// ── EDIT PROFILE ──────────────────────────────────────────────
function openEditProfile(){
  if(!currentUser)return;
  // Profile background: "from my picture" or one of the colour pairs
  const picker=document.getElementById('editColorPicker');picker.innerHTML='';
  const nameEl=document.getElementById('editColorName');
  const opts=[['auto','From my picture',null,null],...PROFILE_PAIRS];
  const mark=(btn,k,n)=>{picker.querySelectorAll('button').forEach(b=>{delete b.dataset.selected;b.style.boxShadow='none';});btn.dataset.selected='true';btn.style.boxShadow='0 0 0 2px var(--bg2),0 0 0 4px var(--text)';if(nameEl)nameEl.textContent=n;};
  opts.forEach(([key,name,a,b])=>{
    const btn=document.createElement('button');btn.type='button';btn.title=name;btn.dataset.color=key;
    btn.style.cssText='width:34px;height:34px;border-radius:50%;border:0;cursor:pointer;flex-shrink:0;transition:box-shadow .15s;display:flex;align-items:center;justify-content:center;color:var(--text);'+(a?'background:linear-gradient(135deg,'+a+','+b+')':'background:var(--bg3);outline:1.5px dashed var(--border2);outline-offset:-1.5px');
    if(!a)btn.innerHTML='<i class="ti ti-photo" style="font-size:16px"></i>';
    btn.onclick=()=>mark(btn,key,name);
    picker.appendChild(btn);
    if((profileColorKey||'auto')===key)mark(btn,key,name);
  });
  document.getElementById('editProfileModal').style.display='flex';
  // Show email field only for accounts without a real email
  const emailWrap=document.getElementById('editEmailWrap');
  const emailInput=document.getElementById('editEmailInput');
  const hasRealEmail=currentEmail&&!currentEmail.endsWith('@animesekai.guest');
  if(emailWrap){emailWrap.style.display='none';}
  if(emailInput)emailInput.value='';
  applyTheme();
}
function closeEditProfile(){
  document.getElementById('editProfileModal').style.display='none';
}
async function saveEditProfile(){
  const selectedBtn=document.querySelector('#editColorPicker button[data-selected]');
  const newColor=selectedBtn?.dataset.color||profileColorKey||'auto';
  const emailInput=document.getElementById('editEmailInput');
  const newEmail=emailInput?.value.trim()||'';
  if(newEmail&&!newEmail.includes('@')){showErr('editEmailErr','editEmailErrMsg','Please enter a valid email address.');return}
  const saveBtn=document.querySelector('#editProfileModal .action-btn.primary');
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Saving…';}
  try{
  if(currentUserId&&!isGuest){
    // Profiles keep no email any more (the email field stays hidden), only the colour is saved
    const{error}=await sb.from('profiles').update({theme_color:newColor==='auto'?null:newColor}).eq('id',currentUserId);
    if(error){showErr('editEmailErr','editEmailErrMsg','Could not save. Try again.');return}
  }
  profileColorKey=newColor;try{localStorage.setItem('as_pf_color',newColor);}catch(e){}
  updateNav();renderProfile();applyTheme();
  closeEditProfile();
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-family:\'Lilita One\',cursive;font-size:14px;padding:12px 24px;border-radius:99px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3);animation:toastIn .3s ease;white-space:nowrap';
  toast.textContent=newEmail?'Email added successfully! ✅':'Profile updated! ✅';
  document.body.appendChild(toast);
  setTimeout(()=>{toast.style.opacity='0';toast.style.transition='opacity .4s';setTimeout(()=>toast.remove(),400);},3000);
  }catch(e){
    showErr('editEmailErr','editEmailErrMsg','Something went wrong. Please try again.');
  }finally{
    if(saveBtn){saveBtn.disabled=false;saveBtn.innerHTML='<i class="ti ti-check" style="font-size:15px"></i> Save';}
  }
}
// ── PROFILE PICTURE ───────────────────────────────────────────
const PFP_PRESETS = [
  // Shonen staples
  {id:'naruto',    name:'Naruto',    series:'Naruto',          src:'assets/pfp/naruto.png',    bg:'#ec8c44'},
  {id:'goku',      name:'Goku',      series:'Dragon Ball Z',   src:'assets/pfp/goku.png',      bg:'#1a5a8f'},
  {id:'luffy',     name:'Luffy',     series:'One Piece',       src:'assets/pfp/luffy.png',     bg:'#d42b2b'},
  {id:'ichigo',    name:'Ichigo',    series:'Bleach',          src:'assets/pfp/ichigo.png',    bg:'#a1a1a1'},
  {id:'deku',      name:'Deku',      series:'My Hero Academia',src:'assets/pfp/deku.png',      bg:'#1c4a36'},
  // Modern hits
  {id:'tanjiro',   name:'Tanjiro',   series:'Demon Slayer',    src:'assets/pfp/tanjiro.png',   bg:'#893745'},
  {id:'gojo',      name:'Gojo',      series:'Jujutsu Kaisen',  src:'assets/pfp/gojo.png',      bg:'#4425AA'},
  {id:'nezuko',    name:'Nezuko',    series:'Demon Slayer',    src:'assets/pfp/nezuko.png',    bg:'#f3abb3'},
  {id:'momo',      name:'Momo',      series:'Dandadan',        src:'assets/pfp/momo.png',      bg:'#d9478a'},
  {id:'power',     name:'Power',     series:'Chainsaw Man',    src:'assets/pfp/power.png',     bg:'#ec6064'},
  // Female leads / classics
  {id:'yor',       name:'Yor',       series:'Spy x Family',    src:'assets/pfp/yor.png',       bg:'#8ea99b'},
  {id:'frieren',   name:'Frieren',   series:'Frieren: Beyond Journey\'s End', src:'assets/pfp/frieren.png', bg:'#03ac95'},
];

let currentPfp = null;        // {type:'preset'|'upload', value: presetId | dataURL}
let pfpPendingSelection = null; // selection in the modal before saving
let pfpUploadDataUrl = null;   // data URL for uploaded image
let guestPendingPfp = null;   // pfp chosen on the guest screen before the account exists
let pfpGuestEntryMode = false;// when true, the picker stores a pending choice instead of committing

function togglePfpDropdown(e){
  e.stopPropagation();
  const dd=document.getElementById('pfpPreviewDropdown');
  const preview=document.getElementById('pfpUploadPreview');
  const isOpen=dd.style.display==='block';
  dd.style.display=isOpen?'none':'block';
  preview.classList.toggle('dropdown-open',!isOpen);
  if(!isOpen){
    // Close on next outside click
    setTimeout(()=>document.addEventListener('click',closePfpDropdown,{once:true}),0);
  }
}
function closePfpDropdown(){
  const dd=document.getElementById('pfpPreviewDropdown');
  if(dd)dd.style.display='none';
  const preview=document.getElementById('pfpUploadPreview');
  if(preview)preview.classList.remove('dropdown-open');
}
function pfpDropdownChange(){
  closePfpDropdown();
  document.getElementById('pfpFileInput').click();
}
function pfpDropdownRemove(){
  closePfpDropdown();
  removePfp();
}

function openPfpPicker(){
  pfpPendingSelection = currentPfp ? {...currentPfp} : null;
  pfpUploadDataUrl = null;
  pfpUploadBlob = null;
  switchPfpTab('upload');
  buildPfpPresetGrid();
  // Reset upload tab fully
  const zone=document.getElementById('pfpUploadZone');
  if(zone){zone.style.display='flex';}
  document.getElementById('pfpUploadErr').style.display='none';
  document.getElementById('pfpFileInput').value='';
  document.getElementById('pfpUploadTab').querySelectorAll('.pfp-upload-hint').forEach(el=>el.remove());
  document.getElementById('pfpPreviewDropdown').style.display='none';
  // Set the letter avatar initial
  const letterEl=document.getElementById('pfpLetterAvatar');
  if(letterEl&&currentUser)letterEl.textContent=currentUser[0].toUpperCase();
  // If user already has an uploaded pfp, show it immediately in the upload tab
  if(currentPfp?.type==='upload'){
    switchPfpTab('upload');
    document.getElementById('pfpUploadImg').src=currentPfp.value;
    document.getElementById('pfpUploadPreview').style.display='block';
    document.getElementById('pfpUploadZone').style.display='none';
    document.getElementById('pfpPreviewHint').style.display='block';
    document.getElementById('pfpPreviewDropdown').querySelector('button:last-child').style.display='flex';
  } else {
    document.getElementById('pfpUploadPreview').style.display='none';
    document.getElementById('pfpPreviewHint').style.display='none';
    document.getElementById('pfpUploadZone').style.display='flex';
  }
  // Show a note for guests that their pfp is session-only
  const guestNote=document.getElementById('pfpGuestSessionNote');
  if(guestNote)guestNote.style.display=isGuest?'flex':'none';
  document.getElementById('pfpModal').style.display='flex';
  applyTheme();
}
// Supabase closes the channel of a client that re-tracks presence too often
// (ClientPresenceRateLimitReached), so several avatar changes share one delayed track.
const PFP_TRACK_GAP_MS=15000;
let _pfpLastTrackAt=0,_pfpTrackTimer=null;
function rtTrackPfpThrottled(){
  if(_pfpTrackTimer)return;
  _pfpTrackTimer=setTimeout(()=>{
    _pfpTrackTimer=null;
    if(!rtChannel||!currentUserId||rtChannel.state!=='joined')return;
    let presenceAvatar=null;
    if(currentPfp){presenceAvatar=currentPfp.type==='preset'?'preset:'+currentPfp.value:currentPfp.value;}
    _pfpLastTrackAt=Date.now();
    rtChannel.track({userId:currentUserId,username:currentUser,avatar:presenceAvatar,hasPfp:!!currentPfp}).catch(()=>{});
  },Math.max(0,_pfpLastTrackAt+PFP_TRACK_GAP_MS-Date.now()));
}
function afterPfpSave(){
  removedAvatarUserIds.delete(currentUserId);
  closePfpPicker();renderProfile();updateNav();
  // Broadcast so lobby players see the new avatar instantly; presence catches up on a throttle
  if(rtChannel&&currentUserId){
    let presenceAvatar=null;
    if(currentPfp){presenceAvatar=currentPfp.type==='preset'?'preset:'+currentPfp.value:currentPfp.value;}
    rtChannel.send({type:'broadcast',event:'avatar_changed',payload:{userId:currentUserId,avatar:presenceAvatar}});
    rtTrackPfpThrottled();
    const me=lobbyPlayers.find(p=>p.userId===currentUserId);
    if(me){me.avatar=presenceAvatar;me.hasPfp=!!currentPfp;}
    const inLobby=document.getElementById('page-lobby-room')?.classList.contains('active');
    if(inLobby)renderLobbyRoom();
  }
}
function removePfp(){
  // Just stage the removal — don't save yet, user still needs to hit Confirm
  pfpPendingSelection={type:'remove'};
  // Hide the preview and restore the letter avatar zone
  document.getElementById('pfpUploadPreview').style.display='none';
  document.getElementById('pfpUploadImg').src='';
  document.getElementById('pfpPreviewHint').style.display='none';
  document.getElementById('pfpPreviewDropdown').style.display='none';
  document.getElementById('pfpUploadZone').style.display='flex';
  const letterEl=document.getElementById('pfpLetterAvatar');
  if(letterEl&&currentUser)letterEl.textContent=currentUser[0].toUpperCase();
}

async function applyRemovePfp(){
  try{
    // Delete from Supabase Storage if it was an uploaded file
    if(currentPfp?.type==='upload'&&currentUserId&&!SUPABASE_URL.includes('YOUR_PROJECT')){
      const{data:{session}}=await sb.auth.getSession();
      const authToken=session?.access_token||SUPABASE_ANON;
      await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${currentUserId}/avatar.jpg`,{
        method:'DELETE',
        headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${authToken}`}
      }).catch(()=>{});
    }
    // Clear avatar_url in profiles table
    if(currentUserId&&!isGuest&&!SUPABASE_URL.includes('YOUR_PROJECT')){
      const{data:{session}}=await sb.auth.getSession();
      const authToken=session?.access_token||SUPABASE_ANON;
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${currentUserId}`,{
        method:'PATCH',
        headers:{
          'apikey':SUPABASE_ANON,
          'Authorization':`Bearer ${authToken}`,
          'Content-Type':'application/json',
          'Prefer':'return=minimal'
        },
        body:JSON.stringify({avatar_url:null})
      }).catch(()=>{});
    }
    currentPfp=null;
    if(isGuest){try{localStorage.removeItem('guest_pfp');}catch(e){}guestSave();} // so a refresh doesn't bring it back
    removedAvatarUserIds.add(currentUserId);
    if(rtChannel&&currentUserId){
      rtChannel.send({type:'broadcast',event:'avatar_removed',payload:{userId:currentUserId}});
    }
    renderProfile();
    updateNav();
  }catch(e){
    console.error('Remove pfp error:',e);
  }
}
function closePfpPicker(){
  pfpGuestEntryMode=false;
  document.getElementById('pfpModal').style.display='none';
}
function switchPfpTab(tab){
  document.getElementById('pfpPresetTab').style.display = tab==='preset'?'block':'none';
  document.getElementById('pfpUploadTab').style.display  = tab==='upload'?'block':'none';
  document.getElementById('pfpTabPreset').classList.toggle('active', tab==='preset');
  document.getElementById('pfpTabUpload').classList.toggle('active', tab==='upload');
}
function buildPfpPresetGrid(){
  const grid = document.getElementById('pfpPresetGrid');
  grid.innerHTML = '';
  PFP_PRESETS.forEach(p => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
    const isSelected = pfpPendingSelection?.type==='preset' && pfpPendingSelection?.value===p.id;
    const item = document.createElement('div');
    item.className = 'pfp-preset-item' + (isSelected?' selected':'');
    item.id = 'pfpItem_'+p.id;
    item.title = p.name + ' · ' + p.series;
    item.style.background = p.bg||'var(--accent-soft)';
    item.onclick = () => selectPreset(p.id);
    item.innerHTML = `<img src="${p.src}" alt="${p.name}" style="object-fit:contain" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="pfp-preset-fallback" style="display:none;background:${p.bg||'var(--accent-soft)'}">${p.name.split(' ').map(w=>w[0]).join('')}</div>
      <div class="pfp-preset-check"><i class="ti ti-check" style="font-size:9px"></i></div>`;
    const label = document.createElement('div');
    label.className = 'pfp-preset-label';
    label.textContent = p.name;
    label.style.cssText = 'font-size:9px;font-weight:700;color:var(--muted);text-align:center;margin-top:2px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    wrap.appendChild(item);
    wrap.appendChild(label);
    grid.appendChild(wrap);
  });
}
function selectPreset(id){
  pfpPendingSelection = {type:'preset', value:id};
  document.querySelectorAll('.pfp-preset-item').forEach(el=>{
    el.classList.toggle('selected', el.id==='pfpItem_'+id);
  });
}
function pfpDragOver(e){e.preventDefault();document.getElementById('pfpUploadZone').classList.add('dragover')}
function pfpDragLeave(){document.getElementById('pfpUploadZone').classList.remove('dragover')}
function pfpDrop(e){
  e.preventDefault();pfpDragLeave();
  const file=e.dataTransfer?.files?.[0];
  if(file)processUploadFile(file);
}
// ── PFP CROP EDITOR ───────────────────────────────────────────
let _cropImg=null,_cropX=0,_cropY=0,_cropScale=1;
let _cropDragging=false,_cropLastX=0,_cropLastY=0;
let _cropPinchDist=0,_cropScaleAtPinch=1;
const CROP_SIZE=280, EXPORT_SIZE=512;

function pfpFileSelected(e){
  const file=e.target.files?.[0];
  if(file)openPfpCropEditor(file);
  e.target.value='';
}

function openPfpCropEditor(file){
  const errEl=document.getElementById('pfpUploadErr');
  const errMsg=document.getElementById('pfpUploadErrMsg');
  errEl.style.display='none';
  if(!file.type.startsWith('image/')){errMsg.textContent='Please choose an image file.';errEl.style.display='flex';return;}
  if(file.size>10*1024*1024){errMsg.textContent='Image must be under 10MB.';errEl.style.display='flex';return;}
  const img=new Image();
  const url=URL.createObjectURL(file);
  img.onload=()=>{
    URL.revokeObjectURL(url);
    _cropImg=img;
    // Default scale: fit the shortest side to CROP_SIZE
    const minSide=Math.min(img.width,img.height);
    _cropScale=CROP_SIZE/minSide;
    // Center the image
    _cropX=(CROP_SIZE-img.width*_cropScale)/2;
    _cropY=(CROP_SIZE-img.height*_cropScale)/2;
    // Sync slider min to current fit scale (can't zoom out below fit)
    const slider=document.getElementById('pfpZoomSlider');
    slider.min=100; slider.max=300; slider.value=100;
    _drawCrop();
    document.getElementById('pfpCropModal').style.display='flex';
    applyTheme();
    _attachCropEvents();
  };
  img.onerror=()=>{URL.revokeObjectURL(url);errEl.style.display='flex';errMsg.textContent='Could not load image.';};
  img.src=url;
}

function _drawCrop(){
  const canvas=document.getElementById('pfpCropCanvas');
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,CROP_SIZE,CROP_SIZE);
  ctx.save();
  ctx.translate(_cropX,_cropY);
  ctx.drawImage(_cropImg,0,0,_cropImg.width*_cropScale,_cropImg.height*_cropScale);
  ctx.restore();
  if(typeof crAfterDraw==='function')crAfterDraw();
}

function _clampCrop(){
  // Prevent panning so the viewport shows empty space — image must always fill the circle
  const w=_cropImg.width*_cropScale, h=_cropImg.height*_cropScale;
  if(_cropX>0)_cropX=0;
  if(_cropY>0)_cropY=0;
  if(_cropX+w<CROP_SIZE)_cropX=CROP_SIZE-w;
  if(_cropY+h<CROP_SIZE)_cropY=CROP_SIZE-h;
}

function _attachCropEvents(){
  const canvas=document.getElementById('pfpCropCanvas');
  // Pointer events (mouse + pen)
  canvas.onpointerdown=e=>{
    canvas.setPointerCapture(e.pointerId);
    _cropDragging=true;_cropLastX=e.clientX;_cropLastY=e.clientY;
    canvas.style.cursor='grabbing';
  };
  canvas.onpointermove=e=>{
    if(!_cropDragging)return;
    _cropX+=e.clientX-_cropLastX;
    _cropY+=e.clientY-_cropLastY;
    _cropLastX=e.clientX;_cropLastY=e.clientY;
    _clampCrop();_drawCrop();
  };
  canvas.onpointerup=canvas.onpointercancel=()=>{
    _cropDragging=false;canvas.style.cursor='grab';
  };
  // Scroll to zoom
  canvas.onwheel=e=>{
    e.preventDefault();
    const delta=e.deltaY>0?-0.05:0.05;
    _applyCropZoom(_cropScale+delta,CROP_SIZE/2,CROP_SIZE/2);
    const minScale=CROP_SIZE/Math.min(_cropImg.width,_cropImg.height);
    const pct=Math.round((_cropScale/minScale-1)/(2)*100);
    document.getElementById('pfpZoomSlider').value=Math.min(300,Math.max(100,100+pct*2));
  };
  // Pinch to zoom (touch)
  canvas.ontouchstart=e=>{
    if(e.touches.length===2){
      _cropPinchDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      _cropScaleAtPinch=_cropScale;
    }
  };
  canvas.ontouchmove=e=>{
    e.preventDefault();
    if(e.touches.length===2){
      const dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      const newScale=_cropScaleAtPinch*(dist/_cropPinchDist);
      _applyCropZoom(newScale,CROP_SIZE/2,CROP_SIZE/2);
    }
  };
  // Zoom slider
  document.getElementById('pfpZoomSlider').oninput=e=>{
    const minScale=CROP_SIZE/Math.min(_cropImg.width,_cropImg.height);
    const newScale=minScale*(1+(e.target.value-100)/100);
    _applyCropZoom(newScale,CROP_SIZE/2,CROP_SIZE/2);
  };
}

function _applyCropZoom(newScale,cx,cy){
  const minScale=CROP_SIZE/Math.min(_cropImg.width,_cropImg.height);
  const maxScale=minScale*3;
  newScale=Math.max(minScale,Math.min(maxScale,newScale));
  // Zoom toward the center point
  _cropX=cx-(_cropImg.width*newScale)*(cx-_cropX)/(_cropImg.width*_cropScale);
  _cropY=cy-(_cropImg.height*newScale)*(cy-_cropY)/(_cropImg.height*_cropScale);
  _cropScale=newScale;
  _clampCrop();_drawCrop();
}

function closePfpCrop(){
  document.getElementById('pfpCropModal').style.display='none';
  _cropImg=null;
}

function confirmPfpCrop(){
  // Export the cropped circle at EXPORT_SIZE×EXPORT_SIZE
  const exportCanvas=document.createElement('canvas');
  exportCanvas.width=EXPORT_SIZE;exportCanvas.height=EXPORT_SIZE;
  const ctx=exportCanvas.getContext('2d');
  // Full square — frames round the corners themselves (rounded squares everywhere)
  // Scale coords from CROP_SIZE viewport to EXPORT_SIZE export
  const ratio=EXPORT_SIZE/CROP_SIZE;
  ctx.drawImage(_cropImg,_cropX*ratio,_cropY*ratio,_cropImg.width*_cropScale*ratio,_cropImg.height*_cropScale*ratio);
  exportCanvas.toBlob(blob=>{
    if(!blob){document.getElementById('pfpUploadErrMsg').textContent='Export failed.';document.getElementById('pfpUploadErr').style.display='flex';return;}
    pfpUploadBlob=blob;
    const previewUrl=URL.createObjectURL(blob);
    pfpUploadDataUrl=previewUrl;
    pfpPendingSelection={type:'upload',value:'pending'};
    document.getElementById('pfpUploadImg').src=previewUrl;
    document.getElementById('pfpUploadPreview').style.display='block';
    document.getElementById('pfpUploadZone').style.display='none';
    document.getElementById('pfpUploadTab').querySelectorAll('.pfp-upload-hint').forEach(el=>el.remove());
    document.getElementById('pfpPreviewHint').style.display='block';
    document.getElementById('pfpPreviewDropdown').style.display='none';
    document.getElementById('pfpPreviewDropdown').querySelector('button:last-child').style.display=currentPfp?'flex':'none';
    closePfpCrop();
  },'image/jpeg',0.9);
}

async function savePfp(){
  if(pfpGuestEntryMode){savePfpFromGuestEntry();return;}
  if(!pfpPendingSelection){closePfpPicker();return;}

  // ── REMOVE: user staged a removal via dropdown ─────────────────
  if(pfpPendingSelection.type==='remove'){
    await applyRemovePfp();
    closePfpPicker();
    return;
  }

  // ── PRESET: just save the key, no storage needed ──────────────
  if(pfpPendingSelection.type==='preset'){
    currentPfp=pfpPendingSelection;
    if(isGuest){
      // Guests have no DB row — persist to sessionStorage for the session
      try{localStorage.setItem('guest_pfp',JSON.stringify(currentPfp));}catch(e){}guestSave();
    } else if(currentUserId){
      // Query builders have no .catch (it threw before sending); .then() sends the update
      sb.from('profiles').update({avatar_url:'preset:'+currentPfp.value}).eq('id',currentUserId).then(()=>{},()=>{});
    }
    afterPfpSave();
    return;
  }

  // ── UPLOAD: resize blob → Supabase Storage → save public URL ──
  if(!pfpUploadBlob){closePfpPicker();return;}

  // Show saving state
  const saveBtn=document.querySelector('#pfpModal .action-btn.primary');
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Saving…';}

  try{
    if(SUPABASE_URL.includes('YOUR_PROJECT')){
      // Dev fallback — no Supabase configured, keep data URL in memory
      currentPfp={type:'upload',value:pfpUploadDataUrl};
    } else if(isGuest){
      // Guest upload — use anon key with deterministic path so re-uploads overwrite
      const guestPath=`guest/${guestSessionId}/avatar.jpg`;
      const upRes=await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${guestPath}`,{
        method:'POST',
        headers:{
          'apikey':SUPABASE_ANON,
          'Authorization':`Bearer ${SUPABASE_ANON}`,
          'Content-Type':'image/jpeg',
          'x-upsert':'true'
        },
        body:pfpUploadBlob
      });
      if(!upRes.ok){
        const errBody=await upRes.json().catch(()=>({}));
        throw new Error(errBody.message||upRes.statusText);
      }
      const{data:{publicUrl}}=sb.storage.from('avatars').getPublicUrl(guestPath);
      currentPfp={type:'upload',value:publicUrl+'?t='+Date.now()};
      // keep it across refreshes (this browser's guest record + the guest's profile row), like presets
      try{localStorage.setItem('guest_pfp',JSON.stringify(currentPfp));}catch(e){}guestSave();
    } else {
      // Get the user's live auth token — required for RLS on storage uploads
      const{data:{session}}=await sb.auth.getSession();
      if(!session?.access_token){
        throw new Error('No active session. Please sign out and sign back in.');
      }
      const authToken=session.access_token;
      const filePath=`${currentUserId}/avatar.jpg`;

      // Upload via raw fetch with explicit JWT — avoids creating a second GoTrueClient
      // and ensures auth.uid() is always correct in RLS evaluation
      const upRes=await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${filePath}`,{
        method:'POST',
        headers:{
          'apikey':SUPABASE_ANON,
          'Authorization':`Bearer ${authToken}`,
          'Content-Type':'image/jpeg',
          'x-upsert':'true'
        },
        body:pfpUploadBlob
      });
      if(!upRes.ok){
        const errBody=await upRes.json().catch(()=>({}));
        throw new Error(errBody.message||upRes.statusText);
      }

      // Get the permanent public URL
      const{data:{publicUrl}}=sb.storage.from('avatars').getPublicUrl(filePath);

      // Cache-bust both in memory and in the DB so refreshes always pick up the new image
      const bustedUrl=publicUrl+'?t='+Date.now();
      currentPfp={type:'upload',value:bustedUrl};

      // Persist the cache-busted URL to profiles so the browser never serves a stale version on refresh
      const patchRes=await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${currentUserId}`,{
        method:'PATCH',
        headers:{
          'apikey':SUPABASE_ANON,
          'Authorization':`Bearer ${authToken}`,
          'Content-Type':'application/json',
          'Prefer':'return=minimal'
        },
        body:JSON.stringify({avatar_url:bustedUrl})
      });
      if(!patchRes.ok)console.error('Profile update error:',await patchRes.text());
    }
    afterPfpSave();
  }catch(e){
    const errEl=document.getElementById('pfpUploadErr');
    const errMsg=document.getElementById('pfpUploadErrMsg');
    errMsg.textContent='Upload failed. Please try again.';
    errEl.style.display='flex';
    console.error('PFP upload error:',e);
  }finally{
    if(saveBtn){saveBtn.disabled=false;saveBtn.innerHTML='<i class="ti ti-check" style="font-size:15px"></i> Confirm';}
  }
}

let pfpUploadBlob=null; // holds the resized Blob before upload
function getAvatarHTML(size, initial){
  if(!currentPfp){
    return `<div class="profile-avatar" id="profileAvatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.42)}px">${initial}</div>`;
  }
  const preset=currentPfp.type==='preset'?PFP_PRESETS.find(p=>p.id===currentPfp.value):null;
  const src=preset?preset.src:currentPfp.value;
  const bg=preset?(preset.bg||'var(--bg3)'):'var(--bg3)';
  if(!src)return `<div class="profile-avatar" id="profileAvatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.42)}px;background:${bg}">${initial}</div>`;
  return `<div class="profile-avatar" id="profileAvatar" style="width:${size}px;height:${size}px;padding:0;background:${bg}"><img src="${src}" alt="pfp" style="width:100%;height:100%;object-fit:${preset?'contain':'cover'};border-radius:50%" onerror="this.parentElement.textContent='${initial}'"></div>`;
}
function getLobbyAvatarHTML(avatarUrl, color, initial, size=36, loading=false){
  if(loading){
    // Player has a pfp but it hasn't arrived from presence/DB yet — very subtle overlay
    return `<div class="lobby-player-avatar" style="background:${color};opacity:.55;padding:0;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0"><div class="spinner" style="width:${Math.round(size*0.44)}px;height:${Math.round(size*0.44)}px;border-width:2px;border-color:rgba(255,255,255,0.2);border-top-color:rgba(255,255,255,0.7)"></div></div>`;
  }
  if(!avatarUrl){
    return `<div class="lobby-player-avatar" style="background:${color};font-size:${Math.round(size*0.42)}px">${initial}</div>`;
  }
  const preset=avatarUrl.startsWith('preset:')?PFP_PRESETS.find(p=>p.id===avatarUrl.slice(7)):null;
  const src=preset?preset.src:avatarUrl;
  const bg=preset?(preset.bg||color):color;
  if(!src)return `<div class="lobby-player-avatar" style="background:${bg};font-size:${Math.round(size*0.42)}px">${initial}</div>`;
  return `<div class="lobby-player-avatar" style="background:${bg};padding:0;overflow:hidden"><img src="${src}" alt="pfp" style="width:100%;height:100%;object-fit:${preset?'contain':'cover'};border-radius:50%" onerror="this.parentElement.innerHTML='${initial}'"></div>`;
}
function getNavAvatarHTML(initial){
  if(!currentPfp){
    return `<div class="user-avatar">${initial}</div>`;
  }
  const preset=currentPfp.type==='preset'?PFP_PRESETS.find(p=>p.id===currentPfp.value):null;
  const src=preset?preset.src:currentPfp.value;
  const bg=preset?(preset.bg||'var(--accent-soft)'):'';
  const bgStyle=bg?`background:${bg};`:'';
  if(!src)return `<div class="user-avatar" style="${bgStyle}">${initial}</div>`;
  return `<div class="user-avatar" style="${bgStyle}padding:0;overflow:hidden"><img src="${src}" alt="pfp" style="width:100%;height:100%;object-fit:${preset?'contain':'cover'};border-radius:50%" onerror="this.parentElement.textContent='${initial}'"></div>`;
}

// ── Guest-screen profile picture (chosen before the account exists) ──
function openGuestPfpPicker(){
  pfpGuestEntryMode=true;
  openPfpPicker();
  // openPfpPicker assumes a logged-in user; tailor it for the pre-account guest screen
  const nameEl=document.getElementById('guestName');
  const initial=((nameEl&&nameEl.value.trim()[0])||'?').toUpperCase();
  const letterEl=document.getElementById('pfpLetterAvatar');
  if(letterEl)letterEl.textContent=initial;
  const guestNote=document.getElementById('pfpGuestSessionNote');
  if(guestNote)guestNote.style.display='flex';
  // Reflect a choice already made earlier this session
  if(guestPendingPfp&&guestPendingPfp.type==='preset'){switchPfpTab('preset');selectPreset(guestPendingPfp.value);}
  else if(guestPendingPfp&&guestPendingPfp.type==='upload'){
    pfpUploadBlob=guestPendingPfp.blob;pfpUploadDataUrl=guestPendingPfp.dataUrl;pfpPendingSelection={type:'upload',value:'pending'};
    document.getElementById('pfpUploadImg').src=guestPendingPfp.dataUrl;
    document.getElementById('pfpUploadPreview').style.display='block';
    document.getElementById('pfpUploadZone').style.display='none';
    document.getElementById('pfpPreviewHint').style.display='block';
  }
}
function savePfpFromGuestEntry(){
  const sel=pfpPendingSelection;
  if(sel&&sel.type==='remove')guestPendingPfp=null;
  else if(sel&&sel.type==='preset')guestPendingPfp={type:'preset',value:sel.value};
  else if(sel&&sel.type==='upload'&&pfpUploadBlob){guestPendingPfp={type:'upload',blob:pfpUploadBlob,dataUrl:pfpUploadDataUrl};if(typeof auUp!=='undefined')auUp={...guestPendingPfp};}
  // a preset picked in the picker also moves the sign-in page's carousel to it
  if(guestPendingPfp&&guestPendingPfp.type==='preset'&&typeof auPfpIdx!=='undefined'){
    const i=PFP_PRESETS.findIndex(p=>p.id===guestPendingPfp.value);
    const reg=document.getElementById('authRegister');
    if(i>=0)auPfpIdx[(reg&&reg.style.display!=='none')?'reg':'guest']=i;
  }
  renderGuestPfpPreview();
  closePfpPicker();
  // the sign-in page's avatar disc (56d) is what shows the choice now; the old #guestPfpPreview is gone
  if(typeof auRenderPfp==='function')auRenderPfp();
}
function renderGuestPfpPreview(){
  const el=document.getElementById('guestPfpPreview');if(!el)return;
  const nameEl=document.getElementById('guestName');
  const initial=((nameEl&&nameEl.value.trim()[0])||'?').toUpperCase();
  if(guestPendingPfp&&guestPendingPfp.type==='upload'){
    el.style.background='var(--accent)';
    el.innerHTML=`<img src="${guestPendingPfp.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else if(guestPendingPfp&&guestPendingPfp.type==='preset'){
    const p=PFP_PRESETS.find(x=>x.id===guestPendingPfp.value);
    if(p&&p.src){el.style.background=p.bg||'var(--accent)';el.innerHTML=`<img src="${p.src}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:50%" onerror="this.parentElement.textContent='${initial}'">`;}
    else{el.style.background=(p&&p.bg)||'var(--accent)';el.textContent=p?p.name.split(' ').map(w=>w[0]).join(''):initial;}
  } else {
    el.style.background='var(--accent)';
    if(initial==='?')el.innerHTML='<i class="ti ti-camera" style="opacity:.85"></i>';
    else el.textContent=initial;
  }
}
async function uploadGuestPfp(blob){
  try{
    if(SUPABASE_URL.includes('YOUR_PROJECT'))return; // dev: keep the in-memory data URL
    const guestPath=`guest/${guestSessionId}/avatar.jpg`;
    const upRes=await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${guestPath}`,{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`,'Content-Type':'image/jpeg','x-upsert':'true'},
      body:blob
    });
    if(!upRes.ok)return;
    const{data:{publicUrl}}=sb.storage.from('avatars').getPublicUrl(guestPath);
    currentPfp={type:'upload',value:publicUrl+'?t='+Date.now()};
    try{localStorage.setItem('guest_pfp',JSON.stringify(currentPfp));}catch(e){}guestSave();
    updateNav();
  }catch(e){}
}

function goStep(name){
  if(name!=='admin'){const b=document.getElementById('adminContentSaveBar');if(b)b.style.display='none';}
  clearInterval(timerInterval);clearInterval(dailyTimerInterval);
  clearInterval(soloAutoNextInterval);clearInterval(mpAutoNextInterval);
  mpCancelBackup(mpActiveFuseBackupId);mpCancelBackup(mpActiveAutoNextBackupId);
  clearInterval(srRevealInterval);clearTimeout(srPostRevealTimer);
  clearTimeout(mpFlagWindowTimer);mpFlagWindowOpen=false;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const pg=document.getElementById('page-'+name);
  pg.classList.add('active');
  pg.querySelectorAll('.slide-in').forEach(el=>{el.style.animation='none';void el.offsetHeight;el.style.animation=''});
  if(name==='landing'){
    // Ensure landing content is fully visible on return (animation already ran once)
    const wrap=document.getElementById('entryWrap');
    const floats=document.getElementById('landingFloats');
    const logo=document.getElementById('entryLogoMark');
    if(wrap){wrap.style.opacity='1';wrap.classList.remove('landing-fadein');}
    if(floats){floats.style.opacity='1';floats.classList.remove('landing-fadein');}
    if(logo)logo.style.opacity='1';
  }
  if(name==='profile')renderProfile();
  if(name==='topic'){
    selectedTopics=[];isGeneralSelected=false;selectedDifficulty='easy';
    updateGeneralUI();renderSelectedTags();updateProceedBtn();
    switchTopicTab('anime');
    loadTopicsFromSupabase();
  }
  applyTheme();
}

function clearErr(id){document.getElementById(id).classList.remove('show')}
function showErr(id,msgId,msg){document.getElementById(msgId).textContent=msg;document.getElementById(id).classList.add('show')}

// Make role="button" elements (clickable cards) keyboard-operable with Enter/Space
document.addEventListener('keydown',function(e){
  if(e.key!=='Enter'&&e.key!==' ')return;
  const t=e.target;
  if(t&&t.getAttribute&&t.getAttribute('role')==='button'&&t.hasAttribute('tabindex')){
    e.preventDefault();t.click();
  }
});

// ── AUTH GATE ─────────────────────────────────────────────────
let pendingDestination='solo';
const authEyebrows={solo:'Solo quiz',create:'Create a lobby',join:'Join a lobby',landing:'Welcome back',multiplayer:'Multiplayer',submitQ:'Submit a Question'};
const authTitles={solo:'Enter the <span class="hi">Arena</span>',create:'Host with <span class="hi">friends</span>',join:'Jump <span class="hi">in</span>',landing:'Sign <span class="hi">in</span>',multiplayer:'Enter the <span class="hi">Arena</span>',submitQ:'Share your <span class="hi">Knowledge</span>'};

function choosePath(dest){
  pendingDestination=dest;
  if(dest!=='join')pendingInviteCode=null;
  if(currentUser){
    afterAuth();return;
  }
  document.getElementById('authEyebrow').textContent=authEyebrows[dest];
  document.getElementById('authTitle').innerHTML=authTitles[dest];
  // Default to the guest form for play paths (fewer clicks to first question);
  // returning users who chose "Sign In" land on the sign-in form.
  const defaultMode={solo:'guest',multiplayer:'guest',create:'guest',join:'guest',landing:'signin'}[dest]||null;
  showAuthMode(defaultMode);
  goStep('auth');
}
/* 56d/56e/56f: the gate shows guest + one account view at a time. mode null|'signin'
   keeps the sign-in half; 'register' swaps it; 'created' is 56f, where the guest
   half steps down because an account exists and guest is no longer on offer. */
function showAuthMode(mode){
  const m=(!mode||mode==='guest')?'signin':mode;
  const show=(id,on)=>{const el=document.getElementById(id);if(el)el.style.display=on?'':'none';};
  show('authSignin',m==='signin');
  show('authRegister',m==='register');
  show('authCreated',m==='created');
  show('authForgot',m==='forgot');
  const guest=document.getElementById('authGuest');
  const stepped=m==='created';
  // Someone already playing as a guest only needs the account side
  const activeGuest=!stepped&&typeof isGuest!=='undefined'&&isGuest&&!!currentUser;
  if(guest)guest.classList.toggle('stepped',stepped);
  show('authGuest',!activeGuest);
  show('guestSubmitBtn',!stepped);
  show('auGuestStepDown',stepped);
  show('authRule',!activeGuest);
  const eb=document.getElementById('authEyebrow'), tt=document.getElementById('authTitle');
  if(eb)eb.textContent=m==='created'?'YOU\'RE IN':activeGuest?'PLAYING AS GUEST':'BEFORE YOU PLAY';
  if(tt)tt.textContent=m==='created'?'Welcome':activeGuest?'Your account':'Jump in';
  if(m==='signin'){
    ['siUser','siPass'].forEach(id=>{const el=document.getElementById(id);if(el){el.value='';el.onkeydown=e=>{if(e.key==='Enter')submitSignin();}}});
    clearErr('signinErr');
    const games=activeGuest?(parseInt(totalGames)||0):0;
    show('auGuestLeft',games>0);
    if(games>0){
      document.getElementById('auGuestLeftN').textContent=games+(games===1?' game':' games');
      document.getElementById('auGuestLeftName').textContent=currentUser;
      document.getElementById('auGuestLeftIt').textContent=games===1?'it':'them';
    }
  } else if(m==='register'){
    ['regUser','regPass','regPass2'].forEach(id=>{const el=document.getElementById(id);if(el){el.value='';el.onkeydown=e=>{if(e.key==='Enter')auSubmitRegister();}}});
    const av=document.getElementById('auRegAvail');if(av)av.textContent='';
    const st=document.getElementById('auStrength');if(st)st.style.display='none';
    const mt=document.getElementById('auRegMatch');if(mt)mt.style.visibility='hidden';
    clearErr('regErr');
    // A guest signing up keeps their avatar (and their games): start the form from it
    if(isGuest&&currentUser){
      const ru=document.getElementById('regUser');if(ru){ru.value=currentUser.replace(/#\d{4}$/,'');auRegUser();}
      const list=(typeof PFP_PRESETS!=='undefined'?PFP_PRESETS:[]);
      if(currentPfp&&currentPfp.type==='preset'){const i=list.findIndex(p=>p.id===currentPfp.value);if(i>=0)auPfpIdx.reg=i;}
      else if(currentPfp&&currentPfp.type==='upload')guestPendingPfp={type:'upload',dataUrl:currentPfp.value};
    }
  } else if(m==='forgot'){
    ['forgotUser','forgotCode','forgotPass'].forEach(id=>{const el=document.getElementById(id);if(el){el.value='';el.onkeydown=e=>{if(e.key==='Enter')submitRecovery();}}});
    show('auForgotForm',true);show('auForgotDone',false);
    clearErr('forgotErr');
  }
  const gn=document.getElementById('guestName');
  if(gn&&!gn.onkeydown)gn.onkeydown=e=>{if(e.key==='Enter')submitGuest();};
  auRenderPfp();
}

/* ── avatar selector (56d/56e) ──────────────────────────────────
   Cycles PFP_PRESETS and writes the app's own guestPendingPfp, so submitGuest
   and the profile update path downstream are untouched. Upload reuses the
   existing picker — the corner button is the only way to a file dialog. */
let auPfpIdx={guest:0,reg:1};
function auPresetDiscHTML(p){
  if(!p)return '<i class="ti ti-user" style="font-size:26px;color:var(--muted)"></i>';
  if(p.src)return '<img src="'+p.src+'" alt="" onerror="this.parentElement.textContent=\''+(p.name||'?').split(' ').map(w=>w[0]).join('')+'\'">';
  return (p.name||'?').split(' ').map(w=>w[0]).join('');
}
function auRenderPfp(){
  const list=(typeof PFP_PRESETS!=='undefined'?PFP_PRESETS:[]);
  ['guest','reg'].forEach(side=>{
    const disc=document.getElementById(side==='guest'?'auDiscGuest':'auDiscReg');
    if(!disc)return;
    const up=(typeof guestPendingPfp!=='undefined'&&guestPendingPfp&&guestPendingPfp.type==='upload')?guestPendingPfp:null;
    if(up&&up.dataUrl){
      disc.innerHTML='<img src="'+up.dataUrl+'" alt="" style="object-fit:cover">';
      disc.style.background='var(--bg3)';
    } else {
      const p=list[auPfpIdx[side]%Math.max(1,list.length)];
      disc.innerHTML=auPresetDiscHTML(p);
      disc.style.background=(p&&p.bg)||'var(--bg3)';
    }
    const nm=document.getElementById(side==='guest'?'auNameGuest':'auNameReg');
    if(nm)nm.textContent=up?'Your own photo':((list[auPfpIdx[side]]||{}).name||'—');
    const sub=document.getElementById(side==='guest'?'auSubGuest':'auSubReg');
    if(sub)sub.innerHTML=up
      ? 'uploaded · <a onclick="auClearUpload()">use a preset instead</a>'
      : ((auPfpIdx[side]+1)+' of '+list.length+' · or <a onclick="openGuestPfpPicker()">upload your own</a>');
  });
  const pips=document.getElementById('auPipsGuest');
  if(pips&&list.length){
    const onUp=auOnUpload();
    pips.innerHTML=list.map((_,i)=>'<i class="'+(!onUp&&i===auPfpIdx.guest%list.length?'on':'')+'"></i>').join('')
      +((auUp||onUp)?'<i class="'+(onUp?'on':'')+'" title="Your photo"></i>':'');
  }
  auSyncPending();
}
function auSyncPending(){
  const list=(typeof PFP_PRESETS!=='undefined'?PFP_PRESETS:[]);
  if(typeof guestPendingPfp!=='undefined'&&guestPendingPfp&&guestPendingPfp.type==='upload')return;
  const view=document.getElementById('authRegister');
  const side=(view&&view.style.display!=='none')?'reg':'guest';
  const p=list[auPfpIdx[side]];
  if(p)guestPendingPfp={type:'preset',value:p.id};
}
/* the player's uploaded photo stays in the carousel as one more slot (after the last preset),
   so the arrows can move away from it and back without losing it */
let auUp=null;
function auOnUpload(){return typeof guestPendingPfp!=='undefined'&&!!guestPendingPfp&&guestPendingPfp.type==='upload';}
function auCycle(side,d){
  const list=(typeof PFP_PRESETS!=='undefined'?PFP_PRESETS:[]);
  const n=list.length;if(!n)return;
  if(auOnUpload()&&!auUp)auUp={...guestPendingPfp};
  if(auUp){
    const pos=((auOnUpload()?n:auPfpIdx[side])+d+n+1)%(n+1);
    if(pos===n)guestPendingPfp={...auUp};
    else{auPfpIdx[side]=pos;guestPendingPfp=null;}
  } else auPfpIdx[side]=(auPfpIdx[side]+d+n)%n;
  auRenderPfp();
}
function auClearUpload(){guestPendingPfp=null;auRenderPfp();}

/* ── field feedback ── */
function auEye(id,btn){
  const i=document.getElementById(id);if(!i)return;
  i.type=i.type==='password'?'text':'password';
  btn.innerHTML='<i class="ti ti-eye'+(i.type==='password'?'':'-off')+'" style="font-size:16px"></i>';
}
function auGuestInput(){
  const v=(document.getElementById('guestName').value||'').trim();
  const ok=document.getElementById('auGuestOk');
  if(ok)ok.style.visibility=(v.length>=3&&!/\s/.test(v))?'visible':'hidden';
  if(typeof renderGuestPfpPreview==='function')renderGuestPfpPreview();
}
let auAvailT=null;
function auRegUser(){
  const el=document.getElementById('auRegAvail');
  const v=(document.getElementById('regUser').value||'').trim();
  if(!el)return;
  clearTimeout(auAvailT);
  if(v.length<3||/\s/.test(v)){el.textContent='';return;}
  el.style.color='var(--muted)';el.textContent='CHECKING…';
  auAvailT=setTimeout(async()=>{
    try{
      if(SUPABASE_URL.includes('YOUR_PROJECT')){el.textContent='';return;}
      // Server check: format, name filter and taken (case-insensitive, exact)
      const {data:prob,error}=await sb.rpc('username_available',{p_name:v});
      if(error)throw error;
      if((document.getElementById('regUser').value||'').trim()!==v)return; // typed on meanwhile
      const taken=!!prob&&/taken/i.test(prob);
      el.style.color=prob?'#f87171':'#4ade80';
      el.innerHTML='<i class="ti ti-'+(prob?'x':'check')+'" style="font-size:12px"></i> '+(!prob?'AVAILABLE':taken?'TAKEN':'NOT ALLOWED');
    }catch(e){el.textContent='';}
  },420);
}
function auRegPass(){
  const p=(document.getElementById('regPass').value||'');
  const p2=(document.getElementById('regPass2').value||'');
  const st=document.getElementById('auStrength');
  if(st){
    st.style.display=p?'flex':'none';
    let n=0;
    if(p.length>=6)n=1;
    if(p.length>=10||(p.length>=8&&/[^a-zA-Z]/.test(p)))n=2;
    if(p.length>=12&&/[^a-zA-Z]/.test(p)&&/[A-Z]/.test(p))n=3;
    const col=['#f87171','#fbbf24','#4ade80'][Math.max(0,n-1)];
    [...st.querySelectorAll('i')].forEach((b,i)=>b.style.background=i<n?col:'var(--border2)');
    const lbl=st.querySelector('b');
    lbl.style.color=col;lbl.textContent=['','WEAK','GOOD','STRONG'][n];
  }
  const mt=document.getElementById('auRegMatch');
  if(mt)mt.style.visibility=(p2&&p===p2)?'visible':'hidden';
}

/* ── register → 56f ── */
let auPendingCreated=false;
function auSubmitRegister(){
  const p=document.getElementById('regPass').value;
  const p2=document.getElementById('regPass2').value;
  if(p.length<6){showErr('regErr','regErrMsg','Password must be at least 6 characters.');return;}
  if(p!==p2){showErr('regErr','regErrMsg','Those passwords don\'t match.');return;}
  auPendingCreated=true;
  submitRegister();
}
// The server makes the code and keeps only a hash, so this screen is the one chance to see it
async function auFetchCode(){
  const code=document.getElementById('auCode');
  if(!code)return;
  code.onclick=null;code.style.cursor='';code.textContent='…';
  try{
    const {data,error}=await withTimeout(sb.rpc('new_recovery_code'),8000);
    if(error||typeof data!=='string')throw error||new Error('no code');
    code.textContent=data;
  }catch(e){
    code.textContent='Couldn\'t make a code. Click to retry';
    code.style.cursor='pointer';code.onclick=auFetchCode;
  }
}
function auShowCreated(){
  auFetchCode();
  const disc=document.getElementById('auDoneDisc');
  const src=document.getElementById('auDiscReg');
  if(disc&&src){disc.innerHTML=src.innerHTML;disc.style.background=src.style.background;}
  const nm=document.getElementById('auDoneName');
  if(nm)nm.textContent=currentUser||'—';
  /* carry the chosen preset or upload onto the new profile */
  try{
    if(guestPendingPfp&&guestPendingPfp.type==='preset'){
      currentPfp={type:'preset',value:guestPendingPfp.value};
      if(currentUserId&&typeof sb!=='undefined')sb.from('profiles').update({avatar_url:'preset:'+guestPendingPfp.value}).eq('id',currentUserId).then(()=>{},()=>{});
    } else if(guestPendingPfp&&guestPendingPfp.type==='upload'&&guestPendingPfp.blob){
      currentPfp={type:'upload',value:guestPendingPfp.dataUrl}; // show instantly; upload swaps in the stored URL
      auUploadAccountPfp(guestPendingPfp.blob);
    }
    guestPendingPfp=null;
    updateNav();
  }catch(e){}
  showAuthMode('created');
}
// Same storage path + profile update as savePfp's signed-in upload
async function auUploadAccountPfp(blob){
  try{
    const{data:{session}}=await sb.auth.getSession();
    if(!session?.access_token||!currentUserId)return;
    const filePath=`${currentUserId}/avatar.jpg`;
    const upRes=await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${filePath}`,{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${session.access_token}`,'Content-Type':'image/jpeg','x-upsert':'true'},
      body:blob
    });
    if(!upRes.ok)return;
    const{data:{publicUrl}}=sb.storage.from('avatars').getPublicUrl(filePath);
    const bustedUrl=publicUrl+'?t='+Date.now();
    await sb.from('profiles').update({avatar_url:bustedUrl}).eq('id',currentUserId);
    currentPfp={type:'upload',value:bustedUrl};
    updateNav();
  }catch(e){}
}
function auCopyCode(btn,id){
  const txt=document.getElementById(id||'auCode').textContent;
  if(!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(txt))return;
  const done=()=>{btn.innerHTML='<i class="ti ti-check" style="font-size:15px;color:#4ade80"></i>';setTimeout(()=>{btn.innerHTML='<i class="ti ti-copy" style="font-size:15px"></i>';},1600);};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(done).catch(done);
  else done();
}
function auEnterArena(){auPendingCreated=false;afterAuth();}

function afterAuth(){
  if(auPendingCreated){auPendingCreated=false;auShowCreated();return;}
  if(pendingInviteCode){
    const code=pendingInviteCode;pendingInviteCode=null;
    showJoiningOverlay();
    // Join straight into the room; only fall back to the hub if it fails (so the error shows)
    rtJoinLobby(code).then(ok=>{if(!ok){hideJoiningOverlay();goStep('multiplayer');}}).catch(()=>{hideJoiningOverlay();goStep('multiplayer');});
    return;
  }
  if(pendingDestination==='create'){createLobby();return}
  if(pendingDestination==='join'){goStep('multiplayer');return}
  if(pendingDestination==='multiplayer'){goStep('multiplayer');return}
  if(pendingDestination==='profile'){goStep('profile');return}
  if(pendingDestination==='landing'){goStep('landing');return}
  if(pendingDestination==='submitQ'){
    goStep('landing');
    setTimeout(()=>{document.getElementById('submitQModal').style.display='flex';sqInitForm();applyTheme();},300);
    return;
  }
  goStep('format');
}
// ── USERNAME MODERATION ───────────────────────────────────────
// Normalizes common character substitutions then checks against a blocklist.
// This catches deliberate bypasses like "sh1t", "a$$", "f@ck" etc.
function isCleanUsername(name){
  const norm=name.toLowerCase()
    .replace(/[@4]/g,'a').replace(/3/g,'e').replace(/[1!|]/g,'i')
    .replace(/0/g,'o').replace(/[$5]/g,'s').replace(/[7+]/g,'t')
    .replace(/[^a-z0-9]/g,''); // strip remaining special chars
  const banned=[
    'fuck','fuk','fck','shit','sht','ass','arse','bitch','btch',
    'cunt','cnt','dick','dik','cock','cok','pussy','puss','nigger',
    'nigga','nigg','niga','fag','fagg','fagot','faggot','whore',
    'slut','rape','rapist','retard','retarded','bastard','bastrd',
    'prick','twat','wank','wanker','tosser','dipshit','asshole',
    'arsehole','motherfucker','mofo','mf','kike','spic','chink',
    'tranny','nazi','hitler','sex','porn','nude','naked','penis',
    'vagina','boob','boobs','tits','tit','dildo','cumshot','jizz',
    'cum','cum','sperm','boner','erection','horny','hentai',
  ];
  return !banned.some(w=>new RegExp('\\b'+w+'\\b').test(norm));
}

// Returning guests: the guest's name/pfp/session id live in localStorage under as_guest,
// tied to the anonymous Supabase user id so a stale record never attaches to a new session.
let _guestPfpSynced;
function guestSave(){
  try{if(isGuest&&currentUser)localStorage.setItem('as_guest',JSON.stringify({name:currentUser,uid:currentUserId||null,sid:guestSessionId,pfp:currentPfp||null,t:Date.now()}));}catch(e){}
  // Also keep the avatar on the guest's profile row, so it carries over when they make an account
  // (data: URLs are the instant preview of an upload still in flight; the stored URL follows)
  const v=!currentPfp?null:currentPfp.type==='preset'?'preset:'+currentPfp.value:(/^https?:/.test(currentPfp.value||'')?currentPfp.value:undefined);
  if(isGuest&&currentUserId&&v!==undefined&&v!==_guestPfpSynced&&typeof sb!=='undefined'){
    _guestPfpSynced=v;sb.from('profiles').update({avatar_url:v}).eq('id',currentUserId).then(()=>{},()=>{});
  }
}
// Guests' games are stored under their guest id, same as accounts
async function loadMyStats(){
  if(!currentUserId)return;
  const p=await sbLoadProfile(currentUserId);
  if(!p)return;
  totalGames=parseInt(p.total_games)||0;bestScore=parseInt(p.best_score)||0;
  totalCorrect=parseInt(p.total_correct)||0;totalAnswered=parseInt(p.total_answered)||0;
  perfectGames=parseInt(p.perfect_games)||0;
  allHistory=await sbLoadHistory(currentUserId);
}
function guestLoad(){try{return JSON.parse(localStorage.getItem('as_guest')||'null');}catch(e){return null;}}
function guestForget(){['as_guest','guest_pfp','guest_seen_ids'].forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});}
// If a registered player owns the name, the guest keeps it with a 4-digit tag: Naruto#4821
async function guestResolveName(v){
  // Every guest carries a 4-digit tag (Naruto#4821); it renders dimmed via .gtag
  const base=v.replace(/#\d{4}$/,'');
  const tag=()=>base+'#'+String(1000+Math.floor(Math.random()*9000));
  const want=/#\d{4}$/.test(v)?v:tag();
  if(SUPABASE_URL.includes('YOUR_PROJECT'))return want;
  // Preferred: server-side claim — it picks the tag (keeping a returning guest's own) and
  // prevents guest-vs-guest clashes, so show exactly what it returns. Send the name as typed:
  // with no tag, the server keeps the guest's existing tag rather than taking our random one.
  try{const {data,error}=await withTimeout(sb.rpc('claim_guest_name',{p_name:v}),5000);if(!error&&typeof data==='string'&&/#\d{4}$/.test(data))return data;}catch(e){}
  // Fallback: make sure no registered player owns the exact tagged name
  const taken=async n=>{try{const r=await withTimeout(fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&username=ilike.${encodeURIComponent(n)}&limit=1`,{headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}),5000);const rows=await withTimeout(r.json(),3000);return Array.isArray(rows)&&rows.length>0;}catch(e){return false;}};
  if(!(await taken(want)))return want;
  for(let i=0;i<4;i++){const n=tag();if(!(await taken(n)))return n;}
  return base+'#'+Date.now().toString().slice(-4);
}
// Guest name tags (#1234) render at low opacity everywhere names appear
(function guestTagInit(){
  const run=()=>{if(window._gtagObs)return;window._gtagObs=1;
    const RE=/(\S)(#\d{4})(?!\d)/;
    const dim=root=>{if(!root)return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>{const p=n.parentElement;if(!p||p.closest('script,style,textarea,input,.gtag,[contenteditable]'))return NodeFilter.FILTER_REJECT;return RE.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP;}});
      const hits=[];while(w.nextNode())hits.push(w.currentNode);
      hits.forEach(n=>{const m=n.nodeValue.match(RE);const i=m.index+1;const tail=n.splitText(i);tail.splitText(m[2].length);const s=document.createElement('span');s.className='gtag';s.style.opacity='.45';s.textContent=m[2];tail.replaceWith(s);});};
    dim(document.body);
    new MutationObserver(ms=>ms.forEach(m=>{if(m.type==='characterData')dim(m.target.parentElement);else m.addedNodes.forEach(n=>dim(n.nodeType===3?n.parentElement:n));})).observe(document.body,{childList:true,characterData:true,subtree:true});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
async function submitGuest(){
  const val=document.getElementById('guestName').value.trim();
  if(val.length<3){showErr('guestErr','guestErrMsg','Username must be at least 3 characters.');return}
  if(/\s/.test(val)){showErr('guestErr','guestErrMsg','No spaces allowed.');return}
  if(!isCleanUsername(val)){showErr('guestErr','guestErrMsg','That username isn\'t allowed. Please choose a different one.');return}
  const btn=document.getElementById('guestSubmitBtn');
  btn.disabled=true;btn.textContent='Entering…';
  try{
    // Reuse this browser's guest session if it has one; every new anonymous
    // sign-in leaves another guest user + profile row behind
    const {data:{session}}=await withTimeout(sb.auth.getSession(),3000);
    if(session?.user?.is_anonymous){
      currentUserId=session.user.id;
    } else {
      // Try anonymous Supabase sign-in for lobby support (5s timeout)
      const {data,error}=await withTimeout(sb.auth.signInAnonymously(),5000);
      if(!error&&data?.user)currentUserId=data.user.id;
    }
  }catch(e){
    // Silent fail — app works without Supabase for solo play
  }
  const resolved=await guestResolveName(val);
  currentUser=resolved;isGuest=true;
  
  // Generate a stable session ID for this guest — used as a deterministic
  // storage path so re-uploads overwrite the same file rather than accumulating
  if(!guestSessionId){guestSessionId=Math.random().toString(36).slice(2)+Date.now().toString(36);}
  // Apply the profile picture chosen on the guest screen (if any)
  if(guestPendingPfp){
    if(guestPendingPfp.type==='preset'){
      currentPfp={type:'preset',value:guestPendingPfp.value};
      try{localStorage.setItem('guest_pfp',JSON.stringify(currentPfp));}catch(e){}guestSave();
    } else if(guestPendingPfp.type==='upload'&&guestPendingPfp.blob){
      currentPfp={type:'upload',value:guestPendingPfp.dataUrl}; // show instantly; upload swaps in a sharable URL
      uploadGuestPfp(guestPendingPfp.blob);
    }
    guestPendingPfp=null;
  } else {
    // Restore any pfp the guest picked in a previous session
    try{
      const saved=localStorage.getItem('guest_pfp');
      if(saved)currentPfp=JSON.parse(saved);
    }catch(e){}
  }
  guestSave();
  loadMyStats().catch(()=>{}); // a returning guest's games are already on the server
  updateNav();afterAuth();
  btn.disabled=false;btn.innerHTML='ENTER THE ARENA <i class="ti ti-player-play" style="font-size:19px"></i>';
}
const SLOW_SERVER_MSG='Server\'s slow right now. Please try again in a moment.';
function withTimeout(p,ms=8000){let t;return Promise.race([p,new Promise((_,rej)=>{t=setTimeout(()=>rej(new Error(SLOW_SERVER_MSG)),ms)})]).finally(()=>clearTimeout(t));}
async function submitSignin(){
  const u=document.getElementById('siUser').value.trim();
  const p=document.getElementById('siPass').value;
  if(!u||!p){showErr('signinErr','signinErrMsg','Please fill in all fields.');return}
  const btn=document.getElementById('signinSubmitBtn');
  btn.disabled=true;btn.textContent='Signing in…';
  try{
    const user=await withTimeout(sbSignIn(u,p));
    const profile=await withTimeout(sbLoadProfile(user.id));
    currentUser=profile?.username||u;currentUserId=user.id;isGuest=false;
    currentEmail=profile?.email||null;
    totalGames    =parseInt(profile?.total_games)   ||0;
    bestScore     =parseInt(profile?.best_score)    ||0;
    totalCorrect  =parseInt(profile?.total_correct) ||0;
    totalAnswered =parseInt(profile?.total_answered)||0;
    perfectGames  =parseInt(profile?.perfect_games) ||0;
    allHistory=await withTimeout(sbLoadHistory(user.id)).catch(()=>allHistory||[]);
    if(profile?.avatar_url){
      if(profile.avatar_url.startsWith('preset:')){currentPfp={type:'preset',value:profile.avatar_url.slice(7)};}
      else{currentPfp={type:'upload',value:profile.avatar_url};}
    }
    updateNav();await checkAdminRole();afterAuth();
  }catch(e){
    // Supabase's own wording ("Invalid login credentials") isn't for players
    const msg=e.message||'';
    showErr('signinErr','signinErrMsg',
      /invalid login credentials|invalid.*(email|password)/i.test(msg)?'Wrong username or password.'
      :/rate limit|too many/i.test(msg)?'Too many tries. Please wait a minute and try again.'
      :msg===SLOW_SERVER_MSG?msg
      :'Couldn\'t sign in. Please try again.');
  }finally{
    btn.disabled=false;btn.innerHTML='<i class="ti ti-login" style="font-size:16px"></i> Sign In';
  }
}
async function submitRegister(){
  const u=document.getElementById('regUser').value.trim();
  const p=document.getElementById('regPass').value;
  if(u.length<3){showErr('regErr','regErrMsg','Username must be at least 3 characters.');return}
  if(/\s/.test(u)){showErr('regErr','regErrMsg','No spaces allowed.');return}
  if(!isCleanUsername(u)){showErr('regErr','regErrMsg','That username isn\'t allowed. Please choose a different one.');return}
  if(p.length<6){showErr('regErr','regErrMsg','Password must be at least 6 characters.');return}
  const btn=document.getElementById('regSubmitBtn');
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="font-size:18px;animation:spin .8s linear infinite"></i> CREATING…';
  try{
    // Same rules the server enforces (format, name filter, taken)
    const {data:prob,error:probErr}=await withTimeout(sb.rpc('username_available',{p_name:u}));
    if(probErr)throw probErr;
    if(prob){showErr('regErr','regErrMsg',prob);return;}
    const wasGuest=isGuest;
    const user=await withTimeout(sbCreateAccount(u,p),15000);
    currentUser=u;currentUserId=user?.id||null;isGuest=false;
    if(wasGuest)guestForget(); // the guest record now belongs to the account
    // The account keeps the guest's games: pull its stats from the server
    const profile=await withTimeout(sbLoadProfile(currentUserId)).catch(()=>null);
    if(profile){
      totalGames=parseInt(profile.total_games)||0;bestScore=parseInt(profile.best_score)||0;
      totalCorrect=parseInt(profile.total_correct)||0;totalAnswered=parseInt(profile.total_answered)||0;
      perfectGames=parseInt(profile.perfect_games)||0;
    }
    allHistory=await withTimeout(sbLoadHistory(currentUserId)).catch(()=>allHistory||[]);
    updateNav();await checkAdminRole();afterAuth();
  }catch(err){
    const msg=err.message||'';
    let friendly='Could not create account. Please try again.';
    if(/taken|isn't allowed|characters|letters, numbers/i.test(msg)){
      friendly=msg;
    } else if(msg.toLowerCase().includes('already registered')||msg.toLowerCase().includes('user already exists')||msg.toLowerCase().includes('already been registered')){
      friendly='That username is already taken. Please choose a different one.';
    } else if(msg.toLowerCase().includes('database error')||msg.toLowerCase().includes('saving new user')){
      friendly='That username is already taken. Please choose a different one.';
    } else if(msg.toLowerCase().includes('password')){
      friendly='Password must be at least 6 characters.';
    } else if(msg){
      friendly=msg;
    }
    showErr('regErr','regErrMsg',friendly);
  }finally{
    btn.disabled=false;btn.innerHTML='<i class="ti ti-user-plus" style="font-size:18px"></i> CREATE ACCOUNT';
  }
}
// ── PASSWORD RECOVERY (username + recovery code) ─────────────
// The code is checked on the server (reset_password_with_recovery_code), which
// sets the new password, signs the account out everywhere and returns a fresh code.
async function submitRecovery(){
  const u=document.getElementById('forgotUser').value.trim();
  const c=document.getElementById('forgotCode').value.trim();
  const p=document.getElementById('forgotPass').value;
  if(!u||!c||!p){showErr('forgotErr','forgotErrMsg','Please fill in all fields.');return}
  if(p.length<6){showErr('forgotErr','forgotErrMsg','Password must be at least 6 characters.');return}
  const btn=document.getElementById('forgotSubmitBtn');
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="font-size:18px;animation:spin .8s linear infinite"></i> CHECKING…';
  try{
    const {data,error}=await withTimeout(sb.rpc('reset_password_with_recovery_code',{p_username:u,p_code:c,p_new_password:p}));
    if(error)throw error;
    if(!data?.success)throw new Error(data?.error||'Something went wrong.');
    document.getElementById('auForgotCode').textContent=data.code||'—';
    document.getElementById('auForgotForm').style.display='none';
    document.getElementById('auForgotDone').style.display='';
  }catch(e){
    showErr('forgotErr','forgotErrMsg',e.message||'Something went wrong.');
  }finally{
    btn.disabled=false;btn.innerHTML='<i class="ti ti-lock" style="font-size:18px"></i> SET NEW PASSWORD';
  }
}

// ── DETECT LOBBY INVITE LINK IN URL ──────────────────────────
let pendingInviteCode=null;
function showJoiningOverlay(){const o=document.getElementById('joiningOverlay');if(o)o.style.display='flex';}
function hideJoiningOverlay(){const o=document.getElementById('joiningOverlay');if(o)o.style.display='none';}
(function(){
  const code=new URLSearchParams(window.location.search).get('lobby');
  if(!code)return;
  pendingInviteCode=code.toUpperCase();
  // Clean the URL so a refresh doesn't re-trigger the invite
  try{history.replaceState({},'',window.location.pathname);}catch(e){}
  const go=async()=>{
    // Cover the page while we work out whether they're signed in (hides the flashes)
    showJoiningOverlay();
    // Safety net: if we never end up joining, fall back to the username page
    setTimeout(()=>{if(pendingInviteCode){hideJoiningOverlay();choosePath('join');}},6000);
    try{
      const {data:{session}}=await sb.auth.getSession();
      // Signed-in users get auto-joined by onAuthStateChange — keep the overlay up
      if(session?.user&&!session.user.is_anonymous)return;
    }catch(e){}
    // Guest / no account session → they need to pick a username first
    if(pendingInviteCode){hideJoiningOverlay();choosePath('join');}
  };
  if(document.readyState!=='loading')go();
  else document.addEventListener('DOMContentLoaded',go);
})();

function selectFormat(fmt){selectedFormat=fmt;goStep('mode')}
let charFmtContext='solo'; // 'solo' | 'lobby'
function openCharFmtModal(ctx){
  charFmtContext=ctx||'solo';
  const m=document.getElementById('charFmtModal');
  m.style.display='flex';
}
function closeCharFmtModal(){
  document.getElementById('charFmtModal').style.display='none';
}
function selectCharFormat(fmt){
  closeCharFmtModal();
  if(charFmtContext==='lobby'){
    lobbyFormat=fmt;selectedFormat=fmt;
    pruneEmptyLobbyTopics();
    gsAfterChange();
  } else {
    selectedFormat=fmt;
    goStep('mode');
  }
}
function openSoloModeInfo(mode){
  const info={
    classic:{emoji:'🎮',name:'Classic',desc:getSiteText('solo_rules_classic')},
    race:{emoji:'🏁',name:'Score Race',desc:getSiteText('solo_rules_race')},
    survival:{emoji:'❤️',name:'Survival',desc:getSiteText('solo_rules_survival')}
  }[mode];
  if(!info)return;
  document.getElementById('smiEmoji').textContent=info.emoji;
  document.getElementById('smiName').textContent=info.name;
  document.getElementById('smiDesc').textContent=info.desc;
  document.getElementById('soloModeInfoModal').style.display='flex';
  applyTheme();
}
function closeSoloModeInfo(){
  document.getElementById('soloModeInfoModal').style.display='none';
}
function openVoidingInfoModal(){
  document.getElementById('voidingInfoModal').style.display='flex';
  applyTheme();
}
function closeVoidingInfoModal(){
  document.getElementById('voidingInfoModal').style.display='none';
}
function selectSoloMode(mode){
  pendingMode=mode;
  selectedTopics=[];isGeneralSelected=false;
  updateGeneralUI();
  clearTopicSearch();
  if(selectedFormat==='scene'){
    // Guess the Scene always draws from General Anime, so there's nothing to pick —
    // skip the topic step and go straight to game settings.
    isGeneralSelected=true;
    showTimeLimitPicker(mode);
  } else {
    loadTopicsFromSupabase();
    goStep('topic');
  }
}


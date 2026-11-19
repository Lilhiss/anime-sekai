// Admin panel (moved out of index.html 2026-11-19; loads in its original place, order matters)
// ── ADMIN PANEL ───────────────────────────────────────────────
let isAdmin=false;try{isAdmin=localStorage.getItem('as_admin')==='1';}catch(e){}
let adminTab='submitted';
const ADMIN_SECTION_INFO={
  review:{icon:'📬',title:'Review',desc:'Approve, reject, and resolve submitted, reported, and flagged questions.'},
  browse:{icon:'🔍',title:'Browse',desc:'Search and filter the full question bank.'},
  coverage:{icon:'📊',title:'Coverage',desc:'See how many questions exist per topic and format.'},
  charlib:{icon:'🎭',title:'Characters',desc:'Browse, search, and edit characters used in Name-the-Character questions.'},
  import:{icon:'📥',title:'Import',desc:'Bulk-import new questions from SQL.'},
  content:{icon:'🎛️',title:'Site Content',desc:'Edit card titles/descriptions and lock or unlock formats and game modes — changes go live immediately, no code or deploy needed.'},
  suggestions:{icon:'💡',title:'Suggestions',desc:'Review topic suggestions submitted by players.'},
  romanize:{icon:'🈂️',title:'Romanize',desc:'Find and fix non-romanized character names and aliases.'},
  leaks:{icon:'🕵️',title:'Answer Leaks',desc:'Find questions that accidentally give away the answer in their own wording.'},
  messages:{icon:'✉️',title:'Messages',desc:'Contact messages sent by players via the footer form.'}
};
function toggleAdminSearchClear(){const v=document.getElementById('adminSearchInput')?.value;const btn=document.getElementById('adminSearchClear');if(btn)btn.style.display=v?'block':'none';}
function toggleAdminTopicClear(){const v=document.getElementById('adminTopicFilter')?.value;const btn=document.getElementById('adminTopicClear');if(btn)btn.style.display=v?'block':'none';}
let adminSection='review';
let adminLite=[];        // lightweight rows — always loaded on panel open, drives stats/badges/coverage
let adminReviewRows=[];  // current page of full rows for the active Review tab
let adminBrowseRows=[];  // current page of full rows for Browse
let adminBrowseTotal=0;  // server-reported total matching Browse filters (for pager)
let adminBrowsePage=0;
let adminTrueTotal=0;     // server-reported total question count (unaffected by row cap)
let adminTrueApproved=0; // server-reported approved question count
let adminTruePending=0;  // server-reported pending question count
let adminReviewDateAsc=false; // false = newest first (default)
let adminPendingTopicFilter=null; // active topic filter on the Submitted (pending) tab
let adminPendingAllRows=[]; // unfiltered Submitted rows, used to derive topic pills
let ADMIN_PAGE_SIZE=50;
let aeEditId=null,aeOrig=null,adminHL='',_aeSaveCallback=null; // _aeSaveCallback: optional one-shot fired after a successful save, used by callers (e.g. the rewrite tool) that need to react beyond the default admin-list refresh
let ADMIN_ANIME_TOPICS=[];
let ADMIN_GENRE_TOPICS=[];
let ADMIN_POSTERS={};let covFilter='all';let covView=(()=>{try{return localStorage.getItem('as_cov_view')||'grid'}catch(e){return 'grid'}})();
function covSetView(v){covView=v;try{localStorage.setItem('as_cov_view',v)}catch(e){}renderAdminCoverage();}
const ADMIN_COV_THIN=10;

async function checkAdminRole(){
  if(!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  let isAdminResult=false;
  try{const{data}=await sb.rpc('is_admin');isAdminResult=data===true;}catch(e){}
  isAdmin=isAdminResult;
  try{localStorage.setItem('as_admin',isAdmin?'1':'0');}catch(e){}
  const adminLink=document.getElementById('adminNavLink');
  if(adminLink){adminLink.style.display=isAdmin?'flex':'none';adminLink.style.opacity=isAdmin?'1':'0';adminLink.style.pointerEvents=isAdmin?'':'none';}
}

function goAdmin(){
  if(!isAdmin){goStep('landing');return}
  _origGoStep('admin');
  loadAdminData();
}

// ── Lightweight fetch — runs every time the admin panel opens ─────────────────
// Fetches only the columns needed for stats/badges/coverage.
/* Reuses the last fetch for 10 min when the panel is reopened (edits made here keep adminLite in sync);
   the ↻ button passes force=true. Cuts repeat 5,000-row reads that were eating the Disk IO budget. */
let _adminLiteAt=0;
async function loadAdminData(force){
  if(!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  if(force!==true&&_adminLiteAt&&Date.now()-_adminLiteAt<10*60000&&adminLite&&adminLite.length){renderAdminStats();renderAdminBadges();renderAdminSection();return;}
  const list=document.getElementById('adminQuestionList');
  if(list)list.innerHTML='<div class="admin-empty">Loading…</div>';
  try{
    // Fetch lightweight rows for badges/coverage (capped at 5000 to match PostgREST max rows setting)
    const {data}=await sb.from('questions')
      .select('id,question,status,report_count,answer_count,correct_count,format,topic_type,topic_value,source_id')
      .limit(5000);
    adminLite=data||[];
    // Seed canonical topic lists from the topics table so zero-question topics appear in coverage
    try{
      const _ah={headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}};
      let tRes=await fetch(`${SUPABASE_URL}/rest/v1/topics?select=name,type,poster_url,poster_urls&status=eq.approved`,_ah);
      if(!tRes.ok)tRes=await fetch(`${SUPABASE_URL}/rest/v1/topics?select=name,type,poster_url&status=eq.approved`,_ah);
      if(!tRes.ok)tRes=await fetch(`${SUPABASE_URL}/rest/v1/topics?select=name,type&status=eq.approved`,_ah);
      const tData=tRes.ok?await tRes.json():[];
      ADMIN_POSTERS={};tData.forEach(t=>{const l=posterList(t);if(l.length)ADMIN_POSTERS[t.name]=l;});
      const _animeSet=new Set(tData.filter(t=>t.type==='anime').map(t=>t.name));
      const _genreSet=new Set(tData.filter(t=>t.type==='genre').map(t=>t.name));
      // Also union any topic_values from questions not yet in the table (safety net)
      adminLite.forEach(r=>{
        if(!r.topic_value)return;
        if(r.topic_type==="anime")_animeSet.add(r.topic_value);
        else if(r.topic_type==="genre")_genreSet.add(r.topic_value);
      });
      ADMIN_ANIME_TOPICS=[..._animeSet].sort((a,b)=>a.localeCompare(b));
      ADMIN_GENRE_TOPICS=[..._genreSet].sort((a,b)=>a.localeCompare(b));
    }catch(e){
      // Fallback: derive from live data only
      const _animeSet=new Set(),_genreSet=new Set();
      adminLite.forEach(r=>{
        if(!r.topic_value)return;
        if(r.topic_type==="anime")_animeSet.add(r.topic_value);
        else if(r.topic_type==="genre")_genreSet.add(r.topic_value);
      });
      ADMIN_ANIME_TOPICS=[..._animeSet].sort((a,b)=>a.localeCompare(b));
      ADMIN_GENRE_TOPICS=[..._genreSet].sort((a,b)=>a.localeCompare(b));
    }
    // Fetch exact counts separately so the summary bar is never capped
    const [{count:tc},{count:ac},{count:pc}]=await Promise.all([
      sb.from('questions').select('id',{count:'exact',head:true}),
      sb.from('questions').select('id',{count:'exact',head:true}).eq('status','approved'),
      sb.from('questions').select('id',{count:'exact',head:true}).eq('status','pending')
    ]);
    adminTrueTotal=tc||0;
    adminTrueApproved=ac||0;
    adminTruePending=pc||0;
    _adminLiteAt=Date.now();
  }catch(e){adminLite=[];adminTrueTotal=0;adminTrueApproved=0;adminTruePending=0;}
  renderAdminStats();renderAdminBadges();renderAdminSection();
  // Prefetch message + suggestion counts so badges are visible immediately
  try{
    const[{count:mc},{count:sc}]=await Promise.all([
      sb.from('contact_messages').select('id',{count:'exact',head:true}),
      sb.from('topic_suggestions').select('id',{count:'exact',head:true})
    ]);
    const msgBadge=document.getElementById('adminCountMessages');
    if(msgBadge){msgBadge.textContent=mc||0;msgBadge.style.display=(mc&&mc>0)?'inline-flex':'none';}
    const suggBadge=document.getElementById('adminCountSuggestions');
    if(suggBadge){suggBadge.textContent=sc||0;suggBadge.style.display=(sc&&sc>0)?'inline-flex':'none';}
  }catch(e){}
}

const ADMIN_FULL_COLS='id,question,options,answer,aliases,format,topic_type,topic_value,difficulty,status,report_count,answer_count,correct_count,submitted_by,media_url,created_at,source_id,distractors';

function toggleReviewDateSort(){
  adminReviewDateAsc=!adminReviewDateAsc;
  const icon=document.getElementById('adminReviewDateIcon');
  const btn=document.getElementById('adminReviewDateToggle');
  if(icon)icon.className='ti '+(adminReviewDateAsc?'ti-arrow-up':'ti-arrow-down')+' ';
  if(btn)btn.lastChild.textContent=adminReviewDateAsc?' Oldest':' Newest';
  fetchReviewTab();
}
// ── Review fetchers — one per tab, server-side filtered ───────────────────────
async function fetchReviewTab(){
  if(!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  const list=document.getElementById('adminQuestionList');
  if(list)list.innerHTML='<div class="admin-empty">Loading…</div>';
  try{
    let q=sb.from('questions').select(ADMIN_FULL_COLS);
    let empty='';
    if(adminTab==='submitted'){
      q=q.eq('status','pending').order('created_at',{ascending:adminReviewDateAsc});
      empty='No submitted questions. All clear! 🎉';
    } else if(adminTab==='reported'){
      q=q.gt('report_count',0).order('report_count',{ascending:false});
      empty='No reported questions. All clear! 🎉';
    } else {
      // Suspect: approved + enough plays + low correct rate — ratio filter must be client-side
      q=q.eq('status','approved').gte('answer_count',8);
      empty='No suspect questions. Nothing players keep getting wrong. 🎉';
    }
    const dateToggle=document.getElementById('adminReviewDateToggle');
    if(dateToggle)dateToggle.style.display=adminTab==='submitted'?'inline-flex':'none';
    const {data}=await q.limit(500);
    let rows=data||[];
    if(adminTab==='suspect'){
      rows=rows.filter(_adminIsSuspect).sort((a,b)=>(a.correct_count/a.answer_count)-(b.correct_count/b.answer_count));
    }
    if(adminTab==='submitted'){
      adminPendingAllRows=rows;
      renderAdminPendingTopics();
      if(adminPendingTopicFilter)rows=rows.filter(r=>(r.topic_value||'Untagged')===adminPendingTopicFilter);
    } else {
      const topicsEl=document.getElementById('adminPendingTopics');
      if(topicsEl)topicsEl.style.display='none';
    }
    adminReviewRows=rows;
    renderAdminList(rows,adminPendingTopicFilter&&adminTab==='submitted'?'No pending questions for this topic.':empty);
  }catch(e){
    adminReviewRows=[];
    const list=document.getElementById('adminQuestionList');
    if(list)list.innerHTML='<div class="admin-empty">Could not load questions.</div>';
  }
}
// Renders the topic pill list above the Submitted queue, with per-topic counts.
// Clicking a pill filters adminReviewRows to that topic; clicking the active pill clears the filter.
function renderAdminPendingTopics(){
  const topicsEl=document.getElementById('adminPendingTopics');
  if(!topicsEl)return;
  const counts=new Map();
  adminPendingAllRows.forEach(r=>{
    const t=r.topic_value||'Untagged';
    counts.set(t,(counts.get(t)||0)+1);
  });
  if(!counts.size){topicsEl.style.display='none';topicsEl.innerHTML='';return;}
  // Reset a filter that no longer matches any pending question
  if(adminPendingTopicFilter&&!counts.has(adminPendingTopicFilter))adminPendingTopicFilter=null;
  const topics=[...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  topicsEl.style.display='flex';
  topicsEl.innerHTML=topics.map(([topic,count])=>
    `<button class="admin-topic-pill${topic===adminPendingTopicFilter?' active':''}" onclick="togglePendingTopicFilter('${topic.replace(/'/g,"\\'")}')">${topic} <span class="admin-tab-count">${count}</span></button>`
  ).join('');
}
function togglePendingTopicFilter(topic){
  adminPendingTopicFilter=(adminPendingTopicFilter===topic)?null:topic;
  renderAdminPendingTopics();
  let rows=adminPendingAllRows;
  if(adminPendingTopicFilter)rows=rows.filter(r=>(r.topic_value||'Untagged')===adminPendingTopicFilter);
  adminReviewRows=rows;
  renderAdminList(rows,adminPendingTopicFilter?'No pending questions for this topic.':'No submitted questions. All clear! 🎉');
}

let _adminTopicSuggestIdx=-1;
function _adminTopicSuggest(){
  const inp=document.getElementById('adminTopicFilter');
  const drop=document.getElementById('adminTopicSuggestDrop');
  if(!inp||!drop)return;
  const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q=normalize(inp.value.trim());
  if(q.length<3){drop.classList.remove('open');drop.innerHTML='';_adminTopicSuggestIdx=-1;return;}
  const all=[...ADMIN_ANIME_TOPICS,...ADMIN_GENRE_TOPICS];
  const anime=ADMIN_ANIME_TOPICS.filter(t=>normalize(t).includes(q));
  const genre=ADMIN_GENRE_TOPICS.filter(t=>normalize(t).includes(q));
  if(!anime.length&&!genre.length){drop.classList.remove('open');drop.innerHTML='';return;}
  let html='';
  if(anime.length){html+='<div class="admin-topic-suggest-group">📺 Anime</div>';anime.forEach(t=>{html+=`<div class="admin-topic-suggest-item" onmousedown="_adminTopicSuggestPick('${t.replace(/'/g,"\\'")}')">  ${t}</div>`;});}
  if(genre.length){html+='<div class="admin-topic-suggest-group">🎭 Genre</div>';genre.forEach(t=>{html+=`<div class="admin-topic-suggest-item" onmousedown="_adminTopicSuggestPick('${t.replace(/'/g,"\\'")}')">  ${t}</div>`;});}
  drop.innerHTML=html;drop.classList.add('open');_adminTopicSuggestIdx=-1;
}
function _adminTopicSuggestPick(val){
  const inp=document.getElementById('adminTopicFilter');
  if(inp)inp.value=val;
  _adminTopicSuggestClose();
  toggleAdminTopicClear();
  adminBrowsePage=0;fetchAdminBrowse();
}
function _adminTopicSuggestClose(){
  const drop=document.getElementById('adminTopicSuggestDrop');
  if(drop){drop.classList.remove('open');drop.innerHTML='';}
  _adminTopicSuggestIdx=-1;
}
function _adminTopicSuggestBlur(){
  // Delay so onmousedown on an item fires before the input loses focus
  setTimeout(_adminTopicSuggestClose,150);
  // If user typed a complete valid topic, trigger browse
  const val=(document.getElementById('adminTopicFilter')?.value||'').trim();
  const valid=[...ADMIN_ANIME_TOPICS,...ADMIN_GENRE_TOPICS].includes(val);
  if(val&&valid){adminBrowsePage=0;fetchAdminBrowse();}
}
function _adminTopicSuggestKey(e){
  const drop=document.getElementById('adminTopicSuggestDrop');
  if(!drop||!drop.classList.contains('open'))return;
  const items=[...drop.querySelectorAll('.admin-topic-suggest-item')];
  if(!items.length)return;
  if(e.key==='ArrowDown'){e.preventDefault();_adminTopicSuggestIdx=Math.min(_adminTopicSuggestIdx+1,items.length-1);}
  else if(e.key==='ArrowUp'){e.preventDefault();_adminTopicSuggestIdx=Math.max(_adminTopicSuggestIdx-1,0);}
  else if(e.key==='Enter'&&_adminTopicSuggestIdx>=0){e.preventDefault();_adminTopicSuggestPick(items[_adminTopicSuggestIdx].textContent.trim());return;}
  else if(e.key==='Escape'){_adminTopicSuggestClose();return;}
  else return;
  items.forEach((el,i)=>el.classList.toggle('focused',i===_adminTopicSuggestIdx));
  items[_adminTopicSuggestIdx]?.scrollIntoView({block:'nearest'});
}

// ── Browse fetcher — server-side filtered + paginated ─────────────────────────
async function fetchAdminBrowse(){
  if(!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  const list=document.getElementById('adminQuestionList');
  if(list)list.innerHTML='<div class="admin-empty">Loading…</div>';
  const qstr=(document.getElementById('adminSearchInput')?.value||'').trim();
  adminHL=qstr.toLowerCase();
  const fmt=document.getElementById('adminFilterFormat')?.value||'';
  const diff=document.getElementById('adminFilterDiff')?.value||'';
  const topicFilter=(document.getElementById('adminTopicFilter')?.value||'').trim();
  const animeFilter=ADMIN_ANIME_TOPICS.includes(topicFilter)?topicFilter:'';
  const genreFilter=!animeFilter&&ADMIN_GENRE_TOPICS.includes(topicFilter)?topicFilter:'';
  try{
    // Count query — same filters, no data returned
    let cq=sb.from('questions').select('id',{count:'exact',head:true});
    if(fmt)cq=cq.eq('format',fmt);
    if(diff)cq=cq.eq('difficulty',diff);
    if(animeFilter)cq=cq.eq('topic_type','anime').eq('topic_value',animeFilter);
    else if(genreFilter)cq=cq.eq('topic_type','genre').eq('topic_value',genreFilter);
    if(qstr)cq=cq.or(`question.ilike.%${qstr}%,answer.ilike.%${qstr}%`);
    const {count}=await cq;
    adminBrowseTotal=count||0;
    // If current page is now out of range, reset to 0
    const totalPages=Math.max(1,Math.ceil(adminBrowseTotal/ADMIN_PAGE_SIZE));
    if(adminBrowsePage>=totalPages)adminBrowsePage=0;
    // Data query — same filters, paginated
    const start=adminBrowsePage*ADMIN_PAGE_SIZE;
    const end=start+ADMIN_PAGE_SIZE-1;
    let dq=sb.from('questions').select(ADMIN_FULL_COLS);
    if(fmt)dq=dq.eq('format',fmt);
    if(diff)dq=dq.eq('difficulty',diff);
    if(animeFilter)dq=dq.eq('topic_type','anime').eq('topic_value',animeFilter);
    else if(genreFilter)dq=dq.eq('topic_type','genre').eq('topic_value',genreFilter);
    if(qstr)dq=dq.or(`question.ilike.%${qstr}%,answer.ilike.%${qstr}%`);
    const browseSort=document.getElementById('adminBrowseSort')?.value||'topic';
    let dq2=sb.from('questions').select(ADMIN_FULL_COLS);
    if(fmt)dq2=dq2.eq('format',fmt);
    if(diff)dq2=dq2.eq('difficulty',diff);
    if(animeFilter)dq2=dq2.eq('topic_type','anime').eq('topic_value',animeFilter);
    else if(genreFilter)dq2=dq2.eq('topic_type','genre').eq('topic_value',genreFilter);
    if(qstr)dq2=dq2.or(`question.ilike.%${qstr}%,answer.ilike.%${qstr}%`);
    if(browseSort==='date_desc')dq2=dq2.order('created_at',{ascending:false});
    else if(browseSort==='date_asc')dq2=dq2.order('created_at',{ascending:true});
    else dq2=dq2.order('topic_value',{ascending:true,nullsFirst:false});
    dq2=dq2.range(start,end);
    const {data}=await dq2;
    adminBrowseRows=data||[];
    renderAdminBrowseFromCache();
  }catch(e){
    adminBrowseRows=[];adminBrowseTotal=0;
    const list=document.getElementById('adminQuestionList');
    if(list)list.innerHTML='<div class="admin-empty">Could not load questions.</div>';
  }
}
function _adminIsSuspect(q){return q.answer_count>=8&&q.status==='approved'&&(q.correct_count/q.answer_count)<0.33;}
function renderAdminStats(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  const src=adminLite; // lightweight rows always available
  const pending=adminTruePending||src.filter(q=>q.status==='pending').length;
  const reported=src.filter(q=>q.report_count>0).length;
  const suspect=src.filter(_adminIsSuspect).length;
  set('ahPending',pending);set('ahReported',reported);set('ahSuspect',suspect);
  const glow=(id,n)=>{const el=document.getElementById(id);if(el)el.classList.toggle('glow',n>0);};
  glow('ahPendingItem',pending);glow('ahReportedItem',reported);glow('ahSuspectItem',suspect);
  const plays=src.reduce((s,q)=>s+(q.answer_count||0),0);
  const total=adminTrueTotal||src.length;
  const approved=adminTrueApproved||src.filter(q=>q.status==='approved').length;
  const approvedSrc=src.filter(q=>q.status==='approved');
  const approvedMC=approvedSrc.filter(q=>q.format==='mc').length;
  const approvedType=approvedSrc.filter(q=>q.format==='type').length;
  const approvedChar=approvedSrc.filter(q=>q.format==='char').length;
  const approvedScene=approvedSrc.filter(q=>q.format==='scene').length;
  const linkedPairs=approvedSrc.filter(q=>q.format==='type'&&q.source_id).length;
  const fmtBreakdown=' (MC '+approvedMC.toLocaleString()+' · Type '+approvedType.toLocaleString()+(linkedPairs>0?' ('+linkedPairs.toLocaleString()+' 🔗)':'')+' · Char '+approvedChar.toLocaleString()+' · Scene '+approvedScene.toLocaleString()+')';
  const sumEl=document.getElementById('adminSummary');if(sumEl)sumEl.textContent=total.toLocaleString()+' questions · '+approved.toLocaleString()+' approved'+fmtBreakdown+' · '+plays.toLocaleString()+' plays';
}
function renderAdminBadges(){
  const set=(id,n)=>{const el=document.getElementById(id);if(el)el.textContent=n>0?n:'';};
  const src=adminLite; // lightweight rows always available
  set('adminCountSubmitted',adminTruePending||src.filter(q=>q.status==='pending').length);
  set('adminCountReported',src.filter(q=>q.report_count>0).length);
  set('adminCountSuspect',src.filter(_adminIsSuspect).length);
}
function adminJump(tab){switchAdminSection('review');switchAdminTab(tab);}

// Jump from a Coverage row straight into Browse, pre-filtered by that topic
async function coverageJumpToBrowse(topic){
  await switchAdminSection('browse');
  const inp=document.getElementById('adminTopicFilter');
  if(inp)inp.value=topic;
  toggleAdminTopicClear();
  adminBrowsePage=0;
  fetchAdminBrowse();
}

// Jump from a "Linked" badge on a converted Type question to its source MC question in Browse
async function jumpToSourceQuestion(sourceId){
  let src=null;
  try{const {data}=await sb.from('questions').select('question,topic_value').eq('id',sourceId).single();src=data;}catch(e){}
  if(!src){alert('Could not find the linked MC question (it may have been deleted).');return;}
  await switchAdminSection('browse');
  const topicInp=document.getElementById('adminTopicFilter');
  if(topicInp){topicInp.value=src.topic_value||'';toggleAdminTopicClear();}
  const searchInp=document.getElementById('adminSearchInput');
  if(searchInp){searchInp.value=src.question;toggleAdminSearchClear();}
  adminBrowsePage=0;
  await fetchAdminBrowse();
  document.getElementById('adminCard_'+sourceId)?.scrollIntoView({behavior:'smooth',block:'center'});
}

// Jump from a Coverage row straight into the Character Library, pre-filtered by that topic
async function coverageJumpToCharacters(topic){
  await switchAdminSection('charlib');
  const topicInp=document.getElementById('charLibTopicInput');
  const nameInp=document.getElementById('charLibNameInput');
  const genderInp=document.getElementById('charLibGenderInput');
  if(topicInp)topicInp.value=topic;
  document.getElementById('charLibTopicClear').style.display='block';
  document.getElementById('charLibTopicDrop').style.display='none';
  if(nameInp)nameInp.value='';
  document.getElementById('charLibNameClear').style.display='none';
  if(genderInp)genderInp.value='';
  fetchCharLibrary();
}


function _toggleAdminMoreMenu(){
  const menu=document.getElementById('adminMoreMenu');
  const btn=document.getElementById('adminSecMore');
  if(menu.classList.contains('open')){menu.classList.remove('open');return;}
  const r=btn.getBoundingClientRect();
  menu.style.top=(r.bottom+6)+'px';
  // Center under the button, but keep within viewport
  const menuW=160;
  let left=r.left+(r.width/2)-(menuW/2);
  left=Math.max(8,Math.min(left,window.innerWidth-menuW-8));
  menu.style.left=left+'px';
  menu.classList.add('open');
}
// Move the More menu to <body> so it's never clipped by a stacking context ancestor
(function _hoistAdminMoreMenu(){
  const move=()=>{const m=document.getElementById('adminMoreMenu');if(m&&m.parentElement!==document.body)document.body.appendChild(m);};
  if(document.readyState!=='loading')move();
  else document.addEventListener('DOMContentLoaded',move);
})();
function _pickAdminMore(section){
  document.getElementById('adminMoreMenu').classList.remove('open');
  switchAdminSection(section);
}
document.addEventListener('click',(e)=>{
  const wrap=document.getElementById('adminMoreMenu');
  if(wrap&&wrap.classList.contains('open')&&!e.target.closest('.admin-more-wrap')){
    wrap.classList.remove('open');
  }
});

async function switchAdminSection(section){
  adminSection=section;
  const info=ADMIN_SECTION_INFO[section];
  if(info)document.getElementById('adminSectionHeader').innerHTML=`<div class="admin-section-title">${info.icon} ${info.title}</div><div class="admin-section-desc">${info.desc}</div>`;
  document.getElementById('adminSecReview').classList.toggle('active',section==='review');
  document.getElementById('adminSecBrowse').classList.toggle('active',section==='browse');
  document.getElementById('adminSecCoverage').classList.toggle('active',section==='coverage');
  document.getElementById('adminSecImport').classList.toggle('active',section==='import');
  document.getElementById('adminSecContent').classList.toggle('active',section==='content');
  document.getElementById('adminSecCharLib').classList.toggle('active',section==='charlib');
  document.getElementById('adminSecSuggestions').classList.toggle('active',section==='suggestions');
  document.getElementById('adminSecRomanize').classList.toggle('active',section==='romanize');
  document.getElementById('adminSecLeaks').classList.toggle('active',section==='leaks');
  document.getElementById('adminSecMessages').classList.toggle('active',section==='messages');
  document.getElementById('adminSecMore').classList.toggle('active',section==='suggestions'||section==='romanize'||section==='leaks'||section==='messages');
  document.getElementById('adminMoreMenu').classList.remove('open');
  document.getElementById('adminReviewTabs').style.display=section==='review'?'flex':'none';
  if(section!=='review'){const pt=document.getElementById('adminPendingTopics');if(pt)pt.style.display='none';}
  document.getElementById('adminBrowseBar').style.display=section==='browse'?'flex':'none';
  document.getElementById('adminCoverage').style.display=section==='coverage'?'block':'none';
  document.getElementById('adminImport').style.display=section==='import'?'flex':'none';
  document.getElementById('adminContent').style.display=section==='content'?'flex':'none';
  document.getElementById('adminSuggestions').style.display=section==='suggestions'?'flex':'none';
  document.getElementById('adminRomanize').style.display=section==='romanize'?'flex':'none';
  document.getElementById('adminLeaks').style.display=section==='leaks'?'flex':'none';
  document.getElementById('adminCharLib').style.display=section==='charlib'?'flex':'none';
  document.getElementById('adminMessages').style.display=section==='messages'?'flex':'none';
  document.getElementById('adminQuestionList').style.display=(section==='coverage'||section==='import'||section==='content'||section==='suggestions'||section==='romanize'||section==='leaks'||section==='charlib'||section==='messages')?'none':'flex';
  const pager=document.getElementById('adminBrowsePager');if(pager)pager.style.display=section==='browse'?'':'none';
  _syncContentSaveBar();
  await renderAdminSection();
}
async function switchAdminTab(tab){
  adminTab=tab;
  if(tab!=='submitted')adminPendingTopicFilter=null;
  document.getElementById('adminTabSubmitted').classList.toggle('active',tab==='submitted');
  document.getElementById('adminTabReported').classList.toggle('active',tab==='reported');
  document.getElementById('adminTabSuspect').classList.toggle('active',tab==='suspect');
  if(adminSection==='review')await fetchReviewTab();
}
async function renderAdminSection(){
  if(adminSection==='coverage')return renderAdminCoverage();
  if(adminSection==='browse')return fetchAdminBrowse();
  if(adminSection==='suggestions')return fetchAdminSuggestions();
  if(adminSection==='charlib')return fetchCharLibrary();
  if(adminSection==='messages')return fetchAdminMessages();
  if(adminSection==='content')return renderAdminContentPanel();
  if(adminSection==='import'||adminSection==='romanize'||adminSection==='leaks')return;
  return fetchReviewTab();
}
// Pure render — called after fetchAdminBrowse() populates adminBrowseRows/adminBrowseTotal
function renderAdminBrowseFromCache(){
  const list=document.getElementById('adminQuestionList');
  const pager=document.getElementById('adminBrowsePager');
  _bulkIds.clear();_bulkSyncBar();
  const rows=adminBrowseRows;
  const total=adminBrowseTotal;
  if(!rows.length){
    list.innerHTML='<div class="admin-empty">No questions match your filters.</div>';
    if(pager)pager.style.display='none';
    return;
  }
  const totalPages=Math.ceil(total/ADMIN_PAGE_SIZE);
  const start=adminBrowsePage*ADMIN_PAGE_SIZE;
  list.innerHTML='';
  const selRow=document.createElement('div');
  selRow.style.cssText='display:flex;align-items:center;gap:10px;padding:2px 2px 4px';
  selRow.innerHTML='<button onclick="bulkSelectAll()" style="background:var(--accent-soft);border:1px solid var(--border2);color:var(--accent);font-family:\'Nunito\',sans-serif;font-size:12px;font-weight:800;padding:5px 12px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:5px"><i class="ti ti-checkbox" style="font-size:13px"></i> Select page</button>'
    +'<span style="font-size:12px;color:var(--muted);font-weight:700">Showing '+(start+1)+'–'+(start+rows.length)+' of '+total+' question'+(total===1?'':'s')+'</span>';
  list.appendChild(selRow);
  rows.forEach(q=>{
    const card=buildAdminCard(q);
    card.classList.add('bulk-mode');
    list.appendChild(card);
  });
  fillAdminLinkedBoxes(rows);
  if(pager){
    if(totalPages<=1){pager.style.display='none';}
    else{
      pager.style.display='flex';
      pager.innerHTML='';
      const prevBtn=document.createElement('button');
      prevBtn.className='admin-pager-btn';
      prevBtn.innerHTML='<i class="ti ti-chevron-left" style="font-size:14px"></i> Prev';
      prevBtn.disabled=adminBrowsePage===0;
      prevBtn.onclick=()=>{adminBrowsePage--;fetchAdminBrowse();list.scrollIntoView({behavior:'smooth',block:'start'});};
      pager.appendChild(prevBtn);
      const range=_pagerRange(adminBrowsePage,totalPages);
      range.forEach(item=>{
        if(item==='…'){
          const sep=document.createElement('span');sep.className='admin-pager-info';sep.textContent='…';pager.appendChild(sep);
        } else {
          const btn=document.createElement('button');
          btn.className='admin-pager-btn'+(item===adminBrowsePage?' active':'');
          btn.textContent=item+1;
          btn.onclick=(()=>{const p=item;return()=>{adminBrowsePage=p;fetchAdminBrowse();list.scrollIntoView({behavior:'smooth',block:'start'});};})();
          pager.appendChild(btn);
        }
      });
      const nextBtn=document.createElement('button');
      nextBtn.className='admin-pager-btn';
      nextBtn.innerHTML='Next <i class="ti ti-chevron-right" style="font-size:14px"></i>';
      nextBtn.disabled=adminBrowsePage>=totalPages-1;
      nextBtn.onclick=()=>{adminBrowsePage++;fetchAdminBrowse();list.scrollIntoView({behavior:'smooth',block:'start'});};
      pager.appendChild(nextBtn);
      const info=document.createElement('span');
      info.className='admin-pager-info';
      info.textContent='Page '+(adminBrowsePage+1)+' of '+totalPages;
      pager.appendChild(info);
    }
  }
  applyTheme();
}
function _pagerRange(cur,total){
  if(total<=7)return Array.from({length:total},(_,i)=>i);
  const pages=[];
  pages.push(0);
  if(cur>2)pages.push('…');
  for(let i=Math.max(1,cur-1);i<=Math.min(total-2,cur+1);i++)pages.push(i);
  if(cur<total-3)pages.push('…');
  pages.push(total-1);
  return pages;
}
let _adminTopicDropsFilled=false;

async function fetchAdminSuggestions(){
  const wrap=document.getElementById('adminSuggestions');
  if(!wrap)return;
  wrap.innerHTML='<div class="admin-empty">Loading…</div>';
  try{
    const{data,error,count}=await sb.from('topic_suggestions').select('*',{count:'exact'}).order('created_at',{ascending:false});
    if(error)throw error;
    const badge=document.getElementById('adminCountSuggestions');
    if(badge){badge.textContent=count||0;badge.style.display=(count&&count>0)?'inline-flex':'none';}
    if(!data||!data.length){
      wrap.innerHTML='<div class="admin-empty" style="color:var(--muted)">No topic suggestions yet.</div>';
      return;
    }
    wrap.innerHTML='<div style="font-size:13px;color:var(--muted);margin-bottom:8px">'+data.length+' suggestion'+(data.length===1?'':'s')+' — edit the name if needed, pick Anime or Genre, then Add to Topics.</div>'
      +data.map(s=>{
        const hasUserId=!!s.user_id;
        const statusBadge=s.status&&s.status!=='pending'
          ?`<span style="font-size:11px;font-weight:800;padding:1px 8px;border-radius:99px;${s.status==='added'?'background:var(--accent);color:#fff':'background:var(--bg3);border:1px solid var(--border2);color:var(--muted)'}">${s.status==='added'?'Added ✓':'Dismissed'}</span>`
          :'';
        const replySection=hasUserId
          ?(s.reply&&s.replied_at
            ?`<div style="padding:10px 12px;background:var(--accent-soft);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;display:flex;flex-direction:column;gap:4px">
                <div style="font-size:11px;font-weight:800;color:var(--accent)">YOUR REPLY · ${new Date(s.replied_at).toLocaleString()}</div>
                <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;word-break:break-word">${(s.reply||'').replace(/</g,'&lt;')}</div>
              </div>`
            :`<textarea id="sugg-reply-${s.id}" placeholder="Optional reply to player…" rows="2" style="width:100%;background:var(--bg3);border:1.5px solid var(--border2);border-radius:10px;padding:8px 10px;color:var(--text);font-family:'Nunito',sans-serif;font-size:13px;font-weight:600;outline:none;resize:vertical;line-height:1.5;transition:border-color .15s" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border2)'"></textarea>`)
          :'';
        return `
        <div class="admin-cov-row" id="sugg-row-${s.id}" style="display:flex;flex-direction:column;gap:10px;padding:14px 16px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:13px;font-weight:800;color:var(--text)">${(s.suggested_by||'anonymous').replace(/</g,'&lt;')}</span>
            <span style="font-size:11px;color:var(--muted)">${s.created_at?new Date(s.created_at).toLocaleDateString():''}</span>
            ${statusBadge}
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <select id="sugg-type-${s.id}" style="font-family:'Nunito',sans-serif;font-size:12px;font-weight:700;padding:6px 10px;border-radius:8px;border:1px solid var(--border2);background:var(--bg3);color:var(--text);cursor:pointer">
                <option value="anime">Anime</option>
                <option value="genre">Genre</option>
              </select>
              <button onclick="actionAdminSuggestion('${s.id}')" style="font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;padding:6px 14px;border-radius:8px;cursor:pointer;background:var(--accent);border:none;color:#fff;white-space:nowrap">Add to Topics</button>
              <button onclick="dismissAdminSuggestion('${s.id}')" style="font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;padding:6px 14px;border-radius:8px;cursor:pointer;background:var(--bg3);border:1px solid var(--border2);color:var(--muted)">Dismiss</button>
            </div>
          </div>
          <input id="sugg-topic-${s.id}" class="form-input" style="font-size:14px;font-weight:800;padding:8px 12px;width:100%" value="${(s.topic||'').replace(/"/g,'&quot;')}">
          ${s.note?`<div style="font-size:12px;color:var(--muted);font-style:italic;padding:0 2px">"${s.note.replace(/</g,'&lt;')}"</div>`:''}
          ${replySection}
        </div>`;
      }).join('');
  }catch(e){
    wrap.innerHTML='<div class="admin-empty" style="color:var(--muted)">⚠️ Couldn\'t load suggestions.</div>';
  }
  applyTheme();
}

// ── CONTACT MESSAGES ──────────────────────────────────────────────────────────
async function fetchAdminMessages(){
  const wrap=document.getElementById('adminMessages');
  if(!wrap)return;
  wrap.innerHTML='<div class="admin-empty">Loading\u2026</div>';
  try{
    const{data,error,count}=await sb.from('contact_messages').select('*',{count:'exact'}).order('sent_at',{ascending:false});
    if(error)throw error;
    const badge=document.getElementById('adminCountMessages');
    if(badge){badge.textContent=count||0;badge.style.display=(count&&count>0)?'inline-flex':'none';}
    if(!data||!data.length){
      wrap.innerHTML='<div class="admin-empty" style="color:var(--muted)">No messages yet.</div>';
      return;
    }
    wrap.innerHTML='<div style="font-size:13px;color:var(--muted);margin-bottom:4px">'+data.length+' message'+(data.length===1?'':'s')+'</div>'
      +data.map(m=>{
        const replied=!!(m.reply&&m.replied_at);
        const replySection=replied
          ?`<div style="margin-top:10px;padding:10px 12px;background:var(--accent-soft);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;display:flex;flex-direction:column;gap:4px">
              <div style="font-size:11px;font-weight:800;color:var(--accent)">YOUR REPLY \u00b7 ${new Date(m.replied_at).toLocaleString()}</div>
              <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;word-break:break-word">${(m.reply||'').replace(/</g,'&lt;')}</div>
              <button onclick="clearAdminReply('${m.id}')" style="align-self:flex-end;margin-top:4px;background:none;border:none;font-family:'Nunito',sans-serif;font-size:11px;font-weight:800;color:var(--muted);cursor:pointer;padding:0" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='var(--muted)'">Remove reply</button>
            </div>`
          :`<div style="margin-top:10px;display:flex;gap:8px;align-items:flex-end">
              <textarea id="reply-input-${m.id}" placeholder="Write a reply\u2026" rows="2" style="flex:1;background:var(--bg3);border:1.5px solid var(--border2);border-radius:10px;padding:8px 10px;color:var(--text);font-family:'Nunito',sans-serif;font-size:13px;font-weight:600;outline:none;resize:vertical;line-height:1.5;transition:border-color .15s" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border2)'"></textarea>
              <button onclick="sendAdminReply('${m.id}')" style="flex-shrink:0;background:var(--accent);border:none;color:#fff;font-family:'Nunito',sans-serif;font-size:13px;font-weight:800;padding:8px 14px;border-radius:10px;cursor:pointer;transition:opacity .15s;align-self:flex-end" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'"><i class="ti ti-send" style="font-size:14px"></i> Reply</button>
            </div>`;
        return `
      <div class="admin-cov-row" id="msg-row-${m.id}" style="display:flex;gap:14px;padding:14px 16px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:13px;font-weight:800;color:var(--text)">${(m.name||'Anonymous').replace(/</g,'&lt;')}</span>
            ${m.user_id?`<span style="font-size:11px;color:var(--muted);font-family:monospace">${m.user_id.slice(0,8)}\u2026</span>`:''}
            <span style="font-size:11px;color:var(--muted)">${m.sent_at?new Date(m.sent_at).toLocaleString():''}</span>
            ${replied?'<span style="font-size:11px;font-weight:800;color:var(--accent)">Replied \u2713</span>':'<span style="font-size:11px;font-weight:800;color:#f87171">Awaiting reply</span>'}
          </div>
          <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;word-break:break-word">${(m.message||'').replace(/</g,'&lt;')}</div>
          ${replySection}
        </div>
        <button onclick="deleteAdminMessage('${m.id}')" title="Delete message" style="flex-shrink:0;background:none;border:1px solid var(--border2);color:var(--muted);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:13px;transition:all .15s" onmouseover="this.style.color='#f87171';this.style.borderColor='#f87171'" onmouseout="this.style.color='var(--muted)';this.style.borderColor='var(--border2)'"><i class="ti ti-trash" style="font-size:14px"></i></button>
      </div>`;
      }).join('');
  }catch(e){
    wrap.innerHTML='<div class="admin-empty" style="color:var(--muted)">&#x26A0;&#xFE0F; Couldn\'t load messages.</div>';
  }
  applyTheme();
}
async function sendAdminReply(id){
  const ta=document.getElementById('reply-input-'+id);
  if(!ta)return;
  const reply=ta.value.trim();
  if(!reply)return;
  const btn=ta.nextElementSibling;
  if(btn){btn.disabled=true;btn.textContent='Sending\u2026';}
  const{error}=await sb.from('contact_messages').update({reply,replied_at:new Date().toISOString(),read_at:null}).eq('id',id);
  if(error){if(btn){btn.disabled=false;btn.innerHTML='<i class="ti ti-send" style="font-size:14px"></i> Reply';}showToast('Failed to send reply.');return;}
  await fetchAdminMessages();
}
async function clearAdminReply(id){
  if(!confirm('Remove this reply? The player will no longer see it.'))return;
  // Query builders have no .catch(), so it threw before the update ever ran
  try{await sb.from('contact_messages').update({reply:null,replied_at:null,read_at:null}).eq('id',id);}catch(e){}
  await fetchAdminMessages();
}
async function deleteAdminMessage(id){
  if(!confirm('Delete this message?'))return;
  try{await sb.from('contact_messages').delete().eq('id',id);}catch(e){}
  document.getElementById('msg-row-'+id)?.remove();
  const remaining=document.querySelectorAll('[id^="msg-row-"]').length;
  if(!remaining)document.getElementById('adminMessages').innerHTML='<div class="admin-empty" style="color:var(--muted)">No messages yet.</div>';
  const badge=document.getElementById('adminCountMessages');
  if(badge){const n=Math.max(0,(parseInt(badge.textContent)||1)-1);badge.textContent=n;badge.style.display=n>0?'inline-flex':'none';}
}

// ── CHARACTER LIBRARY ─────────────────────────────────────────────────────────
let _charLibTopicDropFilled=false;
let _charLibTopicItems=[];
let _charLibNameDebounce=null;

// When the topic field is empty, show a "browse by topic" dropdown with
// per-topic character counts (lazy-loaded, cached). When typing, fall back
// to a simple filtered list of known topic names.
function _charLibTopicSuggest(){
  const inp=document.getElementById('charLibTopicInput');
  const clearBtn=document.getElementById('charLibTopicClear');
  const val=(inp.value||'').trim().toLowerCase();
  clearBtn.style.display=val?'block':'none';
  if(!val){_charLibShowOverviewDrop();return;}
  const drop=document.getElementById('charLibTopicDrop');
  const all=[...ADMIN_ANIME_TOPICS,...ADMIN_GENRE_TOPICS].sort((a,b)=>a.localeCompare(b));
  const matches=all.filter(t=>t.toLowerCase().includes(val));
  if(!matches.length){drop.style.display='none';return;}
  drop.innerHTML=matches.slice(0,40).map((t,i)=>`<div class="admin-topic-suggest-item" data-val="${t.replace(/"/g,'&quot;')}" onmousedown="event.preventDefault();_charLibPickTopic('${t.replace(/'/g,"\\'")}');">${t}</div>`).join('');
  drop.style.display='block';
}

function _charLibPickTopic(topic){
  document.getElementById('charLibTopicInput').value=topic;
  document.getElementById('charLibTopicDrop').style.display='none';
  document.getElementById('charLibTopicClear').style.display='block';
  fetchCharLibrary();
}

function _charLibTopicKey(e){
  const drop=document.getElementById('charLibTopicDrop');
  const items=[...drop.querySelectorAll('.admin-topic-suggest-item')];
  const focused=drop.querySelector('.focused');
  const idx=items.indexOf(focused);
  if(e.key==='ArrowDown'){e.preventDefault();const n=items[(idx+1)%items.length];if(focused)focused.classList.remove('focused');n.classList.add('focused');n.scrollIntoView({block:'nearest'});}
  else if(e.key==='ArrowUp'){e.preventDefault();const n=items[(idx-1+items.length)%items.length];if(focused)focused.classList.remove('focused');n.classList.add('focused');n.scrollIntoView({block:'nearest'});}
  else if(e.key==='Enter'){if(focused)focused.dispatchEvent(new MouseEvent('mousedown'));else fetchCharLibrary();}
  else if(e.key==='Escape'){drop.style.display='none';}
}

function _charLibTopicBlur(){
  setTimeout(()=>{document.getElementById('charLibTopicDrop').style.display='none';},180);
}

function _charLibClearTopic(){
  document.getElementById('charLibTopicInput').value='';
  document.getElementById('charLibTopicClear').style.display='none';
  document.getElementById('charLibTopicDrop').style.display='none';
  fetchCharLibrary();
}

// Debounced auto-search as the admin types a character name
function _charLibNameInput(){
  document.getElementById('charLibNameClear').style.display=document.getElementById('charLibNameInput').value?'block':'none';
  clearTimeout(_charLibNameDebounce);
  _charLibNameDebounce=setTimeout(()=>fetchCharLibrary(),400);
}

function _charLibClearName(){
  document.getElementById('charLibNameInput').value='';
  document.getElementById('charLibNameClear').style.display='none';
  clearTimeout(_charLibNameDebounce);
  fetchCharLibrary();
}

// ── CHARACTER LIBRARY: TOPIC OVERVIEW (lightweight, on-demand) ────────────
// Fetches only topic_value + answer (no media_url/aliases) so it's far
// cheaper than loading full character cards, and only runs when the admin
// focuses the (empty) topic field — results are cached for the session.
let _charLibOverviewData=null;

async function _loadCharLibOverviewData(forceRefresh){
  if(!forceRefresh&&_charLibOverviewData)return _charLibOverviewData;
  const{data,error}=await sb.from('questions').select('topic_value,answer').eq('format','char').eq('status','approved');
  if(error)throw error;
  // Count distinct characters (by lowercased answer) per topic
  const byTopic={};
  (data||[]).forEach(r=>{
    const topic=r.topic_value||'—';
    const key=(r.answer||'').toLowerCase().trim();
    if(!byTopic[topic])byTopic[topic]=new Set();
    byTopic[topic].add(key);
  });
  _charLibOverviewData=Object.entries(byTopic)
    .map(([topic,set])=>({topic,count:set.size}))
    .sort((a,b)=>b.count-a.count||a.topic.localeCompare(b.topic));
  return _charLibOverviewData;
}

// Shows a "browse by topic" list (with character counts) inside the topic
// dropdown when the topic field is empty
async function _charLibShowOverviewDrop(){
  const drop=document.getElementById('charLibTopicDrop');
  if(!_charLibOverviewData){
    drop.innerHTML='<div class="admin-topic-suggest-item" style="opacity:.6;cursor:default">Loading topics…</div>';
    drop.style.display='block';
    try{await _loadCharLibOverviewData();}catch(e){
      drop.innerHTML='<div class="admin-topic-suggest-item" style="opacity:.6;cursor:default">⚠️ Couldn\'t load topics.</div>';
      return;
    }
  }
  if(!_charLibOverviewData.length){
    drop.innerHTML='<div class="admin-topic-suggest-item" style="opacity:.6;cursor:default">No characters yet.</div>';
    drop.style.display='block';
    return;
  }
  drop.innerHTML=_charLibOverviewData.map(r=>(
    '<div class="admin-topic-suggest-item" style="display:flex;align-items:center;gap:10px" onmousedown="event.preventDefault();_charLibPickTopic(\''+r.topic.replace(/'/g,"\\'")+'\')">'
    +'<span>'+r.topic+'</span>'
    +'<span style="margin-left:auto;font-size:11px;font-weight:800;opacity:.7">'+r.count+'</span>'
    +'</div>'
  )).join('');
  drop.style.display='block';
}

async function fetchCharLibrary(){
  const topic=(document.getElementById('charLibTopicInput').value||'').trim();
  const nameSearch=(document.getElementById('charLibNameInput').value||'').trim();
  const gender=document.getElementById('charLibGenderInput').value||'';
  const grid=document.getElementById('charLibGrid');
  const countEl=document.getElementById('charLibCount');
  countEl.style.display='none';
  // Avoid an unscoped fetch of every char-format question — require a topic or a name search.
  if(!topic&&!nameSearch){
    grid.innerHTML='<div class="char-lib-empty">🎭 Select a topic or search a character name to load results.</div>';
    return;
  }
  grid.innerHTML='<div class="char-lib-loading"><div class="spinner"></div><div>Loading characters…</div></div>';
  clearCharLibSelection();
  const aliasToggleBtnReset=document.getElementById('charLibAliasToggle');
  if(aliasToggleBtnReset)aliasToggleBtnReset.style.display='none';
  try{
    let q=sb.from('questions').select('id,answer,aliases,media_url,topic_value,topic_type,gender,distractors').eq('format','char').eq('status','approved');
    if(topic)q=q.eq('topic_value',topic);
    if(nameSearch)q=q.ilike('answer','%'+nameSearch.replace(/[%_\\]/g,c=>'\\'+c)+'%');
    if(gender)q=q.eq('gender',gender);
    q=q.order('answer',{ascending:true});
    const{data,error}=await q;
    if(error)throw error;
    // Deduplicate by character name (answer), keeping the first occurrence
    const seen=new Set();
    const chars=(data||[]).filter(r=>{
      const key=(r.answer||'').toLowerCase().trim();
      if(seen.has(key))return false;
      seen.add(key);return true;
    });
    const filterBits=[topic,nameSearch?`"${nameSearch}"`:'',gender].filter(Boolean);
    const filterDesc=filterBits.join(' · ');
    if(!chars.length){
      grid.innerHTML=`<div class="char-lib-empty">🎭 No characters found${filterDesc?' for '+filterDesc:''}.<br>Character questions use <b>format = char</b>.</div>`;
      countEl.style.display='none';
      return;
    }
    countEl.textContent=chars.length+' character'+(chars.length===1?'':'s')+(filterDesc?' — '+filterDesc:'');
    countEl.style.display='inline';
    grid.innerHTML='';
    const gridEl=document.createElement('div');gridEl.className='char-lib-grid';
    chars.forEach(ch=>{
      const card=document.createElement('div');
      card.className='char-lib-card';
      card.id='charlib-card-'+ch.id;
      const hasImg=ch.media_url&&ch.media_url.trim();
      card.innerHTML=`
        <div class="char-lib-img-wrap">
          ${hasImg
            ?`<img class="char-lib-img" src="${ch.media_url}" alt="${(ch.answer||'').replace(/"/g,'&quot;')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            :''}
          <div class="char-lib-no-img" style="display:${hasImg?'none':'flex'};width:100%;height:100%;align-items:center;justify-content:center">🎭</div>
          <input type="checkbox" class="char-lib-cb" title="Select" onchange="toggleCharLibSelect('${(ch.answer||'').replace(/'/g,"\\'")}','${(ch.topic_value||'').replace(/'/g,"\\'")}',this)">
          <button class="char-lib-edit-fab" title="Edit character" onclick="openCharEdit('${ch.id}')"><i class="ti ti-pencil"></i></button>
        </div>
        <div class="char-lib-body">
          <div class="char-lib-name">${ch.answer||'—'}</div>
          <div class="char-lib-topic">${ch.topic_value||ch.topic_type||'—'}</div>
          <div class="char-lib-aliases${_charLibShowAliases?' visible':''}">${(ch.aliases||[]).length?ch.aliases.map(a=>`<span class="char-lib-alias-tag">${a}</span>`).join(''):'<span style="font-size:10px;color:var(--muted);font-style:italic">No aliases</span>'}</div>
          <button class="char-lib-del" onclick="removeCharacter('${ch.id}','${(ch.answer||'').replace(/'/g,"\\'")}','${(ch.topic_value||'').replace(/'/g,"\\'")}')">
            <i class="ti ti-trash" style="font-size:12px"></i> Remove
          </button>
        </div>`;
      gridEl.appendChild(card);
    });
    grid.appendChild(gridEl);
    const aliasToggleBtn=document.getElementById('charLibAliasToggle');
    if(aliasToggleBtn)aliasToggleBtn.style.display='inline-flex';
  }catch(e){
    grid.innerHTML='<div class="char-lib-empty">⚠️ Couldn\'t load characters. Check your connection and try again.</div>';
  }
  applyTheme();
}

async function removeCharacter(id,name,topic){
  requireAdminUnlock(async()=>{
    if(!confirm(`Delete all questions for "${name}"${topic?' ('+topic+')':''}?\n\nThis will permanently delete every question linked to this character. This cannot be undone.`))return;
    // Delete all questions with this character name (same answer) and format=char for this topic
    const{error}=await sb.from('questions').delete().eq('format','char').eq('answer',name).eq('topic_value',topic);
    if(error){showAdminToast('⚠️ Delete failed. Try again.');return;}
    // Remove the card from the DOM
    const card=document.getElementById('charlib-card-'+id);if(card)card.remove();
    // Update count label
    const grid=document.getElementById('charLibGrid');
    const remaining=grid.querySelectorAll('.char-lib-card').length;
    const countEl=document.getElementById('charLibCount');
    if(remaining===0){
      grid.innerHTML='<div class="char-lib-empty">🎭 No characters left for this topic.</div>';
      countEl.style.display='none';
    } else {
      countEl.textContent=remaining+' character'+(remaining===1?'':'s')+(topic?' in '+topic:'');
    }
    showAdminToast('"'+name+'" removed 🗑️');
    _charLibOverviewData=null; // counts/grouping may have changed
    renderAdminStats();
  });
}

// ── CHARACTER LIBRARY: BULK ACTIONS ────────────────────────────────────
// Selection is keyed by "answer|||topic_value" so bulk edits/deletes apply
// to every approved char question for that character, same scope as the
// single-character edit modal.
let charLibSelected=new Map();
let _charLibShowAliases=false;
function toggleCharLibAliases(){
  _charLibShowAliases=!_charLibShowAliases;
  document.querySelectorAll('.char-lib-aliases').forEach(el=>el.classList.toggle('visible',_charLibShowAliases));
  const btn=document.getElementById('charLibAliasToggle');
  if(btn){
    btn.innerHTML=`<i class="ti ti-tags" style="font-size:13px"></i> ${_charLibShowAliases?'Hide':'Show'} Aliases`;
    btn.style.color=_charLibShowAliases?'var(--accent)':'var(--muted)';
    btn.style.borderColor=_charLibShowAliases?'var(--accent)':'var(--border2)';
  }
}

function toggleCharLibSelect(answer,topic,el){
  const key=answer+'|||'+topic;
  const card=el.closest('.char-lib-card');
  if(el.checked){charLibSelected.set(key,{answer,topic});card.classList.add('char-lib-selected');}
  else{charLibSelected.delete(key);card.classList.remove('char-lib-selected');}
  updateCharLibBulkBar();
}

function clearCharLibSelection(){
  charLibSelected.clear();
  document.querySelectorAll('.char-lib-cb').forEach(cb=>{
    cb.checked=false;
    const card=cb.closest('.char-lib-card');if(card)card.classList.remove('char-lib-selected');
  });
  updateCharLibBulkBar();
}

function updateCharLibBulkBar(){
  const wrap=document.getElementById('charLibBulkBarWrap');
  if(!wrap)return;
  if(charLibSelected.size===0){wrap.innerHTML='';return;}
  const n=charLibSelected.size;
  wrap.innerHTML='<div class="admin-bulk-bar">'
    +'<span class="admin-bulk-bar-count">'+n+' character'+(n===1?'':'s')+' selected</span>'
    +'<span style="font-size:12px;font-weight:800;color:var(--muted)">Set gender:</span>'
    +'<button class="admin-bulk-btn" onclick="bulkSetCharGender(\'Male\')">Male</button>'
    +'<button class="admin-bulk-btn" onclick="bulkSetCharGender(\'Female\')">Female</button>'
    +'<button class="admin-bulk-btn" onclick="bulkSetCharGender(\'Non-binary\')">Non-binary</button>'
    +'<button class="admin-bulk-btn danger" onclick="bulkDeleteCharacters()"><i class="ti ti-trash" style="font-size:13px"></i> Delete</button>'
    +'<button class="admin-bulk-btn" onclick="clearCharLibSelection()" style="margin-left:auto"><i class="ti ti-x" style="font-size:13px"></i> Cancel</button>'
    +'</div>';
  applyTheme();
}

async function bulkSetCharGender(gender){
  if(!charLibSelected.size)return;
  requireAdminUnlock(async()=>{
    const items=[...charLibSelected.values()];
    if(!confirm(`Set gender to "${gender}" for ${items.length} character${items.length===1?'':'s'}?`))return;
    let failures=0;
    for(const{answer,topic}of items){
      const{error}=await sb.from('questions').update({gender})
        .eq('format','char').eq('status','approved').eq('topic_value',topic).eq('answer',answer);
      if(error)failures++;
    }
    showAdminToast(failures
      ?`⚠️ Updated ${items.length-failures}/${items.length} (${failures} failed)`
      :`Gender set to "${gender}" for ${items.length} character${items.length===1?'':'s'} ✏️`);
    fetchCharLibrary();
  });
}

async function bulkDeleteCharacters(){
  if(!charLibSelected.size)return;
  requireAdminUnlock(async()=>{
    const items=[...charLibSelected.values()];
    const names=items.map(i=>i.answer).join(', ');
    if(!confirm(`Delete ${items.length} character${items.length===1?'':'s'} and ALL their questions?\n\n${names}\n\nThis cannot be undone.`))return;
    let failures=0;
    for(const{answer,topic}of items){
      const{error}=await sb.from('questions').delete().eq('format','char').eq('answer',answer).eq('topic_value',topic);
      if(error)failures++;
    }
    showAdminToast(failures
      ?`⚠️ Deleted ${items.length-failures}/${items.length} (${failures} failed)`
      :`${items.length} character${items.length===1?'':'s'} removed 🗑️`);
    _charLibOverviewData=null; // counts/grouping may have changed
    fetchCharLibrary();
    renderAdminStats();
  });
}


let ceEditId=null,ceOrig=null;

async function openCharEdit(id){
  // Fetch the full row fresh so edits always start from current data
  let q=null,err=null;
  try{
    const{data,error}=await sb.from('questions').select('id,answer,aliases,gender,distractors,media_url,topic_value,topic_type').eq('id',id).single();
    q=data;err=error;
  }catch(e){err=e;}
  if(!q){
    console.error('openCharEdit failed:',err);
    showAdminToast('⚠️ Could not load character — '+(err&&err.message?err.message:'try again.'));
    return;
  }
  ceEditId=id;ceOrig=q;
  document.getElementById('ceAnswer').value=q.answer||'';
  document.getElementById('ceGender').value=q.gender||'';
  document.getElementById('ceTopic').value=q.topic_value||'General';
  document.getElementById('ceAliases').value=(q.aliases||[]).join(', ');
  document.getElementById('ceDistractors').value=(q.distractors||[]).join(', ');
  document.getElementById('ceMediaUrl').value=q.media_url||'';
  ceImagePreview();
  document.getElementById('ceScopeNote').textContent='Name, gender, aliases & distractors update every approved "'+(q.answer||'character')+'" question in '+(q.topic_value||'this topic')+'. The image only changes this entry.';
  document.getElementById('ceErr').style.display='none';
  document.getElementById('charEditModal').style.display='flex';
  applyTheme();
}

function closeCharEdit(){document.getElementById('charEditModal').style.display='none';ceEditId=null;ceOrig=null;}

function ceImagePreview(){
  const url=document.getElementById('ceMediaUrl').value.trim();
  const wrap=document.getElementById('ceImgPreviewWrap');
  const img=document.getElementById('ceImgPreview');
  if(url){img.src=url;wrap.style.display='flex';}else{wrap.style.display='none';img.src='';}
}

async function saveCharEdit(){
  if(!ceEditId||!ceOrig)return;
  requireAdminUnlock(async()=>{
    const showErrLocal=(m)=>{const e=document.getElementById('ceErr');e.textContent=m;e.style.display='block';};
    const answer=document.getElementById('ceAnswer').value.trim();
    const gender=document.getElementById('ceGender').value||null;
    const aliases=document.getElementById('ceAliases').value.split(',').map(a=>a.trim()).filter(Boolean);
    const distractors=document.getElementById('ceDistractors').value.split(',').map(a=>a.trim()).filter(Boolean);
    const media_url=document.getElementById('ceMediaUrl').value.trim()||null;
    if(!answer)return showErrLocal('Please enter the character name.');
    const btn=document.querySelector('#charEditModal .action-btn.primary');
    if(btn){btn.disabled=true;btn.style.opacity='.6';}
    let error;
    try{
      // Name, gender, aliases & distractors apply to every approved char
      // question for this character within the same topic, so identity
      // stays consistent across all of its question rows.
      ({error}=await sb.from('questions').update({answer,gender,aliases,distractors})
        .eq('format','char').eq('status','approved')
        .eq('topic_value',ceOrig.topic_value).eq('answer',ceOrig.answer));
      // Image only applies to this specific question/row
      if(!error&&media_url!==(ceOrig.media_url||null)){
        ({error}=await sb.from('questions').update({media_url}).eq('id',ceEditId));
      }
    }catch(e){error=e;}
    if(btn){btn.disabled=false;btn.style.opacity='1';}
    if(error)return showErrLocal('Could not save — try again.');
    showAdminToast('"'+answer+'" updated ✏️');
    closeCharEdit();
    _charLibOverviewData=null; // counts/grouping may have changed
    fetchCharLibrary();
    renderAdminStats();
  });
}

async function actionAdminSuggestion(id){
  const topic=document.getElementById('sugg-topic-'+id)?.value.trim();
  const type=document.getElementById('sugg-type-'+id)?.value;
  if(!topic)return;
  // Persist to topics table so it survives refresh and appears in coverage
  await sb.from('topics').upsert({name:topic,type,status:'approved'},{onConflict:'name',ignoreDuplicates:false});
  if(type==='anime')fetchAndSavePoster(topic);
  // Update in-memory lists immediately so coverage re-renders without a full reload
  if(type==='anime'&&!ADMIN_ANIME_TOPICS.includes(topic)){ADMIN_ANIME_TOPICS.push(topic);ADMIN_ANIME_TOPICS.sort((a,b)=>a.localeCompare(b));}
  if(type==='genre'&&!ADMIN_GENRE_TOPICS.includes(topic)){ADMIN_GENRE_TOPICS.push(topic);ADMIN_GENRE_TOPICS.sort((a,b)=>a.localeCompare(b));}
  // Check if this suggestion has a user_id (i.e. was submitted by a registered user after the feature was added)
  const{data:suggData}=await sb.from('topic_suggestions').select('user_id').eq('id',id);
  const hasUserId=suggData&&suggData[0]&&suggData[0].user_id;
  if(hasUserId){
    // Update with status + optional reply so the player sees it in their inbox
    const replyVal=(document.getElementById('sugg-reply-'+id)?.value||'').trim();
    const updatePayload={status:'added',replied_at:new Date().toISOString(),read_at:null};
    if(replyVal)updatePayload.reply=replyVal;
    await sb.from('topic_suggestions').update(updatePayload).eq('id',id);
  } else {
    // Legacy row — no user_id, safe to delete
    await sb.from('topic_suggestions').delete().eq('id',id);
  }
  // Remove from DOM
  const row=document.getElementById('sugg-row-'+id);
  if(row)row.remove();
  const wrap=document.getElementById('adminSuggestions');
  if(wrap&&!wrap.querySelector('.admin-cov-row')){
    wrap.innerHTML='<div class="admin-empty" style="color:var(--muted)">No topic suggestions yet.</div>';
  }
  const suggBadge=document.getElementById('adminCountSuggestions');
  if(suggBadge){const n=Math.max(0,(parseInt(suggBadge.textContent)||1)-1);suggBadge.textContent=n;suggBadge.style.display=n>0?'inline-flex':'none';}
  // Re-render coverage so the new topic shows up immediately
  if(document.getElementById('adminCoverage').style.display!=='none')renderAdminCoverage();
  // Toast confirmation
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-family:Lilita One,cursive;font-size:14px;padding:12px 24px;border-radius:99px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3)';
  toast.textContent='"'+topic+'" added to '+type+' topics ✓';
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(),3000);
}

async function dismissAdminSuggestion(id){
  // Check if this suggestion has a user_id
  const{data:suggData}=await sb.from('topic_suggestions').select('user_id').eq('id',id);
  const hasUserId=suggData&&suggData[0]&&suggData[0].user_id;
  if(hasUserId){
    const replyVal=(document.getElementById('sugg-reply-'+id)?.value||'').trim();
    const updatePayload={status:'dismissed',replied_at:new Date().toISOString(),read_at:null};
    if(replyVal)updatePayload.reply=replyVal;
    const{error}=await sb.from('topic_suggestions').update(updatePayload).eq('id',id);
    if(error){alert('Could not dismiss. Try again.');return;}
  } else {
    const{error}=await sb.from('topic_suggestions').delete().eq('id',id);
    if(error){alert('Could not dismiss. Try again.');return;}
  }
  const row=document.getElementById('sugg-row-'+id);
  if(row)row.remove();
  const wrap=document.getElementById('adminSuggestions');
  if(wrap&&!wrap.querySelector('.admin-cov-row')){
    wrap.innerHTML='<div class="admin-empty" style="color:var(--muted)">No topic suggestions yet.</div>';
  }
  const suggBadge=document.getElementById('adminCountSuggestions');
  if(suggBadge){const n=Math.max(0,(parseInt(suggBadge.textContent)||1)-1);suggBadge.textContent=n;suggBadge.style.display=n>0?'inline-flex':'none';}
}

let covSelectedTopics=new Set();
function toggleCovRow(name,el){
  const row=el.closest('.admin-cov-row');
  if(el.checked){covSelectedTopics.add(name);row.classList.add('cov-selected');}
  else{covSelectedTopics.delete(name);row.classList.remove('cov-selected');}
  updateCovBulkBar();
}
function updateCovBulkBar(){
  let bar=document.getElementById('covBulkBar');
  if(covSelectedTopics.size===0){if(bar)bar.remove();return;}
  if(!bar){
    bar=document.createElement('div');bar.id='covBulkBar';bar.className='admin-bulk-bar';
    const wrap=document.getElementById('covBulkBarWrap');wrap.appendChild(bar);
  }
  bar.innerHTML='<span class="admin-bulk-bar-count">'+covSelectedTopics.size+' topic'+(covSelectedTopics.size===1?'':'s')+' selected</span>'
    +'<button class="admin-bulk-btn danger" onclick="deleteCovTopics()"><i class="ti ti-trash" style="font-size:13px"></i> Delete selected</button>'
    +'<button class="admin-bulk-btn" onclick="clearCovSelection()"><i class="ti ti-x" style="font-size:13px"></i> Cancel</button>';
}
function clearCovSelection(){
  covSelectedTopics.clear();
  document.querySelectorAll('.cov-cb').forEach(cb=>{cb.checked=false;cb.closest('.admin-cov-row').classList.remove('cov-selected');});
  updateCovBulkBar();
}
function deleteCovTopics(){
  if(!covSelectedTopics.size)return;
  const names=[...covSelectedTopics];
  const preview=names.slice(0,3).map(n=>'"'+n+'"').join(', ')+(names.length>3?' and '+(names.length-3)+' more':'');
  document.getElementById('covDeleteModalCount').textContent=names.length+' topic'+(names.length===1?'':'s');
  document.getElementById('covDeleteModalPreview').textContent=preview;
  const m=document.getElementById('covDeleteModal');m.style.display='flex';applyTheme();
}
function closeCovDeleteModal(){
  document.getElementById('covDeleteModal').style.display='none';
}
async function confirmCovDelete(){
  closeCovDeleteModal();
  const names=[...covSelectedTopics];
  const{error}=await sb.from('topics').delete().in('name',names);
  if(error){alert('Delete failed: '+error.message);return;}
  names.forEach(n=>{
    const idx=ADMIN_ANIME_TOPICS.indexOf(n);if(idx>-1)ADMIN_ANIME_TOPICS.splice(idx,1);
    const idx2=ADMIN_GENRE_TOPICS.indexOf(n);if(idx2>-1)ADMIN_GENRE_TOPICS.splice(idx2,1);
  });
  covSelectedTopics.clear();
  renderAdminCoverage();
}
function openAddTopicModal(){
  const m=document.getElementById('addTopicModal');
  document.getElementById('addTopicName').value='';
  document.getElementById('addTopicType').value='anime';
  document.getElementById('addTopicErr').style.display='none';
  const btn=document.getElementById('addTopicConfirmBtn');
  btn.disabled=false;btn.innerHTML='<i class="ti ti-check" style="font-size:15px"></i> Add Topic';
  m.style.display='flex';applyTheme();
  setTimeout(()=>document.getElementById('addTopicName').focus(),80);
}
function closeAddTopicModal(){
  document.getElementById('addTopicModal').style.display='none';
}
async function confirmAddTopic(){
  const topic=document.getElementById('addTopicName').value.trim();
  const type=document.getElementById('addTopicType').value;
  const errWrap=document.getElementById('addTopicErr');
  const errMsg=document.getElementById('addTopicErrMsg');
  errWrap.style.display='none';
  if(!topic){errMsg.textContent='Please enter a topic name.';errWrap.style.display='flex';return;}
  const isDup=(type==='anime'?ADMIN_ANIME_TOPICS:ADMIN_GENRE_TOPICS).some(t=>t.toLowerCase()===topic.toLowerCase());
  if(isDup){errMsg.textContent='"'+topic+'" already exists in '+type+' topics.';errWrap.style.display='flex';return;}
  const btn=document.getElementById('addTopicConfirmBtn');
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="font-size:15px"></i> Saving…';
  const{error}=await sb.from('topics').upsert({name:topic,type,status:'approved'},{onConflict:'name',ignoreDuplicates:false});
  if(error){btn.disabled=false;btn.innerHTML='<i class="ti ti-check" style="font-size:15px"></i> Add Topic';errMsg.textContent='Save failed: '+error.message;errWrap.style.display='flex';return;}
  if(type==='anime')fetchAndSavePoster(topic);
  if(type==='anime'&&!ADMIN_ANIME_TOPICS.includes(topic)){ADMIN_ANIME_TOPICS.push(topic);ADMIN_ANIME_TOPICS.sort((a,b)=>a.localeCompare(b));}
  if(type==='genre'&&!ADMIN_GENRE_TOPICS.includes(topic)){ADMIN_GENRE_TOPICS.push(topic);ADMIN_GENRE_TOPICS.sort((a,b)=>a.localeCompare(b));}
  closeAddTopicModal();
  renderAdminCoverage();
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-family:Lilita One,cursive;font-size:14px;padding:12px 24px;border-radius:99px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3)';
  toast.textContent='"'+topic+'" added to '+type+' topics ✓';
  document.body.appendChild(toast);setTimeout(()=>toast.remove(),3000);
}

// ── ROMANIZE TOOL ────────────────────────────────────────────────
function _romanizeStr(s){return s.replace(/ou/gi,m=>m[0]==='O'?'O':'o').replace(/uu/gi,m=>m[0]==='U'?'U':'u');}
function _romanizeNeedsChange(s){return /ou|uu/i.test(s);}

let _romanizeTopicSuggestIdx=-1;
function _romanizeTopicSuggest(){
  const inp=document.getElementById('romanizeTopicInput');
  const drop=document.getElementById('romanizeTopicDrop');
  const clearBtn=document.getElementById('romanizeTopicClear');
  if(!inp||!drop)return;
  clearBtn.style.display=inp.value?'block':'none';
  const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q=normalize(inp.value.trim());
  if(q.length<3){drop.classList.remove('open');drop.innerHTML='';_romanizeTopicSuggestIdx=-1;return;}
  const anime=ADMIN_ANIME_TOPICS.filter(t=>normalize(t).includes(q));
  const genre=ADMIN_GENRE_TOPICS.filter(t=>normalize(t).includes(q));
  if(!anime.length&&!genre.length){drop.classList.remove('open');drop.innerHTML='';return;}
  let html='';
  if(anime.length){html+='<div class="admin-topic-suggest-group">📺 Anime</div>';anime.forEach(t=>{html+=`<div class="admin-topic-suggest-item" onmousedown="_romanizeTopicPick('${t.replace(/'/g,"\\'")}')">  ${t}</div>`;});}
  if(genre.length){html+='<div class="admin-topic-suggest-group">🎭 Genre</div>';genre.forEach(t=>{html+=`<div class="admin-topic-suggest-item" onmousedown="_romanizeTopicPick('${t.replace(/'/g,"\\'")}')">  ${t}</div>`;});}
  drop.innerHTML=html;drop.classList.add('open');_romanizeTopicSuggestIdx=-1;
}
function _romanizeTopicPick(val){
  const inp=document.getElementById('romanizeTopicInput');
  if(inp)inp.value=val;
  document.getElementById('romanizeTopicClear').style.display='block';
  document.getElementById('romanizeTopicDrop').classList.remove('open');
  document.getElementById('romanizeTopicDrop').innerHTML='';
  _romanizeTopicSuggestIdx=-1;
}
function _romanizeTopicBlur(){setTimeout(()=>{document.getElementById('romanizeTopicDrop').classList.remove('open');document.getElementById('romanizeTopicDrop').innerHTML='';},150);}
function _romanizeTopicKey(e){
  const drop=document.getElementById('romanizeTopicDrop');
  if(!drop||!drop.classList.contains('open'))return;
  const items=[...drop.querySelectorAll('.admin-topic-suggest-item')];
  if(!items.length)return;
  if(e.key==='ArrowDown'){e.preventDefault();_romanizeTopicSuggestIdx=Math.min(_romanizeTopicSuggestIdx+1,items.length-1);}
  else if(e.key==='ArrowUp'){e.preventDefault();_romanizeTopicSuggestIdx=Math.max(_romanizeTopicSuggestIdx-1,0);}
  else if(e.key==='Enter'&&_romanizeTopicSuggestIdx>=0){e.preventDefault();_romanizeTopicPick(items[_romanizeTopicSuggestIdx].textContent.trim());return;}
  else if(e.key==='Escape'){drop.classList.remove('open');drop.innerHTML='';return;}
  else return;
  items.forEach((el,i)=>el.classList.toggle('focused',i===_romanizeTopicSuggestIdx));
  items[_romanizeTopicSuggestIdx]?.scrollIntoView({block:'nearest'});
}

let _romanizeCandidates=[];
async function fetchRomanizeCandidates(){
  const topic=(document.getElementById('romanizeTopicInput')?.value||'').trim();
  const includeAliases=document.getElementById('romanizeIncludeAliases')?.checked!==false;
  const status=document.getElementById('romanizeStatus');
  const results=document.getElementById('romanizeResults');
  const bar=document.getElementById('romanizeConfirmBar');
  if(!topic){status.textContent='Please select a topic first.';return;}
  status.textContent='Searching…';results.innerHTML='';bar.style.display='none';_romanizeCandidates=[];
  const{data,error}=await sb.from('questions').select('id,answer,aliases').eq('format','char').eq('topic_value',topic);
  if(error){status.textContent='Error: '+error.message;return;}
  if(!data||!data.length){status.textContent='No char questions found for "'+topic+'".';return;}
  _romanizeCandidates=data.map(q=>{
    const aliases=Array.isArray(q.aliases)?q.aliases:(typeof q.aliases==='string'&&q.aliases?q.aliases.split(',').map(s=>s.trim()):[]);
    const answerChanged=_romanizeNeedsChange(q.answer);
    const aliasChanges=aliases.map(a=>({original:a,romanized:_romanizeStr(a),changed:_romanizeNeedsChange(a)}));
    return {id:q.id,answer:q.answer,answerRomanized:_romanizeStr(q.answer),answerChanged,aliases,aliasChanges,selected:true};
  }).filter(r=>r.answerChanged||(includeAliases&&r.aliasChanges.some(a=>a.changed)));
  if(!_romanizeCandidates.length){status.textContent='✓ No romanization needed for "'+topic+'" — all names look clean.';return;}
  status.textContent=_romanizeCandidates.length+' candidate'+(_romanizeCandidates.length!==1?'s':'')+' found in "'+topic+'".';
  renderRomanizeResults();
}
function renderRomanizeResults(){
  const results=document.getElementById('romanizeResults');
  const bar=document.getElementById('romanizeConfirmBar');
  const countEl=document.getElementById('romanizeConfirmCount');
  const includeAliases=document.getElementById('romanizeIncludeAliases')?.checked!==false;
  if(!_romanizeCandidates.length){results.innerHTML='';bar.style.display='none';return;}
  let html='';
  _romanizeCandidates.forEach((r,i)=>{
    const answerHtml=r.answerChanged
      ?`<span style="color:var(--muted)">${r.answer}</span> <i class="ti ti-arrow-right" style="font-size:11px;color:var(--muted)"></i> <span style="color:#4ade80;font-weight:800">${r.answerRomanized}</span>`
      :`<span>${r.answer}</span>`;
    const aliasRows=includeAliases?r.aliasChanges.filter(a=>a.changed).map(a=>
      `<span style="font-size:12px;color:var(--muted)">${a.original} <i class="ti ti-arrow-right" style="font-size:10px"></i> <span style="color:#4ade80">${a.romanized}</span></span>`
    ).join(''):'';
    html+=`<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:var(--bg2);border:1px solid var(--border2);border-radius:11px">
      <input type="checkbox" ${r.selected?'checked':''} onchange="_romanizeToggle(${i},this.checked)" style="margin-top:3px;accent-color:var(--accent);width:15px;height:15px;flex-shrink:0;cursor:pointer">
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
        <div style="font-size:14px;font-weight:800;font-family:'Nunito',sans-serif;color:var(--text)">${answerHtml}</div>
        ${aliasRows?`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:2px">${aliasRows}</div>`:''}
      </div>
    </div>`;
  });
  results.innerHTML=html;
  const sel=_romanizeCandidates.filter(r=>r.selected).length;
  bar.style.display=sel?'flex':'none';
  countEl.textContent=sel+' of '+_romanizeCandidates.length+' selected';
}
function _romanizeToggle(i,checked){
  if(_romanizeCandidates[i])_romanizeCandidates[i].selected=checked;
  const sel=_romanizeCandidates.filter(r=>r.selected).length;
  const bar=document.getElementById('romanizeConfirmBar');
  bar.style.display=sel?'flex':'none';
  document.getElementById('romanizeConfirmCount').textContent=sel+' of '+_romanizeCandidates.length+' selected';
}
async function confirmRomanize(){
  const includeAliases=document.getElementById('romanizeIncludeAliases')?.checked!==false;
  const toSave=_romanizeCandidates.filter(r=>r.selected);
  if(!toSave.length)return;
  const btn=document.getElementById('romanizeConfirmBtn');
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="font-size:14px"></i> Saving…';
  let saved=0,failed=0;
  for(const r of toSave){
    const newAnswer=r.answerChanged?r.answerRomanized:r.answer;
    const newAliases=includeAliases?r.aliasChanges.map(a=>a.changed?a.romanized:a.original):r.aliases;
    const{error}=await sb.from('questions').update({answer:newAnswer,aliases:newAliases.length?newAliases:r.aliases}).eq('id',r.id);
    if(error)failed++;else{r.selected=false;saved++;}
  }
  btn.disabled=false;btn.innerHTML='<i class="ti ti-check" style="font-size:14px"></i> Confirm &amp; Save';
  const status=document.getElementById('romanizeStatus');
  status.textContent=saved+' saved'+(failed?', '+failed+' failed.':'.');
  const topic=(document.getElementById('romanizeTopicInput')?.value||'').trim();
  if(topic)fetchRomanizeCandidates();
}
// ── END ROMANIZE TOOL ────────────────────────────────────────────

// ── ANSWER LEAKS TOOL ────────────────────────────────────────────
// Finds questions whose own wording contains a significant word from their answer —
// e.g. a question about "Log Pose" that literally says "log pose" in the question text.
// Common function words and very short words are ignored so nearly every question
// doesn't get flagged just for sharing "the" or "a" with its answer.
const LEAK_STOPWORDS=new Set(['the','a','an','of','in','on','at','is','are','was','were','to','for','and',
  'or','what','who','which','whom','whose','does','do','did','this','that','these','those','from','by',
  'as','it','its','his','her','hers','their','theirs','our','ours','your','yours','my','mine','name',
  'named','call','called','term','known','also','be','been','being','has','have','had','will','would',
  'can','could','should','not','no','yes','you','we','they','he','she','him','them','us','one','two',
  'three','first','second','third','into','out','up','down','over','under','than','then','so','such',
  'if','when','where','why','how','all','any','some','each','every','other','another','more','most',
  'many','much','few','little','only','just','both','either','neither','with','used','use']);
function _leakWords(s){return (s||'').toLowerCase().match(/[a-z0-9']+/g)||[];}
function _leakSignificantWords(s){return [...new Set(_leakWords(s).filter(w=>w.length>=3&&!LEAK_STOPWORDS.has(w)))];}
function _leakAnswerText(q){
  if(q.options&&Array.isArray(q.options)){
    const idx=parseInt(q.answer);
    return q.options[idx]!=null?String(q.options[idx]):'';
  }
  return q.answer!=null?String(q.answer):'';
}
function _leakFindMatches(question,answerText){
  const answerWords=_leakSignificantWords(answerText);
  if(!answerWords.length)return [];
  const qText=question||'';
  return answerWords.filter(w=>new RegExp('\\b'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(qText));
}
function _leakHL(text,matches){
  if(!matches.length)return text;
  const pattern=matches.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  return String(text).replace(new RegExp('\\b('+pattern+')\\b','gi'),'<mark class="leak-hl">$1</mark>');
}
let _leakCandidates=[];
async function fetchLeakCandidates(){
  const statusFilter=document.getElementById('leaksStatusFilter')?.value||'approved';
  const formatFilter=document.getElementById('leaksFormatFilter')?.value||'';
  const status=document.getElementById('leaksStatus');
  const results=document.getElementById('leaksResults');
  status.textContent='Scanning…';results.innerHTML='';_leakCandidates=[];
  try{
    let q=sb.from('questions').select('id,question,answer,options,aliases,format,status,topic_value,difficulty,media_url');
    if(statusFilter!=='all')q=q.eq('status',statusFilter);
    if(formatFilter)q=q.eq('format',formatFilter);
    const {data,error}=await q.limit(5000);
    if(error)throw error;
    const rows=data||[];
    _leakCandidates=rows.map(row=>{
      const answerText=_leakAnswerText(row);
      const matches=_leakFindMatches(row.question,answerText);
      return matches.length?Object.assign({},row,{_answerText:answerText,_matches:matches}):null;
    }).filter(Boolean);
    if(!_leakCandidates.length){
      status.textContent='✓ No leaks found — every answer stays hidden in its own question ('+rows.length+' scanned).';
      return;
    }
    status.textContent=_leakCandidates.length+' of '+rows.length+' questions may be leaking their answer.';
    renderLeakResults();
  }catch(e){
    status.textContent='Could not scan questions.';
  }
}
function renderLeakResults(){
  const results=document.getElementById('leaksResults');
  const fmtLabel={mc:'Multiple Choice',type:'Type Answer',scene:'Guess the Scene',char:'Name Character'};
  results.innerHTML='';
  _leakCandidates.forEach(q=>{
    const card=document.createElement('div');
    card.className='admin-q-card';
    card.id=`adminCard_${q.id}`;
    // Mirrors buildAdminCard's dataset shape so the existing Preview modal works unmodified.
    card.dataset.q=JSON.stringify({id:q.id,question:q.question,format:q.format,options:q.options||null,answer:q.answer,topic_value:q.topic_value||null,difficulty:q.difficulty||'normal',media_url:q.media_url||null});
    const matchBadges=q._matches.map(w=>`<span class="admin-badge" style="background:rgba(248,113,113,.1);border-color:#f87171;color:#f87171">${w}</span>`).join('');
    const optionsHtml=q.options?`<div style="font-size:12px;color:var(--muted);margin-top:4px">${q.options.map((o,i)=>`<span style="${String(i)===String(q.answer)?'color:var(--accent);font-weight:800':''}">${String.fromCharCode(65+i)}. ${_leakHL(o,q._matches)}</span>`).join(' · ')}</div>`:'';
    const answerHtml=!q.options?`<div style="font-size:12px;color:var(--accent);margin-top:4px;font-weight:800">Answer: ${_leakHL(q._answerText,q._matches)}</div>`:'';
    card.innerHTML=`
      <div>
        <div class="admin-q-text">${_leakHL(q.question,q._matches)}</div>
        ${optionsHtml}${answerHtml}
      </div>
      <div class="admin-q-meta">
        <span class="admin-badge format">${fmtLabel[q.format]||q.format}</span>
        <span class="admin-badge">${q.topic_value||'General'}</span>
        <span class="admin-badge${q.status==='pending'?' reported':''}">${q.status}</span>
        ${matchBadges}
      </div>
      <div class="admin-actions">
        <button class="admin-btn edit" onclick="openAdminEdit('${q.id}')"><i class="ti ti-pencil" style="font-size:12px"></i> Edit</button>
        <button class="admin-btn edit" onclick="openAdminPreview('${q.id}')" title="Preview how this question looks in-game"><i class="ti ti-eye" style="font-size:12px"></i> Preview</button>
      </div>`;
    results.appendChild(card);
  });
  applyTheme();
}
// ── END ANSWER LEAKS TOOL ────────────────────────────────────────

function renderAdminCoverage(){
  covSelectedTopics.clear();updateCovBulkBar();
  const cov=document.getElementById('adminCoverage');
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const approved=adminLite.filter(q=>q.status==='approved');
  const tally=name=>{const qs=approved.filter(q=>(q.topic_value||'')===name);const c=f=>qs.filter(q=>q.format===f).length;return{name,total:qs.length,mc:c('mc'),type:c('type'),char:c('char'),scene:c('scene')};};
  const state=t=>t.total===0?'empty':(t.total<ADMIN_COV_THIN?'thin':'ok');
  const anime=ADMIN_ANIME_TOPICS.map(tally),genre=ADMIN_GENRE_TOPICS.map(tally);
  const known=new Set([...ADMIN_ANIME_TOPICS,...ADMIN_GENRE_TOPICS,'']);
  const extras=[...new Set(approved.map(q=>q.topic_value).filter(v=>v&&!known.has(v)))].map(tally);
  const withP=anime.filter(t=>(ADMIN_POSTERS[t.name]||[]).length).length;
  const maxT=Math.max(ADMIN_COV_THIN*3,...anime.map(t=>t.total),...genre.map(t=>t.total));
  const pass=(t,kind)=>covFilter==='all'||covFilter===state(t)||(covFilter==='noposter'&&kind==='anime'&&!(ADMIN_POSTERS[t.name]||[]).length);
  const ic=(fn,icon,label)=>'<button class="cv-ic" onclick="'+fn+'" title="'+label+'"><i class="ti '+icon+'"></i></button>';
  const row=(t,kind)=>{
    const st=state(t),key=t.name,gen=kind==='general';
    const pl=ADMIN_POSTERS[t.name]||[],p=pl[0];
    const thumb=kind==='anime'?(p?'<button class="cv-thumb" style="background-image:url(&quot;'+esc(p)+'&quot;)" onclick="covPosterMenu(this)" title="Click to enlarge'+(pl.some(u=>!isOwnPoster(u))?' · not stored on your site yet':'')+'">'+(pl.length>1?'<span class="cv-pc">'+pl.length+'</span>':'')+(pl.some(u=>!isOwnPoster(u))?'<span class="cv-ext"></span>':'')+'</button>':'<button class="cv-thumb none" onclick="covFetchOne(this)" title="No poster — click to fetch from MyAnimeList"><i class="ti ti-photo-off"></i></button>'):'<span class="cv-thumb blank"><i class="ti '+(gen?'ti-world':'ti-masks-theater')+'"></i></span>';
    const act=(gen?'':ic('coverageJumpToBrowse(covName(this))','ti-eye','View questions'))
      +(!gen&&t.char>0?ic('coverageJumpToCharacters(covName(this))','ti-user-circle','Characters'):'')
      +ic("openPromptGenerator(covName(this),'"+(kind==='genre'?'genre':'anime')+"')",'ti-wand','Prompt generator')
      +(t.total>0?ic(gen?"exportTopicQuestions('__general__')":'exportTopicQuestions(covName(this))','ti-download','Export'):'');
    return '<div class="admin-cov-row cv-row '+st+'" data-name="'+esc(key)+'">'
      +(gen?'<span style="width:16px"></span>':'<input type="checkbox" class="cov-cb" onchange="toggleCovRow(covName(this),this)">')
      +thumb
      +'<div class="cv-nm"><b>'+esc(t.name)+'</b><small>'+[['mc',t.mc],['tta',t.type],['char',t.char],['scene',t.scene]].map(([f,n])=>'<span class="cv-f cvf-'+f+(n?'':' z')+'"><i></i>'+n+'</span>').join('')+'</small></div>'
      +'<div class="cv-bar" title="MC '+t.mc+' · Type the Answer '+t.type+' · Name the Character '+t.char+' · Guess the Scene '+t.scene+'"><span style="width:'+Math.min(100,Math.round(t.total/(gen?Math.max(1,t.total):maxT)*100))+'%">'+[['mc',t.mc],['tta',t.type],['char',t.char],['scene',t.scene]].filter(([,n])=>n).map(([f,n])=>'<i class="cvf-'+f+'" style="flex:'+n+'"></i>').join('')+'</span></div>'
      +'<span class="cv-n">'+t.total+'</span>'
      +'<div class="cv-act">'+act+'</div></div>';
  };
  const card=t=>{
    const st=state(t),pl=ADMIN_POSTERS[t.name]||[],p=pl[0],ext=pl.some(u=>!isOwnPoster(u));
    const fb=[['mc',t.mc],['tta',t.type],['char',t.char],['scene',t.scene]];
    const poster=p?'<button class="cv-poster" style="background-image:url(&quot;'+esc(p)+'&quot;)" onclick="covPosterMenu(this)" title="Click to enlarge'+(ext?' · not stored on your site yet':'')+'">'+(pl.length>1?'<span class="cv-pc">'+pl.length+'</span>':'')+(ext?'<span class="cv-ext"></span>':'')+'<span class="cv-cnt">'+t.total+'</span></button>'
      :'<button class="cv-poster none" onclick="covFetchOne(this)" title="Fetch from MyAnimeList"><i class="ti ti-photo-off"></i><small>Fetch poster</small><span class="cv-cnt">'+t.total+'</span></button>';
    return '<div class="admin-cov-row cv-card '+st+'" data-name="'+esc(t.name)+'"><input type="checkbox" class="cov-cb" onchange="toggleCovRow(covName(this),this)">'+poster
      +'<b title="'+esc(t.name)+'">'+esc(t.name)+'</b>'
      +'<div class="cv-bar" title="MC '+t.mc+' · Type the Answer '+t.type+' · Name the Character '+t.char+' · Guess the Scene '+t.scene+'"><span style="width:'+Math.min(100,Math.round(t.total/maxT*100))+'%">'+fb.filter(([,n])=>n).map(([f,n])=>'<i class="cvf-'+f+'" style="flex:'+n+'"></i>').join('')+'</span></div>'
      +'<div class="cv-tools2">'+ic('coverageJumpToBrowse(covName(this))','ti-eye','View questions')+(t.char>0?ic('coverageJumpToCharacters(covName(this))','ti-user-circle','Characters'):'')+ic("openPromptGenerator(covName(this),'anime')",'ti-wand','Prompt generator')+(t.total>0?ic('exportTopicQuestions(covName(this))','ti-download','Export'):'')+'</div></div>';
  };
  const group=(title,sub,list,kind)=>{const rows=list.filter(t=>pass(t,kind)).sort((a,b)=>a.total-b.total);if(!rows.length)return '';if(kind==='anime'&&covView==='grid')return '<div class="adm-panel cv-group"><div class="adm-ph"><b>'+title+'</b><span class="adm-mute">'+sub+'</span><span class="cv-key"><span class="cv-f cvf-mc"><i></i>MC</span><span class="cv-f cvf-tta"><i></i>Type</span><span class="cv-f cvf-char"><i></i>Character</span><span class="cv-f cvf-scene"><i></i>Scene</span></span></div><div class="cv-grid">'+rows.map(card).join('')+'</div></div>';return '<div class="adm-panel cv-group"><div class="adm-ph"><b>'+title+'</b><span class="adm-mute">'+sub+'</span>'+(kind==='anime'||kind==='genre'?'<span class="cv-key"><span class="cv-f cvf-mc"><i></i>MC</span><span class="cv-f cvf-tta"><i></i>Type</span><span class="cv-f cvf-char"><i></i>Character</span><span class="cv-f cvf-scene"><i></i>Scene</span></span>':'')+'</div><div class="cv-list">'+rows.map(t=>row(t,kind)).join('')+'</div></div>';};
  const cnt={all:anime.length+genre.length,thin:[...anime,...genre].filter(t=>state(t)==='thin').length,empty:[...anime,...genre].filter(t=>state(t)==='empty').length,noposter:anime.length-withP};
  const chips=[['all','All'],['thin','Thin'],['empty','Empty'],['noposter','No poster']].map(([k,l])=>'<button class="adm-chip'+(covFilter===k?' on':'')+'" onclick="covSetFilter(\''+k+'\')">'+l+' <span style="opacity:.6">'+cnt[k]+'</span></button>').join('');
  const general=tally('__all__');Object.assign(general,{name:'General Anime',total:approved.length,mc:approved.filter(q=>q.format==='mc').length,type:approved.filter(q=>q.format==='type').length,char:approved.filter(q=>q.format==='char').length,scene:approved.filter(q=>q.format==='scene').length});
  const body=group('ANIME',anime.length+' series · '+withP+' with posters',anime,'anime')
    +group('GENRE',genre.length+' genres',genre,'genre')
    +(covFilter==='all'?group('GENERAL','every approved question',[general],'general'):'')
    +group('OTHER','topics on questions but not in your list',extras,'extra');
  cov.innerHTML='<div class="cv-bar-top"><div class="adm-search" style="max-width:320px"><i class="ti ti-search"></i><input id="covSearch" placeholder="Find a topic" oninput="covSearchRows(this.value)"></div><div class="adm-chips">'+chips+'</div>'
    +'<div class="cv-view"><button class="'+(covView==='grid'?'on':'')+'" onclick="covSetView(\'grid\')" title="Poster grid"><i class="ti ti-layout-grid"></i></button><button class="'+(covView==='list'?'on':'')+'" onclick="covSetView(\'list\')" title="List"><i class="ti ti-list"></i></button></div>'
    +'<div class="cv-tools"><button class="adm-btn" onclick="openCoverageGapPrompt()" title="Opens the prompt generator on the topic with the fewest questions"><i class="ti ti-wand"></i> Fill thinnest gap</button><button class="adm-btn" id="covPosterBtn" onclick="backfillPosters()"><i class="ti ti-photo" style="font-size:14px"></i> Fetch posters</button><button class="adm-btn" id="covCopyBtn" onclick="mirrorAllPosters()" title="Store your own copy of every poster"><i class="ti ti-cloud-upload" style="font-size:14px"></i> Save copies</button><button class="adm-btn pri" onclick="openAddTopicModal()"><i class="ti ti-plus"></i> Add topic</button></div></div>'
    +'<div class="cv-legend"><span><b style="color:#fbbf24">12</b>gold count = under '+ADMIN_COV_THIN+' questions</span><span><b style="color:#f87171">0</b>red = none yet</span><span><i style="background:#fb923c;border-radius:2px"></i>poster not stored on your site yet</span><span>Tick topics to delete them</span></div>'
    +(body||'<div class="adm-empty">Nothing matches this filter.</div>');
  applyTheme();
}
function covAsk(msg,{input=false,multiline=false,value='',ok='OK',cancel='Cancel',placeholder=''}={}){
  return new Promise(res=>{
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:1400;background:#1f2657cc;backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px';
    const b='display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:0;border-radius:99px;font:900 12px Nunito,sans-serif;cursor:pointer';
    ov.innerHTML='<div style="width:100%;max-width:'+(multiline?560:440)+'px;background:#12131c;border-radius:18px;box-shadow:0 0 0 1.5px #ffffff14,0 30px 80px #000c;padding:22px;display:flex;flex-direction:column;gap:14px">'
      +'<div style="font:800 14px/1.5 Nunito,sans-serif;color:#EEEFF6;white-space:pre-line">'+String(msg).replace(/</g,'&lt;')+'</div>'
      +(input?(multiline?'<textarea id="caIn" rows="5" placeholder="'+placeholder+'" style="resize:vertical;min-height:110px;white-space:pre;overflow-x:auto;background:#ffffff0a;border:1.5px solid #ffffff1a;border-radius:10px;padding:10px 12px;color:#EEEFF6;font:400 12px/1.7 ui-monospace,Menlo,monospace;outline:0"></textarea>':'<input id="caIn" placeholder="'+placeholder+'" style="background:#ffffff0a;border:1.5px solid #ffffff1a;border-radius:10px;padding:10px 12px;color:#EEEFF6;font:400 12px ui-monospace,Menlo,monospace;outline:0">'):'')
      +'<div style="display:flex;gap:6px;justify-content:flex-end">'+(cancel?'<button id="caNo" style="'+b+';background:#ffffff0f;color:#EEEFF6">'+cancel+'</button>':'')+'<button id="caOk" style="'+b+';background:#F6C98E;color:#1f2657">'+ok+'</button></div></div>';
    document.body.appendChild(ov);
    const inp=ov.querySelector('#caIn');if(inp){inp.value=value;setTimeout(()=>{inp.focus();inp.select();},30);}
    const done=v=>{ov.remove();res(v);};
    ov.querySelector('#caOk').onclick=()=>done(input?inp.value:true);
    const no=ov.querySelector('#caNo');if(no)no.onclick=()=>done(input?null:false);
    ov.addEventListener('keydown',e=>{if(e.key==='Enter'&&!(multiline&&!(e.metaKey||e.ctrlKey)))ov.querySelector('#caOk').click();if(e.key==='Escape')done(input?null:false);});
  });
}
function covName(el){return el.closest('[data-name]').dataset.name;}
function covSetFilter(k){covFilter=k;renderAdminCoverage();}
function covSearchRows(v){const q=v.trim().toLowerCase();document.querySelectorAll('#adminCoverage .cv-row,#adminCoverage .cv-card').forEach(r=>{r.style.display=!q||r.dataset.name.toLowerCase().includes(q)?'':'none';});document.querySelectorAll('#adminCoverage .cv-group').forEach(g=>{g.style.display=[...g.querySelectorAll('.cv-row')].some(r=>r.style.display!=='none')?'':'none';});}
async function covFetchOne(el){
  const name=covName(el);el.disabled=true;el.innerHTML='<i class="ti ti-loader-2"></i>';
  let url=null;try{url=await fetchAndSavePoster(name);}catch(e){el.disabled=false;el.innerHTML='<i class="ti ti-photo-off"></i>';if(e&&e.saveFail){await covAsk('Found a poster for "'+name+'" but couldn\'t save it:\n\n'+e.message+'\n\nIf this says "No topic row", the name on your questions doesn\'t match the topics table. Run the latest supabase/posters.sql.',{cancel:''});return;}await covAsk('MyAnimeList is unreachable right now. Try again later, or add the link yourself via the poster editor.',{cancel:''});return;}
  if(url){renderAdminCoverage();const s=document.getElementById('covSearch');}
  else{el.disabled=false;el.innerHTML='<i class="ti ti-photo-off"></i>';if(await covAsk('No MyAnimeList match for "'+name+'". Add poster links yourself?',{ok:'Paste link'}))covSetPosterUrl(name);}
}
function covPosterMenu(el,startIdx){
  const name=typeof el==='string'?el:covName(el),list=ADMIN_POSTERS[name]||[];if(!list.length)return;
  let i=startIdx||0;
  let ov=document.getElementById('covPosterView');if(ov)ov.remove();
  ov=document.createElement('div');ov.id='covPosterView';
  ov.style.cssText='position:fixed;inset:0;z-index:1300;background:#1f2657e6;backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:32px';
  const b='display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border:0;border-radius:99px;background:#ffffff0f;color:#EEEFF6;font:900 12px Nunito,sans-serif;cursor:pointer';
  const nav='width:40px;height:40px;flex:none;border:0;border-radius:50%;background:#ffffff14;color:#EEEFF6;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center';
  const multi=list.length>1;
  ov.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;gap:16px;max-height:100%" onclick="event.stopPropagation()">'
    +'<div style="display:flex;align-items:center;gap:16px">'+(multi?'<button id="cpvP" style="'+nav+'"><i class="ti ti-chevron-left"></i></button>':'')
    +'<img id="cpvImg" alt="" style="display:block;height:min(68vh,540px);max-width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:14px;box-shadow:0 0 0 2px #ffffff1a,0 30px 80px #000c">'
    +(multi?'<button id="cpvN" style="'+nav+'"><i class="ti ti-chevron-right"></i></button>':'')+'</div>'
    +'<div style="font:400 22px \'Lilita One\',cursive;color:#EEEFF6;text-align:center">'+name.replace(/</g,'&lt;')+(multi?' <span id="cpvC" style="font:900 12px Nunito,sans-serif;color:#c3caf0;vertical-align:middle"></span>':'')+'</div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">'
    +'<button id="cpvRe" style="'+b+'"><i class="ti ti-refresh"></i> Refetch from MyAnimeList</button>'
    +'<button id="cpvLink" style="'+b+'"><i class="ti ti-link"></i> Edit links</button>'
    +'<button id="cpvX" style="'+b+';background:#EEEFF6;color:#1f2657"><i class="ti ti-x"></i> Close</button></div></div>';
  const show=()=>{i=(i%list.length+list.length)%list.length;ov.querySelector('#cpvImg').src=list[i];const c=ov.querySelector('#cpvC');if(c)c.textContent=(i+1)+' / '+list.length;};
  const close=()=>{ov.remove();document.removeEventListener('keydown',key);};
  const key=e=>{if(e.key==='Escape')close();if(multi&&e.key==='ArrowLeft'){i--;show();}if(multi&&e.key==='ArrowRight'){i++;show();}};
  document.addEventListener('keydown',key);
  ov.onclick=close;document.body.appendChild(ov);show();
  if(multi){ov.querySelector('#cpvP').onclick=()=>{i--;show();};ov.querySelector('#cpvN').onclick=()=>{i++;show();};}
  ov.querySelector('#cpvX').onclick=close;
  ov.querySelector('#cpvLink').onclick=()=>{close();covSetPosterUrl(name);};
  ov.querySelector('#cpvRe').onclick=async e=>{if(multi&&!await covAsk('Refetching replaces all '+list.length+' posters with a single one from MyAnimeList. Continue?',{ok:'Refetch'}))return;const btn=e.currentTarget;btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2"></i> Fetching…';let u=null;try{u=await fetchAndSavePoster(name);}catch(x){btn.disabled=false;btn.innerHTML='<i class="ti ti-refresh"></i> MyAnimeList is down — try later';return;}if(u){close();renderAdminCoverage();}else{btn.disabled=false;btn.innerHTML='<i class="ti ti-refresh"></i> No match — try again';}};
}
function covEditPosters(name){
  return new Promise(res=>{
    let urls=(ADMIN_POSTERS[name]||[]).slice();if(!urls.length)urls=[''];
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:1400;background:#1f2657cc;backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px';
    const b='display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:0;border-radius:99px;font:900 12px Nunito,sans-serif;cursor:pointer';
    const ic='width:30px;height:30px;flex:none;border:0;border-radius:50%;background:none;color:#c3caf0;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0';
    const ord=n=>n+(n%10===1&&n%100!==11?'st':n%10===2&&n%100!==12?'nd':n%10===3&&n%100!==13?'rd':'th');
    ov.innerHTML='<div style="width:100%;max-width:600px;max-height:100%;overflow:auto;background:#12131c;border-radius:18px;box-shadow:0 0 0 1.5px #ffffff14,0 30px 80px #000c;padding:22px;display:flex;flex-direction:column;gap:14px">'
      +'<div><div style="font:400 22px \'Lilita One\',cursive;color:#EEEFF6">Posters · '+name.replace(/</g,'&lt;')+'</div><div style="font:700 12px/1.5 Nunito,sans-serif;color:#c3caf0;margin-top:4px">The 1st poster is the main one. On MyAnimeList, right-click a cover → Copy image address.</div></div>'
      +'<div id="cepRows" style="display:flex;flex-direction:column;gap:8px"></div>'
      +'<button id="cepAdd" style="'+b+';align-self:flex-start;background:none;color:#F6C98E;padding:6px 4px"><i class="ti ti-plus"></i> Add poster</button>'
      +'<div id="cepErr" style="display:none;font:800 12px Nunito,sans-serif;color:#f87171"></div>'
      +'<div style="display:flex;gap:6px;justify-content:flex-end"><button id="cepNo" style="'+b+';background:#ffffff0f;color:#EEEFF6">Cancel</button><button id="cepOk" style="'+b+';background:#F6C98E;color:#1f2657">Save</button></div></div>';
    document.body.appendChild(ov);
    const rowsEl=ov.querySelector('#cepRows');
    const sync=()=>{urls=[...rowsEl.querySelectorAll('input')].map(i=>i.value);};
    const draw=()=>{
      rowsEl.innerHTML=urls.map((u,k)=>'<div style="display:grid;grid-template-columns:78px 30px minmax(0,1fr) auto;align-items:center;gap:10px">'
        +'<span style="font:900 12px Nunito,sans-serif;color:#d6dbf5">'+ord(k+1)+' poster</span>'
        +'<span data-th style="width:30px;height:45px;border-radius:5px;background:#ffffff0a center/cover no-repeat;box-shadow:0 0 0 1.5px #ffffff14'+(u?';background-image:url(&quot;'+u.replace(/"/g,'%22')+'&quot;)':'')+'"></span>'
        +'<input data-k="'+k+'" placeholder="https://…/cover.jpg" style="min-width:0;background:#ffffff0a;border:1.5px solid #ffffff1a;border-radius:10px;padding:10px 12px;color:#EEEFF6;font:400 12px ui-monospace,Menlo,monospace;outline:0">'
        +'<div style="display:flex">'
        +'<button data-up="'+k+'" title="Move up" style="'+ic+(k===0?';visibility:hidden':'')+'"><i class="ti ti-arrow-up"></i></button>'
        +'<button data-dn="'+k+'" title="Move down" style="'+ic+(k===urls.length-1?';visibility:hidden':'')+'"><i class="ti ti-arrow-down"></i></button>'
        +'<button data-rm="'+k+'" title="Remove" style="'+ic+'"><i class="ti ti-trash"></i></button></div></div>').join('');
      rowsEl.querySelectorAll('input').forEach(inp=>{inp.value=urls[+inp.dataset.k];inp.oninput=()=>{const th=inp.parentElement.querySelector('[data-th]');const v=inp.value.trim();th.style.backgroundImage=/^https?:\/\//i.test(v)?'url("'+v.replace(/"/g,'%22')+'")':'';inp.style.borderColor='#ffffff1a';};});
      rowsEl.querySelectorAll('[data-up]').forEach(x=>x.onclick=()=>{sync();const k=+x.dataset.up;[urls[k-1],urls[k]]=[urls[k],urls[k-1]];draw();});
      rowsEl.querySelectorAll('[data-dn]').forEach(x=>x.onclick=()=>{sync();const k=+x.dataset.dn;[urls[k+1],urls[k]]=[urls[k],urls[k+1]];draw();});
      rowsEl.querySelectorAll('[data-rm]').forEach(x=>x.onclick=()=>{sync();urls.splice(+x.dataset.rm,1);if(!urls.length)urls=[''];draw();});
    };
    draw();
    ov.querySelector('#cepAdd').onclick=()=>{sync();urls.push('');draw();const ins=rowsEl.querySelectorAll('input');ins[ins.length-1].focus();};
    const done=v=>{ov.remove();res(v);};
    ov.querySelector('#cepNo').onclick=()=>done(null);
    ov.addEventListener('keydown',e=>{if(e.key==='Escape')done(null);});
    ov.querySelector('#cepOk').onclick=()=>{
      sync();const err=ov.querySelector('#cepErr');let bad=-1;
      urls.forEach((u,k)=>{if(u.trim()&&!/^https?:\/\//i.test(u.trim())&&bad<0)bad=k;});
      if(bad>=0){err.textContent='The '+ord(bad+1)+' poster isn\'t an image link — it should start with https://';err.style.display='block';rowsEl.querySelectorAll('input')[bad].style.borderColor='#f87171';return;}
      done(urls.map(u=>u.trim()).filter(Boolean));
    };
    setTimeout(()=>{const f=rowsEl.querySelector('input');if(f)f.focus();},30);
  });
}
async function covSetPosterUrl(name){
  let urls=await covEditPosters(name);
  if(urls===null)return;
  const failed=[];
  for(let k=0;k<urls.length;k++){const m=await mirrorPoster(urls[k],name,k);if(m)urls[k]=m;else failed.push(k+1);}
  let {error}=await sb.rpc('set_topic_posters',{p_name:name,p_urls:urls});
  if(error&&/function/.test(error.message)){await covAsk('Re-run supabase/posters.sql in Supabase — it now includes multi-poster support.',{cancel:''});return;}
  if(error){await covAsk(error.message,{cancel:''});return;}
  if(urls.length)ADMIN_POSTERS[name]=urls;else delete ADMIN_POSTERS[name];
  const t=(animeTopics||[]).find(x=>x.name===name);if(t)t.posters=urls;
  renderAdminCoverage();
  if(failed.length)covAsk('Saved, but poster '+failed.join(', ')+' couldn\'t be copied to your storage, so it still points to the outside site. Try Save copies later.',{cancel:''});
}
async function exportTopicQuestions(topicKey){
  let q=sb.from('questions').select(ADMIN_FULL_COLS).eq('status','approved');
  if(topicKey!=='__general__')q=q.eq('topic_value',topicKey);
  const {data}=await q.limit(10000);
  const qs=data||[];
  if(!qs.length)return;
  const fmtLabel={mc:'Multiple Choice',type:'Type Answer',char:'Name Character',scene:'Guess the Scene'};
  const lines=qs.map((q,i)=>{
    let out=(i+1)+'. ['+( fmtLabel[q.format]||q.format)+'] '+q.question+'\n   Answer: '+q.answer;
    if(q.aliases&&q.aliases.length)out+='\n   Aliases: '+q.aliases.join(', ');
    if(q.format==='mc'&&q.options&&q.options.length)out+='\n   Options: '+q.options.join(' | ');
    if(q.topic_value)out+='\n   Topic: '+q.topic_value;
    return out;
  });
  const header='# Anime Sekai — Question Export\n# Topic: '+(topicKey==='__general__'?'General Anime':topicKey)+'\n# Total: '+qs.length+' questions\n# Exported: '+new Date().toLocaleDateString()+'\n\n';
  const blob=new Blob([header+lines.join('\n\n')],{type:'text/plain'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='questions-'+(topicKey==='__general__'?'general-anime':topicKey.toLowerCase().replace(/[^a-z0-9]+/g,'-'))+'.txt';
  a.click();
  URL.revokeObjectURL(url);
}
async function exportSelectedForRewrite(){
  if(!_bulkIds.size)return;
  const ids=[..._bulkIds];
  const {data,error}=await sb.from('questions').select(ADMIN_FULL_COLS).in('id',ids);
  if(error||!data||!data.length)return;
  const fmtLabel={mc:'Multiple Choice',type:'Type Answer',char:'Name Character',scene:'Guess the Scene'};
  // For MC questions the stored answer is an option index — resolve it to the
  // actual answer text so the AI has real context without touching the options array.
  const answerText=q=>q.options&&q.options.length?(q.options[parseInt(q.answer)]??''):(q.answer||'');
  const header='# Anime Sekai — Bulk Rewrite Export\n'
    +'# '+data.length+' question'+(data.length===1?'':'s')+' — exported '+new Date().toLocaleDateString()+'\n#\n'
    +'# HOW TO USE THIS FILE:\n'
    +'# 1. Paste this whole file into an AI chat tool (e.g. Claude, ChatGPT).\n'
    +'# 2. Ask it to reword each question so it does NOT start with "What is the name of",\n'
    +'#    keeping the same meaning and the same correct answer, while checking every question\n'
    +'#    (not just the reworded ones) against the QUALITY RULES below.\n'
    +'# 3. For every line, output exactly one of:\n'
    +'#      PASS   [ID:...] Rewritten question text || Answer   — normal case, rule 10/11 fixed\n'
    +'#      REVIEW [ID:...] Unchanged question text  || Answer  — rule 10 only: awkward phrasing\n'
    +'#                                                             you are not confident rewording\n'
    +'#      REJECT [ID:...] Unchanged question text  || Answer  — fails a rule that rewording can\n'
    +'#                                                             not fix (rules 1,2,4,5,6,7,8)\n'
    +'#    Keep the [ID:...] tag and the " || " answer exactly as-is on every line. Output the same\n'
    +'#    number of lines in the same order — never drop a line, even for REJECT.\n'
    +'# 4. Paste the AI\'s output into the "Bulk Rewrite" box in the Import tab and confirm.\n'
    +'#    Only PASS lines get written to the database. REVIEW and REJECT lines are shown in the\n'
    +'#    preview for you to check by hand, but nothing is changed for them automatically.\n'
    +'#\n'
    +'# QUALITY RULES:\n'
    +'# 1. FACT: Is the marked answer actually correct?\n'
    +'# 2. UNAMBIGUOUS: Is there exactly one defensible answer?\n'
    +'# 3. MC distractors: plausible but clearly wrong to someone who knows the series.\n'
    +'# 4. CLEAN: no answer leak into question; no duplicate within batch; exactly 4 options for MC.\n'
    +'# 5. NO ANSWER LEAK: if the answer word or phrase appears in the question text, or is\n'
    +'#    directly implied by it = REJECT. This applies to all formats.\n'
    +'# 6. NO SPOILERS: question/options/answer must NOT contain "kill","killed","kills","death",\n'
    +'#    "died","deaths". Any row that does = REJECT.\n'
    +'# 7. SEMANTIC DUPLICATE: same meaning as any existing question of the SAME FORMAT = REJECT.\n'
    +'#    A question that is semantically identical to an existing one but in a different format\n'
    +'#    (e.g. one is \'mc\' and the other is \'type\') is NOT a duplicate and should PASS.\n'
    +'# 8. LANGUAGE NEUTRAL: any question that asks specifically for a Japanese or English name\n'
    +'#    = REJECT. Questions must be answerable regardless of language preference.\n'
    +'# 9. PHRASING DIVERSITY: Vary question structure across the batch — mix direct questions,\n'
    +'#    fill-in-the-blank, "which of the following", scenario-based, superlative, relationship,\n'
    +'#    and negative framing (e.g. "Which of these is NOT..."). No single opening phrase (e.g.\n'
    +'#    "What is the name of", "What is the") should appear more than 3 times in a batch of 20.\n'
    +'#    Aim for at least 6 distinct opening structures per batch.\n'
    +'# 10. NATURAL PHRASING: Question text must read as natural English. Awkward constructions\n'
    +'#     (e.g. ending with "is named what?", "is called what?", "is known as what?") = REVIEW.\n'
    +'#     Do not rewrite — flag for human review.\n'
    +'#\n'
    +'# Format: [ID:xxxx] Question text || Correct answer (for context only — do not need to repeat exactly)\n\n';
  const lines=data.map(q=>'[ID:'+q.id+'] '+(q.question||'')+' || '+answerText(q));
  const blob=new Blob([header+lines.join('\n')],{type:'text/plain'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='rewrite-export-'+data.length+'-questions.txt';
  a.click();
  URL.revokeObjectURL(url);
}
let _importParsed=[];
function adminImportParse(){
  const raw=document.getElementById('adminImportInput').value;
  _importParsed=[];
  if(!raw.trim()){
    document.getElementById('adminImportSummary').style.display='none';
    document.getElementById('adminImportPreview').style.display='none';
    document.getElementById('adminImportActions').style.display='none';
    return;
  }
  // Strip Postgres type casts (e.g. '...'::jsonb, '...'::text) so they don't
  // interfere with column splitting — the values themselves are what we need.
  const cleaned=raw.replace(/'::[\w]+/g,"'");
  // Extract all value rows from one or more INSERT blocks
  // Match each (...) row between VALUES and ON CONFLICT / semicolon
  const valueBlocks=cleaned.match(/VALUES\s*([\s\S]*?)(?:ON CONFLICT|;|$)/gi)||[];
  // Allow quoted strings, NULL, or bare numbers (integers/decimals) as column values
  const rowRe=/\(('(?:[^']|'')*'|NULL|-?\d+(?:\.\d+)?)(?:\s*,\s*('(?:[^']|'')*'|NULL|-?\d+(?:\.\d+)?))*\)/g;
  const allRows=[];
  valueBlocks.forEach(block=>{
    rowRe.lastIndex=0; // reset /g state for each new block
    let m;
    while((m=rowRe.exec(block))!==null){
      allRows.push(m[0]);
    }
  });
  // Parse each row into a question object.
  // Read the column list from the INSERT statement so the parser works regardless
  // of whether the export includes an `id` column or uses a different order.
  const parseVal=s=>{
    if(!s||s.trim()==='NULL')return null;
    const t=s.trim();
    if(/^-?\d+(?:\.\d+)?$/.test(t))return t; // bare number
    return t.replace(/^'/,'').replace(/'$/,'').replace(/''/g,"'");
  };
  const parseJsonb=s=>{
    if(!s||s.trim()==='NULL')return null;
    try{return JSON.parse(s.trim().replace(/^'/,'').replace(/'$/,'').replace(/''/g,"'"));}catch(e){return null;}
  };
  // Extract column names from INSERT INTO questions (...) — strip quotes/backticks
  const colNamesMatch=cleaned.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i);
  const colNames=colNamesMatch
    ? colNamesMatch[1].split(',').map(c=>c.trim().replace(/^["'`]|["'`]$/g,'').toLowerCase())
    : ['question','options','answer','aliases','format','topic_type','topic_value','difficulty','media_url','report_count','submitted_by','status'];
  // Helper: split a row's inner text on commas not inside quotes or brackets
  const splitCols=inner=>{
    const cols=[];
    let depth=0,inQ=false,cur='';
    for(let i=0;i<inner.length;i++){
      const c=inner[i];
      if(c==="'"&&!inQ){inQ=true;cur+=c;continue;}
      if(c==="'"&&inQ){
        if(inner[i+1]==="'"){cur+="''";i++;continue;}
        inQ=false;cur+=c;continue;
      }
      if(!inQ&&c==='[')depth++;
      if(!inQ&&c===']')depth--;
      if(!inQ&&depth===0&&c===','){cols.push(cur.trim());cur='';continue;}
      cur+=c;
    }
    if(cur.trim())cols.push(cur.trim());
    return cols;
  };
  allRows.forEach(row=>{
    const cols=splitCols(row.slice(1,-1));
    if(cols.length<colNames.length)return;
    const get=(name,parser=parseVal)=>parser(cols[colNames.indexOf(name)]??null);
    const q={
      question:get('question'),
      options:get('options',parseJsonb),
      answer:get('answer'),
      aliases:get('aliases',parseJsonb),
      format:get('format'),
      topic_type:get('topic_type'),
      topic_value:get('topic_value'),
      difficulty:get('difficulty'),
      media_url:get('media_url'),
      report_count:0,
      submitted_by:get('submitted_by'),
      status:get('status')||'approved'
    };
    if(q.question&&q.answer&&q.format)_importParsed.push(q);
  });
  // Deduplicate against existing questions
  const existingSet=new Set(adminLite.map(q=>(q.question||'').trim().toLowerCase()));
  const newQs=_importParsed.filter(q=>!existingSet.has((q.question||'').trim().toLowerCase()));
  const dupCount=_importParsed.length-newQs.length;
  // Show summary
  const summary=document.getElementById('adminImportSummary');
  summary.style.display='flex';
  document.getElementById('adminImportStatParsed').textContent='📋 '+_importParsed.length+' parsed';
  document.getElementById('adminImportStatDups').textContent=dupCount>0?('⚠️ '+dupCount+' duplicate'+(dupCount===1?'':'s')+' skipped'):'✅ No duplicates';
  document.getElementById('adminImportStatDups').style.color=dupCount>0?'#f87171':'#4ade80';
  document.getElementById('adminImportStatNew').textContent='✨ '+newQs.length+' ready to import';
  // Show preview of new questions
  const preview=document.getElementById('adminImportPreview');
  if(newQs.length>0){
    preview.style.display='flex';
    const fmtLabel={mc:'Multiple Choice',type:'Type Answer',char:'Name Character',scene:'Guess the Scene'};
    preview.innerHTML='<div style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;padding:2px 0 6px">Preview — '+newQs.length+' question'+(newQs.length===1?'':'s')+'</div>'
      +newQs.map((q,i)=>{
        const correctIdx=q.options!=null?parseInt(q.answer):-1;
        const optionsHtml=q.options&&q.options.length
          ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px">'
            +q.options.map((opt,oi)=>{
              const isCorrect=oi===correctIdx;
              return '<div style="font-size:11px;font-weight:700;padding:5px 8px;border-radius:7px;border:1px solid '
                +(isCorrect?'#4ade80':'var(--border)')
                +';background:'+(isCorrect?'#4ade8018':'var(--bg3)')
                +';color:'+(isCorrect?'#4ade80':'var(--muted)')
                +'">'+(isCorrect?'✅ ':'')+(oi===0?'A':oi===1?'B':oi===2?'C':'D')+'. '+opt+'</div>';
            }).join('')
            +'</div>'
          : '<div style="font-size:11px;color:#4ade80;margin-top:4px">✅ '+q.answer+'</div>';
        return '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px">'
          +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px">'
          +'<span style="font-size:10px;font-weight:800;color:var(--accent);background:var(--accent-soft);border-radius:5px;padding:2px 7px">'+(fmtLabel[q.format]||q.format)+'</span>'
          +(q.media_url?'<span style="font-size:10px;font-weight:700;color:var(--muted)">🖼️ has image</span>':'')
          +(q.topic_value?'<span style="font-size:10px;font-weight:700;color:var(--muted)">📺 '+q.topic_value+'</span>':'')
          +'<span style="font-size:10px;font-weight:700;color:var(--muted)">'+(q.difficulty||'unset')+'</span>'
          +'</div>'
          +'<div style="font-size:13px;font-weight:700;color:var(--text);line-height:1.4">'+(i+1)+'. '+q.question+'</div>'
          +optionsHtml
          +'</div>';
      }).join('');
    document.getElementById('adminImportActions').style.display='flex';
    document.getElementById('adminImportBtn').disabled=false;
    document.getElementById('adminImportResult').style.display='none';
  } else {
    preview.style.display='none';
    if(_importParsed.length>0){
      // All parsed questions already exist — show a clear explanation and offer force-import
      document.getElementById('adminImportActions').style.display='flex';
      document.getElementById('adminImportBtn').disabled=true;
      document.getElementById('adminImportBtn').style.opacity='.45';
      const result=document.getElementById('adminImportResult');
      result.style.display='block';
      result.style.color='var(--muted)';
      result.innerHTML='⚠️ All '+_importParsed.length+' question'+(1===_importParsed.length?'':'s')+' already exist in the database — nothing new to import.'
        +'<br><span style="font-size:11px">If you expected new questions, check that the question text doesn\'t match existing entries.</span>';
    } else {
      document.getElementById('adminImportActions').style.display='none';
    }
  }
  applyTheme();
}
async function adminImportConfirm(){
  const existingSet=new Set(adminLite.map(q=>(q.question||'').trim().toLowerCase()));
  const newQs=_importParsed.filter(q=>!existingSet.has((q.question||'').trim().toLowerCase()));
  if(!newQs.length)return;
  requireAdminUnlock(async()=>{
    const btn=document.getElementById('adminImportBtn');
    btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="font-size:17px;animation:spin .8s linear infinite"></i> Importing…';
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/questions`,{
        method:'POST',
        headers:{
          'apikey':SUPABASE_ANON,
          'Authorization':`Bearer ${SUPABASE_ANON}`,
          'Content-Type':'application/json',
          'Prefer':'resolution=ignore-duplicates,return=minimal'
        },
        body:JSON.stringify(newQs)
      });
      if(!res.ok){const t=await res.text();throw new Error(t||'Import failed');}
      const result=document.getElementById('adminImportResult');
      result.style.display='block';
      result.textContent='✅ '+newQs.length+' question'+(newQs.length===1?'':'s')+' imported successfully!';
      // Reset the import UI so another batch can be pasted without a page refresh
      setTimeout(()=>{
        document.getElementById('adminImportInput').value='';
        document.getElementById('adminImportSummary').style.display='none';
        document.getElementById('adminImportPreview').style.display='none';
        document.getElementById('adminImportActions').style.display='none';
        result.style.display='none';
        _importParsed=[];
      },2500);
      const {data}=await sb.from('questions')
        .select('id,question,status,report_count,answer_count,correct_count,format,topic_type,topic_value,source_id')
        .limit(10000);
      if(data)adminLite=data;
      renderAdminStats();renderAdminBadges();
    }catch(e){
      const result=document.getElementById('adminImportResult');
      result.style.display='block';
      result.style.color='#f87171';
      result.textContent='❌ '+e.message;
      btn.disabled=false;
      btn.innerHTML='<i class="ti ti-database-import" style="font-size:17px"></i> Import Questions';
    }
  });
}

// ── BULK REWRITE — match pasted [ID:...] lines to existing questions and UPDATE in place ──
let _rewriteParsed=[]; // [{id, question, oldQuestion, collision}] — PASS lines only, ready to apply
let _rewriteReview=[]; // [{id, oldQuestion}] — flagged by the AI for human review, never auto-applied
let _rewriteRejected=[]; // [{id, oldQuestion}] — flagged by the AI as failing a rule, never auto-applied
let _rewriteSkipped=0; // lines whose ID wasn't found in the database
function adminRewriteParse(){
  const raw=document.getElementById('adminRewriteInput').value;
  _rewriteParsed=[];_rewriteReview=[];_rewriteRejected=[];_rewriteSkipped=0;
  if(!raw.trim()){
    document.getElementById('adminRewriteSummary').style.display='none';
    document.getElementById('adminRewritePreview').style.display='none';
    document.getElementById('adminRewriteActions').style.display='none';
    return;
  }
  const existingById=new Map(adminLite.map(q=>[String(q.id),q]));
  // Optional leading status word (PASS/REVIEW/REJECT), then [ID:xxxx], then the question
  // text, then an optional " || answer" suffix — the suffix is only there to give the AI
  // context and is ignored when parsing back.
  const lineRe=/^(PASS|REVIEW|REJECT)?\s*\[ID:([^\]]+)\]\s*(.+?)\s*(?:\|\|.*)?$/i;
  const seenIds=new Set();
  raw.split('\n').forEach(line=>{
    const t=line.trim();
    if(!t||t.startsWith('#'))return;
    const m=t.match(lineRe);
    if(!m)return;
    const status=(m[1]||'PASS').toUpperCase();
    const id=m[2].trim();
    const question=m[3].trim();
    if(!id||!question||seenIds.has(id))return;
    seenIds.add(id);
    const match=existingById.get(id);
    if(!match){_rewriteSkipped++;return;}
    if(status==='REVIEW'){_rewriteReview.push({id,oldQuestion:match.question||''});return;}
    if(status==='REJECT'){_rewriteRejected.push({id,oldQuestion:match.question||''});return;}
    if((match.question||'').trim()===question)return; // unchanged — nothing to do
    _rewriteParsed.push({id,question,oldQuestion:match.question||''});
  });
  // Flag rows whose new text would collide with a different existing question
  // (the questions table enforces unique text, so these would fail on save).
  const textLower=new Set(adminLite.map(q=>(q.question||'').trim().toLowerCase()));
  _rewriteParsed.forEach(r=>{r.collision=textLower.has(r.question.toLowerCase());});

  _rewriteTotalLines=raw.split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#')).length;
  _rewriteRenderPreview();
}
let _rewriteTotalLines=0; // lines read on the last parse; kept around so _rewriteRenderPreview can redraw without re-parsing the textarea
// Redraws the summary badges + preview list from the current _rewriteParsed/_rewriteReview/_rewriteRejected
// arrays. Called by adminRewriteParse(), and also after editing/deleting a rejected row so its card can
// disappear from the preview without re-parsing the pasted text.
function _rewriteRenderPreview(){
  const summary=document.getElementById('adminRewriteSummary');
  summary.style.display='flex';
  document.getElementById('adminRewriteStatParsed').textContent='📋 '+_rewriteTotalLines+' line'+(_rewriteTotalLines===1?'':'s')+' read';
  document.getElementById('adminRewriteStatMatched').textContent='✅ '+_rewriteParsed.length+' ready to update';
  const reviewEl=document.getElementById('adminRewriteStatReview');
  reviewEl.style.display=_rewriteReview.length>0?'inline':'none';
  reviewEl.textContent='👀 '+_rewriteReview.length+' need'+(_rewriteReview.length===1?'s':'')+' human review';
  const rejectedEl=document.getElementById('adminRewriteStatRejected');
  rejectedEl.style.display=_rewriteRejected.length>0?'inline':'none';
  rejectedEl.textContent='🚫 '+_rewriteRejected.length+' rejected by AI';
  const skippedEl=document.getElementById('adminRewriteStatSkipped');
  skippedEl.style.display=_rewriteSkipped>0?'inline':'none';
  skippedEl.textContent='⚠️ '+_rewriteSkipped+' ID'+(_rewriteSkipped===1?'':'s')+' not found';

  const preview=document.getElementById('adminRewritePreview');
  const hasAnything=_rewriteParsed.length||_rewriteReview.length||_rewriteRejected.length;
  if(hasAnything){
    preview.style.display='flex';
    const passHtml=_rewriteParsed.map(r=>
      '<div style="background:var(--card-bg);border:1px solid '+(r.collision?'#f87171':'var(--border)')+';border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px">'
      +'<div style="font-size:12px;color:var(--muted);text-decoration:line-through">'+(r.oldQuestion||'(no previous text)')+'</div>'
      +'<div style="font-size:13px;font-weight:700;color:var(--text)">'+r.question+'</div>'
      +(r.collision?'<div style="font-size:11px;font-weight:800;color:#f87171">⚠️ Matches another existing question\'s text — will be skipped</div>':'')
      +'</div>'
    ).join('');
    const reviewHtml=_rewriteReview.map(r=>
      '<div style="background:var(--card-bg);border:1px solid #fbbf24;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px">'
      +'<div style="font-size:13px;font-weight:700;color:var(--text)">'+(r.oldQuestion||'')+'</div>'
      +'<div style="font-size:11px;font-weight:800;color:#fbbf24">👀 Flagged for human review — left unchanged</div>'
      +'</div>'
    ).join('');
    const rejectHtml=_rewriteRejected.map(r=>
      '<div style="background:var(--card-bg);border:1px solid #f87171;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px">'
      +'<div style="font-size:13px;font-weight:700;color:var(--text)">'+(r.oldQuestion||'')+'</div>'
      +'<div style="font-size:11px;font-weight:800;color:#f87171">🚫 Rejected by AI — left unchanged</div>'
      +'<div style="display:flex;gap:8px">'
      +'<button class="admin-btn edit" onclick="adminRewriteEditRejected(\''+r.id+'\')"><i class="ti ti-pencil" style="font-size:12px"></i> Edit</button>'
      +'<button class="admin-btn delete" onclick="adminRewriteDeleteRejected(\''+r.id+'\')"><i class="ti ti-trash" style="font-size:12px"></i> Delete</button>'
      +'</div>'
      +'</div>'
    ).join('');
    preview.innerHTML=(_rewriteParsed.length?'<div style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;padding:2px 0 6px">Ready to update — '+_rewriteParsed.length+'</div>'+passHtml:'')
      +(_rewriteReview.length?'<div style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;padding:10px 0 6px">Needs review — '+_rewriteReview.length+'</div>'+reviewHtml:'')
      +(_rewriteRejected.length?'<div style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;padding:10px 0 6px">Rejected — '+_rewriteRejected.length+'</div>'+rejectHtml:'');
    document.getElementById('adminRewriteActions').style.display=_rewriteParsed.length?'flex':'none';
    document.getElementById('adminRewriteBtn').disabled=!_rewriteParsed.length;
    document.getElementById('adminRewriteBtn').style.opacity=_rewriteParsed.length?'1':'.45';
    document.getElementById('adminRewriteResult').style.display='none';
  } else {
    preview.style.display='none';
    document.getElementById('adminRewriteActions').style.display='none';
  }
  applyTheme();
}
// Reuses the shared admin edit modal (same one Browse uses) on a rejected row, then drops it from
// the rejected list once saved so its card disappears from the preview.
function adminRewriteEditRejected(id){
  _aeSaveCallback=()=>{
    _rewriteRejected=_rewriteRejected.filter(r=>String(r.id)!==String(id));
    _rewriteRenderPreview();
  };
  openAdminEdit(id);
}
// Deletes a rejected row outright (same PIN-gated delete used everywhere else in the admin panel)
// and drops it from the rejected list so the preview updates immediately.
function adminRewriteDeleteRejected(id){
  requireAdminUnlock(async()=>{
    await sb.from('questions').delete().eq('id',id);
    adminLite=adminLite.filter(x=>String(x.id)!==String(id));
    _rewriteRejected=_rewriteRejected.filter(r=>String(r.id)!==String(id));
    showAdminToast('Question deleted 🗑️');
    renderAdminStats();renderAdminBadges();
    _rewriteRenderPreview();
  });
}
async function adminRewriteConfirm(){
  const toApply=_rewriteParsed.filter(r=>!r.collision);
  if(!toApply.length)return;
  requireAdminUnlock(async()=>{
    const btn=document.getElementById('adminRewriteBtn');
    btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="font-size:17px;animation:spin .8s linear infinite"></i> Updating…';
    let ok=0,fail=0;
    // Each row gets different text, so this is one PATCH per row — sent in small
    // concurrent batches so we don't fire 660 requests at once.
    const BATCH=15;
    for(let i=0;i<toApply.length;i+=BATCH){
      const chunk=toApply.slice(i,i+BATCH);
      const results=await Promise.all(chunk.map(r=>
        sb.from('questions').update({question:r.question}).eq('id',r.id)
          .then(({error})=>({r,error}))
          .catch(error=>({r,error}))
      ));
      results.forEach(({r,error})=>{
        if(error){fail++;}
        else{
          ok++;
          const l=adminLite.find(x=>String(x.id)===String(r.id));
          if(l)l.question=r.question;
        }
      });
    }
    const result=document.getElementById('adminRewriteResult');
    result.style.display='block';
    if(fail===0){
      result.style.color='#4ade80';
      result.textContent='✅ '+ok+' question'+(ok===1?'':'s')+' updated successfully!';
    }else{
      result.style.color='#f87171';
      result.textContent='⚠️ '+ok+' updated, '+fail+' failed — re-export those IDs and try again.';
    }
    setTimeout(()=>{
      document.getElementById('adminRewriteInput').value='';
      document.getElementById('adminRewriteSummary').style.display='none';
      document.getElementById('adminRewritePreview').style.display='none';
      document.getElementById('adminRewriteActions').style.display='none';
      result.style.display='none';
      _rewriteParsed=[];
    },3000);
    btn.disabled=false;
    btn.innerHTML='<i class="ti ti-replace" style="font-size:17px"></i> Update Questions';
    renderAdminStats();renderAdminBadges();await renderAdminSection();
  });
}

function renderAdminList(rows,emptyMsg){
  const list=document.getElementById('adminQuestionList');
  _bulkIds.clear();
  _bulkSyncBar();
  if(!rows.length){list.innerHTML='<div class="admin-empty">'+emptyMsg+'</div>';return;}
  list.innerHTML='';
  // Select-all toggle row
  const selRow=document.createElement('div');
  selRow.style.cssText='display:flex;align-items:center;gap:10px;padding:2px 2px 4px';
  selRow.innerHTML='<button onclick="bulkSelectAll()" style="background:var(--accent-soft);border:1px solid var(--border2);color:var(--accent);font-family:\'Nunito\',sans-serif;font-size:12px;font-weight:800;padding:5px 12px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:5px"><i class="ti ti-checkbox" style="font-size:13px"></i> Select page</button><span style="font-size:12px;color:var(--muted);font-weight:700">'+rows.length+' question'+(rows.length===1?'':'s')+'</span>';
  list.appendChild(selRow);
  rows.forEach(q=>{
    const card=buildAdminCard(q);
    card.classList.add('bulk-mode');
    list.appendChild(card);
  });
  applyTheme();
  fillAdminLinkedBoxes(rows);
}

// For MC/typed linked pairs, show the other half under each card: a typed copy shows
// its MC original's options, an MC original shows its typed copy's answer + aliases.
async function fillAdminLinkedBoxes(rows){
  const typedSrcIds=[...new Set(rows.filter(q=>q.source_id).map(q=>q.source_id))];
  const mcIds=rows.filter(q=>q.format==='mc').map(q=>q.id);
  if(!typedSrcIds.length&&!mcIds.length)return;
  const cols='id,question,options,answer,aliases,format,source_id,status';
  let parents=[],children=[];
  try{
    const reqs=[];
    reqs.push(typedSrcIds.length?sb.from('questions').select(cols).in('id',typedSrcIds):Promise.resolve({data:[]}));
    reqs.push(mcIds.length?sb.from('questions').select(cols).in('source_id',mcIds):Promise.resolve({data:[]}));
    const [p,c]=await Promise.all(reqs);
    parents=p.data||[];children=c.data||[];
  }catch(e){return;}
  const esc=s=>String(s??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const head=(label,id)=>`<div class="admin-linked-head"><i class="ti ti-link" style="font-size:11px"></i> ${label}<a onclick="jumpToLinkedQuestion('${id}')">Open</a></div>`;
  rows.forEach(q=>{
    const box=document.getElementById('adminLinked_'+q.id);
    if(!box)return;
    let html='';
    if(q.source_id){
      const mc=parents.find(x=>String(x.id)===String(q.source_id));
      if(mc){
        const opts=(mc.options||[]).map((o,i)=>`<span style="${String(i)===String(mc.answer)?'color:var(--accent);font-weight:800':''}">${String.fromCharCode(65+i)}. ${esc(o)}</span>`).join(' · ');
        html+=head('MC version',mc.id)+`<div class="admin-linked-q">${esc(mc.question)}</div><div class="admin-linked-sub">${opts}</div>`;
      }else{
        html+=`<div class="admin-linked-head"><i class="ti ti-link-off" style="font-size:11px"></i> MC version not found (deleted?)</div>`;
      }
    }
    children.filter(x=>String(x.source_id)===String(q.id)).forEach(t=>{
      html+=head('Typed version',t.id)+`<div class="admin-linked-q">${esc(t.question)}</div><div class="admin-linked-sub"><b style="color:var(--accent)">Answer: ${esc(t.answer)}</b>${t.aliases?.length?' · Also accepts: '+esc(t.aliases.join(', ')):''}</div>`;
    });
    if(html){box.innerHTML=html;box.style.display='block';}
  });
}
// Open the other half of a linked pair in Browse (works for both directions)
function jumpToLinkedQuestion(id){return jumpToSourceQuestion(id);}

function _adminHL(text){
  if(text==null)return text;
  if(!adminHL||adminSection!=='browse')return text;
  const t=adminHL.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return String(text).replace(new RegExp('('+t+')','ig'),'<mark class="admin-hl">$1</mark>');
}
function buildAdminCard(q){
  const fmtLabel={mc:'Multiple Choice',type:'Type Answer',scene:'Guess the Scene',char:'Name Character'};
  const isReported=adminSection==='review'&&adminTab==='reported';
  const isSuspect=adminSection==='review'&&adminTab==='suspect';
  const showStats=(isSuspect||adminSection==='browse')&&q.answer_count>0;
  const card=document.createElement('div');
  card.className='admin-q-card'+((isReported||isSuspect)?' reported':'')+(_bulkIds.has(String(q.id))?' bulk-selected bulk-mode':'');
  card.id=`adminCard_${q.id}`;
  card.dataset.q=JSON.stringify({id:q.id,question:q.question,format:q.format,options:q.options||null,answer:q.answer,topic_value:q.topic_value||null,difficulty:q.difficulty||'normal',media_url:q.media_url||null});

  const optionsHtml=q.options?`<div style="font-size:12px;color:var(--muted);margin-top:4px">${q.options.map((o,i)=>`<span style="${String(i)===String(q.answer)?'color:var(--accent);font-weight:800':''}">${String.fromCharCode(65+i)}. ${_adminHL(o)}</span>`).join(' · ')}</div>`:'';
  const answerHtml=!q.options?`<div style="font-size:12px;color:var(--accent);margin-top:4px;font-weight:800">Answer: ${_adminHL(q.answer)}</div>`:'';
  // Character rows play as MC in-game: the answer plus these three look-alikes
  const charOptsHtml=(q.format==='char'&&Array.isArray(q.distractors)&&q.distractors.length)
    ?`<div style="font-size:12px;color:var(--muted);margin-top:2px">MC wrong options: ${q.distractors.map(d=>_adminHL(d)).join(' · ')}</div>`:'';
  const aliasHtml=q.aliases?.length?`<div style="font-size:11px;color:var(--muted);margin-top:2px">Also accepts: ${q.aliases.join(', ')}</div>`:'';
  const dateStr=q.created_at?new Date(q.created_at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
  const reportBadge=q.report_count>0
    ?`<span class="admin-report-counter"><i class="ti ti-alert-triangle" style="font-size:12px"></i> ${q.report_count} report${q.report_count===1?'':'s'}</span>`
    :'';
  const suspectBadge=showStats
    ?`<span class="admin-report-counter"><i class="ti ti-chart-bar" style="font-size:12px"></i> ${Math.round(100*q.correct_count/q.answer_count)}% correct (${q.correct_count}/${q.answer_count})</span>`
    :'';
  const linkedBadge=q.source_id
    ?`<span class="admin-badge linked" onclick="jumpToSourceQuestion('${q.source_id}')" title="Jump to the MC question this was converted from"><i class="ti ti-link" style="font-size:10px"></i> Linked</span>`
    :'';

  const editBtn=`<button class="admin-btn edit" onclick="openAdminEdit('${q.id}')"><i class="ti ti-pencil" style="font-size:12px"></i> Edit</button><button class="admin-btn edit" onclick="openAdminPreview('${q.id}')" title="Preview how this question looks in-game"><i class="ti ti-eye" style="font-size:12px"></i> Preview</button>`;
  const actionsHtml=editBtn+(isSuspect
    ?`<button class="admin-btn dismiss" onclick="adminClearStats('${q.id}')"><i class="ti ti-circle-check" style="font-size:12px"></i> Looks fine</button>
       <button class="admin-btn dismiss" onclick="adminSendToReview('${q.id}')" title="Send this approved question back to the Submitted review queue"><i class="ti ti-rotate" style="font-size:12px"></i> Send to Review</button>
       <button class="admin-btn delete" onclick="adminDelete('${q.id}')"><i class="ti ti-trash" style="font-size:12px"></i> Delete</button>`
    :isReported
    ?`<button class="admin-btn view-reports" onclick="toggleAdminReports('${q.id}')"><i class="ti ti-chevron-down" style="font-size:12px" id="adminReportChevron_${q.id}"></i> View Reports</button>
       <button class="admin-btn dismiss" onclick="adminDismiss('${q.id}')"><i class="ti ti-circle-check" style="font-size:12px"></i> Dismiss</button>
       <button class="admin-btn delete" onclick="adminDelete('${q.id}')"><i class="ti ti-trash" style="font-size:12px"></i> Delete</button>`
    :(q.status==='pending'?`<button class="admin-btn approve" onclick="adminApprove('${q.id}')"><i class="ti ti-check" style="font-size:12px"></i> Approve</button>`:q.status==='approved'?`<button class="admin-btn dismiss" onclick="adminSendToReview('${q.id}')" title="Send this approved question back to the Submitted review queue"><i class="ti ti-rotate" style="font-size:12px"></i> Send to Review</button>`:'')+`<button class="admin-btn delete" onclick="adminDelete('${q.id}')"><i class="ti ti-trash" style="font-size:12px"></i> Delete</button>`);

  const mediaHtml=q.media_url
    ?`<div style="margin-top:6px;border-radius:10px;overflow:hidden;border:1px solid var(--border);background:var(--bg3);display:flex;align-items:center;justify-content:center"><img src="${q.media_url}" alt="Submitted image" style="width:100%;height:auto;max-height:260px;object-fit:contain;display:block" onerror="this.parentElement.style.display='none'"></div>`
    :'';

  const diffVal=q.difficulty||'normal';
  const diffDropdown=`<select class="diff-inline" title="Change difficulty" onchange="quickSetDiff('${q.id}',this.value)"><option value="easy"${diffVal==='easy'?' selected':''}>Easy</option><option value="normal"${diffVal==='normal'?' selected':''}>Normal</option><option value="hard"${diffVal==='hard'?' selected':''}>Hard</option></select>`;
  const cbChecked=_bulkIds.has(String(q.id));

  card.innerHTML=`
    <input type="checkbox" class="admin-card-cb" data-id="${q.id}" ${cbChecked?'checked':''} onchange="_bulkToggle('${q.id}',this)" title="Select for bulk action">
    <div>
      <div class="admin-q-text">${_adminHL(q.question)}</div>
      ${optionsHtml}${answerHtml}${charOptsHtml}${aliasHtml}${mediaHtml}
      <div class="admin-linked-box" id="adminLinked_${q.id}" style="display:none"></div>
    </div>
    <div class="admin-q-meta">
      <span class="admin-badge format">${fmtLabel[q.format]||q.format}</span>
      <span class="admin-badge">${q.topic_value?_adminHL(q.topic_value):'General'}</span>
      ${adminSection==='browse'?`<span class="admin-badge${q.status==='pending'?' reported':''}">${q.status}</span>`:''}
      ${diffDropdown}
      ${q.submitted_by?`<span class="admin-badge submitted"><i class="ti ti-user" style="font-size:10px"></i> ${q.submitted_by}</span>`:'<span class="admin-badge">🤖 AI</span>'}
      ${dateStr?`<span class="admin-badge"><i class="ti ti-calendar" style="font-size:10px"></i> ${dateStr}</span>`:''}
      ${reportBadge}${suspectBadge}${linkedBadge}
    </div>
    <div class="admin-actions">${actionsHtml}</div>
    ${isReported?`<div class="admin-report-details" id="adminReportDetails_${q.id}"><div style="font-size:11px;color:var(--muted)">Loading reports…</div></div>`:''}`;
  return card;
}

async function toggleAdminReports(qid){
  const panel=document.getElementById(`adminReportDetails_${qid}`);
  const chevron=document.getElementById(`adminReportChevron_${qid}`);
  const isOpen=panel.classList.contains('open');
  if(isOpen){
    panel.classList.remove('open');
    if(chevron)chevron.className='ti ti-chevron-down';
    return;
  }
  panel.classList.add('open');
  if(chevron)chevron.className='ti ti-chevron-up';
  // Fetch reports for this question
  panel.innerHTML='<div style="font-size:11px;color:var(--muted)">Loading reports…</div>';
  try{
    const{data,error}=await sb.from('question_reports')
      .select('reason,detail,reported_by,reported_at')
      .eq('question_id',qid)
      .order('reported_at',{ascending:false});
    if(error||!data?.length){
      panel.innerHTML='<div style="font-size:11px;color:var(--muted)">No detailed reports on file.</div>';
      return;
    }
    const reasonLabels={wrong:'Wrong answer marked correct',unclear:'Unclear or ambiguous',outdated:'Information is outdated',duplicate:'Duplicate question',other:'Other'};
    panel.innerHTML=data.map(r=>{
      const date=r.reported_at?new Date(r.reported_at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
      return `<div class="admin-report-row">
        <div class="admin-report-reason"><i class="ti ti-flag" style="font-size:11px;color:#f87171"></i> ${reasonLabels[r.reason]||r.reason}</div>
        ${r.detail?`<div class="admin-report-detail">"${r.detail}"</div>`:''}
        <div class="admin-report-meta">
          ${r.reported_by?`<span><i class="ti ti-user" style="font-size:10px"></i> ${r.reported_by}</span>`:'<span>Anonymous</span>'}
          ${date?`<span><i class="ti ti-calendar" style="font-size:10px"></i> ${date}</span>`:''}
        </div>
      </div>`;
    }).join('');
    applyTheme();
  }catch(e){
    panel.innerHTML='<div style="font-size:11px;color:#f87171">Could not load reports.</div>';
  }
}

async function adminApprove(id){
  requireAdminUnlock(async()=>{
    await sb.from('questions').update({status:'approved'}).eq('id',id);
    const l=adminLite.find(x=>String(x.id)===String(id));if(l)l.status='approved';
    renderAdminStats();renderAdminBadges();await fetchReviewTab();
  });
}
async function adminSendToReview(id){
  requireAdminUnlock(async()=>{
    await sb.from('questions').update({status:'pending'}).eq('id',id);
    const l=adminLite.find(x=>String(x.id)===String(id));if(l)l.status='pending';
    showAdminToast('Sent back to review 📬');
    renderAdminStats();renderAdminBadges();await renderAdminSection();
  });
}
async function adminDismiss(id){
  requireAdminUnlock(async()=>{
    await sb.from('questions').update({report_count:0}).eq('id',id);
    await sb.from('question_reports').delete().eq('question_id',id);
    const l=adminLite.find(x=>String(x.id)===String(id));if(l)l.report_count=0;
    renderAdminStats();renderAdminBadges();await fetchReviewTab();
  });
}
// ── ADMIN PIN UNLOCK ─────────────────────────────────────────────────────────
// SHA-256 hex of your chosen PIN. To change: run  crypto.subtle.digest('SHA-256',
// new TextEncoder().encode('yourpin')).then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('').then(console.log))
// in the browser console and paste the result below.
const ADMIN_PIN_HASH='03ca1c3278cf01923ea5fbf6780b3dace51a548cf7829816be97d6621a66cc8e'; // ← replace before deploying
const ADMIN_UNLOCK_MS=10*60*1000; // 10 minutes

let _adminUnlocked=false;
let _adminUnlockExpiry=0;
let _adminUnlockTimer=null;
let _adminPinCallback=null; // pending action to run after unlock

async function _hashPin(pin){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin));
  return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function _isAdminUnlocked(){
  if(_adminUnlocked&&Date.now()<_adminUnlockExpiry)return true;
  _adminUnlocked=false;return false;
}

function _lockAdmin(){
  _adminUnlocked=false;_adminUnlockExpiry=0;
  clearInterval(_adminUnlockTimer);_adminUnlockTimer=null;
  const badge=document.getElementById('adminUnlockBadge');
  if(badge)badge.style.display='none';
}

function _startUnlockTimer(){
  const badge=document.getElementById('adminUnlockBadge');
  const timerEl=document.getElementById('adminUnlockTimer');
  if(badge)badge.style.display='flex';
  clearInterval(_adminUnlockTimer);
  _adminUnlockTimer=setInterval(()=>{
    const rem=_adminUnlockExpiry-Date.now();
    if(rem<=0){_lockAdmin();return;}
    const m=Math.floor(rem/60000),s=Math.floor((rem%60000)/1000);
    if(timerEl)timerEl.textContent=m+':'+(s<10?'0':'')+s;
  },1000);
}

async function _submitAdminPin(){
  const input=document.getElementById('adminUnlockInput');
  const err=document.getElementById('adminUnlockErr');
  const pin=(input?.value||'').trim();
  if(!pin)return;
  const hash=await _hashPin(pin);
  if(hash!==ADMIN_PIN_HASH){
    if(err)err.style.display='block';
    if(input){input.value='';input.focus();}
    return;
  }
  // Correct — unlock
  _adminUnlocked=true;
  _adminUnlockExpiry=Date.now()+ADMIN_UNLOCK_MS;
  document.getElementById('adminUnlockModal').style.display='none';
  if(input)input.value='';
  _startUnlockTimer();
  // Run the pending action
  if(_adminPinCallback){const cb=_adminPinCallback;_adminPinCallback=null;cb();}
}

function _cancelAdminPin(){
  document.getElementById('adminUnlockModal').style.display='none';
  const input=document.getElementById('adminUnlockInput');
  if(input)input.value='';
  document.getElementById('adminUnlockErr').style.display='none';
  _adminPinCallback=null;
}

// Gate: call requireAdminUnlock(()=>{ /* your action */ }) from any admin action.
// If already unlocked, runs immediately. Otherwise shows the PIN modal and queues the callback.
function requireAdminUnlock(cb){
  if(_isAdminUnlocked()){cb();return;}
  _adminPinCallback=cb;
  const modal=document.getElementById('adminUnlockModal');
  modal.style.display='flex';
  applyTheme();
  setTimeout(()=>{const i=document.getElementById('adminUnlockInput');if(i)i.focus();},80);
}

// ── GATED ADMIN ACTIONS ───────────────────────────────────────────────────────
function showAdminToast(msg){
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-family:\'Lilita One\',cursive;font-size:14px;padding:12px 24px;border-radius:99px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3);animation:toastIn .3s ease;white-space:nowrap';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .4s';setTimeout(()=>t.remove(),400);},2800);
}
async function adminDelete(id){
  requireAdminUnlock(async()=>{
    await sb.from('questions').delete().eq('id',id);
    adminLite=adminLite.filter(x=>String(x.id)!==String(id));
    showAdminToast('Question deleted 🗑️');
    renderAdminStats();renderAdminBadges();await renderAdminSection();
  });
}
async function adminClearStats(id){
  requireAdminUnlock(async()=>{
    await sb.from('questions').update({answer_count:0,correct_count:0}).eq('id',id);
    const l=adminLite.find(x=>String(x.id)===String(id));if(l){l.answer_count=0;l.correct_count=0;}
    renderAdminStats();renderAdminBadges();await fetchReviewTab();
  });
}
function aeOptionRow(value,checked){
  const div=document.createElement('div');
  div.className='ae-opt-row';
  div.innerHTML='<input type="radio" name="aeCorrect"'+(checked?' checked':'')+' title="Mark as correct"><input class="form-input ae-opt-input" type="text" placeholder="Option text">';
  div.querySelector('.ae-opt-input').value=value||'';
  document.getElementById('aeOptionRows').appendChild(div);
}
function aeBuildOptions(opts,ai){
  const rowsEl=document.getElementById('aeOptionRows');rowsEl.innerHTML='';
  for(let i=0;i<4;i++)aeOptionRow((opts&&opts[i])||'',i===ai);
}
function aeFormatChange(){
  const isMC=document.getElementById('aeFormat').value==='mc';
  document.getElementById('aeOptionsWrap').style.display=isMC?'block':'none';
  document.getElementById('aeAnswerWrap').style.display=isMC?'none':'block';
  if(isMC&&!document.querySelector('#aeOptionRows .ae-opt-row'))aeBuildOptions([],0);
}
async function openAdminEdit(id){
  // Fetch the full row fresh — no in-memory cache to read from
  let q=null;
  try{const {data}=await sb.from('questions').select(ADMIN_FULL_COLS).eq('id',id).single();q=data;}catch(e){}
  if(!q)return;
  aeEditId=id;aeOrig=q;
  document.getElementById('aeQuestion').value=q.question||'';
  document.getElementById('aeFormat').value=q.format||'mc';
  if(q.options){
    aeBuildOptions(q.options,parseInt(q.answer));
    document.getElementById('aeAnswer').value='';
  }else{
    document.getElementById('aeOptionRows').innerHTML='';
    document.getElementById('aeAnswer').value=q.answer||'';
  }
  document.getElementById('aeAliases').value=(q.aliases||[]).join(', ');
  document.getElementById('aeTopic').value=q.topic_value||'';
  document.getElementById('aeDiff').value=q.difficulty||'normal';
  document.getElementById('aeErr').style.display='none';
  aeFormatChange();
  document.getElementById('adminEditModal').style.display='flex';
  applyTheme();
}
function closeAdminEdit(){document.getElementById('adminEditModal').style.display='none';aeEditId=null;_aeSaveCallback=null;}
async function saveAdminEdit(){
  if(!aeEditId)return;
  requireAdminUnlock(async()=>{
    const showErrLocal=(m)=>{const e=document.getElementById('aeErr');e.textContent=m;e.style.display='block';};
    const question=document.getElementById('aeQuestion').value.trim();
    const fmt=document.getElementById('aeFormat').value;
    const topic=document.getElementById('aeTopic').value.trim();
    const diff=document.getElementById('aeDiff').value||'unset';
    const aliases=document.getElementById('aeAliases').value.split(',').map(a=>a.trim()).filter(Boolean);
    if(!question)return showErrLocal('Please enter the question text.');
    let options=null,answerVal;
    if(fmt==='mc'){
      const rows=[...document.querySelectorAll('#aeOptionRows .ae-opt-row')].map(r=>({val:r.querySelector('.ae-opt-input').value.trim(),checked:r.querySelector('input[type=radio]').checked}));
      if(rows.some(r=>!r.val))return showErrLocal('Please fill in all 4 options.');
      const correctIdx=rows.findIndex(r=>r.checked);
      if(correctIdx<0)return showErrLocal('Tap the circle next to the correct option.');
      options=rows.map(r=>r.val);
      answerVal=String(correctIdx);
    }else{
      answerVal=document.getElementById('aeAnswer').value.trim();
      if(!answerVal)return showErrLocal('Please enter the correct answer.');
    }
    const topic_value=topic||null;
    const topic_type=topic?((aeOrig&&aeOrig.topic_type)||'anime'):null;
    const update={question,format:fmt,options,answer:answerVal,aliases,topic_value,topic_type,difficulty:diff};
    const btn=document.querySelector('#adminEditModal .action-btn.primary');
    if(btn){btn.disabled=true;btn.style.opacity='.6';}
    let error;
    try{({error}=await sb.from('questions').update(update).eq('id',aeEditId));}catch(e){error=e;}
    if(btn){btn.disabled=false;btn.style.opacity='1';}
    if(error)return showErrLocal(error.code==='23505'?'Another question already has that exact text.':'Could not save — try again.');
    const l=adminLite.find(x=>String(x.id)===String(aeEditId));
    if(l)Object.assign(l,{question:update.question,format:update.format,topic_type:update.topic_type,topic_value:update.topic_value,difficulty:update.difficulty});
    const savedCb=_aeSaveCallback;
    closeAdminEdit();
    renderAdminStats();renderAdminBadges();await renderAdminSection();
    if(savedCb)savedCb();
  });
}

// ── SITE CONTENT ADMIN EDITOR ──────────────────────────────────
function _htmlEsc(s){return (s??'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// Holds only the fields the admin has actively changed but not yet saved —
// {cards:{key:{title,desc,locked}}, copy:{key:string}}. Cleared on Save All,
// Discard, or once a Reset commits that specific key to the DB.
let adminContentDirty={cards:{},copy:{}};
// Which tab ('card'|'htp'|'solo') is showing in each card's editor, keyed by
// CARD_REGISTRY[].key. Consulted on every re-render so a tab choice survives
// a Reset-triggered rebuild instead of always snapping back to "Card".
let cardActiveTab={};
const CARD_PREVIEW_ICON={fmt:{mc:'📝',type:'⌨️',img:'🖼️',char:'🎭'},mode:{classic:'🎮',race:'🏁',survival:'❤️',potato:'🥔',slowreveal:'👁️'}};
const HTP_PREVIEW_ICON={fmt:{mc:'ti-list',type:'ti-keyboard',img:'ti-photo',char:'ti-user-circle'},mode:{classic:'ti-device-gamepad-2',race:'ti-trophy',survival:'ti-heart',potato:'ti-flame',slowreveal:'ti-eye'}};
const SOLO_RULES_MODES=['classic','race','survival']; // the only modes with a solo Rules popup
function _htpKeyFor(reg){return reg.type==='fmt'?'htp_fmt_'+reg.id:'htp_mode_'+reg.id;}
function _soloKeyFor(reg){return (reg.type==='mode'&&SOLO_RULES_MODES.includes(reg.id))?'solo_rules_'+reg.id:null;}
function _regDefault(key){const r=TEXT_REGISTRY.find(t=>t.key===key);return r?r.default:'';}
function renderAdminContentPanel(){
  const wrap=document.getElementById('adminContent');
  if(!wrap)return;
  const cardGroups=[...new Set(CARD_REGISTRY.map(c=>c.group))];
  const cardTabKeys=new Set(CARD_REGISTRY.flatMap(reg=>[_htpKeyFor(reg),_soloKeyFor(reg)].filter(Boolean)));
  const settingsKeys=new Set(['voiding_info_body','htp_topic_general','scene_hint_solo','scene_hint_lobby']);
  const pageGroups=[...new Set(TEXT_REGISTRY.filter(t=>!cardTabKeys.has(t.key)&&!settingsKeys.has(t.key)).map(t=>t.group))];
  wrap.innerHTML=`<div style="font-size:13px;color:var(--muted);line-height:1.6">Edit what each Format/Mode card shows — its brief blurb, its "How to Play" description, and (for solo-playable modes) its Rules popup — right where each one appears. Switch tabs on a card to jump between them; the preview on the left follows along. Hit <b>Save All</b> at the bottom when you're happy with your changes.</div>`
    +cardGroups.map(g=>`<div style="display:flex;flex-direction:column;gap:12px">
      <div style="font-family:'Lilita One',cursive;font-size:15px;color:var(--text)">${_htmlEsc(g)}</div>
      <div style="display:flex;flex-direction:column;gap:10px">${CARD_REGISTRY.filter(c=>c.group===g).map(buildAdminCardEditor).join('')}</div>
    </div>`).join('')
    +`<div style="height:1px;background:var(--border);margin:6px 0"></div>`
    +`<div style="font-family:'Lilita One',cursive;font-size:17px;color:var(--text)">Game Settings</div>`
    +`<div style="font-size:13px;color:var(--muted);line-height:1.6">Text for lobby settings and popup sections that aren't tied to any single Format/Mode card.</div>`
    +`<div style="display:flex;flex-direction:column;gap:12px">
      ${buildGameSettingsPreview()}
      <div style="display:flex;flex-direction:column;gap:10px">${TEXT_REGISTRY.filter(t=>settingsKeys.has(t.key)).map(buildAdminTextEditor).join('')}</div>
    </div>`
    +`<div style="height:1px;background:var(--border);margin:6px 0"></div>`
    +`<div style="font-family:'Lilita One',cursive;font-size:17px;color:var(--text)">Page Copy</div>`
    +`<div style="font-size:13px;color:var(--muted);line-height:1.6">Edit static, informational text — the landing page hero, footer, and empty states — with a live mini-preview. Button labels, error/toast messages, and any text with live scores or usernames baked in are intentionally not editable here.</div>`
    +pageGroups.map(g=>`<div style="display:flex;flex-direction:column;gap:12px">
      <div style="font-family:'Lilita One',cursive;font-size:15px;color:var(--text)">${_htmlEsc(g)}</div>
      ${buildPagePreview(g)}
      <div style="display:flex;flex-direction:column;gap:10px">${TEXT_REGISTRY.filter(t=>t.group===g).map(buildAdminTextEditor).join('')}</div>
    </div>`).join('');
  _ensureContentSaveBar();
  _initPagePreviews();
  _syncContentSaveBar();
}
// ── Format/Mode cards: a live preview (rendered with the exact classes used
// on the real solo/multiplayer cards) sits next to tabbed fields — Card /
// How to Play / Solo Rules — so every popup's text is edited in one place,
// with the preview switching to match whichever tab is active. ──
function buildAdminCardEditor(reg){
  const cfg=getCardConfig(reg.key);
  const htpKey=_htpKeyFor(reg),soloKey=_soloKeyFor(reg);
  const tab=cardActiveTab[reg.key]||'card';
  return `<div class="admin-q-card" id="acard_${reg.key}" style="flex-direction:row;align-items:stretch;gap:18px;flex-wrap:wrap">
    <div id="acpreview_${reg.key}" style="flex-shrink:0;display:flex"></div>
    <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-width:240px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span class="admin-badge format">${reg.type==='fmt'?'Format':'Mode'}</span>
        <label style="display:inline-flex;align-items:center;gap:7px;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;color:${cfg.locked?'#f87171':'var(--muted)'};cursor:pointer;user-select:none">
          <input type="checkbox" ${cfg.locked?'checked':''} onchange="this.closest('label').style.color=this.checked?'#f87171':'var(--muted)';onCardFieldInput('${reg.key}')" style="accent-color:#f87171;width:15px;height:15px;cursor:pointer"> Locked (coming soon)
        </label>
      </div>
      <div style="display:flex;gap:2px;border-bottom:1px solid var(--border2)">
        <button type="button" class="act-tab${tab==='card'?' active':''}" data-tab="card" onclick="switchCardTab('${reg.key}','card')">Card</button>
        <button type="button" class="act-tab${tab==='htp'?' active':''}" data-tab="htp" onclick="switchCardTab('${reg.key}','htp')">How to Play</button>
        ${soloKey?`<button type="button" class="act-tab${tab==='solo'?' active':''}" data-tab="solo" onclick="switchCardTab('${reg.key}','solo')">Solo Rules</button>`:''}
      </div>
      <div id="acpanel_card_${reg.key}" class="ac-panel" style="display:${tab==='card'?'flex':'none'}">
        <input id="actitle_${reg.key}" value="${_htmlEsc(cfg.title)}" placeholder="Card title" oninput="onCardFieldInput('${reg.key}')" style="background:var(--bg3);border:1.5px solid var(--border2);border-radius:8px;padding:9px 12px;color:var(--text);font-family:'Nunito',sans-serif;font-size:14px;font-weight:800;outline:none">
        <textarea id="acdesc_${reg.key}" placeholder="Card description" oninput="onCardFieldInput('${reg.key}')" style="background:var(--bg3);border:1.5px solid var(--border2);border-radius:8px;padding:9px 12px;min-height:56px;resize:vertical;color:var(--text);font-family:'Nunito',sans-serif;font-size:13px;font-weight:600;outline:none;line-height:1.5">${_htmlEsc(cfg.desc)}</textarea>
      </div>
      <div id="acpanel_htp_${reg.key}" class="ac-panel" style="display:${tab==='htp'?'flex':'none'}">
        <textarea id="achtp_${reg.key}" placeholder="How to Play description" oninput="onCardTextTabInput('${reg.key}','htp')" style="background:var(--bg3);border:1.5px solid var(--border2);border-radius:8px;padding:9px 12px;min-height:80px;resize:vertical;color:var(--text);font-family:'Nunito',sans-serif;font-size:13px;font-weight:600;outline:none;line-height:1.5">${_htmlEsc(getSiteText(htpKey))}</textarea>
      </div>
      ${soloKey?`<div id="acpanel_solo_${reg.key}" class="ac-panel" style="display:${tab==='solo'?'flex':'none'}">
        <textarea id="acsolo_${reg.key}" placeholder="Solo Rules popup description" oninput="onCardTextTabInput('${reg.key}','solo')" style="background:var(--bg3);border:1.5px solid var(--border2);border-radius:8px;padding:9px 12px;min-height:80px;resize:vertical;color:var(--text);font-family:'Nunito',sans-serif;font-size:13px;font-weight:600;outline:none;line-height:1.5">${_htmlEsc(getSiteText(soloKey))}</textarea>
      </div>`:''}
      <div class="admin-actions">
        <button class="admin-btn dismiss" onclick="resetAdminCardTab('${reg.key}')"><i class="ti ti-rotate" style="font-size:13px"></i> Reset this tab to default</button>
        <span id="acstatus_${reg.key}" style="font-size:12px;font-weight:800;color:var(--accent);display:none">Edited — remember to Save All</span>
      </div>
    </div>
  </div>`;
}
function _liveCardTitle(key,reg){const el=document.getElementById('actitle_'+key);return (el&&el.value.trim())||reg.title;}
function _cardPreviewBox(reg,title,desc,locked){
  const icon=CARD_PREVIEW_ICON[reg.type][reg.id]||'❔';
  const cls=reg.type==='fmt'?'fmt-card':'mode-card';
  const iconHtml=reg.type==='fmt'?`<div class="fmt-card-icon">${icon}</div>`:`<div class="mode-icon">${icon}</div>`;
  const titleClass=reg.type==='fmt'?'fmt-card-title':'mode-title';
  const descClass=reg.type==='fmt'?'fmt-card-desc':'mode-desc';
  return `<div class="${cls}${locked?' locked':''}" style="width:170px;pointer-events:none;cursor:default">${iconHtml}<div class="${titleClass}">${_htmlEsc(title)}</div><div class="${descClass}">${_htmlEsc(locked?'🔒 Coming soon':desc)}</div></div>`;
}
function _htpPreviewBox(reg,title,desc){
  const icon=HTP_PREVIEW_ICON[reg.type][reg.id]||'ti-info-circle';
  return `<div style="display:flex;align-items:flex-start;gap:12px;background:var(--accent-soft);border:1px solid var(--border2);border-radius:13px;padding:14px 16px;width:250px;pointer-events:none">
    <div style="width:38px;height:38px;border-radius:10px;background:var(--bg2);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--accent);flex-shrink:0"><i class="ti ${icon}"></i></div>
    <div><div style="font-family:'Lilita One',cursive;font-size:15px;color:var(--text);margin-bottom:4px">${_htmlEsc(title)}</div><div style="font-size:12px;color:var(--muted);line-height:1.6">${_htmlEsc(desc)}</div></div>
  </div>`;
}
function _soloPreviewBox(reg,title,desc){
  const emoji=CARD_PREVIEW_ICON.mode[reg.id]||'❔';
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;background:var(--bg2);border:1px solid var(--card-border);border-radius:16px;padding:18px;width:250px;pointer-events:none">
    <div style="font-size:32px">${emoji}</div>
    <div style="font-family:'Lilita One',cursive;font-size:16px;color:var(--text)">${_htmlEsc(title)}</div>
    <div style="font-size:12px;color:var(--muted);line-height:1.6;text-align:left">${_htmlEsc(desc)}</div>
  </div>`;
}
function _refreshCardPreview(key){
  const reg=CARD_REGISTRY.find(c=>c.key===key);
  const pv=document.getElementById('acpreview_'+key);
  if(!pv||!reg)return;
  const tab=cardActiveTab[key]||'card';
  const title=_liveCardTitle(key,reg);
  if(tab==='card'){
    const desc=document.getElementById('acdesc_'+key)?.value.trim()||reg.desc;
    const locked=!!document.querySelector(`#acard_${key} input[type="checkbox"]`)?.checked;
    pv.innerHTML=_cardPreviewBox(reg,title,desc,locked);
  } else if(tab==='htp'){
    const htpKey=_htpKeyFor(reg);
    const desc=document.getElementById('achtp_'+key)?.value.trim()||_regDefault(htpKey);
    pv.innerHTML=_htpPreviewBox(reg,title,desc);
  } else if(tab==='solo'){
    const soloKey=_soloKeyFor(reg);
    const desc=document.getElementById('acsolo_'+key)?.value.trim()||_regDefault(soloKey);
    pv.innerHTML=_soloPreviewBox(reg,title,desc);
  }
}
function switchCardTab(key,tab){
  cardActiveTab[key]=tab;
  const card=document.getElementById('acard_'+key);
  if(!card)return;
  card.querySelectorAll('.act-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  card.querySelectorAll('.ac-panel').forEach(p=>{p.style.display=(p.id===`acpanel_${tab}_${key}`)?'flex':'none';});
  _refreshCardPreview(key);
}
function _cardHasDirty(key){
  const reg=CARD_REGISTRY.find(c=>c.key===key);
  if(adminContentDirty.cards[key])return true;
  const htpKey=_htpKeyFor(reg);if(htpKey&&adminContentDirty.copy[htpKey]!==undefined)return true;
  const soloKey=_soloKeyFor(reg);if(soloKey&&adminContentDirty.copy[soloKey]!==undefined)return true;
  return false;
}
function _updateCardStatus(key){
  const status=document.getElementById('acstatus_'+key);
  if(status)status.style.display=_cardHasDirty(key)?'inline':'none';
}
function onCardFieldInput(key){
  const cfg=getCardConfig(key);
  const title=document.getElementById('actitle_'+key).value.trim();
  const desc=document.getElementById('acdesc_'+key).value.trim();
  const locked=!!document.querySelector(`#acard_${key} input[type="checkbox"]`).checked;
  const isDirty=title!==cfg.title||desc!==cfg.desc||locked!==!!cfg.locked;
  if(isDirty)adminContentDirty.cards[key]={title,desc,locked};else delete adminContentDirty.cards[key];
  _refreshCardPreview(key);
  _updateCardStatus(key);
  _syncContentSaveBar();
}
function onCardTextTabInput(key,tab){
  const reg=CARD_REGISTRY.find(c=>c.key===key);
  const textKey=tab==='htp'?_htpKeyFor(reg):_soloKeyFor(reg);
  if(!textKey)return;
  const el=document.getElementById((tab==='htp'?'achtp_':'acsolo_')+key);
  const val=el.value.trim();
  const isDirty=val!==getSiteText(textKey);
  if(isDirty)adminContentDirty.copy[textKey]=val;else delete adminContentDirty.copy[textKey];
  _refreshCardPreview(key);
  _updateCardStatus(key);
  _syncContentSaveBar();
}
function resetAdminCard(key){
  requireAdminUnlock(async()=>{
    const next={...siteCardConfig};delete next[key];
    let error;
    try{({error}=await sb.from('site_config').upsert({key:'cards',value:next},{onConflict:'key'}));}catch(e){error=e;}
    if(error){showAdminToast('Could not reset — try again.');return;}
    siteCardConfig=next;
    delete adminContentDirty.cards[key];
    applySiteCardOverrides();
    renderAdminContentPanel();
  });
}
function resetAdminCardTab(key){
  const reg=CARD_REGISTRY.find(c=>c.key===key);
  const tab=cardActiveTab[key]||'card';
  if(tab==='card'){resetAdminCard(key);return;}
  const textKey=tab==='htp'?_htpKeyFor(reg):_soloKeyFor(reg);
  if(textKey)resetAdminText(textKey);
}
// ── Page copy & Game Settings: plain field editors with a live mini-preview ──
function buildAdminTextEditor(reg){
  const val=getSiteText(reg.key);
  const field=reg.multiline
    ?`<textarea id="atext_${reg.key}" oninput="onTextFieldInput('${reg.key}')" placeholder="${_htmlEsc(reg.label)}" style="background:var(--bg3);border:1.5px solid var(--border2);border-radius:8px;padding:9px 12px;min-height:56px;resize:vertical;color:var(--text);font-family:'Nunito',sans-serif;font-size:13px;font-weight:600;outline:none;line-height:1.5">${_htmlEsc(val)}</textarea>`
    :`<input id="atext_${reg.key}" value="${_htmlEsc(val)}" oninput="onTextFieldInput('${reg.key}')" placeholder="${_htmlEsc(reg.label)}" style="background:var(--bg3);border:1.5px solid var(--border2);border-radius:8px;padding:9px 12px;color:var(--text);font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;outline:none">`;
  return `<div class="admin-q-card" id="atcard_${reg.key}">
    <span class="admin-badge format">${_htmlEsc(reg.label)}</span>
    ${field}
    <div class="admin-actions">
      <button class="admin-btn dismiss" onclick="resetAdminText('${reg.key}')"><i class="ti ti-rotate" style="font-size:13px"></i> Reset to default</button>
      <span id="atstatus_${reg.key}" style="font-size:12px;font-weight:800;color:var(--accent);display:none">Edited — remember to Save All</span>
    </div>
  </div>`;
}
function onTextFieldInput(key){
  const reg=TEXT_REGISTRY.find(t=>t.key===key);
  const val=document.getElementById('atext_'+key).value.trim();
  const isDirty=val!==getSiteText(key);
  if(isDirty)adminContentDirty.copy[key]=val;else delete adminContentDirty.copy[key];
  _updatePagePreview(key,val||reg.default);
  const status=document.getElementById('atstatus_'+key);
  if(status)status.style.display=isDirty?'inline':'none';
  _syncContentSaveBar();
}
function resetAdminText(key){
  requireAdminUnlock(async()=>{
    const next={...siteTextConfig};delete next[key];
    let error;
    try{({error}=await sb.from('site_config').upsert({key:'copy',value:next},{onConflict:'key'}));}catch(e){error=e;}
    if(error){showAdminToast('Could not reset — try again.');return;}
    siteTextConfig=next;
    delete adminContentDirty.copy[key];
    applySiteTextOverrides();
    renderAdminContentPanel();
  });
}
// ── Live mini-previews ──
function buildGameSettingsPreview(){
  return `<div style="display:flex;flex-direction:column;gap:10px">
    <div style="background:var(--bg);border:1.5px solid var(--border);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:13px;font-weight:700;color:var(--text)">Question Voiding</span>
        <i class="ti ti-info-circle" style="font-size:14px;color:var(--muted)"></i>
      </div>
      <div style="font-size:11px;font-weight:600;color:var(--muted)">Allow players to void bad questions.</div>
      <div style="display:flex;align-items:flex-start;gap:10px;background:var(--bg2);border:1px solid var(--card-border);border-radius:12px;padding:12px 14px">
        <i class="ti ti-flag" style="font-size:16px;color:var(--accent);flex-shrink:0;margin-top:2px"></i>
        <div id="pv_voiding_info_body" style="font-size:12px;color:var(--muted);line-height:1.6"></div>
      </div>
    </div>
    <div style="display:flex;align-items:flex-start;gap:14px;background:var(--accent-soft);border:1px solid var(--border2);border-radius:13px;padding:14px 16px">
      <i class="ti ti-books" style="font-size:20px;color:var(--accent);flex-shrink:0"></i>
      <div>
        <div style="font-family:'Lilita One',cursive;font-size:14px;color:var(--text);margin-bottom:2px">How to Play — Topic</div>
        <div id="pv_htp_topic_general" style="font-size:12px;color:var(--muted);line-height:1.6"></div>
      </div>
    </div>
    <div style="display:flex;align-items:flex-start;gap:10px;background:var(--accent-soft);border:1px solid var(--border2);border-radius:10px;padding:9px 11px">
      <i class="ti ti-info-circle" style="font-size:14px;color:var(--accent);flex-shrink:0;margin-top:1px"></i>
      <div>
        <div style="font-size:11px;font-weight:800;color:var(--text);margin-bottom:2px">Scene hint — solo game settings</div>
        <div id="pv_scene_hint_solo" style="font-size:12px;color:var(--muted);line-height:1.6"></div>
      </div>
    </div>
    <div style="display:flex;align-items:flex-start;gap:10px;background:var(--accent-soft);border:1px solid var(--border2);border-radius:10px;padding:9px 11px">
      <i class="ti ti-info-circle" style="font-size:14px;color:var(--accent);flex-shrink:0;margin-top:1px"></i>
      <div>
        <div style="font-size:11px;font-weight:800;color:var(--text);margin-bottom:2px">Scene hint — multiplayer topic lock</div>
        <div id="pv_scene_hint_lobby" style="font-size:12px;color:var(--muted);line-height:1.6"></div>
      </div>
    </div>
  </div>`;
}
function buildPagePreview(g){
  if(g==='Landing Page')return `<div style="background:var(--bg);border:1.5px solid var(--border);border-radius:16px;padding:26px 20px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px">
    <div id="pv_landing_headline" class="entry-title" style="font-size:30px"></div>
    <div class="entry-sub" style="font-size:13px;margin-top:2px" id="pv_landing_subhead"></div>
    <b style="color:var(--text);font-size:13px" id="pv_landing_tagline"></b>
  </div>`;
  if(g==='Footer')return `<div style="background:var(--bg);border:1.5px solid var(--border);border-radius:12px;padding:14px 18px" class="foot-left">© <span id="pv_footer_year"></span> <span id="pv_footer_brand"></span></div>`;
  if(g==='Empty States')return `<div style="display:flex;flex-direction:column;gap:10px">
    <div class="lb-empty" style="border:1.5px dashed var(--border);border-radius:14px" id="pv_lb_empty"></div>
    <div class="lobby-list-empty" id="pv_lobby_browse_empty"><span id="pv_lobby_browse_title"></span><br><span style="font-size:12px;margin-top:6px;display:block" id="pv_lobby_browse_sub"></span></div>
  </div>`;
  return '';
}
function _setPreviewHeadline(el,text){
  const words=(text||'').trim().split(/\s+/).filter(Boolean);
  el.textContent='';
  if(!words.length)return;
  const last=words.pop();
  if(words.length)el.appendChild(document.createTextNode(words.join(' ')+' '));
  const span=document.createElement('span');span.textContent=last;el.appendChild(span);
}
function _initPagePreviews(){
  const h=document.getElementById('pv_landing_headline');if(h)_setPreviewHeadline(h,getSiteText('landing_headline'));
  const s=document.getElementById('pv_landing_subhead');if(s)s.textContent=getSiteText('landing_subhead');
  const t=document.getElementById('pv_landing_tagline');if(t)t.textContent=getSiteText('landing_tagline');
  const fb=document.getElementById('pv_footer_brand');if(fb)fb.textContent=getSiteText('footer_brand');
  const fy=document.getElementById('pv_footer_year');if(fy)fy.textContent=new Date().getFullYear();
  const lbe=document.getElementById('pv_lb_empty');if(lbe)lbe.textContent=getSiteText('lb_empty');
  const lbt=document.getElementById('pv_lobby_browse_title');if(lbt)lbt.textContent=getSiteText('lobby_browse_empty_title');
  const lbs=document.getElementById('pv_lobby_browse_sub');if(lbs)lbs.textContent=getSiteText('lobby_browse_empty_sub');
  const vb=document.getElementById('pv_voiding_info_body');if(vb)vb.textContent=getSiteText('voiding_info_body');
  const tg=document.getElementById('pv_htp_topic_general');if(tg)tg.textContent=getSiteText('htp_topic_general');
  const shs=document.getElementById('pv_scene_hint_solo');if(shs)shs.textContent=getSiteText('scene_hint_solo');
  const shl=document.getElementById('pv_scene_hint_lobby');if(shl)shl.textContent=getSiteText('scene_hint_lobby');
  CARD_REGISTRY.forEach(reg=>_refreshCardPreview(reg.key));
}
function _updatePagePreview(key,val){
  if(key==='landing_headline'){const el=document.getElementById('pv_landing_headline');if(el)_setPreviewHeadline(el,val);}
  else if(key==='landing_subhead'){const el=document.getElementById('pv_landing_subhead');if(el)el.textContent=val;}
  else if(key==='landing_tagline'){const el=document.getElementById('pv_landing_tagline');if(el)el.textContent=val;}
  else if(key==='footer_brand'){const el=document.getElementById('pv_footer_brand');if(el)el.textContent=val;}
  else if(key==='lb_empty'){const el=document.getElementById('pv_lb_empty');if(el)el.textContent=val;}
  else if(key==='lobby_browse_empty_title'){const el=document.getElementById('pv_lobby_browse_title');if(el)el.textContent=val;}
  else if(key==='lobby_browse_empty_sub'){const el=document.getElementById('pv_lobby_browse_sub');if(el)el.textContent=val;}
  else if(key==='voiding_info_body'){const el=document.getElementById('pv_voiding_info_body');if(el)el.textContent=val;}
  else if(key==='htp_topic_general'){const el=document.getElementById('pv_htp_topic_general');if(el)el.textContent=val;}
  else if(key==='scene_hint_solo'){const el=document.getElementById('pv_scene_hint_solo');if(el)el.textContent=val;}
  else if(key==='scene_hint_lobby'){const el=document.getElementById('pv_scene_hint_lobby');if(el)el.textContent=val;}
}
// ── Bottom "Save All" bar shared by every field in this tab (Cards' Card/How
// to Play/Solo Rules tabs, Game Settings, and Page Copy) ──
// Lives directly on <body>, outside the admin panel's .slide-in-animated
// containers — a position:fixed descendant of an element with a CSS
// transform (even a settled translateY(0)) is fixed to THAT ancestor, not
// the viewport, which is why this can't just be rendered inside #adminContent.
function _ensureContentSaveBar(){
  let bar=document.getElementById('adminContentSaveBar');
  if(bar)return bar;
  bar=document.createElement('div');
  bar.id='adminContentSaveBar';
  bar.className='admin-content-savebar';
  bar.style.display='none';
  bar.innerHTML=`<span class="admin-bulk-bar-count" id="adminContentDirtyCount">0 unsaved changes</span>
    <button class="admin-btn dismiss" onclick="discardAdminContentChanges()"><i class="ti ti-x" style="font-size:13px"></i> Discard</button>
    <button class="admin-btn approve" onclick="saveAllAdminContent()"><i class="ti ti-device-floppy" style="font-size:13px"></i> Save All</button>`;
  document.body.appendChild(bar);
  return bar;
}
function _syncContentSaveBar(){
  const bar=_ensureContentSaveBar();
  const wrap=document.getElementById('adminContent');
  if(adminSection!=='content'){bar.style.display='none';if(wrap)wrap.style.paddingBottom='';return;}
  const n=Object.keys(adminContentDirty.cards).length+Object.keys(adminContentDirty.copy).length;
  bar.style.display=n?'flex':'none';
  if(wrap)wrap.style.paddingBottom=n?'76px':'';
  const c=document.getElementById('adminContentDirtyCount');
  if(c)c.textContent=n+' unsaved change'+(n===1?'':'s');
}
function discardAdminContentChanges(){
  adminContentDirty={cards:{},copy:{}};
  renderAdminContentPanel();
}
async function saveAllAdminContent(){
  const cardKeys=Object.keys(adminContentDirty.cards),copyKeys=Object.keys(adminContentDirty.copy);
  if(!cardKeys.length&&!copyKeys.length)return;
  for(const k of cardKeys){const d=adminContentDirty.cards[k];if(!d.title||!d.desc){showAdminToast('Title and description can\'t be empty.');return;}}
  for(const k of copyKeys){if(!adminContentDirty.copy[k]){showAdminToast('Text fields can\'t be empty.');return;}}
  requireAdminUnlock(async()=>{
    const btn=document.querySelector('#adminContentSaveBar .admin-btn.approve');
    if(btn){btn.disabled=true;btn.style.opacity='.6';}
    const nextCards={...siteCardConfig,...adminContentDirty.cards};
    const nextCopy={...siteTextConfig,...adminContentDirty.copy};
    let error;
    try{
      const ops=[];
      if(cardKeys.length)ops.push(sb.from('site_config').upsert({key:'cards',value:nextCards},{onConflict:'key'}));
      if(copyKeys.length)ops.push(sb.from('site_config').upsert({key:'copy',value:nextCopy},{onConflict:'key'}));
      const results=await Promise.all(ops);
      error=(results.find(r=>r&&r.error)||{}).error;
    }catch(e){error=e;}
    if(btn){btn.disabled=false;btn.style.opacity='1';}
    if(error){showAdminToast('Could not save — try again.');return;}
    if(cardKeys.length)siteCardConfig=nextCards;
    if(copyKeys.length)siteTextConfig=nextCopy;
    adminContentDirty={cards:{},copy:{}};
    applySiteCardOverrides();applySiteTextOverrides();
    renderAdminContentPanel();
    showAdminToast('Changes saved ✓');
  });
}

// ── BULK ACTIONS ─────────────────────────────────────────────
let _bulkIds=new Set();

function _bulkSyncBar(){
  const bar=document.getElementById('adminBulkBar');
  const n=_bulkIds.size;
  if(n===0){bar.style.display='none';return;}
  bar.style.display='flex';
  document.getElementById('adminBulkCount').textContent=n+' selected';
  const showApprove=(adminSection==='review'&&adminTab==='submitted')||adminSection==='browse';
  document.getElementById('adminBulkApprove').style.display=showApprove?'inline-flex':'none';
  const showSendToReview=(adminSection==='review'&&adminTab==='suspect')||adminSection==='browse';
  document.getElementById('adminBulkSendToReview').style.display=showSendToReview?'inline-flex':'none';
}
function _bulkToggle(id,el){
  if(el.checked)_bulkIds.add(String(id));else _bulkIds.delete(String(id));
  const card=document.getElementById('adminCard_'+id);
  if(card)card.classList.toggle('bulk-selected',el.checked);
  _bulkSyncBar();
}
function bulkSelectAll(){
  const list=document.getElementById('adminQuestionList');
  const cbs=list.querySelectorAll('.admin-card-cb');
  const nSelected=[..._bulkIds].length;
  const allChecked=nSelected>0&&nSelected===cbs.length;
  cbs.forEach(cb=>{
    const id=cb.dataset.id;
    if(allChecked){cb.checked=false;_bulkIds.delete(id);document.getElementById('adminCard_'+id)?.classList.remove('bulk-selected');}
    else{cb.checked=true;_bulkIds.add(id);document.getElementById('adminCard_'+id)?.classList.add('bulk-selected');}
  });
  _bulkSyncBar();
}
function bulkClear(){
  _bulkIds.forEach(id=>{document.getElementById('adminCard_'+id)?.classList.remove('bulk-selected');});
  _bulkIds.clear();
  document.getElementById('adminQuestionList').querySelectorAll('.admin-card-cb').forEach(cb=>cb.checked=false);
  _bulkSyncBar();
}
async function bulkApprove(){
  if(!_bulkIds.size)return;
  requireAdminUnlock(async()=>{
    const ids=[..._bulkIds];
    await sb.from('questions').update({status:'approved'}).in('id',ids);
    ids.forEach(id=>{const l=adminLite.find(x=>String(x.id)===String(id));if(l)l.status='approved';});
    _bulkIds.clear();
    renderAdminStats();renderAdminBadges();await renderAdminSection();
  });
}
async function bulkSendToReview(){
  if(!_bulkIds.size)return;
  requireAdminUnlock(async()=>{
    const ids=[..._bulkIds];
    await sb.from('questions').update({status:'pending'}).in('id',ids);
    ids.forEach(id=>{const l=adminLite.find(x=>String(x.id)===String(id));if(l)l.status='pending';});
    _bulkIds.clear();
    showAdminToast(ids.length+' question'+(ids.length===1?'':'s')+' sent back to review 📬');
    renderAdminStats();renderAdminBadges();await renderAdminSection();
  });
}
async function bulkDelete(){
  if(!_bulkIds.size)return;
  requireAdminUnlock(async()=>{
    const ids=[..._bulkIds];
    await sb.from('questions').delete().in('id',ids);
    adminLite=adminLite.filter(x=>!ids.includes(String(x.id)));
    _bulkIds.clear();
    showAdminToast(ids.length+' question'+(ids.length===1?'':'s')+' deleted 🗑️');
    renderAdminStats();renderAdminBadges();await renderAdminSection();
  });
}
async function bulkDiff(diff){
  if(!_bulkIds.size)return;
  requireAdminUnlock(async()=>{
    const ids=[..._bulkIds];
    await sb.from('questions').update({difficulty:diff}).in('id',ids);
    ids.forEach(id=>{const l=adminLite.find(x=>String(x.id)===String(id));if(l)l.difficulty=diff;});
    _bulkIds.clear();
    renderAdminStats();renderAdminBadges();await renderAdminSection();
  });
}

// ── PROMPT GENERATOR ─────────────────────────────────────────
function openPromptGenerator(topicValue,topicType){
  const existing=document.getElementById('promptGenModal');
  if(existing)existing.remove();

  const fmtOptions=[
    {id:'pgFmtMc',val:'mc',label:'Multiple Choice'},
    {id:'pgFmtType',val:'type',label:'Type Answer'},
    {id:'pgFmtChar',val:'char',label:'Name Character'}
  ];

  const modal=document.createElement('div');
  modal.id='promptGenModal';
  modal.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#0008;padding:20px';
  modal.innerHTML=`
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:28px;width:100%;max-width:520px;display:flex;flex-direction:column;gap:18px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-family:'Lilita One',cursive;font-size:18px;color:var(--text)">Generate Prompt</div>
        <button onclick="document.getElementById('promptGenModal').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;border-radius:6px">&times;</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.08em;text-transform:uppercase">Topic</label>
        <div style="display:flex;gap:10px">
          <div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:8px 12px;font-size:13px;font-weight:700;color:var(--text)">${topicValue}</div>
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:8px 12px;font-size:13px;font-weight:700;color:var(--muted)">${topicType}</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.08em;text-transform:uppercase">Difficulty</label>
        <div style="display:flex;gap:8px">
          ${['Easy','Normal','Hard'].map(d=>`<button id="pgDiff${d}" onclick="pgSetDiff('${d}')" style="flex:1;padding:7px;border-radius:8px;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;cursor:pointer;border:1px solid var(--border2);background:var(--bg3);color:var(--muted);transition:all .15s">${d}</button>`).join('')}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.08em;text-transform:uppercase">Format <span style="font-size:10px;font-weight:600;color:var(--muted)">(multi-select)</span></label>
        <div style="display:flex;gap:8px">
          ${fmtOptions.map(f=>`<button id="${f.id}" onclick="pgToggleFmt('${f.val}')" style="flex:1;padding:7px;border-radius:8px;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;cursor:pointer;border:1px solid var(--border2);background:var(--bg3);color:var(--muted);transition:all .15s">${f.label}</button>`).join('')}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.08em;text-transform:uppercase">Quantity</label>
        <div style="display:flex;gap:8px;align-items:center">
          ${[10,20,30].map(q=>`<button id="pgQty${q}" onclick="pgSetQty(${q})" style="flex:1;padding:7px;border-radius:8px;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;cursor:pointer;border:1px solid var(--border2);background:var(--bg3);color:var(--muted);transition:all .15s">${q}</button>`).join('')}
          <input id="pgQtyCustom" type="number" min="1" max="200" placeholder="Custom" oninput="pgSetQtyCustom()" style="flex:1;padding:7px 10px;border-radius:8px;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;border:1px solid var(--border2);background:var(--bg3);color:var(--text);text-align:center;outline:none">
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.08em;text-transform:uppercase">Preview</label>
        <pre id="pgPreview" style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:12px;font-size:11px;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Nunito',sans-serif;line-height:1.6;min-height:60px;margin:0"></pre>
      </div>

      <button onclick="pgCopy()" style="background:var(--accent);border:1px solid var(--accent);color:#fff;font-family:'Nunito',sans-serif;font-size:13px;font-weight:800;padding:10px;border-radius:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:opacity .2s" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
        <i class="ti ti-copy" style="font-size:14px"></i> <span id="pgCopyLabel">Copy Prompt</span>
      </button>
    </div>
  `;
  document.body.appendChild(modal);
  applyTheme();

  modal._topicValue=topicValue;
  modal._topicType=topicType;
  modal._diff=null;
  modal._fmts=new Set();
  modal._qty=null;

  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  pgUpdatePreview();
}

function pgSetDiff(d){
  const modal=document.getElementById('promptGenModal');
  modal._diff=d;
  ['Easy','Normal','Hard'].forEach(x=>{
    const btn=document.getElementById('pgDiff'+x);
    const active=x===d;
    btn.style.background=active?'var(--accent-soft)':'var(--bg3)';
    btn.style.borderColor=active?'var(--accent)':'var(--border2)';
    btn.style.color=active?'var(--accent)':'var(--muted)';
  });
  pgUpdatePreview();
}

function pgToggleFmt(val){
  const modal=document.getElementById('promptGenModal');
  if(modal._fmts.has(val))modal._fmts.delete(val);else modal._fmts.add(val);
  const map={mc:'pgFmtMc',type:'pgFmtType',char:'pgFmtChar'};
  ['mc','type','char'].forEach(v=>{
    const btn=document.getElementById(map[v]);
    const active=modal._fmts.has(v);
    btn.style.background=active?'var(--accent-soft)':'var(--bg3)';
    btn.style.borderColor=active?'var(--accent)':'var(--border2)';
    btn.style.color=active?'var(--accent)':'var(--muted)';
  });
  pgUpdatePreview();
}

function pgSetQty(q){
  const modal=document.getElementById('promptGenModal');
  modal._qty=q;
  document.getElementById('pgQtyCustom').value='';
  [10,20,30].forEach(x=>{
    const btn=document.getElementById('pgQty'+x);
    const active=x===q;
    btn.style.background=active?'var(--accent-soft)':'var(--bg3)';
    btn.style.borderColor=active?'var(--accent)':'var(--border2)';
    btn.style.color=active?'var(--accent)':'var(--muted)';
  });
  pgUpdatePreview();
}

function pgSetQtyCustom(){
  const modal=document.getElementById('promptGenModal');
  const v=parseInt(document.getElementById('pgQtyCustom').value,10);
  modal._qty=(!isNaN(v)&&v>0)?v:null;
  [10,20,30].forEach(x=>{
    const btn=document.getElementById('pgQty'+x);
    btn.style.background='var(--bg3)';
    btn.style.borderColor='var(--border2)';
    btn.style.color='var(--muted)';
  });
  pgUpdatePreview();
}

function pgBuildPrompt(){
  const modal=document.getElementById('promptGenModal');
  if(!modal)return'';
  const{_topicValue:tv,_topicType:tt,_diff:diff,_fmts:fmts,_qty:qty}=modal;
  if(!fmts.size||!qty)return'(configure format and quantity above)';
  const fmtValList=[...fmts];
  const blocks=fmtValList.map(f=>{
    const perFmt=fmtValList.length>1?Math.round(qty/fmtValList.length):qty;
    const diffLine=diff?'\nDifficulty: '+diff.toLowerCase():'';
    return'Generate exactly '+perFmt+' trivia questions.\nTopic type: '+tt+'\nTopic value: '+tv+'\nFormat: '+f+diffLine+'\nOutput only the SQL INSERT statement.';
  });
  return blocks.join('\n\n');
}

function pgUpdatePreview(){
  const pre=document.getElementById('pgPreview');
  if(pre)pre.textContent=pgBuildPrompt();
}

function pgCopy(){
  const text=pgBuildPrompt();
  if(text.startsWith('('))return;
  navigator.clipboard.writeText(text).then(()=>{
    const lbl=document.getElementById('pgCopyLabel');
    if(!lbl)return;
    lbl.textContent='Copied!';
    setTimeout(()=>{if(lbl)lbl.textContent='Copy Prompt';},2000);
  });
}

// ── COVERAGE GAP: thinnest-topic shortcut ────────────────────
function openCoverageGapPrompt(){
  const approved=adminLite.filter(q=>q.status==='approved');
  const allTopics=[...ADMIN_ANIME_TOPICS,...ADMIN_GENRE_TOPICS];
  let thinnest=null,min=Infinity;
  allTopics.forEach(t=>{
    const n=approved.filter(q=>(q.topic_value||'')===t).length;
    if(n<min){min=n;thinnest=t;}
  });
  if(!thinnest)return;
  const type=ADMIN_ANIME_TOPICS.includes(thinnest)?'anime':'genre';
  openPromptGenerator(thinnest,type);
}

// ── QUICK DIFFICULTY INLINE EDIT ─────────────────────────────
async function quickSetDiff(id,val){
  requireAdminUnlock(async()=>{
    await sb.from('questions').update({difficulty:val}).eq('id',id);
    const l=adminLite.find(x=>String(x.id)===String(id));if(l)l.difficulty=val;
  });
}

// ── ADMIN QUESTION PREVIEW ────────────────────────────────────
function openAdminPreview(id){
  const card=document.getElementById('adminCard_'+id);
  if(!card||!card.dataset.q)return;
  let q;
  try{q=JSON.parse(card.dataset.q);}catch(e){return;}

  const fmtLabel={mc:'Multiple Choice',type:'Type Answer',scene:'Guess the Scene',char:'Name Character'};
  const diffEmoji={easy:'🟢',normal:'🟡',hard:'🔴'};
  const topicStr=q.topic_value||'General Anime';
  const diffStr=(diffEmoji[q.difficulty]||'🟡')+' '+(q.difficulty?q.difficulty.charAt(0).toUpperCase()+q.difficulty.slice(1):'Normal');

  document.getElementById('previewQBadge').textContent=fmtLabel[q.format]||q.format;
  document.getElementById('previewQText').textContent=q.question;

  // Show image if present
  const previewImgWrap=document.getElementById('previewQImageWrap');
  const previewImgEl=document.getElementById('previewQImage');
  if(q.media_url){previewImgEl.src=q.media_url;previewImgWrap.style.display='flex';}
  else{previewImgWrap.style.display='none';previewImgEl.src='';}

  const wrap=document.getElementById('previewAnswersWrap');
  if(q.format==='mc'&&q.options&&q.options.length){
    const keys=['A','B','C','D'];
    wrap.innerHTML='<div class="answers" style="pointer-events:none">'
      +q.options.map((opt,i)=>{
        const isCorrect=String(i)===String(q.answer);
        return `<div class="ans locked${isCorrect?' correct':''}">
          <div class="ans-key">${keys[i]||String.fromCharCode(65+i)}</div>
          <div class="ans-text">${opt}</div>
        </div>`;
      }).join('')
      +'</div>';
  } else {
    wrap.innerHTML=`<div style="text-align:center;padding:10px 0">
      <div style="font-size:12px;font-weight:800;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Correct Answer</div>
      <div class="q-answer-reveal">${q.answer||'—'}</div>
    </div>`;
  }

  document.getElementById('previewQCard').insertAdjacentHTML('beforeend',
    `<div id="previewQFooter" style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <span class="q-card-meta-pill">🎌 ${topicStr}</span>
      <span class="q-card-meta-pill">${diffStr}</span>
    </div>`
  );

  const modal=document.getElementById('adminPreviewModal');
  modal.style.display='flex';
  applyTheme();
}
function closeAdminPreview(){
  document.getElementById('adminPreviewModal').style.display='none';
  const footer=document.getElementById('previewQFooter');
  if(footer)footer.remove();
}

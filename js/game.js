// Topic picking, daily quiz, question bank, solo quiz, submit question, sounds (moved out of index.html 2026-11-19; loads in its original place, order matters)
// ── TOPIC SELECTION ───────────────────────────────────────────
let selectedTopics=[];
let isGeneralSelected=true;

const animeEmojiMap={
  'one piece':'☠️','naruto':'🍥','dragon ball':'⭐','attack on titan':'⚔️','demon slayer':'🌊',
  'my hero academia':'💪','hunter x hunter':'🎯','fullmetal alchemist':'⚙️','jujutsu kaisen':'👁️',
  'death note':'📓','bleach':'⚡','sword art online':'🗡️','fairy tail':'✨','vinland saga':'🪓',
  'tokyo revengers':'🏍️','chainsaw man':'🪚','spy x family':'🕵️','mob psycho 100':'🌀',
  'cowboy bebop':'🚀','neon genesis evangelion':'🤖','code geass':'♟️','re:zero':'💀',
  'steins;gate':'⏱️','your lie in april':'🎹','toradora':'🐯','haikyuu!!':'🏐',
  'black clover':'🍀','overlord':'💀','konosuba':'💥','fruits basket':'🍊',
};
/* Topics are anime series only (owner, 2026-10-16); genre rows in the topics table are ignored. */
let animeTopics=[];

function posterList(row){const a=Array.isArray(row.poster_urls)?row.poster_urls.filter(Boolean):[];return a.length?a:(row.poster_url?[row.poster_url]:[]);}
function applyPoster(el,t,idx){
  if(!el||!t)return;
  const list=t.posters||[];
  if(!list.length){el.style.background='';el.textContent=t.name;el.title='';el.onclick=null;return;}
  const i=((idx||0)%list.length+list.length)%list.length;
  el.style.background='var(--bg3) center/cover no-repeat url("'+list[i].replace(/"/g,'%22')+'")';
  el.style.position='relative';el.title=t.name;el.textContent='';
  if(list.length<2)return;
  const arrow=(d,side)=>'<button type="button" data-d="'+d+'" style="position:absolute;top:50%;'+side+':6px;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:50%;background:#0B0B14b3;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;padding:0"><i class="ti ti-chevron-'+(d<0?'left':'right')+'"></i></button>';
  el.innerHTML=arrow(-1,'left')+arrow(1,'right')
    +'<div style="position:absolute;left:0;right:0;bottom:8px;display:flex;justify-content:center;gap:5px">'+list.map((_,k)=>'<span style="width:'+(k===i?16:6)+'px;height:6px;border-radius:99px;background:'+(k===i?'#fff':'#ffffff80')+';box-shadow:0 0 0 1px #0006"></span>').join('')+'</div>';
  el.querySelectorAll('button[data-d]').forEach(b=>b.onclick=e=>{e.stopPropagation();applyPoster(el,t,i+ +b.dataset.d);});
}
// AniList: best-match cover for a series name. Returns URL or null.
async function anilistPoster(name,_try=0){
  const q='query($s:String){Media(search:$s,type:ANIME,sort:SEARCH_MATCH){coverImage{extraLarge large}}}';
  const r=await fetch('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query:q,variables:{s:name}})});
  if(r.status===429&&_try<3){const w=(+r.headers.get('Retry-After')||60)*1000;await new Promise(res=>setTimeout(res,w));return anilistPoster(name,_try+1);}
  if(!r.ok)return null;
  const j=await r.json();const c=j?.data?.Media?.coverImage;
  return c?(c.extraLarge||c.large||null):null;
}
const POSTER_BUCKET='posters';
function isOwnPoster(u){return typeof u==='string'&&u.includes('/storage/v1/object/public/'+POSTER_BUCKET+'/');}
// Copies an outside poster into our own storage. Returns the new link, or null if it couldn't be copied.
async function mirrorPoster(url,name,idx){
  if(!url||isOwnPoster(url))return url;
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'topic';
  const src=/anilist/i.test(url)?'anilist':/myanimelist/i.test(url)?'mal':'web';
  const ext=(url.match(/\.(png|webp|jpe?g)(\?|$)/i)||[,'jpg'])[1].toLowerCase().replace('jpeg','jpg');
  const path=slug+'/'+(idx+1)+'-'+src+'-'+Date.now()+'.'+ext;
  try{
    const r=await fetch(url);
    if(r.ok){const b=await r.blob();if(b.type.startsWith('image/')){const{error}=await sb.storage.from(POSTER_BUCKET).upload(path,b,{contentType:b.type,upsert:true});if(!error)return sb.storage.from(POSTER_BUCKET).getPublicUrl(path).data.publicUrl;console.warn('poster upload:',error.message);}}
  }catch(e){}
  try{const{data,error}=await sb.functions.invoke('mirror-poster',{body:{url,path}});if(!error&&data&&data.url)return data.url;console.warn('mirror-poster:',error||data);}catch(e){}
  return null;
}
async function mirrorAllPosters(){
  const btn=document.getElementById('covCopyBtn');
  const setBtn=s=>{if(btn)btn.innerHTML='<i class="ti ti-cloud-upload" style="font-size:14px"></i> '+s;};
  const todo=Object.entries(ADMIN_POSTERS).filter(([,l])=>l.some(u=>!isOwnPoster(u)));
  if(!todo.length){await covAsk('Every poster is already stored on your site.',{cancel:''});return;}
  const n=todo.reduce((a,[,l])=>a+l.filter(u=>!isOwnPoster(u)).length,0);
  if(!await covAsk('Save your own copy of '+n+' poster'+(n===1?'':'s')+' across '+todo.length+' series? Keep this tab open.',{ok:'Save copies'}))return;
  let done=0,failed=[];
  for(const [name,list] of todo){
    const out=[];
    for(let k=0;k<list.length;k++){
      if(!isOwnPoster(list[k]))setBtn('Copying '+(++done)+'/'+n+'…');
      const m=await mirrorPoster(list[k],name,k);
      if(m)out.push(m);else{out.push(list[k]);failed.push(name);}
    }
    if(out.some((u,k)=>u!==list[k])){const{error}=await sb.rpc('set_topic_posters',{p_name:name,p_urls:out});if(!error){ADMIN_POSTERS[name]=out;const t=(animeTopics||[]).find(x=>x.name===name);if(t)t.posters=out;}}
  }
  setBtn('Save copies');renderAdminCoverage();
  const f=[...new Set(failed)];
  covAsk(f.length?'Copied '+(n-failed.length)+'/'+n+'.\n\nCouldn\'t copy posters for:\n'+f.join('\n')+'\n\nIf these are AniList links, deploy the mirror-poster Edge Function (see supabase/functions/mirror-poster) and try again.':'All '+n+' posters are now stored on your site.',{cancel:''});
}
// MyAnimeList covers via Tenrai (api.tenrai.org/v1): free, no key, Jikan v4-compatible schema.
// Replaces Jikan (shut down Oct 1, 2026). The mal-poster Edge Function is only a fallback if Tenrai is down.
// Name kept so existing callers don't change.
const TENRAI='https://api.tenrai.org/v1';
async function jikanPoster(name,_try=0){
  const q=String(name||'').trim();
  if(q.length<3)return null;
  let r;
  try{r=await withTimeout(fetch(TENRAI+'/anime?limit=1&sfw=true&q='+encodeURIComponent(q.slice(0,100))),10000);}catch(e){r=null;}
  if(r&&r.status===429&&_try<3){await new Promise(res=>setTimeout(res,1500*(_try+1)));return jikanPoster(name,_try+1);}
  if(r&&r.ok){
    const j=await r.json().catch(()=>null);
    const img=j?.data?.[0]?.images;
    return img?.jpg?.large_image_url||img?.webp?.large_image_url||img?.jpg?.image_url||null;
  }
  if(r&&r.status<500)return null; // no usable match
  // Tenrai unreachable or 5xx: try the official-MAL Edge Function if it's deployed
  let data,error;
  try{({data,error}=await sb.functions.invoke('mal-poster',{body:{name:q}}));}catch(e){error=e;}
  if(!error)return data?.url||null;
  const err=new Error('MAL_DOWN');err.malDown=true;err.detail='Tenrai '+(r?r.status:'unreachable');throw err;
}
async function fetchAndSavePoster(name){
  try{
    let url=(await jikanPoster(name))||(await anilistPoster(name)); // AniList only when MAL has no match
    if(!url)return null;
    url=(await mirrorPoster(url,name,0))||url;
    const{error}=await sb.rpc('set_topic_poster',{p_name:name,p_url:url});
    if(error){console.warn('set_topic_poster:',error.message);const e=new Error(error.message);e.saveFail=true;throw e;}
    const t=(animeTopics||[]).find(x=>x.name===name);if(t)t.posters=[url];
    ADMIN_POSTERS[name]=[url];
    return url;
  }catch(e){if(e&&(e.malDown||e.saveFail))throw e;console.warn('poster fetch failed for',name,e);return null;}
}
let _posterBackfillRunning=false;
async function backfillPosters(){
  if(_posterBackfillRunning)return;
  const btn=document.getElementById('covPosterBtn');
  const setBtn=s=>{if(btn)btn.innerHTML='<i class="ti ti-photo" style="font-size:14px"></i> '+s;};
  const res=await fetch(`${SUPABASE_URL}/rest/v1/topics?select=name,poster_url,poster_urls&type=eq.anime`,{headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}});
  if(!res.ok){await covAsk('Run supabase/posters.sql in the Supabase SQL editor first.',{cancel:''});return;}
  const names=(await res.json()).filter(r=>{const l=posterList(r);return !l.length||(l.length===1&&/anilist\.co/i.test(l[0]));}).map(r=>r.name);
  if(!names.length){await covAsk('Every series already has a MyAnimeList or hand-added poster.',{cancel:''});return;}
  if(!await covAsk('Fetch posters from MyAnimeList for '+names.length+' series? This covers series with no poster and replaces the old AniList ones (your hand-added posters are kept). Takes about '+Math.max(1,Math.ceil(names.length*1.3/60))+' min — keep this tab open.',{ok:'Fetch'}))return;
  try{await jikanPoster(names[0]);}catch(e){if(e.malDown){await covAsk('Couldn\'t reach Tenrai (the MyAnimeList poster source), so nothing was changed. It may be down or slow right now — try again later.',{cancel:''});return;}}
  _posterBackfillRunning=true;let ok=0,miss=[];
  for(let i=0;i<names.length;i++){
    setBtn('Posters '+(i+1)+'/'+names.length+'…');
    let got=null;try{got=await fetchAndSavePoster(names[i]);}catch(e){if(e.malDown){_posterBackfillRunning=false;setBtn('Fetch posters');renderAdminCoverage();await covAsk('MyAnimeList went down partway through. Saved '+ok+' so far — run Fetch posters again later to finish the rest.',{cancel:''});return;}}
    got?ok++:miss.push(names[i]);
    if(typeof adminSection!=='undefined'&&adminSection==='coverage'&&i%5===4)renderAdminCoverage();
    if(i<names.length-1)await new Promise(r=>setTimeout(r,1300)); // stay well under Tenrai's public rate limit
  }
  _posterBackfillRunning=false;setBtn('Fetch posters');
  if(typeof adminSection!=='undefined'&&adminSection==='coverage')renderAdminCoverage();
  covAsk('Posters saved: '+ok+'/'+names.length+(miss.length?'\n\nNo match found for:\n'+miss.join('\n'):''),{cancel:''});
}
async function loadTopicsFromSupabase(){
  const list=document.getElementById('topicResultsList');
  if(list)list.innerHTML='<div class="topic-empty"><div class="spinner" style="margin:0 auto 8px"></div>Loading topics…</div>';
  try{
    // Fetch approved topics from the topics table
    const _th={headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}};
    const [topicsRes,questionsRes]=await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/topics?select=name,type,poster_url,poster_urls,genres&status=eq.approved`,_th)
        .then(r=>r.ok?r:fetch(`${SUPABASE_URL}/rest/v1/topics?select=name,type,poster_url,poster_urls&status=eq.approved`,_th))
        .then(r=>r.ok?r:fetch(`${SUPABASE_URL}/rest/v1/topics?select=name,type,poster_url&status=eq.approved`,_th))
        .then(r=>r.ok?r:fetch(`${SUPABASE_URL}/rest/v1/topics?select=name,type&status=eq.approved`,_th)),
      // Counts are grouped server-side; fetching every question row here hit the API's 5,000-row cap
      fetch(`${SUPABASE_URL}/rest/v1/rpc/question_counts`,
        {method:'POST',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`,'Content-Type':'application/json'},body:'{}'})
    ]);
    if(!topicsRes.ok) throw new Error('Failed to load topics');
    const topicsData=await topicsRes.json();
    if(!topicsData||!topicsData.length){
      if(list)list.innerHTML='<div class="topic-empty">No topics available yet.</div>';
      return;
    }
    // Build count map from questions
    const countMap={};
    if(questionsRes.ok){
      const qData=await questionsRes.json();
      (qData||[]).forEach(row=>{
        if(!row.topic_value)return;
        if(!countMap[row.topic_value])countMap[row.topic_value]={};
        countMap[row.topic_value][row.format]=(countMap[row.topic_value][row.format]||0)+Number(row.n||0);
      });
    }
    const animeSet=new Map();
    topicsData.forEach(row=>{
      if(row.type!=='anime')return;
      const name=row.name;
      const key=name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
      animeSet.set(key,{key,emoji:'',name,type:'anime',counts:countMap[name]||{},posters:posterList(row),genres:Array.isArray(row.genres)?row.genres:[]});
    });
    animeTopics=[...animeSet.values()].sort((a,b)=>a.name.localeCompare(b.name));
    renderTopicList();
  }catch(e){
    console.error('loadTopicsFromSupabase exception:',e);
    if(list)list.innerHTML='<div class="topic-empty" style="color:var(--muted)">⚠️ Couldn\'t load topics. Please refresh.</div>';
  }
}

function getTopicList(){return animeTopics;}
function cntFmtFor(fmt){return fmt==='char-mc'?'char':fmt;}

function renderTopicList(filter=''){
  const list=document.getElementById('topicResultsList');
  if(!list)return;
  const all=getTopicList();
  const items=all.filter(t=>t.name.toLowerCase().includes((filter||'').toLowerCase()));
  if(all.length===0){
    // Still loading or empty — don't overwrite the spinner set by loadTopicsFromSupabase
    return;
  }
  if(items.length===0){
    list.innerHTML='<div class="topic-empty">No results for "'+filter+'"</div>';
    return;
  }
  const cntFmt=cntFmtFor(selectedFormat);
  const sorted=items.slice().sort((a,b)=>{
    const aEmpty=(a.counts?a.counts[cntFmt]||0:0)===0;
    const bEmpty=(b.counts?b.counts[cntFmt]||0:0)===0;
    if(aEmpty!==bEmpty)return aEmpty?1:-1;
    return a.name.localeCompare(b.name);
  });
  list.innerHTML=sorted.map(t=>{
    const sel=selectedTopics.some(s=>s.key===t.key);
    const cnt=t.counts?t.counts[cntFmt]||0:null;
    const isEmpty=cnt===0;
    const badge=cnt!==null?`<span style="font-size:11px;font-weight:700;color:${isEmpty?'#ef4444':'var(--muted)'};margin-right:6px;flex-shrink:0">${cnt}Q</span>`:'';
    const click=isEmpty?'':` onclick="toggleTopic('${t.key}','${t.emoji}','${t.name}','${t.type}')"`;
    return `<div class="topic-result-item${sel?' selected':''}${isEmpty?' empty':''}"${click}>
      <div class="topic-result-left"><span>${t.name}</span></div>
      ${badge}<i class="ti ti-check topic-result-check"></i>
    </div>`;
  }).join('');
}

function filterTopics(){
  const val=document.getElementById('topicSearchInput').value;
  document.getElementById('topicSearchClear').style.display=val?'flex':'none';
  renderTopicList(val);
}

function clearTopicSearch(){
  document.getElementById('topicSearchInput').value='';
  document.getElementById('topicSearchClear').style.display='none';
  renderTopicList();
}

function toggleTopic(key,emoji,name,type){
  if(isGeneralSelected){isGeneralSelected=false;updateGeneralUI();}
  const idx=selectedTopics.findIndex(t=>t.key===key);
  if(idx>=0){selectedTopics.splice(idx,1);}else{selectedTopics.push({key,emoji,name,type});}
  renderTopicList(document.getElementById('topicSearchInput').value);
  renderSelectedTags();updateProceedBtn();
}

function toggleGeneral(){
  isGeneralSelected=!isGeneralSelected;
  if(isGeneralSelected){selectedTopics=[];}
  updateGeneralUI();
  renderTopicList(document.getElementById('topicSearchInput').value);
  renderSelectedTags();updateProceedBtn();
}

function updateGeneralUI(){
  document.getElementById('generalCheck').style.opacity=isGeneralSelected?'1':'0';
  document.getElementById('topicGeneralOpt').classList.toggle('selected',isGeneralSelected);
}

function renderSelectedTags(){
  const wrap=document.getElementById('topicSelectedWrap');
  const tags=document.getElementById('topicSelectedTags');
  if(selectedTopics.length===0){wrap.style.display='none';return;}
  wrap.style.display='flex';
  tags.innerHTML=selectedTopics.map(t=>`<div class="topic-tag">${t.name}<button class="topic-tag-remove" onclick="toggleTopic('${t.key}','${t.emoji}','${t.name}','${t.type}')"><i class="ti ti-x"></i></button></div>`).join('');
}

function updateProceedBtn(){
  document.getElementById('topicProceedBtn').disabled=!(selectedTopics.length>0||isGeneralSelected);
}

function switchTopicTab(tab){
  document.getElementById('topicSearchInput').value='';
  document.getElementById('topicSearchClear').style.display='none';
  renderTopicList();
}

function selectDifficulty(diff,el){
  selectedDifficulty=diff;
  document.querySelectorAll('.diff-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
}

function proceedFromTopic(){
  const badge=document.getElementById('selectedTopicBadge');
  const pill=txt=>`<span style="display:inline-flex;align-items:center;gap:6px;background:var(--accent-soft);border:1px solid var(--border2);border-radius:99px;padding:5px 14px;font-size:12px;font-weight:800;color:var(--accent)">${txt}</span>`;
  let pills='';
  if(isGeneralSelected){pills+=pill('🌐 General Anime');}
  else if(selectedTopics.length>0){pills+=selectedTopics.map(t=>pill(t.name)).join('');}
  badge.innerHTML=pills;badge.style.display='flex';
  showTimeLimitPicker(pendingMode);
}


let soloRunId=0;
function startQuiz(mode){
  soloRunId++;
  selectedMode=mode;score=0;lives=mode==='survival'?selectedLives:3;qIndex=0;answered=false;quizHistory=[];prefetchedQuestion=null;currentQData=null;reportedQuestionIds=new Set();
  if(mode==='race'){
    // Solo Score Race: unlimited questions until target score is reached
    selectedQuestionLimit=99999;
  } else {
    if(!selectedQuestionLimit||selectedQuestionLimit<1)selectedQuestionLimit=10;
  }
  const topicLabel=(isGeneralSelected||selectedTopics.length===0)?fmtLabels[selectedFormat]:selectedTopics.map(t=>t.name).join(', ')+' · '+fmtLabels[selectedFormat];
  document.getElementById('hudLabel').textContent=topicLabel+' · '+(mode==='race'?'Score Race':mode==='classic'?'Classic':'Survival');
  document.getElementById('qBadge').textContent=fmtLabels[selectedFormat]+' · '+(mode==='race'?'Score Race':mode==='classic'?'Classic':'Survival');
  goStep('quiz');renderHUD();loadQuestion();
}
function renderHUD(){
  const isSurvival=selectedMode==='survival';
  const isSoloRace=selectedMode==='race';
  const scoreEl=document.getElementById('scoreDisplay');
  // Points only mean something in Score Race (speed); Classic and Survival show a correct count
  scoreEl.textContent=!isSoloRace
    ? quizHistory.filter(h=>h.correct).length+' correct'
    : score+' pts';
  // For solo Score Race, show progress toward target instead of Q count
  if(isSoloRace){
    document.getElementById('qCount').textContent=score+' / '+soloRaceTarget+' pts';
  } else {
    document.getElementById('qCount').textContent='Q'+(qIndex+1)+'/'+selectedQuestionLimit;
  }
  const ld=document.getElementById('livesDisplay');ld.innerHTML='';
  if(isSurvival){const maxLives=selectedLives||3;for(let i=0;i<maxLives;i++){const h=document.createElement('span');h.className='life'+(i>=lives?' lost':'');h.innerHTML='<i class="ti ti-heart"></i>';ld.appendChild(h)}}
}

// ── DAILY QUIZ ───────────────────────────────────────────────
let dailyTimes=[];
const dailyPts=(picks,times)=>picks.reduce((s,c,i)=>s+(c?50+Math.round(50*Math.max(0,1-((times[i]??DAILY_TIME*1000)/1000)/DAILY_TIME)):0),0);
let dailyQs=[],dailyIdx=0,dailyCorrect=0,dailyAnswered=false,dailyPicks=[],dailyTimerInterval=null,dailyTimeLeft=20,dailyStartTime=0;
const DAILY_COUNT=8,DAILY_TIME=20;
function dailyDateKey(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function _dailyHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function _dailyRng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function _dailyShuffle(arr,rng){for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
async function loadDailyQuestions(){
  const rng=_dailyRng(_dailyHash(dailyDateKey()));
  if(!SUPABASE_URL.includes('YOUR_PROJECT')){
    try{
      // daily_questions() picks the day's set once and stores it (daily_sets), so the set
      // can't reshuffle when questions are approved, reported or removed later in the day
      const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/daily_questions`,{method:'POST',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`,'Content-Type':'application/json'},body:JSON.stringify({p_day:dailyDateKey()})});
      const rows=await r.json();
      if(Array.isArray(rows)&&rows.length){
        // Options are still shuffled with the date seed, so everyone sees the same order
        return rows.slice(0,DAILY_COUNT).map(row=>shuffleOptions({id:row.id,question:row.question,options:row.options,answer:row.options?parseInt(row.answer):row.answer,aliases:row.aliases||[],alt_answers:row.alt_answers||[],spoiler:!!row.spoiler},rng));
      }
    }catch(e){}
  }
  // Fallback: deterministic pick (same date seed for everyone) from the backup MC questions
  const fb=(await loadFallbackPool()).map(r=>fallbackRowToQ(r,false));
  return _dailyShuffle(fb,rng).slice(0,DAILY_COUNT).map(q=>shuffleOptions(q,rng));
}
/* in-progress daily run, saved after every question so quitting can't reset it */
const dailyProgKey=()=>'dailyprog_'+dailyDateKey();
function dailyProgGet(){try{return JSON.parse(localStorage.getItem(dailyProgKey())||'null');}catch(e){return null;}}
function dailyProgSave(extra){try{localStorage.setItem(dailyProgKey(),JSON.stringify(Object.assign({idx:dailyIdx,correct:dailyCorrect,picks:dailyPicks,times:dailyTimes,streak:window.dailyStreak||0},extra||{})));}catch(e){}}
function dailyProgClear(){try{localStorage.removeItem(dailyProgKey());}catch(e){}}
/* Signed-in players: copy their saved daily_scores days into the daily_<date> keys this
   browser uses, so "already played today" and the streak follow the account across devices.
   Guests stay browser-only. Per-question picks aren't stored server-side, so synced days
   show "?" squares, which showDailyResult already handles. */
async function dailySyncFromServer(){
  if(!currentUserId||isGuest||typeof sb==='undefined'||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  try{
    const since=new Date(Date.now()-120*86400000);
    const sinceKey=since.getFullYear()+'-'+String(since.getMonth()+1).padStart(2,'0')+'-'+String(since.getDate()).padStart(2,'0');
    const {data,error}=await withTimeout(sb.from('daily_scores').select('day,correct,total,points,time_ms').eq('user_id',currentUserId).gte('day',sinceKey),4000);
    if(error||!Array.isArray(data))return 0;
    let added=0;
    data.forEach(r=>{const k='daily_'+r.day;if(!localStorage.getItem(k)){localStorage.setItem(k,JSON.stringify({correct:r.correct,total:r.total,points:r.points,ms:r.time_ms}));added++;}});
    return added;
  }catch(e){return 0;}
}
async function openDailyQuiz(){
  clearInterval(dailyTimerInterval);dailyAnswered=true;clearTimeout(window._dailyCdT);
  await dailySyncFromServer();
  const key=dailyDateKey();
  let done=null;try{done=JSON.parse(localStorage.getItem('daily_'+key)||'null');}catch(e){}
  if(done){showDailyResult(done.correct,done.total,done.picks||[],true);return;}
  const prog=dailyProgGet();
  goStep('daily');dailyQs=[];
  /* countdown on every fresh question; skipped only when a question's clock is already running (left mid-question) */
  if(prog&&prog.shownIdx===prog.idx&&prog.shownAt){window._dailyLoaded=false;window._dailyCdDone=true;}else dailyCountdown();
  document.getElementById('dailyLoading').style.display='flex';document.getElementById('dailyPips').innerHTML='';
  document.getElementById('dailyQuestionText').style.display='none';
  document.getElementById('dailyAnswers').innerHTML='';
  const qs=await loadDailyQuestions();
  if(!qs||qs.length<1){{clearTimeout(window._dailyCdT);const C=document.getElementById('dailyCd');if(C)C.classList.add('hide');}document.getElementById('dailyLoading').innerHTML='<div style="color:var(--muted);font-size:14px;text-align:center">Couldn\'t load today\'s quiz.<br>Please try again in a moment.</div>';return;}
  dailyQs=qs.slice(0,DAILY_COUNT);dailyIdx=0;dailyCorrect=0;dailyPicks=[];dailyTimes=[];window.dailyStreak=0;
  if(prog){dailyIdx=prog.idx||0;dailyCorrect=prog.correct||0;dailyPicks=prog.picks||[];window.dailyStreak=prog.streak||0;dailyTimes=prog.times||[];
    /* time keeps running while you're away: a question left open past its timer counts as a miss */
    if(prog.shownIdx===dailyIdx&&prog.shownAt&&(Date.now()-prog.shownAt)/1000>=DAILY_TIME){dailyPicks.push(false);dailyTimes.push(DAILY_TIME*1000);window.dailyStreak=0;dailyIdx++;dailyProgSave();}
    if(dailyIdx>=dailyQs.length){dailyFinish();return;}}
  window._dailyLoaded=true;if(window._dailyCdDone)dailyCdFinish();
}
function dailyCountdown(){
  const C=document.getElementById('dailyCd'),N=document.getElementById('dcNum');window._dailyLoaded=false;window._dailyCdDone=false;
  if(!C){window._dailyCdDone=true;return;}clearTimeout(window._dailyCdT);C.classList.remove('hide');
  const steps=['3','2','1','GO!'];let i=0;
  const tick=()=>{if(!document.getElementById('page-daily').classList.contains('active')){C.classList.add('hide');return;}
    if(i>=steps.length){window._dailyCdDone=true;if(window._dailyLoaded)dailyCdFinish();return;}
    N.className='dc-n'+(steps[i]==='GO!'?' go':'');N.textContent=steps[i];void N.offsetWidth;N.style.animation='none';void N.offsetWidth;N.style.animation='';
    const last=steps[i]==='GO!';i++;window._dailyCdT=setTimeout(tick,last?650:800);};
  tick();
}
function dailyCdFinish(){const C=document.getElementById('dailyCd');if(C)C.classList.add('hide');if(document.getElementById('page-daily').classList.contains('active'))dailyShowQuestion();}
function dailyShowQuestion(){
  dailyAnswered=false;
  const q=dailyQs[dailyIdx];
  document.getElementById('dailyLoading').style.display='none';
  const qt=document.getElementById('dailyQuestionText');qt.style.display='block';qt.textContent=q.question||'Question unavailable';
  const label='Q'+(dailyIdx+1)+' / '+dailyQs.length;
  document.getElementById('dailyBadge').textContent='🗓️ DAILY';
  {const cb=document.getElementById('dailyCountBar');if(cb)cb.textContent='Question '+(dailyIdx+1)+' / '+dailyQs.length;}
  qBurstHide('daily');qFavSync('daily');
  document.getElementById('dailyCount').textContent=label;
  document.getElementById('dailyScore').textContent=dailyCorrect+' / '+dailyQs.length;
  dailyRenderPips();
  const panel=document.getElementById('dailyPanel');
  if(panel)panel.className='q-panel q-card';
  const grid=document.getElementById('dailyAnswers');grid.innerHTML='';
  (q.options||[]).forEach((opt,i)=>{
    const b=document.createElement('div');b.className='ans';
    b.innerHTML='<div class="ans-key">'+String.fromCharCode(65+i)+'</div><div class="ans-text">'+opt+'</div>';
    b.onclick=()=>dailyAnswer(i,b);
    grid.appendChild(b);
  });
  applyTheme();
  const p=dailyProgGet();const start=(p&&p.shownIdx===dailyIdx&&p.shownAt)?p.shownAt:Date.now();
  dailyProgSave({shownIdx:dailyIdx,shownAt:start});
  dailyStartTimer(start);
}
function dailyRenderPips(){
  const pips=document.getElementById('dailyPips'), pill=document.getElementById('dailyCount');
  if(!pips)return;
  const total=dailyQs.length||DAILY_COUNT;
  pips.innerHTML=Array.from({length:total},(_,i)=>{
    const cls=i===dailyIdx?'current':dailyPicks[i]===true?'done':dailyPicks[i]===false?'wrong':'';
    return '<div class="q-pip '+cls+'"></div>';
  }).join('');
  if(pill)pill.style.display='none';
}
function dailyAnswer(idx,el){
  if(dailyAnswered)return;dailyAnswered=true;clearInterval(dailyTimerInterval);
  const q=dailyQs[dailyIdx];const correct=idx===q.answer;
  recordAnswerStat(q.id,correct);
  document.querySelectorAll('#page-daily .ans').forEach((a,i)=>{a.classList.add('locked');if(i===q.answer)a.classList.add('correct');else if(i===idx)a.classList.add('wrong');});
  if(correct){dailyCorrect++;sfxCorrect();}else sfxWrong();
  window.dailyStreak=correct?(window.dailyStreak||0)+1:0;
  if(correct&&window.dailyStreak>=2)qBurstShow('gold','<b>+1</b><small>STREAK ×'+window.dailyStreak+'</small>','daily');
  dailyPicks.push(!!correct);dailyTimes.push(Math.min(DAILY_TIME*1000,Date.now()-dailyStartTime));
  document.getElementById('dailyScore').textContent=dailyCorrect+' / '+dailyQs.length;
  const panel=document.getElementById('dailyPanel');
  if(panel)panel.className='q-panel q-card answered '+(correct?'correct':'wrong');
  dailyRenderPips();
  dailyProgSave({idx:dailyIdx+1});
  setTimeout(()=>{if(!document.getElementById('page-daily').classList.contains('active'))return;dailyIdx++;if(dailyIdx>=dailyQs.length)dailyFinish();else dailyShowQuestion();},1100);
}
function dailyStartTimer(start){
  clearInterval(dailyTimerInterval);
  dailyStartTime=start||Date.now();dailyTimeLeft=Math.max(0,DAILY_TIME-(Date.now()-dailyStartTime)/1000);dailyUpdateTimerBar();
  dailyTimerInterval=setInterval(()=>{
    dailyTimeLeft=Math.max(0,DAILY_TIME-(Date.now()-dailyStartTime)/1000);
    dailyUpdateTimerBar();
    if(dailyTimeLeft<=0){clearInterval(dailyTimerInterval);dailyTimeOut();}
  },100);
}
function dailyUpdateTimerBar(){
  const bar=document.getElementById('dailyTimerBar');if(!bar)return;
  const pct=Math.max(0,(dailyTimeLeft/DAILY_TIME)*100);
  const cls=pct<=20?'danger':pct<=50?'warn':'';
  bar.style.height=pct+'%';bar.style.width='';bar.className='q-rail-fill '+cls;
  const num=document.getElementById('dailyTimerNum');
  if(num){num.textContent=Math.ceil(Math.max(0,dailyTimeLeft));num.className='q-rail-num '+cls;}
  return;
  bar.style.width=pct+'%';
  bar.className='timer-bar'+(pct<30?' danger':pct<60?' warn':'');
}
function dailyTimeOut(){
  if(dailyAnswered)return;dailyAnswered=true;
  const q=dailyQs[dailyIdx];
  recordAnswerStat(q.id,false);
  document.querySelectorAll('#page-daily .ans').forEach((a,i)=>{a.classList.add('locked');if(i===q.answer)a.classList.add('correct');});
  sfxWrong();
  window.dailyStreak=0;
  qBurstShow('cream','<img src="assets/ok/bikkuri.png" alt=""><small>TIME\'S UP</small>','daily');
  dailyPicks.push(false);dailyTimes.push(DAILY_TIME*1000);
  dailyProgSave({idx:dailyIdx+1});
  setTimeout(()=>{if(!document.getElementById('page-daily').classList.contains('active'))return;dailyIdx++;if(dailyIdx>=dailyQs.length)dailyFinish();else dailyShowQuestion();},1100);
}
function dailyFinish(){
  clearInterval(dailyTimerInterval);dailyProgClear();
  const points=dailyPts(dailyPicks,dailyTimes),ms=dailyTimes.reduce((a,b)=>a+b,0);
  try{localStorage.setItem('daily_'+dailyDateKey(),JSON.stringify({correct:dailyCorrect,total:dailyQs.length,picks:dailyPicks,times:dailyTimes,points,ms}));}catch(e){}
  window._dailySubmitP=dailySubmitScore({correct:dailyCorrect,total:dailyQs.length,points,ms});
  showDailyResult(dailyCorrect,dailyQs.length,dailyPicks,false);
}
// Walks back from today through the daily_<date> keys to find the current run of
// played days. Today counts only once it is stored, which it always is by the time
// this screen renders.
function dailyStreakInfo(){
  const day=86400000, today=new Date(); today.setHours(0,0,0,0);
  const key=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const played=d=>{try{return !!localStorage.getItem('daily_'+key(d));}catch(e){return false;}};
  let streak=0;
  for(let i=0;;i++){const d=new Date(today.getTime()-i*day);if(!played(d))break;streak++;if(streak>999)break;}
  const week=[];
  for(let i=6;i>=0;i--){const d=new Date(today.getTime()-i*day);week.push(played(d));}
  return {streak,week};
}
function dailyTickCountdown(){
  const el=document.getElementById('dailyCountdown');if(!el)return;
  if(!document.getElementById('page-daily-result').classList.contains('active')){clearInterval(window._dailyCdTimer);window._dailyCdTimer=null;return;}
  const now=new Date(), mid=new Date(now); mid.setHours(24,0,0,0);
  const left=Math.max(0,mid-now), h=Math.floor(left/3600000), m=Math.floor(left%3600000/60000), s=Math.floor(left%60000/1000);
  const p=n=>String(n).padStart(2,'0');
  el.innerHTML=p(h)+':'+p(m)+'<span>:'+p(s)+'</span>';
  const rail=document.getElementById('dailyCountdownRail');
  if(rail)rail.style.width=(100-(left/86400000)*100).toFixed(1)+'%';
}
/* DAILY LEADERBOARD — Supabase table daily_scores:
   create table daily_scores(user_id uuid references auth.users, day date, username text, correct int, total int, points int, time_ms int, streak int, created_at timestamptz default now(), primary key(user_id,day));
   alter table daily_scores enable row level security;
   create policy "read" on daily_scores for select using (true);
   create policy "insert own" on daily_scores for insert with check (auth.uid()=user_id);
   (Scores are computed in the browser for now; move the scoring into an RPC before launch so they can't be forged.) */
let _dailyLbTab='today',_dailyLbData=null;
async function dailySubmitScore(r){
  try{if(!currentUserId||typeof sb==='undefined')return;
    const row={user_id:currentUserId,day:dailyDateKey(),username:currentUser||'Player',avatar_url:dailyMyAvatar(),correct:r.correct,total:r.total,points:r.points,time_ms:r.ms,streak:dailyStreakInfo().streak};
    const opt={onConflict:'user_id,day',ignoreDuplicates:true};
    const {error}=await sb.from('daily_scores').upsert(row,opt);
    if(error&&/avatar_url/.test(error.message||'')){delete row.avatar_url;await sb.from('daily_scores').upsert(row,opt);}
  }catch(e){}}
function dailyFmtTime(ms){const s=ms/1000;return s<60?s.toFixed(1)+'s':Math.floor(s/60)+'m '+String(Math.round(s%60)).padStart(2,'0')+'s';}
async function dailyLoadLb(){
  let me=null;try{me=JSON.parse(localStorage.getItem('daily_'+dailyDateKey())||'null');}catch(e){}
  const myName=currentUser||'You',myStreak=dailyStreakInfo().streak;
  const mine=me?{username:myName,avatar_url:dailyMyAvatar(),points:me.points??me.correct*50,time_ms:me.ms??null,correct:me.correct,streak:myStreak,me:true}:null;
  try{await window._dailySubmitP;}catch(e){}
  let today=null,streaks=null,live=false;
  try{if(typeof sb!=='undefined'&&!SUPABASE_URL.includes('YOUR_PROJECT')){
    const cols='user_id,username,avatar_url,points,time_ms,correct,streak';
    const q=c=>Promise.all([
      sb.from('daily_scores').select(c).eq('day',dailyDateKey()).order('points',{ascending:false}).order('time_ms',{ascending:true}).limit(100),
      sb.from('daily_scores').select(c).eq('day',dailyDateKey()).order('streak',{ascending:false}).limit(100)]);
    let [a,b]=await q(cols);if(a.error||b.error)[a,b]=await q('user_id,username,points,time_ms,correct,streak'); /* before avatar_url column exists */
    if(!a.error&&!b.error&&a.data){live=true;const tag=r=>Object.assign({},r,{me:!!currentUserId&&r.user_id===currentUserId});today=a.data.map(tag);streaks=b.data.map(tag);
      /* always show yourself (guests, or before your insert is visible) */
      if(mine&&!today.some(r=>r.me)){today.push(mine);today.sort((x,y)=>y.points-x.points||(x.time_ms??Infinity)-(y.time_ms??Infinity));}
      if(mine&&!streaks.some(r=>r.me)){streaks.push(mine);streaks.sort((x,y)=>y.streak-x.streak);}}
  }}catch(e){}
  if(!live){ /* leaderboard couldn't load: show just your own row, never made-up players */
    today=mine?[mine]:[];streaks=mine?[mine]:[];}
  _dailyLbData={today,streaks,live};dailyRenderLb();
}
function dailyLbTab(t){_dailyLbTab=t;document.querySelectorAll('.dr-lb-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.lb===t));dailyRenderLb();}
function dailyAvHTML(name,url){
  const P=['#e8630a','#7c5cff','#16a34a','#db2777','#0891b2','#ca8a04','#dc2626','#2563eb'];let x=0;for(const c of String(name||''))x=(x*31+c.charCodeAt(0))|0;const col=P[Math.abs(x)%P.length];
  const ini=String(name||'?').trim().charAt(0).toUpperCase()||'?';const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  if(url&&url.startsWith('preset:')&&typeof PFP_PRESETS!=='undefined'){const p=PFP_PRESETS.find(q=>q.id===url.slice(7));if(p&&p.src)return '<span class="dr-lb-av" style="background:'+(p.bg||col)+'"><img src="'+esc(p.src)+'" alt="" style="object-fit:contain" onerror="this.remove()"></span>';if(p)return '<span class="dr-lb-av" style="background:'+(p.bg||col)+'">'+esc(p.name.charAt(0))+'</span>';}
  if(url&&!url.startsWith('preset:'))return '<span class="dr-lb-av" style="background:'+col+'"><img src="'+esc(url)+'" alt="" style="object-fit:cover" onerror="this.remove()"></span>';
  return '<span class="dr-lb-av" style="background:'+col+'">'+esc(ini)+'</span>';
}
function dailyMyAvatar(){try{if(!currentPfp)return null;if(currentPfp.type==='preset')return 'preset:'+currentPfp.value;const v=currentPfp.value||'';return v.startsWith('data:')?null:v;}catch(e){return null;}}
(function(){let lock=false;document.addEventListener('scroll',e=>{const t=e.target;if(lock||!t.matches||!t.matches('[data-lbsync]'))return;lock=true;document.querySelectorAll('[data-lbsync]').forEach(o=>{if(o!==t)o.scrollTop=t.scrollTop;});requestAnimationFrame(()=>lock=false);},true);})();
function dailyRenderLb(){
  const A=document.getElementById('dailyLb'),B=document.getElementById('dailyLbStreak'),ft=document.getElementById('dailyLbFoot');if(!A||!B||!_dailyLbData)return;
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const row=(r,i,st)=>'<div class="dr-lb-row'+(r.me?' me':'')+'"><span class="dr-lb-rk">'+(i+1)+'</span><span class="dr-lb-who">'+dailyAvHTML(r.username,r.avatar_url)+'<span class="dr-lb-nm">'+esc(r.username)+(r.me?' (you)':'')+'</span></span><span class="dr-lb-v">'
    +(st?'<b>'+r.streak+'</b><small>'+(r.streak===1?'DAY':'DAYS')+'</small>':'<small>'+(r.time_ms==null?'—':dailyFmtTime(r.time_ms))+'</small><b>'+r.points+'</b>')+'</span></div>';
  const empty='<div class="dr-lb-foot">No one has finished today\'s set yet.</div>';
  A.innerHTML=_dailyLbData.today.length?_dailyLbData.today.map((r,i)=>row(r,i,false)).join(''):empty;
  B.innerHTML=_dailyLbData.streaks.length?_dailyLbData.streaks.map((r,i)=>row(r,i,true)).join(''):empty;
  ft.textContent=_dailyLbData.live?'':'Couldn\'t load the leaderboard right now. Try again in a moment.';ft.style.display=_dailyLbData.live?'none':'';
}
function showDailyResult(correct,total,picks,already){
  goStep('daily-result');dailyLoadLb();
  const pct=total?correct/total:0;
  const verdict=pct>=1?'Flawless.':pct>=.875?'Sharp eye.':pct>=.625?'Solid round.':pct>=.375?'Half of them got you.':'Rough set.';
  document.getElementById('dailyRankTitle').textContent=verdict;
  document.getElementById('dailyResultScore').textContent=correct;
  document.getElementById('dailyResultTotal').textContent=' / '+total;
  document.getElementById('dailyRankBadge').textContent=pct>=1?'🏆':pct>=.75?'🌟':'✨';

  const d=new Date(), days=['SUN','MON','TUE','WED','THU','FRI','SAT'], mons=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  document.getElementById('dailyTicketTag').textContent='🗓️ DAILY · '+days[d.getDay()]+' '+d.getDate()+' '+mons[d.getMonth()]+' '+d.getFullYear();

  // Legacy day-lock entries were stored without per-question picks, so a short or
  // missing array must read as "not recorded" rather than as eight wrong answers.
  const p=Array.isArray(picks)?picks:[];
  const known=p.length===total;
  document.getElementById('dailySquares').innerHTML=Array.from({length:total},(_,i)=>
    '<div class="dr-mk '+(known?(p[i]?'hit':'miss'):'unknown')+'">'+(known?'<img src="assets/ok/'+(p[i]?'maru':'batsu')+'.png" alt="'+(p[i]?'Correct':'Missed')+'">':'<span class="dr-mk-q">?</span>')+'<small>Q'+(i+1)+'</small></div>').join('');
  document.getElementById('dailySqLegend').textContent=known
    ? '○ CORRECT · × MISSED'
    : "PER-QUESTION RESULTS WEREN'T SAVED FOR THIS DAY";
  const missed=known?p.map((c,i)=>c?null:'Q'+(i+1)).filter(Boolean):[];
  document.getElementById('dailyMissed').textContent=!known?'':missed.length?'MISSED: '+missed.join(' · '):'CLEAN SWEEP';
  const squares=known?p.map(c=>c?'🟩':'🟥').join(''):'';
  const shareSq=document.getElementById('dailyShareSquares');
  shareSq.textContent=squares;shareSq.style.display=known?'':'none';
  // Clear any confirmation state left over from a previous visit to this screen.
  clearTimeout(window._dailyShareTimer);
  if(window._dailyShareReset)window._dailyShareReset();
  const fb=document.getElementById('dailyShareFallback');
  if(fb){fb.style.display='none';fb.value='';}

  const st=dailyStreakInfo();
  document.getElementById('dailyStreakN').textContent=st.streak;
  document.getElementById('dailyStreakL').textContent=st.streak===1?'DAY':'DAYS';
  document.getElementById('dailyWeek').innerHTML=st.week.map((on,i)=>
    '<div class="'+(on?'on':'')+(i===6?' today':'')+'"></div>').join('');

  document.getElementById('dailyResultSub').textContent=already
    ? 'You already played today — this is the card you earned. A fresh set lands at midnight.'
    : 'One set a day, the same eight questions for everyone.';

  window._dailyShare={correct,total,picks};
  dailyTickCountdown();
  clearInterval(window._dailyCdTimer);
  window._dailyCdTimer=setInterval(dailyTickCountdown,1000);
  if(pct>=.75)launchConfetti();
  applyTheme();
}
// Clipboard API is blocked in a lot of embedded/insecure contexts, so fall back to
// a hidden textarea + execCommand and report honestly either way.
function copyTextToClipboard(text){
  if(navigator.clipboard&&window.isSecureContext){
    return navigator.clipboard.writeText(text).then(()=>true).catch(()=>legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}
function legacyCopy(text){
  try{
    const ta=document.createElement('textarea');
    ta.value=text;ta.setAttribute('readonly','');
    ta.style.cssText='position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,ta.value.length);
    const ok=document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }catch(e){return false;}
}
// Swaps the share row into a confirmation state: icon becomes a check, the title and
// sub-line say what happened, the card turns green. Reverts after 2.4s.
function dailyShareFeedback(ok,text){
  const btn=document.querySelector('.dr-share');if(!btn)return;
  if(btn.dataset.busy)return;
  btn.dataset.busy='1';
  const icon=btn.querySelector('i'), title=btn.querySelector('.dr-share-t span'), sub=btn.querySelector('.dr-share-s');
  const oIcon=icon.className, oTitle=title.textContent, oSub=sub.textContent;
  icon.className=ok?'ti ti-circle-check':'ti ti-alert-triangle';
  icon.style.color=ok?'#4ade80':'#fbbf24';
  title.textContent=ok?'Copied to your clipboard':'Copy blocked — select and copy';
  sub.textContent=ok?'Paste it anywhere: '+text.split('\n')[1].trim():'Your browser wouldn\'t let the page write to the clipboard.';
  btn.style.borderColor=ok?'#4ade80':'#fbbf24';
  clearTimeout(window._dailyShareTimer);
  window._dailyShareReset=()=>{
    icon.className=oIcon;icon.style.color='';
    title.textContent=oTitle;sub.textContent=oSub;
    btn.style.borderColor='';delete btn.dataset.busy;
    window._dailyShareReset=null;
  };
  window._dailyShareTimer=setTimeout(()=>{if(window._dailyShareReset)window._dailyShareReset();},2400);
  // When the browser refuses the write, put the text on screen, pre-selected, so
  // the player can copy it by hand instead of being told to copy nothing.
  const fb=document.getElementById('dailyShareFallback');
  if(fb){
    if(ok){fb.style.display='none';}
    else{
      fb.style.display='block';fb.value=text;
      try{fb.focus();fb.select();fb.setSelectionRange(0,fb.value.length);}catch(e){}
    }
  }
}
function shareDaily(ev){
  const s=window._dailyShare;if(!s)return;
  const picks=Array.isArray(s.picks)?s.picks:[];
  const squares=picks.length===s.total?picks.map(c=>c?'🟩':'🟥').join(''):'';
  const text='Anime Sekai: Daily Quiz 🎌\n'+s.correct+'/'+s.total+(squares?'  '+squares:'')+'\n'+location.origin+location.pathname;
  if(navigator.share){
    navigator.share({title:'Anime Sekai Daily',text:text})
      .catch(()=>{copyTextToClipboard(text).then(ok=>dailyShareFeedback(ok,text));});
    return;
  }
  copyTextToClipboard(text).then(ok=>dailyShareFeedback(ok,text));
}
// Re-orders qData.options into a random shuffle and remaps qData.answer so it
// still points at the correct option by index. Leaves type-answer questions
// (no options array) untouched. Returns a new object — does not mutate qData.
function shuffleOptions(qData,rng){
  if(!qData||!Array.isArray(qData.options)||typeof qData.answer!=='number')return qData;
  const rand=rng||Math.random;
  const correctOpt=qData.options[qData.answer];
  const opts=[...qData.options];
  // Fisher-Yates shuffle
  for(let i=opts.length-1;i>0;i--){
    const j=Math.floor(rand()*(i+1));
    [opts[i],opts[j]]=[opts[j],opts[i]];
  }
  return {...qData, options:opts, answer:opts.indexOf(correctOpt)};
}
async function fetchQuestion(){
  const _t=selectedTopics.length>0?selectedTopics[Math.floor(Math.random()*selectedTopics.length)]:null;
  // char-mc fetches char questions but builds MC options from distractors
  const fetchFmt = selectedFormat==='char-mc' ? 'char' : selectedFormat;
  const parts=_t&&(fetchFmt==='mc'||fetchFmt==='type'||fetchFmt==='char')?activeTopicParts(_t.name):[];
  const bankTopic=_t?{type:_t.type,value:_t.name,parts}:{type:'all',value:'',parts:[]};
  loadFallbackPool(); // background: have the backup questions in memory before they're needed
  const banked=await sbGetQuestion(fetchFmt,bankTopic);
  if(banked){
    /*if(currentUserId)sbMarkSeen(currentUserId,banked.id);*/
    if(selectedFormat==='char-mc') return buildCharMcQuestion(banked);
    return shuffleOptions(banked);
  }
  // sbGetQuestion returned null: the request failed (sbQuestionFailed) or this pick
  // simply has no questions it can serve. Either way show a backup question from the
  // same topic and say which case it was. char-mc falls back to a Text MC question.
  const fbFmt=selectedFormat==='char-mc'?'mc':fetchFmt;
  const fb=await getFallback(fbFmt,_t?_t.name:null,parts);
  return {...shuffleOptions(fb),is_fallback:sbQuestionFailed?'db':'empty'};
}
// Small hint shown near a question that came from the local fallback pool
// instead of matching the player's selected topic — see fetchQuestion() above.
/* Series tag above the question — every format except Guess the Scene (it would give the answer away). */
/* Topic logo watermark (3a): replaces the series pill when a logo exists. Same give-away rule as the pill.
   Add a logo: drop a transparent PNG in assets/logos/ and map the lower-case topic name here. */
const TOPIC_LOGOS={'one piece':'assets/logos/one-piece.png'};
function topicLogo(qData){
  if(!qData||qData.topic_type!=='anime'||!qData.topic_value)return null;
  if(selectedFormat==='scene')return null;
  return TOPIC_LOGOS[String(qData.topic_value).trim().toLowerCase()]||null;
}
function setTopicMark(panelId,qData){
  const p=document.getElementById(panelId);if(!p)return;
  let m=p.querySelector(':scope>.q-watermark');
  const src=topicLogo(qData);
  if(!src){if(m)m.remove();return;}
  if(!m){m=document.createElement('div');m.className='q-watermark';m.setAttribute('aria-hidden','true');p.prepend(m);}
  m.style.webkitMaskImage=m.style.maskImage='url("'+src+'")';
}
/* Guess the Scene: the logo appears only once the answer is revealed. */
function sceneLogoHTML(qData){
  if(selectedFormat!=='scene'||!qData||qData.topic_type!=='anime'||!qData.topic_value)return '';
  const src=TOPIC_LOGOS[String(qData.topic_value).trim().toLowerCase()];
  return src?'<img class="q-reveal-logo" src="'+src+'" alt="'+String(qData.topic_value).replace(/"/g,'&quot;')+'">':'';
}
function seriesTagHTML(qData){
  if(!qData||qData.topic_type!=='anime'||!qData.topic_value)return '';
  if(selectedFormat==='scene')return '';
  if(topicLogo(qData))return '';
  const esc=String(qData.topic_value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  return '<div class="q-series"><i class="ti ti-movie"></i><span>'+esc+'</span></div>';
}
function fallbackHintHTML(qData){
  if(!qData?.is_fallback)return '';
  const msg=qData.is_fallback==='empty'?'No more questions for this pick. Showing a backup question.':'Couldn\'t reach the database. Showing a backup question.';
  return '<div class="q-fallback-hint"><i class="ti ti-alert-triangle" style="font-size:12px"></i> '+msg+'</div>';
}
// Spoilers: solo follows the player's own switch (localStorage, plus profiles.hide_spoilers when
// signed in); a lobby follows the host's setting, which mp_advance_question also reads server-side.
let soloHideSpoilers=false;try{soloHideSpoilers=localStorage.getItem('as_hide_spoilers')==='1';}catch(e){}
let lobbyHideSpoilers=false;
function spoilersHidden(){return currentLobbyId?lobbyHideSpoilers:soloHideSpoilers;}
// Only ever shows when spoilers are allowed, since hidden ones are never drawn
function spoilerTagHTML(qData){return qData&&qData.spoiler?'<div class="q-spoiler">⚠ Spoiler</div>':'';}
function suSyncSpoilers(){const b=document.getElementById('suSpoil');if(b){b.classList.toggle('on',soloHideSpoilers);b.setAttribute('aria-pressed',String(soloHideSpoilers));}}
function suToggleSpoilers(){
  soloHideSpoilers=!soloHideSpoilers;
  try{localStorage.setItem('as_hide_spoilers',soloHideSpoilers?'1':'0');}catch(e){}
  suSyncSpoilers();
  prefetchedQuestion=null;
  if(currentUserId&&!isGuest&&!SUPABASE_URL.includes('YOUR_PROJECT'))sb.from('profiles').update({hide_spoilers:soloHideSpoilers}).eq('id',currentUserId).then(()=>{},()=>{});
}
suSyncSpoilers();

// Parts (Naruto Part 1 / Shippuden, JoJo parts…). Picks are kept per topic name, apart from the
// topic objects, since those get rebuilt in many places; no entry means "All parts". Parts only
// narrow Text questions (mc/type) — character and scene questions cover the whole show.
const PART_MIN_QUESTIONS=20; // a thinner part is greyed out so games don't loop on a few questions
let topicPartsByName={};     // topic name -> [{id,name,n}] in story order, from topic_part_counts()
let soloTopicParts={}, lobbyTopicParts={}; // topic name -> [part ids]; the lobby's copy is saved in lobbies.settings.topicParts
async function loadTopicParts(){
  if(SUPABASE_URL.includes('YOUR_PROJECT'))return;
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/topic_part_counts`,{method:'POST',headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`,'Content-Type':'application/json'},body:'{}'});
    const rows=await r.json();
    if(!Array.isArray(rows))return;
    const m={};
    rows.forEach(p=>{(m[p.topic_value]=m[p.topic_value]||[]).push({id:p.id,name:p.name,n:Number(p.n)||0,mc:Number(p.n_mc)||0,type:Number(p.n_type)||0,char:Number(p.n_char)||0});});
    topicPartsByName=m;
    if(typeof suFootSync==='function')suFootSync();
    if(typeof gsRenderPicked==='function'&&document.getElementById('gsPickedLabel'))gsRenderPicked();
  }catch(e){}
}
// Part ids in play for a topic right now (thin parts are never sent, even if a stale pick names one)
function activeTopicParts(name){
  const ids=(currentLobbyId?lobbyTopicParts:soloTopicParts)[name]||[];
  const ok=new Set((topicPartsByName[name]||[]).filter(p=>p.n>=PART_MIN_QUESTIONS).map(p=>p.id));
  return ids.filter(id=>ok.has(id));
}
// fmtKey: 'mc' or 'type' (the answer style being played), 'char' for Characters (rows tagged with
// part_ids; untagged ones play in every part), or null to hide the row for other formats.
// Chips show that style's count, matching the footer; greying out still uses both Text styles together.
function partsRowHTML(topics,map,fmtKey,handler){
  if(fmtKey==='char-mc')fmtKey='char';
  if(fmtKey!=='mc'&&fmtKey!=='type'&&fmtKey!=='char')return '';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return (topics||[]).filter(t=>t&&topicPartsByName[t.name]).map(t=>{
    const sel=new Set(map[t.name]||[]), nm=esc(t.name);
    const chip=(label,on,part,thin,n)=>'<button class="pt-chip'+(on?' on':'')+'" data-topic="'+nm+'" data-part="'+part+'"'
      +(thin?' disabled title="Only '+n+' Text question'+(n===1?'':'s')+' so far, needs '+PART_MIN_QUESTIONS+'"':'')+' onclick="'+handler+'(this)">'+label+'</button>';
    return '<div class="pt-row"><span class="pt-topic">'+nm+'</span>'
      +chip('All parts',!sel.size,'',false)
      +topicPartsByName[t.name].map(p=>chip(esc(p.name)+' <i>'+(p[fmtKey]||0)+'</i>',sel.has(p.id),p.id,p.n<PART_MIN_QUESTIONS,p.n)).join('')
      +'</div>';
  }).join('');
}
function togglePartIn(map,btn){
  const name=btn.dataset.topic, id=btn.dataset.part;
  if(!id){delete map[name];return;}
  const cur=new Set(map[name]||[]);
  if(cur.has(id))cur.delete(id);else cur.add(id);
  if(cur.size)map[name]=[...cur];else delete map[name];
}
function suTogglePart(btn){togglePartIn(soloTopicParts,btn);prefetchedQuestion=null;suFootSync();}
function gsTogglePart(btn){if(!isHost)return;togglePartIn(lobbyTopicParts,btn);prefetchedQuestion=null;gsAfterChange();}
// Only the picked topics' parts are saved, so dropping a topic drops its part picks too
function lobbyTopicPartsForSave(){
  const out={};
  (lobbyTopics||[]).forEach(t=>{if(t&&lobbyTopicParts[t.name]&&lobbyTopicParts[t.name].length)out[t.name]=lobbyTopicParts[t.name].slice();});
  return out;
}
loadTopicParts();

function buildCharMcQuestion(q){
  // q.distractors is an array of 3 wrong character names from the DB
  const distractors = Array.isArray(q.distractors) && q.distractors.length>=3
    ? q.distractors.slice(0,3)
    : ['???','???','???']; // fallback if distractors not yet populated
  // Shuffle correct answer into a random position among the 4 options
  const opts = [...distractors];
  const correctIdx = Math.floor(Math.random()*4);
  opts.splice(correctIdx, 0, q.answer);
  return {...q, options: opts, answer: correctIdx};
}


// Backup questions for when Supabase can't be reached (or a pick has nothing left):
// assets/fallback-questions.json holds 10 non-spoiler MC questions per topic (10 per part on
// parted topics), each with its linked typed copy. Rows: t topic, p part id, q question,
// o options, a correct option index, ta typed answer, tq typed wording (only if different),
// al aliases, alt alt_answers. Loaded once per page, in the background when a game starts,
// so it is already in memory if the connection drops later.
let fallbackPool=null,fallbackPoolLoading=null;
function loadFallbackPool(){
  if(fallbackPool)return Promise.resolve(fallbackPool);
  if(!fallbackPoolLoading)fallbackPoolLoading=fetch('assets/fallback-questions.json')
    .then(r=>r.json()).then(d=>(fallbackPool=Array.isArray(d)?d:[]))
    .catch(()=>{fallbackPoolLoading=null;return [];});
  return fallbackPoolLoading;
}
function fallbackRowToQ(r,typed){
  const base={id:null,spoiler:false,submitted_by:null,topic_value:r.t,topic_type:'anime',media_url:null,distractors:null};
  return typed
    ?{...base,question:r.tq||r.q,answer:r.ta,aliases:r.al||[],alt_answers:r.alt||[],format:'type'}
    :{...base,question:r.q,options:r.o,answer:r.a,aliases:[],alt_answers:[],format:'mc'};
}
// Picks one backup question for the format being played, from the picked topic (and its
// parts) when it has any, else from the whole pool. Typed formats get the typed copy.
async function getFallback(format,topicName,parts){
  const pool=await loadFallbackPool();
  const typed=format==='type'||format==='char'||format==='scene';
  if(!pool.length)return {id:null,question:"Couldn't load a question. Check your connection and try again.",answer:'',aliases:[],alt_answers:[],format:'type'};
  let rows=topicName?pool.filter(r=>r.t===topicName):[];
  if(rows.length&&parts&&parts.length){const inPart=rows.filter(r=>parts.includes(r.p));if(inPart.length)rows=inPart;}
  if(!rows.length)rows=pool;
  const seen=new Set(quizHistory.map(h=>h.q));
  const unseen=rows.filter(r=>!seen.has(typed?(r.tq||r.q):r.q));
  const src=unseen.length?unseen:rows;
  return fallbackRowToQ(src[Math.floor(Math.random()*src.length)],typed);
}

// ── QUESTION BANK ─────────────────────────────────────────────

// Guest seen-question tracking (persists for the browser session)
function guestSeenIds(){
  try{const raw=localStorage.getItem('guest_seen_ids');return raw?JSON.parse(raw):[];}catch(e){return [];}
}
function guestAddSeen(id){
  try{const ids=guestSeenIds();if(!ids.includes(id)){ids.push(id);localStorage.setItem('guest_seen_ids',JSON.stringify(ids));}}catch(e){}
}

// true when the last sbGetQuestion request itself failed (network/server error or a non-list
// reply), false when it got a list back, even an empty one. Picks the fallback hint's wording.
let sbQuestionFailed=false;
async function sbGetQuestion(format,topic){
  if(SUPABASE_URL.includes('YOUR_PROJECT')){sbQuestionFailed=true;return null;}
  sbQuestionFailed=false;
  try{
    // topic.type is 'anime' for a picked topic, or 'all' for General Anime (full pool)
    // Collect ids of questions already shown this session (by id, not text —
    // multiple distinct char questions can share generic question text, so
    // text-based dedup was letting the same row get re-picked).
    const seenIds=new Set(quizHistory.map(h=>h.id).filter(id=>id!=null));
    const lastId=quizHistory.length?quizHistory[quizHistory.length-1].id:null;
    /* SEEN-QUESTIONS DISABLED — re-enable by uncommenting this block and the sbMarkSeen call in fetchQuestion
    let seenIds=guestSeenIds(); // always start with guest-session seen list
    if(currentUserId){
      const seenRes=await fetch(
        `${SUPABASE_URL}/rest/v1/seen_questions?select=question_id&user_id=eq.${currentUserId}&limit=500`,
        {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
      );
      const seenData=await seenRes.json();
      if(Array.isArray(seenData)){
        const dbIds=seenData.map(s=>s.question_id);
        // Merge without duplicates
        seenIds=[...new Set([...seenIds,...dbIds])];
      }
    }
    // Build exclusion filter
    const excludeFilter=seenIds.length?`&id=not.in.(${seenIds.join(',')})`:'';
    */
    // pick_question (SQL function) draws one random row from the whole pool server-side,
    // skipping questions already shown this run; once they're all used it only avoids
    // repeating the last one. Fetching a 500-row pool here used to cap the draw at the
    // same first 500 rows and cost ~300 KB per question.
    const exclude=[...seenIds];
    if(lastId&&exclude[exclude.length-1]!==lastId){exclude.splice(exclude.indexOf(lastId),1);exclude.push(lastId);}
    const qRes=await fetch(`${SUPABASE_URL}/rest/v1/rpc/pick_question`,{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_format:format,p_topic_type:topic.type==='all'?null:topic.type,p_topic_value:topic.type==='all'?null:topic.value,p_exclude:exclude,p_hide_spoilers:spoilersHidden(),p_part_ids:topic.parts&&topic.parts.length?topic.parts:null})
    });
    const data=await qRes.json();
    if(!qRes.ok||!Array.isArray(data)){sbQuestionFailed=true;return null;}
    if(!data.length)return null;
    const row=data[0];
    return {id:row.id,question:row.question||(format==='scene'?SCENE_DEFAULT_QUESTION:row.question),options:row.options,answer:row.options?parseInt(row.answer):row.answer,aliases:row.aliases||[],alt_answers:row.alt_answers||[],spoiler:!!row.spoiler,submitted_by:row.submitted_by||null,topic_value:row.topic_value||null,topic_type:row.topic_type||null,media_url:row.media_url||null,distractors:row.distractors||null,format:row.format||format};
  }catch(e){sbQuestionFailed=true;return null}
}

async function sbMarkSeen(userId,questionId){
  // Always record in guest session storage so guests also avoid repeats
  guestAddSeen(questionId);
  if(!userId)return;
  try{
    const token=await rtGetAuthToken();
    await fetch(`${SUPABASE_URL}/rest/v1/seen_questions`,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON,'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'
      },
      body:JSON.stringify({user_id:userId,question_id:questionId})
    });
  }catch(e){}
}
// Mirrors mp_match_answer() in Supabase rule for rule — change both together or solo and
// multiplayer will disagree. Returns {text,alt} for the answer that matched, or null.
// The main answer and its aliases are checked first, then each alt_answers entry in order.
// Long-vowel folding (ou/oo/uu -> o/u) runs only for Name the Character questions, where
// answers are Japanese names ("Bakugou" = "Bakugo"). Everywhere else it would let English
// misspellings through ("For" for "Four", "God" for "Good"), so other questions list their
// spelling variants as aliases instead.
function answerFoldsVowels(qData){
  if(qData&&qData.format)return qData.format==='char';
  return typeof selectedFormat!=='undefined'&&(selectedFormat==='char'||selectedFormat==='char-mc');
}
function answerMatch(userInput,qData){
  const normalize=s=>String(s??'').toLowerCase().trim().replace(/-/g,' ').replace(/[^a-z0-9\s]/gi,'').replace(/\s+/g,' ').trim();
  // Collapse common romanization long-vowel variants so ou/uu/oo match o/u bidirectionally
  // (character questions only; elsewhere this is plain normalize so the check below is a no-op)
  const fold=answerFoldsVowels(qData);
  const deRomanize=s=>fold?normalize(s).replace(/ou/g,'o').replace(/oo/g,'o').replace(/uu/g,'u'):normalize(s);
  // For two-word names, sort the words alphabetically so "first last" and "last first" compare equal
  const nameOrderKey=s=>{const w=normalize(s).split(' ').filter(Boolean);return w.length===2?[...w].sort().join(' '):normalize(s);};
  const userN=normalize(userInput);
  if(!userN)return null;
  const userR=deRomanize(userInput);
  const userO=nameOrderKey(userInput);
  const hits=list=>list.some(a=>a&&(normalize(a)===userN||deRomanize(a)===userR||nameOrderKey(a)===userO));
  const canonical=qData.options?qData.options[qData.answer]:(qData.answer||'');
  if(hits([...(Array.isArray(qData.aliases)?qData.aliases:[]),canonical]))return{text:canonical,alt:false};
  if(qData.options)return null; // alt answers only apply to typed questions
  for(const e of (Array.isArray(qData.alt_answers)?qData.alt_answers:[])){
    const text=typeof e==='string'?e:e&&e.text;
    if(!text)continue;
    if(hits([...(e&&Array.isArray(e.aliases)?e.aliases:[]),text]))return{text,alt:true};
  }
  return null;
}
function checkAnswer(userInput,qData){return !!answerMatch(userInput,qData);}
// Name the Character nudge: a wrong typed answer that is one word of the character's own
// name (usually a surname, e.g. "Namikaze" for Minato, "Hatake" for Kakashi) isn't accepted
// on its own, but the player clearly knows who it is, so the wrong-answer hint says so.
// Wrong guesses never reach the server, so this is display-only and works the same in
// solo and multiplayer.
function answerNameNudge(userInput,qData){
  if(!qData||qData.options||!answerFoldsVowels(qData))return false;
  const fold=s=>String(s??'').toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/ou/g,'o').replace(/oo/g,'o').replace(/uu/g,'u').trim();
  const typed=fold(userInput);
  if(typed.length<2||/\s/.test(typed))return false;
  const skip=['no','of','the','de','von','van','d','san','kun','chan'];
  const words=String(qData.answer||'').split(/\s+/).map(fold).filter(w=>w.length>=2&&!skip.includes(w));
  return words.length>1&&words.includes(typed);
}
// Points at the first name only, so players learn to answer with first names.
const NAME_NUDGE_HTML='<i class="ti ti-bulb" style="font-size:12px"></i> Almost! Try their first name.';
function setWrongHint(hint,nudge){
  if(!hint)return;
  if(hint.dataset.defaultHtml==null){hint.dataset.defaultHtml=hint.innerHTML;hint.dataset.defaultColor=hint.style.color||'';}
  hint.innerHTML=nudge?NAME_NUDGE_HTML:hint.dataset.defaultHtml;
  hint.style.color=nudge?'#fbbf24':hint.dataset.defaultColor;
  hint.style.display='block';
}
// Answer block for the revealed question card. A player who typed an alt answer sees it
// first with the main answer under "Also correct"; anyone else sees the main answer plus every alt.
function answerRevealHTML(correctAns,qData,match){
  const alts=(!qData||qData.options||!Array.isArray(qData.alt_answers))?[]:qData.alt_answers.map(e=>typeof e==='string'?e:e&&e.text).filter(Boolean);
  if(match&&match.alt)return`<div class="q-answer-reveal">${match.text}</div><div class="q-answer-also">Also correct: ${correctAns}</div>`;
  const also=match?'':(alts.length?`<div class="q-answer-also">Also correct: ${alts.join(', ')}</div>`:'');
  return`<div class="q-answer-reveal">${correctAns}</div>${also}`;
}
async function loadQuestion(){
  answered=false;
  clearInterval(soloAutoNextInterval);soloAutoNextPaused=false;
  document.getElementById('qCardFeedback').style.display='none';
  document.getElementById('answersGrid').innerHTML='';
  document.getElementById('questionText').style.display='none';
  document.getElementById('qLoading').style.display='flex';
  const _iw=document.getElementById('qImageWrap');const _ie=document.getElementById('qImage');
  if(_iw){_iw.style.display='none';}if(_ie){_ie.onload=null;_ie.onerror=null;_ie.src='';}
  const qCard=document.querySelector('#page-quiz .q-card');
  if(qCard){qCard.classList.remove('type-mode','shake','answered');}
  renderHUD();
  const run=soloRunId;
  const qData=prefetchedQuestion||await fetchQuestion();
  // Bail if the player navigated away from the solo quiz page, or started a new run, while this was loading
  if(run!==soloRunId||!document.getElementById('page-quiz')?.classList.contains('active'))return;
  prefetchedQuestion=null;currentQData=qData;
  showQuestion(qData);
  // A prefetch that lands after a new run started belongs to the old run's format/topic — drop it
  fetchQuestion().then(q=>{if(run===soloRunId)prefetchedQuestion=q});
}
/* §7: which of the three arrangements this question uses. Scene and character only
   claim their layout when an image actually arrives — a scene question whose still
   failed to load falls back to §3's plain panel rather than an empty caption frame. */
function qStageFormat(fmt,qData){
  const stage=document.querySelector('#page-quiz .quiz-stage')||document.querySelector('#page-daily .quiz-stage');
  if(!stage)return;
  stage.classList.remove('fmt-scene','fmt-char','fmt-img');
  if(!qData||!qData.media_url)return;
  if(fmt==='scene')stage.classList.add('fmt-scene');
  else if(fmt==='char'||fmt==='char-mc')stage.classList.add('fmt-char');
  else stage.classList.add('fmt-img'); // a Text question with a picture (a crest, a jutsu still)
}
function showQuestion(qData){
  qStageFormat(selectedFormat,qData);
  document.getElementById('questionText').innerHTML=seriesTagHTML(qData)+spoilerTagHTML(qData)+(qData.question||'Question unavailable')+fallbackHintHTML(qData);
  setTopicMark('questionArea',qData);
  const imgWrap=document.getElementById('qImageWrap');
  const imgEl=document.getElementById('qImage');
  const grid=document.getElementById('answersGrid');grid.innerHTML='';grid.style.display='none';
  const isType=(selectedFormat==='type'||selectedFormat==='char'||selectedFormat==='scene')&&selectedFormat!=='char-mc'||(!qData.options&&typeof qData.answer==='string'&&selectedFormat!=='char-mc');
  let focusEl=null;
  if(isType){
    document.querySelector('.q-card').classList.add('type-mode');
    const wrap=document.createElement('div');wrap.className='type-wrap';
    wrap.innerHTML=`<div class="type-input-row"><input id="typeInput" class="type-input" type="text" placeholder="Type your answer..." autocomplete="off"><button class="type-submit" id="typeSubmitBtn" onclick="checkTypeAnswer()"><i class="ti ti-check" style="font-size:15px"></i> Submit</button></div><div id="typeWrongHint" style="font-size:12px;color:#f87171;font-weight:700;display:none;margin-top:4px"><i class="ti ti-x" style="font-size:12px"></i> Not quite, try again!</div>`;
    grid.appendChild(wrap);applyTheme();
    document.getElementById('typeInput').addEventListener('keydown',e=>{if(e.key==='Enter')checkTypeAnswer()});
    focusEl=document.getElementById('typeInput');
  } else {
    (qData.options||[]).forEach((opt,i)=>{
      const d=document.createElement('div');d.className='ans';
      d.innerHTML=`<span class="ans-key">${keys[i]}</span><span class="ans-text">${opt}</span>`;
      d.onclick=()=>answerMC(i,d,qData);grid.appendChild(d);
    });
  }
  quizHistory.push({q:qData.question,correctAns:qData.options?qData.options[qData.answer]:qData.answer,userAns:null,correct:null,id:qData.id||null,topic:qData.topic_value||null});
  // Keep the "Generating question" spinner on screen — and the question text/answers
  // hidden — until the image (if any) has actually finished loading. Revealing the
  // text and image together avoids the layout jump/glitch of the card popping the
  // image in after the answers were already visible, and also means the timer never
  // burns time on a blank image while it downloads.
  const revealQuestion=()=>{
    document.getElementById('qLoading').style.display='none';
    document.getElementById('questionText').style.display='block';
    grid.style.display='';
    if(focusEl)focusEl.focus();
    startTimer();
  };
  if(qData.media_url){
    imgEl.onload=null;imgEl.onerror=null;
    imgWrap.style.display='flex';imgEl.style.visibility='hidden';
    imgEl.onload=()=>{imgEl.style.visibility='visible';revealQuestion();};
    imgEl.onerror=()=>{imgWrap.style.display='none';qStageFormat(null,null);revealQuestion();};
    imgEl.src=qData.media_url;
    if(imgEl.complete&&imgEl.naturalWidth>0){imgEl.onload=null;imgEl.onerror=null;imgEl.style.visibility='visible';revealQuestion();}
  } else {
    imgWrap.style.display='none';imgEl.src='';
    revealQuestion();
  }
}
function answerMC(idx,el,qData){
  if(answered)return;answered=true;clearInterval(timerInterval);
  const allAns=document.querySelectorAll('.ans');allAns.forEach(a=>a.classList.add('locked'));
  const correct=idx===qData.answer;
  recordAnswerStat(qData.id,correct);
  const mcElapsed=(Date.now()-questionStartTime)/1000;
  const mcPts=selectedMode==='race'?calcSpeedPoints(mcElapsed,raceTimeLimit):1; // Classic/Survival: 1 per correct answer
  if(correct){el.classList.add('correct');score+=mcPts;lastPtsEarned=mcPts;}
  else{el.classList.add('wrong');allAns[qData.answer].classList.add('correct');lives--;lastPtsEarned=0;}
  quizHistory[quizHistory.length-1].userAns=qData.options[idx];
  quizHistory[quizHistory.length-1].correct=correct;
  showFeedback(correct,qData.options[qData.answer],qData.options[idx]);
  renderHUD();
}
function checkTypeAnswer(){
  if(answered)return;
  const input=document.getElementById('typeInput');
  if(!input||!input.value.trim())return;
  const userAns=input.value.trim();
  const match=answerMatch(userAns,currentQData);
  const correct=!!match;
  if(match)currentQData._match=match;
  const canonicalAns=currentQData.answer||'';
  if(!correct){
    sfxWrongAttempt();
    // Wrong — shake card, flash red, clear input, allow retry
    const card=document.querySelector('.q-card');
    input.classList.add('wrong-attempt');
    card.classList.add('shake');
    const hint=document.getElementById('typeWrongHint');
    setWrongHint(hint,answerNameNudge(userAns,currentQData));
    setTimeout(()=>{
      input.classList.remove('wrong-attempt');
      card.classList.remove('shake');
      input.value='';
      input.focus();
    },400);
    return;
  }
  // Correct — lock and show feedback
  answered=true;clearInterval(timerInterval);
  recordAnswerStat(currentQData&&currentQData.id,true);
  input.disabled=true;input.classList.add('correct-input');
  document.getElementById('typeSubmitBtn').disabled=true;
  const hint=document.getElementById('typeWrongHint');if(hint)hint.style.display='none';
  const taElapsed=(Date.now()-questionStartTime)/1000;
  const taPts=selectedMode==='race'?calcSpeedPoints(taElapsed,raceTimeLimit):1;
  score+=taPts;lastPtsEarned=taPts;
  quizHistory[quizHistory.length-1].userAns=userAns;
  quizHistory[quizHistory.length-1].correct=true;
  if(match.alt)quizHistory[quizHistory.length-1].correctAns=match.text;
  showFeedback(true,canonicalAns,userAns);
  renderHUD();
}
function timeOut(){
  if(answered)return;answered=true;
  recordAnswerStat(currentQData&&currentQData.id,false);
  document.querySelectorAll('.ans').forEach(a=>a.classList.add('locked'));
  const inp=document.getElementById('typeInput');if(inp){inp.disabled=true;inp.classList.remove('wrong-attempt');}
  const submitBtn=document.getElementById('typeSubmitBtn');if(submitBtn)submitBtn.disabled=true;
  const hint=document.getElementById('typeWrongHint');if(hint)hint.style.display='none';
  document.querySelector('.q-card')?.classList.remove('shake');
  // Time running out always costs a life
  lives--;
  renderHUD();
  const last=quizHistory[quizHistory.length-1];
  if(last){last.userAns='(timed out)';last.correct=false;}
  showFeedback(false,last?.correctAns||'?','(timed out)',"Time's up!");
}
let soloAutoNextInterval=null;
let soloAutoNextPaused=false;

function startSoloAutoNext(){
  clearInterval(soloAutoNextInterval);
  soloAutoNextPaused=false;
  let t=5;
  const el=document.getElementById('soloAutoNext');
  if(el)el.textContent=`Next in ${t}s`;
  soloAutoNextInterval=setInterval(()=>{
    if(soloAutoNextPaused)return;
    t--;
    if(el)el.textContent=t>0?`Next in ${t}s`:'';
    if(t<=0){clearInterval(soloAutoNextInterval);nextQuestion();}
  },1000);
}

/* ONE CARD: counter bar mirrors #qCount; ♡ is per question (saved on this device); reveal bursts */
(function(){
  const src=document.getElementById('qCount'),dst=document.getElementById('qCountBar');
  if(src&&dst){const sync=()=>{dst.textContent=src.textContent.replace(/^Q(\d+)\s*\/\s*(\d+)$/,'Question $1 / $2');};new MutationObserver(sync).observe(src,{childList:true,characterData:true,subtree:true});sync();}
  const qt=document.getElementById('questionText');
  if(qt)new MutationObserver(()=>{if(!document.getElementById('questionArea')?.classList.contains('answered')){qBurstHide();qFavSync();}}).observe(qt,{childList:true});
})();
function qFavKey(p){if(p==='mp'){const t=document.getElementById('mpQuestionText');return t?t.textContent.trim().slice(0,200):'';}const q=p==='daily'?(typeof dailyQs!=='undefined'&&dailyQs[dailyIdx]):window.currentQData;return q?(q.id||q.question||''):'';}
function qFavList(){try{return JSON.parse(localStorage.getItem('aqs_fav_q')||'[]')}catch(e){return []}}
function qFavSync(p){const b=document.getElementById(p==='daily'?'dailyFav':p==='mp'?'mpFav':'qFav');if(!b)return;const on=qFavList().includes(qFavKey(p));b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);}
function qToggleFav(p){const k=qFavKey(p);if(!k)return;let l=qFavList();l=l.includes(k)?l.filter(x=>x!==k):[...l,k];try{localStorage.setItem('aqs_fav_q',JSON.stringify(l.slice(-500)))}catch(e){}qFavSync(p);}
function qBurstHide(p){const b=document.getElementById(p==='daily'?'dailyBurst':p==='mp'?'mpBurst':'qBurst');if(b){b.className='q-burst';b.innerHTML='';}}
function qBurstShow(kind,html,p){const b=document.getElementById(p==='daily'?'dailyBurst':p==='mp'?'mpBurst':'qBurst');if(!b)return;b.className='q-burst';void b.offsetWidth;b.className='q-burst show '+kind;b.innerHTML='<div>'+html+'</div>';}
function showFeedback(correct,correctAns,userAns,override){
  setTimeout(()=>{
    if(!document.getElementById('page-quiz')?.classList.contains('active'))return;
    if(userAns==='(timed out)'){qBurstShow('cream','<img src="assets/ok/bikkuri.png" alt=""><small>TIME\'S UP</small>');return;}
    if(!correct){qBurstHide();return;}
    const st=parseInt(document.getElementById('streakVal')?.textContent||'0',10)||0;
    const pts=typeof lastPtsEarned==='number'&&lastPtsEarned>0?'+'+lastPtsEarned:'';
    if(st>=2)qBurstShow('gold',(pts?'<b>'+pts+'</b>':'')+'<small>STREAK ×'+st+'</small>');
    else if(pts)qBurstShow('gold','<b>'+pts+'</b><small>CORRECT</small>');
    else qBurstHide();
  },0);
  if(correct)sfxCorrect();else sfxWrong();
  // Show inline card feedback section
  const fb=document.getElementById('qCardFeedback');fb.style.display='block';
  document.getElementById('fbIcon').innerHTML=correct?'<i class="ti ti-circle-check" style="color:#4ade80;font-size:20px"></i>':'<i class="ti ti-circle-x" style="color:#f87171;font-size:20px"></i>';
  document.getElementById('fbTitle').textContent=override||(correct?'Correct!':'Wrong!');
  const ya=document.getElementById('fbYourAns');
  if(!correct&&userAns&&userAns!=='(timed out)'&&userAns!==correctAns){ya.textContent='Your answer: '+userAns;ya.style.display='block';}
  else{ya.style.display='none';}
  if(correct&&selectedMode==='race'){
    const label=lastPtsEarned>=95?'Perfect! ⚡':lastPtsEarned>=80?'Fast! 🔥':lastPtsEarned>=65?'Good 👍':lastPtsEarned>=55?'Nice try ⏱️':'Just in time ⏱️';
    document.getElementById('fbPts').textContent=`+${lastPtsEarned} point${lastPtsEarned===1?'':'s'}: ${label}`;
  } else {
    document.getElementById('fbPts').textContent='';
  }
  // Reveal answer in the question card
  const qCard=document.querySelector('#page-quiz .q-card');
  const qText=document.getElementById('questionText');
  const subBy=currentQData?.submitted_by?`<div class="q-answer-sub">Question submitted by <span class="q-answer-sub-name">${currentQData.submitted_by}</span></div>`:'';
  qText.innerHTML=`${seriesTagHTML(currentQData)}${sceneLogoHTML(currentQData)}${answerRevealHTML(correctAns,currentQData,currentQData&&currentQData._match)}${subBy}${fallbackHintHTML(currentQData)}`;
  if(qCard)qCard.classList.add('answered');
  document.getElementById('fbSubmittedBy').style.display='none';
  applyTheme();
  startSoloAutoNext();
}

function nextQuestion(){
  // Only advance from an answered question on the live quiz page — a double-click on NEXT
  // (or NEXT racing the auto-advance) would otherwise skip a question or end the quiz twice
  if(!answered||!document.getElementById('page-quiz')?.classList.contains('active'))return;
  clearInterval(soloAutoNextInterval);
  qIndex++;
  if(selectedMode==='survival'&&lives<=0){endQuiz();return}
  // Solo Score Race: end when target score is reached
  if(selectedMode==='race'&&score>=soloRaceTarget){endQuiz();return}
  // Classic/Survival: end after N questions
  if(selectedMode!=='race'&&qIndex>=selectedQuestionLimit){endQuiz();return}
  loadQuestion();
}

// toggleReport removed -- replaced by flagQuestion()
function endQuiz(){
  clearInterval(timerInterval);clearInterval(soloAutoNextInterval);
  // Update lifetime stats
  totalGames++;
  const correct=quizHistory.filter(h=>h.correct).length;
  const total=quizHistory.length;
  totalCorrect+=correct;totalAnswered+=total;
  if(score>bestScore)bestScore=score;
  if(correct===total&&total>0){currentStreak++;perfectGames++;}else currentStreak=0;
  // Add to history
  allHistory.unshift({fmt:fmtLabels[selectedFormat],mode:selectedMode==='race'?'Score Race':selectedMode==='classic'?'Classic':'Survival',score,correct,total,date:'Just now',livesLeft:lives,target:selectedMode==='race'?soloRaceTarget:null});
  // Save to Supabase for accounts and guests alike (guests have a profile row too),
  // so a guest's stats survive reloads and carry over when they make an account
  if(currentUserId){
    sbSaveGame(currentUserId,{
      format:selectedFormat,mode:selectedMode,score,correct,total,livesLeft:lives
    });
  }
  renderResults();goStep('results');
}
function renderResults(){
  const isSurvival=selectedMode==='survival';
  const isRace=selectedMode==='race';
  const correct=quizHistory.filter(h=>h.correct).length,total=quizHistory.length;
  const pct=total?correct/total:0;
  // Headline by mode and accuracy (the old score-band rank titles were removed 2026-10-15);
  // Classic reuses the Daily Quiz's verdict lines.
  const verdict=pct>=1?'Flawless.':pct>=.875?'Sharp eye.':pct>=.625?'Solid round.':pct>=.375?'Half of them got you.':'Rough set.';
  const title=isRace?'Target reached!':isSurvival?(lives>0?'You survived!':'Out of lives.'):verdict;
  const words=title.split(' ');const last=words.pop();
  document.getElementById('rankTitle').innerHTML=words.join(' ')+(words.length?' ':'')+'<span>'+last+'</span>';
  document.getElementById('rankBadge').textContent=(isRace||(isSurvival&&lives>0)||pct>=1)?'🏆':pct>=.75?'🌟':'✨';
  document.getElementById('rankSub').textContent=isRace
    ?'Target reached in '+total+' questions! 🏁'
    :isSurvival?(lives>0?'You made it to the end. 💪':'Better luck next time!')
    :'Classic · '+(fmtLabels[selectedFormat]||'');
  // Points only mean something in Score Race; Classic and Survival headline the correct count
  document.getElementById('scoreBig').textContent=isRace?score:correct;
  const unitEl=document.querySelector('.score-display .score-unit');
  if(unitEl)unitEl.textContent=isRace?' pts':'correct';
  document.getElementById('statCorrect').textContent=correct+' / '+total;
  document.getElementById('statAccuracy').textContent=(total?Math.round(pct*100):0)+'%';
  document.getElementById('statLives').textContent=isSurvival?lives+' ❤️':'—';
  buildRecap();if(isRace||(isSurvival?lives>0:pct>=.8))launchConfetti();
  document.getElementById('viewProfileWrap').style.display=(!currentUser||isGuest)?'none':'block';
  applyTheme();
}
function buildRecapReportUI(i, qid){
  const already=qid&&reportedQuestionIds.has(qid);
  const btnStyle=already?'opacity:.5;cursor:not-allowed;pointer-events:none':'';
  const btnLabel=already?'<i class="ti ti-flag" style="font-size:11px"></i> Reported':'<i class="ti ti-alert-circle" style="font-size:11px"></i> Report';
  const dropId='recapDrop_'+i;
  return `<div style="margin-top:6px"><button class="report-link" id="recapReportBtn_${i}" style="font-size:11px;${btnStyle}" onclick="toggleRecapReport(${i})" ${already?'disabled':''}>${btnLabel}</button><div class="report-drop" id="${dropId}"><div style="font-size:11px;font-weight:800;color:var(--text);margin-bottom:8px">What's the issue?</div><div class="report-opts">${['wrong','unclear','outdated','duplicate','other'].map((v,vi)=>`<label class="report-opt"><input type="radio" name="rr${i}" value="${v}"${vi===0?' checked':''}> ${v==='wrong'?'Wrong answer marked correct':v==='unclear'?'Unclear or ambiguous':v==='outdated'?'Information is outdated':v==='duplicate'?'Duplicate question':'Other'}</label>`).join('')}</div><textarea class="report-textarea" id="rrDetail_${i}" rows="2" placeholder="Optional: describe the issue..."></textarea><button class="report-submit" id="rrBtn_${i}" onclick="submitRecapReport(${i},&apos;${qid||''}&apos;)">Submit report</button></div></div>`;
}
function toggleRecapReport(i){
  const drop=document.getElementById('recapDrop_'+i);
  if(drop)drop.classList.toggle('open');
}
// All question reports go through this one RPC, which logs the report and bumps report_count server-side
async function submitQuestionReport(id,reason,detail){
  if(!id||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  try{
    const{error}=await sb.rpc('report_question',{p_question_id:id,p_reason:reason||'other',p_detail:detail||null,p_reported_by:currentUser||null});
    if(error)console.warn('report_question failed',error);
  }catch(e){console.warn('report_question failed',e);}
}
async function submitRecapReport(i,qid){
  const btn=document.getElementById('rrBtn_'+i);
  if(btn){btn.disabled=true;btn.textContent='Submitting…';}
  const reasonEl=document.querySelector(`input[name="rr${i}"]:checked`);
  const reason=reasonEl?reasonEl.value:'other';
  const detail=document.getElementById('rrDetail_'+i)?.value?.trim()||'';
  const id=qid||quizHistory[i]?.id;
  await submitQuestionReport(id,reason,detail);
  if(id)reportedQuestionIds.add(id);
  document.getElementById('recapDrop_'+i)?.classList.remove('open');
  const flagBtn=document.getElementById('recapReportBtn_'+i);
  if(flagBtn){flagBtn.disabled=true;flagBtn.style.opacity='.5';flagBtn.style.cursor='not-allowed';flagBtn.style.pointerEvents='none';flagBtn.innerHTML='<i class="ti ti-flag" style="font-size:11px"></i> Reported';}
}
function buildRecap(){
  const list=document.getElementById('recapList');list.innerHTML='';
  quizHistory.forEach((a,i)=>{
    const item=document.createElement('div');item.className='recap-item '+(a.correct?'correct':'wrong');
    item.innerHTML=`<div class="recap-num">${i+1}</div><div style="flex:1;min-width:0"><div class="recap-q">${a.q}</div><div class="recap-ans">${a.correct?`<span class="correct-ans"><i class="ti ti-check" style="font-size:11px"></i> ${a.correctAns}</span>`:''}${!a.correct&&a.userAns&&a.userAns!=='(timed out)'?`<span class="wrong-ans" style="text-decoration:none"><i class="ti ti-x" style="font-size:11px"></i> You: ${a.userAns}</span>`:''}${!a.correct&&(!a.userAns||a.userAns==='(timed out)')?`<span style="color:var(--muted);font-size:11px;font-weight:700"><i class="ti ti-clock" style="font-size:11px"></i> Timed out</span>`:''}</div>${a.id?buildRecapReportUI(i,a.id):''}</div>${a.topic?`<span style="font-size:10px;font-weight:800;color:var(--muted);background:var(--bg3);border:1px solid var(--border);border-radius:99px;padding:2px 8px;white-space:nowrap;flex-shrink:0">${a.topic}</span>`:''}<span>${a.correct?'<i class="ti ti-circle-check" style="color:#4ade80;font-size:18px"></i>':'<i class="ti ti-circle-x" style="color:#f87171;font-size:18px"></i>'}</span>`;
    list.appendChild(item);
  });
}
let recapOpen=true;
function toggleRecap(){
  recapOpen=!recapOpen;
  document.getElementById('recapList').style.display=recapOpen?'flex':'none';
  document.getElementById('recapToggleBtn').innerHTML=recapOpen?'<i class="ti ti-chevron-up" style="font-size:13px"></i> Hide':'<i class="ti ti-chevron-down" style="font-size:13px"></i> Show';
}
function showPlayAgainModal(){
  const topicLabel=isGeneralSelected||!selectedTopics.length?'General Anime':selectedTopics.map(t=>t.name).join(', ');
  document.getElementById('playAgainSettingsSummary').textContent=`${fmtLabels[selectedFormat]} · ${topicLabel}`;
  document.getElementById('playAgainModal').style.display='flex';
  applyTheme();
}
function closePlayAgainModal(){
  document.getElementById('playAgainModal').style.display='none';
}
function playAgain(){
  closePlayAgainModal();
  startQuiz(selectedMode);
}

// ── CONTACT ───────────────────────────────────────────────────
function openContactModal(){
  const isAccount=currentUser&&!isGuest;
  document.getElementById('contactForm').style.display=isAccount?'block':'none';
  document.getElementById('contactGuestWall').style.display=isAccount?'none':'flex';
  if(isAccount){
    const nameField=document.getElementById('contactName');
    if(nameField&&!nameField.value)nameField.value=currentUser||'';
  }
  document.getElementById('contactModal').style.display='flex';
  applyTheme();
}
async function submitContact(){
  // Server-side guard: block guests and logged-out users
  if(!currentUser||isGuest){document.getElementById('contactModal').style.display='none';return;}
  const name=document.getElementById('contactName').value.trim();
  const msg=document.getElementById('contactMessage').value.trim();
  if(!msg){return;}
  if(!SUPABASE_URL.includes('YOUR_PROJECT')){
    try{
      await sb.from('contact_messages').insert({
        user_id:currentUserId,
        name:name||currentUser||'Anonymous',
        message:msg,
        sent_at:new Date().toISOString()
      });
    }catch(e){}
  }
  document.getElementById('contactMessage').value='';
  document.getElementById('contactName').value='';
  document.getElementById('contactModal').style.display='none';
  // Show brief confirmation
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-family:Lilita One,cursive;font-size:14px;padding:12px 24px;border-radius:99px;z-index:999;box-shadow:0 4px 20px rgba(0,0,0,.3)';
  modal.textContent='Message sent, thanks! 🙏';
  document.body.appendChild(modal);
  setTimeout(()=>modal.remove(),3000);
  applyTheme();
}

// ── SUBMIT QUESTION ───────────────────────────────────────────
document.addEventListener('change',e=>{
  if(e.target.id==='sqFormat'){
    const isMC=e.target.value==='mc';
    document.getElementById('sqOptionsWrap').style.display=isMC?'block':'none';
    document.getElementById('sqAnswerWrap').style.display=isMC?'none':'block';
    document.getElementById('sqAliasesWrap').style.display=isMC?'none':'block';
    if(isMC&&!document.querySelector('#sqOptionRows .ae-opt-row'))sqBuildOptions();
  }
});
function sqOptionRow(value,checked){
  const div=document.createElement('div');
  div.className='ae-opt-row';
  div.innerHTML='<input type="radio" name="sqCorrect"'+(checked?' checked':'')+' title="Mark as correct"><input class="form-input ae-opt-input" type="text" placeholder="Option text">';
  div.querySelector('.ae-opt-input').value=value||'';
  document.getElementById('sqOptionRows').appendChild(div);
}
function sqBuildOptions(){
  const rowsEl=document.getElementById('sqOptionRows');rowsEl.innerHTML='';
  for(let i=0;i<4;i++)sqOptionRow('',i===0);
}
function sqInitForm(){
  const rowsEl=document.getElementById('sqOptionRows');if(!rowsEl)return;
  rowsEl.innerHTML='';
  const isMC=document.getElementById('sqFormat').value==='mc';
  document.getElementById('sqOptionsWrap').style.display=isMC?'block':'none';
  document.getElementById('sqAnswerWrap').style.display=isMC?'none':'block';
  document.getElementById('sqAliasesWrap').style.display=isMC?'none':'block';
  if(isMC)sqBuildOptions();else rowsEl.innerHTML='';
}
// ── TOPIC AUTOCOMPLETE ────────────────────────────────────────
let sqTopicCache = null;   // [{topic_value, count}] loaded once per modal open
let sqTopicActiveIdx = -1; // keyboard navigation index

async function sqLoadTopics(){
  if(sqTopicCache) return;
  if(SUPABASE_URL.includes('YOUR_PROJECT')){sqTopicCache=[];return;}
  try{
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/questions?select=topic_value&status=eq.approved&topic_type=eq.anime`,
      {headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`}}
    );
    const rows = await res.json();
    // Tally counts per topic_value
    const map = {};
    (Array.isArray(rows)?rows:[]).forEach(r=>{
      if(!r.topic_value)return;
      map[r.topic_value]=(map[r.topic_value]||0)+1;
    });
    sqTopicCache = Object.entries(map)
      .map(([topic_value,count])=>({topic_value,count}))
      .sort((a,b)=>b.count-a.count); // most questions first
  }catch(e){sqTopicCache=[];}
}

function sqTopicInput(){
  const val = document.getElementById('sqTopic').value.trim();
  sqTopicActiveIdx = -1;
  if(val.length < 2){ sqTopicHide(); return; }
  sqLoadTopics().then(()=>sqTopicRender(val));
}

function sqTopicRender(query){
  const drop = document.getElementById('sqTopicDrop');
  if(!sqTopicCache){drop.style.display='none';return;}

  const q = query.toLowerCase();
  const matches = sqTopicCache.filter(t=>t.topic_value.toLowerCase().includes(q));

  drop.innerHTML = '';

  if(matches.length === 0){
    // No matches — show "new topic" hint
    const hint = document.createElement('div');
    hint.className = 'sq-topic-empty';
    hint.textContent = 'No existing topics match. A new one will be created.';
    drop.appendChild(hint);
  } else {
    matches.slice(0,8).forEach((t,i)=>{
      const item = document.createElement('div');
      item.className = 'sq-topic-item';
      item.dataset.idx = i;
      // Bold the matching portion
      const lo = t.topic_value.toLowerCase();
      const start = lo.indexOf(q);
      const before = t.topic_value.slice(0,start);
      const match  = t.topic_value.slice(start,start+q.length);
      const after  = t.topic_value.slice(start+q.length);
      item.innerHTML = `<span class="sq-topic-item-name">${before}<em>${match}</em>${after}</span>
        <span class="sq-topic-item-count">${t.count} Q${t.count===1?'':'s'}</span>`;
      item.onmousedown = ()=>sqTopicSelect(t.topic_value);
      drop.appendChild(item);
    });

    // If typed value isn't an exact match, offer it as a new topic at the bottom
    const exactMatch = matches.some(t=>t.topic_value.toLowerCase()===q);
    if(!exactMatch){
      const newRow = document.createElement('div');
      newRow.className = 'sq-topic-new';
      newRow.innerHTML = `<i class="ti ti-plus" style="font-size:13px;color:var(--accent)"></i>
        <span class="sq-topic-new-label">"${query}"</span>
        <span class="sq-topic-new-badge">New topic</span>`;
      newRow.onmousedown = ()=>sqTopicSelect(query);
      drop.appendChild(newRow);
    }
  }

  drop.style.display = 'block';
}

function sqTopicSelect(value){
  document.getElementById('sqTopic').value = value;
  sqTopicHide();
}

function sqTopicHide(){
  const drop = document.getElementById('sqTopicDrop');
  if(drop) drop.style.display = 'none';
  sqTopicActiveIdx = -1;
}

function sqTopicKeydown(e){
  const drop = document.getElementById('sqTopicDrop');
  if(!drop || drop.style.display === 'none') return;
  const items = drop.querySelectorAll('.sq-topic-item, .sq-topic-new');
  if(!items.length) return;

  if(e.key === 'ArrowDown'){
    e.preventDefault();
    sqTopicActiveIdx = Math.min(sqTopicActiveIdx+1, items.length-1);
  } else if(e.key === 'ArrowUp'){
    e.preventDefault();
    sqTopicActiveIdx = Math.max(sqTopicActiveIdx-1, -1);
  } else if(e.key === 'Enter' && sqTopicActiveIdx >= 0){
    e.preventDefault();
    items[sqTopicActiveIdx].onmousedown();
    return;
  } else if(e.key === 'Escape'){
    sqTopicHide(); return;
  } else { return; }

  items.forEach((el,i)=>el.classList.toggle('active', i===sqTopicActiveIdx));
  if(sqTopicActiveIdx >= 0) items[sqTopicActiveIdx].scrollIntoView({block:'nearest'});
}

let sqSuggestTopicActiveIdx = -1;

function sqSuggestTopicInput(){
  const val = document.getElementById('sqSuggestTopic').value.trim();
  sqSuggestTopicActiveIdx = -1;
  if(val.length < 2){ sqSuggestTopicHide(); return; }
  sqLoadTopics().then(()=>sqSuggestTopicRender(val));
}

function sqSuggestTopicRender(query){
  const drop = document.getElementById('sqSuggestTopicDrop');
  if(!sqTopicCache){ drop.style.display='none'; return; }
  const q = query.toLowerCase();
  const matches = sqTopicCache.filter(t=>t.topic_value.toLowerCase().includes(q));
  drop.innerHTML = '';
  if(matches.length === 0){
    const hint = document.createElement('div');
    hint.className = 'sq-topic-empty';
    hint.textContent = 'No existing topics match. This will be a new suggestion.';
    drop.appendChild(hint);
  } else {
    matches.slice(0,8).forEach((t,i)=>{
      const item = document.createElement('div');
      item.className = 'sq-topic-item';
      item.dataset.idx = i;
      const lo = t.topic_value.toLowerCase();
      const start = lo.indexOf(q);
      const before = t.topic_value.slice(0,start);
      const match  = t.topic_value.slice(start,start+q.length);
      const after  = t.topic_value.slice(start+q.length);
      item.innerHTML = `<span class="sq-topic-item-name">${before}<em>${match}</em>${after}</span>
        <span class="sq-topic-item-count">${t.count} Q${t.count===1?'':'s'}</span>`;
      item.onmousedown = ()=>sqSuggestTopicSelect(t.topic_value);
      drop.appendChild(item);
    });
    const exactMatch = matches.some(t=>t.topic_value.toLowerCase()===q);
    if(!exactMatch){
      const newRow = document.createElement('div');
      newRow.className = 'sq-topic-new';
      newRow.innerHTML = `<i class="ti ti-plus" style="font-size:13px;color:var(--accent)"></i>
        <span class="sq-topic-new-label">"${query}"</span>
        <span class="sq-topic-new-badge">New topic</span>`;
      newRow.onmousedown = ()=>sqSuggestTopicSelect(query);
      drop.appendChild(newRow);
    }
  }
  drop.style.display = 'block';
}

function sqSuggestTopicSelect(value){
  document.getElementById('sqSuggestTopic').value = value;
  sqSuggestTopicHide();
}

function sqSuggestTopicHide(){
  const drop = document.getElementById('sqSuggestTopicDrop');
  if(drop) drop.style.display = 'none';
  sqSuggestTopicActiveIdx = -1;
}

function sqSuggestTopicKeydown(e){
  const drop = document.getElementById('sqSuggestTopicDrop');
  if(!drop || drop.style.display === 'none'){
    if(e.key === 'Enter'){ e.preventDefault(); submitTopicSuggestion(); }
    return;
  }
  const items = drop.querySelectorAll('.sq-topic-item, .sq-topic-new');
  if(e.key === 'ArrowDown'){
    e.preventDefault();
    sqSuggestTopicActiveIdx = Math.min(sqSuggestTopicActiveIdx+1, items.length-1);
  } else if(e.key === 'ArrowUp'){
    e.preventDefault();
    sqSuggestTopicActiveIdx = Math.max(sqSuggestTopicActiveIdx-1, -1);
  } else if(e.key === 'Enter'){
    e.preventDefault();
    if(sqSuggestTopicActiveIdx >= 0 && items[sqSuggestTopicActiveIdx]){
      items[sqSuggestTopicActiveIdx].onmousedown();
    } else {
      submitTopicSuggestion();
    }
    return;
  } else if(e.key === 'Escape'){
    sqSuggestTopicHide(); return;
  } else { return; }
  items.forEach((el,i)=>el.classList.toggle('active', i===sqSuggestTopicActiveIdx));
  if(sqSuggestTopicActiveIdx >= 0) items[sqSuggestTopicActiveIdx].scrollIntoView({block:'nearest'});
}

function openSubmitQuestion(){
  applyTheme();
  if(!currentUser||isGuest){
    document.getElementById('submitSignInModal').style.display='flex';
  } else {
    document.getElementById('submitQModal').style.display='flex';
    sqSwitchTab('question');
    sqInitForm();
    sqTopicCache=null; // refresh topics each time the modal opens
    sqLoadTopics();    // pre-fetch in background so first keystroke is instant
  }
}

function sqSwitchTab(tab){
  const isQ=tab==='question';
  // Tab buttons
  const qBtn=document.getElementById('sqTabQuestion');
  const sBtn=document.getElementById('sqTabSuggest');
  qBtn.style.background=isQ?'var(--accent)':'none';
  qBtn.style.color=isQ?'#fff':'var(--muted)';
  qBtn.style.borderColor=isQ?'var(--accent)':'var(--border2)';
  sBtn.style.background=isQ?'none':'var(--accent)';
  sBtn.style.color=isQ?'var(--muted)':'#fff';
  sBtn.style.borderColor=isQ?'var(--border2)':'var(--accent)';
  // Subtitles
  document.getElementById('sqTabQuestionSub').style.display=isQ?'block':'none';
  document.getElementById('sqTabSuggestSub').style.display=isQ?'none':'block';
  // Bodies
  document.getElementById('sqBodyQuestion').style.display=isQ?'flex':'none';
  document.getElementById('sqBodySuggest').style.display=isQ?'none':'flex';
  if(isQ) sqSuggestTopicHide();
  // Footer button
  const btn=document.getElementById('sqSubmitBtn');
  btn.onclick=isQ?submitQuestion:submitTopicSuggestion;
}

let _sqSuggestSubmitting=false;
async function submitTopicSuggestion(){
  if(_sqSuggestSubmitting)return;
  if(!currentUser||isGuest){
    showErr('sqSuggestErr','sqSuggestErrMsg','You need a registered account to suggest a topic.');
    return;
  }
  const topic=document.getElementById('sqSuggestTopic').value.trim();
  if(!topic){showErr('sqSuggestErr','sqSuggestErrMsg','Please enter an anime name.');return;}
  const note=document.getElementById('sqSuggestNote').value.trim();
  _sqSuggestSubmitting=true;
  const btn=document.getElementById('sqSubmitBtn');
  if(btn){btn.disabled=true;btn.style.opacity='0.6';}
  if(!SUPABASE_URL.includes('YOUR_PROJECT')){
    let error;
    try{
      ({error}=await sb.from('topic_suggestions').insert({
        topic,note:note||null,suggested_by:currentUser,user_id:currentUserId,created_at:new Date().toISOString()
      }));
    }catch(e){error=e;}
    if(error){
      _sqSuggestSubmitting=false;
      if(btn){btn.disabled=false;btn.style.opacity='';}
      showErr('sqSuggestErr','sqSuggestErrMsg','Could not submit. Try again.');return;
    }
  }
  _sqSuggestSubmitting=false;
  if(btn){btn.disabled=false;btn.style.opacity='';}
  document.getElementById('submitQModal').style.display='none';
  document.getElementById('sqSuggestTopic').value='';
  document.getElementById('sqSuggestNote').value='';
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-family:Lilita One,cursive;font-size:14px;padding:12px 24px;border-radius:99px;z-index:999;box-shadow:0 4px 20px rgba(0,0,0,.3)';
  toast.textContent='Topic suggestion received, thanks! 💡';
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(),3000);
  applyTheme();
}

function openSubmitAuth(){
  document.getElementById('submitSignInModal').style.display='none';
  pendingDestination='submitQ';
  showAuthMode(null);
  goStep('auth');
}

async function submitQuestion(){
  // Only signed-in users can submit
  if(!currentUser||isGuest){
    showErr('sqErr','sqErrMsg','You need a registered account to submit questions.');
    return;
  }
  const q=document.getElementById('sqQuestion').value.trim();
  const fmt=document.getElementById('sqFormat').value;
  const ans=document.getElementById('sqAnswer').value.trim();
  const topic=document.getElementById('sqTopic').value.trim();
  if(!q){showErr('sqErr','sqErrMsg','Please enter a question.');return}
  if(!topic){showErr('sqErr','sqErrMsg','Please enter an anime or topic.');return}
  let options=null,answerVal=ans;
  if(fmt==='mc'){
    const rows=[...document.querySelectorAll('#sqOptionRows .ae-opt-row')].map(r=>({val:r.querySelector('.ae-opt-input').value.trim(),checked:r.querySelector('input[type=radio]').checked}));
    if(rows.some(r=>!r.val)){showErr('sqErr','sqErrMsg','Please fill in all 4 options.');return}
    const correctIdx=rows.findIndex(r=>r.checked);
    if(correctIdx<0){showErr('sqErr','sqErrMsg','Tap the circle next to the correct option.');return}
    options=rows.map(r=>r.val);
    answerVal=String(correctIdx);
  } else {
    if(!ans){showErr('sqErr','sqErrMsg','Please enter the correct answer.');return}
  }
  const aliases=document.getElementById('sqAliases').value.split(',').map(a=>a.trim()).filter(Boolean);
  const mediaUrl=document.getElementById('sqImageUrl')?.value.trim()||null;
  if(!SUPABASE_URL.includes('YOUR_PROJECT')){
    let error;
    try{
      ({error}=await sb.from('questions').insert({
        question:q,options,answer:answerVal,aliases,
        format:fmt,topic_type:'anime',topic_value:topic,
        difficulty:'normal',report_count:0,
        submitted_by:currentUser,status:'pending',
        media_url:mediaUrl||null
      }));
    }catch(e){error=e;}
    if(error&&error.code==='23505'){showErr('sqErr','sqErrMsg','This question already exists in the bank.');return}
    if(error){showErr('sqErr','sqErrMsg','Could not submit. Try again.');return}
  }
  document.getElementById('submitQModal').style.display='none';
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-family:Lilita One,cursive;font-size:14px;padding:12px 24px;border-radius:99px;z-index:999;box-shadow:0 4px 20px rgba(0,0,0,.3)';
  toast.textContent='Question submitted, nice one! 🎉';
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(),3000);
  ['sqQuestion','sqAnswer','sqAliases','sqTopic','sqOptions'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const imgUrl=document.getElementById('sqImageUrl');if(imgUrl)imgUrl.value='';
  const imgPrev=document.getElementById('sqImagePreviewWrap');if(imgPrev)imgPrev.style.display='none';
  sqTopicHide();
  sqTopicCache=null;
  applyTheme();
}

function sqImagePreview(){
  const url=document.getElementById('sqImageUrl')?.value.trim();
  const wrap=document.getElementById('sqImagePreviewWrap');
  const img=document.getElementById('sqImagePreviewImg');
  if(!wrap||!img)return;
  if(url){img.src=url;wrap.style.display='block';}
  else{wrap.style.display='none';img.src='';}
}

function switchGameSettingsTab(tab){
  const isQ=tab==='questions';
  document.getElementById('gsQuestionPanel').style.display=isQ?'block':'none';
  document.getElementById('gsTimerPanel').style.display=isQ?'none':'block';
  const qBtn=document.getElementById('gsTabQuestions');
  const tBtn=document.getElementById('gsTabTimer');
  qBtn.style.background=isQ?'var(--accent)':'none';
  qBtn.style.color=isQ?'#fff':'var(--muted)';
  tBtn.style.background=isQ?'none':'var(--accent)';
  tBtn.style.color=isQ?'var(--muted)':'#fff';
}
function updateGsSummary(){
  const isSoloRace=pendingMode==='race'&&!pendingLobbyAfterTimeLimit;
  const isSoloSurvival=pendingMode==='survival'&&!pendingLobbyAfterTimeLimit;
  const qEl=document.getElementById('gsSummaryQuestions');
  const tEl=document.getElementById('gsSummaryTimer');
  const qIcon=document.getElementById('gsSummaryQIcon');
  if(qEl){
    if(isSoloRace){
      qEl.textContent='Target: '+soloRaceTarget+' pts';
      if(qIcon)qIcon.className='ti ti-flag ';
    } else if(isSoloSurvival){
      qEl.textContent=selectedLives+' '+(selectedLives===1?'Life':'Lives');
      if(qIcon)qIcon.className='ti ti-heart ';
    } else {
      qEl.textContent=selectedQuestionLimit+' Questions';
      if(qIcon)qIcon.className='ti ti-list-numbers ';
    }
  }
  if(tEl)tEl.textContent=raceTimeLimit+'s / question';
}

// ── TIME LIMIT PICKER ─────────────────────────────────────────
function showTimeLimitPicker(mode,fromLobby){
  pendingMode=mode;
  const isRace=mode==='race';
  const isSoloRace=isRace&&!fromLobby;
  document.getElementById('timeLimitDesc').textContent=isRace
    ? 'Full points for the first 5s, then drops to a minimum of 3 pts.'
    : mode==='classic'
      ? 'Run out of time and the question is skipped. No penalty.'
      : 'Run out of time and you lose a life.';
  document.getElementById('timeLimitStartLabel').textContent=fromLobby?'Confirm':isRace?'Start Race':'Start '+(mode==='classic'?'Classic':'Survival');
  // Sync time limit selection
  const grid=document.getElementById('timeLimitGrid');
  grid.querySelectorAll('.time-limit-opt').forEach(el=>{
    el.classList.toggle('selected',parseInt(el.dataset.val)===raceTimeLimit);
  });
  // Show target score, lives, or question count in the Questions panel
  const qCountWrap=document.getElementById('gsQCountWrap');
  const targetWrap=document.getElementById('gsTargetWrap');
  const livesWrap=document.getElementById('gsLivesWrap');
  const isSoloSurvival=mode==='survival'&&!fromLobby;
  if(qCountWrap)qCountWrap.style.display=(isSoloRace||isSoloSurvival)?'none':'block';
  if(targetWrap)targetWrap.style.display=isSoloRace?'block':'none';
  if(livesWrap)livesWrap.style.display=isSoloSurvival?'block':'none';
  // Update tab label
  const tabQLabel=document.getElementById('gsTabQLabel');
  const tabQIcon=document.getElementById('gsTabQIcon');
  if(tabQLabel)tabQLabel.textContent=isSoloRace?'Target':isSoloSurvival?'Lives':'Questions';
  if(tabQIcon)tabQIcon.className='ti '+(isSoloRace?'ti-flag':isSoloSurvival?'ti-heart':'ti-list-numbers')+' ';
  if(isSoloRace){
    // Sync solo target selection
    document.querySelectorAll('#soloTargetGrid .q-count-opt').forEach(el=>{
      el.classList.toggle('selected',parseInt(el.dataset.tval)===soloRaceTarget);
    });
    const presets=[500,750,1000,1500];
    const customInput=document.getElementById('soloTargetCustom');
    if(presets.includes(soloRaceTarget)){
      if(customInput){customInput.value='';customInput.classList.remove('selected');}
    } else {
      document.querySelectorAll('#soloTargetGrid .q-count-opt').forEach(el=>el.classList.remove('selected'));
      if(customInput){customInput.value=soloRaceTarget;customInput.classList.add('selected');}
    }
  } else if(isSoloSurvival){
    // Sync lives selection
    const livesGrid=document.getElementById('livesCountGrid');
    const livesPresets=[1,3,5];
    const livesCustom=document.getElementById('livesCountCustom');
    if(livesGrid){
      livesGrid.querySelectorAll('.q-count-opt').forEach(el=>{
        el.classList.toggle('selected',parseInt(el.dataset.lval)===selectedLives);
      });
    }
    if(livesPresets.includes(selectedLives)){
      if(livesCustom){livesCustom.value='';livesCustom.classList.remove('selected');}
    } else {
      if(livesGrid)livesGrid.querySelectorAll('.q-count-opt').forEach(el=>el.classList.remove('selected'));
      if(livesCustom){livesCustom.value=selectedLives;livesCustom.classList.add('selected');}
    }
  } else {
    // Sync question count selection
    const qCountGrid=document.getElementById('questionCountGrid');
    const presets=[10,15,20,30];
    const customInput=document.getElementById('questionCountCustom');
    if(presets.includes(selectedQuestionLimit)){
      qCountGrid.querySelectorAll('.q-count-opt').forEach(el=>{
        el.classList.toggle('selected',parseInt(el.dataset.qval)===selectedQuestionLimit);
      });
      customInput.value='';
      customInput.classList.remove('selected');
    } else {
      qCountGrid.querySelectorAll('.q-count-opt').forEach(el=>el.classList.remove('selected'));
      customInput.value=selectedQuestionLimit;
      customInput.classList.add('selected');
    }
    // Set max depending on context
    const isLobby=!!fromLobby;
    customInput.max=isLobby?100:50;
    customInput.placeholder=isLobby?'Custom, type any number (max 100)':'Custom, type any number (max 50)';
  }
  // Always start on Questions tab
  switchGameSettingsTab('questions');
  updateGsSummary();
  const sceneHint=document.getElementById('gsSceneHint');
  if(sceneHint){
    sceneHint.style.display=selectedFormat==='scene'?'flex':'none';
    if(selectedFormat==='scene'){
      const hintText=document.getElementById('gsSceneHintText');
      if(hintText)hintText.textContent=getSiteText('scene_hint_solo');
    }
  }
  document.getElementById('timeLimitModal').style.display='flex';
  applyTheme();
}
function selectQuestionCount(val,el){
  selectedQuestionLimit=val;
  document.querySelectorAll('.q-count-opt').forEach(e=>e.classList.remove('selected'));
  if(el)el.classList.add('selected');
  const customInput=document.getElementById('questionCountCustom');
  customInput.value='';
  customInput.classList.remove('selected');
  updateGsSummary();
}
function onCustomQCount(input){
  const raw=parseInt(input.value);
  if(isNaN(raw)||input.value==='')return;
  const maxVal=parseInt(input.max)||50;
  const val=Math.max(1,Math.min(maxVal,raw));
  selectedQuestionLimit=val;
  document.querySelectorAll('.q-count-opt').forEach(e=>e.classList.remove('selected'));
  input.classList.add('selected');
  if(raw>maxVal)input.value=maxVal;
  updateGsSummary();
}
function onCustomQCountFocus(input){
  document.querySelectorAll('.q-count-opt').forEach(e=>e.classList.remove('selected'));
  input.classList.add('selected');
}
function selectTimeLimit(val){
  raceTimeLimit=val;
  document.querySelectorAll('.time-limit-opt').forEach(el=>{
    el.classList.toggle('selected',parseInt(el.dataset.val)===val);
  });
  updateGsSummary();
}
function selectSoloRaceTarget(val,el){
  soloRaceTarget=val;
  document.querySelectorAll('#soloTargetGrid .q-count-opt').forEach(e=>e.classList.remove('selected'));
  if(el)el.classList.add('selected');
  const customInput=document.getElementById('soloTargetCustom');
  if(customInput){customInput.value='';customInput.classList.remove('selected');}
  updateGsSummary();
}
function onCustomSoloTarget(input){
  const raw=parseInt(input.value);
  if(isNaN(raw)||input.value==='')return;
  const val=Math.max(1,Math.min(5000,raw));
  soloRaceTarget=val;
  document.querySelectorAll('#soloTargetGrid .q-count-opt').forEach(e=>e.classList.remove('selected'));
  input.classList.add('selected');
  if(raw>500)input.value=500;
  updateGsSummary();
}
function onCustomSoloTargetFocus(input){
  document.querySelectorAll('#soloTargetGrid .q-count-opt').forEach(e=>e.classList.remove('selected'));
  input.classList.add('selected');
}
// ── SOLO SURVIVAL LIVES ───────────────────────────────────────
let selectedLives=3; // default lives for solo Survival
function selectSoloLives(val,el){
  selectedLives=val;
  document.querySelectorAll('#livesCountGrid .q-count-opt').forEach(e=>e.classList.remove('selected'));
  if(el)el.classList.add('selected');
  const customInput=document.getElementById('livesCountCustom');
  if(customInput){customInput.value='';customInput.classList.remove('selected');}
  updateGsSummary();
}
function onCustomSoloLives(input){
  const raw=parseInt(input.value);
  if(isNaN(raw)||input.value==='')return;
  const val=Math.max(1,Math.min(20,raw));
  selectedLives=val;
  document.querySelectorAll('#livesCountGrid .q-count-opt').forEach(e=>e.classList.remove('selected'));
  input.classList.add('selected');
  if(raw>20)input.value=20;
  updateGsSummary();
}
function onCustomSoloLivesFocus(input){
  document.querySelectorAll('#livesCountGrid .q-count-opt').forEach(e=>e.classList.remove('selected'));
  input.classList.add('selected');
}
function confirmTimeLimit(){
  document.getElementById('timeLimitModal').style.display='none';
  if(pendingLobbyAfterTimeLimit){
    pendingLobbyAfterTimeLimit=false;
    // Flush final confirmed format+mode to DB so the lobby list reflects the real state
    patchLobby({format:lobbyFormat,mode:lobbyMode,question_count:selectedQuestionLimit});
    if(rtChannel){rtChannel.send({type:'broadcast',event:'settings_changed',payload:{format:lobbyFormat,mode:lobbyMode,timeLimit:raceTimeLimit,questionCount:selectedQuestionLimit,topics:lobbyTopics,isGeneral:lobbyIsGeneral,changing:false}});}
    goStep('lobby-room');
  } else {
    startQuiz(pendingMode);
  }
}

// Score Race: 50 for a right answer + up to 50 more in direct proportion to the time left (Kahoot-style).
// Instant answer = 100, last-second answer = 50.
function calcSpeedPoints(elapsed,limit){
  if(!(limit>0))return 100;
  const left=Math.max(0,Math.min(1,1-elapsed/limit));
  return Math.round(50+50*left);
}

function startTimer(){
  clearInterval(timerInterval);
  questionStartTime=Date.now();
  timeLeft=raceTimeLimit;
  updateTimerBar();
  timerInterval=setInterval(()=>{
    timeLeft=Math.max(0,raceTimeLimit-(Date.now()-questionStartTime)/1000);
    updateTimerBar();
    if(timeLeft<=0){clearInterval(timerInterval);timeOut();}
  },100);
}
function updateTimerBar(){
  const pct=Math.max(0,(timeLeft/raceTimeLimit)*100);
  const bar=document.getElementById('timerBar');bar.style.width=pct+'%';
  bar.className='timer-bar'+(pct<30?' danger':pct<60?' warn':'');
}
// ── SOUND EFFECTS (synthesized — no audio files needed) ──────
let _audioCtx=null;
let soundOn=(()=>{try{return localStorage.getItem('sound_off')!=='1';}catch(e){return true;}})();
function _sfxCtx(){try{if(!_audioCtx)_audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(_audioCtx.state==='suspended')_audioCtx.resume();return _audioCtx;}catch(e){return null;}}
function _tone(freq,start,dur,type,gain){
  const ctx=_sfxCtx();if(!ctx)return;
  const o=ctx.createOscillator(),g=ctx.createGain();
  o.type=type||'sine';o.frequency.value=freq;o.connect(g);g.connect(ctx.destination);
  const t=ctx.currentTime+start;
  g.gain.setValueAtTime(0.0001,t);
  g.gain.exponentialRampToValueAtTime(gain||0.15,t+0.012);
  g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.start(t);o.stop(t+dur+0.03);
}
function sfxCorrect(){if(!soundOn)return;_tone(1319,0,.08,'sine',.13);_tone(1568,.07,.08,'sine',.13);_tone(2093,.14,.24,'sine',.11);} // ✨ fairy twinkle
function sfxWrong(){if(!soundOn)return;_tone(660,0,.18,'sine',.13);_tone(440,.16,.3,'sine',.12);} // ✨ gentle fizzle
function sfxWrongAttempt(){if(!soundOn)return;_tone(1568,0,.06,'sine',.1);} // ✨ sparkle tick — keep trying
function sfxWin(){if(!soundOn)return;_tone(1568,0,.1,'sine',.12);_tone(2093,.1,.1,'sine',.1);_tone(1760,.2,.1,'sine',.1);_tone(2349,.3,.45,'sine',.12);} // ✨ starlight
function toggleSound(){soundOn=!soundOn;try{localStorage.setItem('sound_off',soundOn?'0':'1');}catch(e){}updateSoundUI();if(soundOn)sfxCorrect();}
function updateSoundUI(){
  document.querySelectorAll('#soundToggle,#soundToggleDrawer').forEach(t=>t.classList.toggle('on',soundOn));
  const ic=document.getElementById('soundBtnIcon');if(ic)ic.className='ti '+(soundOn?'ti-volume':'ti-volume-off');
  const sb=document.getElementById('soundBtn');if(sb){sb.title=soundOn?'Sound on (click to mute)':'Muted (click to unmute)';sb.style.color=soundOn?'':'var(--muted)';}
}

function recordAnswerStat(id,wasCorrect){
  if(!id||typeof sb==='undefined'||!sb||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  // Supabase query builders only send when .then() is called (they have no .catch), so fire it explicitly
  try{sb.rpc('record_answer',{q_id:id,was_correct:!!wasCorrect}).then(()=>{},()=>{});}catch(e){}
}
function launchConfetti(){
  sfxWin();
  const colors=['#a78bfa','#f472b6','#38bdf8','#fb923c','#4ade80','#fbbf24'];
  for(let i=0;i<60;i++){setTimeout(()=>{
    const el=document.createElement('div');el.className='confetti-piece';
    el.style.cssText=`left:${Math.random()*100}vw;background:${colors[Math.floor(Math.random()*colors.length)]};width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;border-radius:${Math.random()>.5?'50%':'2px'};animation-duration:${2+Math.random()*2}s;animation-delay:${Math.random()*1.5}s`;
    document.body.appendChild(el);setTimeout(()=>el.remove(),4000);
  },i*30);}
}
async function flagQuestion(){
  const btn=document.getElementById('reportFlagBtn');
  if(!btn||btn.disabled)return;
  btn.disabled=true;
  await submitQuestionReport(currentQData?.id,'other',null);
  const _ft=document.createElement('div');
  _ft.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-family:\'Lilita One\',cursive;font-size:14px;padding:12px 24px;border-radius:99px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3);animation:toastIn .3s ease;white-space:nowrap';
  _ft.textContent='Thanks for flagging! We’ll review this question. 🚩';
  document.body.appendChild(_ft);
  setTimeout(()=>_ft.remove(),3000);
  if(currentQData?.id)reportedQuestionIds.add(currentQData.id);
  btn.innerHTML='<i class="ti ti-flag" style="font-size:13px"></i> Flagged';
}


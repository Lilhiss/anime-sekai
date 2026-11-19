// Multiplayer results glue, lobby topics loader, host-change note (moved out of index.html 2026-11-19; order matters)
/* ── MP RESULTS 32a glue: floats, compose bar, in-lobby marks ── */
const MR_TILES=['💀','😂','😭','🔥','👏','🧠','💩','🙃'];
let mrBack=new Set(),mrLastSend=0;
function mrPlayer(name){return (typeof lobbyPlayers!=='undefined'?lobbyPlayers:[]).find(p=>p.name===name)||{name:name||'?'}}
function mrAvHTML(p){
  if(p.avatar&&/^(https?:|data:|\/)/.test(p.avatar))return '<img src="'+p.avatar+'" alt="">';
  return (p.name||'?')[0].toUpperCase();
}
function mrEsc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function mrShowFloat(pl){
  const layer=document.getElementById('mrFloats');if(!layer||!pl)return;
  const p=mrPlayer(pl.name),me=pl.name===currentUser;
  const W=layer.clientWidth,H=layer.clientHeight;
  const el=document.createElement('div');el.className='mr-fl';
  const bg='background:'+(p.color||'var(--accent)');
  if(pl.e){
    el.style.left=(W*0.72+Math.random()*W*0.22)+'px';el.style.bottom=(H*0.5+Math.random()*30)+'px';
    el.style.animation='mrRise '+(4.6+Math.random()*.8)+'s cubic-bezier(.2,.6,.3,1) forwards';
    el.innerHTML='<span class="mr-fl-e">'+mrEsc(pl.e)+'<span class="mr-fl-av" style="'+bg+'">'+mrAvHTML(p)+'</span></span>';
  } else if(pl.t){
    el.style.left=(W*0.62+Math.random()*W*0.08)+'px';el.style.bottom=(H*0.52+Math.random()*70)+'px';
    el.style.animation='mrDrift 8s cubic-bezier(.2,.6,.3,1) forwards';
    el.innerHTML='<div class="mr-fl-pill'+(me?' me':'')+'"><span class="mr-fl-pav" style="'+bg+'">'+mrAvHTML(p)+'</span><span class="mr-fl-n">'+(me?'You':mrEsc(pl.name))+'</span><span class="mr-fl-t">'+mrEsc(pl.t)+'</span></div>';
  } else return;
  layer.appendChild(el);el.addEventListener('animationend',()=>el.remove());
}
function mrBroadcast(payload){
  mrShowFloat(payload);
  if(typeof rtChannel!=='undefined'&&rtChannel)try{rtChannel.send({type:'broadcast',event:'res_float',payload})}catch(e){}
}
function mrSendEmoji(e){mrBroadcast({name:currentUser,e});}
function mrSendText(){
  const i=document.getElementById('mrInput');if(!i)return;
  const t=i.value.trim().slice(0,40);if(!t)return;
  const now=Date.now();if(now-mrLastSend<1500)return;mrLastSend=now;
  mrBroadcast({name:currentUser,t});i.value='';mrSyncCount();
}
function mrSyncCount(){const i=document.getElementById('mrInput'),c=document.getElementById('mrCount');if(i&&c)c.textContent=i.value.length+'/40';}
function mrMarkBack(name){if(!name)return;mrBack.add(name);mrSync();}
function mrSync(){
  const ps=(typeof lobbyPlayers!=='undefined'?lobbyPlayers:[]);
  const n=document.getElementById('mrPlayerCount');if(n)n.textContent=ps.length+' player'+(ps.length===1?'':'s');
  const here=ps.filter(p=>!p.quit&&p.connected!==false&&!mrBack.has(p.name)).length;
  const hn=document.getElementById('mrHereN');if(hn)hn.textContent=here+' STILL HERE';
  const bn=document.getElementById('mrBackN');if(bn)bn.textContent=mrBack.size?mrBack.size+'/'+ps.length:'';
  document.querySelectorAll('#mpFinalStandings .standing-row').forEach(r=>{
    const has=r.querySelector('.mr-inlobby');const back=mrBack.has(r.dataset.name);
    if(back&&!has){const s=document.createElement('span');s.className='mr-inlobby';s.innerHTML='<i class="ti ti-check" style="font-size:11px"></i>IN LOBBY';const last=r.lastElementChild;r.insertBefore(s,last);}
    else if(!back&&has)has.remove();
  });
  const m=document.getElementById('mrRecapMeta');
  if(m&&typeof quizHistory!=='undefined'){
    const isHP=lobbyMode==='potato';
    const total=isHP?hpHistory.length:quizHistory.length;
    const mine=isHP?hpHistory.filter(x=>x.player===currentUser):quizHistory;
    const ok=mine.filter(x=>x.correct).length;
    m.textContent=total+' question'+(total===1?'':'s')+' · yours '+ok+'/'+mine.length;
  }
}
(function(){
  const tiles=document.getElementById('mrTiles');
  if(tiles)tiles.innerHTML=MR_TILES.map(e=>'<button class="mr-tile" onclick="mrSendEmoji(\''+e+'\')" aria-label="Send '+e+'">'+e+'</button>').join('');
  const i=document.getElementById('mrInput');
  if(i){i.addEventListener('input',mrSyncCount);i.addEventListener('keydown',e=>{if(e.key==='Enter')mrSendText();});}
  const _end=window.mpEndGame;
  window.mpEndGame=function(){
    mrBack=new Set();
    const layer=document.getElementById('mrFloats');if(layer)layer.innerHTML='';
    const r=_end.apply(this,arguments);
    Promise.resolve(r).then(mrSync,mrSync);
    return r;
  };
})();

(function(){const el=document.getElementById('page-lobby-room');if(!el)return;
  const go=()=>{if(el.classList.contains('active'))gsEnsureTopics();};
  new MutationObserver(go).observe(el,{attributes:true,attributeFilter:['class']});go();})();

/* non-hosts: "Host is changing <tab>…" in the lock note for a moment after each real change */
let _lrPrevSig=null,_lrEditT=null;
const LR_TAB_NAME={format:'Format',mode:'Mode',topic:'Topic',settings:'Game Settings'};
function lrHostEditing(p){
  const el=document.getElementById('lobbyOptionsLock');if(!el||!p)return;
  const {activeTab,topicScrollTop,changing,...rest}=p;
  const sig=JSON.stringify(rest);
  const first=_lrPrevSig===null;const changed=!first&&sig!==_lrPrevSig;_lrPrevSig=sig;
  if(!changed)return;
  if(!el.dataset.idle)el.dataset.idle=el.innerHTML;
  el.innerHTML='<span class="lr-edit-dot"></span> Host is changing '+(LR_TAB_NAME[activeTab]||'the settings')+'…';
  el.classList.add('editing');
  clearTimeout(_lrEditT);
  _lrEditT=setTimeout(()=>{el.innerHTML=el.dataset.idle;el.classList.remove('editing');},2500);
}

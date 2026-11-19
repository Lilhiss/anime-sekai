// Admin stub: the only admin code every visitor loads (2026-11-19). The admin panel itself
// (js/admin.js + js/admin-shell.js) is fetched the first time an admin opens it, so players never download it.
let isAdmin=false;try{isAdmin=localStorage.getItem('as_admin')==='1';}catch(e){}

async function checkAdminRole(){
  if(!currentUserId||SUPABASE_URL.includes('YOUR_PROJECT'))return;
  let isAdminResult=false;
  try{const{data}=await sb.rpc('is_admin');isAdminResult=data===true;}catch(e){}
  isAdmin=isAdminResult;
  try{localStorage.setItem('as_admin',isAdmin?'1':'0');}catch(e){}
  const adminLink=document.getElementById('adminNavLink');
  if(adminLink){adminLink.style.display=isAdmin?'flex':'none';adminLink.style.opacity=isAdmin?'1':'0';adminLink.style.pointerEvents=isAdmin?'':'none';}
}

// Shared HTML-escape helper (the lobby list and leaderboard use it too)
function _htmlEsc(s){return (s??'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Loads admin.js, then admin-shell.js (which wraps admin.js, so the order matters). Runs once.
let _adminCodeLoad=null;
function loadAdminCode(){
  if(!_adminCodeLoad){
    const add=src=>new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=ok;s.onerror=()=>fail(new Error('Could not load '+src));document.head.appendChild(s);});
    _adminCodeLoad=add('js/admin.js').then(()=>add('js/admin-shell.js')).catch(e=>{_adminCodeLoad=null;throw e;});
  }
  return _adminCodeLoad;
}
// Placeholder goAdmin: admin.js declares the real one, which replaces this as soon as it loads.
function goAdmin(){
  if(!isAdmin){goStep('landing');return;}
  loadAdminCode().then(()=>{if(window.goAdmin!==_goAdminStub)window.goAdmin();})
    .catch(()=>{alert('Couldn\'t load the admin panel. Check your connection and try again.');});
}
const _goAdminStub=goAdmin;
// Browsers already known to be an admin's fetch the panel quietly after the page has loaded, so it opens instantly.
if(isAdmin){const pre=()=>setTimeout(()=>loadAdminCode().catch(()=>{}),1500);if(document.readyState==='complete')pre();else window.addEventListener('load',pre);}

// Banned players can't sign in. Always loaded (moved out of admin-shell.js 2026-11-19 so it still runs
// now that players no longer load the admin code). Sits where admin-shell.js used to, so the wrap order is unchanged.
(function(){
const _lp=window.sbLoadProfile;
if(typeof _lp==='function')window.sbLoadProfile=async function(uid){
  const p=await _lp(uid);
  try{const {data}=await sb.from('profiles').select('banned_until,ban_reason').eq('id',uid).maybeSingle();
    if(data&&data.banned_until&&new Date(data.banned_until)>new Date()){
      try{await sbSignOut();}catch(e){}
      const until=new Date(data.banned_until),forever=until.getFullYear()-new Date().getFullYear()>50;
      throw new Error('This account is banned'+(forever?'':' until '+until.toLocaleDateString(undefined,{day:'numeric',month:'long'}))+(data.ban_reason?' ('+data.ban_reason+')':'')+'.');
    }}catch(e){if(/banned/.test(e.message))throw e;}
  return p;
};
})();

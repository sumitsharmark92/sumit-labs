const TOKEN_KEY='admin_token';
const API='/api';
let state={stats:{},messages:[],visitors:[],projects:[],skills:[],experience:[],activityLog:[],blockedIPs:[],notifications:[]};

function getToken(){return sessionStorage.getItem(TOKEN_KEY)}
function authHeaders(){return{'Content-Type':'application/json','Authorization':'Bearer '+getToken()}}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// Auth check — wait for DOM
document.addEventListener('DOMContentLoaded', function(){
  const token = getToken();
  if(!token){window.location.href='/login';return;}
  fetch(API+'/verify',{headers:authHeaders()})
    .then(function(r){if(!r.ok)throw new Error('bad');return r.json();})
    .then(function(){
      document.getElementById('app').style.display='block';
      initApp();
    })
    .catch(function(){sessionStorage.removeItem(TOKEN_KEY);window.location.href='/login';});
});

function initApp(){
  startClock();setInterval(startClock,1000);
  loadStats();loadMessages();loadVisitors();loadProjects();loadSkills();loadExperience();loadActivity();loadBlockedIPs();loadNotifications();
  initWeeklyChart();
}

function startClock(){var n=new Date();var el=document.getElementById('topbar-clock');if(el)el.textContent=[n.getHours(),n.getMinutes(),n.getSeconds()].map(function(v){return String(v).padStart(2,'0')}).join(':');}

// Navigation
function showSection(id){
  document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active')});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active')});
  var sec=document.getElementById('section-'+id);if(sec)sec.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n){if(n.getAttribute('onclick')&&n.getAttribute('onclick').indexOf("'"+id+"'")!==-1)n.classList.add('active');});
}

// Stats
async function loadStats(){
  try{var r=await fetch(API+'/stats',{headers:authHeaders()});state.stats=await r.json();
  var s=state.stats;
  animNum('stat-visitors',s.totalVisitors||0);animNum('stat-today',s.todayVisitors||0);
  animNum('stat-messages',s.unreadMessages||0);animNum('stat-countries',s.countries||0);
  }catch(e){console.error('Stats error',e);}
}
function animNum(id,target){var el=document.getElementById(id);if(!el)return;var c=0;var step=Math.max(1,Math.floor(target/40));var t=setInterval(function(){c=Math.min(c+step,target);el.textContent=c;if(c>=target)clearInterval(t);},25);}

// Messages
async function loadMessages(){
  try{var r=await fetch(API+'/messages',{headers:authHeaders()});state.messages=await r.json();renderMessages();updateMsgBadge();}catch(e){console.error('Msg error',e);}
}
function renderMessages(){
  var tb=document.getElementById('messages-table');if(!tb)return;
  if(!state.messages.length){tb.innerHTML='<tr><td colspan="7" class="empty-row">NO MESSAGES</td></tr>';return;}
  tb.innerHTML=state.messages.map(function(m){return '<tr>'+
    '<td>'+(m.read?'<span class="badge badge-info">READ</span>':'<span class="badge badge-danger">NEW</span>')+'</td>'+
    '<td style="font-family:var(--font-mono);font-size:.58rem;white-space:nowrap">'+esc((m.timestamp||'').split('T')[0]||'—')+'</td>'+
    '<td style="font-weight:600;color:var(--text)">'+esc(m.name)+'</td>'+
    '<td><a href="mailto:'+esc(m.email)+'" style="color:var(--cyan)">'+esc(m.email)+'</a></td>'+
    '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(m.message)+'">'+esc((m.message||'').slice(0,50))+'</td>'+
    '<td style="font-family:var(--font-mono);font-size:.58rem">'+esc(m.ip||'—')+'</td>'+
    '<td><div style="display:flex;gap:4px">'+
      '<button class="btn btn-primary btn-sm" onclick="viewMsg(\''+m.id+'\')">VIEW</button>'+
      '<button class="btn btn-'+(m.read?'warn':'success')+' btn-sm" onclick="toggleRead(\''+m.id+'\')">'+(m.read?'UNREAD':'READ')+'</button>'+
      '<button class="btn btn-danger btn-sm" onclick="deleteMsg(\''+m.id+'\')">🗑</button>'+
    '</div></td></tr>';}).join('');
}
function updateMsgBadge(){var b=document.getElementById('msg-badge');if(b)b.textContent=state.messages.filter(function(m){return !m.read}).length;}
async function toggleRead(id){var m=state.messages.find(function(x){return x.id===id});if(!m)return;
  await fetch(API+'/messages/'+id,{method:'PATCH',headers:authHeaders(),body:JSON.stringify({read:!m.read})});loadMessages();toast(m.read?'Marked unread':'Marked read');}
async function deleteMsg(id){if(!confirm('Delete this message?'))return;await fetch(API+'/messages/'+id,{method:'DELETE',headers:authHeaders()});loadMessages();toast('Deleted','danger');}
function viewMsg(id){var m=state.messages.find(function(x){return x.id===id});if(!m)return;
  if(!m.read)toggleRead(id);
  openModal('MESSAGE','<div class="form-group"><div class="form-label">FROM</div><div style="color:var(--text);font-weight:600">'+esc(m.name)+'</div></div>'+
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="form-group"><div class="form-label">EMAIL</div><div style="color:var(--cyan)">'+esc(m.email)+'</div></div>'+
  '<div class="form-group"><div class="form-label">PHONE</div><div>'+esc(m.phone||'—')+'</div></div></div>'+
  '<div class="form-group"><div class="form-label">MESSAGE</div><div style="background:var(--bg2);border:1px solid var(--border2);padding:14px;border-radius:6px;line-height:1.7">'+esc(m.message)+'</div></div>',
  '<button class="btn btn-primary" onclick="window.open(\'mailto:'+m.email+'\')">📧 REPLY</button><button class="btn btn-danger" onclick="closeModal()">CLOSE</button>');}
async function clearMessages(){if(!confirm('Clear ALL messages?'))return;await fetch(API+'/messages',{method:'DELETE',headers:authHeaders()});loadMessages();toast('All cleared','danger');}
function filterMessages(){var q=document.getElementById('msg-search').value.toLowerCase();document.querySelectorAll('#messages-table tr').forEach(function(tr){tr.style.display=tr.textContent.toLowerCase().indexOf(q)!==-1?'':'none';});}

// Visitors
async function loadVisitors(){try{var r=await fetch(API+'/visitors?limit=200',{headers:authHeaders()});state.visitors=await r.json();renderVisitors();}catch(e){}}
function renderVisitors(){var tb=document.getElementById('visitors-table');if(!tb)return;
  if(!state.visitors.length){tb.innerHTML='<tr><td colspan="6" class="empty-row">NO VISITORS YET</td></tr>';return;}
  tb.innerHTML=state.visitors.slice(0,100).map(function(v){return '<tr>'+
    '<td style="font-family:var(--font-mono);font-size:.56rem;white-space:nowrap">'+esc((v.timestamp||'').split('T')[0])+'</td>'+
    '<td style="font-family:var(--font-mono);font-size:.58rem;color:var(--cyan)">'+esc(v.ip)+'</td>'+
    '<td>'+esc(v.page||'/')+'</td>'+
    '<td style="color:var(--text3)">'+esc(v.referrer||'Direct')+'</td>'+
    '<td style="font-size:.78rem">'+esc((v.userAgent||'').slice(0,30))+'</td>'+
    '<td><button class="btn btn-danger btn-sm" onclick="blockIP(\''+v.ip+'\')">BLOCK</button></td></tr>';}).join('');}
function filterVisitors(){var q=document.getElementById('vis-search').value.toLowerCase();document.querySelectorAll('#visitors-table tr').forEach(function(tr){tr.style.display=tr.textContent.toLowerCase().indexOf(q)!==-1?'':'none';});}
async function clearVisitors(){if(!confirm('Clear all visitor data?'))return;await fetch(API+'/visitors',{method:'DELETE',headers:authHeaders()});loadVisitors();toast('Cleared','danger');}

// Projects
async function loadProjects(){try{var r=await fetch(API+'/projects');state.projects=await r.json();renderProjects();}catch(e){}}
function renderProjects(){var el=document.getElementById('projects-grid');if(!el)return;
  if(!state.projects.length){el.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--text3);font-family:var(--font-mono);font-size:.7rem;padding:40px">NO PROJECTS — CLICK + NEW PROJECT</div>';return;}
  el.innerHTML=state.projects.map(function(p){return '<div class="panel">'+
    '<div style="display:flex;justify-content:space-between;margin-bottom:8px">'+
      '<span class="badge badge-'+(p.status==='LIVE'?'success':p.status==='WIP'?'warn':'info')+'">'+(p.status||'DRAFT')+'</span>'+
      '<button class="btn btn-danger btn-sm" onclick="deleteProject(\''+p.id+'\')">🗑</button></div>'+
    '<div style="font-family:var(--font-heading);font-size:.85rem;color:var(--cyan);margin-bottom:4px">'+esc(p.name)+'</div>'+
    '<div style="color:var(--text2);font-size:.8rem;margin-bottom:8px;line-height:1.5">'+esc((p.desc||'').slice(0,80))+'</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">'+(p.tags||[]).map(function(t){return '<span class="badge badge-info">'+esc(t)+'</span>'}).join('')+'</div>'+
    '<div style="display:flex;gap:6px">'+(p.live?'<a href="'+esc(p.live)+'" target="_blank" class="btn btn-success btn-sm" style="text-decoration:none">LIVE</a>':'')+(p.github?'<a href="'+esc(p.github)+'" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none">REPO</a>':'')+'</div></div>';}).join('');}
function openAddProject(){openModal('NEW PROJECT',
  '<div class="form-group"><label class="form-label">NAME</label><input class="form-control" id="p-name"></div>'+
  '<div class="form-group"><label class="form-label">DESCRIPTION</label><textarea class="form-control" id="p-desc" rows="3"></textarea></div>'+
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'+
    '<div class="form-group"><label class="form-label">STATUS</label><select class="form-control" id="p-status"><option>LIVE</option><option>WIP</option><option>DRAFT</option></select></div>'+
    '<div class="form-group"><label class="form-label">TAGS (comma)</label><input class="form-control" id="p-tags"></div></div>'+
  '<div class="form-group"><label class="form-label">LIVE URL</label><input class="form-control" id="p-live"></div>'+
  '<div class="form-group"><label class="form-label">GITHUB</label><input class="form-control" id="p-github"></div>',
  '<button class="btn btn-success" onclick="saveProject()">💾 ADD</button><button class="btn btn-danger" onclick="closeModal()">CANCEL</button>');}
async function saveProject(){var name=document.getElementById('p-name');if(!name||!name.value.trim()){toast('Name required','warn');return;}
  await fetch(API+'/projects',{method:'POST',headers:authHeaders(),body:JSON.stringify({name:name.value.trim(),desc:(document.getElementById('p-desc')||{}).value||'',status:(document.getElementById('p-status')||{}).value||'DRAFT',tags:((document.getElementById('p-tags')||{}).value||'').split(',').map(function(t){return t.trim()}).filter(Boolean),live:(document.getElementById('p-live')||{}).value||'',github:(document.getElementById('p-github')||{}).value||''})});
  loadProjects();closeModal();toast('Project added!','success');}
async function deleteProject(id){if(!confirm('Delete this project?'))return;await fetch(API+'/projects/'+id,{method:'DELETE',headers:authHeaders()});loadProjects();toast('Deleted','danger');}

// Skills
async function loadSkills(){try{var r=await fetch(API+'/skills');state.skills=await r.json();renderSkills();}catch(e){}}
function renderSkills(){var el=document.getElementById('skills-list');if(!el)return;
  if(!state.skills.length){el.innerHTML='<div style="color:var(--text3);font-family:var(--font-mono);font-size:.6rem;padding:16px">NO SKILLS ADDED</div>';return;}
  el.innerHTML=state.skills.map(function(s){return '<div class="perf-row" style="border-bottom:1px solid rgba(26,42,68,0.3);padding-bottom:8px;margin-bottom:8px">'+
    '<div class="perf-name" style="width:140px">'+esc(s.name)+'</div>'+
    '<span class="badge badge-info" style="width:70px;text-align:center;margin-right:8px">'+esc(s.category)+'</span>'+
    '<div class="perf-bar"><div class="perf-fill" style="width:'+s.pct+'%;background:linear-gradient(90deg,var(--cyan2),var(--cyan))"></div></div>'+
    '<div class="perf-val">'+s.pct+'%</div>'+
    '<button class="btn btn-danger btn-sm" onclick="deleteSkill(\''+s.id+'\')" style="margin-left:6px">✕</button></div>';}).join('');}
async function addSkill(){var name=document.getElementById('e-skill-name');if(!name||!name.value.trim()){toast('Skill name required','warn');return;}
  var pct=parseInt((document.getElementById('e-skill-pct')||{}).value)||80;
  var cat=(document.getElementById('e-skill-cat')||{}).value||'Other';
  await fetch(API+'/skills',{method:'POST',headers:authHeaders(),body:JSON.stringify({name:name.value.trim(),pct:Math.min(100,Math.max(1,pct)),category:cat})});
  loadSkills();name.value='';var p=document.getElementById('e-skill-pct');if(p)p.value='';toast('Skill added!','success');}
async function deleteSkill(id){await fetch(API+'/skills/'+id,{method:'DELETE',headers:authHeaders()});loadSkills();toast('Removed','danger');}

// Experience
async function loadExperience(){try{var r=await fetch(API+'/experience');state.experience=await r.json();renderExperience();}catch(e){}}
function renderExperience(){var el=document.getElementById('exp-list');if(!el)return;
  if(!state.experience.length){el.innerHTML='<div style="color:var(--text3);font-family:var(--font-mono);font-size:.6rem;padding:16px">NO EXPERIENCE ENTRIES</div>';return;}
  el.innerHTML=state.experience.map(function(e){return '<div style="border:1px solid var(--border2);padding:12px;margin-bottom:8px;border-radius:8px">'+
    '<div style="display:flex;justify-content:space-between"><div><div style="font-weight:700;color:var(--text)">'+esc(e.company)+'</div>'+
    '<div style="color:var(--cyan);font-size:.82rem">'+esc(e.role)+'</div>'+
    '<div style="font-family:var(--font-mono);font-size:.55rem;color:var(--text3);margin-top:2px">'+esc(e.date)+' • '+esc(e.location)+'</div></div>'+
    '<button class="btn btn-danger btn-sm" onclick="deleteExp(\''+e.id+'\')">🗑</button></div>'+
    (e.desc?'<div style="color:var(--text2);font-size:.8rem;margin-top:8px;line-height:1.5">'+esc(e.desc)+'</div>':'')+'</div>';}).join('');}
async function addExperience(){var company=document.getElementById('e-exp-company');if(!company||!company.value.trim()){toast('Company required','warn');return;}
  await fetch(API+'/experience',{method:'POST',headers:authHeaders(),body:JSON.stringify({company:company.value.trim(),role:(document.getElementById('e-exp-role')||{}).value||'',date:(document.getElementById('e-exp-date')||{}).value||'',location:(document.getElementById('e-exp-loc')||{}).value||'',desc:(document.getElementById('e-exp-desc')||{}).value||''})});
  loadExperience();['e-exp-company','e-exp-role','e-exp-date','e-exp-loc','e-exp-desc'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});toast('Added!','success');}
async function deleteExp(id){await fetch(API+'/experience/'+id,{method:'DELETE',headers:authHeaders()});loadExperience();toast('Deleted','danger');}

// Activity Log
async function loadActivity(){try{var r=await fetch(API+'/activity',{headers:authHeaders()});state.activityLog=await r.json();renderActivity();renderActivityFeed();}catch(e){}}
function renderActivity(){var tb=document.getElementById('activity-log-table');if(!tb)return;
  if(!state.activityLog.length){tb.innerHTML='<tr><td colspan="4" class="empty-row">NO ACTIVITY</td></tr>';return;}
  tb.innerHTML=state.activityLog.slice(0,50).map(function(a){var cls=a.status==='SUCCESS'?'success':a.status==='WARN'?'warn':a.status==='DANGER'?'danger':'info';
  return '<tr><td style="font-family:var(--font-mono);font-size:.56rem;white-space:nowrap">'+new Date(a.time).toLocaleString()+'</td><td style="font-weight:600;color:var(--text)">'+esc(a.action)+'</td><td style="color:var(--text2)">'+esc(a.details)+'</td><td><span class="badge badge-'+cls+'">'+esc(a.status)+'</span></td></tr>';}).join('');}
function renderActivityFeed(){var el=document.getElementById('activity-feed');if(!el)return;
  var recent=state.activityLog.slice(0,5);if(!recent.length){el.innerHTML='<div style="color:var(--text3);font-family:var(--font-mono);font-size:.6rem;padding:14px">NO RECENT ACTIVITY</div>';return;}
  el.innerHTML=recent.map(function(a){var clr=a.status==='SUCCESS'?'var(--green)':a.status==='WARN'?'var(--warn)':a.status==='DANGER'?'var(--danger)':'var(--cyan)';
  return '<div class="activity-item"><div class="activity-icon" style="color:'+clr+'">'+(a.status==='SUCCESS'?'✓':a.status==='WARN'?'⚠':'ℹ')+'</div><div><div style="color:var(--text);font-weight:600;font-size:.82rem">'+esc(a.action)+'</div><div style="color:var(--text3);font-size:.78rem">'+esc(a.details)+'</div><div class="activity-time">'+new Date(a.time).toLocaleString()+'</div></div></div>';}).join('');}
async function clearActivityLog(){if(!confirm('Clear all activity?'))return;await fetch(API+'/activity',{method:'DELETE',headers:authHeaders()});loadActivity();toast('Cleared','danger');}

// Blocked IPs
async function loadBlockedIPs(){try{var r=await fetch(API+'/blocked-ips',{headers:authHeaders()});state.blockedIPs=await r.json();renderBlockedIPs();}catch(e){}}
function renderBlockedIPs(){var el=document.getElementById('blocked-ips-list');if(!el)return;
  var cnt=document.getElementById('sec-blocked');if(cnt)cnt.textContent=state.blockedIPs.length;
  if(!state.blockedIPs.length){el.innerHTML='<div style="color:var(--text3);font-family:var(--font-mono);font-size:.6rem;padding:14px">NO BLOCKED IPs</div>';return;}
  el.innerHTML=state.blockedIPs.map(function(ip){return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(26,42,68,0.3)">'+
    '<div style="font-family:var(--font-mono);font-size:.7rem;color:var(--cyan);flex:1">'+esc(ip)+'</div>'+
    '<span class="badge badge-danger">BLOCKED</span>'+
    '<button class="btn btn-success btn-sm" onclick="unblockIP(\''+esc(ip)+'\')">UNBLOCK</button></div>';}).join('');}
async function blockIP(ip){if(!ip)return;await fetch(API+'/blocked-ips',{method:'POST',headers:authHeaders(),body:JSON.stringify({ip:ip})});loadBlockedIPs();toast('Blocked '+ip,'danger');}
async function unblockIP(ip){await fetch(API+'/blocked-ips/'+encodeURIComponent(ip),{method:'DELETE',headers:authHeaders()});loadBlockedIPs();toast('Unblocked','success');}
function blockIPManual(){var ip=document.getElementById('block-ip-input');if(ip&&ip.value.trim()){blockIP(ip.value.trim());ip.value='';}}

// Notifications
async function loadNotifications(){try{var r=await fetch(API+'/notifications',{headers:authHeaders()});state.notifications=await r.json();renderNotifications();}catch(e){}}
function renderNotifications(){var el=document.getElementById('notifications-list');if(!el)return;
  if(!state.notifications.length){el.innerHTML='<div class="alert alert-info">NO NOTIFICATIONS</div>';return;}
  el.innerHTML=state.notifications.map(function(n){var cls=n.type==='WARN'?'warn':n.type==='DANGER'?'danger':n.type==='SUCCESS'?'success':'info';
  return '<div class="alert alert-'+cls+'" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
    '<span>['+n.type+'] '+esc(n.message)+' <span style="opacity:.5;font-size:.5rem;margin-left:6px">'+new Date(n.time).toLocaleString()+'</span></span>'+
    '<button class="btn btn-danger btn-sm" onclick="dismissNotif(\''+n.id+'\')" style="flex-shrink:0;margin-left:12px">✕</button></div>';}).join('');}
async function dismissNotif(id){await fetch(API+'/notifications/'+id,{method:'DELETE',headers:authHeaders()});loadNotifications();}
async function clearNotifications(){await fetch(API+'/notifications',{method:'DELETE',headers:authHeaders()});loadNotifications();toast('Cleared');}
async function addTestNotif(){var types=['INFO','WARN','DANGER','SUCCESS'];var msgs=['New visitor detected','Suspicious activity','Backup complete','New message received'];
  await fetch(API+'/notifications',{method:'POST',headers:authHeaders(),body:JSON.stringify({type:types[Math.floor(Math.random()*4)],message:msgs[Math.floor(Math.random()*4)]})});loadNotifications();toast('Test notification added');}

// Charts
function initWeeklyChart(){var c=document.getElementById('weekly-chart');if(!c)return;var vals=[42,67,89,54,103,78,38];var mx=Math.max.apply(null,vals);
  c.innerHTML='';vals.forEach(function(v){var pct=Math.round(v/mx*100);var col=document.createElement('div');col.style.cssText='flex:1;display:flex;flex-direction:column;align-items:center;gap:3px';
  col.innerHTML='<div style="font-family:var(--font-mono);font-size:.45rem;color:var(--text3)">'+v+'</div><div style="width:100%;background:linear-gradient(0deg,var(--cyan2),var(--cyan));border-radius:2px 2px 0 0;height:'+pct+'%;min-height:2px"></div>';c.appendChild(col);});}

// Tabs
function switchTab(name){document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active')});document.querySelectorAll('.tab-content').forEach(function(c){c.classList.remove('active')});
  var btns=document.querySelectorAll('.tab-btn');for(var i=0;i<btns.length;i++){if(btns[i].getAttribute('onclick')&&btns[i].getAttribute('onclick').indexOf("'"+name+"'")!==-1)btns[i].classList.add('active');}
  var tab=document.getElementById('tab-'+name);if(tab)tab.classList.add('active');}

// Settings
async function changePassword(){var curr=(document.getElementById('curr-pwd')||{}).value||'';var nw=(document.getElementById('new-pwd')||{}).value||'';var conf=(document.getElementById('confirm-pwd')||{}).value||'';
  if(nw.length<6){toast('Password must be at least 6 characters','warn');return;}if(nw!==conf){toast('Passwords do not match','danger');return;}
  try{var r=await fetch(API+'/password',{method:'POST',headers:authHeaders(),body:JSON.stringify({currentPassword:curr,newPassword:nw})});var d=await r.json();
  if(d.success){toast('Password changed successfully!','success');['curr-pwd','new-pwd','confirm-pwd'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});}
  else toast(d.error||'Failed to change password','danger');}catch(e){toast('Server error','danger');}}

// Modal
function openModal(title,body,footer){document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=body;document.getElementById('modal-footer').innerHTML=footer||'';document.getElementById('modal-overlay').classList.add('open');}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open');}
document.addEventListener('DOMContentLoaded',function(){var overlay=document.getElementById('modal-overlay');if(overlay)overlay.addEventListener('click',function(e){if(e.target.id==='modal-overlay')closeModal();});});

// Toast
function toast(msg,type){type=type||'info';var c=document.getElementById('toast-container');if(!c)return;var el=document.createElement('div');el.className='toast '+type;el.textContent='['+type.toUpperCase()+'] '+msg;el.onclick=function(){el.remove()};c.appendChild(el);setTimeout(function(){el.style.animation='slideOut .3s ease forwards';setTimeout(function(){el.remove()},300);},3000);}

// Logout
function doLogout(){sessionStorage.removeItem(TOKEN_KEY);window.location.href='/login';}

// Export
function exportData(){fetch(API+'/export',{headers:authHeaders()}).then(function(r){return r.json()}).then(function(d){dlFile(JSON.stringify(d,null,2),'backup_'+Date.now()+'.json','application/json');toast('Data exported!','success');});}
function dlFile(content,filename,type){var b=new Blob([content],{type:type});var u=URL.createObjectURL(b);var a=document.createElement('a');a.href=u;a.download=filename;a.click();URL.revokeObjectURL(u);}
function openSite(){window.open('https://sumitsharmark92.github.io/','_blank');}

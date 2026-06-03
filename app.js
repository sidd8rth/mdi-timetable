// ===========================================================================
//  MDI PGDM Term-IV — personal timetable, friends compare, attendance tracker
// ===========================================================================
import { FIREBASE_CONFIG } from "./firebase-config.js";

const D = window.TT_DATA;
const COURSE_PALETTE = ["#2563eb","#0891b2","#16a34a","#d97706","#dc2626","#0ea5e9","#0d9488","#ca8a04","#db2777","#4f46e5","#65a30d","#e11d48"];
const PERSON_PALETTE = ["#2563eb","#dc2626","#16a34a","#d97706","#0891b2","#7c3aed"];

const colorFor = (() => { const m={}; let i=0; return ab => (m[ab] ??= COURSE_PALETTE[i++%COURSE_PALETTE.length]); })();

// ---- helpers ---------------------------------------------------------------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const STUDENTS = Object.entries(D.students)
  .map(([roll, s]) => ({ roll, name: s.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

function isSectioned(course){ return Object.keys(D.meetings[course]||{}).some(k=>k!==""); }
function clsLabel(course, section){ return course + (section && isSectioned(course) ? ` (${section})` : ""); }

function meetingsFor(roll){
  const s = D.students[roll]; if(!s) return [];
  const out = [];
  s.courses.forEach(c => {
    const secs = D.meetings[c.course]; if(!secs) return;
    let key = c.section || "";
    if(!(key in secs)){ const ks=Object.keys(secs); key = ks.includes("")?"":(ks.length===1?ks[0]:key); }
    (secs[key]||[]).forEach(m => out.push({ ...m, course:c.course, section:c.section }));
  });
  return out;
}

// ---- reusable autocomplete -------------------------------------------------
function makeSearch(input, resultsEl, onPick, exclude=()=>false){
  let current=[], active=-1;
  const run = () => {
    const term = input.value.trim().toLowerCase();
    current = term ? STUDENTS.filter(s =>
      !exclude(s.roll) && (s.name.toLowerCase().includes(term) || s.roll.toLowerCase().includes(term))
    ).slice(0,30) : [];
    active=-1; render();
  };
  const hilite = (name, term) => {
    const i = name.toLowerCase().indexOf(term.toLowerCase());
    if(!term || i<0) return esc(name);
    return esc(name.slice(0,i))+"<em>"+esc(name.slice(i,i+term.length))+"</em>"+esc(name.slice(i+term.length));
  };
  const render = () => {
    const term = input.value.trim();
    if(!current.length){
      resultsEl.innerHTML = term ? '<div class="empty-res">No matching student found.</div>' : '';
      resultsEl.classList.toggle("open", !!term); return;
    }
    resultsEl.innerHTML = current.map((s,i)=>
      `<div class="result ${i===active?'active':''}" data-roll="${s.roll}"><span>${hilite(s.name,term)}</span><span class="roll">${s.roll}</span></div>`
    ).join("");
    resultsEl.classList.add("open");
  };
  input.addEventListener("input", run);
  input.addEventListener("focus", () => { if(input.value.trim()) run(); });
  input.addEventListener("keydown", e => {
    if(!current.length) return;
    if(e.key==="ArrowDown"){active=Math.min(active+1,current.length-1);render();e.preventDefault();}
    else if(e.key==="ArrowUp"){active=Math.max(active-1,0);render();e.preventDefault();}
    else if(e.key==="Enter"&&active>=0){pick(current[active].roll);e.preventDefault();}
    else if(e.key==="Escape"){resultsEl.classList.remove("open");}
  });
  resultsEl.addEventListener("mousedown", e => { const r=e.target.closest(".result"); if(r) pick(r.dataset.roll); });
  document.addEventListener("click", e => { if(!e.target.closest(".search-box")) resultsEl.classList.remove("open"); });
  function pick(roll){ resultsEl.classList.remove("open"); onPick(roll); }
  return { clear:()=>{input.value="";current=[];render();} };
}

// ===========================================================================
//  TIMETABLE TAB
// ===========================================================================
let currentRoll = null;
let markEnabled = false, markWeeks = [], markWeekIdx = 0;   // in-grid attendance marking

makeSearch($("q"), $("results"), roll => selectStudent(roll));

function selectStudent(roll){
  const s = D.students[roll]; if(!s) return;
  currentRoll = roll;
  localStorage.setItem("tt_lastRoll", roll);
  $("q").value = s.name; $("q").blur();
  const ms = meetingsFor(roll);
  $("placeholder").style.display="none";
  $("studentBar").classList.add("show");
  $("ttActions").style.display="flex";
  $("legend").style.display="block";
  $("dlTT").onclick = () => downloadTimetablePDF(roll);
  $("avatar").textContent = (s.name.trim()[0]||"?").toUpperCase();
  $("sName").textContent = s.name;
  $("sMeta").textContent = "Roll " + roll;
  const nc = new Set(s.courses.map(c=>c.course)).size;
  $("countPill").textContent = `${nc} courses · ${ms.length} sessions/week`;
  renderMarkBar(); renderGrid(ms); renderAgenda(ms); renderLegend(s.courses); setView(currentView);
  if(compareInited) renderCompare();
}

function renderGrid(ms){
  // transposed: days down the rows, time slots across the columns
  $("thead").innerHTML = "<tr><th class='daycol'>Day</th>"+
    D.slots.map((slot,i)=>`<th><span class='slotnum'>Slot ${i+1}</span>${slot}</th>`).join("")+"</tr>";
  const idx={}; ms.forEach(m=>{(idx[m.day+"|"+m.slot] ??= []).push(m);});
  const ov = markEnabled ? computeWeekOverlay() : {cancelled:new Set(),adds:{}};
  let rows="";
  D.days.forEach((day,di)=>{
    rows+=`<tr><td class='daycol'>${day}</td>`;
    D.slots.forEach((slot,si)=>{
      const here=idx[day+"|"+si]||[];
      const addsHere=ov.adds[di+"|"+si]||[];
      if(!here.length && !addsHere.length){ rows+="<td class='cell free'></td>"; return; }
      let cell="<td class='cell'>";
      here.forEach(m=>{
        const col=colorFor(m.course);
        const ckey=m.course+"|"+(m.section||"");
        const canc = markEnabled && ov.cancelled.has(di+"|"+si+"|"+ckey);
        let markCls="", controls="";
        if(markEnabled){
          const key=attKey(m.course,m.section,fmtDate(dateForCell(di)),m.slot);
          const st=ATT.data[key]||"";
          markCls = st==="p"?" marked-p":st==="a"?" marked-a":"";
          if(!canc) controls=`<span class='mkrow' data-key='${key}'>`+
            `<button class='mkmini p ${st==="p"?"on":""}' data-v='p'>✓</button>`+
            `<button class='mkmini a ${st==="a"?"on":""}' data-v='a'>✗</button></span>`;
        }
        cell += `<div class='cls${markCls}${canc?' cancelled':''}' style='--c:${col};background:${col}1f'><span class='ab'>${clsLabel(m.course,m.section)}</span><span class='rm'>${esc(m.details)}</span>${canc?"<span class='chgbadge' style='color:var(--bad)'>Cancelled</span>":""}${controls}</div>`;
      });
      addsHere.forEach(a=>{
        const [c,sec]=a.ck.split("|"); const col=colorFor(c);
        cell += `<div class='cls added' style='--c:${col};background:${col}1f'><span class='ab'>${esc(clsLabel(c,sec))}</span><span class='rm'>${esc(a.room||"")}</span><span class='chgbadge' style='color:var(--good)'>Extra${a.note?" · "+esc(a.note):""}</span></div>`;
      });
      cell+="</td>"; rows+=cell;
    });
    rows+="</tr>";
  });
  $("tbody").innerHTML = rows;

  if(markEnabled){
    $("tbody").querySelectorAll(".mkmini").forEach(btn => btn.onclick = e => {
      e.stopPropagation(); toggleMark(btn.parentElement.dataset.key, btn.dataset.v);
    });
  }
}

// toggle one attendance mark and keep grid + agenda views in sync
function toggleMark(key, v){
  ATT.data[key] = (ATT.data[key]===v) ? undefined : v;
  if(ATT.data[key]===undefined) delete ATT.data[key];
  if(currentRoll){ const ms=meetingsFor(currentRoll); renderGrid(ms); renderAgenda(ms); }
  setAttDirty();   // held until the user confirms save (on leave or via Save bar)
}

// ---- in-grid attendance marking helpers ----
function initMarkWeeks(){
  if(markWeeks.length) return;
  const d=new Date(TERM_START);
  while(d.getDay()!==1) d.setDate(d.getDate()+1);   // first Monday
  while(d<=TERM_END){ markWeeks.push(new Date(d)); d.setDate(d.getDate()+7); }
  const now=new Date();
  const i=markWeeks.findIndex(m=>{ const e=new Date(m); e.setDate(e.getDate()+7); return now>=m && now<e; });
  markWeekIdx = i>=0 ? i : 0;
}
function dateForCell(dayIdx){ const d=new Date(markWeeks[markWeekIdx]); d.setDate(d.getDate()+dayIdx); return d; }
function refreshTimetable(){ if(currentRoll){ const ms=meetingsFor(currentRoll); renderMarkBar(); renderGrid(ms); renderAgenda(ms); } }

function renderMarkBar(){
  const el=$("ttMarkBar"); if(!el) return;
  markEnabled=false;
  if(!ATT.cloud || !currentRoll){ el.innerHTML=""; return; }
  if(!ATT.user){
    el.innerHTML=`<div class="markbar signin"><span>🔐 Sign in to mark attendance right from your timetable.</span><button class="btn btn-primary btn-sm" id="ttSignin">Sign in</button></div>`;
    $("ttSignin").onclick=openAuthModal;
    return;
  }
  if(ATT.role==="admin"){ el.innerHTML=`<div class="markbar"><span class="mhint">Admin account — open the Attendance tab for the dashboard.</span></div>`; return; }
  if(currentRoll!==ATT.meRoll){
    el.innerHTML=`<div class="markbar signin"><span>You're viewing someone else's timetable.</span><button class="btn btn-ghost btn-sm" id="ttMine">Open my timetable to mark</button></div>`;
    if(ATT.meRoll) $("ttMine").onclick=()=>selectStudent(ATT.meRoll);
    else $("ttMine").remove();
    return;
  }
  // marking enabled for own timetable
  initMarkWeeks(); markEnabled=true;
  const m=markWeeks[markWeekIdx], end=new Date(m); end.setDate(end.getDate()+4);
  const fmt=d=>d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
  el.innerHTML=`<div class="markbar">
    <div class="wknav">
      <button class="wkbtn" id="wkPrev" ${markWeekIdx<=0?"disabled":""}>‹</button>
      <span class="wklabel">Week of ${fmt(m)} – ${fmt(end)}</span>
      <button class="wkbtn" id="wkNext" ${markWeekIdx>=markWeeks.length-1?"disabled":""}>›</button>
    </div>
    <span class="mhint">Tap ✓ / ✗ on a class to mark that day · synced to your account</span>
  </div>`;
  $("wkPrev").onclick=()=>{ if(markWeekIdx>0){ markWeekIdx--; refreshTimetable(); } };
  $("wkNext").onclick=()=>{ if(markWeekIdx<markWeeks.length-1){ markWeekIdx++; refreshTimetable(); } };
}

function renderAgenda(ms){
  const byDay={}; ms.forEach(m=>{(byDay[m.day] ??= []).push(m);});
  const ov = markEnabled ? computeWeekOverlay() : {cancelled:new Set(),adds:{}};
  $("agendaView").innerHTML = D.days.map((day,di)=>{
    const items=(byDay[day]||[]).slice().sort((a,b)=>a.slot-b.slot);
    const added=[];
    Object.keys(ov.adds).forEach(k=>{ const [d,s]=k.split("|"); if(+d===di) ov.adds[k].forEach(a=>added.push({slot:+s,a})); });
    let html = items.map(m=>{
      const col=colorFor(m.course), cm=D.courses[m.course]||{};
      const ckey=m.course+"|"+(m.section||"");
      const canc = markEnabled && ov.cancelled.has(di+"|"+m.slot+"|"+ckey);
      let stCls="", marks="";
      if(markEnabled){
        const key=attKey(m.course,m.section,fmtDate(dateForCell(di)),m.slot);
        const st=ATT.data[key]||"";
        stCls = st==="p"?" ag-p":st==="a"?" ag-a":"";
        if(!canc) marks=`<span class='ag-marks' data-key='${key}'>`+
          `<button class='mkmini p ${st==="p"?"on":""}' data-v='p'>✓</button>`+
          `<button class='mkmini a ${st==="a"?"on":""}' data-v='a'>✗</button></span>`;
      }
      if(canc) stCls=" ag-cancel";
      return `<div class='ag-item${stCls}'><div class='ag-time'>${D.slots[m.slot]}</div><div class='ag-bar' style='--c:${col}'></div><div class='ag-main'><div class='t'>${clsLabel(m.course,m.section)}${canc?" · <span style='color:var(--bad)'>Cancelled</span>":""}</div><div class='s'>${esc(cm.name)}</div></div><div class='ag-room'>${esc(m.details)}</div>${marks}</div>`;
    }).join("");
    html += added.sort((x,y)=>x.slot-y.slot).map(({slot,a})=>{
      const [c,sec]=a.ck.split("|"); const col=colorFor(c), cm=D.courses[c]||{};
      return `<div class='ag-item'><div class='ag-time'>${D.slots[slot]}</div><div class='ag-bar' style='--c:${col}'></div><div class='ag-main'><div class='t'>${esc(clsLabel(c,sec))} · <span style='color:var(--good)'>Extra</span></div><div class='s'>${esc(cm.name)}${a.note?" · "+esc(a.note):""}</div></div><div class='ag-room'>${esc(a.room||"")}</div></div>`;
    }).join("");
    const total=items.length+added.length;
    const body = total ? html : "<div class='day-empty'>No classes 🎉</div>";
    return `<div class='day-block'><div class='day-head'>${day}<span class='n'>${total} class${total===1?"":"es"}</span></div>${body}</div>`;
  }).join("");

  if(markEnabled){
    $("agendaView").querySelectorAll(".ag-marks .mkmini").forEach(btn => btn.onclick = e => {
      e.stopPropagation(); toggleMark(btn.parentElement.dataset.key, btn.dataset.v);
    });
  }
}

function renderLegend(courses){
  const seen=new Set(); const uniq=courses.filter(c=>!seen.has(c.course)&&seen.add(c.course));
  $("legendGrid").innerHTML = uniq.map(c=>{
    const cm=D.courses[c.course]||{}, col=colorFor(c.course);
    const sec = isSectioned(c.course) ? courses.filter(x=>x.course===c.course).map(x=>x.section).filter(Boolean) : [];
    return `<div class='lg' style='--c:${col}'><span class='swatch'></span><div><div class='ab'>${c.course}${sec.length?" · Sec "+sec.join("/"):""}</div><div class='nm'>${esc(cm.name)}</div><div class='fac'>${esc((cm.faculty||[]).join(", "))}</div></div></div>`;
  }).join("");
}

let currentView="grid";
function setView(v){
  currentView=v;
  $("gridView").style.display = v==="grid"?"block":"none";
  $("agendaView").style.display = v==="agenda"?"flex":"none";
  document.querySelectorAll("#viewToggle button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
}
document.querySelectorAll("#viewToggle button").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.v)));

// ===========================================================================
//  FRIENDS TAB
// ===========================================================================
let friends = JSON.parse(localStorage.getItem("tt_friends")||"[]");
let squads = JSON.parse(localStorage.getItem("tt_squads")||"[]");
let compareInited=false;
const personColor = roll => {
  const all=[currentRoll,...friends.map(f=>f.roll)].filter(Boolean);
  const i=all.indexOf(roll); return PERSON_PALETTE[(i<0?all.length:i)%PERSON_PALETTE.length];
};

makeSearch($("qf"), $("resultsF"), roll => addFriend(roll), roll => roll===currentRoll || friends.some(f=>f.roll===roll));

function saveFriends(){ localStorage.setItem("tt_friends", JSON.stringify(friends)); updateFriendBadge(); }
function updateFriendBadge(){
  const el=$("friendCount"); el.textContent=friends.length;
  el.classList.toggle("hidden", friends.length===0);
}
function addFriend(roll){
  if(friends.length>=5 || friends.some(f=>f.roll===roll)) return;
  const s=D.students[roll]; if(!s) return;
  friends.push({roll, name:s.name}); saveFriends();
  $("qf").value=""; renderFriends();
}
function removeFriend(roll){ friends=friends.filter(f=>f.roll!==roll); saveFriends(); renderFriends(); }

function renderFriends(){
  compareInited=true;
  $("friendChips").innerHTML = friends.map(f=>
    `<span class="chip" style="--c:${personColor(f.roll)}"><span class="pdot"></span>${esc(f.name)} <button data-roll="${f.roll}" title="Remove">×</button></span>`
  ).join("") || "";
  $("friendsHint").textContent = friends.length
    ? `${friends.length}/5 friends added. ${currentRoll? "Comparing with your schedule below." : "Pick yourself on the Timetable tab to compare."}`
    : "No friends yet. Add classmates to see when everyone is free.";
  $("friendChips").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>removeFriend(b.dataset.roll)));
  renderSquads();
  renderCompare();
  // pull cancellations/reschedules for everyone shown, then re-render the overlay
  if(ATT.cloud && ATT.user) fetchCompareChanges().then(renderCompare);
}

// ---- squads (shared & DB-backed when signed in; device-local otherwise) ----
let cloudSquads=[], cloudSquadErr=null, selectedSquadId=null, squadDetailOpen=false;
const squadHint = t => { const h=$("squadHint"); if(h) h.textContent=t||""; };
function saveSquads(){ localStorage.setItem("tt_squads", JSON.stringify(squads)); }

async function fetchCloudSquads(){
  cloudSquadErr=null;
  if(!(ATT.cloud && ATT.user && ATT.meRoll)){ cloudSquads=[]; return; }
  try{
    const {collection,query,where,getDocs}=ATT.fb;
    const snap=await withTimeout(getDocs(query(collection(ATT.db,"squads"), where("participants","array-contains",ATT.meRoll))),12000);
    cloudSquads=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){ cloudSquadErr=e.message; console.error("[squads] fetch failed:",e.code||"",e.message); cloudSquads=[]; }
}

function renderSquads(){
  const el=$("squadChips"); if(!el) return;
  const lbl=$("squadPanel").querySelector("label.fld");
  const createRow=$("squadCreateRow");
  // hide the "create / save squad" row only while the edit panel is open (avoids a duplicate name field)
  const editing = ATT.cloud && ATT.user && ATT.meRoll && squadDetailOpen && selectedSquadId && cloudSquads.some(s=>s.id===selectedSquadId && s.status && s.status[ATT.meRoll]==="member");
  if(createRow) createRow.style.display = editing ? "none" : "flex";

  // ----- signed-in: shared squads -----
  if(ATT.cloud && ATT.user && ATT.meRoll){
    lbl.textContent="Squads — shared groups; invite classmates and they'll see it once they accept";
    const mine=cloudSquads.filter(s=>s.status && s.status[ATT.meRoll]==="member");
    const invites=cloudSquads.filter(s=>s.status && s.status[ATT.meRoll]==="invited");
    if(selectedSquadId && !mine.some(s=>s.id===selectedSquadId)) selectedSquadId=null;
    let html="";
    if(cloudSquadErr) html+=`<div class="err" style="margin-bottom:8px">Couldn't load squads: ${esc(cloudSquadErr)} — publish the squad rules (README).</div>`;
    const sel = selectedSquadId && cloudSquads.find(s=>s.id===selectedSquadId);
    if(mine.length){
      html+=`<div class="row" style="margin-bottom:8px">
        <select id="squadSelect" class="squadsel"><option value="">Load a squad…</option>
        ${mine.map(s=>`<option value="${s.id}" ${s.id===selectedSquadId?"selected":""}>${esc(s.name)} · ${s.participants.length} people</option>`).join("")}</select>
        ${sel?`<button class="btn btn-ghost btn-sm" id="squadToggle">${squadDetailOpen?"Hide ▲":"Manage ▾"}</button>`:""}</div>`;
    } else if(!cloudSquadErr){
      html+=`<div class="hint" style="margin:0 0 8px">No squads yet. Add friends above, name it, then “Save squad” to invite them.</div>`;
    }
    if(sel && squadDetailOpen) html += renderSquadDetail(sel);
    if(invites.length){
      html+=`<div class="section-h" style="margin:12px 0 8px">Pending invites</div>`+
        invites.map(s=>`<div class="row" style="margin-bottom:6px;justify-content:space-between">
          <span>👥 <b>${esc(s.name)}</b> · from ${esc((D.students[s.ownerRoll]||{}).name||s.ownerRoll)} · ${s.participants.length} people</span>
          <span class="row"><button class="btn btn-primary btn-sm sq-accept" data-id="${s.id}">Accept</button>
          <button class="btn btn-ghost btn-sm sq-decline" data-id="${s.id}">Decline</button></span></div>`).join("");
    }
    el.innerHTML=html;
    squadHint(mine.length?"Pick a squad to load everyone into the compare view below.":"");
    if($("squadSelect")) $("squadSelect").onchange=()=>{
      selectedSquadId=$("squadSelect").value||null;
      const s=cloudSquads.find(x=>x.id===selectedSquadId);
      if(s) loadSquadMembers(s); else renderSquads();
    };
    if($("squadToggle")) $("squadToggle").onclick=()=>{ squadDetailOpen=!squadDetailOpen; renderSquads(); };
    wireSquadDetail(sel);
    el.querySelectorAll(".sq-accept").forEach(b=>b.onclick=()=>setMyStatus(b.dataset.id,"member"));
    el.querySelectorAll(".sq-decline").forEach(b=>b.onclick=()=>setMyStatus(b.dataset.id,"declined"));
    return;
  }

  // ----- signed-out: device-local squads -----
  lbl.textContent="Squads — save your current friends as a group (this device). Sign in to share squads.";
  el.innerHTML = squads.map((s,i)=>
    `<span class="chip"><button class="sq-load" data-i="${i}" style="background:none;border:none;cursor:pointer;font:inherit;font-weight:700;color:inherit;display:inline-flex;align-items:center;gap:6px">👥 ${esc(s.name)} · ${s.members.length}</button><button class="sq-del" data-i="${i}" title="Delete squad">×</button></span>`
  ).join("");
  squadHint(squads.length?"Tap a squad to load it into your friends list.":"No saved squads yet. Add friends above, then save them as a squad.");
  el.querySelectorAll(".sq-load").forEach(b=>b.onclick=()=>loadSquad(+b.dataset.i));
  el.querySelectorAll(".sq-del").forEach(b=>b.onclick=()=>deleteSquad(+b.dataset.i));
}

function loadSquadMembers(s){
  selectedSquadId=s.id;
  friends = s.participants.filter(r=>r!==ATT.meRoll).slice(0,5).map(r=>({roll:r,name:(D.students[r]||{}).name||r}));
  saveFriends(); renderFriends();
}

function renderSquadDetail(s){
  const owner = s.ownerUid===ATT.user.uid;
  const stColor = st => st==="member"?"var(--good)":st==="invited"?"var(--warn)":"var(--muted)";
  const memberRows = s.participants.map(r=>{
    const st = r===s.ownerRoll ? "owner" : (s.status?.[r]||"");
    const nm = (D.students[r]||{}).name || r;
    const rm = owner && r!==s.ownerRoll ? ` <button class="sq-rm" data-r="${r}" title="Remove">×</button>` : "";
    return `<span class="chip"><span class="pdot" style="background:${stColor(s.status?.[r])}"></span>${esc(nm)} <span style="color:var(--muted);font-size:.74rem">${st}</span>${rm}</span>`;
  }).join("");
  const head = owner
    ? `${esc(s.name)} <span style="color:var(--muted);font-weight:600;font-size:.8rem">· you own this</span>`
    : `${esc(s.name)} <span style="color:var(--muted);font-weight:600;font-size:.8rem">· invited by ${esc((D.students[s.ownerRoll]||{}).name||s.ownerRoll)}</span>`;
  let edit;
  if(owner){
    edit=`<div class="row" style="margin-top:12px">
        <input id="sqRename" type="text" value="${esc(s.name)}" style="flex:1;min-width:160px">
        <button class="btn btn-ghost btn-sm" id="sqRenameBtn">Rename</button></div>
      <div class="search-box" style="margin-top:8px"><input id="sqAdd" type="text" autocomplete="off" placeholder="Invite someone (name or roll)…"><div id="sqAddRes" class="results"></div></div>
      <div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="sqDelete" style="color:var(--bad)">Delete squad</button></div>`;
  } else {
    edit=`<div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="sqLeave">Leave squad</button></div>`;
  }
  return `<div class="panel" style="margin-top:10px;box-shadow:none;border-style:dashed">
     <div style="font-weight:800;font-family:'Plus Jakarta Sans';margin-bottom:10px">${head}</div>
     <div class="chips">${memberRows}</div>${edit}</div>`;
}

function wireSquadDetail(s){
  if(!s) return;
  const owner = s.ownerUid===ATT.user.uid;
  if(owner){
    if($("sqRenameBtn")) $("sqRenameBtn").onclick=()=>renameSquad(s.id, $("sqRename").value.trim());
    if($("sqDelete")) $("sqDelete").onclick=()=>deleteCloudSquad(s.id);
    document.querySelectorAll("#squadChips .sq-rm").forEach(b=>b.onclick=()=>removeMember(s.id,b.dataset.r));
    if($("sqAdd")) makeSearch($("sqAdd"),$("sqAddRes"), roll=>addMember(s.id,roll), roll=>s.participants.includes(roll));
  } else {
    if($("sqLeave")) $("sqLeave").onclick=()=>leaveCloudSquad(s.id);
  }
}

async function renameSquad(id,name){
  if(!name){ squadHint("Enter a new name."); return; }
  try{ const {doc,updateDoc}=ATT.fb; await withTimeout(updateDoc(doc(ATT.db,"squads",id),{name})); await fetchCloudSquads(); renderSquads(); squadHint("Renamed."); }
  catch(e){ console.error("[squads] rename",e.code,e.message); squadHint("Rename failed: "+e.message); }
}
async function addMember(id,roll){
  try{ const {doc,updateDoc,arrayUnion}=ATT.fb;
    await withTimeout(updateDoc(doc(ATT.db,"squads",id),{participants:arrayUnion(roll),["status."+roll]:"invited"}));
    await fetchCloudSquads(); const s=cloudSquads.find(x=>x.id===id);
    if(s) loadSquadMembers(s); else renderSquads();
    squadHint("Invited "+((D.students[roll]||{}).name||roll)+".");
  }catch(e){ console.error("[squads] add",e.code,e.message); squadHint("Invite failed: "+e.message); }
}
async function removeMember(id,roll){
  try{ const {doc,updateDoc,arrayRemove,deleteField}=ATT.fb;
    await withTimeout(updateDoc(doc(ATT.db,"squads",id),{participants:arrayRemove(roll),["status."+roll]:deleteField()}));
    await fetchCloudSquads(); const s=cloudSquads.find(x=>x.id===id);
    if(s) loadSquadMembers(s); else renderSquads();
  }catch(e){ console.error("[squads] remove",e.code,e.message); squadHint("Remove failed: "+e.message); }
}

async function saveSquad(){
  if(ATT.cloud && ATT.user && ATT.meRoll) return createCloudSquad();
  const name=$("squadName").value.trim();
  if(!name){ squadHint("Enter a squad name first."); return; }
  if(!friends.length){ squadHint("Add at least one friend before saving a squad."); return; }
  const squad={ name, members:friends.map(f=>({roll:f.roll,name:f.name})) };
  const i=squads.findIndex(s=>s.name.toLowerCase()===name.toLowerCase());
  if(i>=0) squads[i]=squad; else squads.push(squad);
  saveSquads(); $("squadName").value=""; renderSquads();
}
function loadSquad(i){ const s=squads[i]; if(!s) return; friends=s.members.slice(0,5).map(m=>({roll:m.roll,name:m.name})); saveFriends(); renderFriends(); }
function deleteSquad(i){ squads.splice(i,1); saveSquads(); renderSquads(); }

async function createCloudSquad(){
  const name=$("squadName").value.trim();
  if(!name){ squadHint("Enter a squad name first."); return; }
  if(!friends.length){ squadHint("Add friends above first — they'll be invited to the squad."); return; }
  try{
    const {addDoc,collection,serverTimestamp}=ATT.fb;
    const others=friends.map(f=>f.roll).filter(r=>r!==ATT.meRoll);
    const participants=[ATT.meRoll,...others];
    const status={[ATT.meRoll]:"member"}; others.forEach(r=>status[r]="invited");
    await withTimeout(addDoc(collection(ATT.db,"squads"),{name,ownerUid:ATT.user.uid,ownerRoll:ATT.meRoll,participants,status,createdAt:serverTimestamp()}));
    $("squadName").value=""; await fetchCloudSquads(); renderSquads();
    squadHint(`Squad “${name}” created — ${others.length} invite(s) sent.`);
  }catch(e){ console.error("[squads] create",e.code,e.message); squadHint("Couldn't create squad: "+e.message+" (publish squad rules — see README)."); }
}
async function setMyStatus(id,st){
  try{ const {doc,updateDoc}=ATT.fb; await withTimeout(updateDoc(doc(ATT.db,"squads",id),{["status."+ATT.meRoll]:st})); await fetchCloudSquads(); renderSquads(); }
  catch(e){ console.error("[squads] status",e.code,e.message); squadHint("Couldn't update: "+e.message); }
}
function leaveCloudSquad(id){ return setMyStatus(id,"left"); }
async function deleteCloudSquad(id){
  try{ const {doc,deleteDoc}=ATT.fb; await withTimeout(deleteDoc(doc(ATT.db,"squads",id))); await fetchCloudSquads(); renderSquads(); }
  catch(e){ console.error("[squads] delete",e.code,e.message); squadHint("Couldn't delete: "+e.message); }
}

function renderCompare(){
  const wrap=$("compareWrap");
  if(!currentRoll && !friends.length){ wrap.innerHTML=""; return; }
  const people=[];
  if(currentRoll) people.push({roll:currentRoll, name:D.students[currentRoll].name, you:true});
  friends.forEach(f=> people.push({roll:f.roll, name:f.name}));
  if(people.length<1){ wrap.innerHTML=""; return; }

  // map per person: day|slot -> meeting
  const maps = people.map(p=>{
    const idx={}; meetingsFor(p.roll).forEach(m=>{ idx[m.day+"|"+m.slot]=m; }); return idx;
  });

  const key = people.map(p=>
    `<span class="pk" style="--c:${personColor(p.roll)}"><span class="pdot"></span>${esc(p.name.split(" ")[0])}${p.you?" (you)":""}</span>`
  ).join("");

  // overlay cancelled / rescheduled / added classes onto THIS week
  const ov = overlayFromChanges(currentWeekMon(), compareChanges);
  const first = nm => esc(nm.split(" ")[0]);

  let head = "<tr><th class='daycol'>Day</th>"+
    D.slots.map((slot,i)=>`<th><span class='slotnum'>Slot ${i+1}</span>${slot}</th>`).join("")+"</tr>";
  let rows="";
  D.days.forEach((day,di)=>{
    rows+=`<tr><td class='daycol'>${day}</td>`;
    D.slots.forEach((slot,si)=>{
      const entries=[];
      people.forEach((p,pi)=>{
        const m=maps[pi][day+"|"+si]; if(!m) return;
        const ck=m.course+"|"+(m.section||"");
        const canc=ov.cancelled.has(di+"|"+si+"|"+ck);
        entries.push(`<div class='who ${canc?'who-cancel':''}' style='--c:${personColor(p.roll)}'><span>${first(p.name)}${p.you?" (you)":""} · ${esc(clsLabel(m.course,m.section))}${canc?" ✕":""}</span><span class='rm2'>${canc?"Cancelled":esc(m.details)}</span></div>`);
      });
      // extra/rescheduled-in classes for this slot, shown per person enrolled in that section
      (ov.adds[di+"|"+si]||[]).forEach(a=>{
        const [c,sec]=a.ck.split("|");
        people.forEach(p=>{ if(personHasCkey(p.roll,a.ck))
          entries.push(`<div class='who who-extra' style='--c:${personColor(p.roll)}'><span>${first(p.name)}${p.you?" (you)":""} · ${esc(clsLabel(c,sec))} (Extra)</span><span class='rm2'>${esc(a.room||a.note||"added")}</span></div>`);
        });
      });
      rows += entries.length ? "<td class='cell'>"+entries.join("")+"</td>"
                             : "<td class='cell free'><div class='allfree'>✓ all free</div></td>";
    });
    rows+="</tr>";
  });

  wrap.innerHTML = `<div class="people-key">${key}</div>
    <p class="section-h">Weekly overlap (this week) — green “all free” slots are good to meet</p>
    <div class="gridwrap"><table class="tt"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

// ===========================================================================
//  ATTENDANCE TAB  (Firebase login + sync, with local fallback)
// ===========================================================================
const TERM_START = new Date(2026,5,15);   // 15 Jun 2026 (month is 0-based)
const TERM_END   = new Date(2026,8,6);    // 6 Sep 2026
const DAY_INDEX  = { Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5 };
const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const prettyDate = d => d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});

function sessionDates(dayName){
  const wd=DAY_INDEX[dayName]; const out=[]; const d=new Date(TERM_START);
  while(d.getDay()!==wd) d.setDate(d.getDate()+1);
  while(d<=TERM_END){ out.push(new Date(d)); d.setDate(d.getDate()+7); }
  return out;
}

const ALLOWED_EMAIL_DOMAIN = "@mdi.ac.in";   // only institute emails may sign up / in

const ATT = {
  cloud:false, user:null, meRoll:null, data:{}, role:null,
  db:null, userRef:null, fb:null, pendingRoll:null,
};

function attKey(course,section,date,slot){ return `${course}|${section||""}|${date}|${slot}`; }

// reject if a cloud call doesn't resolve quickly (usually: Firestore DB not created)
function withTimeout(promise, ms=9000){
  return Promise.race([promise, new Promise((_,rej)=>
    setTimeout(()=>rej(new Error("Timed out reaching Cloud Firestore. Have you created the database & published rules? (README step 4)")), ms))]);
}

async function saveAttendance(){
  try{
    if(ATT.cloud && ATT.userRef){
      await withTimeout(ATT.fb.setDoc(ATT.userRef, { roll:ATT.meRoll, attendance:ATT.data }, { merge:true }));
    } else {
      localStorage.setItem("tt_att_"+(ATT.meRoll||"local"), JSON.stringify(ATT.data));
    }
  }catch(e){ ATT.cloudError=e.message; console.error("[firestore] save failed:", e.code, e.message); }
}
function loadLocalAttendance(){
  ATT.data = JSON.parse(localStorage.getItem("tt_att_"+(ATT.meRoll||"local"))||"{}");
  markSnapshot();
}

// ---- pending attendance changes: save/discard with confirm-on-leave ----
let attDirty=false, attSaved="{}";
function markSnapshot(){ attSaved=JSON.stringify(ATT.data||{}); attDirty=false; updateSaveBar(); }
function setAttDirty(){ attDirty=true; updateSaveBar(); }
function updateSaveBar(){ const b=$("saveBar"); if(b) b.classList.toggle("hidden", !attDirty); }
async function commitAttendance(){ await saveAttendance(); markSnapshot(); }
function discardAttendance(){ ATT.data = JSON.parse(attSaved||"{}"); attDirty=false; updateSaveBar(); rerenderMarkingSurfaces(); }
function rerenderMarkingSurfaces(){
  if(currentRoll) refreshTimetable();
  const at=$("tab-attendance"); if(at && !at.classList.contains("hidden")) renderAttendance();
}
// if there are unsaved marks, ask to save before leaving a marking page
function confirmLeaveIfDirty(){
  if(!attDirty) return;
  if(window.confirm("You have unsaved attendance changes. Save them?")) commitAttendance();
  else discardAttendance();
}

// ---- Firebase init (graceful) ----
async function initFirebase(){
  if(!FIREBASE_CONFIG.apiKey){ ATT.cloud=false; return; }
  try{
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);
    ATT.auth = auth.getAuth(app);
    ATT.db = fs.getFirestore(app);
    ATT.fb = { ...auth, ...fs };
    ATT.cloud = true;
    renderAcct();
    auth.onAuthStateChanged(ATT.auth, async u => {
      console.log("[auth] state changed:", u ? u.email||u.uid : "signed out");
      // hard guard: only @mdi.ac.in accounts are allowed in
      if(u && !(u.email||"").toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)){
        await auth.signOut(ATT.auth);
        ATT.user=null; ATT.userRef=null; ATT.authNotice=`Only ${ALLOWED_EMAIL_DOMAIN} accounts are allowed.`;
        renderAttendance(); return;
      }
      ATT.user = u; ATT.meRoll=null; ATT.data={}; ATT.role=null;
      if(u){
        ATT.userRef = fs.doc(ATT.db, "users", u.uid);
        try{
          const snap = await withTimeout(fs.getDoc(ATT.userRef));
          if(snap.exists()){ const d=snap.data(); ATT.meRoll=d.roll||null; ATT.data=d.attendance||{}; ATT.role=d.role||null; lastSeenChanges=d.lastSeenChanges||0; }
          // bind the roll chosen at signup, if the doc didn't have one yet
          if(!ATT.meRoll && ATT.pendingRoll){
            ATT.meRoll = ATT.pendingRoll;
            await withTimeout(fs.setDoc(ATT.userRef, { roll:ATT.meRoll }, { merge:true }));
          }
          ATT.pendingRoll=null;
          // keep the user's enrolled (course|section) list in their doc — needed by the
          // security rules so only section members can post class updates
          if(ATT.meRoll){ try{ await withTimeout(fs.setDoc(ATT.userRef,{enrolled:ckeysFor(ATT.meRoll)},{merge:true})); }catch(e){} }
        }catch(e){ ATT.cloudError = e.message; console.error("[firestore] read failed:", e.code||"", e.message); }
      } else { ATT.userRef=null; }
      markSnapshot();
      if(ATT.user) closeAuthModal();
      renderAcct();
      renderAttendance();
      fetchCloudSquads().then(renderSquads);
      // reflect login on the timetable grid (marking controls / own schedule)
      if(u && ATT.meRoll && !currentRoll) selectStudent(ATT.meRoll);
      else refreshTimetable();
      // class updates: load, refresh tab + timetable overlay, and pop unseen ones
      fetchChanges().then(()=>{ renderUpdates(); if(currentRoll) refreshTimetable(); maybeShowChangesPopup(); });
    });
  }catch(err){ console.error("Firebase init failed:",err); ATT.cloud=false; renderAttendance(); }
}

// ---- attendance UI ----
function renderAttendance(){
  const banner=$("att-banner"), authEl=$("att-auth"), body=$("att-body");
  banner.innerHTML=""; authEl.innerHTML=""; body.innerHTML="";

  // Local-only mode (no Firebase configured)
  if(!ATT.cloud){
    banner.innerHTML = `<div class="banner">⚠️ Cloud sync isn’t set up yet, so attendance is saved <b>only on this device</b>. To enable login &amp; cross-device sync, add your keys in <code>firebase-config.js</code> (see README).</div>`;
    if(!ATT.meRoll){ ATT.meRoll = currentRoll || localStorage.getItem("tt_lastRoll"); if(ATT.meRoll) loadLocalAttendance(); }
    renderMePicker(authEl, false);
    if(ATT.meRoll) renderAttendanceBody(body);
    return;
  }

  // Cloud mode — need login (sign-in happens in a popup)
  if(!ATT.user){
    authEl.innerHTML=`<div class="panel auth-box">
      <p class="section-h" style="margin:0">Track your attendance</p>
      <p class="hint" style="margin:0">Sign in with your <b>${esc(ALLOWED_EMAIL_DOMAIN)}</b> account to mark and sync attendance across devices.</p>
      <button class="btn btn-primary" id="attSignin">Sign in / Create account</button></div>`;
    $("attSignin").onclick=openAuthModal;
    return;
  }
  if(ATT.cloudError){
    banner.innerHTML = `<div class="banner">⚠️ Signed in, but couldn't reach the database: ${esc(ATT.cloudError)}</div>`;
  }
  // admin office: all-students dashboard
  if(ATT.role === "admin"){ renderAdmin(authEl, body); return; }
  renderMePicker(authEl, true);
  if(ATT.meRoll) renderAttendanceBody(body);
  else body.innerHTML = `<p class="hint">Pick your name above to start tracking attendance.</p>`;
}

let authMode = "signin";        // or "signup"
let signupRoll = null;          // roll chosen during create-account

function openAuthModal(){ renderAuth($("modalAuth")); $("authModal").classList.remove("hidden"); }
function closeAuthModal(){ $("authModal").classList.add("hidden"); $("modalAuth").innerHTML=""; }

// header account chip + sign in/out, visible on every tab
function renderAcct(){
  const el=$("acct"); if(!el) return;
  if(!ATT.cloud){ el.innerHTML=""; return; }
  if(ATT.user){
    const nm = ATT.role==="admin" ? "Admin"
      : (ATT.meRoll && D.students[ATT.meRoll]) ? D.students[ATT.meRoll].name.split(" ")[0]
      : (ATT.user.email||"Account").split("@")[0];
    const ini=(nm[0]||"?").toUpperCase();
    el.innerHTML=`<span class="who2"><span class="ai">${esc(ini)}</span>${esc(nm)}</span><button class="signout" id="hdrSignout">Sign out</button>`;
    $("hdrSignout").onclick=()=>ATT.fb.signOut(ATT.auth);
  } else {
    el.innerHTML=`<button class="signin" id="hdrSignin">Sign in</button>`;
    $("hdrSignin").onclick=openAuthModal;
  }
}

function renderAuth(el){
  const notice = ATT.authNotice ? `<div class="banner">${esc(ATT.authNotice)}</div>` : "";
  ATT.authNotice = null;
  el.innerHTML = `<div class="panel auth-box">
    <p class="section-h" style="margin:0">Track your attendance</p>
    ${notice}
    <div class="toggle" id="authMode" style="margin:0">
      <button data-m="signin" class="${authMode==="signin"?"on":""}" style="flex:1">Sign in</button>
      <button data-m="signup" class="${authMode==="signup"?"on":""}" style="flex:1">Create account</button>
    </div>
    <input id="email" type="email" placeholder="you${ALLOWED_EMAIL_DOMAIN}" autocomplete="email">
    <input id="pwd" type="password" placeholder="Password (min 6 chars)" autocomplete="${authMode==="signup"?"new-password":"current-password"}">
    <div id="rollWrap" class="${authMode==="signup"?"":"hidden"}">
      <label class="fld" style="margin:4px 0 8px">Your roll number — so we load your courses</label>
      <div class="search-box"><input id="qSignup" type="text" autocomplete="off" placeholder="e.g. 25P001 or your name"><div id="resultsSignup" class="results"></div></div>
      <div class="hint" id="rollChosen">${signupRoll?("Selected: <b>"+esc(D.students[signupRoll].name)+"</b> ("+esc(signupRoll)+")"):""}</div>
    </div>
    <button class="btn btn-primary" id="authSubmit">${authMode==="signup"?"Create account":"Sign in"}</button>
    <p class="hint" style="margin:2px 0 0">Only <b>${esc(ALLOWED_EMAIL_DOMAIN)}</b> email addresses are allowed.</p>
    <div class="err" id="authErr"></div>
  </div>`;

  const fb=ATT.fb, auth=ATT.auth, err=$("authErr");
  const fail = (label,e) => {
    console.error("[auth]",label,e.code,e.message);
    if(e.code === "auth/unauthorized-domain"){
      err.innerHTML = `This page's domain isn't allowed by Firebase yet.<br>
        Add <b>${esc(location.hostname)}</b> in Firebase Console → Authentication → Settings → <b>Authorized domains</b>, then reload.`;
    } else if(e.code === "auth/email-already-in-use"){
      err.textContent = "That email already has an account — switch to “Sign in”.";
    } else {
      err.textContent = e.code ? `${e.code} — ${e.message}` : e.message;
    }
  };

  el.querySelectorAll("#authMode button").forEach(b => b.onclick = () => {
    authMode = b.dataset.m; renderAuth(el);
  });

  if(authMode==="signup"){
    makeSearch($("qSignup"), $("resultsSignup"), roll => {
      signupRoll = roll;
      $("rollChosen").innerHTML = `Selected: <b>${esc(D.students[roll].name)}</b> (${esc(roll)})`;
      $("qSignup").value = D.students[roll].name;
    });
  }

  $("authSubmit").onclick = async () => {
    const email = $("email").value.trim(), pwd = $("pwd").value;
    if(!email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)){ err.textContent = `Please use your ${ALLOWED_EMAIL_DOMAIN} email address.`; return; }
    if(pwd.length < 6){ err.textContent = "Password must be at least 6 characters."; return; }
    err.textContent = "…";
    if(authMode==="signup"){
      if(!signupRoll){ err.textContent = "Pick your roll number above first."; return; }
      ATT.pendingRoll = signupRoll;
      try{ await fb.createUserWithEmailAndPassword(auth, email, pwd); }
      catch(e){ ATT.pendingRoll=null; fail("signup",e); }
    } else {
      try{ await fb.signInWithEmailAndPassword(auth, email, pwd); }
      catch(e){ fail("signin",e); }
    }
  };
}

function renderMePicker(el, cloud){
  const me = ATT.meRoll ? D.students[ATT.meRoll] : null;
  const wrap=document.createElement("div"); wrap.className="panel";
  wrap.innerHTML = me
    ? `<div class="row" style="align-items:center"><div class="avatar">${esc((me.name[0]||"?").toUpperCase())}</div>
         <div><div class="student-name" style="font-size:1.05rem">${esc(me.name)}</div><div class="student-meta">Roll ${ATT.meRoll}${cloud?" · "+esc(ATT.user.email||ATT.user.displayName||"signed in"):""}</div></div>
         <div class="row" style="margin-left:auto">
           ${cloud?'<button class="btn btn-ghost" id="signOutBtn">Sign out</button>':'<button class="btn btn-ghost" id="changeMe">Change</button>'}
         </div></div>`
    : `<label class="fld">Which student are you?</label>
       <div class="search-box"><input id="qMe" type="text" autocomplete="off" placeholder="Type your name…"><div id="resultsMe" class="results"></div></div>
       ${cloud?'<div class="row" style="margin-top:10px"><button class="btn btn-ghost" id="signOutBtn">Sign out</button></div>':''}`;
  el.appendChild(wrap);

  if(me){
    if($("changeMe")) $("changeMe").onclick = () => { ATT.meRoll=null; localStorage.removeItem("tt_me"); renderAttendance(); };
  } else {
    makeSearch($("qMe"), $("resultsMe"), async roll => {
      try{
        if(cloud){ if(ATT.userRef) await ATT.fb.setDoc(ATT.userRef,{roll},{merge:true}); }
        else { localStorage.setItem("tt_me", roll); loadLocalAttendance(); }
        ATT.meRoll = roll;
        renderAttendance();
      }catch(e){
        console.error("[firestore] write failed:", e.code, e.message);
        el.insertAdjacentHTML("beforeend", `<div class="err" style="margin-top:10px">Couldn't save to the cloud: <b>${esc(e.code||"")}</b> — ${esc(e.message)}<br>Make sure you created the Firestore database and published the rules (see README step 4).</div>`);
      }
    });
  }
  if(cloud && $("signOutBtn")) $("signOutBtn").onclick = () => ATT.fb.signOut(ATT.auth);
}

function updateCourseSummary(card){
  let p=0,a=0;
  card.querySelectorAll(".marks").forEach(m=>{
    const v=ATT.data[m.dataset.key]; if(v==="p")p++; else if(v==="a")a++;
  });
  const total=p+a, pct=total?Math.round(p/total*100):0;
  const col = total ? (pct>=75?"var(--good)":pct>=60?"var(--warn)":"var(--bad)") : "var(--muted)";
  const pctEl=card.querySelector(".att-pct");
  pctEl.style.color=col;
  pctEl.innerHTML=`${total?pct+"%":"—"}<small>${p} present · ${a} absent</small>`;
  const bar=card.querySelector(".bar > i");
  bar.style.width=pct+"%"; bar.style.background=col;
}

function renderAttendanceBody(body){
  const s = D.students[ATT.meRoll]; if(!s){ body.innerHTML=""; return; }
  // group sessions by course
  const seen=new Set(); const courses=s.courses.filter(c=>!seen.has(c.course)&&seen.add(c.course));
  let html = `<div class="row" style="justify-content:space-between;margin-top:22px;align-items:center">
      <p class="section-h" style="margin:0">Attendance — present ÷ (present + absent), excl. cancelled</p>
      <button class="btn btn-ghost btn-sm" id="dlPdf">⬇︎ Download PDF</button></div>`;
  courses.forEach(c=>{
    const cm=D.courses[c.course]||{}, col=colorFor(c.course);
    const enroll=s.courses.filter(x=>x.course===c.course);
    // collect all dated sessions for this course across its sections the student is in
    let sessions=[];
    enroll.forEach(en=>{
      const secs=D.meetings[c.course]||{}; let key=en.section||"";
      if(!(key in secs)){ const ks=Object.keys(secs); key=ks.includes("")?"":(ks.length===1?ks[0]:key); }
      (secs[key]||[]).forEach(m=>{
        sessionDates(m.day).forEach(dt=> sessions.push({date:dt, ds:fmtDate(dt), slot:m.slot, day:m.day, details:m.details, section:en.section}));
      });
    });
    sessions.sort((a,b)=> a.date-b.date || a.slot-b.slot);
    let p=0,a=0;
    sessions.forEach(se=>{ const st=ATT.data[attKey(c.course,se.section,se.ds,se.slot)]; if(st==="p")p++; else if(st==="a")a++; });
    const total=p+a, pct = total? Math.round(p/total*100) : 0;
    const pctColor = total? (pct>=75?"var(--good)":pct>=60?"var(--warn)":"var(--bad)") : "var(--muted)";
    html += `<div class="att-course" data-course="${c.course}">
      <div class="att-head"><span class="swatch" style="--c:${col};background:${col}"></span>
        <div><div class="ab">${esc(c.course)}</div><div class="nm">${esc(cm.name)}</div></div>
        <div class="att-pct" style="color:${pctColor}">${total?pct+"%":"—"}<small>${p} present · ${a} absent</small></div>
      </div>
      <div class="bar"><i style="width:${pct}%;background:${pctColor}"></i></div>
      <div class="att-sessions">${sessions.map(se=>{
        const k=attKey(c.course,se.section,se.ds,se.slot); const st=ATT.data[k]||"";
        return `<div class="sess"><span class="dt">${prettyDate(se.date)}</span><span class="sp">${esc(se.details||se.day)}</span>
          <span class="marks" data-key="${k}">
            <button class="mk p ${st==="p"?"on":""}" data-v="p">Present</button>
            <button class="mk a ${st==="a"?"on":""}" data-v="a">Absent</button>
            <button class="mk c ${st==="c"?"on":""}" data-v="c">Cancel</button>
          </span></div>`;
      }).join("")}</div></div>`;
  });
  body.innerHTML = html;
  if($("dlPdf")) $("dlPdf").onclick = () => downloadStudentPDF(ATT.meRoll);

  body.querySelectorAll(".att-head").forEach(h=> h.onclick = () =>
    h.parentElement.querySelector(".att-sessions").classList.toggle("open"));
  body.querySelectorAll(".marks .mk").forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const marks=btn.parentElement, key=marks.dataset.key, v=btn.dataset.v;
    ATT.data[key] = (ATT.data[key]===v) ? undefined : v;
    if(ATT.data[key]===undefined) delete ATT.data[key];
    // update only the affected buttons + this course's summary (keeps list open)
    marks.querySelectorAll(".mk").forEach(b=> b.classList.toggle("on", b.dataset.v===ATT.data[key]));
    updateCourseSummary(marks.closest(".att-course"));
    setAttDirty();   // held until the user confirms save (on leave or via Save bar)
  });
}

// ===========================================================================
//  STATS + EXPORTS (PDF / CSV)
// ===========================================================================
const PCT_COLORS = pct => pct==null ? [148,156,176] : pct>=75 ? [22,163,74] : pct>=60 ? [217,119,6] : [225,29,72];

// derive present/absent/cancelled totals + per-course breakdown from an attendance map
function statsFromAttendance(att){
  const by={}; let P=0,A=0,C=0;
  for(const [k,v] of Object.entries(att||{})){
    const course=k.split("|")[0];
    (by[course] ??= {p:0,a:0,c:0});
    if(v==="p"){by[course].p++;P++;}
    else if(v==="a"){by[course].a++;A++;}
    else if(v==="c"){by[course].c++;C++;}
  }
  for(const c in by){ const t=by[c].p+by[c].a; by[c].pct = t? Math.round(by[c].p/t*100) : null; }
  const T=P+A;
  return {P,A,C, pct: T? Math.round(P/T*100):null, byCourse:by};
}

function newPDF(orientation){
  const J = window.jspdf && window.jspdf.jsPDF;
  if(!J){ alert("PDF library still loading — try again in a second."); return null; }
  return new J({ unit:"pt", format:"a4", orientation: orientation || "portrait" });
}

function downloadTimetablePDF(roll){
  const s=D.students[roll]; if(!s) return;
  const doc=newPDF("landscape"); if(!doc) return;
  doc.setFont("helvetica","bold"); doc.setFontSize(16);
  doc.text("Weekly Timetable — Term IV", 40, 42);
  doc.setFontSize(11); doc.setFont("helvetica","normal");
  doc.text(`${s.name}  (${roll})`, 40, 60);
  doc.setTextColor(120); doc.setFontSize(9);
  doc.text(`MDI Gurgaon · PGDM 2025-27 · Jun 15 – Sep 6, 2026`, 40, 74);
  doc.setTextColor(0);

  const idx={};
  meetingsFor(roll).forEach(m=>{
    (idx[m.day+"|"+m.slot] ??= []).push(`${clsLabel(m.course,m.section)}${m.details?"  "+m.details:""}`);
  });
  const head=[["Day", ...D.slots.map((sl,i)=>`Slot ${i+1}\n${sl}`)]];
  const body=D.days.map(day=>[day, ...D.slots.map((sl,i)=>(idx[day+"|"+i]||[]).join("\n"))]);
  doc.autoTable({
    startY:90, head, body,
    styles:{font:"helvetica",fontSize:8,cellPadding:5,valign:"middle",minCellHeight:34,lineColor:[225,229,238],lineWidth:.5},
    headStyles:{fillColor:[37,99,235],textColor:255,halign:"center",fontSize:8},
    columnStyles:{0:{fontStyle:"bold",fillColor:[241,244,248],cellWidth:64,valign:"middle"}},
    didParseCell:d=>{ if(d.section==="body"&&d.column.index>0&&!d.cell.raw){ d.cell.styles.fillColor=[250,251,253]; } }
  });
  doc.save(`timetable_${roll}.pdf`);
}

function downloadStudentPDF(roll){
  const s=D.students[roll]; if(!s) return;
  const doc=newPDF(); if(!doc) return;
  const st=statsFromAttendance(ATT.data);
  doc.setFont("helvetica","bold"); doc.setFontSize(16);
  doc.text("Attendance Report — Term IV", 40, 48);
  doc.setFontSize(11); doc.setFont("helvetica","normal");
  doc.text(`${s.name}  (${roll})`, 40, 68);
  doc.setTextColor(120); doc.text(`MDI Gurgaon · PGDM 2025-27 · generated ${new Date().toLocaleDateString("en-GB")}`, 40, 84);
  doc.setTextColor(0);
  const seen=new Set(); const courses=s.courses.filter(c=>!seen.has(c.course)&&seen.add(c.course));
  const rows=courses.map(c=>{
    const b=st.byCourse[c.course]||{p:0,a:0,c:0,pct:null};
    return [c.course, (D.courses[c.course]||{}).name||"", String(b.p), String(b.a), String(b.c||0), b.pct==null?"—":b.pct+"%"];
  });
  doc.autoTable({
    startY:104, head:[["Course","Title","Present","Absent","Cancelled","%"]], body:rows,
    styles:{font:"helvetica",fontSize:9,cellPadding:5},
    headStyles:{fillColor:[79,110,247],textColor:255},
    columnStyles:{1:{cellWidth:200}},
    didParseCell:d=>{ if(d.section==="body"&&d.column.index===5){ const v=rows[d.row.index][5]; const p=v==="—"?null:parseInt(v); d.cell.styles.textColor=PCT_COLORS(p); d.cell.styles.fontStyle="bold"; } }
  });
  const y=doc.lastAutoTable.finalY+24;
  doc.setFont("helvetica","bold"); doc.setFontSize(12);
  doc.text(`Overall: ${st.pct==null?"—":st.pct+"%"}   (${st.P} present, ${st.A} absent)`, 40, y);
  doc.save(`attendance_${roll}.pdf`);
}

// ===========================================================================
//  ADMIN DASHBOARD (role:"admin")
// ===========================================================================
let adminRows=[], adminSort={key:"pct",dir:1}, adminBelowOnly=false;

async function renderAdmin(authEl, body){
  authEl.innerHTML = `<div class="panel"><div class="row" style="align-items:center">
      <div class="avatar">🛡️</div>
      <div><div class="student-name" style="font-size:1.05rem">Admin dashboard</div>
           <div class="student-meta">${esc(ATT.user.email)} · all students</div></div>
      <div class="row" style="margin-left:auto"><button class="btn btn-ghost btn-sm" id="signOutBtn">Sign out</button></div>
    </div></div>`;
  $("signOutBtn").onclick = () => ATT.fb.signOut(ATT.auth);

  body.innerHTML = `<p class="hint" style="margin-top:20px">Loading all student records…</p>`;
  let docs;
  try{
    const snap = await withTimeout(ATT.fb.getDocs(ATT.fb.collection(ATT.db,"users")), 15000);
    docs = snap.docs.map(d=>d.data());
  }catch(e){
    body.innerHTML = `<div class="banner">Couldn't load records: ${esc(e.message)}<br>Make sure the admin read rule is published (see README).</div>`;
    return;
  }

  adminRows = docs.filter(d=>d.roll && (D.students[d.roll])).map(d=>{
    const st=statsFromAttendance(d.attendance);
    return { roll:d.roll, name:(D.students[d.roll]||{}).name||d.roll, ...st, marked:st.P+st.A+st.C };
  });

  renderAdminBody(body);
}

function renderAdminBody(body){
  const tracking = adminRows.filter(r=>r.marked>0);
  const withPct = tracking.filter(r=>r.pct!=null);
  const avg = withPct.length ? Math.round(withPct.reduce((a,r)=>a+r.pct,0)/withPct.length) : 0;
  const below = withPct.filter(r=>r.pct<75).length;

  let rows=[...adminRows];
  if(adminBelowOnly) rows=rows.filter(r=>r.pct!=null && r.pct<75);
  const term=(($("admSearch")||{}).value||"").trim().toLowerCase();
  if(term) rows=rows.filter(r=>r.name.toLowerCase().includes(term)||r.roll.toLowerCase().includes(term));
  const {key,dir}=adminSort;
  rows.sort((a,b)=>{
    let va=a[key], vb=b[key];
    if(key==="name"||key==="roll"){ return dir*String(va).localeCompare(String(vb)); }
    va=va==null?-1:va; vb=vb==null?-1:vb; return dir*(va-vb);
  });

  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="v">${adminRows.length}</div><div class="l">Accounts with a roll</div></div>
      <div class="stat"><div class="v">${tracking.length}</div><div class="l">Started tracking</div></div>
      <div class="stat"><div class="v" style="color:${pctVar(avg)}">${avg}%</div><div class="l">Avg attendance</div></div>
      <div class="stat"><div class="v" style="color:var(--bad)">${below}</div><div class="l">Below 75%</div></div>
    </div>
    <div class="adm-tools">
      <input id="admSearch" type="text" placeholder="Search name or roll…" value="${esc(term)}">
      <button class="btn btn-ghost btn-sm" id="admBelow">${adminBelowOnly?"Show all":"Only < 75%"}</button>
      <button class="btn btn-ghost btn-sm" id="admCsv">⬇︎ CSV</button>
      <button class="btn btn-ghost btn-sm" id="admPdf">⬇︎ PDF</button>
    </div>
    <div class="gridwrap" style="padding:4px 14px 8px">
      <table class="adm">
        <thead><tr>
          <th data-k="name">Name</th><th data-k="roll">Roll</th>
          <th data-k="marked">Marked</th><th data-k="P">Present</th>
          <th data-k="A">Absent</th><th data-k="pct">Attendance %</th>
        </tr></thead>
        <tbody>${rows.map(r=>{
          const col=`rgb(${PCT_COLORS(r.pct).join(",")})`;
          return `<tr data-roll="${r.roll}">
            <td>${esc(r.name)}</td><td>${esc(r.roll)}</td>
            <td>${r.marked}</td><td>${r.P}</td><td>${r.A}</td>
            <td><span class="pctbadge" style="background:${col}22;color:${col}">${r.pct==null?"—":r.pct+"%"}</span></td>
          </tr>`;
        }).join("")||`<tr><td colspan="6" style="color:var(--muted);padding:18px">No matching students.</td></tr>`}</tbody>
      </table>
    </div>`;

  // wire controls
  $("admSearch").oninput = () => { const v=$("admSearch").value; renderAdminBody(body); const el=$("admSearch"); el.focus(); el.value=v; el.setSelectionRange(v.length,v.length); };
  $("admBelow").onclick = () => { adminBelowOnly=!adminBelowOnly; renderAdminBody(body); };
  $("admCsv").onclick = exportAdminCSV;
  $("admPdf").onclick = exportAdminPDF;
  body.querySelectorAll("th[data-k]").forEach(th=> th.onclick = () => {
    const k=th.dataset.k; adminSort = {key:k, dir: adminSort.key===k ? -adminSort.dir : (k==="pct"?1:1)}; renderAdminBody(body);
  });
  body.querySelectorAll("tbody tr[data-roll]").forEach(tr=> tr.onclick = () => toggleAdminDetail(tr));
}
function pctVar(p){ return `rgb(${PCT_COLORS(p).join(",")})`; }

function toggleAdminDetail(tr){
  const next=tr.nextElementSibling;
  if(next && next.classList.contains("adm-detail")){ next.remove(); return; }
  const r=adminRows.find(x=>x.roll===tr.dataset.roll); if(!r) return;
  const det=document.createElement("tr"); det.className="adm-detail";
  const cells=Object.entries(r.byCourse).map(([c,b])=>{
    const col=`rgb(${PCT_COLORS(b.pct).join(",")})`;
    return `<span class="cc"><b>${esc(c)}</b> <span style="color:${col}">${b.pct==null?"—":b.pct+"%"}</span> <span style="color:var(--muted)">(${b.p}/${b.p+b.a})</span></span>`;
  }).join("") || "no classes marked yet";
  det.innerHTML = `<td colspan="6">${cells}</td>`;
  tr.after(det);
}

function exportAdminCSV(){
  const head=["Roll","Name","Marked","Present","Absent","Cancelled","Overall%"];
  const lines=[head.join(",")];
  adminRows.forEach(r=> lines.push([r.roll,`"${r.name}"`,r.marked,r.P,r.A,r.C,r.pct==null?"":r.pct].join(",")));
  const blob=new Blob([lines.join("\n")],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`attendance_all_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

function exportAdminPDF(){
  const doc=newPDF(); if(!doc) return;
  doc.setFont("helvetica","bold"); doc.setFontSize(16);
  doc.text("Attendance Roster — Term IV", 40, 48);
  doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.setTextColor(120);
  doc.text(`MDI Gurgaon · PGDM 2025-27 · generated ${new Date().toLocaleString("en-GB")}`, 40, 66);
  doc.setTextColor(0);
  const rows=[...adminRows].sort((a,b)=>(a.pct??-1)-(b.pct??-1))
    .map(r=>[r.roll, r.name, String(r.P), String(r.A), r.pct==null?"—":r.pct+"%", (r.pct!=null&&r.pct<75)?"LOW":""]);
  doc.autoTable({
    startY:84, head:[["Roll","Name","Present","Absent","%","Flag"]], body:rows,
    styles:{font:"helvetica",fontSize:8,cellPadding:3},
    headStyles:{fillColor:[79,110,247],textColor:255},
    didParseCell:d=>{ if(d.section==="body"&&d.column.index===4){ const v=rows[d.row.index][4]; const p=v==="—"?null:parseInt(v); d.cell.styles.textColor=PCT_COLORS(p); d.cell.styles.fontStyle="bold"; }
      if(d.section==="body"&&d.column.index===5&&d.cell.raw==="LOW"){ d.cell.styles.textColor=[225,29,72]; d.cell.styles.fontStyle="bold"; } }
  });
  doc.save(`attendance_roster_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ===========================================================================
//  CLASS UPDATES (section-wide cancellations / additions / reschedules)
// ===========================================================================
let changes=[], changesErr=null, lastSeenChanges=0, updType="cancel";

function ckeysFor(roll){
  const s=D.students[roll]; if(!s) return [];
  return [...new Set(s.courses.map(c=>c.course+"|"+(c.section||"")))];
}
const ckeyLabel = k => { const [c,s]=k.split("|"); return c+(s?` (${s})`:""); };
function diForDateInWeek(ds){
  if(!markWeeks.length) return -1;
  const mon=markWeeks[markWeekIdx];
  for(let i=0;i<5;i++){ const d=new Date(mon); d.setDate(d.getDate()+i); if(fmtDate(d)===ds) return i; }
  return -1;
}
const chMs = c => (c && c.createdAt && c.createdAt.seconds) ? c.createdAt.seconds*1000 : 0;

async function fetchChanges(){
  changesErr=null; changes=[];
  if(!(ATT.cloud && ATT.user && ATT.meRoll)){ updateUpdCount(); return; }
  const ck=ckeysFor(ATT.meRoll); if(!ck.length){ updateUpdCount(); return; }
  try{
    const {collection,query,where,getDocs}=ATT.fb;
    const snap=await withTimeout(getDocs(query(collection(ATT.db,"changes"), where("ckey","in",ck.slice(0,30)))),12000);
    changes=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>chMs(b)-chMs(a));
  }catch(e){ changesErr=e.message; console.error("[changes] fetch",e.code||"",e.message); }
  updateUpdCount();
}
function unseenChanges(){ return changes.filter(c=>chMs(c)>lastSeenChanges && c.byUid!==(ATT.user&&ATT.user.uid)); }
function updateUpdCount(){
  const el=$("updCount"); if(!el) return;
  const n=unseenChanges().length;
  el.textContent=n; el.classList.toggle("hidden", n===0);
}

async function createChange(obj){
  const {addDoc,collection,serverTimestamp}=ATT.fb;
  await withTimeout(addDoc(collection(ATT.db,"changes"), {
    ...obj, byUid:ATT.user.uid, byRoll:ATT.meRoll, byName:(D.students[ATT.meRoll]||{}).name||ATT.meRoll, createdAt:serverTimestamp()
  }));
  await fetchChanges(); renderUpdates(); if(currentRoll) refreshTimetable();
}
async function deleteChange(id){
  try{ const {doc,deleteDoc}=ATT.fb; await withTimeout(deleteDoc(doc(ATT.db,"changes",id))); await fetchChanges(); renderUpdates(); if(currentRoll) refreshTimetable(); }
  catch(e){ console.error("[changes] delete",e.code,e.message); alert("Couldn't delete: "+e.message); }
}

// overlay for the currently selected week (used by the timetable grid/agenda)
// Monday of the real current week
function currentWeekMon(){ const d=new Date(); const day=d.getDay(); d.setDate(d.getDate()+(day===0?-6:1-day)); d.setHours(0,0,0,0); return d; }
// build cancel/add overlay from a change list for a given week start
function overlayFromChanges(weekMon, list){
  const cancelled=new Set(), adds={};
  const di=ds=>{ for(let i=0;i<5;i++){ const x=new Date(weekMon); x.setDate(x.getDate()+i); if(fmtDate(x)===ds) return i; } return -1; };
  (list||[]).forEach(ch=>{
    const ck=ch.ckey;
    const canc=(ds,slot)=>{ const d=di(ds); if(d>=0) cancelled.add(d+"|"+slot+"|"+ck); };
    const add =(ds,slot,room,note)=>{ const d=di(ds); if(d>=0)(adds[d+"|"+slot] ??= []).push({ck,room,note,by:ch.byName}); };
    if(ch.type==="cancel") canc(ch.date,ch.slot);
    else if(ch.type==="add") add(ch.date,ch.slot,ch.room,ch.note);
    else if(ch.type==="move"){ canc(ch.fromDate,ch.fromSlot); add(ch.toDate,ch.toSlot,ch.room,ch.note); }
  });
  return {cancelled,adds};
}
function computeWeekOverlay(){
  if(!markEnabled) return {cancelled:new Set(),adds:{}};
  return overlayFromChanges(markWeeks[markWeekIdx], changes);
}

// changes for everyone shown in the compare (you + friends), for current-week overlay
let compareChanges=[];
async function fetchCompareChanges(){
  compareChanges=[];
  if(!(ATT.cloud && ATT.user)) return;
  const people=[currentRoll,...friends.map(f=>f.roll)].filter(Boolean);
  const ck=[...new Set(people.flatMap(r=>ckeysFor(r)))].slice(0,30);
  if(!ck.length) return;
  try{ const {collection,query,where,getDocs}=ATT.fb;
    const snap=await withTimeout(getDocs(query(collection(ATT.db,"changes"), where("ckey","in",ck))),12000);
    compareChanges=snap.docs.map(d=>d.data());
  }catch(e){ console.error("[compareChanges]",e.code||"",e.message); }
}
const personHasCkey=(roll,ck)=>ckeysFor(roll).includes(ck);

function chgSummary(ch){
  const lbl=ckeyLabel(ch.ckey);
  const dt=ds=>{ const [y,m,d]=ds.split("-"); return new Date(+y,+m-1,+d).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"}); };
  const sl=i=>"slot "+(i+1);
  if(ch.type==="cancel") return {title:`${lbl} cancelled`, sub:`${dt(ch.date)} · ${sl(ch.slot)}${ch.note?" · "+ch.note:""}`};
  if(ch.type==="add")    return {title:`${lbl} extra class`, sub:`${dt(ch.date)} · ${sl(ch.slot)}${ch.room?" · "+ch.room:""}${ch.note?" · "+ch.note:""}`};
  return {title:`${lbl} rescheduled`, sub:`${dt(ch.fromDate)} ${sl(ch.fromSlot)} → ${dt(ch.toDate)} ${sl(ch.toSlot)}${ch.room?" · "+ch.room:""}${ch.note?" · "+ch.note:""}`};
}

function renderUpdates(){
  const body=$("upd-body"); if(!body) return;
  if(!ATT.cloud){ body.innerHTML=`<div class="banner">Cloud sync isn't set up, so class updates are unavailable. (See README.)</div>`; return; }
  if(!ATT.user){
    body.innerHTML=`<div class="panel auth-box"><p class="section-h" style="margin:0">Class updates</p><p class="hint" style="margin:0">Sign in to see and report cancelled / rescheduled / extra classes for your sections.</p><button class="btn btn-primary" id="updSignin">Sign in</button></div>`;
    $("updSignin").onclick=openAuthModal; return;
  }
  const ck=ckeysFor(ATT.meRoll);
  const opts=ck.map(k=>`<option value="${k}">${esc(ckeyLabel(k))}</option>`).join("");
  const slotOpts=D.slots.map((s,i)=>`<option value="${i}">Slot ${i+1} · ${s}</option>`).join("");
  const t=updType;
  const f = (lbl,inner)=>`<div class="fg"><label>${lbl}</label>${inner}</div>`;
  let form;
  if(t==="cancel"){
    form = f("Course",`<select id="uCourse">${opts}</select>`)+f("Date",`<input id="uDate" type="date">`)+f("Slot",`<select id="uSlot">${slotOpts}</select>`)+f("Note (optional)",`<input id="uNote" type="text" placeholder="reason">`);
  } else if(t==="add"){
    form = f("Course",`<select id="uCourse">${opts}</select>`)+f("Date",`<input id="uDate" type="date">`)+f("Slot",`<select id="uSlot">${slotOpts}</select>`)+f("Room",`<input id="uRoom" type="text" placeholder="e.g. G-11">`)+f("Note",`<input id="uNote" type="text" placeholder="makeup class">`);
  } else {
    form = f("Course",`<select id="uCourse">${opts}</select>`)+f("From date",`<input id="uFromDate" type="date">`)+f("From slot",`<select id="uFromSlot">${slotOpts}</select>`)+f("To date",`<input id="uToDate" type="date">`)+f("To slot",`<select id="uToSlot">${slotOpts}</select>`)+f("Room",`<input id="uRoom" type="text" placeholder="optional">`)+f("Note",`<input id="uNote" type="text" placeholder="optional">`);
  }
  const feed = changes.length ? changes.map(ch=>{
    const {title,sub}=chgSummary(ch);
    const mine = ch.byUid===ATT.user.uid;
    return `<div class="chg"><span class="tag ${ch.type}">${ch.type==="move"?"moved":ch.type}</span>
      <div><div class="ct">${esc(title)}</div><div class="cs">${esc(sub)}</div><div class="cby">by ${esc(ch.byName||ch.byRoll||"someone")}</div></div>
      ${mine?`<button class="cdel" data-id="${ch.id}" title="Remove">🗑</button>`:""}</div>`;
  }).join("") : `<p class="hint">No class updates for your sections yet.</p>`;

  body.innerHTML=`
    <div class="panel">
      <p class="section-h" style="margin:0 0 12px">Report a change (only for your sections)</p>
      <div class="toggle" id="updTypeToggle" style="margin:0 0 14px">
        <button data-t="cancel" class="${t==="cancel"?"on":""}">Cancel</button>
        <button data-t="add" class="${t==="add"?"on":""}">Add class</button>
        <button data-t="move" class="${t==="move"?"on":""}">Reschedule</button>
      </div>
      <div class="selrow">${form}</div>
      <div class="row" style="margin-top:14px"><button class="btn btn-primary btn-sm" id="uSubmit">Post update</button><span class="hint" id="uMsg" style="margin:0"></span></div>
    </div>
    <p class="section-h" style="margin:22px 0 12px">Recent updates for your classes</p>
    ${changesErr?`<div class="banner">Couldn't load updates: ${esc(changesErr)} — publish the updates rules (README).</div>`:""}
    ${feed}`;

  document.querySelectorAll("#updTypeToggle button").forEach(b=>b.onclick=()=>{ updType=b.dataset.t; renderUpdates(); });
  $("uSubmit").onclick=submitUpdate;
  body.querySelectorAll(".chg .cdel").forEach(b=>b.onclick=()=>{ if(confirm("Remove this update?")) deleteChange(b.dataset.id); });

  lastSeenChanges=Math.max(lastSeenChanges, ...changes.map(chMs), 0);
  persistLastSeen(); updateUpdCount();
}

async function submitUpdate(){
  const msg=t=>{ const m=$("uMsg"); if(m) m.textContent=t; };
  const ckey=$("uCourse").value; const [course,section]=ckey.split("|");
  const base={ckey, course, section:section||null};
  let obj;
  if(updType==="cancel"){ if(!$("uDate").value) return msg("Pick a date."); obj={...base,type:"cancel",date:$("uDate").value,slot:+$("uSlot").value,note:$("uNote").value.trim()||null}; }
  else if(updType==="add"){ if(!$("uDate").value) return msg("Pick a date."); obj={...base,type:"add",date:$("uDate").value,slot:+$("uSlot").value,room:$("uRoom").value.trim()||null,note:$("uNote").value.trim()||null}; }
  else { if(!$("uFromDate").value||!$("uToDate").value) return msg("Pick both dates."); obj={...base,type:"move",fromDate:$("uFromDate").value,fromSlot:+$("uFromSlot").value,toDate:$("uToDate").value,toSlot:+$("uToSlot").value,room:$("uRoom").value.trim()||null,note:$("uNote").value.trim()||null}; }
  try{ msg("Posting…"); await createChange(obj); msg("Posted ✓"); }
  catch(e){ console.error("[changes] create",e.code,e.message); msg("Failed: "+e.message+" (publish updates rules — see README)."); }
}

function maybeShowChangesPopup(){
  const un=unseenChanges();
  if(!un.length) return;
  const list=un.slice(0,8).map(ch=>{ const {title,sub}=chgSummary(ch); return `<div class="chg"><span class="tag ${ch.type}">${ch.type==="move"?"moved":ch.type}</span><div><div class="ct">${esc(title)}</div><div class="cs">${esc(sub)}</div></div></div>`; }).join("");
  $("changesModalBody").innerHTML=`<p class="section-h" style="margin:0 0 12px">🔔 ${un.length} class update${un.length===1?"":"s"} for you</p>${list}<div class="row" style="margin-top:12px"><button class="btn btn-primary btn-sm" id="chgSeen">Got it</button><button class="btn btn-ghost btn-sm" id="chgOpen">Open Updates</button></div>`;
  $("changesModal").classList.remove("hidden");
  const close=()=>{ lastSeenChanges=Math.max(lastSeenChanges,...changes.map(chMs),Date.now()); persistLastSeen(); updateUpdCount(); $("changesModal").classList.add("hidden"); };
  $("chgSeen").onclick=close;
  $("chgOpen").onclick=()=>{ close(); showTab("updates"); };
}
async function persistLastSeen(){
  if(ATT.cloud && ATT.userRef){ try{ await ATT.fb.setDoc(ATT.userRef,{lastSeenChanges},{merge:true}); }catch(e){} }
}

// ===========================================================================
//  TABS + THEME + BOOT
// ===========================================================================
function showTab(name){
  // leaving a marking page (timetable / attendance) with unsaved marks → ask to save
  const active = ["timetable","friends","attendance"].find(t=>!$("tab-"+t).classList.contains("hidden"));
  if(attDirty && active!==name && (active==="timetable" || active==="attendance")) confirmLeaveIfDirty();
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.tab===name));
  ["timetable","friends","attendance","updates"].forEach(t=> $("tab-"+t).classList.toggle("hidden", t!==name));
  if(name==="timetable" && currentRoll) refreshTimetable();
  if(name==="updates") renderUpdates();
  if(name==="friends"){ renderFriends(); if(ATT.cloud && ATT.user) fetchCloudSquads().then(renderSquads); }
  if(name==="attendance") renderAttendance();
}
document.querySelectorAll("#nav button").forEach(b=> b.addEventListener("click", ()=>showTab(b.dataset.tab)));

// theme
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  $("themeBtn").textContent = t==="dark" ? "☀️" : "🌙";
  localStorage.setItem("tt_theme", t);
}
$("themeBtn").onclick = () => applyTheme(document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark");
applyTheme(localStorage.getItem("tt_theme") || "light");

// changes popup close
$("changesModalX").onclick = () => { lastSeenChanges=Math.max(lastSeenChanges,...changes.map(chMs),Date.now()); persistLastSeen(); updateUpdCount(); $("changesModal").classList.add("hidden"); };
$("changesModal").onclick = e => { if(e.target.id==="changesModal") $("changesModalX").onclick(); };

// sign-in modal close controls
$("authModalX").onclick = closeAuthModal;
$("authModal").onclick = e => { if(e.target.id==="authModal") closeAuthModal(); };
document.addEventListener("keydown", e => { if(e.key==="Escape" && !$("authModal").classList.contains("hidden")) closeAuthModal(); });

// squad controls
$("saveSquad").onclick = saveSquad;
$("squadName").addEventListener("keydown", e => { if(e.key==="Enter") saveSquad(); });

// unsaved-attendance bar + leave-the-site guard
$("sbSave").onclick = commitAttendance;
$("sbDiscard").onclick = discardAttendance;
window.addEventListener("beforeunload", e => {
  if(attDirty){ saveAttendance(); e.preventDefault(); e.returnValue=""; }
});

// boot
updateFriendBadge();
const last = localStorage.getItem("tt_lastRoll");
if(last && D.students[last]) selectStudent(last);
ATT.meRoll = localStorage.getItem("tt_me") || null;
initFirebase().then(()=>{ if(!ATT.cloud){ /* local mode ready */ } });

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
  let rows="";
  D.days.forEach((day,di)=>{
    rows+=`<tr><td class='daycol'>${day}</td>`;
    D.slots.forEach((slot,si)=>{
      const here=idx[day+"|"+si];
      rows += here
        ? "<td class='cell'>"+here.map(m=>{
            const col=colorFor(m.course);
            let markCls="", controls="";
            if(markEnabled){
              const key=attKey(m.course,m.section,fmtDate(dateForCell(di)),m.slot);
              const st=ATT.data[key]||"";
              markCls = st==="p"?" marked-p":st==="a"?" marked-a":"";
              controls=`<span class='mkrow' data-key='${key}'>`+
                `<button class='mkmini p ${st==="p"?"on":""}' data-v='p'>✓</button>`+
                `<button class='mkmini a ${st==="a"?"on":""}' data-v='a'>✗</button></span>`;
            }
            return `<div class='cls${markCls}' style='--c:${col};background:${col}1f'><span class='ab'>${clsLabel(m.course,m.section)}</span><span class='rm'>${esc(m.details)}</span>${controls}</div>`;
          }).join("")+"</td>"
        : "<td class='cell free'></td>";
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
async function toggleMark(key, v){
  ATT.data[key] = (ATT.data[key]===v) ? undefined : v;
  if(ATT.data[key]===undefined) delete ATT.data[key];
  if(currentRoll){ const ms=meetingsFor(currentRoll); renderGrid(ms); renderAgenda(ms); }
  await saveAttendance();
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
  $("agendaView").innerHTML = D.days.map((day,di)=>{
    const items=(byDay[day]||[]).sort((a,b)=>a.slot-b.slot);
    const body = items.length ? items.map(m=>{
      const col=colorFor(m.course), cm=D.courses[m.course]||{};
      let stCls="", marks="";
      if(markEnabled){
        const key=attKey(m.course,m.section,fmtDate(dateForCell(di)),m.slot);
        const st=ATT.data[key]||"";
        stCls = st==="p"?" ag-p":st==="a"?" ag-a":"";
        marks=`<span class='ag-marks' data-key='${key}'>`+
          `<button class='mkmini p ${st==="p"?"on":""}' data-v='p'>✓</button>`+
          `<button class='mkmini a ${st==="a"?"on":""}' data-v='a'>✗</button></span>`;
      }
      return `<div class='ag-item${stCls}'><div class='ag-time'>${D.slots[m.slot]}</div><div class='ag-bar' style='--c:${col}'></div><div class='ag-main'><div class='t'>${clsLabel(m.course,m.section)}</div><div class='s'>${esc(cm.name)}</div></div><div class='ag-room'>${esc(m.details)}</div>${marks}</div>`;
    }).join("") : "<div class='day-empty'>No classes 🎉</div>";
    return `<div class='day-block'><div class='day-head'>${day}<span class='n'>${items.length} class${items.length===1?"":"es"}</span></div>${body}</div>`;
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
  renderCompare();
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

  let head = "<tr><th class='daycol'>Day</th>"+
    D.slots.map((slot,i)=>`<th><span class='slotnum'>Slot ${i+1}</span>${slot}</th>`).join("")+"</tr>";
  let rows="";
  D.days.forEach(day=>{
    rows+=`<tr><td class='daycol'>${day}</td>`;
    D.slots.forEach((slot,si)=>{
      const busy=[];
      people.forEach((p,pi)=>{ const m=maps[pi][day+"|"+si]; if(m) busy.push({p,m}); });
      if(busy.length===0){
        rows+="<td class='cell free'><div class='allfree'>✓ all free</div></td>";
      } else {
        rows+="<td class='cell'>"+busy.map(({p,m})=>
          `<div class='who' style='--c:${personColor(p.roll)}'><span>${esc(p.name.split(" ")[0])}${p.you?" (you)":""} · ${esc(clsLabel(m.course,m.section))}</span><span class='rm2'>${esc(m.details)}</span></div>`
        ).join("")+"</td>";
      }
    });
    rows+="</tr>";
  });

  wrap.innerHTML = `<div class="people-key">${key}</div>
    <p class="section-h">Weekly overlap — green “all free” slots are good to meet</p>
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
          if(snap.exists()){ const d=snap.data(); ATT.meRoll=d.roll||null; ATT.data=d.attendance||{}; ATT.role=d.role||null; }
          // bind the roll chosen at signup, if the doc didn't have one yet
          if(!ATT.meRoll && ATT.pendingRoll){
            ATT.meRoll = ATT.pendingRoll;
            await withTimeout(fs.setDoc(ATT.userRef, { roll:ATT.meRoll }, { merge:true }));
          }
          ATT.pendingRoll=null;
        }catch(e){ ATT.cloudError = e.message; console.error("[firestore] read failed:", e.code||"", e.message); }
      } else { ATT.userRef=null; }
      if(ATT.user) closeAuthModal();
      renderAttendance();
      // reflect login on the timetable grid (marking controls / own schedule)
      if(u && ATT.meRoll && !currentRoll) selectStudent(ATT.meRoll);
      else refreshTimetable();
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
  body.querySelectorAll(".marks .mk").forEach(btn => btn.onclick = async e => {
    e.stopPropagation();
    const marks=btn.parentElement, key=marks.dataset.key, v=btn.dataset.v;
    ATT.data[key] = (ATT.data[key]===v) ? undefined : v;
    if(ATT.data[key]===undefined) delete ATT.data[key];
    // update only the affected buttons + this course's summary (keeps list open)
    marks.querySelectorAll(".mk").forEach(b=> b.classList.toggle("on", b.dataset.v===ATT.data[key]));
    updateCourseSummary(marks.closest(".att-course"));
    await saveAttendance();
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
//  TABS + THEME + BOOT
// ===========================================================================
function showTab(name){
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.tab===name));
  ["timetable","friends","attendance"].forEach(t=> $("tab-"+t).classList.toggle("hidden", t!==name));
  if(name==="timetable" && currentRoll) refreshTimetable();
  if(name==="friends") renderFriends();
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

// sign-in modal close controls
$("authModalX").onclick = closeAuthModal;
$("authModal").onclick = e => { if(e.target.id==="authModal") closeAuthModal(); };
document.addEventListener("keydown", e => { if(e.key==="Escape" && !$("authModal").classList.contains("hidden")) closeAuthModal(); });

// boot
updateFriendBadge();
const last = localStorage.getItem("tt_lastRoll");
if(last && D.students[last]) selectStudent(last);
ATT.meRoll = localStorage.getItem("tt_me") || null;
initFirebase().then(()=>{ if(!ATT.cloud){ /* local mode ready */ } });

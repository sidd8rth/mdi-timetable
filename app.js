// ===========================================================================
//  MDI PGDM Term-IV — personal timetable, friends compare, attendance tracker
// ===========================================================================
import { FIREBASE_CONFIG } from "./firebase-config.js";

const D = window.TT_DATA;
const COURSE_PALETTE = ["#3b6fe0","#7c4dff","#db2777","#0d9488","#d97706","#e11d48","#0891b2","#7c3aed","#16a34a","#ca8a04","#2563eb","#c026d3"];
const PERSON_PALETTE = ["#3b6fe0","#e11d48","#16a34a","#d97706","#7c4dff","#0891b2"];

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

makeSearch($("q"), $("results"), roll => selectStudent(roll));

function selectStudent(roll){
  const s = D.students[roll]; if(!s) return;
  currentRoll = roll;
  localStorage.setItem("tt_lastRoll", roll);
  $("q").value = s.name; $("q").blur();
  const ms = meetingsFor(roll);
  $("placeholder").style.display="none";
  $("studentBar").classList.add("show");
  $("viewToggle").style.display="inline-flex";
  $("legend").style.display="block";
  $("avatar").textContent = (s.name.trim()[0]||"?").toUpperCase();
  $("sName").textContent = s.name;
  $("sMeta").textContent = "Roll " + roll;
  const nc = new Set(s.courses.map(c=>c.course)).size;
  $("countPill").textContent = `${nc} courses · ${ms.length} sessions/week`;
  renderGrid(ms); renderAgenda(ms); renderLegend(s.courses); setView(currentView);
  if(compareInited) renderCompare();
}

function renderGrid(ms){
  $("thead").innerHTML = "<tr><th class='timecol'>Time</th>"+D.days.map(d=>`<th>${d}</th>`).join("")+"</tr>";
  const idx={}; ms.forEach(m=>{(idx[m.day+"|"+m.slot] ??= []).push(m);});
  let rows="";
  D.slots.forEach((slot,si)=>{
    rows+=`<tr><td class='timecol'><span class='slotnum'>${si+1}</span>${slot}</td>`;
    D.days.forEach(day=>{
      const here=idx[day+"|"+si];
      rows += here
        ? "<td class='cell'>"+here.map(m=>{const col=colorFor(m.course);
            return `<div class='cls' style='--c:${col};background:${col}1f'><span class='ab'>${clsLabel(m.course,m.section)}</span><span class='rm'>${esc(m.details)}</span></div>`;
          }).join("")+"</td>"
        : "<td class='cell free'></td>";
    });
    rows+="</tr>";
  });
  $("tbody").innerHTML = rows;
}

function renderAgenda(ms){
  const byDay={}; ms.forEach(m=>{(byDay[m.day] ??= []).push(m);});
  $("agendaView").innerHTML = D.days.map(day=>{
    const items=(byDay[day]||[]).sort((a,b)=>a.slot-b.slot);
    const body = items.length ? items.map(m=>{
      const col=colorFor(m.course), cm=D.courses[m.course]||{};
      return `<div class='ag-item'><div class='ag-time'>${D.slots[m.slot]}</div><div class='ag-bar' style='--c:${col}'></div><div class='ag-main'><div class='t'>${clsLabel(m.course,m.section)}</div><div class='s'>${esc(cm.name)}</div></div><div class='ag-room'>${esc(m.details)}</div></div>`;
    }).join("") : "<div class='day-empty'>No classes 🎉</div>";
    return `<div class='day-block'><div class='day-head'>${day}<span class='n'>${items.length} class${items.length===1?"":"es"}</span></div>${body}</div>`;
  }).join("");
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

  let head = "<tr><th class='timecol'>Time</th>"+D.days.map(d=>`<th>${d}</th>`).join("")+"</tr>";
  let rows="";
  D.slots.forEach((slot,si)=>{
    rows+=`<tr><td class='timecol'><span class='slotnum'>${si+1}</span>${slot}</td>`;
    D.days.forEach(day=>{
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
  cloud:false, user:null, meRoll:null, data:{},
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
      ATT.user = u; ATT.meRoll=null; ATT.data={};
      if(u){
        ATT.userRef = fs.doc(ATT.db, "users", u.uid);
        try{
          const snap = await withTimeout(fs.getDoc(ATT.userRef));
          if(snap.exists()){ const d=snap.data(); ATT.meRoll=d.roll||null; ATT.data=d.attendance||{}; }
          // bind the roll chosen at signup, if the doc didn't have one yet
          if(!ATT.meRoll && ATT.pendingRoll){
            ATT.meRoll = ATT.pendingRoll;
            await withTimeout(fs.setDoc(ATT.userRef, { roll:ATT.meRoll }, { merge:true }));
          }
          ATT.pendingRoll=null;
        }catch(e){ ATT.cloudError = e.message; console.error("[firestore] read failed:", e.code||"", e.message); }
      } else { ATT.userRef=null; }
      renderAttendance();
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

  // Cloud mode — need login
  if(!ATT.user){ renderAuth(authEl); return; }
  if(ATT.cloudError){
    banner.innerHTML = `<div class="banner">⚠️ Signed in, but couldn't reach the database: ${esc(ATT.cloudError)}</div>`;
  }
  renderMePicker(authEl, true);
  if(ATT.meRoll) renderAttendanceBody(body);
  else body.innerHTML = `<p class="hint">Pick your name above to start tracking attendance.</p>`;
}

let authMode = "signin";        // or "signup"
let signupRoll = null;          // roll chosen during create-account

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
  let html = `<p class="section-h" style="margin-top:22px">Attendance — present ÷ (present + absent), excluding cancelled</p>`;
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
//  TABS + THEME + BOOT
// ===========================================================================
function showTab(name){
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.tab===name));
  ["timetable","friends","attendance"].forEach(t=> $("tab-"+t).classList.toggle("hidden", t!==name));
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

// boot
updateFriendBadge();
const last = localStorage.getItem("tt_lastRoll");
if(last && D.students[last]) selectStudent(last);
ATT.meRoll = localStorage.getItem("tt_me") || null;
initFirebase().then(()=>{ if(!ATT.cloud){ /* local mode ready */ } });

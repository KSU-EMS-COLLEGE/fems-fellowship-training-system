
const FEMS = window.FEMS_DATA;
const STUDENTS_DB = FEMS.STUDENTS_DB;
const SCHEDULES = FEMS.SCHEDULES;
const MONTHS = FEMS.MONTHS;
const ROT_DISPLAY = FEMS.ROT_DISPLAY || {};
let currentLevel = "F1";
let db = null;
let firebaseReady = false;
let progressMap = {};
let evals = [];
let selectedCell = null;

function displayRot(r){ return ROT_DISPLAY[r] || r || ""; }
function safeId(v){ return String(v || "").replace(/[^\w\u0600-\u06FF-]+/g, "_"); }
function progressId(level, studentId, monthIdx, rotation){
  return [level, studentId, monthIdx, safeId(rotation)].join("__");
}
function studentById(level, id){
  return (STUDENTS_DB[level] || []).find(s => String(s.id) === String(id));
}
function isFirebaseConfigured(){
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && !String(c.apiKey).includes("PUT_") && c.projectId && !String(c.projectId).includes("PUT_");
}
function initFirebase(){
  if(!isFirebaseConfigured()){
    document.getElementById("connectionNotice").style.display = "block";
    return;
  }
  try{
    firebase.initializeApp(window.FIREBASE_CONFIG);
    db = firebase.firestore();
    firebaseReady = true;
    document.getElementById("connectionNotice").style.display = "none";
    listenRealtime();
  }catch(e){
    console.error(e);
    document.getElementById("connectionNotice").textContent = "تعذر الاتصال بـ Firebase: " + e.message;
  }
}
function listenRealtime(){
  db.collection("rotationProgress").onSnapshot(snap => {
    progressMap = {};
    snap.forEach(doc => progressMap[doc.id] = doc.data());
    renderAll();
  });
  db.collection("evaluations").orderBy("submittedAt","desc").limit(300).onSnapshot(snap => {
    evals = [];
    snap.forEach(doc => evals.push({id: doc.id, ...doc.data()}));
    renderArchive();
    renderStats();
  });
}
function setLevel(level){
  currentLevel = level;
  ["F1","F2","F3"].forEach(l => {
    const el = document.getElementById("tab-"+l);
    if(el) el.className = l===level ? "tab active" : "tab";
  });
  renderAll();
}
function renderAll(){
  renderSchedule();
  renderCompletion();
  renderArchive();
  renderStats();
}
function renderStats(){
  const studentsCount = Object.values(STUDENTS_DB).reduce((a,b)=>a+b.length,0);
  const totalAssignments = Object.keys(SCHEDULES).reduce((sum, lvl) => sum + Object.values(SCHEDULES[lvl]||{}).reduce((a,b)=>a+b.length,0), 0);
  const approved = Object.values(progressMap).filter(p => p.status === "approved").length;
  const submitted = Object.values(progressMap).filter(p => p.status === "submitted").length;
  document.getElementById("stats").innerHTML = `
    <div class="stat"><b>${studentsCount}</b><span>إجمالي الطلاب</span></div>
    <div class="stat"><b>${totalAssignments}</b><span>إجمالي الروتيشنات</span></div>
    <div class="stat"><b>${submitted}</b><span>تقييمات مستلمة</span></div>
    <div class="stat"><b>${approved}</b><span>تقييمات معتمدة</span></div>
  `;
}
function renderSchedule(){
  const months = MONTHS[currentLevel] || [];
  const schedules = SCHEDULES[currentLevel] || {};
  let html = `<table><thead><tr><th class="name">الطالب</th>${months.map(m=>`<th>${m}</th>`).join("")}</tr></thead><tbody>`;
  Object.keys(schedules).forEach(name => {
    html += `<tr><td class="name">${name}</td>`;
    schedules[name].forEach((rot, idx) => {
      html += `<td>${displayRot(rot)}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  document.getElementById("scheduleTitle").textContent = "جدول التدريب - " + currentLevel;
  document.getElementById("scheduleTable").innerHTML = html;
}
function renderCompletion(){
  const months = MONTHS[currentLevel] || [];
  const schedules = SCHEDULES[currentLevel] || {};
  const students = STUDENTS_DB[currentLevel] || [];
  let html = `<table><thead><tr><th class="name">الطالب</th>${months.map(m=>`<th>${m}</th>`).join("")}</tr></thead><tbody>`;
  Object.keys(schedules).forEach(name => {
    const student = students.find(s => s.name === name) || {id: safeId(name), name};
    html += `<tr><td class="name">${name}<br><span class="small">${student.id || ""}</span></td>`;
    schedules[name].forEach((rot, idx) => {
      const id = progressId(currentLevel, student.id || name, idx, rot);
      const p = progressMap[id] || {};
      html += `<td><div class="rotcell" onclick="openEvalModal('${currentLevel}','${String(student.id||name).replace(/'/g,"\\'")}',${idx},'${String(rot).replace(/'/g,"\\'")}')">
        <b>${displayRot(rot)}</b>
        ${p.score ? `<span class="score">${p.score}/100</span>` : `<span class="badge waiting">لم يرسل</span>`}
        ${p.status ? `<span class="badge ${p.status}">${statusLabel(p.status)}</span>` : ""}
      </div></td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  document.getElementById("completionTable").innerHTML = html;
}
function statusLabel(s){
  return {waiting:"لم يرسل",submitted:"بانتظار الاعتماد",approved:"معتمد",rejected:"مرفوض"}[s] || s;
}
function openEvalModal(level, studentId, monthIdx, rotation){
  const student = studentById(level, studentId) || {name:"",id:studentId};
  const months = MONTHS[level] || [];
  selectedCell = {level, studentId, studentName: student.name, monthIdx, month: months[monthIdx], rotation};
  const id = progressId(level, studentId, monthIdx, rotation);
  const p = progressMap[id] || {};
  document.getElementById("modalBody").innerHTML = `
    <div class="grid2">
      <div><b>الطالب:</b><br>${student.name}<br><span class="small">${student.id}</span></div>
      <div><b>الروتيشن:</b><br>${displayRot(rotation)}<br><span class="small">${level} - ${months[monthIdx]}</span></div>
    </div>
    <hr>
    <div class="field">
      <label>نوع نموذج التقييم</label>
      <select id="linkFormType">
        <option value="external">تقييم خارجي</option>
        <option value="internal">تقييم داخلي</option>
      </select>
    </div>
    <button class="btn gold" onclick="createEvaluationLink()">إنشاء رابط تقييم خاص</button>
    <div id="createdLink"></div>
    <hr>
    <h3>حالة هذا الروتيشن</h3>
    <div>${p.score ? `<b>الدرجة:</b> ${p.score}/100<br>` : "لا توجد درجة بعد."}</div>
    <div>${p.evaluatorName ? `<b>المقيم:</b> ${p.evaluatorName}<br>` : ""}</div>
    <div>${p.evaluatorOrg ? `<b>الجهة:</b> ${p.evaluatorOrg}<br>` : ""}</div>
    ${p.paperUrl ? `<a href="${p.paperUrl}" target="_blank">عرض النموذج الورقي</a><br>` : ""}
    ${p.status === "submitted" ? `<br><button class="btn green" onclick="approveProgress('${id}')">اعتماد</button> <button class="btn red" onclick="rejectProgress('${id}')">رفض</button>` : ""}
  `;
  document.getElementById("evalModal").className = "modal-backdrop open";
}
function closeModal(){ document.getElementById("evalModal").className = "modal-backdrop"; }
async function createEvaluationLink(){
  if(!firebaseReady){ alert("اربط Firebase أولاً من app-config.js"); return; }
  const type = document.getElementById("linkFormType").value;
  const token = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g,"");
  const c = selectedCell;
  const doc = {
    token,
    formType: type,
    level: c.level,
    studentId: c.studentId,
    studentName: c.studentName,
    monthIdx: c.monthIdx,
    month: c.month,
    rotation: c.rotation,
    rotationDisplay: displayRot(c.rotation),
    status: "active",
    used: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection("evaluationLinks").doc(token).set(doc);
  const base = location.href.replace(/index\.html.*$/,"").replace(/\/$/,"/");
  const url = base + "evaluation.html?token=" + encodeURIComponent(token);
  document.getElementById("createdLink").innerHTML = `<div class="successbox">تم إنشاء الرابط. هذا الرابط لا يعرض اسم الطالب للمقيم.</div><div class="linkbox">${url}</div><button class="btn gray" onclick="navigator.clipboard.writeText('${url}')">نسخ الرابط</button>`;
}
async function approveProgress(id){
  if(!firebaseReady) return;
  await db.collection("rotationProgress").doc(id).update({status:"approved", approvedAt: firebase.firestore.FieldValue.serverTimestamp()});
  closeModal();
}
async function rejectProgress(id){
  if(!firebaseReady) return;
  const reason = prompt("سبب الرفض") || "";
  await db.collection("rotationProgress").doc(id).update({status:"rejected", rejectReason: reason, rejectedAt: firebase.firestore.FieldValue.serverTimestamp()});
  closeModal();
}
function renderArchive(){
  let html = `<table><thead><tr><th>التاريخ</th><th>الطالب</th><th>المستوى</th><th>الروتيشن</th><th>نوع النموذج</th><th>الدرجة</th><th>المقيم</th><th>الجهة</th><th>النموذج الورقي</th></tr></thead><tbody>`;
  if(evals.length === 0) html += `<tr><td colspan="9">لا توجد تقييمات مستلمة بعد.</td></tr>`;
  evals.forEach(e => {
    html += `<tr>
      <td>${formatDate(e.submittedAt)}</td>
      <td>${e.studentName || ""}<br><span class="small">${e.studentId || ""}</span></td>
      <td>${e.level || ""}</td><td>${e.rotationDisplay || displayRot(e.rotation)}</td>
      <td>${e.formType === "internal" ? "داخلي" : "خارجي"}</td>
      <td><b>${e.score || 0}/100</b></td>
      <td>${e.evaluatorName || ""}</td><td>${e.evaluatorOrg || ""}</td>
      <td>${e.paperUrl ? `<a href="${e.paperUrl}" target="_blank">فتح</a>` : "—"}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  const el = document.getElementById("archiveTable");
  if(el) el.innerHTML = html;
}
function formatDate(ts){
  try{
    if(!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("ar-SA");
  }catch(e){ return ""; }
}
function exportCSV(){
  const rows = [["studentName","studentId","level","month","rotation","formType","score","evaluatorName","evaluatorOrg","paperUrl"]];
  evals.forEach(e => rows.push([e.studentName,e.studentId,e.level,e.month,e.rotationDisplay||e.rotation,e.formType,e.score,e.evaluatorName,e.evaluatorOrg,e.paperUrl].map(v=>String(v||"").replace(/"/g,'""'))));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fems-evaluations.csv";
  a.click();
}
initFirebase();
renderAll();

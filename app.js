
const FEMS = window.FEMS_DATA;
const BASE_STUDENTS_DB = FEMS.STUDENTS_DB;
const BASE_SCHEDULES = FEMS.SCHEDULES;
const MONTHS = FEMS.MONTHS;
const ROT_DISPLAY = FEMS.ROT_DISPLAY || {};

let currentLevel = "F1";
let db = null;
let firebaseReady = false;
let progressMap = {};
let evals = [];
let selectedCell = null;
let customStudents = {};
let hiddenStudents = {};

function displayRot(r){ return ROT_DISPLAY[r] || r || ""; }
function safeId(v){ return String(v || "").replace(/[^\w\u0600-\u06FF-]+/g, "_"); }
function escapeHtml(v){ return String(v ?? "").replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
function jsStr(v){ return String(v ?? "").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\n/g,"\\n"); }
function nextLevel(level){ return level === "F1" ? "F2" : level === "F2" ? "F3" : null; }
function hiddenKey(level, studentId){ return `${level}__${safeId(studentId)}`; }
function customKey(level, studentId){ return `${level}__${safeId(studentId)}`; }
function progressId(level, studentId, monthIdx, rotation){
  return [level, studentId, monthIdx, safeId(rotation)].join("__");
}
function baseStudentById(level, id){
  return (BASE_STUDENTS_DB[level] || []).find(s => String(s.id) === String(id));
}
function studentById(level, id){
  return getStudents(level).find(s => String(s.id) === String(id));
}
function isHidden(level, studentId){ return !!hiddenStudents[hiddenKey(level, studentId)]; }
function scheduleBlank(level){ return (MONTHS[level] || []).map(()=>""); }
function normalizeSchedule(level, schedule){
  const months = MONTHS[level] || [];
  let arr = Array.isArray(schedule) ? schedule.slice() : [];
  while(arr.length < months.length) arr.push("");
  return arr.slice(0, months.length).map(x => String(x || "").trim());
}
function parseScheduleInput(level, text){
  const months = MONTHS[level] || [];
  const parts = String(text || "").split(/[،,\n\t;]/).map(x => x.trim()).filter(Boolean);
  const arr = parts.length ? parts : [];
  while(arr.length < months.length) arr.push("");
  return arr.slice(0, months.length);
}
function scheduleToTextarea(level, schedule){
  return normalizeSchedule(level, schedule).join(", ");
}
function getCustomStudent(level, id){
  const key = customKey(level, id);
  return customStudents[key] || Object.values(customStudents).find(s => s.level === level && String(s.id) === String(id));
}
function getStudents(level){
  const map = new Map();
  const order = [];
  (BASE_STUDENTS_DB[level] || []).forEach(s => {
    if(isHidden(level, s.id)) return;
    const copy = {...s, isBase:true, isCustom:false};
    map.set(String(s.id), copy);
    order.push(String(s.id));
  });
  Object.values(customStudents).filter(s => s.level === level && !s.deleted && s.active !== false).forEach(s => {
    if(isHidden(level, s.id)) return;
    const id = String(s.id);
    const copy = {...s, isCustom:true, isBase: map.has(id)};
    if(!map.has(id)) order.push(id);
    map.set(id, copy);
  });
  return order.map(id => map.get(id)).filter(Boolean);
}
function getStudentSchedule(level, student){
  const custom = getCustomStudent(level, student.id);
  if(custom && Array.isArray(custom.schedule)) return normalizeSchedule(level, custom.schedule);
  const baseSchedule = BASE_SCHEDULES[level] && BASE_SCHEDULES[level][student.name];
  return normalizeSchedule(level, baseSchedule || []);
}
function isFirebaseConfigured(){
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && !String(c.apiKey).includes("PUT_") && c.projectId && !String(c.projectId).includes("PUT_");
}
function initFirebase(){
  if(!isFirebaseConfigured()){
    document.getElementById("connectionNotice").style.display = "block";
    renderAll();
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
    snap.forEach(doc => { const d = {id: doc.id, ...doc.data()}; if(d.status !== "deleted" && !d.deleted) evals.push(d); });
    renderArchive();
    renderStats();
  });
  db.collection("customStudents").onSnapshot(snap => {
    customStudents = {};
    snap.forEach(doc => customStudents[doc.id] = {docId: doc.id, ...doc.data()});
    renderAll();
  });
  db.collection("hiddenStudents").onSnapshot(snap => {
    hiddenStudents = {};
    snap.forEach(doc => hiddenStudents[doc.id] = {docId: doc.id, ...doc.data()});
    renderAll();
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
  const studentsCount = ["F1","F2","F3"].reduce((sum,lvl)=>sum+getStudents(lvl).length,0);
  const totalAssignments = ["F1","F2","F3"].reduce((sum,lvl)=>sum + getStudents(lvl).reduce((a,s)=>a+getStudentSchedule(lvl,s).length,0),0);
  const approved = Object.values(progressMap).filter(p => p.status === "approved").length;
  const submitted = Object.values(progressMap).filter(p => p.status === "submitted").length;
  const rejected = Object.values(progressMap).filter(p => p.status === "rejected").length;
  document.getElementById("stats").innerHTML = `
    <div class="stat"><b>${studentsCount}</b><span>إجمالي الطلاب</span></div>
    <div class="stat"><b>${totalAssignments}</b><span>إجمالي الروتيشنات</span></div>
    <div class="stat"><b>${submitted}</b><span>بانتظار الاعتماد</span></div>
    <div class="stat"><b>${approved}</b><span>تقييمات معتمدة</span></div>
    <div class="stat"><b>${rejected}</b><span>تقييمات مرفوضة</span></div>
  `;
}
function studentActionButtons(level, student){
  const next = nextLevel(level);
  const id = jsStr(student.id);
  const name = jsStr(student.name);
  const buttons = [];
  buttons.push(`<button class="btn mini gray" onclick="event.stopPropagation(); editStudentSchedule('${level}','${id}')">تعديل التوزيع</button>`);
  if(next){
    buttons.push(`<button class="btn mini gold" onclick="event.stopPropagation(); promoteStudent('${level}','${id}')">ترقية إلى ${next}</button>`);
  }
  if(student.isCustom && !student.isBase){
    buttons.push(`<button class="btn mini red" onclick="event.stopPropagation(); deleteCustomStudent('${level}','${id}','${name}')">حذف الطالب</button>`);
  }
  return `<div class="student-actions-inline">${buttons.join(" ")}</div>`;
}
function renderSchedule(){
  const months = MONTHS[currentLevel] || [];
  const students = getStudents(currentLevel);
  const addControls = `
    <div class="row space schedule-actions">
      <div class="small">يمكن إضافة طلاب جدد إلى F1 وتعديل توزيع الروتيشنات أو ترقية الطلاب للمستوى التالي.</div>
      <button class="btn green" onclick="openAddStudentModal()">إضافة طالب جديد إلى F1</button>
    </div>`;
  let html = `${addControls}<table><thead><tr><th class="name">الطالب</th>${months.map(m=>`<th>${m}</th>`).join("")}</tr></thead><tbody>`;
  students.forEach(student => {
    const schedule = getStudentSchedule(currentLevel, student);
    html += `<tr><td class="name">${escapeHtml(student.name)}<br><span class="small">${escapeHtml(student.id || "")}</span>${studentActionButtons(currentLevel, student)}</td>`;
    schedule.forEach((rot) => { html += `<td>${escapeHtml(displayRot(rot))}</td>`; });
    html += `</tr>`;
  });
  if(students.length === 0) html += `<tr><td colspan="${months.length+1}">لا يوجد طلاب في هذا المستوى.</td></tr>`;
  html += `</tbody></table>`;
  document.getElementById("scheduleTitle").textContent = "جدول التدريب - " + currentLevel;
  document.getElementById("scheduleTable").innerHTML = html;
}
function renderCompletion(){
  const months = MONTHS[currentLevel] || [];
  const students = getStudents(currentLevel);
  let html = `<table><thead><tr><th class="name">الطالب</th>${months.map(m=>`<th>${m}</th>`).join("")}</tr></thead><tbody>`;
  students.forEach(student => {
    const schedule = getStudentSchedule(currentLevel, student);
    html += `<tr><td class="name">${escapeHtml(student.name)}<br><span class="small">${escapeHtml(student.id || "")}</span>${studentActionButtons(currentLevel, student)}</td>`;
    schedule.forEach((rot, idx) => {
      const id = progressId(currentLevel, student.id || student.name, idx, rot);
      const p = progressMap[id] || {};
      let cellStatusHtml = `<span class="badge waiting">لم يرسل</span>`;
      if(p.status === "rejected"){
        cellStatusHtml = `<span class="badge waiting">بانتظار إعادة التقييم</span>`;
      }else if(p.status === "submitted"){
        cellStatusHtml = `${p.score ? `<span class="score">${p.score}/100</span>` : ""}<span class="badge submitted">بانتظار الاعتماد</span>`;
      }else if(p.status === "approved"){
        cellStatusHtml = `${p.score ? `<span class="score">${p.score}/100</span>` : ""}<span class="badge approved">معتمد</span>`;
      }else if(p.score){
        cellStatusHtml = `<span class="score">${p.score}/100</span>`;
      }
      html += `<td><div class="rotcell" onclick="openEvalModal('${currentLevel}','${jsStr(student.id||student.name)}',${idx},'${jsStr(rot)}')">
        <b>${escapeHtml(displayRot(rot))}</b>
        ${cellStatusHtml}
      </div></td>`;
    });
    html += `</tr>`;
  });
  if(students.length === 0) html += `<tr><td colspan="${months.length+1}">لا يوجد طلاب في هذا المستوى.</td></tr>`;
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
      <div><b>الطالب:</b><br>${escapeHtml(student.name)}<br><span class="small">${escapeHtml(student.id)}</span></div>
      <div><b>الروتيشن:</b><br>${escapeHtml(displayRot(rotation))}<br><span class="small">${escapeHtml(level)} - ${escapeHtml(months[monthIdx] || "")}</span></div>
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
    <div>${p.evaluatorName ? `<b>المقيم:</b> ${escapeHtml(p.evaluatorName)}<br>` : ""}</div>
    <div>${p.evaluatorOrg ? `<b>الجهة:</b> ${escapeHtml(p.evaluatorOrg)}<br>` : ""}</div>
    ${p.paperUrl ? `<a class="btn gray" href="${p.paperUrl}" target="_blank">عرض النموذج الورقي</a> <a class="btn gray" href="${p.paperUrl}" target="_blank" download>تحميل النموذج</a><br>` : ""}
    ${p.status ? `<b>الحالة:</b> ${statusLabel(p.status)}<br>` : ""}
    ${p.rejectReason ? `<b>سبب الرفض:</b> ${escapeHtml(p.rejectReason)}<br>` : ""}
    ${p.status === "submitted" ? `<br><button class="btn green" onclick="approveProgress('${id}')">اعتماد</button> <button class="btn red" onclick="rejectProgress('${id}')">رفض</button>` : ""}
    ${p.status === "rejected" ? `<br><button class="btn red" onclick="deleteRejectedEvaluation('${id}')">حذف التقييم المرفوض</button>` : ""}
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
  const p = progressMap[id] || {};
  await db.collection("rotationProgress").doc(id).update({status:"approved", approvedAt: firebase.firestore.FieldValue.serverTimestamp()});
  if(p.token){
    await db.collection("evaluations").doc(p.token).update({status:"approved", approvedAt: firebase.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
  }
  closeModal();
}
async function rejectProgress(id){
  if(!firebaseReady) return;
  const p = progressMap[id] || {};
  const reason = prompt("سبب الرفض") || "";
  await db.collection("rotationProgress").doc(id).update({status:"rejected", rejectReason: reason, rejectedAt: firebase.firestore.FieldValue.serverTimestamp()});
  if(p.token){
    await db.collection("evaluations").doc(p.token).update({status:"rejected", rejectReason: reason, rejectedAt: firebase.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
  }
  closeModal();
}
async function deleteEvaluationEverywhere(evaluationDocId, sourceData){
  const data = sourceData || evals.find(x => x.id === evaluationDocId || x.token === evaluationDocId) || {};
  const token = data.token || evaluationDocId;
  const operations = [];
  if(evaluationDocId){ operations.push(db.collection("evaluations").doc(evaluationDocId).delete()); }
  if(token && token !== evaluationDocId){ operations.push(db.collection("evaluations").doc(token).delete()); }
  if(data.level && data.studentId !== undefined && data.monthIdx !== undefined && data.rotation){
    const pid = progressId(data.level, data.studentId, data.monthIdx, data.rotation);
    operations.push(db.collection("rotationProgress").doc(pid).delete());
  }
  if(token){
    const snap = await db.collection("rotationProgress").where("token", "==", token).get().catch(()=>null);
    if(snap){ snap.forEach(doc => operations.push(doc.ref.delete())); }
    operations.push(db.collection("evaluationLinks").doc(token).delete().catch(async()=>{
      await db.collection("evaluationLinks").doc(token).set({status:"deleted", used:true, deletedAt: firebase.firestore.FieldValue.serverTimestamp()}, {merge:true});
    }));
  }
  const results = await Promise.allSettled(operations);
  const failed = results.filter(r => r.status === "rejected");
  if(failed.length){
    console.warn("Some delete operations failed", failed);
    throw new Error("تعذر حذف بعض سجلات التقييم. تأكد من نشر قواعد Firestore المحدثة التي تسمح بالحذف.");
  }
}
async function deleteRejectedEvaluation(progressDocId){
  if(!firebaseReady) return;
  const p = progressMap[progressDocId] || {};
  if(p.status !== "rejected"){ alert("يمكن حذف التقييمات المرفوضة فقط."); return; }
  if(!confirm("سيتم حذف التقييم المرفوض نهائيًا من الأرشيف ومن جدول الإنجاز. هل أنت متأكد؟")) return;
  try{
    await deleteEvaluationEverywhere(p.token, p);
    await db.collection("rotationProgress").doc(progressDocId).delete().catch(()=>{});
    closeModal();
  }catch(err){ alert(err.message || "تعذر حذف التقييم."); }
}
async function deleteRejectedEvaluationByToken(token){
  if(!firebaseReady) return;
  const e = evals.find(x => x.id === token || x.token === token);
  if(!e || e.status !== "rejected"){ alert("يمكن حذف التقييمات المرفوضة فقط."); return; }
  if(!confirm("سيتم حذف التقييم المرفوض نهائيًا من الأرشيف ومن جدول الإنجاز. هل أنت متأكد؟")) return;
  try{ await deleteEvaluationEverywhere(e.id || token, e); }catch(err){ alert(err.message || "تعذر حذف التقييم."); }
}
function renderArchive(){
  let html = `<table><thead><tr><th>التاريخ</th><th>الطالب</th><th>المستوى</th><th>الروتيشن</th><th>نوع النموذج</th><th>الدرجة</th><th>الحالة</th><th>المقيم</th><th>الجهة</th><th>النموذج الورقي</th><th>إجراء</th></tr></thead><tbody>`;
  if(evals.length === 0) html += `<tr><td colspan="11">لا توجد تقييمات مستلمة بعد.</td></tr>`;
  evals.forEach(e => {
    const status = e.status || "submitted";
    html += `<tr>
      <td>${formatDate(e.submittedAt)}</td>
      <td>${escapeHtml(e.studentName || "")}<br><span class="small">${escapeHtml(e.studentId || "")}</span></td>
      <td>${escapeHtml(e.level || "")}</td><td>${escapeHtml(e.rotationDisplay || displayRot(e.rotation))}</td>
      <td>${e.formType === "internal" ? "داخلي" : "خارجي"}</td>
      <td><b>${e.score || 0}/100</b></td>
      <td><span class="badge ${status}">${statusLabel(status)}</span>${e.rejectReason ? `<br><span class="small">${escapeHtml(e.rejectReason)}</span>` : ""}</td>
      <td>${escapeHtml(e.evaluatorName || "")}</td><td>${escapeHtml(e.evaluatorOrg || "")}</td>
      <td>${e.paperUrl ? `<a href="${e.paperUrl}" target="_blank">عرض</a> | <a href="${e.paperUrl}" target="_blank" download>تحميل</a>` : "—"}</td>
      <td>${status === "rejected" ? `<button class="btn red" onclick="deleteRejectedEvaluationByToken('${e.id}')">حذف</button>` : "—"}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  const el = document.getElementById("archiveTable");
  if(el) el.innerHTML = html;
}
function formatDate(ts){
  try{ if(!ts) return ""; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleString("ar-SA"); }catch(e){ return ""; }
}
function exportCSV(){
  const rows = [["studentName","studentId","level","month","rotation","formType","score","status","evaluatorName","evaluatorOrg","paperUrl","rejectReason"]];
  evals.forEach(e => rows.push([e.studentName,e.studentId,e.level,e.month,e.rotationDisplay||e.rotation,e.formType,e.score,e.status||"submitted",e.evaluatorName,e.evaluatorOrg,e.paperUrl,e.rejectReason].map(v=>String(v||"").replace(/"/g,'""'))));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "fems-evaluations.csv"; a.click();
}
function ensureFirebase(){ if(!firebaseReady){ alert("يجب ربط Firebase أولاً."); return false; } return true; }
function openAddStudentModal(){
  document.getElementById("modalBody").innerHTML = `
    <h3>إضافة طالب جديد إلى F1</h3>
    <div class="field"><label>اسم الطالب بالعربي</label><input id="newStudentName" placeholder="الاسم الكامل"></div>
    <div class="field"><label>اسم الطالب بالإنجليزي</label><input id="newStudentNameEn" placeholder="Full name"></div>
    <div class="field"><label>الرقم الجامعي / رقم الطالب</label><input id="newStudentId" placeholder="مثال: 447xxxxxx"></div>
    <div class="field"><label>توزيع الروتيشنات لـ F1</label><textarea id="newStudentSchedule" rows="4" placeholder="اكتب الروتيشنات بالترتيب مفصولة بفواصل، مثل: PSCEMS, OR, OR, US ..."></textarea><div class="small">عدد أشهر F1: ${(MONTHS.F1||[]).length}. يمكن تركها فارغة وتعديلها لاحقًا.</div></div>
    <button class="btn green" onclick="saveNewStudent()">حفظ الطالب</button>
  `;
  document.getElementById("evalModal").className = "modal-backdrop open";
}
async function saveNewStudent(){
  if(!ensureFirebase()) return;
  const name = document.getElementById("newStudentName").value.trim();
  const nameEn = document.getElementById("newStudentNameEn").value.trim();
  const id = document.getElementById("newStudentId").value.trim();
  const schedText = document.getElementById("newStudentSchedule").value;
  if(!name || !id){ alert("اسم الطالب والرقم الجامعي مطلوبان."); return; }
  const docId = customKey("F1", id);
  await db.collection("customStudents").doc(docId).set({
    level:"F1", id, name, nameEn, schedule: parseScheduleInput("F1", schedText), active:true, createdAt: firebase.firestore.FieldValue.serverTimestamp(), source:"manual"
  }, {merge:true});
  closeModal(); setLevel("F1");
}
function editStudentSchedule(level, studentId){
  const student = studentById(level, studentId);
  if(!student){ alert("تعذر العثور على الطالب."); return; }
  const schedule = getStudentSchedule(level, student);
  document.getElementById("modalBody").innerHTML = `
    <h3>تعديل توزيع الروتيشنات</h3>
    <div class="grid2"><div><b>الطالب:</b><br>${escapeHtml(student.name)}<br><span class="small">${escapeHtml(student.id)}</span></div><div><b>المستوى:</b><br>${level}<br><span class="small">${(MONTHS[level]||[]).join(" - ")}</span></div></div>
    <div class="field"><label>الروتيشنات بالترتيب</label><textarea id="editStudentScheduleText" rows="5">${escapeHtml(scheduleToTextarea(level, schedule))}</textarea><div class="small">افصل بين الروتيشنات بفاصلة. عدد الأشهر: ${(MONTHS[level]||[]).length}</div></div>
    <button class="btn green" onclick="saveStudentSchedule('${level}','${jsStr(student.id)}')">حفظ التوزيع</button>
  `;
  document.getElementById("evalModal").className = "modal-backdrop open";
}
async function saveStudentSchedule(level, studentId){
  if(!ensureFirebase()) return;
  const student = studentById(level, studentId) || baseStudentById(level, studentId);
  if(!student){ alert("تعذر العثور على الطالب."); return; }
  const schedule = parseScheduleInput(level, document.getElementById("editStudentScheduleText").value);
  const docId = customKey(level, studentId);
  await db.collection("customStudents").doc(docId).set({
    level, id: student.id, name: student.name, nameEn: student.nameEn || "", schedule, active:true, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), source:"schedule-edit"
  }, {merge:true});
  closeModal();
}
async function promoteStudent(level, studentId){
  if(!ensureFirebase()) return;
  const target = nextLevel(level);
  if(!target){ alert("لا يوجد مستوى بعد F3."); return; }
  const student = studentById(level, studentId);
  if(!student){ alert("تعذر العثور على الطالب."); return; }
  const blankSchedule = scheduleBlank(target).join(", ");
  const schedText = prompt(`سيتم ترقية الطالب إلى ${target}.\nاكتب توزيع الروتيشنات للمستوى الجديد مفصولًا بفواصل، أو اتركه فارغًا للتعديل لاحقًا:`, blankSchedule);
  if(schedText === null) return;
  if(!confirm(`هل تريد نقل ${student.name} من ${level} إلى ${target}؟`)) return;
  const batch = db.batch();
  batch.set(db.collection("customStudents").doc(customKey(target, student.id)), {
    level: target, id: student.id, name: student.name, nameEn: student.nameEn || "", schedule: parseScheduleInput(target, schedText), active:true,
    promotedFrom: level, promotedAt: firebase.firestore.FieldValue.serverTimestamp(), source:"promotion"
  }, {merge:true});
  batch.set(db.collection("hiddenStudents").doc(hiddenKey(level, student.id)), {
    level, id: student.id, name: student.name, hidden:true, reason:"promoted", targetLevel:target, hiddenAt: firebase.firestore.FieldValue.serverTimestamp()
  }, {merge:true});
  await batch.commit();
  alert(`تمت ترقية الطالب إلى ${target}.`);
  setLevel(target);
}
async function deleteCustomStudent(level, studentId, name){
  if(!ensureFirebase()) return;
  if(!confirm(`حذف الطالب ${name} من ${level}؟`)) return;
  await db.collection("customStudents").doc(customKey(level, studentId)).delete();
}

initFirebase();
renderAll();

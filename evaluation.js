
const EXTERNAL_CRITERIA = [
  "Knowledge","History & Physical Exam","Judgment & Decisions","Emergency Care","Records & Reports",
  "Reliability & Discipline","Relations with Staff","Patients' Advocacy","Supervisory Skills","Ethics"
];
const INTERNAL_CRITERIA = [
  "Punctuality","Professionalism","Discipline and reliability","Relation to staff",
  "Knowledge of the teaching subject","Lab preparation",
  "Conducting the scenario (Effective use of simulation tools, alignment with objectives)",
  "Relevance/depth of teaching content aligned with objective (Interactive, Tech, etc.)",
  "Discussion during the activity","Contribution to development of new scenarios",
  "Contribution to meetings or admin tasks","Evaluation of the activity related to academic day",
  "Presentation of relevant literature","Commitment to research project progress"
];
let db = null;
let linkDoc = null;
let token = new URLSearchParams(location.search).get("token");

function displayRot(r){ return (window.FEMS_DATA.ROT_DISPLAY || {})[r] || r || ""; }
function safeId(v){ return String(v || "").replace(/[^\w\u0600-\u06FF-]+/g, "_"); }
function progressId(level, studentId, monthIdx, rotation){ return [level, studentId, monthIdx, safeId(rotation)].join("__"); }
function isFirebaseConfigured(){
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && !String(c.apiKey).includes("PUT_") && c.projectId && !String(c.projectId).includes("PUT_");
}
function showStatus(html, cls="notice"){ document.getElementById("statusBox").className = cls; document.getElementById("statusBox").innerHTML = html; }
async function init(){
  if(!token){ showStatus("الرابط غير صحيح: لا يوجد رمز تقييم.", "errbox"); return; }
  if(!isFirebaseConfigured()){ showStatus("لم يتم ربط Firebase بعد. يرجى التواصل مع إدارة البرنامج.", "errbox"); return; }
  try{
    firebase.initializeApp(window.FIREBASE_CONFIG);
    db = firebase.firestore();
    const snap = await db.collection("evaluationLinks").doc(token).get();
    if(!snap.exists){ showStatus("رابط التقييم غير موجود أو غير صالح.", "errbox"); return; }
    linkDoc = snap.data();
    if(linkDoc.used || linkDoc.status === "submitted"){
      showStatus("تم استخدام هذا الرابط مسبقًا. شكرًا لكم.", "successbox");
      return;
    }
    renderForm();
  }catch(e){
    console.error(e);
    showStatus("حدث خطأ أثناء تحميل الرابط: " + e.message, "errbox");
  }
}
function renderForm(){
  const isInternal = linkDoc.formType === "internal";
  document.getElementById("formTitle").textContent = isInternal ? "نموذج التقييم الداخلي" : "نموذج التقييم الخارجي";
  document.getElementById("evaluationDate").valueAsDate = new Date();
  const criteria = isInternal ? INTERNAL_CRITERIA : EXTERNAL_CRITERIA;
  let html = "";
  criteria.forEach((c, i) => {
    html += `<div class="criteria-row">
      <label>${i+1}. ${c}</label>
      <select class="scoreInput" data-criterion="${c.replace(/"/g,"&quot;")}" onchange="calcTotal()" required>
        <option value="">اختر</option>
        <option value="10">10 - Excellent / Outstanding</option>
        <option value="9">9</option><option value="8">8</option><option value="7">7</option><option value="6">6</option>
        <option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option>
        ${isInternal ? '<option value="NA">N/A - لا ينطبق</option>' : ''}
      </select>
    </div>`;
  });
  document.getElementById("criteriaBox").innerHTML = html;
  document.getElementById("statusBox").style.display = "none";
  document.getElementById("evaluationForm").style.display = "block";
  calcTotal();
}
function calcTotal(){
  const inputs = [...document.querySelectorAll(".scoreInput")];
  const nums = inputs.map(i => i.value).filter(v => v && v !== "NA").map(Number);
  let total = 0;
  if(linkDoc && linkDoc.formType === "internal"){
    total = nums.length ? Math.round((nums.reduce((a,b)=>a+b,0) / nums.length) * 10) : 0;
  }else{
    total = nums.reduce((a,b)=>a+b,0);
  }
  document.getElementById("totalScore").textContent = total;
  return total;
}
async function submitEvaluation(ev){
  ev.preventDefault();
  if(!db || !linkDoc){ return; }
  const score = calcTotal();
  const inputs = [...document.querySelectorAll(".scoreInput")];
  const scores = inputs.map(i => ({criterion: i.dataset.criterion, value: i.value}));
  if(scores.some(s => !s.value)){ alert("يرجى تعبئة جميع البنود."); return; }
  const payload = {
    token,
    formType: linkDoc.formType,
    level: linkDoc.level,
    studentId: linkDoc.studentId,
    studentName: linkDoc.studentName,
    monthIdx: linkDoc.monthIdx,
    month: linkDoc.month,
    rotation: linkDoc.rotation,
    rotationDisplay: linkDoc.rotationDisplay || displayRot(linkDoc.rotation),
    score,
    scores,
    evaluatorName: document.getElementById("evaluatorName").value.trim(),
    evaluatorTitle: document.getElementById("evaluatorTitle").value.trim(),
    evaluatorOrg: document.getElementById("evaluatorOrg").value.trim(),
    evaluatorEmail: document.getElementById("evaluatorEmail").value.trim(),
    evaluatorPhone: document.getElementById("evaluatorPhone").value.trim(),
    evaluationDate: document.getElementById("evaluationDate").value,
    paperUrl: document.getElementById("paperUrl").value.trim(),
    comments: document.getElementById("comments").value.trim(),
    userAgent: navigator.userAgent,
    submittedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const pid = [linkDoc.level, linkDoc.studentId, linkDoc.monthIdx, safeId(linkDoc.rotation)].join("__");
  try{
    await db.collection("evaluations").doc(token).set(payload);
    await db.collection("rotationProgress").doc(pid).set({
      ...payload,
      status: "submitted",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge: true});
    await db.collection("evaluationLinks").doc(token).update({
      used: true,
      status: "submitted",
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById("evaluationForm").style.display = "none";
    showStatus("تم إرسال التقييم بنجاح. شكرًا لكم.", "successbox");
  }catch(e){
    console.error(e);
    alert("تعذر إرسال التقييم: " + e.message);
  }
}
window.calcTotal = calcTotal;
window.submitEvaluation = submitEvaluation;
init();

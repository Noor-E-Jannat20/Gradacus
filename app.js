const APP_SCHEMA_VERSION = 2;
const CURRICULUM_DATA_VERSION = 'embedded-v1';

const firebaseConfig = {
  apiKey: "AIzaSyAG5Jez19bPq395Mf3dukdBP1jHZz71Nqs",
  authDomain: "gradacus-fd082.firebaseapp.com",
  projectId: "gradacus-fd082",
  storageBucket: "gradacus-fd082.firebasestorage.app",
  messagingSenderId: "160033318436",
  appId: "1:160033318436:web:2bdcd1bd7e33b5e0245ab1"
};
let auth = null, db = null;
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  auth = firebase.auth();
  db = firebase.firestore();
} catch (err) {
  console.error('Firebase failed to initialise:', err);
  document.getElementById('authError').textContent =
    'Could not load the sign-in service. Check your internet connection and reload the page.';
}
if (location.protocol === 'file:') {
  document.getElementById('authError').textContent =
    'Sign-in does not work when this page is opened as a local file. Open it through http(s), e.g. localhost or your hosting URL.';
}
let currentUser = null;

// Tab Switching Logic
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.page).classList.add('active');
  });
});

const GRADE_SCALE = [
  {min:97, letter:'A+', point:4.0},
  {min:90, letter:'A',  point:4.0},
  {min:85, letter:'A-', point:3.7},
  {min:80, letter:'B+', point:3.3},
  {min:75, letter:'B',  point:3.0},
  {min:70, letter:'B-', point:2.7},
  {min:65, letter:'C+', point:2.3},
  {min:60, letter:'C',  point:2.0},
  {min:57, letter:'C-', point:1.7},
  {min:55, letter:'D+', point:1.3},
  {min:52, letter:'D',  point:1.0},
  {min:50, letter:'D-', point:0.7},
  {min:-Infinity, letter:'F', point:0.0},
];

const GRADE_COLOR = {
  'A+':'#41ffb0','A':'#41ffb0','A-':'#4deeea','B+':'#4deeea','B':'#4deeea',
  'B-':'#9d7bff','C+':'#ffb84d','C':'#ffb84d','C-':'#ffb84d',
  'D+':'#ff8a4d','D':'#ff8a4d','D-':'#ff8a4d','F':'#ff4d6d'
};

function gradeFromLetter(letter){
  if (!letter) return null;
  return GRADE_SCALE.find(g => g.letter === letter) || null;
}

function defaultPlanner(){
  return {
    program: 'CSE',
    activeSemesterId: null,
    semesters: []
  };
}

let state = {
  schemaVersion: APP_SCHEMA_VERSION,
  curriculumVersion: CURRICULUM_DATA_VERSION,
  program: '136',
  priorCgpa: '',
  priorCredits: '',
  courses: [],
  planner: defaultPlanner(),
  customCourses: {}
};

function newCourse(code, credits, repeatOf){
  return {
    id: crypto.randomUUID(),
    code: code||'',
    credits: credits!=null?credits:3,
    grade: '',
    included: true,
    replaced: false,
    repeatOf: repeatOf || null
  };
}

const PROGRAM_LINKS = {
  '136': { href: 'https://www.bracu.ac.bd/avilable-program/bachelor-science-computer-science-engineering-cse', text: 'BRACU CSE program page ↗' },
  '124': { href: 'https://www.bracu.ac.bd/avilable-program/bachelor-science-computer-science-cs', text: 'BRACU CS program page ↗' }
};

function render(){
  document.getElementById('program').value = state.program;
  const pl = PROGRAM_LINKS[state.program] || PROGRAM_LINKS['136'];
  const linkEl = document.getElementById('programLink');
  linkEl.href = pl.href;
  linkEl.textContent = pl.text;
  document.getElementById('priorCgpa').value = state.priorCgpa;
  document.getElementById('priorCredits').value = state.priorCredits;

  const body = document.getElementById('courseBody');
  body.innerHTML = '';

  if (state.courses.length === 0){
    body.innerHTML = '<tr class="empty-row"><td colspan="6">No courses yet — add one to start building your CGPA.</td></tr>';
  }

  state.courses.forEach(c => {
    const tr = document.createElement('tr');
    if (!c.included || c.replaced) tr.classList.add('excluded');
    const grade = gradeFromLetter(c.grade);
    const pointHtml = grade
      ? `<span class="grade-pill" style="color:${GRADE_COLOR[grade.letter]}; border:1px solid ${GRADE_COLOR[grade.letter]}66; background:${GRADE_COLOR[grade.letter]}14;">${grade.point.toFixed(1)}</span>`
      : `<span class="grade-pill" style="color:#4a5178; border:1px solid var(--line);">—</span>`;

    const gradeOptions = ['<option value="">--</option>']
      .concat(GRADE_SCALE.map(g => `<option value="${g.letter}" ${c.grade===g.letter?'selected':''}>${g.letter} (${g.point.toFixed(1)})</option>`))
      .join('');

    const isRetake = !!c.repeatOf;
    const retakeTag = isRetake ? `<span class="retake-tag">retake</span>` : '';

    let actions = '';
    if (c.replaced){
      actions = `<button class="icon-btn text-btn revert" data-action="revert" data-id="${c.id}" title="Undo repeat — restore this attempt">Undo Repeat</button>`;
    } else {
      actions = `
        <button class="icon-btn text-btn" data-action="repeat" data-id="${c.id}" title="Repeat this course">Repeat</button>
        <button class="icon-btn danger" data-action="delete" data-id="${c.id}" title="Remove row">✕</button>
      `;
    }

    tr.innerHTML = `
      <td><input class="code-input mono code" type="text" data-field="code" data-id="${c.id}" value="${c.code}" placeholder="CSE101">${retakeTag}</td>
      <td><input class="credit-input mono" type="number" step="0.5" min="0" data-field="credits" data-id="${c.id}" value="${c.credits}"></td>
      <td><select class="grade-select mono" data-field="grade" data-id="${c.id}">${gradeOptions}</select></td>
      <td>${pointHtml}</td>
      <td>
        <input type="checkbox" data-field="included" data-id="${c.id}" ${c.included?'checked':''} ${c.replaced?'disabled':''} title="Temporarily exclude this course's GPA from the calculation">
      </td>
      <td>
        <div class="row-actions">${actions}</div>
      </td>
    `;
    body.appendChild(tr);
  });

  attachRowListeners();
  computeAndDisplay();
  if (typeof renderPlannerSummary === 'function' && document.getElementById('plannerCompleted')){
    renderPlannerSummary();
  }
  saveState();
}

function attachRowListeners(){
  document.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', onFieldChange);
    el.addEventListener('change', onFieldChange);
  });
  document.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', onRowAction);
  });
}

function onFieldChange(e){
  const id = e.target.dataset.id;
  const field = e.target.dataset.field;
  const course = state.courses.find(c => c.id === id);
  if (!course) return;
  if (field === 'included'){
    course.included = e.target.checked;
  } else {
    course[field] = e.target.value;
  }
  computeAndDisplay();
  saveState();
  if (field === 'grade') {
    renderGradePillOnly(id);
  }
}

function renderGradePillOnly(id){
  const course = state.courses.find(c => c.id === id);
  if (!course) return;
  const row = document.querySelector(`[data-id="${id}"][data-field="grade"]`).closest('tr');
  const grade = gradeFromLetter(course.grade);
  const pillCell = row.children[3];
  pillCell.innerHTML = grade
    ? `<span class="grade-pill" style="color:${GRADE_COLOR[grade.letter]}; border:1px solid ${GRADE_COLOR[grade.letter]}66; background:${GRADE_COLOR[grade.letter]}14;">${grade.point.toFixed(1)}</span>`
    : `<span class="grade-pill" style="color:#4a5178; border:1px solid var(--line);">—</span>`;
}

function onRowAction(e){
  const id = e.target.dataset.id;
  const action = e.target.dataset.action;
  const idx = state.courses.findIndex(c => c.id === id);
  if (idx === -1) return;
  const course = state.courses[idx];

  if (action === 'delete'){
    if (course.repeatOf){
      const original = state.courses.find(c => c.id === course.repeatOf);
      if (original){ original.replaced = false; original.included = true; }
    }
    state.courses.splice(idx, 1);
    render();
    showToast('Course removed');
  } else if (action === 'repeat'){
    course.replaced = true;
    course.included = false;
    const retake = newCourse(course.code, course.credits, course.id);
    state.courses.splice(idx + 1, 0, retake);
    render();
    showToast(`Retake row added for ${course.code || 'course'} — old attempt excluded`);
  } else if (action === 'revert'){
    state.courses = state.courses.filter(c => c.repeatOf !== course.id);
    course.replaced = false;
    course.included = true;
    render();
    showToast(`Repeat undone for ${course.code || 'course'} — original attempt restored`);
  }
}

// Single source of truth for CGPA + credits, used by BOTH tabs so they can never disagree.
// Only included, graded courses count; a grade of F earns no credits.
function computeStats(){
  const priorCgpa = parseFloat(state.priorCgpa);
  const priorCredits = parseFloat(state.priorCredits);
  const hasPrior = !isNaN(priorCgpa) && !isNaN(priorCredits) && priorCredits > 0;

  let qualityPoints = hasPrior ? priorCgpa * priorCredits : 0;
  let attemptedCredits = hasPrior ? priorCredits : 0;
  let earnedCredits = hasPrior ? priorCredits : 0;
  let tableActiveCredits = 0;

  state.courses.forEach(c => {
    if (!c.included || c.replaced) return;
    const credits = parseFloat(c.credits);
    if (isNaN(credits) || credits <= 0) return;
    const grade = gradeFromLetter(c.grade);
    if (!grade) return;
    qualityPoints += grade.point * credits;
    attemptedCredits += credits;
    tableActiveCredits += credits;
    if (grade.point > 0) earnedCredits += credits;
  });

  const cgpa = attemptedCredits > 0 ? (qualityPoints / attemptedCredits) : null;
  return { cgpa, earnedCredits, tableActiveCredits };
}

function computeAndDisplay(){
  const { cgpa, earnedCredits, tableActiveCredits } = computeStats();

  const cgpaEl = document.getElementById('cgpaValue');
  const mirrorEl = document.getElementById('statCgpaMirror');
  if (cgpa === null){
    cgpaEl.textContent = '--';
    cgpaEl.classList.add('dim');
    mirrorEl.textContent = '--';
  } else {
    cgpaEl.textContent = cgpa.toFixed(2);
    cgpaEl.classList.remove('dim');
    mirrorEl.textContent = cgpa.toFixed(2);
  }

  document.getElementById('statCourseCount').textContent = state.courses.length;
  document.getElementById('statTableCredits').textContent = tableActiveCredits;

  const required = parseFloat(state.program);
  const remaining = Math.max(required - earnedCredits, 0);
  const pct = Math.min(100, Math.round((earnedCredits / required) * 100));
  document.getElementById('creditsEarned').textContent = `${round1(earnedCredits)} / ${required}`;
  document.getElementById('gradFill').style.width = pct + '%';
  document.getElementById('gradPct').textContent = pct + '%';
  document.getElementById('gradRemainText').textContent = `${round1(remaining)} credits left`;
  document.getElementById('coursesLeft').textContent = remaining <= 0 ? '0 🎓' : Math.ceil(remaining / 3);

  // keep the planner tab in sync on every edit, not only on full re-renders
  renderPlannerSummary();
}

function round1(n){ return Math.round(n*10)/10; }

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function buildScaleTable(){
  const body = document.getElementById('scaleBody');
  const rows = [
    ['97 – 100','A+','4.0'],['90 – <97','A','4.0'],['85 – <90','A-','3.7'],
    ['80 – <85','B+','3.3'],['75 – <80','B','3.0'],['70 – <75','B-','2.7'],
    ['65 – <70','C+','2.3'],['60 – <65','C','2.0'],['57 – <60','C-','1.7'],
    ['55 – <57','D+','1.3'],['52 – <55','D','1.0'],['50 – <52','D-','0.7'],
    ['< 50','F','0.0'],
  ];
  body.innerHTML = rows.map(r => `<tr><td class="mono">${r[0]}</td><td style="color:${GRADE_COLOR[r[1]]}">${r[1]}</td><td class="mono">${r[2]}</td></tr>`).join('');
}

// ---- BRAC University course data ----
const COURSE_DB = {
  // Foundation / General Education
  ENG101:{name:'English Fundamentals', credits:3},
  ENG102:{name:'English Composition', credits:3},
  MAT110:{name:'Mathematics I', credits:3},
  MAT120:{name:'Mathematics II', credits:3},
  MAT215:{name:'Mathematics III', credits:3},
  MAT216:{name:'Mathematics IV', credits:3},
  PHY111:{name:'Principles of Physics I', credits:3},
  PHY112:{name:'Principles of Physics II', credits:3},
  STA201:{name:'Elements of Statistics and Probability', credits:3},
  DEV101:{name:'Bangladesh Studies', credits:3},
  HUM103:{name:'Ethics and Culture', credits:3},
  // CSE department courses
  CSE101:{name:'Introduction to Computer Science', credits:3},
  CSE110:{name:'Programming Language I', credits:3},
  CSE111:{name:'Programming Language II', credits:3},
  CSE220:{name:'Data Structures', credits:3},
  CSE221:{name:'Algorithms', credits:3},
  CSE230:{name:'Discrete Mathematics', credits:3},
  CSE250:{name:'Circuits and Electronics', credits:3},
  CSE251:{name:'Electronic Devices and Circuits', credits:3},
  CSE260:{name:'Digital Logic Design', credits:3},
  CSE310:{name:'Object-Oriented Programming', credits:3},
  CSE320:{name:'Data Communications', credits:3},
  CSE321:{name:'Operating Systems', credits:3},
  CSE330:{name:'Numerical Methods', credits:3},
  CSE331:{name:'Automata and Computability', credits:3},
  CSE340:{name:'Computer Architecture', credits:3},
  CSE341:{name:'Microprocessors', credits:3},
  CSE342:{name:'Computer Systems Engineering', credits:3},
  CSE350:{name:'Digital Electronics and Pulse Techniques', credits:3},
  CSE360:{name:'Computer Interfacing', credits:3},
  CSE370:{name:'Database Systems', credits:3},
  CSE371:{name:'Management Information Systems', credits:3},
  CSE390:{name:'Technical Communication', credits:3},
  CSE391:{name:'Programming for the Internet', credits:3},
  CSE392:{name:'Signals and Systems', credits:3},
  CSE400:{name:'Final Year Design Project', credits:4},
  CSE410:{name:'Advanced Programming in UNIX', credits:3},
  CSE419:{name:'Programming Languages & Competitive Programming', credits:3},
  CSE420:{name:'Compiler Design', credits:3},
  CSE421:{name:'Computer Networks', credits:3},
  CSE422:{name:'Artificial Intelligence', credits:3},
  CSE423:{name:'Computer Graphics', credits:3},
  CSE424:{name:'Pattern Recognition', credits:3},
  CSE425:{name:'Neural Networks', credits:3},
  CSE426:{name:'Advanced Algorithms', credits:3},
  CSE427:{name:'Machine Learning', credits:3},
  CSE428:{name:'Image Processing', credits:3},
  CSE429:{name:'Basic Multimedia Theory', credits:3},
  CSE430:{name:'Digital Signal Processing', credits:3},
  CSE431:{name:'Natural Language Processing', credits:3},
  CSE432:{name:'Speech Recognition and Synthesis', credits:3},
  CSE460:{name:'VLSI Design', credits:3},
  CSE461:{name:'Introduction to Robotics', credits:3},
  CSE462:{name:'Fault-Tolerant Systems', credits:3},
  CSE470:{name:'Software Engineering', credits:3},
  CSE471:{name:'Systems Analysis and Design', credits:3},
  CSE472:{name:'Human-Computer Interface', credits:3},
  CSE473:{name:'Financial Engineering & Technology', credits:3},
  CSE474:{name:'Simulation and Modeling', credits:3},
  CSE490:{name:'Special Topics', credits:3},
  CSE491:{name:'Independent Study', credits:3},
};

const FOUNDATION_CODES = ['ENG101','ENG102','MAT110','MAT120','MAT215','MAT216','PHY111','PHY112','STA201','HUM103'];

const PROGRAM_POOLS = {
  CSE: {
    core: ['CSE110','CSE111','CSE220','CSE221','CSE230','CSE250','CSE251','CSE260','CSE320','CSE321','CSE330','CSE331','CSE340','CSE341','CSE350','CSE360','CSE370','CSE400','CSE420','CSE421','CSE422','CSE423','CSE460','CSE461','CSE470','CSE471'],
    elective: ['CSE101','CSE310','CSE342','CSE371','CSE390','CSE391','CSE392','CSE410','CSE419','CSE424','CSE425','CSE426','CSE427','CSE428','CSE429','CSE430','CSE431','CSE432','CSE462','CSE472','CSE473','CSE474','CSE490','CSE491'],
  },
  CS: {
    core: ['CSE110','CSE111','CSE220','CSE221','CSE230','CSE260','CSE321','CSE330','CSE331','CSE340','CSE370','CSE400','CSE420','CSE421','CSE422','CSE423','CSE470'],
    elective: ['CSE250','CSE251','CSE310','CSE320','CSE341','CSE342','CSE350','CSE360','CSE390','CSE391','CSE392','CSE410','CSE419','CSE424','CSE425','CSE426','CSE427','CSE428','CSE429','CSE430','CSE431','CSE432','CSE460','CSE461','CSE462','CSE471','CSE472','CSE473','CSE474','CSE490','CSE491'],
  }
};

// Maps the CGPA-table "Degree" select (136 / 124 credit programs) onto the
// same course pools used by the planner, and adds any of that program's
// foundation + core courses that aren't already on the table. Existing rows
// (and any grades already entered) are left untouched — this only fills in
// what's missing, it never overwrites or removes anything.
function defaultCourseCodesForProgram(programValue){
  const poolKey = programValue === '124' ? 'CS' : 'CSE';
  const pool = PROGRAM_POOLS[poolKey];
  if (!pool) return [];
  return [...FOUNDATION_CODES, ...pool.core];
}

function loadDefaultCoursesForProgram(programValue){
  const existing = new Set(state.courses.map(c => c.code));
  let added = 0;
  defaultCourseCodesForProgram(programValue).forEach(code => {
    if (existing.has(code)) return;
    const info = COURSE_DB[code];
    if (!info) return;
    state.courses.push(newCourse(code, info.credits));
    existing.add(code);
    added++;
  });
  return added;
}

function getCourseInfo(code) {
  if (state.customCourses && state.customCourses[code]) {
    return state.customCourses[code];
  }
  if (COURSE_DB[code]) {
    return { code: code, name: COURSE_DB[code].name, credits: COURSE_DB[code].credits, tag: 'course' };
  }
  return null;
}

function getPoolForProgram(program){
  const pools = PROGRAM_POOLS[program];
  const items = [];
  pools.core.forEach(code => items.push({code, tag:'core'}));
  pools.elective.forEach(code => items.push({code, tag:'elective'}));
  FOUNDATION_CODES.forEach(code => items.push({code, tag:'foundation'}));
  
  if (state.customCourses) {
    Object.keys(state.customCourses).forEach(id => {
      items.push({code: id, tag:'custom'});
    });
  }
  
  return items;
}


function freshState(){
  return { schemaVersion: APP_SCHEMA_VERSION, curriculumVersion: CURRICULUM_DATA_VERSION, program:'136', priorCgpa:'', priorCredits:'', courses:[], planner: defaultPlanner(), customCourses: {} };
}

// Saving is blocked until the user's data has loaded successfully, so a failed
// load can never overwrite their cloud data with an empty/default state.
let stateLoaded = false;
let saveTimer = null;
let pendingSaveUid = null;

function setSyncStatus(text, cls=''){
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'sync-status' + (cls ? ' ' + cls : '');
}

function saveState(){
  if (!currentUser || !stateLoaded) return;
  clearTimeout(saveTimer);
  pendingSaveUid = currentUser.uid;
  setSyncStatus('Saving…', 'saving');
  saveTimer = setTimeout(flushSave, 500);
}

async function flushSave(){
  clearTimeout(saveTimer);
  if (!pendingSaveUid || !db) return;
  const uid = pendingSaveUid;
  pendingSaveUid = null;
  try{
    state.schemaVersion = APP_SCHEMA_VERSION;
    state.curriculumVersion = CURRICULUM_DATA_VERSION;
    await db.collection('users').doc(uid).set(
      { data: JSON.stringify(state) },
      { merge: true }
    );
    setSyncStatus('Saved ✓', 'saved');
  } catch(err){
    console.error('Save failed:', err);
    setSyncStatus('Not saved', 'error');
    showToast('Could not save — check your connection');
  }
}

// Don't lose the last few edits when the tab is closed or hidden.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});

// Returns true if the user's data was loaded (or they are a genuinely new account).
async function loadState(){
  if (!currentUser) return false;
  try{
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().data){
      const parsed = JSON.parse(doc.data().data);
      if (parsed && Array.isArray(parsed.courses)){
        parsed.schemaVersion = APP_SCHEMA_VERSION;
        parsed.curriculumVersion = parsed.curriculumVersion || CURRICULUM_DATA_VERSION;
        if (!parsed.planner || !Array.isArray(parsed.planner.semesters)){
          parsed.planner = defaultPlanner();
        }
        if (!parsed.customCourses) {
          parsed.customCourses = {};
        } else {
          // migrate old custom courses that used code as key
          Object.keys(parsed.customCourses).forEach(k => {
             if (!parsed.customCourses[k].isCustom) {
                 parsed.customCourses[k].isCustom = true;
                 parsed.customCourses[k].code = k;
                 parsed.customCourses[k].tag = 'custom';
             }
          });
        }
        state = parsed;
        return true;
      }
    }
    // No saved document: brand-new account. Start with the default degree's courses.
    state = freshState();
    loadDefaultCoursesForProgram(state.program);
    return true;
  } catch(err){
    console.error('Load failed:', err);
    state = freshState();
    return false;
  }
}

// ---- semester planner ----
function activeSemester(){
  return state.planner.semesters.find(s => s.id === state.planner.activeSemesterId);
}

function allPlacedCodes(){
  const set = new Set();
  state.planner.semesters.forEach(s => s.codes.forEach(c => set.add(c)));
  return set;
}

function renderPlanner(){
  document.getElementById('plannerProgram').value = state.planner.program;
  renderSemesterTabs();
  renderSemesterCard();
  renderPool();
  renderPlannerSummary();
}

function renderSemesterTabs(){
  const wrap = document.getElementById('semesterTabs');
  wrap.innerHTML = '';
  state.planner.semesters.forEach(sem => {
    const total = sem.codes.reduce((sum, c) => {
      const info = getCourseInfo(c);
      return sum + (info?.credits || 0);
    }, 0);
    const tab = document.createElement('button');
    tab.className = 'sem-tab' + (sem.id === state.planner.activeSemesterId ? ' active' : '');
    tab.innerHTML = `${sem.label} <span class="credits">${total}cr</span>`;
    tab.addEventListener('click', () => { state.planner.activeSemesterId = sem.id; renderPlanner(); saveState(); });
    wrap.appendChild(tab);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'add-sem-btn';
  addBtn.textContent = '+ Add semester';
  addBtn.addEventListener('click', () => {
    let defaultLabel = "Semester " + (state.planner.semesters.length + 1);
    if(state.planner.semesters.length === 0) defaultLabel = "Semester 1";

    const id = crypto.randomUUID();
    state.planner.semesters.push({ id, label: defaultLabel, codes: [] });
    state.planner.activeSemesterId = id;
    renderPlanner();
    saveState();

    // Jump straight into the inline rename field so the user can type
    // the real name immediately — no popup involved.
    setTimeout(() => {
      const input = document.getElementById('semLabelInput');
      if (input){ input.focus(); input.select(); }
    }, 50);
  });
  wrap.appendChild(addBtn);
}

function removeSemester(id){
  const sems = state.planner.semesters;
  const idx = sems.findIndex(s => s.id === id);
  if (idx === -1) return;
  const [removed] = sems.splice(idx, 1);
  if (state.planner.activeSemesterId === id){
    const next = sems[idx] || sems[idx - 1] || null;
    state.planner.activeSemesterId = next ? next.id : null;
  }
  renderPlanner();
  saveState();
  showToast(`Removed “${removed.label || 'semester'}”`);
}

function renderSemesterCard(){
  const sem = activeSemester();
  const card = document.getElementById('semesterCard');
  if (!sem){ 
    card.innerHTML = `<div class="semester-empty" style="padding:40px 0;">No semester selected. Click "+ Add semester" to start planning.</div>`;
    return; 
  }

  const total = sem.codes.reduce((sum, c) => {
    const info = getCourseInfo(c);
    return sum + (info?.credits || 0);
  }, 0);
  
  const totalClass = total > 18 ? 'over' : (total >= 12 && total <= 18 ? 'ok' : 'warn');

  let rows = '';
  if (sem.codes.length === 0){
    rows = `<div class="semester-empty">No courses yet — add some from the list on the left.</div>`;
  } else {
    rows = sem.codes.map((codeId, idx) => {
      const c = getCourseInfo(codeId);
      
      if (c && c.isCustom) {
        return `
          <div class="sem-course-row">
            <div style="display:flex; gap:8px; flex:1; align-items:center;">
              <input class="custom-edit code-input mono" data-field="code" data-id="${codeId}" value="${c.code}" placeholder="Code">
              <input class="custom-edit name-input" data-field="name" data-id="${codeId}" value="${c.name}" placeholder="Course Name">
              <input class="custom-edit credit-input mono" data-field="credits" data-id="${codeId}" type="number" step="0.5" min="0" value="${c.credits}">
            </div>
            <div class="sem-course-actions" style="margin-left:8px;">
              <button class="icon-btn" data-planner-action="up" data-code="${codeId}" ${idx===0?'disabled':''} title="Move up">↑</button>
              <button class="icon-btn" data-planner-action="down" data-code="${codeId}" ${idx===sem.codes.length-1?'disabled':''} title="Move down">↓</button>
              <button class="icon-btn danger" data-planner-action="remove" data-code="${codeId}" title="Remove from semester">✕</button>
            </div>
          </div>`;
      } else {
        return `
          <div class="sem-course-row">
            <div>
              <span class="code">${c ? c.code : codeId}</span>
              <span class="name">${c ? c.name : 'Unknown course'}</span>
            </div>
            <div class="sem-course-actions">
              <button class="icon-btn" data-planner-action="up" data-code="${codeId}" ${idx===0?'disabled':''} title="Move up">↑</button>
              <button class="icon-btn" data-planner-action="down" data-code="${codeId}" ${idx===sem.codes.length-1?'disabled':''} title="Move down">↓</button>
              <button class="icon-btn danger" data-planner-action="remove" data-code="${codeId}" title="Remove from semester">✕</button>
            </div>
          </div>`;
      }
    }).join('');
  }

  card.innerHTML = `
    <div class="semester-card-head">
      <input class="rename-input" id="semLabelInput" value="${sem.label}" title="Rename this semester">
      <div class="head-right">
        <span class="credit-total ${totalClass}">${total} credits</span>
        <button class="icon-btn text-btn danger" id="removeSemBtn" title="Delete this semester (courses go back to the list)">Remove semester</button>
      </div>
    </div>
    ${rows}
  `;

  // Two-step remove: first click arms it, second click (within 3s) confirms.
  // Empty semesters are removed immediately.
  const removeBtn = document.getElementById('removeSemBtn');
  let armed = false, armTimer = null;
  removeBtn.addEventListener('click', () => {
    if (sem.codes.length > 0 && !armed){
      armed = true;
      removeBtn.textContent = 'Click again to confirm';
      removeBtn.classList.add('armed');
      armTimer = setTimeout(() => {
        armed = false;
        removeBtn.textContent = 'Remove semester';
        removeBtn.classList.remove('armed');
      }, 3000);
      return;
    }
    clearTimeout(armTimer);
    removeSemester(sem.id);
  });

  document.getElementById('semLabelInput').addEventListener('input', e => {
    sem.label = e.target.value;
    renderSemesterTabs();
    saveState();
  });
  
  // Attach event listeners for inline custom course edits
  card.querySelectorAll('.custom-edit').forEach(input => {
    input.addEventListener('input', e => {
      const id = e.target.dataset.id;
      const field = e.target.dataset.field;
      let val = e.target.value;
      if (field === 'credits') val = parseFloat(val) || 0;
      
      if (state.customCourses[id]) {
        state.customCourses[id][field] = val;
        saveState();
        
        if (field === 'credits') {
            renderSemesterTabs(); 
            renderPlannerSummary();
            const currentSem = activeSemester();
            const newTotal = currentSem.codes.reduce((sum, cId) => sum + (getCourseInfo(cId)?.credits || 0), 0);
            const headerTotal = card.querySelector('.credit-total');
            if (headerTotal) {
                headerTotal.textContent = newTotal + ' credits';
                headerTotal.className = 'credit-total ' + (newTotal > 18 ? 'over' : (newTotal >= 12 && newTotal <= 18 ? 'ok' : 'warn'));
            }
        }
        
        // Render the pool to reflect the name/code changes there
        renderPool(); 
      }
    });
  });

  card.querySelectorAll('[data-planner-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const action = btn.dataset.plannerAction;
      const idx = sem.codes.indexOf(code);
      if (action === 'remove'){
        sem.codes.splice(idx, 1);
      } else if (action === 'up' && idx > 0){
        [sem.codes[idx-1], sem.codes[idx]] = [sem.codes[idx], sem.codes[idx-1]];
      } else if (action === 'down' && idx < sem.codes.length - 1){
        [sem.codes[idx+1], sem.codes[idx]] = [sem.codes[idx], sem.codes[idx+1]];
      }
      renderPlanner();
      saveState();
    });
  });
}

function renderPool(){
  const search = (document.getElementById('poolSearch').value || '').trim().toLowerCase();
  const category = document.getElementById('poolCategory').value;
  const sort = document.getElementById('poolSort').value;
  const placed = allPlacedCodes();

  let items = getPoolForProgram(state.planner.program);
  
  if (category !== 'all') {
    items = items.filter(i => i.tag === category);
  }
  
  if (search){
    items = items.filter(i => {
      const info = getCourseInfo(i.code);
      const displayCode = (info?.code || i.code).toLowerCase();
      return displayCode.includes(search) || (info && info.name.toLowerCase().includes(search));
    });
  }
  
  items.sort((a, b) => {
    if (sort === 'name') return (getCourseInfo(a.code)?.name || '').localeCompare(getCourseInfo(b.code)?.name || '');
    return a.code.localeCompare(b.code);
  });

  const list = document.getElementById('poolList');
  if (items.length === 0){
    list.innerHTML = `<div class="pool-item"><span class="name">No courses match.</span></div>`;
    return;
  }

  list.innerHTML = items.map(i => {
    const info = getCourseInfo(i.code) || { name:'Unknown', credits:3, code: i.code };
    const displayCode = info.code || i.code;
    const isPlaced = placed.has(i.code);
    return `
      <div class="pool-item ${isPlaced ? 'placed' : ''}">
        <div class="info">
          <span class="code">${displayCode}</span>
          <span class="tag ${i.tag}">${i.tag}</span>
          <span class="credit-badge">${info.credits}cr</span>
          <div class="name">${info.name}</div>
        </div>
        <div class="pool-actions">
          <button class="btn small" data-add-code="${i.code}" ${isPlaced ? 'disabled' : ''}>${isPlaced ? 'Added' : '+ Add'}</button>
          ${i.tag === 'custom' ? `<button class="icon-btn text-btn danger" data-delete-custom="${i.code}" title="Delete this custom course">Delete</button>` : ''}
        </div>
      </div>`;
  }).join('');

  // Two-step delete: first click arms the button, second click (within 3s) confirms.
  list.querySelectorAll('[data-delete-custom]').forEach(btn => {
    let armed = false, timer = null;
    btn.addEventListener('click', () => {
      if (!armed){
        armed = true;
        btn.textContent = 'Confirm?';
        btn.classList.add('armed');
        timer = setTimeout(() => {
          armed = false;
          btn.textContent = 'Delete';
          btn.classList.remove('armed');
        }, 3000);
        return;
      }
      clearTimeout(timer);
      deleteCustomCourse(btn.dataset.deleteCustom);
    });
  });

  list.querySelectorAll('[data-add-code]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sem = activeSemester();
      if (!sem) {
        showToast("Please add or select a semester first.");
        return;
      }
      const code = btn.dataset.addCode;
      if (!sem.codes.includes(code)){
        sem.codes.push(code);
        renderPlanner();
        saveState();
      }
    });
  });
}

// Delete a custom course entirely (also pulls it out of any semester it was placed in).
function deleteCustomCourse(id){
  const info = state.customCourses && state.customCourses[id];
  if (!info) return;
  delete state.customCourses[id];
  state.planner.semesters.forEach(sem => {
    sem.codes = sem.codes.filter(c => c !== id);
  });
  renderPlanner();
  saveState();
  showToast(`Deleted custom course ${info.code || ''}`.trim());
}

// Add Custom Course Logic
document.getElementById('addCustomCourseBtn').addEventListener('click', () => {
  const sem = activeSemester();
  if (!sem) {
    showToast("Please add or select a semester first.");
    return;
  }
  
  if(!state.customCourses) state.customCourses = {};
  
  const id = 'CUST_' + crypto.randomUUID();
  state.customCourses[id] = { code: 'CUSTOM', name: 'Click here to edit name', credits: 3, tag: 'custom', isCustom: true };
  
  sem.codes.push(id);
  
  // Refresh the planner view to show the new inline editable inputs in the active semester
  renderPlanner();
  saveState();
  
  // Auto-focus the new course code input if possible
  setTimeout(() => {
    const newInput = document.querySelector(`.custom-edit.code-input[data-id="${id}"]`);
    if (newInput) {
        newInput.focus();
        newInput.select();
    }
  }, 50);
});

function renderPlannerSummary(){
  const completed = computeStats().earnedCredits;

  const planned = state.planner.semesters.reduce((sum, sem) =>
    sum + sem.codes.reduce((s2, c) => {
      const info = getCourseInfo(c);
      return s2 + (info?.credits || 0);
    }, 0), 0);

  const required = state.planner.program === 'CSE' ? 136 : 124;
  const remaining = Math.max(required - completed - planned, 0);

  const completedEl = document.getElementById('plannerCompleted');
  if (!completedEl) return;
  completedEl.textContent = round1(completed);
  document.getElementById('plannerPlanned').textContent = round1(planned);
  document.getElementById('plannerRemaining').textContent = `${round1(remaining)} / ${required}`;
}

document.getElementById('plannerProgram').addEventListener('change', e => {
  state.planner.program = e.target.value;
  renderPlanner();
  saveState();
});
document.getElementById('poolSearch').addEventListener('input', renderPool);
document.getElementById('poolCategory').addEventListener('change', renderPool);
document.getElementById('poolSort').addEventListener('change', renderPool);


// Swap default courses when the degree changes. Only rows that are clearly
// untouched defaults of the OLD degree (no grade, still included, not part of a
// repeat) and absent from the NEW degree are removed. Everything else stays.
function syncCoursesToProgram(oldValue, newValue){
  const oldCodes = new Set(defaultCourseCodesForProgram(oldValue));
  const newCodes = new Set(defaultCourseCodesForProgram(newValue));
  const before = state.courses.length;
  state.courses = state.courses.filter(c => {
    const untouched = !c.grade && c.included && !c.replaced && !c.repeatOf;
    return !(untouched && oldCodes.has(c.code) && !newCodes.has(c.code));
  });
  const removed = before - state.courses.length;
  const added = loadDefaultCoursesForProgram(newValue);
  return { added, removed };
}

document.getElementById('program').addEventListener('change', e => {
  const oldProgram = state.program;
  const newProgram = e.target.value;
  if (oldProgram !== newProgram && !confirm('Switch degree? Untouched default courses that are not part of the new degree may be removed. Courses with grades, repeats, or custom entries will be kept.')) {
    e.target.value = oldProgram;
    return;
  }
  state.program = newProgram;
  const { added, removed } = syncCoursesToProgram(oldProgram, state.program);
  render();
  saveState();
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  showToast(parts.length ? `Degree switched — ${parts.join(', ')}` : 'Degree switched');
});

document.getElementById('loadDefaultCoursesBtn').addEventListener('click', () => {
  const added = loadDefaultCoursesForProgram(state.program);
  render();
  saveState();
  showToast(added ? `Added ${added} missing course${added===1?'':'s'} for this degree` : 'All default courses for this degree are already on the table');
});
document.getElementById('priorCgpa').addEventListener('input', e => { state.priorCgpa = e.target.value; computeAndDisplay(); saveState(); });
document.getElementById('priorCredits').addEventListener('input', e => { state.priorCredits = e.target.value; computeAndDisplay(); saveState(); });

document.getElementById('addCourseBtn').addEventListener('click', () => {
  state.courses.push(newCourse('', 3));
  render();
  const inputs = document.querySelectorAll('.code-input');
  if (inputs.length) inputs[inputs.length-1].focus();
});

document.getElementById('scaleToggle').addEventListener('click', (e) => {
  const table = document.getElementById('scaleTable');
  table.classList.toggle('open');
  e.target.textContent = table.classList.contains('open') ? 'hide grading scale' : 'show grading scale';
});

document.addEventListener('input', (e) => {
  if (e.target.dataset && e.target.dataset.field === 'code'){
    const id = e.target.dataset.id;
    const course = state.courses.find(c => c.id === id);
    if (course){
      const code = String(e.target.value || '').trim().toUpperCase();
      const info = COURSE_DB[code] || (state.customCourses || {})[code];
      if (info && Number(info.credits) > 0 && Number(course.credits) !== Number(info.credits)){
        course.credits = info.credits;
        const creditBox = document.querySelector(`#courseBody [data-field="credits"][data-id="${id}"]`);
        if (creditBox) creditBox.value = info.credits;
        computeAndDisplay();
        saveState();
      }
    }
  }
});

function exportState(){
  const payload = {
    app: 'Academic Console',
    schemaVersion: APP_SCHEMA_VERSION,
    curriculumVersion: state.curriculumVersion || CURRICULUM_DATA_VERSION,
    exportedAt: new Date().toISOString(),
    data: state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `academic-console-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importStateFile(file){
  const raw = await file.text();
  const parsed = JSON.parse(raw);
  const incoming = parsed && parsed.data ? parsed.data : parsed;
  if (!incoming || !Array.isArray(incoming.courses) || !incoming.planner) throw new Error('Invalid Academic Console backup');
  if (!confirm('Import this backup and replace the current data? This cannot be undone.')) return;
  state = incoming;
  state.schemaVersion = APP_SCHEMA_VERSION;
  state.curriculumVersion = state.curriculumVersion || CURRICULUM_DATA_VERSION;
  if (!state.customCourses) state.customCourses = {};
  if (!state.planner.semesters) state.planner = defaultPlanner();
  render(); renderPlanner(); if (window.dlRender) dlRender();
  saveState();
  showToast('Backup imported');
}

document.getElementById('exportBtn').addEventListener('click', exportState);
document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { await importStateFile(file); } catch(err) { console.error(err); showToast('Import failed — invalid backup file'); }
});

let authMode = 'login';

function setAuthMessage(msg, ok){
  const el = document.getElementById('authError');
  el.textContent = msg || '';
  el.classList.toggle('ok', !!ok);
}

function setAuthMode(mode){
  authMode = mode;
  document.getElementById('authSubmit').textContent = mode === 'login' ? 'Log in' : 'Sign up';
  document.getElementById('authSub').textContent = mode === 'login'
    ? 'Log in to load your saved data.'
    : 'Create an account to save your CGPA data to the cloud.';
  document.getElementById('authSwitchText').textContent = mode === 'login'
    ? "Don't have an account?"
    : 'Already have an account?';
  document.getElementById('authSwitchBtn').textContent = mode === 'login' ? 'Sign up' : 'Log in';
  document.getElementById('authPassword').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  document.getElementById('authForgot').style.display = mode === 'login' ? 'block' : 'none';
  setAuthMessage('');
}

document.getElementById('authSwitchBtn').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'signup' : 'login');
});

async function submitAuth(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const submitBtn = document.getElementById('authSubmit');
  setAuthMessage('');

  if (!auth){
    setAuthMessage('The sign-in service failed to load. Check your connection and reload the page.');
    return;
  }
  if (!email || !password){
    setAuthMessage('Enter both an email and a password.');
    return;
  }
  if (authMode === 'signup' && password.length < 6){
    setAuthMessage('Password should be at least 6 characters.');
    return;
  }

  submitBtn.disabled = true;
  try{
    if (authMode === 'login'){
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
  } catch(err){
    console.error('Auth error:', err);
    setAuthMessage(friendlyAuthError(err));
  } finally {
    submitBtn.disabled = false;
  }
}

document.getElementById('authSubmit').addEventListener('click', submitAuth);
['authEmail','authPassword'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); submitAuth(); }
  });
});

document.getElementById('authForgotBtn').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  if (!auth){ setAuthMessage('The sign-in service failed to load. Reload the page.'); return; }
  if (!email){ setAuthMessage('Enter your email above first, then click "Forgot password?".'); return; }
  try{
    await auth.sendPasswordResetEmail(email);
    setAuthMessage('Password reset email sent — check your inbox (and spam).', true);
  } catch(err){
    console.error('Reset error:', err);
    setAuthMessage(friendlyAuthError(err));
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await flushSave();          // don't drop edits made in the last half-second
  await auth.signOut();
});

document.getElementById('retryLoadBtn').addEventListener('click', () => { if (auth && auth.currentUser) enterApp(auth.currentUser); });

function friendlyAuthError(err){
  const map = {
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/missing-email': 'Enter your email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account with that email already exists — try logging in instead.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': "Can't reach the sign-in service. Check your internet connection.",
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled for this Firebase project.',
    'auth/unauthorized-domain': "This site's domain isn't in Firebase's authorised domains list.",
    'auth/invalid-api-key': 'The Firebase API key is invalid.',
    'auth/operation-not-supported-in-this-environment': 'Sign-in needs the page to be served over http(s) with browser storage enabled — it will not work from a local file.',
  };
  return map[err && err.code] || `Something went wrong (${(err && err.code) || 'unknown error'}). Please try again.`;
}

buildScaleTable();

let authSeq = 0;

// Load the user's data first, and only then reveal the app, so one account's
// data is never briefly shown to (or saved under) another.
async function enterApp(user){
  const seq = ++authSeq;
  currentUser = user;
  stateLoaded = false;
  const ok = await loadState();
  if (seq !== authSeq || currentUser !== user) return;   // user changed while loading
  stateLoaded = ok;
  if (window.dlEnsure) dlEnsure();

  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('loadBanner').style.display = ok ? 'none' : 'flex';
  setSyncStatus(ok ? 'Saved ✓' : 'Not saved', ok ? 'saved' : 'error');
  setAuthMessage('');
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  render();
  renderPlanner();
  if (window.dlRender) dlRender();
}

if (auth){
  auth.onAuthStateChanged(user => {
    if (user){
      enterApp(user);
    } else {
      authSeq++;
      currentUser = null;
      stateLoaded = false;
      setSyncStatus('Not synced');
      state = freshState();
      document.getElementById('loadBanner').style.display = 'none';
      document.getElementById('authOverlay').style.display = 'flex';
      document.getElementById('appRoot').style.display = 'none';
    }
  });
}

(function(){
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BASE = ['Assignment','Quiz','Exam','Project','Presentation','Other'];
const PRIO = { low:{l:'Low',c:'var(--green)',w:0}, medium:{l:'Medium',c:'var(--amber)',w:1}, high:{l:'High',c:'var(--red)',w:2} };
const COLORS = ['#4deeea','#ff3e9a','#9d7bff','#ffb84d','#41ffb0','#ff7a59','#5aa9ff','#e0e36a'];
const PRESETS = [10080,4320,1440,720,60];
const WD = ['sun','mon','tue','wed','thu','fri','sat'];
const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const DAY = 864e5;
let F = { course:'', type:'', prio:'', status:'', sort:'due', bucket:'active', showDone:false };
let calMonth = new Date(); calMonth.setDate(1);
let calSel = null;

const D = () => state.deadlines;
const uid = () => 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const tstr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const due = it => new Date(it.due);
const sod = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const dayDiff = d => Math.round((sod(d) - sod(new Date())) / DAY);
const fmtDate = d => d.toLocaleDateString('en-US', Object.assign({month:'short', day:'numeric'}, d.getFullYear() !== new Date().getFullYear() ? {year:'numeric'} : {}));
const fmtTime = d => d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
const types = () => BASE.concat(D().customTypes);
const find = id => D().items.find(i => i.id === id);
const course = id => D().courses.find(c => c.id === id);
const prog = it => it.subtasks && it.subtasks.length ? Math.round(it.subtasks.filter(s => s.done).length / it.subtasks.length * 100) : (+it.progress || 0);
const plural = (t, n) => n > 1 ? (/quiz$/i.test(t) ? t + 'zes' : t + 's') : t;
const remLabel = m => m % 1440 === 0 ? `${m/1440} day${m/1440>1?'s':''}` : m % 60 === 0 ? `${m/60} hour${m/60>1?'s':''}` : `${m} min`;

function ensure(){
  const d = state.deadlines = state.deadlines || {};
  d.items = d.items || []; d.courses = d.courses || []; d.customTypes = d.customTypes || [];
  d.prefs = Object.assign({ defRem:[1440,60], urgentH:48, notif:false, view:'list', period:14 }, d.prefs || {});
}
function commit(){ saveState(); render(); }

/* ---------- countdown ---------- */
function cd(ms){
  const over = ms < 0, a = Math.abs(ms);
  const s = Math.floor(a/1000) % 60, m = Math.floor(a/6e4) % 60, h = Math.floor(a/36e5) % 24, d = Math.floor(a/DAY);
  let t;
  if (over) t = d >= 1 ? `${d}d ${h}h` : a >= 36e5 ? `${h}h ${m}m` : `${m}m`;
  else if (a > 7*DAY) t = `${d}d`;
  else if (a >= 3*DAY) t = `${d}d ${h}h`;
  else if (a >= DAY) t = `${d}d ${h}h ${m}m`;
  else if (a >= 36e5) t = `${h}h ${m}m`;
  else t = `${m}m ${s}s`;
  return over ? `Overdue by ${t}` : `${t} remaining`;
}
function cdHtml(it){
  if (it.completedAt){
    const c = new Date(it.completedAt), diff = +due(it) - +c;
    return `<span style="color:var(--green)">✓ Completed ${fmtDate(c)}${diff >= 0 ? ' (on time)' : ' (late)'}</span>`;
  }
  const ms = +due(it) - Date.now();
  return `<span class="cd ${ms < 0 ? 'over' : ms < D().prefs.urgentH*36e5 ? 'soon' : ''}" data-due="${+due(it)}">${cd(ms)}</span>`;
}
function bucket(it){
  if (it.completedAt) return 'done';
  const d = due(it); if (d < Date.now()) return 'over';
  const n = dayDiff(d); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n <= 7 ? 'week' : 'later';
}
const BK = { over:'Overdue', today:'Today', tomorrow:'Tomorrow', week:'This Week', later:'Later', done:'Completed' };

/* ---------- filtering / sorting ---------- */
function items(){
  const stOk = it => !F.status || (F.status === 'done' ? !!it.completedAt : !it.completedAt && (F.status === 'none' ? prog(it) === 0 : prog(it) > 0));
  const cc = it => (course(it.courseId) || {code:'~'}).code;
  const cmp = {
    due:(a,b) => due(a)-due(b), dueDesc:(a,b) => due(b)-due(a),
    prio:(a,b) => PRIO[b.priority].w-PRIO[a.priority].w || due(a)-due(b),
    course:(a,b) => cc(a).localeCompare(cc(b)) || due(a)-due(b),
    type:(a,b) => a.type.localeCompare(b.type) || due(a)-due(b),
    progress:(a,b) => prog(a)-prog(b) || due(a)-due(b)
  }[F.sort];
  return D().items.filter(i => (!F.course || i.courseId === F.course) && (!F.type || i.type === F.type) && (!F.prio || i.priority === F.prio) && stOk(i)).sort(cmp);
}

/* ---------- rendering ---------- */
function render(){ if (!state.deadlines) return; ensure(); renderSummary(); renderToolbar(); renderContent(); }

function renderSummary(){
  const now = Date.now(), P = D().prefs;
  const act = D().items.filter(i => !i.completedAt);
  const up = act.filter(i => +due(i) >= now).sort((a,b) => due(a)-due(b));
  const w = up.filter(i => +due(i) < now + 7*DAY);
  const tc = {}; w.forEach(i => tc[i.type] = (tc[i.type] || 0) + 1);
  const br = Object.keys(tc).map(t => `<div>${tc[t]} ${esc(plural(t.toLowerCase(), tc[t]))}</div>`).join('') || '<div style="color:var(--text-dim)">Nothing due this week</div>';
  const urg = up.filter(i => +due(i) < now + P.urgentH*36e5).length;
  const avg = act.length ? Math.round(act.reduce((s,i) => s + prog(i), 0) / act.length) : 0;
  const n = up[0], nc = n && course(n.courseId);
  $('dlSummary').innerHTML = `<h2><span class="dot"></span>Workload</h2>
    <div style="font-size:0.75rem;color:var(--text-dim)">Next 7 days</div>
    <div class="dl-big">${w.length} deadline${w.length === 1 ? '' : 's'}</div>
    <div style="font-size:0.82rem;margin-top:6px">${br}</div>
    <div class="dl-tiles">
      <div class="dl-tile"><b style="color:var(--amber)">${urg}</b><span>urgent (under ${P.urgentH}h)</span></div>
      <div class="dl-tile"><b>${act.length}</b><span>incomplete</span></div>
      <div class="dl-tile"><b style="color:var(--red)">${act.length - up.length}</b><span>overdue</span></div>
      <div class="dl-tile"><b style="color:var(--green)">${up.length}</b><span>total upcoming</span></div>
    </div>
    <div class="progress-caption"><span>Overall progress (active)</span><span>${avg}%</span></div>
    <div class="progress-track"><div class="progress-fill" style="width:${avg}%"></div></div>
    ${n ? `<div class="dl-next" data-id="${n.id}"><div style="font-size:0.7rem;color:var(--text-dim)">Up next</div>
      <div class="dl-course" style="--cc:${nc ? nc.color : 'var(--text-dim)'}">${nc ? esc(nc.code) : 'No course'}</div>
      <div class="dl-title" style="margin-bottom:4px">${esc(n.title)}</div>${cdHtml(n)}
      <div class="dl-pct">${prog(n)}% done</div></div>` : ''}`;
}

function renderToolbar(){
  const P = D().prefs, v = P.view, cnt = {};
  items().forEach(i => { const k = bucket(i); cnt[k] = (cnt[k] || 0) + 1; });
  const act = ['over','today','tomorrow','week','later'].reduce((s,k) => s + (cnt[k] || 0), 0);
  const sel = (k, opts, cur) => `<select data-f="${k}">${opts.map(o => `<option value="${esc(o[0])}" ${cur === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  const tabs = [['active','Active',act]].concat(['today','tomorrow','week','later','over','done'].map(k => [k, BK[k], cnt[k] || 0]));
  $('dlToolbar').innerHTML =
    `<div class="dl-views">${[['list','☰ List'],['timeline','⏱ Timeline'],['calendar','▦ Calendar']].map(x => `<button class="btn small ${v === x[0] ? 'on' : ''}" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>` +
    (v === 'list' ? `<div class="dl-tabs">${tabs.map(t => `<button class="btn small ${F.bucket === t[0] ? 'on' : ''}" data-b="${t[0]}">${t[1]} (${t[2]})</button>`).join('')}</div>` : '') +
    `<div class="dl-filters">
      ${sel('course', [['','All courses']].concat(D().courses.map(c => [c.id, c.code])), F.course)}
      ${sel('type', [['','All types']].concat(types().map(t => [t, t])), F.type)}
      ${sel('prio', [['','Any priority'],['high','High'],['medium','Medium'],['low','Low']], F.prio)}
      ${sel('status', [['','Any status'],['none','Not started'],['part','In progress'],['done','Completed']], F.status)}
      ${sel('sort', [['due','Sort: soonest'],['dueDesc','Sort: latest'],['prio','Sort: priority'],['course','Sort: course'],['type','Sort: type'],['progress','Sort: progress']], F.sort)}
      ${v === 'timeline' ? sel('period', [['7','Next 7 days'],['14','Next 14 days'],['30','Next 30 days'],['60','Next 60 days']], String(P.period)) : ''}
      ${v !== 'list' ? `<label><input type="checkbox" data-sd ${F.showDone ? 'checked' : ''}> show completed</label>` : ''}
    </div>`;
}

function card(it){
  const c = course(it.courseId), d = due(it), p = it.completedAt ? 100 : prog(it), pr = PRIO[it.priority];
  return `<div class="dl-card ${it.completedAt ? 'done' : ''}" data-id="${it.id}" style="--cc:${c ? c.color : 'var(--text-dim)'}">
    <button class="dl-check" data-done="${it.id}" title="${it.completedAt ? 'Reopen' : 'Mark complete'}">${it.completedAt ? '✓' : ''}</button>
    <div class="dl-main">
      <div class="dl-course">${c ? esc(c.code) + (c.name ? ' — ' + esc(c.name) : '') : 'No course'}</div>
      <div class="dl-title">${esc(it.title)}</div>
      <div class="dl-meta"><span class="dl-tag">${esc(it.type)}</span><span class="dl-tag" style="color:${pr.c}">${pr.l}</span>${it.seriesId ? '<span class="dl-tag">🔁 repeats</span>' : ''}</div>
      <div class="dl-time">${cdHtml(it)} · Due ${fmtDate(d)} · ${fmtTime(d)}</div>
      <div class="dl-bar"><i style="width:${p}%"></i></div><div class="dl-pct">Progress: ${p}%</div>
    </div>
    <button class="icon-btn danger dl-del" data-del="${it.id}" title="Delete deadline">✕</button></div>`;
}

function renderContent(){
  const v = D().prefs.view;
  $('dlContent').innerHTML = v === 'timeline' ? timelineView() : v === 'calendar' ? calendarView() : listView();
}

function listView(){
  const g = {}; items().forEach(i => (g[bucket(i)] = g[bucket(i)] || []).push(i));
  const order = F.bucket === 'active' ? ['over','today','tomorrow','week','later'] : [F.bucket];
  const html = order.filter(k => g[k]).map(k => `<div class="dl-group"><h3 class="${k}">${BK[k]} <span>${g[k].length}</span></h3>${g[k].map(card).join('')}</div>`).join('');
  return html || `<div class="dl-empty">${D().items.length ? 'No deadlines match these filters.' : 'No deadlines yet. Use <b>Quick Add</b> or <b>+ Add Deadline</b> to create your first one.'}</div>`;
}

function timelineView(){
  const now = Date.now(), end = +sod(new Date()) + (+D().prefs.period + 1) * DAY, start = +sod(new Date());
  const its = items().filter(i => i.completedAt ? (F.showDone && +due(i) >= start && +due(i) < end) : +due(i) < end).sort((a,b) => due(a)-due(b));
  const nowRow = `<div class="tl-now">NOW · ${fmtDate(new Date())} ${fmtTime(new Date())}</div>`;
  let html = '', last = null, nowDone = false;
  its.forEach(it => {
    const d = due(it), t = +d;
    if (!nowDone && t > now){ html += nowRow; nowDone = true; last = null; }
    const key = dstr(d);
    if (key !== last){
      if (last && t > now){ const gap = Math.round((sod(d) - sod(new Date(last + 'T00:00'))) / DAY) - 1; if (gap > 0) html += `<div class="tl-gap">${gap} free day${gap > 1 ? 's' : ''}</div>`; }
      const n = dayDiff(d);
      html += `<div class="tl-day ${t < now && !it.completedAt ? 'over' : ''}">${n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : ''} ${d.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})}${t < now && !it.completedAt ? ' · overdue' : ''}</div>`;
      last = key;
    }
    const c = course(it.courseId);
    html += `<div class="tl-item ${it.completedAt ? 'done' : ''}" data-id="${it.id}" style="--cc:${c ? c.color : 'var(--text-dim)'}">
      <button class="icon-btn danger dl-del" data-del="${it.id}" title="Delete deadline">✕</button>
      <div class="dl-course">${c ? esc(c.code) : 'No course'} · ${esc(it.type)} · ${fmtTime(d)}</div>
      <div class="dl-title" style="margin:2px 0">${esc(it.title)}</div>
      <div class="dl-time">${cdHtml(it)} · ${it.completedAt ? 100 : prog(it)}% done</div></div>`;
  });
  if (!nowDone) html += nowRow;
  return `<div style="font-size:0.78rem;color:var(--text-dim);margin-bottom:8px">Overdue items appear above the NOW marker; upcoming ones below.</div><div class="tl">${html}</div>`;
}

function calendarView(){
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), off = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate();
  const by = {}; items().filter(i => F.showDone || !i.completedAt).forEach(i => (by[dstr(due(i))] = by[dstr(due(i))] || []).push(i));
  const todayKey = dstr(new Date()); let cells = '';
  for (let i = 0; i < Math.ceil((off + dim) / 7) * 7; i++){
    const day = i - off + 1;
    if (day < 1 || day > dim){ cells += '<div class="cal-cell blank"></div>'; continue; }
    const key = `${y}-${pad(m+1)}-${pad(day)}`, list = by[key] || [];
    cells += `<div class="cal-cell ${key === todayKey ? 'today' : ''} ${key === calSel ? 'sel' : ''}" data-day="${key}"><div class="cal-num">${day}</div>` +
      list.slice(0,3).map(it => { const c = course(it.courseId); return `<button class="cal-chip ${it.completedAt ? 'done' : +due(it) < Date.now() ? 'over' : ''}" data-id="${it.id}" style="--cc:${c ? c.color : 'var(--text-dim)'}">${esc(c ? c.code + ' ' : '')}${esc(it.title)}</button>`; }).join('') +
      (list.length > 3 ? `<div class="cal-more">+${list.length - 3} more</div>` : '') + '</div>';
  }
  const sel = calSel && (by[calSel] || []);
  return `<div class="cal-head"><button class="btn small ghost" data-cm="-1">‹</button><b>${calMonth.toLocaleDateString('en-US', {month:'long', year:'numeric'})}</b>
      <span><button class="btn small ghost" data-cm="0">Today</button> <button class="btn small ghost" data-cm="1">›</button></span></div>
    <div class="cal-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="cal-wd">${d}</div>`).join('')}${cells}</div>
    ${calSel ? `<div class="dl-group"><h3>${new Date(calSel + 'T00:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'})}
      <button class="btn small" data-addday="${calSel}">+ Add here</button></h3>${sel.length ? sel.map(card).join('') : '<div class="dl-empty" style="padding:14px">Nothing due this day.</div>'}</div>` : '<div class="hint" style="margin-top:10px">Click a day to see its deadlines, or a deadline to open its details.</div>'}`;
}

/* ---------- modal helpers ---------- */
function openModal(html){ const b = $('dlMbody'); b.innerHTML = html; b.onclick = b.onchange = b.oninput = b.onkeydown = null; $('dlModal').classList.add('open'); document.body.style.overflow = 'hidden'; return b; }
function closeModal(){ $('dlModal').classList.remove('open'); $('dlMbody').innerHTML = ''; document.body.style.overflow = ''; }
function armed(b, label){
  if (b.dataset.arm) return true;
  b.dataset.arm = 1; const old = b.textContent; b.textContent = label || 'Confirm?'; b.classList.add('armed');
  setTimeout(() => { delete b.dataset.arm; b.textContent = old; b.classList.remove('armed'); }, 3000);
  return false;
}
function remWidget(id, list, onChange){
  const el = $(id);
  const paint = () => {
    const custom = list.filter(m => !PRESETS.includes(m)).sort((a,b) => b-a);
    el.innerHTML = PRESETS.map(m => `<button type="button" class="dl-chip ${list.includes(m) ? 'on' : ''}" data-rm="${m}">${remLabel(m)} before</button>`).join('') +
      custom.map(m => `<button type="button" class="dl-chip on" data-rx="${m}">${remLabel(m)} before ✕</button>`).join('') +
      `<div style="display:flex;gap:6px;margin-top:4px;align-items:center"><input type="number" min="1" value="2" data-rn style="width:70px"><select data-ru style="width:auto"><option value="60">hours</option><option value="1">minutes</option><option value="1440">days</option></select><button type="button" class="btn small ghost" data-radd>+ Custom</button></div>`;
  };
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rm){ const m = +b.dataset.rm, i = list.indexOf(m); i < 0 ? list.push(m) : list.splice(i, 1); }
    else if (b.dataset.rx){ list.splice(list.indexOf(+b.dataset.rx), 1); }
    else if (b.dataset.radd){ const v = Math.round(+el.querySelector('[data-rn]').value * +el.querySelector('[data-ru]').value); if (v > 0 && !list.includes(v)) list.push(v); }
    else return;
    paint(); if (onChange) onChange();
  };
  paint();
}
function norm(it){ const t = +due(it), now = Date.now(); it.fired = {}; (it.reminders || []).forEach(m => { if (t - m*6e4 <= now) it.fired[m] = 1; }); }

/* ---------- add / edit form ---------- */
function openForm(it, pre){
  pre = pre || {}; const x = it || {};
  const d0 = x.due ? new Date(x.due) : null;
  const v = { title: x.title != null ? x.title : (pre.title || ''), courseId: x.courseId || pre.courseId || '', type: x.type || pre.type || 'Assignment',
    date: d0 ? dstr(d0) : (pre.date || ''), time: d0 ? tstr(d0) : (pre.time || '23:59'), prio: x.priority || pre.priority || 'medium', notes: x.notes || '', prog: x.progress || 0 };
  const subs = (x.subtasks || []).map(s => Object.assign({}, s));
  const rem = (x.reminders || D().prefs.defRem).slice();
  const nc = pre.newCourse;
  const b = openModal(`${pre.note ? `<div class="dl-note">${pre.note}</div>` : ''}<h2>${it ? 'Edit deadline' : 'Add deadline'}</h2>
    <div class="field"><label>Title</label><input type="text" id="f_title" value="${esc(v.title)}" placeholder="e.g. Assignment 2"></div>
    <div class="field-row"><div class="field"><label>Course</label><select id="f_course"><option value="">No course</option>${D().courses.map(c => `<option value="${c.id}" ${v.courseId === c.id ? 'selected' : ''}>${esc(c.code)}${c.name ? ' — ' + esc(c.name) : ''}</option>`).join('')}<option value="__new" ${nc ? 'selected' : ''}>+ New course…</option></select></div>
      <div class="field"><label>Type</label><select id="f_type">${types().map(t => `<option ${v.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}<option value="__new">+ New type…</option></select></div></div>
    <div class="field-row" id="f_newc" style="display:${nc ? 'flex' : 'none'}"><div class="field"><label>New course code</label><input type="text" id="f_ccode" value="${esc(nc ? nc.code : '')}" placeholder="CSE422"></div><div class="field"><label>Course name</label><input type="text" id="f_cname" value="${esc(nc ? nc.name : '')}" placeholder="Artificial Intelligence"></div></div>
    <div class="field" id="f_newt" style="display:none"><label>New type name</label><input type="text" id="f_tnew" placeholder="e.g. Lab report"></div>
    <div class="field-row"><div class="field"><label>Due date</label><input type="date" id="f_date" value="${v.date}"></div><div class="field"><label>Due time</label><input type="time" id="f_time" value="${v.time}"></div>
      <div class="field"><label>Priority</label><select id="f_prio">${Object.keys(PRIO).map(k => `<option value="${k}" ${v.prio === k ? 'selected' : ''}>${PRIO[k].l}</option>`).join('')}</select></div></div>
    ${it ? `<div class="field"><label>Progress: <span id="f_pv">${v.prog}%</span></label><input type="range" id="f_prog" min="0" max="100" step="5" value="${v.prog}"><div class="hint" id="f_ph"></div></div>` : '<div class="hint" style="margin:-6px 0 14px">Progress is calculated from your subtasks. Add some below to track it.</div>'}
    <div class="field"><label>Subtasks</label><div id="f_subs"></div><div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="f_subin" placeholder="Add a subtask…"><button class="btn small" id="f_subadd" type="button">Add</button></div></div>
    <div class="field"><label>Reminders</label><div id="f_rem"></div><div class="hint">Reminders are delivered while this page is open in a browser tab.</div></div>
    <div class="field"><label>Notes</label><textarea id="f_notes" placeholder="Optional notes">${esc(v.notes)}</textarea></div>
    ${it && it.seriesId ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="f_series"> Apply title, course, type, priority, time, notes &amp; reminders to later items in this series</label>` : ''}
    <div class="row-actions" style="justify-content:flex-end;margin-top:8px"><button class="btn ghost" id="f_cancel" type="button">Cancel</button><button class="btn" id="f_save" type="button">Save</button></div>`);
  const paintSubs = () => {
    $('f_subs').innerHTML = subs.map((s, i) => `<div class="dl-sub ${s.done ? 'done' : ''}"><input type="checkbox" data-sub="${i}" ${s.done ? 'checked' : ''}><input type="text" data-st="${i}" value="${esc(s.text)}"><button class="icon-btn" data-sx="${i}" type="button">✕</button></div>`).join('');
    if ($('f_prog')){
      $('f_prog').disabled = subs.length > 0;
      $('f_ph').textContent = subs.length ? `Calculated from subtasks: ${Math.round(subs.filter(s => s.done).length / subs.length * 100)}%` : 'Drag to set progress, or add subtasks to calculate it automatically.';
    }
  };
  const addSub = () => { const i = $('f_subin'), t = i.value.trim(); if (!t) return; subs.push({ id: uid(), text: t, done: false }); i.value = ''; paintSubs(); i.focus(); };
  remWidget('f_rem', rem); paintSubs();
  b.onchange = e => {
    if (e.target.id === 'f_course') $('f_newc').style.display = e.target.value === '__new' ? 'flex' : 'none';
    if (e.target.id === 'f_type') $('f_newt').style.display = e.target.value === '__new' ? 'block' : 'none';
    if (e.target.dataset.sub !== undefined){ subs[+e.target.dataset.sub].done = e.target.checked; paintSubs(); }
  };
  b.oninput = e => {
    if (e.target.id === 'f_prog') $('f_pv').textContent = e.target.value + '%';
    if (e.target.dataset.st !== undefined) subs[+e.target.dataset.st].text = e.target.value;
  };
  b.onkeydown = e => { if (e.key === 'Enter' && e.target.id === 'f_subin'){ e.preventDefault(); addSub(); } };
  b.onclick = e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.id === 'f_cancel') closeModal();
    else if (btn.id === 'f_subadd') addSub();
    else if (btn.dataset.sx !== undefined){ subs.splice(+btn.dataset.sx, 1); paintSubs(); }
    else if (btn.id === 'f_save') save();
  };
  function save(){
    const title = $('f_title').value.trim(), date = $('f_date').value, time = $('f_time').value || '23:59';
    if (!title || !date){ showToast('Please enter a title and a due date'); return; }
    let courseId = $('f_course').value;
    if (courseId === '__new'){
      const code = $('f_ccode').value.trim().toUpperCase(); if (!code){ showToast('Enter a course code'); return; }
      let c = D().courses.find(c => c.code === code);
      if (!c){ c = { id: uid(), code, name: $('f_cname').value.trim(), color: COLORS[D().courses.length % COLORS.length] }; D().courses.push(c); }
      courseId = c.id;
    }
    let type = $('f_type').value;
    if (type === '__new'){
      type = $('f_tnew').value.trim(); if (!type){ showToast('Enter a type name'); return; }
      const ex = types().find(t => t.toLowerCase() === type.toLowerCase());
      if (ex) type = ex; else D().customTypes.push(type);
    }
    const dueStr = `${date}T${time}`;
    const base = { title, courseId: courseId || null, type, priority: $('f_prio').value, notes: $('f_notes').value.trim(), reminders: rem.slice().sort((a,b) => b-a),
      subtasks: subs.filter(s => s.text.trim()).map(s => ({ id: s.id || uid(), text: s.text.trim(), done: !!s.done })), progress: $('f_prog') ? +$('f_prog').value : (it ? it.progress || 0 : 0) };
    if (it){
      const changed = it.due !== dueStr || JSON.stringify(it.reminders) !== JSON.stringify(base.reminders);
      Object.assign(it, base, { due: dueStr }); if (changed) norm(it);
      if ($('f_series') && $('f_series').checked) D().items.forEach(o => {
        if (o !== it && o.seriesId === it.seriesId && !o.completedAt && +due(o) > +due(it)){
          Object.assign(o, { title, courseId: base.courseId, type, priority: base.priority, notes: base.notes, reminders: base.reminders.slice() });
          o.due = dstr(due(o)) + 'T' + time; norm(o);
        }
      });
    } else {
      const o = Object.assign({}, base, { id: uid(), due: dueStr, seriesId: null, completedAt: null, createdAt: new Date().toISOString(),
        reminders: base.reminders.slice(), subtasks: base.subtasks.map(s => ({ id: uid(), text: s.text, done: s.done })) });
      norm(o); D().items.push(o);
    }
    commit(); closeModal(); showToast(it ? 'Deadline updated' : 'Deadline added');
  }
  setTimeout(() => $('f_title').focus(), 30);
}

/* ---------- details ---------- */
function openDetails(id){
  const it = find(id); if (!it) return closeModal();
  const c = course(it.courseId), d = due(it), p = it.completedAt ? 100 : prog(it), pr = PRIO[it.priority], hasSub = it.subtasks.length;
  const b = openModal(`<h2>${esc(it.title)}</h2>
    <div class="dl-course" style="--cc:${c ? c.color : 'var(--text-dim)'}">${c ? esc(c.code) + (c.name ? ' — ' + esc(c.name) : '') : 'No course'}</div>
    <div class="dl-meta" style="margin:10px 0"><span class="dl-tag">${esc(it.type)}</span><span class="dl-tag" style="color:${pr.c}">${pr.l} priority</span>${it.seriesId ? '<span class="dl-tag">🔁 repeating</span>' : ''}</div>
    <div class="field-row"><div class="stat" style="flex:1"><div class="label">Due</div><div style="font-size:0.95rem">${fmtDate(d)} · ${fmtTime(d)}</div></div>
      <div class="stat" style="flex:1"><div class="label">${it.completedAt ? 'Status' : 'Time remaining'}</div><div style="font-size:0.95rem">${cdHtml(it)}</div></div></div>
    <div class="field" style="margin-top:16px"><div class="progress-caption" style="margin:0 0 6px"><span>Overall progress</span><span>${p}%</span></div>
      <div class="progress-track" style="margin:0"><div class="progress-fill" style="width:${p}%"></div></div>
      ${hasSub ? '' : `<input type="range" data-prog min="0" max="100" step="5" value="${it.progress || 0}" style="margin-top:10px" ${it.completedAt ? 'disabled' : ''}>`}</div>
    <div class="field"><label>Subtasks ${hasSub ? `(${it.subtasks.filter(s => s.done).length}/${hasSub})` : ''}</label>
      ${it.subtasks.map(s => `<div class="dl-sub ${s.done ? 'done' : ''}"><input type="checkbox" data-tg="${s.id}" ${s.done ? 'checked' : ''}><span class="t">${esc(s.text)}</span><button class="icon-btn" data-rs="${s.id}">✕</button></div>`).join('') || '<div class="hint">No subtasks yet — break this deadline into smaller steps to track progress automatically.</div>'}
      <div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="d_sub" placeholder="Add a subtask…"><button class="btn small" data-addsub>Add</button></div></div>
    ${it.notes ? `<div class="field"><label>Notes</label><div style="white-space:pre-wrap;font-size:0.88rem">${esc(it.notes)}</div></div>` : ''}
    ${it.reminders.length ? `<div class="hint">Reminders: ${it.reminders.map(remLabel).join(', ')} before</div>` : ''}
    <div class="row-actions" style="justify-content:flex-end;margin-top:16px;flex-wrap:wrap">
      <button class="btn small ghost" data-edit>Edit</button>
      <button class="btn small ghost" data-del>Delete</button>
      ${it.seriesId ? '<button class="btn small ghost" data-delall>Delete this &amp; future</button>' : ''}
      <button class="btn small ${it.completedAt ? 'ghost' : ''}" data-fin>${it.completedAt ? 'Reopen' : '✓ Mark complete'}</button></div>`);
  const again = (focus) => { commit(); openDetails(id); if (focus) $('d_sub').focus(); };
  const addSub = () => { const t = $('d_sub').value.trim(); if (!t) return; it.subtasks.push({ id: uid(), text: t, done: false }); again(true); };
  b.onchange = e => { if (e.target.dataset.tg){ const s = it.subtasks.find(s => s.id === e.target.dataset.tg); s.done = e.target.checked; again(); } };
  b.oninput = e => { if (e.target.dataset.prog !== undefined){ it.progress = +e.target.value; saveState(); renderSummary(); renderContent(); b.querySelector('.progress-fill').style.width = it.progress + '%'; b.querySelector('.progress-caption span:last-child').textContent = it.progress + '%'; } };
  b.onkeydown = e => { if (e.key === 'Enter' && e.target.id === 'd_sub'){ e.preventDefault(); addSub(); } };
  b.onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.rs){ it.subtasks = it.subtasks.filter(s => s.id !== t.dataset.rs); again(); }
    else if (t.dataset.addsub !== undefined) addSub();
    else if (t.dataset.edit !== undefined) openForm(it);
    else if (t.dataset.fin !== undefined){ toggleDone(id); openDetails(id); }
    else if (t.dataset.del !== undefined){ if (!armed(t)) return; D().items = D().items.filter(o => o.id !== id); commit(); closeModal(); showToast('Deadline deleted'); }
    else if (t.dataset.delall !== undefined){ if (!armed(t)) return; D().items = D().items.filter(o => o.id !== id && !(o.seriesId === it.seriesId && +due(o) > +due(it))); commit(); closeModal(); showToast('Deleted this and future occurrences'); }
  };
}
function toggleDone(id){
  const it = find(id); if (!it) return;
  it.completedAt = it.completedAt ? null : new Date().toISOString();
  commit(); showToast(it.completedAt ? 'Marked complete' : 'Reopened');
}

/* ---------- courses / types / preferences ---------- */
function openSettings(){
  const P = D().prefs, cs = D().courses;
  const b = openModal(`<h2>Courses &amp; settings</h2>
    <div class="field" style="margin-top:14px"><label>Your courses</label>
      ${cs.map(c => `<div class="dl-sub"><span style="width:12px;height:12px;border-radius:50%;background:${c.color};flex-shrink:0"></span><input type="text" data-cc="${c.id}" value="${esc(c.code)}" style="width:110px"><input type="text" data-cn="${c.id}" value="${esc(c.name)}" placeholder="Course name"><button class="icon-btn danger" data-dc="${c.id}" title="Delete course">✕</button></div>`).join('') || '<div class="hint">No courses yet.</div>'}
      <div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="s_code" placeholder="Code" style="width:110px"><input type="text" id="s_name" placeholder="Course name"><button class="btn small" data-addc>Add</button></div>
      <button class="btn small ghost" data-imp style="margin-top:8px">Import courses from my Course Planner</button></div>
    <div class="field"><label>Deadline types</label>
      ${BASE.map(t => `<span class="dl-chip">${esc(t)}</span>`).join('')}${D().customTypes.map((t, i) => `<button class="dl-chip on" data-dt="${i}" title="Delete type">${esc(t)} ✕</button>`).join('')}
      <div style="display:flex;gap:8px;margin-top:4px"><input type="text" id="s_type" placeholder="New type, e.g. Lab report"><button class="btn small" data-addt>Add</button></div></div>
    <div class="field"><label>Default reminders for new deadlines</label><div id="s_rem"></div></div>
    <div class="field-row"><div class="field"><label>“Urgent” means due within</label><select id="s_urg">${[24,48,72].map(h => `<option value="${h}" ${P.urgentH === h ? 'selected' : ''}>${h} hours</option>`).join('')}</select></div>
      <div class="field"><label>Browser notifications</label><button class="btn small ${P.notif ? '' : 'ghost'}" data-notif>${P.notif ? 'On — click to turn off' : 'Turn on'}</button></div></div>
    <div class="hint">Reminders fire while this page is open in a browser tab (or a background tab). They can't be delivered when the page is closed.</div>`);
  remWidget('s_rem', P.defRem, saveState);
  b.onchange = e => {
    const t = e.target;
    if (t.dataset.cc){ const c = course(t.dataset.cc); c.code = t.value.trim().toUpperCase() || c.code; commit(); }
    else if (t.dataset.cn){ course(t.dataset.cn).name = t.value.trim(); commit(); }
    else if (t.id === 's_urg'){ P.urgentH = +t.value; commit(); }
  };
  b.onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.addc !== undefined){
      const code = $('s_code').value.trim().toUpperCase(); if (!code) return;
      if (!cs.some(c => c.code === code)) cs.push({ id: uid(), code, name: $('s_name').value.trim(), color: COLORS[cs.length % COLORS.length] });
      commit(); openSettings();
    } else if (t.dataset.dc){
      if (!armed(t)) return;
      D().items.forEach(i => { if (i.courseId === t.dataset.dc) i.courseId = null; });
      D().courses = cs.filter(c => c.id !== t.dataset.dc); commit(); openSettings();
    } else if (t.dataset.imp !== undefined){
      let n = 0;
      state.planner.semesters.forEach(s => s.codes.forEach(k => {
        const info = (typeof COURSE_DB !== 'undefined' && COURSE_DB[k]) || (state.customCourses || {})[k]; if (!info) return;
        const code = (info.code || k).toUpperCase();
        if (!cs.some(c => c.code === code)){ cs.push({ id: uid(), code, name: info.name || '', color: COLORS[cs.length % COLORS.length] }); n++; }
      }));
      commit(); openSettings(); showToast(n ? `Imported ${n} course${n > 1 ? 's' : ''}` : 'No new courses to import');
    } else if (t.dataset.addt !== undefined){
      const v = $('s_type').value.trim(); if (v && !types().some(x => x.toLowerCase() === v.toLowerCase())) D().customTypes.push(v);
      commit(); openSettings();
    } else if (t.dataset.dt !== undefined){
      const name = D().customTypes[+t.dataset.dt]; D().items.forEach(i => { if (i.type === name) i.type = 'Other'; });
      D().customTypes.splice(+t.dataset.dt, 1); commit(); openSettings();
    } else if (t.dataset.notif !== undefined){
      if (P.notif){ P.notif = false; commit(); openSettings(); }
      else if (!('Notification' in window)) showToast('This browser does not support notifications');
      else Notification.requestPermission().then(r => { P.notif = r === 'granted'; if (!P.notif) showToast('Notifications are blocked in your browser settings'); commit(); openSettings(); });
    }
  };
}

/* ---------- quick add parser ---------- */
function parseQuick(txt){
  let s = ' ' + txt + ' ', m; const r = { priority: 'medium' }, now = new Date();
  const cut = re => { const x = s.match(re); if (x) s = s.replace(re, ' '); return x; };
  if ((m = cut(/\b([A-Za-z]{3})\s?-?(\d{3})\b/))) r.code = (m[1] + m[2]).toUpperCase();
  if (cut(/\b(urgent|high priority|important|asap)\b/i)) r.priority = 'high'; else if (cut(/\blow priority\b/i)) r.priority = 'low';
  let h = null, mi = 0;
  if ((m = cut(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])/i))){ h = (+m[1] % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0); mi = +(m[2] || 0); }
  else if ((m = cut(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/))){ h = +m[1]; mi = +m[2]; }
  else if (cut(/\bnoon\b/i)) h = 12;
  else if (cut(/\b(?:midnight|end of (?:the )?day|eod)\b/i)){ h = 23; mi = 59; }
  const mk = (d, mo, y) => { let yr = y ? (+y < 100 ? 2000 + +y : +y) : now.getFullYear(), dt = new Date(yr, mo, d); if (!y && dt < sod(now)) dt = new Date(yr + 1, mo, d); return dt; };
  const MR = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  let dt = null, wdIdx = r.wd !== undefined ? r.wd : null, nextMod = false;
  if ((m = cut(/\b(\d{4})-(\d{2})-(\d{2})\b/))) dt = new Date(+m[1], +m[2] - 1, +m[3]);
  else if ((m = cut(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MR + '(?:,?\\s+(\\d{4}))?\\b', 'i')))) dt = mk(+m[1], MON.indexOf(m[2].toLowerCase()), m[3]);
  else if ((m = cut(new RegExp('\\b' + MR + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i')))) dt = mk(+m[2], MON.indexOf(m[1].toLowerCase()), m[3]);
  else if ((m = cut(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))){ let a = +m[1], c = +m[2]; if (c > 12){ const t = a; a = c; c = t; } dt = mk(a, c - 1, m[3]); }
  else if (cut(/\b(today|tonight)\b/i)) dt = sod(now);
  else if (cut(/\btomorrow\b/i)){ dt = sod(now); dt.setDate(dt.getDate() + 1); }
  else if ((m = cut(/\bin\s+(\d+)\s+(day|week)s?\b/i))){ dt = sod(now); dt.setDate(dt.getDate() + +m[1] * (m[2].toLowerCase() === 'week' ? 7 : 1)); }
  else if (wdIdx === null && (m = cut(/\b(?:(next|this)\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|s|sday|nesday|rsday|urday)?\b/i))){ wdIdx = WD.indexOf(m[2].toLowerCase()); nextMod = /next/i.test(m[1] || ''); }
  if (!dt && wdIdx !== null){
    dt = sod(now); let diff = (wdIdx - now.getDay() + 7) % 7;
    if (diff === 0 && (nextMod || r.rep)) diff = r.rep && !nextMod ? 0 : 7;
    dt.setDate(dt.getDate() + diff);
    if (diff === 0){ const t = new Date(dt); t.setHours(h === null ? 23 : h, h === null ? 59 : mi); if (t < now) dt.setDate(dt.getDate() + 7); }
  }
  r.assumed = [];
  if (h === null){ h = 23; mi = 59; if (dt) r.assumed.push('no time given — assumed 11:59 PM'); }
  r.time = `${pad(h)}:${pad(mi)}`; r.date = dt;
  const low = s.toLowerCase();
  r.type = types().find(t => t !== 'Other' && new RegExp('\\b' + t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b').test(low));
  if (!r.type) [['Presentation',/\b(presentation|pres|slides?)\b/],['Project',/\b(project|proj)\b/],['Quiz',/\bquiz(?:zes)?\b/],['Exam',/\b(exam|midterm|mid|final|test)\b/],['Assignment',/\b(assignment|asg|assign|homework|hw|lab)\b/]].some(x => x[1].test(low) && (r.type = x[0]));
  if (!r.type){ r.type = 'Assignment'; r.assumed.push('no type recognised — assumed Assignment'); }
  let title = s.replace(/\b(due|by|on|at|deadline)\b/gi, ' ').replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title || title.toLowerCase().replace(/s$/, '') === r.type.toLowerCase()) title = r.type;
  r.title = title.charAt(0).toUpperCase() + title.slice(1);
  if (!dt) r.assumed.push('no date found — please pick one');
  return r;
}
function quickAdd(){
  const txt = $('dlQuick').value.trim(); if (!txt) return;
  const r = parseQuick(txt), pre = { title: r.title, type: r.type, priority: r.priority, time: r.time, date: r.date ? dstr(r.date) : '' };
  const c = r.code && D().courses.find(c => c.code === r.code);
  if (c) pre.courseId = c.id;
  else if (r.code) pre.newCourse = { code: r.code, name: (typeof COURSE_DB !== 'undefined' && COURSE_DB[r.code] ? COURSE_DB[r.code].name : '') };
  const seen = [r.code ? 'course <b>' + esc(r.code) + '</b>' : '', 'type <b>' + esc(r.type) + '</b>', r.date ? 'due <b>' + esc(fmtDate(r.date)) + ' ' + esc(fmtTime(new Date(dstr(r.date) + 'T' + r.time))) + '</b>' : ''].filter(Boolean);
  pre.note = `Quick add understood: ${seen.join(' · ')}.${r.assumed.length ? '<br>Check: ' + r.assumed.map(esc).join('; ') + '.' : ''}<br>Review the details, then press Save to confirm.`;
  $('dlQuick').value = ''; openForm(null, pre);
}

/* ---------- reminders ---------- */
function banner(text){
  const el = document.createElement('div'); el.className = 'dl-banner';
  el.innerHTML = `<span>🔔 ${esc(text)}</span><button class="icon-btn" style="flex-shrink:0">✕</button>`;
  el.querySelector('button').onclick = () => el.remove(); $('dlBanners').appendChild(el); setTimeout(() => el.remove(), 20000);
}
function checkRem(){
  const now = Date.now(); let dirty = false;
  D().items.forEach(it => {
    if (it.completedAt || +due(it) <= now) return;
    it.fired = it.fired || {};
    const ready = (it.reminders || []).filter(m => !it.fired[m] && +due(it) - m*6e4 <= now);
    if (!ready.length) return;
    ready.forEach(m => it.fired[m] = 1); dirty = true;
    const c = course(it.courseId), msg = `${c ? c.code + ' · ' : ''}${it.title} — due in ${cd(+due(it) - now).replace(' remaining', '')}`;
    banner(msg);
    if (D().prefs.notif && 'Notification' in window && Notification.permission === 'granted') try { new Notification('Deadline reminder', { body: msg }); } catch (e) {}
  });
  if (dirty) saveState();
}

/* ---------- wiring ---------- */
function init(){
  document.body.insertAdjacentHTML('beforeend', '<div class="dl-modal" id="dlModal"><div class="dl-mbox"><button class="icon-btn dl-x" id="dlClose">✕</button><div id="dlMbody"></div></div></div><div class="dl-banners" id="dlBanners"></div>');
  $('dlClose').onclick = closeModal;
  $('dlModal').addEventListener('mousedown', e => { if (e.target === $('dlModal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('dlModal').classList.contains('open')) closeModal(); });
  $('dlAddBtn').onclick = () => openForm(null, {});
  $('dlSetBtn').onclick = openSettings;
  $('dlQuickBtn').onclick = quickAdd;
  $('dlQuick').addEventListener('keydown', e => { if (e.key === 'Enter') quickAdd(); });
  $('dlSummary').onclick = e => { const n = e.target.closest('[data-id]'); if (n) openDetails(n.dataset.id); };
  $('dlToolbar').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.v){ D().prefs.view = b.dataset.v; saveState(); render(); }
    else if (b.dataset.b){ F.bucket = b.dataset.b; if (F.status === 'done' && b.dataset.b !== 'done') F.status = ''; render(); }
  };
  $('dlToolbar').onchange = e => {
    const t = e.target;
    if (t.dataset.sd !== undefined) F.showDone = t.checked;
    else if (t.dataset.f === 'period'){ D().prefs.period = +t.value; saveState(); }
    else if (t.dataset.f){ F[t.dataset.f] = t.value; if (t.dataset.f === 'status') F.bucket = t.value === 'done' ? 'done' : (F.bucket === 'done' ? 'active' : F.bucket); }
    render();
  };
  $('dlContent').onclick = e => {
    const del = e.target.closest('[data-del]');
    if (del){ e.stopPropagation(); if (!armed(del)) return; D().items = D().items.filter(o => o.id !== del.dataset.del); commit(); showToast('Deadline deleted'); return; }
    const chk = e.target.closest('[data-done]'); if (chk){ e.stopPropagation(); toggleDone(chk.dataset.done); return; }
    const cm = e.target.closest('[data-cm]');
    if (cm){ const k = +cm.dataset.cm; if (k) calMonth.setMonth(calMonth.getMonth() + k); else { calMonth = new Date(); calMonth.setDate(1); } renderContent(); return; }
    const ad = e.target.closest('[data-addday]'); if (ad){ openForm(null, { date: ad.dataset.addday }); return; }
    const it = e.target.closest('[data-id]'); if (it){ openDetails(it.dataset.id); return; }
    const day = e.target.closest('[data-day]'); if (day){ calSel = day.dataset.day; renderContent(); }
  };
  document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', () => { if (t.dataset.page === 'page-deadlines') render(); }));
  let tk = 0;
  setInterval(() => {
    if (!state.deadlines || typeof currentUser === 'undefined' || !currentUser || !stateLoaded){ if ($('dlModal').classList.contains('open')) closeModal(); return; }
    tk++;
    document.querySelectorAll('.cd[data-due]').forEach(el => {
      const ms = +el.dataset.due - Date.now();
      el.textContent = cd(ms); el.classList.toggle('over', ms < 0); el.classList.toggle('soon', ms >= 0 && ms < D().prefs.urgentH * 36e5);
    });
    if (tk % 15 === 0) checkRem();
    if (tk % 60 === 0 && $('page-deadlines').classList.contains('active') && !$('dlModal').classList.contains('open')){ renderSummary(); renderContent(); }
  }, 1000);
}
window.dlEnsure = ensure; window.dlRender = render;
init();
})();

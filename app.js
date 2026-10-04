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
  // Only remember the signed-in session for as long as this browser tab/window
  // stays open. Closing it (or reopening the app later) requires logging in
  // again, rather than staying signed in indefinitely.
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err => {
    console.error('Could not set session persistence:', err);
  });
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
// One-time migration for users who were remembered under the old "stay logged
// in forever" persistence, from before session-only persistence existed. Once
// a user has been through this (or has explicitly logged in since), we never
// force a sign-out again.
let sessionMigrationDone = !!localStorage.getItem('authSessionMigrationDone');
let justSignedIn = false; // true only while an explicit login/signup click is in flight

// Tab Switching Logic
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.page).classList.add('active');
  });
});

// Jump to a page from any [data-goto] button/link (dashboard shortcuts, planner pointer).
function gotoPage(page){
  const tab = document.querySelector('.nav-tab[data-page="' + page + '"]');
  if (tab) tab.click();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (!g) return;
  e.preventDefault();
  gotoPage(g.dataset.goto);
  if (g.dataset.quick === 'add') setTimeout(() => { const b = document.getElementById('dlAddBtn'); if (b) b.click(); }, 60);
});

// Landing-page title: React Bits <StrokeText /> (vanilla port in stroke-text.js).
(function(){
  const host = document.getElementById('landingStroke');
  if (!host || typeof window.StrokeText !== 'function') return;
  window.StrokeText(host, {
    text: 'Gradacus',
    strokeColor: '#9382ff',
    fillColor: '#f4f0ff',
    strokeWidth: 1.4,
    drawDuration: 1.6,
    fillDelay: 0.2,
    stagger: 0.05,
    ease: 'power2.out',
    trigger: 'mount',
    fillMode: 'wipe',
    fontSize: 128,
    fontWeight: 500,
    letterSpacing: -4,
    className: 'landing-stroke'
  });
})();

// Animated page background: React Bits <Grainient /> (vanilla WebGL2 port in grainient.js).
// The CSS gradient on .bg-grainient is the fallback if WebGL2 is unavailable.
(function(){
  const host = document.getElementById('bgGrainient');
  if (!host || typeof window.Grainient !== 'function') return;
  try {
    window.Grainient(host, {
      color1: '#7b2fbf', color2: '#3d0f6e', color3: '#0a0016',
      timeSpeed: 0.12, colorBalance: 0.0,
      warpStrength: 1.0, warpFrequency: 5.0, warpSpeed: 2.0, warpAmplitude: 50.0,
      blendAngle: 0.0, blendSoftness: 0.05, rotationAmount: 500.0, noiseScale: 2.0,
      grainAmount: 0.08, grainScale: 2.0, grainAnimated: false,
      contrast: 1.2, gamma: 1.0, saturation: 1.0,
      centerX: 0.0, centerY: 0.0, zoom: 0.9
    });
  } catch (err) { console.warn('Grainient background disabled:', err); }
})();

// Main navigation: React Bits <RubberSegment /> (vanilla port in rubber-segment.js).
// The original .nav-tab buttons stay in the DOM (hidden) and keep driving page switching,
// so every existing code path (gotoPage, dashboard shortcuts, tab listeners) still works.
(function(){
  const nav = document.querySelector('.nav-tabs');
  const host = document.getElementById('navSegment');
  if (!nav || !host || typeof window.RubberSegment !== 'function') return;   // falls back to the plain buttons
  const tabs = Array.from(nav.querySelectorAll('.nav-tab'));
  const items = tabs.map(t => ({ value: t.dataset.page, labelHtml: t.innerHTML }));
  const activePage = () => (tabs.find(t => t.classList.contains('active')) || tabs[0]).dataset.page;
  let seg = null, small = null;

  function build(){
    const isSmall = window.innerWidth <= 600;
    if (seg && small === isSmall) return;
    const value = seg ? seg.getValue() : activePage();
    if (seg) seg.destroy();
    small = isSmall;
    seg = window.RubberSegment(host, {
      items, defaultValue: value, ariaLabel: 'Sections',
      size: isSmall ? 'sm' : 'md', equalSlots: false, radius: 999, inset: 4,
      trackColor: '#0c0730', thumbColor: '#5046e4', textColor: '#f4f0ff', activeTextColor: '#ffffff',
      stretch: 100, squash: 3, speed: 1, glide: 75, draggable: true,
      onChange: page => { const t = tabs.find(x => x.dataset.page === page); if (t) t.click(); }
    });
    nav.classList.add('has-segment');
  }
  tabs.forEach(t => t.addEventListener('click', () => { if (seg) seg.setValue(t.dataset.page, true); }));
  window.addEventListener('resize', build);
  build();
})();

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
  'A+':'#f4f0ff','A':'#f4f0ff','A-':'#ba9cff','B+':'#ba9cff','B':'#ba9cff',
  'B-':'#9382ff','C+':'#a8a6b7','C':'#a8a6b7','C-':'#a8a6b7',
  'D+':'#918ea0','D':'#918ea0','D-':'#918ea0','F':'#918ea0'
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
      : `<span class="grade-pill" style="color:var(--text-dim); border:1px solid var(--line);">—</span>`;

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
      <td data-label="Course"><input class="code-input mono code" type="text" data-field="code" data-id="${c.id}" value="${c.code}" placeholder="CSE101">${retakeTag}</td>
      <td data-label="Credits"><input class="credit-input mono" type="number" step="0.5" min="0" data-field="credits" data-id="${c.id}" value="${c.credits}"></td>
      <td data-label="Grade"><select class="grade-select mono" data-field="grade" data-id="${c.id}">${gradeOptions}</select></td>
      <td data-label="Points">${pointHtml}</td>
      <td data-label="Counts">
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
    : `<span class="grade-pill" style="color:var(--text-dim); border:1px solid var(--line);">—</span>`;
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
// `lab: true` marks courses that are commonly run with an accompanying lab/practical
// component; `project: true` marks courses centered on a capstone or term project.
// This is a general guide compiled from public course records, not an official
// curriculum document — always confirm the current requirement against BRACU's
// own course pages before registering.
const COURSE_DB = {
  // Foundation / General Education
  ENG101:{name:'English Fundamentals', credits:3},
  ENG102:{name:'English Composition', credits:3},
  MAT110:{name:'Mathematics I', credits:3},
  MAT120:{name:'Mathematics II', credits:3, lab:true},
  MAT215:{name:'Mathematics III', credits:3},
  MAT216:{name:'Mathematics IV', credits:3},
  PHY111:{name:'Principles of Physics I', credits:3, lab:true},
  PHY112:{name:'Principles of Physics II', credits:3, lab:true},
  STA201:{name:'Elements of Statistics and Probability', credits:3},
  DEV101:{name:'Bangladesh Studies', credits:3},
  HUM103:{name:'Ethics and Culture', credits:3},
  // CSE department courses
  CSE101:{name:'Introduction to Computer Science', credits:3},
  CSE110:{name:'Programming Language I', credits:3, lab:true},
  CSE111:{name:'Programming Language II', credits:3, lab:true},
  CSE220:{name:'Data Structures', credits:3, lab:true},
  CSE221:{name:'Algorithms', credits:3, lab:true},
  CSE230:{name:'Discrete Mathematics', credits:3},
  CSE250:{name:'Circuits and Electronics', credits:3, lab:true},
  CSE251:{name:'Electronic Devices and Circuits', credits:3, lab:true},
  CSE260:{name:'Digital Logic Design', credits:3, lab:true, project:true},
  CSE310:{name:'Object-Oriented Programming', credits:3, lab:true},
  CSE320:{name:'Data Communications', credits:3},
  CSE321:{name:'Operating Systems', credits:3, lab:true},
  CSE330:{name:'Numerical Methods', credits:3, lab:true},
  CSE331:{name:'Automata and Computability', credits:3},
  CSE340:{name:'Computer Architecture', credits:3},
  CSE341:{name:'Microprocessors', credits:3, lab:true},
  CSE342:{name:'Computer Systems Engineering', credits:3},
  CSE350:{name:'Digital Electronics and Pulse Techniques', credits:3, lab:true, project:true},
  CSE360:{name:'Computer Interfacing', credits:3, lab:true},
  CSE370:{name:'Database Systems', credits:3, lab:true, project:true},
  CSE371:{name:'Management Information Systems', credits:3},
  CSE390:{name:'Technical Communication', credits:3},
  CSE391:{name:'Programming for the Internet', credits:3, lab:true},
  CSE392:{name:'Signals and Systems', credits:3},
  CSE400:{name:'Final Year Design Project', credits:4, project:true},
  CSE410:{name:'Advanced Programming in UNIX', credits:3, lab:true},
  CSE419:{name:'Programming Languages & Competitive Programming', credits:3, lab:true},
  CSE420:{name:'Compiler Design', credits:3, lab:true},
  CSE421:{name:'Computer Networks', credits:3, lab:true, project:true},
  CSE422:{name:'Artificial Intelligence', credits:3, lab:true, project:true},
  CSE423:{name:'Computer Graphics', credits:3, lab:true},
  CSE424:{name:'Pattern Recognition', credits:3},
  CSE425:{name:'Neural Networks', credits:3},
  CSE426:{name:'Advanced Algorithms', credits:3},
  CSE427:{name:'Machine Learning', credits:3, lab:true},
  CSE428:{name:'Image Processing', credits:3, lab:true, project:true},
  CSE429:{name:'Basic Multimedia Theory', credits:3},
  CSE430:{name:'Digital Signal Processing', credits:3, lab:true},
  CSE431:{name:'Natural Language Processing', credits:3},
  CSE432:{name:'Speech Recognition and Synthesis', credits:3},
  CSE460:{name:'VLSI Design', credits:3, lab:true},
  CSE461:{name:'Introduction to Robotics', credits:3, lab:true},
  CSE462:{name:'Fault-Tolerant Systems', credits:3},
  CSE470:{name:'Software Engineering', credits:3, project:true},
  CSE471:{name:'Systems Analysis and Design', credits:3, lab:true, project:true},
  CSE472:{name:'Human-Computer Interface', credits:3, project:true},
  CSE473:{name:'Financial Engineering & Technology', credits:3},
  CSE474:{name:'Simulation and Modeling', credits:3, lab:true},
  CSE490:{name:'Special Topics', credits:3, project:true},
  CSE491:{name:'Independent Study', credits:3, project:true},
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
    return { code: code, name: COURSE_DB[code].name, credits: COURSE_DB[code].credits, tag: 'course', lab: !!COURSE_DB[code].lab, project: !!COURSE_DB[code].project, prereqs: prereqsOf(code) };
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

// ---- guest mode: data lives only in this browser (localStorage) ----
const GUEST_KEY = 'gradacus-guest-state';
let isGuest = false;
let cloudWasNew = false;
function writeGuest(){
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(state)); setSyncStatus('Saved on this device', 'saved'); }
  catch(err){ console.error('Guest save failed:', err); setSyncStatus('Not saved', 'error'); showToast('Could not save to this device — browser storage may be full or blocked'); }
}
function readGuest(){
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.courses) ? parsed : null;
  } catch(err){ console.error('Guest load failed:', err); return null; }
}
function clearGuest(){ try { localStorage.removeItem(GUEST_KEY); } catch(_){} }
function guestHasWork(g){
  return !!g && ((g.courses||[]).length > 0 || (g.planner && (g.planner.semesters||[]).some(x => x.codes && x.codes.length))
    || ((g.deadlines && g.deadlines.items) || []).length > 0 || String(g.priorCgpa||'') !== '' || String(g.priorCredits||'') !== '');
}

function saveState(){
  if (isGuest && stateLoaded){ writeGuest(); return; }
  if (!currentUser || !stateLoaded) return;
  clearTimeout(saveTimer);
  pendingSaveUid = currentUser.uid;
  setSyncStatus('Saving…', 'saving');
  saveTimer = setTimeout(flushSave, 500);
}

// ---- deadline email reminders: server-side index ----
// The reminder emails are sent by a scheduled Cloud Function (see /functions), not by this page.
// To find users with a reminder due without scanning every account, each save also stores the time of
// the next pending reminder (epoch ms) on the user document. Keep this in step with nextReminderTime()
// in functions/lib/reminders.js.
const REMINDER_GRACE_MS = 15 * 60 * 1000;
function computeNextReminderAt(){
  const d = state && state.deadlines;
  if (!d || !Array.isArray(d.items) || (d.prefs && d.prefs.emailRem === false)) return null;
  const now = Date.now();
  let next = null;
  d.items.forEach(it => {
    if (!it || it.completedAt) return;
    const t = new Date(it.due).getTime();
    if (!(t > now)) return;                                   // overdue or invalid: no reminders
    (Array.isArray(it.reminders) ? it.reminders : []).forEach(m => {
      m = Number(m);
      if (!(m > 0)) return;
      const fireAt = t - m * 60000;
      if (fireAt + REMINDER_GRACE_MS <= now) return;           // too old to be sent any more
      if (next === null || fireAt < next) next = fireAt;
    });
  });
  return next;
}

async function flushSave(){
  clearTimeout(saveTimer);
  if (!pendingSaveUid || !db) return;
  const uid = pendingSaveUid;
  pendingSaveUid = null;
  try{
    state.schemaVersion = APP_SCHEMA_VERSION;
    state.curriculumVersion = CURRICULUM_DATA_VERSION;
    const nextReminderAt = computeNextReminderAt();
    await db.collection('users').doc(uid).set(
      { data: JSON.stringify(state),
        nextReminderAt: nextReminderAt === null ? firebase.firestore.FieldValue.delete() : nextReminderAt },
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
  cloudWasNew = false;
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
    cloudWasNew = true;
    state = freshState();
    loadDefaultCoursesForProgram(state.program);
    return true;
  } catch(err){
    console.error('Load failed:', err);
    state = freshState();
    return false;
  }
}

// ---- semester roadmap planner ----
// Visual, semester-by-semester roadmap. Data lives in state.planner (persisted with the rest of the
// app state): { program, activeSemesterId, currentSemester, roadmapSeeded,
//               semesters: [{ id, number, label, codes: [courseId, ...] }] }.
// Course definitions (titles, credits, lab/project flags, prerequisites) are NOT stored here: they are
// looked up through getCourseInfo() / prereqsOf(), i.e. the curriculum data the app already uses.
const RM_MAX = 5;                    // max courses per semester block
const RM_DEFAULT_BLOCKS = 4;         // upcoming blocks generated by default
const RM_SEMESTERS_TO_GRADUATE = 12; // used only to estimate the current semester from credits earned
const rmEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rmEl = id => document.getElementById(id);
let rmNotice = null;                 // inline message shown in the detail panel (limits, duplicates…)

function rmRequiredCredits(){ return state.planner.program === 'CSE' ? 136 : 124; }

// Estimate: credits earned (CGPA tab + prior credits) divided by the typical credits per semester.
function rmEstimateCurrent(){
  const earned = computeStats().earnedCredits;
  if (!(earned > 0)) return 0;                                   // nothing completed yet
  const per = rmRequiredCredits() / RM_SEMESTERS_TO_GRADUATE;
  return Math.floor(earned / per) + 1;
}
function rmCurrentSemester(){
  const m = state.planner.currentSemester;
  return Number.isInteger(m) && m >= 0 ? m : rmEstimateCurrent();
}

// Prerequisites come from the curriculum data (generated into curriculum-data.js from
// src/data/curriculum.json); custom courses may carry their own `prereqs` array.
function prereqsOf(codeId){
  const custom = state.customCourses && state.customCourses[codeId];
  if (custom) return Array.isArray(custom.prereqs) ? custom.prereqs : [];
  const cur = window.GRADACUS_CURRICULUM;
  const entry = cur && cur.courses && cur.courses[codeId];
  return entry && Array.isArray(entry.prereqs) ? entry.prereqs : [];
}

function activeSemester(){
  return state.planner.semesters.find(s => s.id === state.planner.activeSemesterId) || null;
}
function allPlacedCodes(){
  const set = new Set();
  state.planner.semesters.forEach(s => s.codes.forEach(c => set.add(c)));
  return set;
}
function rmSemesterOf(code){
  return state.planner.semesters.find(s => s.codes.includes(code)) || null;
}

// Makes the stored planner data valid (older saves have only {id,label,codes}); idempotent.
// Returns true if it just generated the default blocks.
function rmNormalize(){
  const pl = state.planner;
  if (!Array.isArray(pl.semesters)) pl.semesters = [];
  pl.semesters.forEach(s => {
    if (!s.id) s.id = crypto.randomUUID();
    s.codes = Array.isArray(s.codes) ? [...new Set(s.codes)] : [];
  });

  // numbers: keep valid unique ones, recover from old "Semester 3"-style labels, else append
  const used = new Set();
  pl.semesters.forEach(s => {
    let n = Number.isInteger(s.number) && s.number >= 1 ? s.number : parseInt((String(s.label || '').match(/\d+/) || [])[0], 10);
    if (!(n >= 1) || used.has(n)) n = null;
    s.number = n;
    if (n) used.add(n);
  });
  let top = Math.max(0, ...used);
  pl.semesters.forEach(s => { if (!s.number){ s.number = ++top; used.add(s.number); } });

  let seeded = false;
  if (!pl.roadmapSeeded){
    pl.roadmapSeeded = true;
    if (pl.semesters.length === 0){
      const start = rmCurrentSemester() + 1;
      for (let i = 0; i < RM_DEFAULT_BLOCKS; i++){
        pl.semesters.push({ id: crypto.randomUUID(), number: start + i, label: '', codes: [] });
      }
      pl.activeSemesterId = pl.semesters[0].id;
      seeded = true;
    }
  }
  pl.semesters.sort((a, b) => a.number - b.number);
  pl.semesters.forEach(s => { s.label = 'Semester ' + s.number; });   // label is derived from the number
  if (!pl.semesters.some(s => s.id === pl.activeSemesterId)) pl.activeSemesterId = null;
  return seeded;
}

function rmStats(sem){
  const infos = sem.codes.map(c => getCourseInfo(c));
  return {
    count: sem.codes.length,
    lab: infos.filter(i => i && i.lab).length,
    project: infos.filter(i => i && i.project).length,
    credits: infos.reduce((sum, i) => sum + (i ? (parseFloat(i.credits) || 0) : 0), 0)
  };
}

function renderPlanner(){
  const seeded = rmNormalize();
  if (seeded) saveState();
  rmEl('plannerProgram').value = state.planner.program;
  rmRenderToolbar();
  rmRenderTrack();
  rmRenderDetail();
  renderPlannerSummary();
}

function rmRenderToolbar(){
  const cur = rmCurrentSemester();
  const input = rmEl('rmCurrent');
  if (document.activeElement !== input) input.value = cur;
  const manual = Number.isInteger(state.planner.currentSemester);
  rmEl('rmCurrentAuto').hidden = !manual;
  const earned = round1(computeStats().earnedCredits);
  rmEl('rmCurrentNote').textContent = manual
    ? 'Set by you.'
    : (earned > 0 ? `Estimated from ${earned} credits earned. Change it if this is off.` : 'No completed credits yet, so you start at Semester 1.');
}

/* ---------------- roadmap track (collapsed blocks) ---------------- */
function rmRenderTrack(){
  const track = rmEl('rmTrack');
  const sems = state.planner.semesters;
  const sel = state.planner.activeSemesterId;
  const cur = rmCurrentSemester();

  let html = `<div class="rm-now" title="Your current semester"><span class="rm-now-dot"></span><span class="rm-now-label">Now</span><span class="rm-now-val">${cur ? 'Sem ' + cur : 'Start'}</span></div>`;
  sems.forEach((sem, i) => {
    const n = sem.codes.length, full = n >= RM_MAX;
    const codes = sem.codes.map(c => (getCourseInfo(c) || {}).code || c);
    const pips = Array.from({ length: RM_MAX }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('');
    const chip = sem.number === cur ? '<span class="rm-chip-now">current</span>' : (sem.number < cur ? '<span class="rm-chip-past">earlier</span>' : '');
    html += `
      <div class="rm-link">${i === 0 ? '' : `<button type="button" class="rm-insert" data-insert="${sem.id}" aria-label="Insert a semester before Semester ${sem.number}" title="Insert a semester here">+</button>`}</div>
      <article class="rm-card${sel === sem.id ? ' selected' : ''}${full ? ' full' : ''}" data-id="${sem.id}">
        <button type="button" class="rm-card-main" data-select="${sem.id}" aria-expanded="${sel === sem.id}" aria-controls="rmDetail">
          <span class="rm-card-top"><span class="rm-sem-label">Semester</span>${chip}</span>
          <span class="rm-sem-num">${sem.number}</span>
          <span class="rm-codes">${n ? codes.map(c => `<span class="rm-code">${rmEsc(c)}</span>`).join('<i class="rm-dot">·</i>') : '<span class="rm-empty">No courses yet</span>'}</span>
          <span class="rm-card-foot"><span class="rm-count">${n} / ${RM_MAX} courses</span><span class="rm-pips" aria-hidden="true">${pips}</span></span>
        </button>
        <button type="button" class="rm-card-add" data-add="${sem.id}">${full ? 'Full · 5 / 5' : '+ Add course'}</button>
      </article>`;
  });
  html += `<div class="rm-link"></div><button type="button" class="rm-add-card" data-add-semester>+ Add semester</button>`;
  track.innerHTML = html;
}

/* ---------------- detail view (expanded block) ---------------- */
function rmRenderDetail(){
  const box = rmEl('rmDetail');
  const sem = activeSemester();
  if (!sem){
    box.innerHTML = `<div class="rm-detail-empty">Select a semester block above to see its courses, totals and edit options.</div>`;
    return;
  }
  const rows = sem.codes.length ? sem.codes.map(code => {
    const c = getCourseInfo(code);
    if (c && c.isCustom){
      return `<div class="rm-row rm-row-custom">
        <input class="custom-edit rm-in-code" data-id="${rmEsc(code)}" data-field="code" value="${rmEsc(c.code)}" aria-label="Course code">
        <input class="custom-edit rm-in-name" data-id="${rmEsc(code)}" data-field="name" value="${rmEsc(c.name)}" aria-label="Course title">
        <span class="rm-row-tags"><span class="tag custom">custom</span></span>
        <input class="custom-edit rm-in-cr" type="number" min="0" step="0.5" data-id="${rmEsc(code)}" data-field="credits" value="${rmEsc(c.credits)}" aria-label="Credits">
        <button type="button" class="icon-btn danger" data-remove="${rmEsc(code)}" aria-label="Remove from Semester ${sem.number}" title="Remove from this semester">✕</button>
      </div>`;
    }
    const tags = `${c && c.lab ? '<span class="tag lab" title="Runs with a lab component">lab</span>' : ''}${c && c.project ? '<span class="tag project" title="Project-centered course">project</span>' : ''}`;
    return `<div class="rm-row">
      <span class="rm-row-code">${rmEsc(c ? c.code : code)}</span>
      <span class="rm-row-title">${rmEsc(c ? c.name : 'Unknown course')}</span>
      <span class="rm-row-tags">${tags}</span>
      <span class="rm-row-cr">${c ? c.credits : 0} cr</span>
      <button type="button" class="icon-btn danger" data-remove="${rmEsc(code)}" aria-label="Remove ${rmEsc(c ? c.code : code)} from Semester ${sem.number}" title="Remove from this semester">✕</button>
    </div>`;
  }).join('') : `<div class="rm-detail-empty">This semester is empty. Use “Add course” to plan it.</div>`;

  box.innerHTML = `
    <div class="rm-detail-head">
      <label class="rm-num-label">Semester
        <input type="number" id="rmNumInput" min="1" step="1" value="${sem.number}" aria-label="Semester number">
      </label>
      <div class="rm-detail-actions">
        <button type="button" class="btn small" id="rmDetailAdd">+ Add course</button>
        <button type="button" class="btn small ghost danger" id="rmDetailDelete">Delete semester</button>
      </div>
    </div>
    <div class="rm-alert" id="rmAlert" role="status" aria-live="polite" ${rmNotice ? '' : 'hidden'}>${rmEsc(rmNotice || '')}</div>
    <div class="rm-rows">${rows}</div>
    <div id="rmSummary">${rmSummaryHtml(sem)}</div>`;
}

function rmSummaryHtml(sem){
  const s = rmStats(sem);
  return `<h4 class="rm-sum-title">Summary</h4>
    <div class="rm-sum">
      <div class="stat"><div class="label">Courses</div><div class="val">${s.count} / ${RM_MAX}</div></div>
      <div class="stat"><div class="label">Lab courses</div><div class="val">${s.lab}</div></div>
      <div class="stat"><div class="label">Project courses</div><div class="val">${s.project}</div></div>
      <div class="stat"><div class="label">Total credits</div><div class="val">${round1(s.credits)}</div></div>
    </div>`;
}

function rmNotify(msg){
  rmNotice = msg;
  rmRenderDetail();
  showToast(msg);
}

/* ---------------- semester actions ---------------- */
function rmSelect(id, { toggle = false } = {}){
  rmNotice = null;
  state.planner.activeSemesterId = (toggle && state.planner.activeSemesterId === id) ? null : id;
  renderPlanner();
  saveState();
  const card = document.querySelector(`.rm-card[data-id="${id}"]`);
  if (card && card.scrollIntoView) card.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
}

function rmAddSemester(){
  rmNotice = null;
  const sems = state.planner.semesters;
  const number = sems.length ? Math.max(...sems.map(s => s.number)) + 1 : rmCurrentSemester() + 1;
  const sem = { id: crypto.randomUUID(), number, label: 'Semester ' + number, codes: [] };
  sems.push(sem);
  state.planner.activeSemesterId = sem.id;
  renderPlanner();
  saveState();
  showToast(`Added Semester ${number}`);
  const card = document.querySelector(`.rm-card[data-id="${sem.id}"]`);
  if (card && card.scrollIntoView) card.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
}

// Insert a block in front of `beforeId`: use the first free number after the previous block, or shift
// the later blocks up by one when the numbers are consecutive.
function rmInsertBefore(beforeId){
  rmNotice = null;
  const sems = state.planner.semesters;
  const idx = sems.findIndex(s => s.id === beforeId);
  if (idx < 0) return;
  const prev = sems[idx - 1];
  const candidate = (prev ? prev.number : sems[idx].number - 1) + 1;
  let shifted = false;
  if (sems.some(s => s.number === candidate)){
    sems.forEach(s => { if (s.number >= candidate) s.number += 1; });
    shifted = true;
  }
  const sem = { id: crypto.randomUUID(), number: candidate, label: 'Semester ' + candidate, codes: [] };
  sems.push(sem);
  state.planner.activeSemesterId = sem.id;
  renderPlanner();
  saveState();
  showToast(shifted ? `Inserted Semester ${candidate}. Later semesters moved up by one.` : `Inserted Semester ${candidate}`);
}

function rmChangeNumber(raw){
  const sem = activeSemester();
  if (!sem) return;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1){
    rmNotify('Enter a whole semester number of 1 or more.');
    rmEl('rmNumInput').value = sem.number;
    return;
  }
  if (n === sem.number) return;
  const clash = state.planner.semesters.find(s => s.id !== sem.id && s.number === n);
  if (clash){
    rmNotice = `Semester ${n} already exists in your roadmap. Choose a different number.`;
    renderPlanner();
    showToast(rmNotice);
    return;
  }
  rmNotice = null;
  sem.number = n;                       // only the label/order changes; courses stay with the block
  renderPlanner();
  saveState();
  showToast(`Renumbered to Semester ${n}`);
}

function rmDeleteSemester(id){
  const sems = state.planner.semesters;
  const idx = sems.findIndex(s => s.id === id);
  if (idx < 0) return;
  const [removed] = sems.splice(idx, 1);             // only the roadmap block goes; course data is untouched
  if (state.planner.activeSemesterId === id){
    const next = sems[idx] || sems[idx - 1] || null;
    state.planner.activeSemesterId = next ? next.id : null;
  }
  rmNotice = null;
  renderPlanner();
  saveState();
  showToast(`Deleted Semester ${removed.number}`);
}

function rmRequestDelete(id){
  const sem = state.planner.semesters.find(s => s.id === id);
  if (!sem) return;
  if (sem.codes.length === 0){ rmDeleteSemester(id); return; }
  const m = rmOpenModal({
    title: `Delete Semester ${sem.number}?`,
    body: `<p>Semester ${sem.number} has <b>${sem.codes.length}</b> planned course${sem.codes.length === 1 ? '' : 's'}
      (${sem.codes.map(c => rmEsc((getCourseInfo(c) || {}).code || c)).join(', ')}).</p>
      <p>Deleting it removes this block and its plan from your roadmap. The courses themselves are not deleted and can be added to another semester.</p>`,
    footer: `<button type="button" class="btn ghost" data-act="cancel">Cancel</button><button type="button" class="btn danger" data-act="delete">Delete semester</button>`,
    focus: '[data-act="cancel"]'
  });
  m.q('[data-act="cancel"]').addEventListener('click', m.close);
  m.q('[data-act="delete"]').addEventListener('click', () => { m.close(); rmDeleteSemester(id); });
}

function rmRemoveCourse(code){
  const sem = activeSemester();
  if (!sem) return;
  const i = sem.codes.indexOf(code);
  if (i < 0) return;
  sem.codes.splice(i, 1);
  rmNotice = null;
  renderPlanner();
  saveState();
  showToast(`Removed ${(getCourseInfo(code) || {}).code || code} from Semester ${sem.number}`);
}

/* ---------------- adding a course ---------------- */
function rmMaxMessage(sem){
  return `Semester ${sem.number} already has the maximum of ${RM_MAX} courses. Remove one before adding another.`;
}

// The only place a course is actually added — re-checks every rule.
function rmAddCourseToSemester(sem, code){
  if (sem.codes.length >= RM_MAX){ rmNotify(rmMaxMessage(sem)); return false; }
  if (sem.codes.includes(code)){ rmNotify(`${(getCourseInfo(code) || {}).code || code} is already in Semester ${sem.number}.`); return false; }
  const elsewhere = rmSemesterOf(code);
  if (elsewhere){ rmNotify(`${(getCourseInfo(code) || {}).code || code} is already planned in Semester ${elsewhere.number}.`); return false; }
  sem.codes.push(code);
  rmNotice = null;
  state.planner.activeSemesterId = sem.id;
  renderPlanner();
  saveState();
  showToast(`Added ${(getCourseInfo(code) || {}).code || code} to Semester ${sem.number}`);
  return true;
}

function rmPrereqStatus(prereqCode, sem){
  const key = String(prereqCode).trim().toUpperCase();
  const done = state.courses.some(c => {
    if (c.replaced || String(c.code || '').trim().toUpperCase() !== key) return false;
    const g = gradeFromLetter(c.grade);
    return g && g.point > 0;
  });
  if (done) return { kind: 'done', text: 'Graded on your CGPA tab' };
  const planned = rmSemesterOf(prereqCode);
  if (planned){
    return planned.number < sem.number
      ? { kind: 'planned', text: `Planned in Semester ${planned.number}` }
      : { kind: 'late', text: `Planned in Semester ${planned.number}, not before this one` };
  }
  return { kind: 'none', text: 'No record in Gradacus' };
}

function rmOpenPrereqConfirm(sem, code, prereqs, onAdded){
  const info = getCourseInfo(code) || { code, name: '' };
  const items = prereqs.map(p => {
    const pi = getCourseInfo(p);
    const st = rmPrereqStatus(p, sem);
    return `<li class="rm-prereq"><span class="rm-prereq-code">${rmEsc(p)}</span>
      <span class="rm-prereq-title">${rmEsc(pi ? pi.name : 'Title not available')}</span>
      <span class="rm-chip ${st.kind}">${rmEsc(st.text)}</span></li>`;
  }).join('');
  const many = prereqs.length > 1;
  const m = rmOpenModal({
    title: 'Prerequisites required',
    body: `<div class="rm-sel"><b>${rmEsc(info.code)}</b> <span>${rmEsc(info.name)}</span></div>
      <p class="rm-mlabel">Required prerequisite course${many ? 's' : ''}${many ? ` (${prereqs.length})` : ''}</p>
      <ul class="rm-prereqs">${items}</ul>
      <p class="rm-warn">Only add this course if you have <b>already completed ${many ? 'all of these prerequisites' : 'this prerequisite'}</b>.
      Gradacus can’t check this for you. Choosing “Confirm &amp; Add” means you confirm that you have completed ${many ? 'them' : 'it'}.</p>`,
    footer: `<button type="button" class="btn ghost" data-act="cancel">Cancel</button><button type="button" class="btn" data-act="ok">Confirm &amp; Add</button>`,
    focus: '[data-act="cancel"]'
  });
  m.q('[data-act="cancel"]').addEventListener('click', m.close);
  m.q('[data-act="ok"]').addEventListener('click', () => {
    m.close();
    if (rmAddCourseToSemester(sem, code) && onAdded) onAdded();
  });
}

function rmChooseCourse(semId, code, onAdded){
  const sem = state.planner.semesters.find(s => s.id === semId);
  if (!sem) return;
  if (sem.codes.length >= RM_MAX){ rmNotify(rmMaxMessage(sem)); if (onAdded) onAdded(true); return; }
  const prereqs = prereqsOf(code);
  if (prereqs.length === 0){
    if (rmAddCourseToSemester(sem, code) && onAdded) onAdded();
    return;
  }
  rmOpenPrereqConfirm(sem, code, prereqs, onAdded);
}

function rmOpenPicker(semId){
  let sem = state.planner.semesters.find(s => s.id === semId);
  if (!sem) return;
  if (sem.codes.length >= RM_MAX){
    state.planner.activeSemesterId = sem.id;
    renderPlanner();
    rmNotify(rmMaxMessage(sem));
    return;
  }
  state.planner.activeSemesterId = sem.id;
  rmNotice = null;
  renderPlanner();

  const m = rmOpenModal({
    title: `Add course to Semester ${sem.number}`,
    wide: true,
    body: `<div class="rm-pick-filters">
        <input type="search" id="rmPickSearch" placeholder="Search course or code…" aria-label="Search courses">
        <select id="rmPickCat" aria-label="Category">
          <option value="all">All</option><option value="core">Core</option><option value="elective">Elective</option>
          <option value="foundation">Foundation</option><option value="custom">Custom</option>
        </select>
      </div>
      <div class="rm-alert" id="rmPickBanner" role="status" aria-live="polite" hidden></div>
      <div class="rm-pick-list" id="rmPickList"></div>`,
    footer: `<button type="button" class="btn ghost" data-act="custom">+ Custom course</button>
      <span class="rm-spacer"></span><span class="rm-pick-count" id="rmPickCount"></span>
      <button type="button" class="btn" data-act="done">Done</button>`,
    focus: '#rmPickSearch'
  });

  const banner = m.q('#rmPickBanner');
  const showBanner = msg => { banner.textContent = msg; banner.hidden = !msg; };

  function renderList(){
    sem = state.planner.semesters.find(s => s.id === semId);
    if (!sem){ m.close(); return; }
    const full = sem.codes.length >= RM_MAX;
    m.q('#rmPickCount').textContent = `${sem.codes.length} / ${RM_MAX} in Semester ${sem.number}`;
    if (full) showBanner(rmMaxMessage(sem));
    const search = m.q('#rmPickSearch').value.trim().toLowerCase();
    const cat = m.q('#rmPickCat').value;
    const placed = allPlacedCodes();

    const pool = getPoolForProgram(state.planner.program).filter(i => !placed.has(i.code));
    let items = pool;
    if (cat !== 'all') items = items.filter(i => i.tag === cat);
    if (search) items = items.filter(i => {
      const info = getCourseInfo(i.code);
      return (info ? info.code : i.code).toLowerCase().includes(search) || (info && String(info.name).toLowerCase().includes(search));
    });
    items.sort((a, b) => ((getCourseInfo(a.code) || {}).code || a.code).localeCompare((getCourseInfo(b.code) || {}).code || b.code));

    const list = m.q('#rmPickList');
    if (items.length === 0){
      list.innerHTML = `<div class="rm-detail-empty">${pool.length === 0
        ? 'No courses are available to add. Every course in this list is already planned in your roadmap.'
        : 'No courses match your search.'}</div>`;
      return;
    }
    const doneCodes = new Set(state.courses.filter(c => { const g = gradeFromLetter(c.grade); return !c.replaced && g && g.point > 0; })
      .map(c => String(c.code || '').trim().toUpperCase()));
    list.innerHTML = items.map(i => {
      const info = getCourseInfo(i.code) || { code: i.code, name: 'Unknown', credits: 3 };
      const np = prereqsOf(i.code).length;
      const completed = doneCodes.has(String(info.code).toUpperCase());
      return `<div class="rm-pick-item${full ? ' is-full' : ''}">
        <div class="rm-pick-info">
          <div class="rm-pick-line">
            <span class="code">${rmEsc(info.code)}</span>
            <span class="tag ${rmEsc(i.tag)}">${rmEsc(i.tag)}</span>
            ${info.lab ? '<span class="tag lab">lab</span>' : ''}${info.project ? '<span class="tag project">project</span>' : ''}
            <span class="credit-badge">${info.credits}cr</span>
            ${np ? `<span class="rm-prq" title="Has prerequisites">${np} prerequisite${np === 1 ? '' : 's'}</span>` : ''}
            ${completed ? '<span class="rm-prq done" title="Already graded on your CGPA tab">completed</span>' : ''}
          </div>
          <div class="name">${rmEsc(info.name)}</div>
        </div>
        <div class="pool-actions">
          <button type="button" class="btn small" data-pick="${rmEsc(i.code)}">+ Add</button>
          ${i.tag === 'custom' ? `<button type="button" class="icon-btn text-btn danger" data-delete-custom="${rmEsc(i.code)}">Delete</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  m.q('#rmPickSearch').addEventListener('input', renderList);
  m.q('#rmPickCat').addEventListener('change', renderList);
  m.q('[data-act="done"]').addEventListener('click', m.close);

  m.q('#rmPickList').addEventListener('click', e => {
    const pick = e.target.closest('[data-pick]');
    const del = e.target.closest('[data-delete-custom]');
    if (pick){
      showBanner('');
      rmChooseCourse(semId, pick.dataset.pick, full => { if (!full) showBanner(''); renderList(); });
      return;
    }
    if (del){
      if (!del.classList.contains('armed')){
        del.classList.add('armed'); del.textContent = 'Confirm?';
        setTimeout(() => { del.classList.remove('armed'); del.textContent = 'Delete'; }, 3000);
        return;
      }
      deleteCustomCourse(del.dataset.deleteCustom);
      renderList();
    }
  });

  m.q('[data-act="custom"]').addEventListener('click', () => {
    sem = state.planner.semesters.find(s => s.id === semId);
    if (!sem) return;
    if (sem.codes.length >= RM_MAX){ showBanner(rmMaxMessage(sem)); return; }
    if (!state.customCourses) state.customCourses = {};
    const id = 'CUST_' + crypto.randomUUID();
    state.customCourses[id] = { code: 'CUSTOM', name: 'Click here to edit name', credits: 3, tag: 'custom', isCustom: true };
    sem.codes.push(id);
    state.planner.activeSemesterId = sem.id;
    m.close();
    renderPlanner();
    saveState();
    setTimeout(() => { const inp = document.querySelector('#rmDetail .rm-in-code'); if (inp){ inp.focus(); inp.select(); } }, 60);
  });

  renderList();
}

// Delete a custom course entirely (also pulls it out of any semester it was placed in).
function deleteCustomCourse(id){
  const info = state.customCourses && state.customCourses[id];
  if (!info) return;
  delete state.customCourses[id];
  state.planner.semesters.forEach(sem => { sem.codes = sem.codes.filter(c => c !== id); });
  renderPlanner();
  saveState();
  showToast(`Deleted custom course ${info.code || ''}`.trim());
}

/* ---------------- modal helper (stackable, Esc closes the top one) ---------------- */
const rmModalStack = [];
function rmOpenModal({ title, body, footer, wide, focus }){
  const prevFocus = document.activeElement;
  const uid = 'rmM' + Math.random().toString(36).slice(2, 8);
  const overlay = document.createElement('div');
  overlay.className = 'rm-modal';
  overlay.innerHTML = `<div class="rm-mbox${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${uid}">
      <div class="rm-mhead"><h3 id="${uid}">${rmEsc(title)}</h3><button type="button" class="icon-btn" data-x aria-label="Close">✕</button></div>
      <div class="rm-mbody">${body}</div>${footer ? `<div class="rm-mfoot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('rm-modal-open');
  let closed = false;
  const api = {
    el: overlay,
    q: sel => overlay.querySelector(sel),
    close(){
      if (closed) return;
      closed = true;
      const i = rmModalStack.indexOf(api);
      if (i >= 0) rmModalStack.splice(i, 1);
      overlay.remove();
      if (!rmModalStack.length) document.body.classList.remove('rm-modal-open');
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
    }
  };
  rmModalStack.push(api);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) api.close(); });
  overlay.querySelector('[data-x]').addEventListener('click', api.close);
  const first = (focus && overlay.querySelector(focus)) || overlay.querySelector('button, input, select');
  if (first) setTimeout(() => first.focus(), 0);
  return api;
}
document.addEventListener('keydown', e => {
  if (!rmModalStack.length) return;
  const top = rmModalStack[rmModalStack.length - 1];
  if (e.key === 'Escape'){ e.preventDefault(); top.close(); return; }
  if (e.key === 'Tab'){                                   // keep focus inside the dialog
    const f = Array.from(top.el.querySelectorAll('button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])'));
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); }
  }
});

/* ---------------- events ---------------- */
rmEl('rmTrack').addEventListener('click', e => {
  const sel = e.target.closest('[data-select]');
  const add = e.target.closest('[data-add]');
  const ins = e.target.closest('[data-insert]');
  const addSem = e.target.closest('[data-add-semester]');
  if (add) return rmOpenPicker(add.dataset.add);
  if (sel) return rmSelect(sel.dataset.select, { toggle: true });
  if (ins) return rmInsertBefore(ins.dataset.insert);
  if (addSem) return rmAddSemester();
});

rmEl('rmDetail').addEventListener('click', e => {
  const sem = activeSemester();
  if (!sem) return;
  if (e.target.closest('#rmDetailAdd')) return rmOpenPicker(sem.id);
  if (e.target.closest('#rmDetailDelete')) return rmRequestDelete(sem.id);
  const rem = e.target.closest('[data-remove]');
  if (rem) rmRemoveCourse(rem.dataset.remove);
});
rmEl('rmDetail').addEventListener('change', e => {
  if (e.target.id === 'rmNumInput') rmChangeNumber(e.target.value);
});
rmEl('rmDetail').addEventListener('keydown', e => {
  if (e.target.id === 'rmNumInput' && e.key === 'Enter'){ e.preventDefault(); e.target.blur(); }
});
// inline edits of custom courses (title / code / credits) — update totals without rebuilding the rows
rmEl('rmDetail').addEventListener('input', e => {
  const input = e.target.closest('.custom-edit');
  if (!input) return;
  const { id, field } = input.dataset;
  if (!state.customCourses || !state.customCourses[id]) return;
  state.customCourses[id][field] = field === 'credits' ? (parseFloat(input.value) || 0) : input.value;
  saveState();
  rmRenderTrack();
  const sem = activeSemester();
  if (sem) rmEl('rmSummary').innerHTML = rmSummaryHtml(sem);
  renderPlannerSummary();
});

rmEl('rmAddSemester').addEventListener('click', rmAddSemester);
rmEl('rmCurrent').addEventListener('change', e => {
  const n = parseInt(e.target.value, 10);
  if (!Number.isInteger(n) || n < 0){ rmEl('rmCurrent').value = rmCurrentSemester(); return; }
  state.planner.currentSemester = n;
  renderPlanner();
  saveState();
});
rmEl('rmCurrentAuto').addEventListener('click', () => {
  state.planner.currentSemester = null;
  renderPlanner();
  saveState();
});

function renderPlannerSummary(){
  const completed = computeStats().earnedCredits;

  const planned = state.planner.semesters.reduce((sum, sem) =>
    sum + sem.codes.reduce((s2, c) => {
      const info = getCourseInfo(c);
      return s2 + (info?.credits || 0);
    }, 0), 0);

  const required = rmRequiredCredits();
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
  const nudge = document.getElementById('signupNudge');
  if (nudge) nudge.style.display = mode === 'login' ? 'block' : 'none';
  setAuthMessage('');
}

document.getElementById('authSwitchBtn').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'signup' : 'login');
});
const signupNudgeBtn = document.getElementById('signupNudgeBtn');
if (signupNudgeBtn) signupNudgeBtn.addEventListener('click', () => setAuthMode('signup'));

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
  // Any auth-state change from here on is the direct result of this click, not
  // a session Firebase silently restored on page load — so it should never
  // trigger the old-session migration sign-out below.
  justSignedIn = true;
  try{
    if (authMode === 'login'){
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
  } catch(err){
    justSignedIn = false;
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

function setUserBar(mode){
  const guest = mode === 'guest';
  document.getElementById('userBarLabel').textContent = guest ? 'Guest mode' : 'Signed in as';
  document.getElementById('userEmail').style.display = guest ? 'none' : '';
  document.getElementById('guestHint').style.display = guest ? '' : 'none';
  document.getElementById('logoutBtn').style.display = guest ? 'none' : '';
  document.getElementById('guestSignInBtn').style.display = guest ? '' : 'none';
}

function enterGuest(){
  authSeq++;
  currentUser = null;
  isGuest = true;
  const saved = readGuest();
  if (saved){
    state = saved;
    state.schemaVersion = APP_SCHEMA_VERSION;
    state.curriculumVersion = state.curriculumVersion || CURRICULUM_DATA_VERSION;
    if (!state.planner || !Array.isArray(state.planner.semesters)) state.planner = defaultPlanner();
    if (!state.customCourses) state.customCourses = {};
  } else {
    state = freshState();
    loadDefaultCoursesForProgram(state.program);
  }
  stateLoaded = true;
  if (window.dlEnsure) dlEnsure();
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
  document.getElementById('loadBanner').style.display = 'none';
  setUserBar('guest');
  setSyncStatus('Saved on this device', 'saved');
  render();
  renderPlanner();
  if (window.dlRender) dlRender();
  window.scrollTo(0, 0);
}

function leaveGuestForAuth(mode){
  if (isGuest) writeGuest();    // keep their work so it can move into the account
  isGuest = false;
  stateLoaded = false;
  state = freshState();
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('authOverlay').style.display = 'flex';
  setAuthMode(mode);
  window.scrollTo(0, 0);
}

document.getElementById('guestBtn').addEventListener('click', enterGuest);
document.getElementById('guestSignInBtn').addEventListener('click', () => leaveGuestForAuth('login'));

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
  isGuest = false;
  let adopted = false;
  if (ok && cloudWasNew){
    const g = readGuest();
    if (guestHasWork(g)){ state = g; adopted = true; }
  }
  if (window.dlEnsure) dlEnsure();

  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
  document.getElementById('userEmail').textContent = user.email;
  setUserBar('user');
  if (ok && !adopted) saveState();     // refreshes the server-side reminder index (nextReminderAt) and saved time zone
  if (adopted){ saveState(); clearGuest(); showToast('Your guest data was moved into your new account'); }
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
      if (!sessionMigrationDone && !justSignedIn){
        // This user wasn't just typed in — Firebase restored them from a
        // session saved under the old "remember forever" persistence. Sign
        // them out once so they land on the login screen like everyone else;
        // once they log back in it's stored session-only from then on.
        sessionMigrationDone = true;
        localStorage.setItem('authSessionMigrationDone', '1');
        auth.signOut();
        return; // the resulting sign-out will re-fire this listener with user=null
      }
      sessionMigrationDone = true;
      localStorage.setItem('authSessionMigrationDone', '1');
      justSignedIn = false;
      enterApp(user);
    } else {
      authSeq++;
      currentUser = null;
      if (isGuest) return;   // a guest session is running; don't tear it down
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
const PRIO = { low:{l:'Low',c:'var(--text-dim)',w:0}, medium:{l:'Medium',c:'var(--ash)',w:1}, high:{l:'High',c:'var(--text)',w:2} };
const COLORS = ['#9382ff','#e59cff','#9cb2ff','#ba9cff','#cdccd0','#7d62ff','#c4b5fd','#a8a6b7'];
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
const reminderHint = () => isGuest
  ? 'Reminders are sent by email to your account address. Sign in to receive them.'
  : (D().prefs.emailRem === false
    ? 'Deadline email reminders are turned off. Turn them on in Courses &amp; settings to be emailed.'
    : `Reminders are emailed to ${currentUser && currentUser.email ? esc(currentUser.email) : 'your account address'}, even when this page is closed.`);
const remLabel = m => m % 1440 === 0 ? `${m/1440} day${m/1440>1?'s':''}` : m % 60 === 0 ? `${m/60} hour${m/60>1?'s':''}` : `${m} min`;

function ensure(){
  const d = state.deadlines = state.deadlines || {};
  d.items = d.items || []; d.courses = d.courses || []; d.customTypes = d.customTypes || [];
  d.prefs = Object.assign({ defRem:[1440,60], urgentH:48, emailRem:true, view:'list', period:14 }, d.prefs || {});
  delete d.prefs.notif;                                   // browser notifications were removed — reminders are emailed now
  // The server turns a deadline's wall-clock time into an instant using this zone.
  try { d.prefs.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || d.prefs.tz; } catch (e) {}
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
function render(){ if (!state.deadlines) return; ensure(); renderViz(); renderSummary(); renderToolbar(); renderContent(); }

/* ---------- visual insights ---------- */
function renderViz(){
  const el = $('dlViz'); if (!el) return;
  const now = Date.now(), items = D().items, act = items.filter(i => !i.completedAt);
  if (!items.length){ el.innerHTML = ''; return; }
  const DAYS = 7, today = sod(new Date());

  /* 1. next-7-days workload (line chart: deadlines due per day) */
  const over = act.filter(i => +due(i) < now).length;
  const cols = [];
  for (let k = 0; k < DAYS; k++){
    const d = new Date(+today + k*DAY), key = dstr(d);
    const its = act.filter(i => +due(i) >= now && dstr(due(i)) === key);
    cols.push({ d, key, its });
  }
  const mx = Math.max(3, ...cols.map(c => c.its.length));
  const nextN = cols.reduce((s, c) => s + c.its.length, 0);
  const px = k => (k + .5) / DAYS * 100, py = n => 8 + (1 - n / mx) * 84;       /* shared % mapping for svg + html layers */
  const P = cols.map((c, k) => [px(k) * 7, py(c.its.length)]);                    /* svg is 700 x 100 */
  let path = `M${P[0][0]} ${P[0][1]}`;
  for (let k = 1; k < P.length; k++){ const mxp = (P[k-1][0] + P[k][0]) / 2; path += ` C${mxp} ${P[k-1][1]} ${mxp} ${P[k][1]} ${P[k][0]} ${P[k][1]}`; }
  const area = `${path} L${P[P.length-1][0]} 100 L${P[0][0]} 100 Z`;
  const grid = [0, 1, 2, 3].map(g => `<line x1="0" x2="700" y1="${py(mx * g / 3)}" y2="${py(mx * g / 3)}"/>`).join('');
  const tip = c => `${c.d.toLocaleDateString('en-US', {weekday:'long', month:'short', day:'numeric'})}: ${c.its.length} due` + (c.its.length ? ' - ' + c.its.map(i => i.title).join(', ') : '');
  const lineChart = `<div class="vz-line">
      <svg viewBox="0 0 700 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="vzArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9382ff" stop-opacity=".35"/><stop offset="1" stop-color="#9382ff" stop-opacity="0"/></linearGradient>
          <linearGradient id="vzStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9cb2ff"/><stop offset=".5" stop-color="#ba9cff"/><stop offset="1" stop-color="#e59cff"/></linearGradient></defs>
        <g class="vz-grid">${grid}</g><path d="${area}" fill="url(#vzArea)"/><path d="${path}" class="vz-ln" stroke="url(#vzStroke)"/></svg>
      ${cols.map((c, k) => `<button type="button" class="vz-pt ${k === 0 ? 'vz-today' : ''}" data-vday="${c.key}" title="${esc(tip(c))}" style="left:${px(k)}%;top:${py(c.its.length)}%"><span>${c.its.length}</span></button>`).join('')}
    </div>
    <div class="vz-xl">${cols.map((c, k) => `<div class="${k === 0 ? 'vz-today' : ''}"><b>${c.d.getDate()}</b><small>${k === 0 ? 'today' : WD[c.d.getDay()]}</small></div>`).join('')}</div>`;

  /* 2. completion streak (consecutive days with at least one deadline completed) */
  const dn = d => Math.round(+sod(d) / DAY);               // day number, DST-safe
  const doneDays = new Set(items.filter(i => i.completedAt).map(i => dn(new Date(i.completedAt))));
  const t0 = dn(today), doneToday = doneDays.has(t0);
  let streak = 0;
  for (let k = doneToday ? t0 : t0 - 1; doneDays.has(k); k--) streak++;   // today not done yet? the streak is still alive until midnight
  let best = 0, run = 0, prev = null;
  [...doneDays].sort((x, y) => x - y).forEach(k => { run = prev !== null && k === prev + 1 ? run + 1 : 1; prev = k; if (run > best) best = run; });
  const nd = String(streak).length;
  const flame = `<svg class="vz-fire ${streak ? 'on' : ''}" viewBox="0 0 100 120" role="img" aria-label="${streak} day streak">
      <defs><linearGradient id="vzFire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5046e4"/><stop offset=".55" stop-color="#9382ff"/><stop offset="1" stop-color="#e59cff"/></linearGradient></defs>
      <path class="vz-fire-o" d="M50 3C54 22 79 37 85 66C91 95 73 117 50 117C27 117 9 95 15 66C18 52 27 44 31 33C35 46 40 51 45 50C42 34 44 18 50 3Z" fill="url(#vzFire)"/>
      <path class="vz-fire-i" d="M50 22C53 36 71 47 75 67C79 88 66 105 50 105C34 105 21 88 25 67C27 58 33 52 36 46C39 54 43 57 47 56C45 44 46 33 50 22Z" fill="var(--midnight)"/>
      <text x="50" y="${nd > 2 ? 83 : 86}" text-anchor="middle" class="vz-fire-n" style="font-size:${nd > 2 ? 30 : nd > 1 ? 38 : 46}px">${streak}</text></svg>`;
  const streakHtml = `<div class="vz-streak">${flame}
      <div class="vz-streak-lbl">day streak</div>
      <div class="vz-best">Best streak <b>${best} day${best === 1 ? '' : 's'}</b></div></div>`;

  /* 3. status breakdown */
  const done = items.filter(i => i.completedAt);
  const onTime = done.filter(i => +new Date(i.completedAt) <= +due(i)).length, late = done.length - onTime;
  const started = act.filter(i => +due(i) >= now && prog(i) > 0).length;
  const notStarted = act.filter(i => +due(i) >= now && prog(i) === 0).length;
  const st = [['Done on time', onTime, '#9382ff'], ['Done late', late, '#e59cff'], ['In progress', started, '#9cb2ff'], ['Not started', notStarted, '#54525f'], ['Overdue', over, '#a8a6b7']].filter(s => s[1] > 0);
  const all = st.reduce((s, x) => s + x[1], 0) || 1;
  const pct = done.length ? Math.round(onTime / done.length * 100) : null;

  el.innerHTML = `<div class="panel vz-wide"><h2><span class="dot"></span>Next ${DAYS} days</h2>
      <div class="vz-sub">${nextN} due${over ? ` · <b>${over} overdue</b>` : ''} · click a day to open it in the calendar</div>
      ${lineChart}</div>
    <div class="panel"><h2><span class="dot"></span>Streak</h2>${streakHtml}</div>
    <div class="panel"><h2><span class="dot"></span>Status</h2>
      <div class="vz-stat"><b>${pct === null ? '—' : pct + '%'}</b><span>completed on time</span></div>
      <div class="vz-seg">${st.map(s => `<i style="flex:${s[1]};background:${s[2]}" title="${s[0]}: ${s[1]}"></i>`).join('')}</div>
      <div class="vz-legend">${st.map(s => `<div><i style="background:${s[2]}"></i><span>${s[0]}</span><b>${s[1]}</b></div>`).join('')}</div></div>`;
}

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
    <div class="field"><label>Reminders</label><div id="f_rem"></div><div class="hint">${reminderHint()}</div></div>
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
      Object.assign(it, base, { due: dueStr });
      if ($('f_series') && $('f_series').checked) D().items.forEach(o => {
        if (o !== it && o.seriesId === it.seriesId && !o.completedAt && +due(o) > +due(it)){
          Object.assign(o, { title, courseId: base.courseId, type, priority: base.priority, notes: base.notes, reminders: base.reminders.slice() });
          o.due = dstr(due(o)) + 'T' + time;
        }
      });
    } else {
      const o = Object.assign({}, base, { id: uid(), due: dueStr, seriesId: null, completedAt: null, createdAt: new Date().toISOString(),
        reminders: base.reminders.slice(), subtasks: base.subtasks.map(s => ({ id: uid(), text: s.text, done: s.done })) });
      D().items.push(o);
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
      <div class="field"><label>Deadline email reminders</label><button class="btn small ${P.emailRem && !isGuest ? '' : 'ghost'}" data-emailrem ${isGuest ? 'disabled' : ''}>${isGuest ? 'Sign in to use' : (P.emailRem ? 'On — click to turn off' : 'Off — click to turn on')}</button></div></div>
    <div class="hint">${reminderHint()}</div>`);
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
    } else if (t.dataset.emailrem !== undefined){
      P.emailRem = !P.emailRem; commit(); openSettings();
      showToast(P.emailRem ? 'Deadline email reminders are on' : 'Deadline email reminders are off');
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

/* ---------- wiring ---------- */
function init(){
  document.body.insertAdjacentHTML('beforeend', '<div class="dl-modal" id="dlModal"><div class="dl-mbox"><button class="icon-btn dl-x" id="dlClose">✕</button><div id="dlMbody"></div></div></div>');
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
  $('dlViz').onclick = e => {
    const c = e.target.closest('[data-vday]'); if (!c) return;
    calSel = c.dataset.vday; calMonth = new Date(calSel + 'T00:00'); calMonth.setDate(1);
    D().prefs.view = 'calendar'; saveState(); render();
    $('dlContent').scrollIntoView({ behavior:'smooth', block:'start' });
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
    if (!state.deadlines || typeof currentUser === 'undefined' || !(currentUser || isGuest) || !stateLoaded){ if ($('dlModal').classList.contains('open')) closeModal(); return; }
    tk++;
    document.querySelectorAll('.cd[data-due]').forEach(el => {
      const ms = +el.dataset.due - Date.now();
      el.textContent = cd(ms); el.classList.toggle('over', ms < 0); el.classList.toggle('soon', ms >= 0 && ms < D().prefs.urgentH * 36e5);
    });
    if (tk % 60 === 0 && $('page-deadlines').classList.contains('active') && !$('dlModal').classList.contains('open')){ renderSummary(); renderContent(); }
  }, 1000);
}

/* ---------- dashboard page ---------- */
function dbRender(){
  const el = id => document.getElementById(id);
  if (!el('page-dashboard') || !state) return;
  ensure();
  const st = computeStats();
  const required = parseFloat(state.program) || 136;
  const pct = Math.min(100, Math.round((st.earnedCredits / required) * 100));

  el('dbCgpa').textContent = st.cgpa === null ? '--' : st.cgpa.toFixed(2);
  el('dbCgpa').classList.toggle('dim', st.cgpa === null);
  const graded = state.courses.filter(c => c.included && !c.replaced && gradeFromLetter(c.grade)).length;
  el('dbCgpaNote').textContent = st.cgpa === null
    ? 'Add grades on the CGPA tab to see your CGPA.'
    : graded + ' graded course' + (graded === 1 ? '' : 's') + ' counted';
  el('dbCredits').textContent = round1(st.earnedCredits) + ' / ' + required + ' credits';
  if (!window.dashDial && typeof window.CometDial === 'function'){
    window.dashDial = window.CometDial(el('dbDial'), {
      defaultValue: 0, min: 0, max: 100, step: 1, unit: '%', label: 'Degree completion',
      caption: 'complete', readOnly: true, accent: '#ba9cff', ink: '#f4f0ff',
      size: 240, sweep: 320, thickness: 5, speed: 30, tapBounce: 0.15, cometReach: 180, cometWidth: 12
    });
  }
  if (window.dashDial) window.dashDial.setValue(pct);
  el('dbProgram').textContent = required === 136 ? 'CSE degree' : 'CS degree';
  el('dbLeft').textContent = round1(Math.max(required - st.earnedCredits, 0)) + ' credits left';

  // tiles
  const now = Date.now();
  const open = D().items.filter(i => !i.completedAt);
  const overdue = open.filter(i => +due(i) < now).length;
  const week = open.filter(i => +due(i) >= now && +due(i) < now + 7 * DAY).length;
  const done = D().items.length - open.length;
  el('dbTiles').innerHTML = [
    [week, 'due in 7 days'], [overdue, 'overdue'], [done, 'completed'], [state.courses.length, 'courses on CGPA table']
  ].map(t => `<div class="stat"><div class="label">${t[1]}</div><div class="val">${t[0]}</div></div>`).join('');

  // upcoming deadlines
  const next = open.slice().sort((a, b) => due(a) - due(b)).slice(0, 5);
  el('dbDeadlines').innerHTML = next.length ? next.map(it => {
    const c = course(it.courseId), d = due(it);
    return `<div class="db-row" style="--cc:${c ? c.color : 'var(--text-dim)'}">
      <div class="db-row-main"><div class="db-row-title">${esc(it.title)}</div>
      <div class="db-row-meta">${c ? esc(c.code) + ' · ' : ''}${esc(it.type || '')} · ${fmtDate(d)}, ${fmtTime(d)}</div></div>
      <div class="db-row-side">${cdHtml(it)}</div></div>`;
  }).join('') : '<div class="dl-empty">Nothing pending. Add a deadline to see it here.</div>';

  // current semester
  const sems = (state.planner.semesters || []).slice().sort((x, y) => (x.number || 0) - (y.number || 0));
  const sem = sems.find(x => x.codes.length) || sems[0];       // first roadmap block that has courses
  if (!sem){
    el('dbSemester').innerHTML = '<div class="dl-empty">No semester planned yet.</div>';
  } else {
    let total = 0;
    const rows = sem.codes.map(code => {
      const info = getCourseInfo(code), cr = info ? info.credits : 0;
      total += cr;
      return `<div class="db-row"><div class="db-row-main"><div class="db-row-title">${esc(code)}</div>
        <div class="db-row-meta">${esc(info ? info.name : '')}</div></div><div class="db-row-side">${cr} cr</div></div>`;
    }).join('');
    el('dbSemester').innerHTML = `<div class="db-sem-head"><b>${esc(sem.label)}</b><span>${round1(total)} credits</span></div>` +
      (rows || '<div class="dl-empty">No courses added to this semester yet.</div>');
  }

  // grade snapshot
  const counts = {};
  state.courses.forEach(c => { if (c.included && !c.replaced && gradeFromLetter(c.grade)) counts[c.grade] = (counts[c.grade] || 0) + 1; });
  const letters = GRADE_SCALE.map(g => g.letter).filter(l => counts[l]);
  const max = Math.max(1, ...letters.map(l => counts[l]));
  el('dbGrades').innerHTML = letters.length ? letters.map(l =>
    `<div class="db-bar"><span class="db-bar-l">${l}</span><div class="db-bar-t"><i style="width:${Math.round(counts[l] / max * 100)}%"></i></div><span class="db-bar-n">${counts[l]}</span></div>`
  ).join('') : '<div class="dl-empty">No grades entered yet.</div>';
}
document.body.dataset.page = 'page-dashboard';
document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', () => { document.body.dataset.page = t.dataset.page; if (t.dataset.page === 'page-dashboard'){ dbRender(); if (window.dashDial) window.dashDial.replay(); } }));

window.dlEnsure = ensure; window.dbRender = dbRender; window.dlRender = function(){ render(); dbRender(); };
init();
})();

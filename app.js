const firebaseConfig = {
  apiKey: "AIzaSyAG5Jez19bPq395Mf3dukdBP1jHZz71Nqs",
  authDomain: "gradacus-fd082.firebaseapp.com",
  projectId: "gradacus-fd082",
  storageBucket: "gradacus-fd082.firebasestorage.app",
  messagingSenderId: "160033318436",
  appId: "1:160033318436:web:2bdcd1bd7e33b5e0245ab1"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;

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

let state = {
  program: '136',
  priorCgpa: '',
  priorCredits: '',
  targetGpa: '',
  courses: []
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

function render(){
  document.getElementById('program').value = state.program;
  document.getElementById('priorCgpa').value = state.priorCgpa;
  document.getElementById('priorCredits').value = state.priorCredits;
  if(state.targetGpa) document.getElementById('targetGpa').value = state.targetGpa;

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
      actions = `<button class="icon-btn revert" data-action="revert" data-id="${c.id}" title="Undo repeat — restore this attempt">↺</button>`;
    } else {
      actions = `
        <button class="icon-btn" data-action="repeat" data-id="${c.id}" title="Repeat this course">↻</button>
        <button class="icon-btn danger" data-action="delete" data-id="${c.id}" title="Remove row">✕</button>
      `;
    }

    tr.innerHTML = `
      <td data-label="Course"><input class="code-input mono code" type="text" data-field="code" data-id="${c.id}" value="${c.code}" placeholder="CSE101">${retakeTag}</td>
      <td data-label="Credits"><input class="credit-input mono" type="number" step="0.5" min="0" data-field="credits" data-id="${c.id}" value="${c.credits}"></td>
      <td data-label="Grade"><select class="grade-select mono" data-field="grade" data-id="${c.id}">${gradeOptions}</select></td>
      <td data-label="Points">${pointHtml}</td>
      <td data-label="Include">
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
  } else if (field === 'credits') {
    // Basic validation to prevent negative credits
    let val = parseFloat(e.target.value);
    if(val < 0) e.target.value = 0;
    course[field] = e.target.value;
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
  const grade = gradeFromLetter(course.grade);
  
  // Find the exact tr for this id, since mobile structure might mess with standard index
  const selectEl = document.querySelector(`select[data-id="${id}"]`);
  if(!selectEl) return;
  const tr = selectEl.closest('tr');
  const pointCell = tr.querySelector('td[data-label="Points"]');
  if(!pointCell) return;
  
  pointCell.innerHTML = grade
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

function computeAndDisplay(){
  const priorCgpa = parseFloat(state.priorCgpa);
  const priorCredits = parseFloat(state.priorCredits);
  const hasPrior = !isNaN(priorCgpa) && !isNaN(priorCredits) && priorCredits > 0;

  let qualityPoints = hasPrior ? priorCgpa * priorCredits : 0;
  let attemptedCredits = hasPrior ? priorCredits : 0;
  let earnedCredits = hasPrior ? priorCredits : 0;
  let tableActiveCredits = 0;
  let activeCount = 0;

  state.courses.forEach(c => {
    if (!c.included) return;
    const credits = parseFloat(c.credits);
    if (isNaN(credits) || credits <= 0) return;
    const grade = gradeFromLetter(c.grade);
    if (!grade) { tableActiveCredits += 0; return; }
    qualityPoints += grade.point * credits;
    attemptedCredits += credits;
    tableActiveCredits += credits;
    activeCount++;
    if (grade.point > 0) earnedCredits += credits;
  });

  const cgpa = attemptedCredits > 0 ? (qualityPoints / attemptedCredits) : null;

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

  // Target GPA calculation
  const targetGpa = parseFloat(state.targetGpa);
  const targetNeededEl = document.getElementById('targetGradeNeeded');
  const targetHintEl = document.getElementById('targetHint');

  if(isNaN(targetGpa) || remaining <= 0) {
    targetNeededEl.textContent = '--';
    targetHintEl.textContent = remaining <= 0 ? 'You have completed all credits for this degree.' : 'Enter a goal CGPA to see what you need to average on your remaining credits.';
  } else {
    // Current points: qualityPoints. Target total points: targetGpa * required.
    const neededPoints = (targetGpa * required) - qualityPoints;
    const neededAvg = neededPoints / remaining;
    
    if(neededAvg > 4.0) {
      targetNeededEl.textContent = `Impossible (${neededAvg.toFixed(2)})`;
      targetNeededEl.style.color = 'var(--red)';
      targetHintEl.textContent = 'This goal is mathematically impossible with your remaining credits.';
    } else if (neededAvg < 0) {
      targetNeededEl.textContent = '0.00';
      targetNeededEl.style.color = 'var(--green)';
      targetHintEl.textContent = 'You have already secured this GPA even if you fail remaining classes.';
    } else {
      targetNeededEl.textContent = neededAvg.toFixed(2);
      targetNeededEl.style.color = 'var(--amber)';
      targetHintEl.textContent = `You need to average a ${neededAvg.toFixed(2)} in your remaining ${remaining} credits.`;
    }
  }
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

let saveTimer = null;
async function saveState(){
  if (!currentUser) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try{
      await db.collection('users').doc(currentUser.uid).set(
        { data: JSON.stringify(state) },
        { merge: true }
      );
    } catch(err){
      console.error('Save failed:', err);
      showToast('Could not save — check your connection');
    }
  }, 500);
}

async function loadState(){
  if (!currentUser) return;
  try{
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().data){
      const parsed = JSON.parse(doc.data().data);
      if (parsed && Array.isArray(parsed.courses)){
        state = parsed;
        if(state.targetGpa === undefined) state.targetGpa = '';
        return;
      }
    }
  } catch(err){ console.error('Load failed:', err); }
  state = { program:'136', priorCgpa:'', priorCredits:'', targetGpa: '', courses:[] };
}

// Input validation helper
function enforceMinMax(e) {
  let val = parseFloat(e.target.value);
  let min = parseFloat(e.target.min);
  let max = parseFloat(e.target.max);
  if (!isNaN(min) && val < min) e.target.value = min;
  if (!isNaN(max) && val > max) e.target.value = max;
}

document.getElementById('program').addEventListener('change', e => { state.program = e.target.value; computeAndDisplay(); saveState(); });

const priorCgpaInput = document.getElementById('priorCgpa');
priorCgpaInput.addEventListener('change', enforceMinMax);
priorCgpaInput.addEventListener('input', e => { state.priorCgpa = e.target.value; computeAndDisplay(); saveState(); });

const priorCreditsInput = document.getElementById('priorCredits');
priorCreditsInput.addEventListener('change', enforceMinMax);
priorCreditsInput.addEventListener('input', e => { state.priorCredits = e.target.value; computeAndDisplay(); saveState(); });

const targetGpaInput = document.getElementById('targetGpa');
targetGpaInput.addEventListener('change', enforceMinMax);
targetGpaInput.addEventListener('input', e => { state.targetGpa = e.target.value; computeAndDisplay(); saveState(); });

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
    if (course && (course.credits === 3 || course.credits === '3') && /400/.test(e.target.value)){
      course.credits = 4;
      render();
    }
  }
});

let authMode = 'login';
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
  document.getElementById('authError').textContent = '';
}

document.getElementById('authSwitchBtn').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'signup' : 'login');
});

document.getElementById('authSubmit').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errorEl = document.getElementById('authError');
  const btn = document.getElementById('authSubmit');
  
  errorEl.textContent = '';
  if (!email || !password){
    errorEl.textContent = 'Enter both an email and a password.';
    return;
  }

  // Set loading state
  const originalText = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Loading...';
  btn.disabled = true;

  try{
    if (authMode === 'login'){
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
  } catch(err){
    errorEl.textContent = friendlyAuthError(err);
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await auth.signOut();
});

function friendlyAuthError(err){
  const map = {
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account with that email already exists — try logging in instead.',
    'auth/weak-password': 'Password should be at least 6 characters.',
  };
  return map[err.code] || 'Something went wrong. Please try again.';
}

buildScaleTable();

auth.onAuthStateChanged(async (user) => {
  const overlay = document.getElementById('authOverlay');
  const appRoot = document.getElementById('appRoot');

  if (user){
    currentUser = user;
    
    // Switch to loading state if fetching takes a moment
    document.getElementById('authSub').innerHTML = '<span class="spinner" style="border-top-color:var(--text-dim);"></span> Fetching data...';
    
    await loadState();
    
    overlay.style.display = 'none';
    appRoot.style.display = 'block';
    document.getElementById('userEmail').textContent = user.email;
    document.getElementById('authError').textContent = '';
    document.getElementById('authEmail').value = '';
    document.getElementById('authPassword').value = '';
    render();
    
    // reset text for next logout
    document.getElementById('authSub').textContent = 'Log in to load your saved data.';
    
  } else {
    currentUser = null;
    overlay.style.display = 'flex';
    appRoot.style.display = 'none';
    
    const btn = document.getElementById('authSubmit');
    btn.textContent = authMode === 'login' ? 'Log in' : 'Sign up';
    btn.disabled = false;
  }
});

import {
  GRADE_SCALE, GRADE_COLOR, gradeFromLetter, computeStats, neededAverage, round1, requiredCredits
} from './compute.js';
import { COURSE_DB, CURRICULUM, PROGRAMS, programLink, getCourseInfo, defaultCourseCodesForProgram } from './curriculum.js';
import { esc } from './util/escape.js';
import { showToast, $ } from './ui.js';
import {
  getState, saveState, newCourse, loadDefaultCoursesForProgram, snapshotUndo, restoreUndo, hasUndo, clearUndo
} from './state.js';
import { renderPlanner, renderPlannerSummary } from './planner.js';
import { renderDeadlines } from './deadlines.js';

function attachRowListeners() {
  document.querySelectorAll('#courseBody [data-field]').forEach(el => {
    el.addEventListener('input', onFieldChange);
    el.addEventListener('change', onFieldChange);
  });
  document.querySelectorAll('#courseBody [data-action]').forEach(el => {
    el.addEventListener('click', onRowAction);
  });
}

function onFieldChange(e) {
  const id = e.target.dataset.id;
  const field = e.target.dataset.field;
  const course = getState().courses.find(c => c.id === id);
  if (!course) return;
  if (field === 'included') course.included = e.target.checked;
  else course[field] = e.target.value;
  computeAndDisplay();
  saveState();
  if (field === 'grade') renderGradePillOnly(id);
}

function renderGradePillOnly(id) {
  const course = getState().courses.find(c => c.id === id);
  if (!course) return;
  const row = document.querySelector(`#courseBody [data-id="${id}"][data-field="grade"]`)?.closest('tr');
  if (!row) return;
  const grade = gradeFromLetter(course.grade);
  const pillCell = row.children[3];
  pillCell.innerHTML = grade
    ? `<span class="grade-pill" style="color:${GRADE_COLOR[grade.letter]}; border:1px solid ${GRADE_COLOR[grade.letter]}66; background:${GRADE_COLOR[grade.letter]}14;">${grade.point == null ? grade.letter : grade.point.toFixed(1)}</span>`
    : `<span class="grade-pill" style="color:#4a5178; border:1px solid var(--line);">—</span>`;
}

function onRowAction(e) {
  const id = e.target.dataset.id;
  const action = e.target.dataset.action;
  const state = getState();
  const idx = state.courses.findIndex(c => c.id === id);
  if (idx === -1) return;
  const course = state.courses[idx];

  if (action === 'delete') {
    if (course.repeatOf) {
      const original = state.courses.find(c => c.id === course.repeatOf);
      if (original) { original.replaced = false; original.included = true; }
    }
    state.courses.splice(idx, 1);
    renderCgpa();
    showToast('Course removed');
  } else if (action === 'repeat') {
    course.replaced = true;
    course.included = false;
    const retake = newCourse(course.code, course.credits, course.id);
    state.courses.splice(idx + 1, 0, retake);
    renderCgpa();
    showToast(`Retake row added for ${course.code || 'course'} — old attempt excluded`);
  } else if (action === 'revert') {
    state.courses = state.courses.filter(c => c.repeatOf !== course.id);
    course.replaced = false;
    course.included = true;
    renderCgpa();
    showToast(`Repeat undone for ${course.code || 'course'} — original attempt restored`);
  }
}

export function computeAndDisplay() {
  const state = getState();
  const stats = computeStats(state);
  const { cgpa, earnedCredits, gpaHours, tableGpaHours } = stats;

  const cgpaEl = $('cgpaValue');
  const mirrorEl = $('statCgpaMirror');
  if (cgpa === null) {
    cgpaEl.textContent = '--';
    cgpaEl.classList.add('dim');
    mirrorEl.textContent = '--';
  } else {
    cgpaEl.textContent = cgpa.toFixed(2);
    cgpaEl.classList.remove('dim');
    mirrorEl.textContent = cgpa.toFixed(2);
  }

  $('statCourseCount').textContent = state.courses.length;
  $('statTableCredits').textContent = tableGpaHours;
  $('statGpaHours').textContent = round1(gpaHours);

  const required = requiredCredits(state.program, PROGRAMS);
  const remaining = Math.max(required - earnedCredits, 0);
  const pct = Math.min(100, Math.round((earnedCredits / required) * 100));
  $('creditsEarned').textContent = `${round1(earnedCredits)} / ${required}`;
  $('gradFill').style.width = pct + '%';
  $('gradPct').textContent = pct + '%';
  $('gradRemainText').textContent = `${round1(remaining)} credits left`;
  $('coursesLeft').textContent = remaining <= 0 ? '0 🎓' : Math.ceil(remaining / 3);

  updateTargetResult(stats);
  renderPlannerSummary();
}

function updateTargetResult(stats) {
  const out = neededAverage(stats, $('targetCredits').value, $('targetCgpa').value);
  const el = $('targetResult');
  if (!out) {
    el.textContent = 'Enter a target CGPA and how many GPA-hours you will take.';
    el.className = 'hint';
    return;
  }
  if (!out.possible) {
    el.textContent = out.needOnNew > 4
      ? `You would need a ${out.needOnNew.toFixed(2)} average on those credits — above 4.00, so this target is not reachable with that load.`
      : `You would need a ${out.needOnNew.toFixed(2)} average (below 0) — the target is below your current CGPA even with zeros.`;
    el.className = 'hint warn-text';
    return;
  }
  el.textContent = `You need about a ${out.needOnNew.toFixed(2)} average (GPA-hours only: A+–F) on those credits. P/I/W do not move CGPA.`;
  el.className = 'hint';
}

export function renderCgpa() {
  const state = getState();
  $('program').value = state.program;
  const pl = programLink(state.program);
  const linkEl = $('programLink');
  linkEl.href = pl.href;
  linkEl.textContent = pl.text;
  $('priorCgpa').value = state.priorCgpa;
  $('priorCredits').value = state.priorCredits;

  const body = $('courseBody');
  body.innerHTML = '';

  if (state.courses.length === 0) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">No courses yet — add one to start building your CGPA.</td></tr>';
  }

  state.courses.forEach(c => {
    const tr = document.createElement('tr');
    if (!c.included || c.replaced) tr.classList.add('excluded');
    const grade = gradeFromLetter(c.grade);
    const pointHtml = grade
      ? `<span class="grade-pill" style="color:${GRADE_COLOR[grade.letter]}; border:1px solid ${GRADE_COLOR[grade.letter]}66; background:${GRADE_COLOR[grade.letter]}14;">${grade.point == null ? esc(grade.letter) : grade.point.toFixed(1)}</span>`
      : `<span class="grade-pill" style="color:#4a5178; border:1px solid var(--line);">—</span>`;

    const extra = [
      { letter: 'P', label: 'P (pass, credits only)' },
      { letter: 'I', label: 'I (incomplete)' },
      { letter: 'W', label: 'W (withdrawn)' }
    ];
    const gradeOptions = ['<option value="">--</option>']
      .concat(GRADE_SCALE.filter(g => g.kind === 'gpa').map(g => `<option value="${g.letter}" ${c.grade === g.letter ? 'selected' : ''}>${g.letter} (${g.point.toFixed(1)})</option>`))
      .concat(extra.map(g => `<option value="${g.letter}" ${c.grade === g.letter ? 'selected' : ''}>${g.label}</option>`))
      .join('');

    const isRetake = !!c.repeatOf;
    const retakeTag = isRetake ? `<span class="retake-tag">retake</span>` : '';

    let actions = '';
    if (c.replaced) {
      actions = `<button class="icon-btn text-btn revert" data-action="revert" data-id="${esc(c.id)}" title="Undo repeat — restore this attempt">Undo Repeat</button>`;
    } else {
      actions = `
        <button class="icon-btn text-btn" data-action="repeat" data-id="${esc(c.id)}" title="Repeat this course">Repeat</button>
        <button class="icon-btn danger" data-action="delete" data-id="${esc(c.id)}" title="Remove row">✕</button>
      `;
    }

    tr.innerHTML = `
      <td><input class="code-input mono code" type="text" data-field="code" data-id="${esc(c.id)}" value="${esc(c.code)}" placeholder="CSE101">${retakeTag}</td>
      <td><input class="credit-input mono" type="number" step="0.5" min="0" data-field="credits" data-id="${esc(c.id)}" value="${esc(c.credits)}"></td>
      <td><select class="grade-select mono" data-field="grade" data-id="${esc(c.id)}">${gradeOptions}</select></td>
      <td>${pointHtml}</td>
      <td>
        <input type="checkbox" data-field="included" data-id="${esc(c.id)}" ${c.included ? 'checked' : ''} ${c.replaced ? 'disabled' : ''} title="Temporarily exclude this course's GPA from the calculation">
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

function buildScaleTable() {
  const body = $('scaleBody');
  const rows = [
    ['97 – 100', 'A+', '4.0 GPA hours'],
    ['90 – <97', 'A', '4.0 GPA hours'],
    ['85 – <90', 'A-', '3.7 GPA hours'],
    ['80 – <85', 'B+', '3.3 GPA hours'],
    ['75 – <80', 'B', '3.0 GPA hours'],
    ['70 – <75', 'B-', '2.7 GPA hours'],
    ['65 – <70', 'C+', '2.3 GPA hours'],
    ['60 – <65', 'C', '2.0 GPA hours'],
    ['57 – <60', 'C-', '1.7 GPA hours'],
    ['55 – <57', 'D+', '1.3 GPA hours'],
    ['52 – <55', 'D', '1.0 GPA hours'],
    ['50 – <52', 'D-', '0.7 GPA hours'],
    ['< 50', 'F', '0.0 GPA hours, no earned credit'],
    ['—', 'P', 'Earned credit, not in CGPA'],
    ['—', 'I', 'Incomplete — ignored'],
    ['—', 'W', 'Withdrawn — ignored']
  ];
  body.innerHTML = rows.map(r => `<tr><td class="mono">${r[0]}</td><td style="color:${GRADE_COLOR[r[1]] || 'var(--text)'}">${r[1]}</td><td class="mono">${r[2]}</td></tr>`).join('');
}

function syncCoursesToProgram(oldValue, newValue) {
  const state = getState();
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

function exportState() {
  const payload = {
    app: 'Academic Console',
    schemaVersion: getState().schemaVersion,
    curriculumVersion: getState().curriculumVersion,
    exportedAt: new Date().toISOString(),
    data: getState()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `academic-console-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importStateFile(file) {
  const raw = await file.text();
  const parsed = JSON.parse(raw);
  const incoming = parsed && parsed.data ? parsed.data : parsed;
  if (!incoming || !Array.isArray(incoming.courses) || !incoming.planner) throw new Error('Invalid Academic Console backup');
  if (!confirm('Import this backup and replace the current data? You can undo from the banner that appears.')) return;
  snapshotUndo();
  const { replaceState } = await import('./state.js');
  replaceState(incoming, { persist: true });
  renderAll();
  showUndoBanner();
  showToast('Backup imported');
}

function showUndoBanner() {
  const el = $('undoBanner');
  if (!el) return;
  el.style.display = hasUndo() ? 'flex' : 'none';
}

export function renderAll() {
  renderCgpa();
  renderPlanner();
  renderDeadlines();
  showUndoBanner();
}

export function initCgpa() {
  buildScaleTable();
  $('curriculumVerified').textContent = `Course list last verified ${CURRICULUM.lastVerified}. ${CURRICULUM.disclaimer}`;
  $('degreePlansLink').href = CURRICULUM.links.degreePlans;
  $('cseProgramLink').href = CURRICULUM.links.cseProgram;
  $('csProgramLink').href = CURRICULUM.links.csProgram;
  $('catalogueLink').href = CURRICULUM.links.catalogue;

  $('program').addEventListener('change', e => {
    const state = getState();
    const oldProgram = state.program;
    const newProgram = e.target.value;
    if (oldProgram !== newProgram && !confirm('Switch degree? Untouched default courses that are not part of the new degree may be removed. Courses with grades, repeats, or custom entries will be kept.')) {
      e.target.value = oldProgram;
      return;
    }
    state.program = newProgram;
    state.planner.program = newProgram;
    const { added, removed } = syncCoursesToProgram(oldProgram, state.program);
    renderAll();
    const parts = [];
    if (added) parts.push(`${added} added`);
    if (removed) parts.push(`${removed} removed`);
    showToast(parts.length ? `Degree switched — ${parts.join(', ')}` : 'Degree switched');
  });

  $('loadDefaultCoursesBtn').addEventListener('click', () => {
    const added = loadDefaultCoursesForProgram(getState().program);
    renderCgpa();
    showToast(added ? `Added ${added} missing course${added === 1 ? '' : 's'} for this degree` : 'All default courses for this degree are already on the table');
  });
  $('priorCgpa').addEventListener('input', e => { getState().priorCgpa = e.target.value; computeAndDisplay(); saveState(); });
  $('priorCredits').addEventListener('input', e => { getState().priorCredits = e.target.value; computeAndDisplay(); saveState(); });
  $('targetCgpa').addEventListener('input', () => computeAndDisplay());
  $('targetCredits').addEventListener('input', () => computeAndDisplay());

  $('addCourseBtn').addEventListener('click', () => {
    getState().courses.push(newCourse('', 3));
    renderCgpa();
    const inputs = document.querySelectorAll('#courseBody .code-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  $('scaleToggle').addEventListener('click', e => {
    const table = $('scaleTable');
    table.classList.toggle('open');
    e.target.textContent = table.classList.contains('open') ? 'hide grading scale' : 'show grading scale';
  });

  document.addEventListener('input', e => {
    if (e.target.dataset && e.target.dataset.field === 'code' && e.target.closest('#courseBody')) {
      const id = e.target.dataset.id;
      const course = getState().courses.find(c => c.id === id);
      if (course) {
        const code = String(e.target.value || '').trim().toUpperCase();
        const info = COURSE_DB[code] || (getState().customCourses || {})[code];
        if (info && Number(info.credits) > 0 && Number(course.credits) !== Number(info.credits)) {
          course.credits = info.credits;
          const creditBox = document.querySelector(`#courseBody [data-field="credits"][data-id="${id}"]`);
          if (creditBox) creditBox.value = info.credits;
          computeAndDisplay();
          saveState();
        }
      }
    }
  });

  $('exportBtn').addEventListener('click', exportState);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { await importStateFile(file); } catch (err) { console.error(err); showToast('Import failed — invalid backup file'); }
  });
  $('undoImportBtn')?.addEventListener('click', () => {
    if (restoreUndo()) {
      renderAll();
      showToast('Import undone');
    }
    showUndoBanner();
  });
  $('dismissUndoBtn')?.addEventListener('click', () => { clearUndo(); showUndoBanner(); });
}

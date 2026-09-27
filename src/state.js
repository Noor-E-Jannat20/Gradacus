import { APP_SCHEMA_VERSION, normalizeProgram } from './compute.js';
import { CURRICULUM_DATA_VERSION, defaultCourseCodesForProgram, getCourseInfo } from './curriculum.js';
import { db } from './firebase.js';

const GUEST_KEY = 'gradacus-guest-state';
const UNDO_KEY = 'gradacus-import-undo';

export function defaultPlanner(program = 'CSE') {
  return { program: normalizeProgram(program), activeSemesterId: null, semesters: [] };
}

export function defaultDeadlines() {
  return {
    items: [],
    courses: [],
    customTypes: [],
    prefs: { defRem: [1440, 60], urgentH: 48, notif: false, view: 'list', period: 14 }
  };
}

export function freshState() {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    curriculumVersion: CURRICULUM_DATA_VERSION,
    program: 'CSE',
    priorCgpa: '',
    priorCredits: '',
    courses: [],
    planner: defaultPlanner('CSE'),
    customCourses: {},
    deadlines: defaultDeadlines()
  };
}

export function newCourse(code, credits, repeatOf) {
  return {
    id: crypto.randomUUID(),
    code: code || '',
    credits: credits != null ? credits : 3,
    grade: '',
    included: true,
    replaced: false,
    repeatOf: repeatOf || null
  };
}

export function migrateState(parsed) {
  if (!parsed || typeof parsed !== 'object') return freshState();
  const next = { ...freshState(), ...parsed };
  next.program = normalizeProgram(parsed.program || parsed.planner?.program || 'CSE');
  if (!next.planner || !Array.isArray(next.planner.semesters)) next.planner = defaultPlanner(next.program);
  else next.planner.program = next.program;
  if (!next.customCourses) next.customCourses = {};
  else {
    Object.keys(next.customCourses).forEach(k => {
      if (!next.customCourses[k].isCustom) {
        next.customCourses[k].isCustom = true;
        next.customCourses[k].code = next.customCourses[k].code || k;
        next.customCourses[k].tag = 'custom';
      }
    });
  }
  if (!next.deadlines || typeof next.deadlines !== 'object') next.deadlines = defaultDeadlines();
  next.deadlines.items = next.deadlines.items || [];
  next.deadlines.courses = next.deadlines.courses || [];
  next.deadlines.customTypes = next.deadlines.customTypes || [];
  next.deadlines.prefs = Object.assign(defaultDeadlines().prefs, next.deadlines.prefs || {});
  next.schemaVersion = APP_SCHEMA_VERSION;
  next.curriculumVersion = next.curriculumVersion || CURRICULUM_DATA_VERSION;
  if (!Array.isArray(next.courses)) next.courses = [];
  return next;
}

export function stateHasWork(s) {
  if (!s) return false;
  return (s.courses && s.courses.length > 0)
    || (s.planner?.semesters || []).some(sem => sem.codes?.length)
    || (s.deadlines?.items || []).length > 0
    || String(s.priorCgpa || '') !== ''
    || String(s.priorCredits || '') !== '';
}

let state = freshState();
let currentUser = null;
let stateLoaded = false;
let saveTimer = null;
let pendingSaveUid = null;
const listeners = new Set();

export function getState() { return state; }
export function getUser() { return currentUser; }
export function isStateLoaded() { return stateLoaded; }

export function setCurrentUser(user) { currentUser = user; }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach(fn => fn(state));
}

export function replaceState(next, { persist = true } = {}) {
  state = migrateState(next);
  notify();
  if (persist) saveState();
}

export function loadDefaultCoursesForProgram(programValue) {
  const existing = new Set(state.courses.map(c => c.code));
  let added = 0;
  defaultCourseCodesForProgram(programValue).forEach(code => {
    if (existing.has(code)) return;
    const info = getCourseInfo(code, state);
    if (!info) return;
    state.courses.push(newCourse(code, info.credits));
    existing.add(code);
    added++;
  });
  return added;
}

export function setSyncStatus(text, cls = '') {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'sync-status' + (cls ? ' ' + cls : '');
}

function writeGuest() {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Guest save failed:', err);
  }
}

export function readGuest() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    return migrateState(JSON.parse(raw));
  } catch (err) {
    console.error('Guest load failed:', err);
    return null;
  }
}

export function clearGuest() {
  try { localStorage.removeItem(GUEST_KEY); } catch (_) { /* ignore */ }
}

export function snapshotUndo() {
  try { localStorage.setItem(UNDO_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
}

export function restoreUndo() {
  try {
    const raw = localStorage.getItem(UNDO_KEY);
    if (!raw) return false;
    replaceState(JSON.parse(raw), { persist: true });
    localStorage.removeItem(UNDO_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

export function hasUndo() {
  try { return !!localStorage.getItem(UNDO_KEY); } catch (_) { return false; }
}

export function clearUndo() {
  try { localStorage.removeItem(UNDO_KEY); } catch (_) { /* ignore */ }
}

export function saveState() {
  if (!stateLoaded) return;
  if (!currentUser) {
    writeGuest();
    setSyncStatus('Saved on this device', 'saved');
    return;
  }
  clearTimeout(saveTimer);
  pendingSaveUid = currentUser.uid;
  setSyncStatus('Saving…', 'saving');
  saveTimer = setTimeout(flushSave, 500);
}

export async function flushSave() {
  clearTimeout(saveTimer);
  if (!currentUser || !pendingSaveUid || !db || !stateLoaded) {
    if (!currentUser && stateLoaded) writeGuest();
    return;
  }
  const uid = pendingSaveUid;
  pendingSaveUid = null;
  try {
    state.schemaVersion = APP_SCHEMA_VERSION;
    state.curriculumVersion = CURRICULUM_DATA_VERSION;
    await db.collection('users').doc(uid).set({
      data: JSON.stringify(state),
      schemaVersion: APP_SCHEMA_VERSION,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    setSyncStatus('Saved ✓', 'saved');
  } catch (err) {
    console.error('Save failed:', err);
    setSyncStatus('Not saved', 'error');
  }
}

export async function loadCloudState() {
  if (!currentUser || !db) return { ok: false, empty: true };
  try {
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().data) {
      const parsed = JSON.parse(doc.data().data);
      if (parsed && Array.isArray(parsed.courses)) {
        replaceState(parsed, { persist: false });
        return { ok: true, empty: false };
      }
    }
    return { ok: true, empty: true };
  } catch (err) {
    console.error('Load failed:', err);
    return { ok: false, empty: true };
  }
}

export function beginGuestSession({ withDefaults = false } = {}) {
  currentUser = null;
  const guest = readGuest();
  if (guest && stateHasWork(guest)) replaceState(guest, { persist: false });
  else {
    replaceState(freshState(), { persist: false });
    if (withDefaults) loadDefaultCoursesForProgram(state.program);
  }
  stateLoaded = true;
  setSyncStatus('Saved on this device', 'saved');
}

export function markLoaded(ok) {
  stateLoaded = ok;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});

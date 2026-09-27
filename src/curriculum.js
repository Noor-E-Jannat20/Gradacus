import data from './data/curriculum.json';
import { normalizeProgram } from './compute.js';

export const CURRICULUM = data;
export const COURSE_DB = data.courses;
export const FOUNDATION_CODES = data.foundation;
export const PROGRAM_POOLS = data.pools;
export const PROGRAMS = data.programs;
export const CURRICULUM_DATA_VERSION = data.version;

export function programLink(program) {
  const key = normalizeProgram(program);
  return {
    href: key === 'CS' ? data.links.csProgram : data.links.cseProgram,
    text: key === 'CS' ? 'BRACU CS program page ↗' : 'BRACU CSE program page ↗'
  };
}

export function getCatalogCourse(code) {
  if (!code) return null;
  return COURSE_DB[String(code).trim().toUpperCase()] || null;
}

export function defaultCourseCodesForProgram(program) {
  const key = normalizeProgram(program);
  const pool = PROGRAM_POOLS[key];
  if (!pool) return [];
  return [...FOUNDATION_CODES, ...pool.core];
}

export function getCourseInfo(codeId, state) {
  if (state?.customCourses && state.customCourses[codeId]) {
    return state.customCourses[codeId];
  }
  const cat = getCatalogCourse(codeId);
  if (cat) {
    return {
      code: String(codeId).trim().toUpperCase(),
      name: cat.name,
      credits: cat.credits,
      tag: 'course',
      lab: !!cat.lab,
      project: !!cat.project,
      prereqs: cat.prereqs || []
    };
  }
  return null;
}

export function getPoolForProgram(program, state) {
  const key = normalizeProgram(program);
  const pools = PROGRAM_POOLS[key];
  const items = [];
  pools.core.forEach(code => items.push({ code, tag: 'core' }));
  pools.elective.forEach(code => items.push({ code, tag: 'elective' }));
  FOUNDATION_CODES.forEach(code => items.push({ code, tag: 'foundation' }));
  if (state?.customCourses) {
    Object.keys(state.customCourses).forEach(id => {
      items.push({ code: id, tag: 'custom' });
    });
  }
  return items;
}

export function missingPrereqs(code, { completedCodes, earlierCodes }) {
  const info = getCatalogCourse(code);
  if (!info?.prereqs?.length) return [];
  const have = new Set([...(completedCodes || []), ...(earlierCodes || [])].map(c => String(c).toUpperCase()));
  return info.prereqs.filter(p => !have.has(p));
}

export function earlierSemesterCodes(planner, beforeIndex) {
  const set = new Set();
  (planner?.semesters || []).slice(0, beforeIndex).forEach(s => {
    (s.codes || []).forEach(c => {
      const info = COURSE_DB[c];
      set.add(info ? c : (typeof c === 'string' ? c : ''));
    });
  });
  return [...set].filter(Boolean);
}

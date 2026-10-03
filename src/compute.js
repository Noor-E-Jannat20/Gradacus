export const APP_SCHEMA_VERSION = 3;

export const GRADE_SCALE = [
  { min: 97, letter: 'A+', point: 4.0, kind: 'gpa' },
  { min: 90, letter: 'A', point: 4.0, kind: 'gpa' },
  { min: 85, letter: 'A-', point: 3.7, kind: 'gpa' },
  { min: 80, letter: 'B+', point: 3.3, kind: 'gpa' },
  { min: 75, letter: 'B', point: 3.0, kind: 'gpa' },
  { min: 70, letter: 'B-', point: 2.7, kind: 'gpa' },
  { min: 65, letter: 'C+', point: 2.3, kind: 'gpa' },
  { min: 60, letter: 'C', point: 2.0, kind: 'gpa' },
  { min: 57, letter: 'C-', point: 1.7, kind: 'gpa' },
  { min: 55, letter: 'D+', point: 1.3, kind: 'gpa' },
  { min: 52, letter: 'D', point: 1.0, kind: 'gpa' },
  { min: 50, letter: 'D-', point: 0.7, kind: 'gpa' },
  { min: -Infinity, letter: 'F', point: 0.0, kind: 'gpa' },
  { letter: 'P', point: null, kind: 'pass' },
  { letter: 'I', point: null, kind: 'none' },
  { letter: 'W', point: null, kind: 'none' }
];

export const GRADE_COLOR = {
  'A+': '#41ffb0', A: '#41ffb0', 'A-': '#4deeea',
  'B+': '#4deeea', B: '#4deeea', 'B-': '#9d7bff',
  'C+': '#ffb84d', C: '#ffb84d', 'C-': '#ffb84d',
  'D+': '#ff8a4d', D: '#ff8a4d', 'D-': '#ff8a4d',
  F: '#ff4d6d', P: '#41ffb0', I: '#9d7bff', W: '#6b729a'
};

const LETTER_INDEX = Object.fromEntries(GRADE_SCALE.map(g => [g.letter, g]));

export function gradeFromLetter(letter) {
  if (!letter) return null;
  return LETTER_INDEX[letter] || null;
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Single CGPA model:
 * - GPA hours: letter grades A+-F (including F at 0.0).
 * - Earned credits toward the degree: A+-D- and P (pass). F, I, W earn none.
 * - I/W/P do not affect quality points.
 */
export function computeStats(state) {
  const priorCgpa = parseFloat(state.priorCgpa);
  const priorCredits = parseFloat(state.priorCredits);
  const hasPrior = !Number.isNaN(priorCgpa) && !Number.isNaN(priorCredits) && priorCredits > 0;

  let qualityPoints = hasPrior ? priorCgpa * priorCredits : 0;
  let gpaHours = hasPrior ? priorCredits : 0;
  let earnedCredits = hasPrior ? priorCredits : 0;
  let tableGpaHours = 0;
  const completedCodes = new Set();

  (state.courses || []).forEach(c => {
    if (!c.included || c.replaced) return;
    const credits = parseFloat(c.credits);
    if (Number.isNaN(credits) || credits <= 0) return;
    const grade = gradeFromLetter(c.grade);
    if (!grade) return;

    if (grade.kind === 'gpa') {
      qualityPoints += grade.point * credits;
      gpaHours += credits;
      tableGpaHours += credits;
      if (grade.point > 0) {
        earnedCredits += credits;
        if (c.code) completedCodes.add(String(c.code).trim().toUpperCase());
      }
    } else if (grade.kind === 'pass') {
      earnedCredits += credits;
      if (c.code) completedCodes.add(String(c.code).trim().toUpperCase());
    }
  });

  const cgpa = gpaHours > 0 ? qualityPoints / gpaHours : null;
  return { cgpa, earnedCredits, gpaHours, qualityPoints, tableGpaHours, completedCodes };
}

export function neededAverage(stats, extraCredits, targetCgpa) {
  const extra = parseFloat(extraCredits);
  const target = parseFloat(targetCgpa);
  if (Number.isNaN(extra) || extra <= 0 || Number.isNaN(target)) return null;
  const hours = stats.gpaHours + extra;
  const needOnNew = (target * hours - stats.qualityPoints) / extra;
  return {
    needOnNew,
    possible: needOnNew <= 4 + 1e-9 && needOnNew >= 0 - 1e-9
  };
}

export function normalizeProgram(value) {
  if (value === '124' || value === 'CS') return 'CS';
  return 'CSE';
}

export function requiredCredits(program, programs) {
  const key = normalizeProgram(program);
  return programs?.[key]?.credits ?? (key === 'CS' ? 124 : 136);
}

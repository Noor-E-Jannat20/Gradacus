import { describe, it, expect } from 'vitest';
import { computeStats, neededAverage, normalizeProgram, gradeFromLetter } from '../src/compute.js';

describe('computeStats', () => {
  it('counts F in GPA hours but not earned credits', () => {
    const stats = computeStats({
      priorCgpa: '',
      priorCredits: '',
      courses: [
        { code: 'CSE110', credits: 3, grade: 'A', included: true },
        { code: 'CSE111', credits: 3, grade: 'F', included: true }
      ]
    });
    expect(stats.gpaHours).toBe(6);
    expect(stats.earnedCredits).toBe(3);
    expect(stats.cgpa).toBeCloseTo(2.0);
    expect([...stats.completedCodes]).toEqual(['CSE110']);
  });

  it('treats P as earned credit without GPA hours', () => {
    const stats = computeStats({
      courses: [{ code: 'HUM103', credits: 3, grade: 'P', included: true }]
    });
    expect(stats.gpaHours).toBe(0);
    expect(stats.earnedCredits).toBe(3);
    expect(stats.cgpa).toBeNull();
  });

  it('ignores I and W', () => {
    const stats = computeStats({
      courses: [
        { code: 'CSE220', credits: 3, grade: 'I', included: true },
        { code: 'CSE221', credits: 3, grade: 'W', included: true }
      ]
    });
    expect(stats.gpaHours).toBe(0);
    expect(stats.earnedCredits).toBe(0);
  });

  it('excludes replaced retake originals', () => {
    const stats = computeStats({
      courses: [
        { id: '1', code: 'CSE110', credits: 3, grade: 'C', included: false, replaced: true },
        { id: '2', code: 'CSE110', credits: 3, grade: 'A', included: true, repeatOf: '1' }
      ]
    });
    expect(stats.cgpa).toBe(4);
    expect(stats.earnedCredits).toBe(3);
  });

  it('folds prior CGPA into quality points', () => {
    const stats = computeStats({
      priorCgpa: '3.0',
      priorCredits: '60',
      courses: [{ code: 'CSE370', credits: 3, grade: 'A', included: true }]
    });
    expect(stats.gpaHours).toBe(63);
    expect(stats.cgpa).toBeCloseTo((3 * 60 + 4 * 3) / 63);
  });
});

describe('neededAverage', () => {
  it('reports the term average required to hit a target', () => {
    const stats = computeStats({
      courses: [{ code: 'CSE110', credits: 3, grade: 'B', included: true }]
    });
    const out = neededAverage(stats, 3, 3.5);
    expect(out.needOnNew).toBeCloseTo(4.0);
    expect(out.possible).toBe(true);
  });

  it('flags an unreachable target', () => {
    const stats = computeStats({
      priorCgpa: '2.0',
      priorCredits: '90',
      courses: []
    });
    const out = neededAverage(stats, 3, 3.8);
    expect(out.possible).toBe(false);
  });
});

describe('helpers', () => {
  it('normalizes legacy credit-total program ids', () => {
    expect(normalizeProgram('136')).toBe('CSE');
    expect(normalizeProgram('124')).toBe('CS');
  });
  it('looks up P/I/W grades', () => {
    expect(gradeFromLetter('P').kind).toBe('pass');
    expect(gradeFromLetter('I').kind).toBe('none');
  });
});

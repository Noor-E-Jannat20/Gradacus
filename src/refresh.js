let refresh = () => {};
let paintCgpa = () => {};
let paintPlanner = () => {};
let paintDeadlines = () => {};

export function setRefreshHandlers({ all, cgpa, planner, deadlines }) {
  if (all) refresh = all;
  if (cgpa) paintCgpa = cgpa;
  if (planner) paintPlanner = planner;
  if (deadlines) paintDeadlines = deadlines;
}

export function refreshAll() { refresh(); }
export function refreshCgpa() { paintCgpa(); }
export function refreshPlanner() { paintPlanner(); }
export function refreshDeadlines() { paintDeadlines(); }

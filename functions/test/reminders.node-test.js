'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/reminders');

const TZ = 'Asia/Dhaka';                               // UTC+6, no DST
const at = (s, tz = TZ) => R.zonedToEpoch(s, tz);

test('zonedToEpoch converts wall-clock time in a zone', () => {
  assert.equal(at('2026-10-05T23:59'), Date.UTC(2026, 9, 5, 17, 59));
  assert.equal(R.zonedToEpoch('2026-10-05T12:00', 'UTC'), Date.UTC(2026, 9, 5, 12, 0));
  assert.equal(R.zonedToEpoch('2026-07-01T09:00', 'America/New_York'), Date.UTC(2026, 6, 1, 13, 0));   // EDT
  assert.equal(R.zonedToEpoch('2026-12-01T09:00', 'America/New_York'), Date.UTC(2026, 11, 1, 14, 0));  // EST
  assert.equal(R.zonedToEpoch('nonsense', TZ), null);
});

test('resolveTimeZone falls back safely', () => {
  assert.equal(R.resolveTimeZone({ prefs: { tz: 'Asia/Dhaka' } }, 'UTC'), 'Asia/Dhaka');
  assert.equal(R.resolveTimeZone({ prefs: { tz: 'Not/AZone' } }, 'Asia/Dhaka'), 'Asia/Dhaka');
  assert.equal(R.resolveTimeZone({}, 'bad'), 'UTC');
});

const base = () => ({
  courses: [{ id: 'c1', code: 'CSE401', name: 'Artificial Intelligence' }],
  prefs: { tz: TZ },
  items: [{ id: 'a', title: 'Machine Learning Report', courseId: 'c1', type: 'Assignment', due: '2026-10-05T23:59', reminders: [1440, 60], notes: 'Submit the PDF on the portal.' }]
});

test('collectDueReminders: fires only when the time has arrived', () => {
  const dl = base(), due = at('2026-10-05T23:59');
  assert.equal(R.collectDueReminders(dl, due - 1441 * 60000, TZ).length, 0);          // before both
  const r1 = R.collectDueReminders(dl, due - 1440 * 60000 + 30000, TZ);
  assert.equal(r1.length, 1); assert.equal(r1[0].minutes, 1440);
  const r2 = R.collectDueReminders(dl, due - 60 * 60000 + 30000, TZ);
  assert.equal(r2.length, 1); assert.equal(r2[0].minutes, 60);                         // the 1-day one is now too old
});

test('collectDueReminders: skips stale, overdue, completed and disabled', () => {
  const due = at('2026-10-05T23:59');
  assert.equal(R.collectDueReminders(base(), due - 1440 * 60000 + R.GRACE_MS + 1000, TZ).length, 0, 'stale reminder is not sent late');
  assert.equal(R.collectDueReminders(base(), due + 1000, TZ).length, 0, 'overdue');
  const done = base(); done.items[0].completedAt = '2026-10-01T00:00:00Z';
  assert.equal(R.collectDueReminders(done, due - 59 * 60000, TZ).length, 0, 'completed');
  const off = base(); off.prefs.emailRem = false;
  assert.equal(R.collectDueReminders(off, due - 59 * 60000, TZ).length, 0, 'email reminders off');
  const on = base(); on.prefs.emailRem = true;
  assert.equal(R.collectDueReminders(on, due - 59 * 60000, TZ).length, 1);
});

test('reminderKey is stable and changes with due time or reminder', () => {
  const it = base().items[0];
  assert.equal(R.reminderKey(it, 60), R.reminderKey({ ...it }, 60));
  assert.notEqual(R.reminderKey(it, 60), R.reminderKey(it, 1440));
  assert.notEqual(R.reminderKey(it, 60), R.reminderKey({ ...it, due: '2026-10-06T23:59' }, 60));
});

test('nextReminderTime: earliest future reminder', () => {
  const dl = base(), due = at('2026-10-05T23:59');
  assert.equal(R.nextReminderTime(dl, due - 2000 * 60000, TZ), due - 1440 * 60000);
  assert.equal(R.nextReminderTime(dl, due - 1000 * 60000, TZ), due - 60 * 60000);
  assert.equal(R.nextReminderTime(dl, due - 30 * 60000, TZ), null);
  const off = base(); off.prefs.emailRem = false;
  assert.equal(R.nextReminderTime(off, due - 2000 * 60000, TZ), null);
});

test('humanizeRemaining', () => {
  assert.equal(R.humanizeRemaining(24 * 3600e3), '1 day');
  assert.equal(R.humanizeRemaining(26 * 3600e3), '1 day 2 hours');
  assert.equal(R.humanizeRemaining(3 * 3600e3), '3 hours');
  assert.equal(R.humanizeRemaining(90 * 60e3), '1 hour 30 minutes');
  assert.equal(R.humanizeRemaining(45 * 60e3), '45 minutes');
  assert.equal(R.humanizeRemaining(20e3), '1 minute');
});

test('buildEmail matches the requested format', () => {
  const dl = base(), dueAt = at('2026-10-05T23:59'), now = dueAt - 1440 * 60000;
  const m = R.buildEmail({ item: dl.items[0], deadlines: dl, dueAt, now, tz: TZ, appUrl: '' });
  assert.equal(m.subject, 'Deadline Reminder — CSE401 Assignment');
  assert.match(m.text, /^Your CSE401 assignment is due tomorrow\./);
  assert.match(m.text, /Deadline: Machine Learning Report/);
  assert.match(m.text, /Course: CSE401 — Artificial Intelligence/);
  assert.match(m.text, /Type: Assignment/);
  assert.match(m.text, /Due: October 5, 2026 at 11:59 PM/);
  assert.match(m.text, /Time remaining: 1 day/);
  assert.match(m.text, /Description: Submit the PDF/);
  assert.match(m.text, /Make sure to complete and submit it before the deadline\./);
  assert.match(m.html, /<b>CSE401 assignment<\/b> is due <b>tomorrow<\/b>/);
});

test('buildEmail: no course / no notes, "today", and HTML escaping', () => {
  const dl = { courses: [], prefs: { tz: TZ }, items: [{ id: 'x', title: '<script>alert(1)</script>', type: 'Exam', due: '2026-10-05T18:00', reminders: [60] }] };
  const dueAt = at('2026-10-05T18:00');
  const m = R.buildEmail({ item: dl.items[0], deadlines: dl, dueAt, now: dueAt - 3600e3, tz: TZ });
  assert.equal(m.subject, 'Deadline Reminder — Exam');
  assert.match(m.text, /^Your exam is due today\./);
  assert.doesNotMatch(m.text, /Description:/);
  assert.doesNotMatch(m.text, /Course:/);
  assert.ok(!m.html.includes('<script>'), 'title must be escaped in HTML');
  assert.match(m.html, /&lt;script&gt;/);
});

test('buildEmail: "in N days" for later deadlines', () => {
  const dl = base(), dueAt = at('2026-10-05T23:59');
  const m = R.buildEmail({ item: dl.items[0], deadlines: dl, dueAt, now: dueAt - 3 * 86400e3, tz: TZ });
  assert.match(m.text, /is due in 3 days\./);
});

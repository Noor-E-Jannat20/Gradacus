'use strict';
/*
 * Pure functions for deadline email reminders (no Firebase, no I/O) so they can be unit-tested.
 *
 * Data model (already stored by the app, inside the user's saved state JSON):
 *   state.deadlines.items[]  = { id, title, courseId, type, due: 'YYYY-MM-DDTHH:mm' (wall-clock time),
 *                                notes, reminders: [minutesBefore, ...], completedAt }
 *   state.deadlines.courses[] = { id, code, name }
 *   state.deadlines.prefs     = { emailRem (bool, default on), tz (IANA time zone) , ... }
 */
const crypto = require('crypto');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// A reminder is still sent if the scheduler is late by up to this much. Anything older is skipped
// (e.g. a 1-day reminder for a deadline that was only created 3 hours before it is due).
// 45 min (was 15): the job now runs on GitHub Actions, whose schedule can start 5-30+ min late.
const GRACE_MS = 45 * MINUTE;

function validTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

function tzOffsetMs(epoch, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(epoch));
  const p = {};
  parts.forEach(x => { p[x.type] = x.value; });
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(epoch / 1000) * 1000;
}

// 'YYYY-MM-DDTHH:mm' interpreted as wall-clock time in `tz` -> epoch milliseconds (null if unparsable).
function zonedToEpoch(str, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(str || ''));
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = utc - tzOffsetMs(utc, tz);
  t = utc - tzOffsetMs(t, tz);            // second pass settles DST edges
  return t;
}

function resolveTimeZone(deadlines, fallback) {
  const tz = deadlines && deadlines.prefs && deadlines.prefs.tz;
  if (validTimeZone(tz)) return tz;
  return validTimeZone(fallback) ? fallback : 'UTC';
}

function emailEnabled(deadlines) {
  return !!deadlines && !(deadlines.prefs && deadlines.prefs.emailRem === false);
}

// Stable id for "this reminder of this deadline at this due time" — used to make sending idempotent.
function reminderKey(item, minutes) {
  return crypto.createHash('sha1').update(`${item.id}|${minutes}|${item.due}`).digest('hex');
}

/**
 * Every reminder whose time has arrived and is still worth sending.
 * Returns [{ key, item, minutes, fireAt, dueAt }].
 */
function collectDueReminders(deadlines, now, tz, graceMs = GRACE_MS) {
  const out = [];
  if (!emailEnabled(deadlines) || !Array.isArray(deadlines.items)) return out;
  deadlines.items.forEach(item => {
    if (!item || item.completedAt || !item.id) return;
    const dueAt = zonedToEpoch(item.due, tz);
    if (dueAt == null || dueAt <= now) return;                       // overdue deadlines get no reminders
    const seen = new Set();
    (Array.isArray(item.reminders) ? item.reminders : []).forEach(raw => {
      const minutes = Number(raw);
      if (!(minutes > 0) || seen.has(minutes)) return;
      seen.add(minutes);
      const fireAt = dueAt - minutes * MINUTE;
      if (fireAt > now) return;                                       // not yet
      if (fireAt + graceMs <= now) return;                            // too old: skip, don't send late
      out.push({ key: reminderKey(item, minutes), item, minutes, fireAt, dueAt });
    });
  });
  out.sort((a, b) => a.fireAt - b.fireAt);
  return out;
}

/** Earliest reminder time strictly in the future (epoch ms) or null. Mirrors computeNextReminderAt() in the app. */
function nextReminderTime(deadlines, now, tz) {
  if (!emailEnabled(deadlines) || !Array.isArray(deadlines.items)) return null;
  let next = null;
  deadlines.items.forEach(item => {
    if (!item || item.completedAt) return;
    const dueAt = zonedToEpoch(item.due, tz);
    if (dueAt == null || dueAt <= now) return;
    (Array.isArray(item.reminders) ? item.reminders : []).forEach(raw => {
      const minutes = Number(raw);
      if (!(minutes > 0)) return;
      const fireAt = dueAt - minutes * MINUTE;
      if (fireAt > now && (next === null || fireAt < next)) next = fireAt;
    });
  });
  return next;
}

/* ------------------------------ email content ------------------------------ */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

function humanizeRemaining(ms) {
  const mins = Math.max(0, Math.round(ms / MINUTE));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d >= 1) return h ? `${plural(d, 'day')} ${plural(h, 'hour')}` : plural(d, 'day');
  if (h >= 1) return m ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour');
  return plural(Math.max(1, m), 'minute');
}

function ymdInZone(epoch, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(epoch)).forEach(x => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day);
}

function dueWhen(now, dueAt, tz) {
  const days = Math.round((ymdInZone(dueAt, tz) - ymdInZone(now, tz)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function formatDue(dueAt, tz) {
  const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(dueAt));
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(dueAt));
  return `${date} at ${time}`;
}

/**
 * Builds the email for one reminder. Uses only data already stored for the deadline.
 * `deadlines` is the user's state.deadlines (for the course lookup).
 */
function buildEmail({ item, deadlines, dueAt, now, tz, appUrl }) {
  const course = (deadlines.courses || []).find(c => c.id === item.courseId) || null;
  const code = course && course.code ? String(course.code).trim() : '';
  const type = item.type ? String(item.type).trim() : '';
  const label = [code, type].filter(Boolean).join(' ');
  const title = (item.title && String(item.title).trim()) || 'Untitled deadline';
  const when = dueWhen(now, dueAt, tz);
  const remaining = humanizeRemaining(dueAt - now);
  const dueText = formatDue(dueAt, tz);
  const notes = item.notes ? String(item.notes).trim() : '';
  const noun = [code, type ? type.toLowerCase() : ''].filter(Boolean).join(' ') || 'deadline';

  const subject = `Deadline Reminder — ${label || title}`;
  const intro = `Your ${noun} is due ${when}.`;
  const closing = 'Make sure to complete and submit it before the deadline.';
  const rows = [['Deadline', title]];
  if (course) rows.push(['Course', code ? (course.name ? `${code} — ${course.name}` : code) : course.name]);
  if (type) rows.push(['Type', type]);
  rows.push(['Due', dueText], ['Time remaining', remaining]);
  if (notes) rows.push(['Description', notes]);

  const footerText = 'You get this email because Deadline Email Reminders are on for your Gradacus account. ' +
    'Turn them off in Deadline Tracker → Courses & settings.' + (appUrl ? `\n${appUrl}` : '');

  const text = [intro, '', ...rows.map(r => `${r[0]}: ${r[1]}`), '', closing, '', '—', footerText].join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#f4f0ff;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1535">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e3dcff">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#7a6fb5">Deadline reminder</p>
  <p style="margin:0 0 20px;font-size:18px;line-height:1.4">Your <b>${esc(noun)}</b> is due <b>${esc(when)}</b>.</p>
  <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">
    ${rows.map(r => `<tr><td style="padding:8px 12px 8px 0;color:#7a6fb5;vertical-align:top;white-space:nowrap">${esc(r[0])}</td><td style="padding:8px 0;vertical-align:top;white-space:pre-wrap">${esc(r[1])}</td></tr>`).join('')}
  </table>
  <p style="margin:20px 0 0;font-size:14px">${esc(closing)}</p>
  <hr style="border:0;border-top:1px solid #eee9ff;margin:24px 0 12px">
  <p style="margin:0;font-size:12px;color:#8b84ad;line-height:1.5">You get this email because Deadline Email Reminders are on for your Gradacus account.
  Turn them off in Deadline Tracker → Courses &amp; settings.${appUrl ? `<br><a href="${esc(appUrl)}" style="color:#5046e4">${esc(appUrl)}</a>` : ''}</p>
</div></body></html>`;

  return { subject, text, html };
}

/* ------------------------------ digest email ------------------------------ */

function describeItem(item, deadlines) {
  const course = (deadlines.courses || []).find(c => c.id === item.courseId) || null;
  const code = course && course.code ? String(course.code).trim() : '';
  const type = item.type ? String(item.type).trim() : '';
  const label = [code, type].filter(Boolean).join(' ');
  const title = (item.title && String(item.title).trim()) || 'Untitled deadline';
  return { label, title };
}

/**
 * One email for everything that is due for a user in the same run.
 * entries = [{ item, dueAt }]. A single entry produces exactly the normal single-reminder email.
 */
function buildDigestEmail({ entries, deadlines, now, tz, appUrl }) {
  if (entries.length === 1) {
    return buildEmail({ item: entries[0].item, deadlines, dueAt: entries[0].dueAt, now, tz, appUrl });
  }
  const sorted = entries.slice().sort((a, b) => a.dueAt - b.dueAt);
  const rows = sorted.map(e => {
    const d = describeItem(e.item, deadlines);
    return {
      name: d.label ? `${d.label} — ${d.title}` : d.title,
      due: formatDue(e.dueAt, tz),
      left: humanizeRemaining(e.dueAt - now),
      when: dueWhen(now, e.dueAt, tz)
    };
  });
  const subject = `Deadline Reminder — ${rows.length} deadlines coming up`;
  const intro = `You have ${rows.length} upcoming deadlines.`;
  const closing = 'Make sure to complete and submit them before the deadlines.';
  const footerText = 'You get this email because Deadline Email Reminders are on for your Gradacus account. ' +
    'Turn them off in Deadline Tracker → Courses & settings.' + (appUrl ? `\n${appUrl}` : '');

  const text = [intro, '',
    ...rows.map(r => `• ${r.name}\n  Due ${r.when}: ${r.due} (${r.left} left)`),
    '', closing, '', '—', footerText].join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#f4f0ff;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1535">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e3dcff">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#7a6fb5">Deadline reminder</p>
  <p style="margin:0 0 20px;font-size:18px;line-height:1.4">You have <b>${rows.length} upcoming deadlines</b>.</p>
  ${rows.map(r => `<div style="padding:12px 0;border-top:1px solid #eee9ff"><div style="font-size:15px;font-weight:600">${esc(r.name)}</div><div style="font-size:14px;color:#5b5290;margin-top:2px">Due ${esc(r.when)}: ${esc(r.due)} &middot; ${esc(r.left)} left</div></div>`).join('')}
  <p style="margin:20px 0 0;font-size:14px">${esc(closing)}</p>
  <hr style="border:0;border-top:1px solid #eee9ff;margin:24px 0 12px">
  <p style="margin:0;font-size:12px;color:#8b84ad;line-height:1.5">You get this email because Deadline Email Reminders are on for your Gradacus account.
  Turn them off in Deadline Tracker → Courses &amp; settings.${appUrl ? `<br><a href="${esc(appUrl)}" style="color:#5046e4">${esc(appUrl)}</a>` : ''}</p>
</div></body></html>`;

  return { subject, text, html };
}

module.exports = {
  MINUTE, DAY, GRACE_MS,
  validTimeZone, zonedToEpoch, resolveTimeZone, emailEnabled, reminderKey,
  collectDueReminders, nextReminderTime, humanizeRemaining, dueWhen, formatDue, buildEmail, buildDigestEmail
};

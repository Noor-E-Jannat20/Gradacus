'use strict';
/*
 * Sends the due deadline reminders of ONE user, safely and at most once per reminder.
 * All I/O is injected (deps) so the logic can be tested without Firebase:
 *   deps = { db, FieldValue, Timestamp, getUserEmail(uid), sendMail({to,subject,text,html}), defaultTz, appUrl, log }
 *
 * Duplicate protection: each reminder owns a document  users/{uid}/reminderLog/{reminderKey}.
 * It is claimed inside a Firestore transaction BEFORE the email is sent, then marked
 * { emailSent: true, emailSentAt }. A reminder that is already sent (or currently claimed by a
 * concurrent run) is skipped, so running this repeatedly or in parallel can't send twice.
 */
const R = require('./reminders');

const CLAIM_TTL_MS = 10 * 60 * 1000;   // a crashed run's claim becomes retryable after this
const MAX_ATTEMPTS = 5;
const MAX_PER_USER_PER_RUN = 20;
const LOG_KEEP_MS = 30 * R.DAY;        // optional Firestore TTL field (expireAt)

function parseDeadlines(docData) {
  try {
    const state = typeof docData.data === 'string' ? JSON.parse(docData.data) : docData.data;
    return state && state.deadlines ? state.deadlines : null;
  } catch (e) {
    return null;
  }
}

async function claimReminder(deps, logRef, meta, now) {
  const { db, Timestamp, FieldValue } = deps;
  return db.runTransaction(async tx => {
    const snap = await tx.get(logRef);
    if (snap.exists) {
      const d = snap.data();
      if (d.emailSent) return false;                                             // already delivered
      if ((d.attempts || 0) >= MAX_ATTEMPTS) return false;                       // give up after repeated failures
      const claimed = d.claimedAt && d.claimedAt.toMillis ? d.claimedAt.toMillis() : 0;
      if (claimed && now - claimed < CLAIM_TTL_MS) return false;                 // another run is sending it
    }
    tx.set(logRef, Object.assign({}, meta, {
      emailSent: false,
      claimedAt: Timestamp.fromMillis(now),
      attempts: snap.exists ? (snap.data().attempts || 0) : 0,
      expireAt: Timestamp.fromMillis(meta.dueAt + LOG_KEEP_MS)
    }), { merge: true });
    return true;
  });
}

async function processUser(deps, uid, userRef, now = Date.now()) {
  const { db, FieldValue, Timestamp, getUserEmail, sendMail, defaultTz, appUrl } = deps;
  const log = deps.log || (() => {});
  const result = { uid, sent: 0, skipped: 0, failed: 0 };

  const snap = await userRef.get();
  if (!snap.exists) return result;
  const deadlines = parseDeadlines(snap.data());
  if (!deadlines) {
    await userRef.update({ nextReminderAt: FieldValue.delete() });
    return result;
  }
  const tz = R.resolveTimeZone(deadlines, defaultTz);

  let email = null;
  const due = R.collectDueReminders(deadlines, now, tz).slice(0, MAX_PER_USER_PER_RUN);
  if (due.length) {
    try { email = await getUserEmail(uid); } catch (e) { log('no account email for', uid, e && e.message); }
  }

  for (const r of due) {
    if (!email) { result.skipped++; continue; }
    const logRef = userRef.collection('reminderLog').doc(r.key);
    const meta = { itemId: r.item.id, title: String(r.item.title || ''), reminderMinutes: r.minutes,
                   dueLocal: r.item.due, dueAt: r.dueAt, fireAt: r.fireAt };
    let claimed = false;
    try {
      claimed = await claimReminder(deps, logRef, meta, now);
    } catch (e) {
      log('claim failed', uid, r.key, e && e.message);
      result.failed++;
      continue;
    }
    if (!claimed) { result.skipped++; continue; }

    try {
      const msg = R.buildEmail({ item: r.item, deadlines, dueAt: r.dueAt, now, tz, appUrl });
      await sendMail({ to: email, subject: msg.subject, text: msg.text, html: msg.html });
      await logRef.update({ emailSent: true, emailSentAt: Timestamp.fromMillis(Date.now()), claimedAt: FieldValue.delete(), lastError: FieldValue.delete() });
      result.sent++;
    } catch (e) {
      result.failed++;
      log('send failed', uid, r.key, e && e.message);
      try {                                                    // release the claim so the next run can retry (bounded by attempts + grace window)
        await logRef.update({ claimedAt: FieldValue.delete(), attempts: FieldValue.increment(1), lastError: String((e && e.message) || e).slice(0, 300) });
      } catch (e2) { /* ignore */ }
    }
  }

  // Re-arm the index with the freshest data (a client save may have happened while we were sending).
  await db.runTransaction(async tx => {
    const fresh = await tx.get(userRef);
    if (!fresh.exists) return;
    const d = parseDeadlines(fresh.data());
    const next = d ? R.nextReminderTime(d, now, R.resolveTimeZone(d, defaultTz)) : null;
    // a failed send is retried on the next run (until its grace window ends)
    const retry = result.failed > 0 ? now : null;
    const value = next === null ? retry : (retry === null ? next : Math.min(next, retry));
    tx.update(userRef, { nextReminderAt: value === null ? FieldValue.delete() : value });
  });
  return result;
}

module.exports = { processUser, claimReminder, parseDeadlines, CLAIM_TTL_MS, MAX_ATTEMPTS };

'use strict';
/*
 * Sends the due deadline reminders of ONE user, safely and at most once per reminder.
 * All I/O is injected (deps) so the logic can be tested without Firebase:
 *   deps = { db, FieldValue, Timestamp, getUserEmail(uid), sendMail({to,subject,text,html}), defaultTz, appUrl, log }
 *
 * All reminders that are due for a user in the same run are sent as ONE digest email (saves daily email quota).
 * Optional deps.reserveEmail()/refundEmail() enforce a daily sending cap; when the cap is hit the claims are
 * released (without counting an attempt) and retried on a later run while still inside the grace window.
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

async function releaseClaim(logRef, FieldValue, errMsg) {
  const patch = { claimedAt: FieldValue.delete() };
  if (errMsg !== undefined) {                      // a real failure counts as an attempt; a deferral does not
    patch.attempts = FieldValue.increment(1);
    patch.lastError = String(errMsg).slice(0, 300);
  }
  try { await logRef.update(patch); } catch (e) { /* ignore */ }
}

async function processUser(deps, uid, userRef, now = Date.now()) {
  const { db, FieldValue, Timestamp, getUserEmail, sendMail, defaultTz, appUrl } = deps;
  const log = deps.log || (() => {});
  const result = { uid, sent: 0, emails: 0, skipped: 0, failed: 0, deferred: 0 };

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

  // 1) claim every due reminder (transaction each) so none can be sent twice
  const claimed = [];
  for (const r of due) {
    if (!email) { result.skipped++; continue; }
    const logRef = userRef.collection('reminderLog').doc(r.key);
    const meta = { itemId: r.item.id, title: String(r.item.title || ''), reminderMinutes: r.minutes,
                   dueLocal: r.item.due, dueAt: r.dueAt, fireAt: r.fireAt };
    let ok = false;
    try {
      ok = await claimReminder(deps, logRef, meta, now);
    } catch (e) {
      log('claim failed', uid, r.key, e && e.message);
      result.failed++;
      continue;
    }
    if (!ok) { result.skipped++; continue; }
    claimed.push({ r, logRef });
  }

  if (claimed.length) {
    // 2) daily email cap (optional)
    let reserved = true;
    if (deps.reserveEmail) {
      try { reserved = await deps.reserveEmail(); } catch (e) { reserved = false; log('quota check failed', e && e.message); }
    }
    if (!reserved) {
      for (const c of claimed) await releaseClaim(c.logRef, FieldValue);
      result.deferred += claimed.length;
    } else {
      // 3) one email for everything that is due
      let delivered = false;
      try {
        const msg = R.buildDigestEmail({ entries: claimed.map(c => ({ item: c.r.item, dueAt: c.r.dueAt })), deadlines, now, tz, appUrl });
        await sendMail({ to: email, subject: msg.subject, text: msg.text, html: msg.html });
        delivered = true;
      } catch (e) {
        result.failed += claimed.length;
        log('send failed', uid, e && e.message);
        if (deps.refundEmail) { try { await deps.refundEmail(); } catch (e2) { /* ignore */ } }
        for (const c of claimed) await releaseClaim(c.logRef, FieldValue, (e && e.message) || e);   // retry next run (bounded by attempts + grace window)
      }
      if (delivered) {
        result.sent += claimed.length;
        result.emails++;
        for (const c of claimed) {
          try {
            await c.logRef.update({ emailSent: true, emailSentAt: Timestamp.fromMillis(Date.now()), claimedAt: FieldValue.delete(), lastError: FieldValue.delete() });
          } catch (e) { log('could not mark sent', uid, c.r.key, e && e.message); }
        }
      }
    }
  }

  // Re-arm the index with the freshest data (a client save may have happened while we were sending).
  await db.runTransaction(async tx => {
    const fresh = await tx.get(userRef);
    if (!fresh.exists) return;
    const d = parseDeadlines(fresh.data());
    const next = d ? R.nextReminderTime(d, now, R.resolveTimeZone(d, defaultTz)) : null;
    // a failed or deferred (daily cap) send is retried on the next run (until its grace window ends)
    const retry = (result.failed > 0 || result.deferred > 0) ? now : null;
    const value = next === null ? retry : (retry === null ? next : Math.min(next, retry));
    tx.update(userRef, { nextReminderAt: value === null ? FieldValue.delete() : value });
  });
  return result;
}

module.exports = { processUser, claimReminder, parseDeadlines, CLAIM_TTL_MS, MAX_ATTEMPTS };

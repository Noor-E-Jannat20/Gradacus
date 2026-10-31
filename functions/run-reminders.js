'use strict';
/*
 * Gradacus — deadline reminder runner for GitHub Actions (no Firebase Blaze plan / credit card needed).
 *
 * Same logic as the Cloud Function in index.js (lib/process.js), but started by a GitHub Actions workflow:
 *   node run-reminders.js
 *
 * Required env:   FIREBASE_SERVICE_ACCOUNT  (the service-account JSON, as one string)
 *                 SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM
 * Optional env:   SMTP_PORT (587 | 465, default 587)      APP_URL
 *                 DEFAULT_TIMEZONE (default Asia/Dhaka)   DAILY_EMAIL_CAP (default 280)
 *                 CONCURRENCY (default 6)                 RUN_BUDGET_MS (default 240000)
 */
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { processUser } = require('./lib/process');
const { makeQuota } = require('./lib/quota');

const env = (k, d = '') => (process.env[k] && String(process.env[k]).trim()) || d;
const need = k => { const v = env(k); if (!v) throw new Error(`Missing required environment variable ${k}`); return v; };

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  });
  await Promise.all(workers);
}

async function main() {
  const started = Date.now();
  const budget = parseInt(env('RUN_BUDGET_MS', '240000'), 10);
  const concurrency = Math.max(1, parseInt(env('CONCURRENCY', '6'), 10));
  const cap = Math.max(0, parseInt(env('DAILY_EMAIL_CAP', '280'), 10));

  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(need('FIREBASE_SERVICE_ACCOUNT'))) });
  const db = admin.firestore();
  const { FieldValue, Timestamp } = admin.firestore;

  const port = parseInt(env('SMTP_PORT', '587'), 10);
  const transporter = nodemailer.createTransport({
    host: need('SMTP_HOST'), port, secure: port === 465,          // 587 = STARTTLS (e.g. Brevo smtp-relay.brevo.com)
    auth: { user: need('SMTP_USER'), pass: need('SMTP_PASS') },
    pool: true, maxConnections: 4, maxMessages: 100
  });
  const from = need('MAIL_FROM');

  const quota = await makeQuota({ db, FieldValue, cap }).load();
  console.log(`email quota today: ${quota.used()}/${cap} used`);

  const deps = {
    db, FieldValue, Timestamp,
    defaultTz: env('DEFAULT_TIMEZONE', 'Asia/Dhaka'),
    appUrl: env('APP_URL'),
    log: (...a) => console.warn(...a),
    getUserEmail: async uid => (await admin.auth().getUser(uid)).email || null,
    sendMail: ({ to, subject, text, html }) => transporter.sendMail({ from, to, subject, text, html }),
    reserveEmail: () => quota.reserve(),
    refundEmail: () => quota.release()
  };

  const seen = new Set();
  const totals = { users: 0, reminders: 0, emails: 0, skipped: 0, failed: 0, deferred: 0 };
  const timeLeft = () => Date.now() - started < budget;

  while (timeLeft() && quota.remaining() > 0) {
    // only users that have a reminder due, oldest first
    const snap = await db.collection('users').where('nextReminderAt', '<=', Date.now()).orderBy('nextReminderAt').limit(300).get();
    const fresh = snap.docs.filter(d => !seen.has(d.id));
    if (!fresh.length) break;                       // nothing new (users with failing sends stay due; don't loop on them)
    fresh.forEach(d => seen.add(d.id));

    await pool(fresh, concurrency, async doc => {
      if (!timeLeft() || quota.remaining() <= 0) return;      // left for the next run
      try {
        const r = await processUser(deps, doc.id, doc.ref, Date.now());
        totals.users++; totals.reminders += r.sent; totals.emails += r.emails;
        totals.skipped += r.skipped; totals.failed += r.failed; totals.deferred += r.deferred;
      } catch (e) {
        totals.failed++;
        console.error('reminder run failed for user', doc.id, e);
      }
    });
  }

  await quota.flush();
  transporter.close();
  if (quota.remaining() <= 0) console.warn(`daily email cap (${cap}) reached; remaining reminders wait for the next UTC day`);
  console.log('deadline reminders', JSON.stringify({ ...totals, tookMs: Date.now() - started, quotaUsed: quota.used() }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

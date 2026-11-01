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
 *                 TEST_EMAIL (optional email address to send an instant test reminder to)
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

  // Optional: instant test email verification if TEST_EMAIL is set
  const testEmail = env('TEST_EMAIL');
  if (testEmail) {
    console.log(`[Test Mode] Sending immediate test email to ${testEmail}...`);
    try {
      await transporter.sendMail({
        from,
        to: testEmail,
        subject: 'Gradacus Test Deadline Reminder',
        text: 'This is a test reminder email from your Gradacus runner. Your SMTP configuration is working properly!',
        html: '<div style="font-family:sans-serif;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px"><h2 style="color:#2563eb;margin-top:0">Gradacus Reminder Test</h2><p>This is a test email sent from your Gradacus GitHub Actions runner.</p><p style="color:#16a34a;font-weight:bold;font-size:16px">✓ Your SMTP setup is working properly!</p><p style="color:#64748b;font-size:13px">When deadlines are due, reminder emails will be delivered automatically to this inbox.</p></div>'
      });
      console.log(`[Test Mode] ✓ Test email successfully sent to ${testEmail}`);
    } catch (e) {
      console.error(`[Test Mode] ✗ Failed to send test email to ${testEmail}:`, e && e.message);
    }
  }

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

  if (totals.users === 0) {
    console.log(`[Diagnostic] No users had nextReminderAt <= ${Date.now()} (${new Date().toISOString()}). Checking Firestore collection...`);
    try {
      const allUsers = await db.collection('users').limit(10).get();
      console.log(`[Diagnostic] Found ${allUsers.size} user document(s) in Firestore:`);
      if (allUsers.empty) {
        console.log('  -> No documents in "users" collection. Please ensure you are logged in (not Guest) and saved a deadline.');
      } else {
        for (const u of allUsers.docs) {
          const d = u.data();
          const nr = d.nextReminderAt;
          let extra = '';
          try {
            const parsed = typeof d.data === 'string' ? JSON.parse(d.data) : d.data;
            const dl = parsed && parsed.deadlines;
            if (dl) {
              const emailRem = dl.prefs && dl.prefs.emailRem !== undefined ? dl.prefs.emailRem : true;
              const items = (dl.items || []).map(i => `"${i.title}" due:${i.due} rem:[${i.reminders || []}] done:${!!i.completedAt}`).join(' | ');
              extra = `emailRem: ${emailRem}, deadlines (${(dl.items || []).length}): [${items}]`;
            } else {
              extra = 'no deadlines in saved state';
            }
          } catch (err) {
            extra = 'could not parse state data';
          }

          let accountEmail = '';
          try { accountEmail = (await admin.auth().getUser(u.id)).email || 'no-email'; } catch(e) { accountEmail = 'auth-lookup-failed'; }

          if (nr == null) {
            console.log(`  - User ${u.id} (${accountEmail}): nextReminderAt is NOT set | ${extra}`);
          } else {
            const nrDate = new Date(nr).toISOString();
            const diffMin = Math.round((nr - Date.now()) / 60000);
            if (diffMin > 0) {
              console.log(`  - User ${u.id} (${accountEmail}): nextReminderAt scheduled for ${nrDate} (in ${diffMin}m) | ${extra}`);
            } else {
              console.log(`  - User ${u.id} (${accountEmail}): nextReminderAt was ${nrDate} (${Math.abs(diffMin)}m ago) | ${extra}`);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Diagnostic] Could not check users:', e && e.message);
    }
  }

  await quota.flush();
  transporter.close();
  if (quota.remaining() <= 0) console.warn(`daily email cap (${cap}) reached; remaining reminders wait for the next UTC day`);
  console.log('deadline reminders', JSON.stringify({ ...totals, tookMs: Date.now() - started, quotaUsed: quota.used() }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

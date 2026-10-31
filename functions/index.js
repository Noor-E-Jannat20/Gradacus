'use strict';
/*
 * Gradacus — Deadline email reminders (server side).
 *
 * A Cloud Scheduler job runs `sendDeadlineReminders` every 5 minutes. It finds users whose next reminder
 * is due (`users/{uid}.nextReminderAt <= now`, an index the app keeps up to date whenever it saves),
 * reads their existing deadline data, and emails the account address. Nothing runs in the browser.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineString, defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { processUser } = require('./lib/process');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const SMTP_HOST = defineString('SMTP_HOST');
const SMTP_PORT = defineString('SMTP_PORT', { default: '465' });
const SMTP_USER = defineString('SMTP_USER');
const MAIL_FROM = defineString('MAIL_FROM');
const APP_URL = defineString('APP_URL', { default: '' });
const DEFAULT_TIMEZONE = defineString('DEFAULT_TIMEZONE', { default: 'Asia/Dhaka' });
const SMTP_PASS = defineSecret('SMTP_PASS');

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = parseInt(SMTP_PORT.value(), 10) || 465;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST.value(),
      port,
      secure: port === 465,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
    });
  }
  return transporter;
}

exports.sendDeadlineReminders = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Etc/UTC', timeoutSeconds: 240, memory: '256MiB', maxInstances: 1, secrets: [SMTP_PASS] },
  async () => {
    const now = Date.now();
    const deps = {
      db, FieldValue, Timestamp,
      defaultTz: DEFAULT_TIMEZONE.value(),
      appUrl: APP_URL.value(),
      log: (...a) => logger.warn(...a),
      getUserEmail: async uid => (await admin.auth().getUser(uid)).email || null,
      sendMail: ({ to, subject, text, html }) => getTransporter().sendMail({ from: MAIL_FROM.value(), to, subject, text, html })
    };

    // only users that have a reminder due — not a scan of every account
    const due = await db.collection('users').where('nextReminderAt', '<=', now).limit(500).get();
    let sent = 0, skipped = 0, failed = 0;
    for (const doc of due.docs) {
      try {
        const r = await processUser(deps, doc.id, doc.ref, now);
        sent += r.sent; skipped += r.skipped; failed += r.failed;
      } catch (e) {
        failed++;
        logger.error('reminder run failed for user', doc.id, e);
      }
    }
    logger.info('deadline reminders', { users: due.size, sent, skipped, failed });
  }
);

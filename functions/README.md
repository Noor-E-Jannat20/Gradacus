# Deadline email reminders (server side)

Deadline reminders are delivered **only by email**. A scheduled Cloud Function (`sendDeadlineReminders`,
every 5 minutes) sends them, so nothing depends on the website being open, a browser timer, or the user
being logged in.

```
User saves a deadline + reminders  ─►  users/{uid}.data  (existing JSON state)  +  users/{uid}.nextReminderAt
Cloud Scheduler (every 5 min)      ─►  query users where nextReminderAt <= now
for each user                      ─►  read existing deadline data, find reminders whose time has arrived
                                       claim  users/{uid}/reminderLog/{key}  (transaction)  ─►  send email  ─►  emailSent = true
```

* **Account email:** read from Firebase Authentication (`getUser(uid).email`).
* **No second reminder system:** deadlines, reminder offsets (`item.reminders`, minutes before), courses and the new
  ON/OFF flag (`state.deadlines.prefs.emailRem`) all live in the app's existing saved state.
* **Time zone:** deadline times are stored as wall-clock strings (`2026-10-05T23:59`). The app now also saves the
  browser's time zone in `prefs.tz`; the server uses it (falls back to `DEFAULT_TIMEZONE`).
* **Exactly once:** each reminder (deadline id + minutes-before + due time) has a log document claimed inside a
  Firestore transaction *before* sending and marked `emailSent: true, emailSentAt` afterwards. Re-runs, overlapping
  runs and retries cannot send it twice. A failed send releases the claim and is retried on the next run (max 5 attempts,
  and only while the reminder is still within its 15-minute grace window).
* **Late/stale reminders are skipped:** a "1 day before" reminder for a deadline created 3 hours before it is due is
  not sent. A reminder is sent at most 15 minutes after its time.
* `reminderLog` documents carry an `expireAt` field. Optional housekeeping: add a Firestore TTL policy on
  collection group `reminderLog`, field `expireAt`.

## Deploy

Requires the Firebase **Blaze** (pay-as-you-go) plan — Cloud Functions with Cloud Scheduler need it. Usage for this
function is normally within the free monthly allowance.

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..

# 1. mail settings (not secret)
cp functions/.env.example functions/.env      # then edit SMTP_HOST / SMTP_PORT / SMTP_USER / MAIL_FROM

# 2. SMTP password (secret)
firebase functions:secrets:set SMTP_PASS

# 3. rules + function
firebase deploy --only firestore:rules,functions
```

Any SMTP provider works (Brevo, Mailgun, SendGrid, Amazon SES, Resend's SMTP, Gmail with an app password, …).
Use an address/domain you control for `MAIL_FROM` and set up SPF/DKIM so reminders don't land in spam.

## Test

```bash
cd functions && npm test      # unit tests: time zones, due-reminder selection, email text, duplicate prevention
```

## Operating notes

* Existing users start receiving emails after deploy (the setting defaults to ON when never switched). To make it
  opt-in instead, change `emailRem:true` to `emailRem:false` in `ensure()` in `app.js` and the default test in
  `emailEnabled()` in `functions/lib/reminders.js`.
* A user is picked up by the scheduler once the new version of the app has saved their data once (that save writes
  `nextReminderAt`). The app does this automatically at every login, so each user is indexed the first time they
  open the site after the update. Until then, reminders for users who haven't returned yet are not sent.
* Logs: `firebase functions:log --only sendDeadlineReminders`.

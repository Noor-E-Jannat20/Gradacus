# Reminder emails without a credit card (GitHub Actions + Brevo)

Firebase Cloud Functions need the Blaze plan (card). This setup keeps **Firebase Auth + Firestore on the free Spark plan**
and runs the reminder job on **GitHub Actions** instead. `functions/index.js` (the Cloud Function) is simply not deployed.

What runs: `.github/workflows/reminders.yml` -> `functions/run-reminders.js` -> the same `lib/process.js` logic as before
(exactly-once claims, retries), plus: one digest email per user per run, and a daily email cap.

## 1. Host the frontend (Cloudflare Pages, free, no card)
1. Push this project to a GitHub repo (**public** = unlimited free Actions minutes; private = only 2,000 min/month).
2. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> connect the repo.
3. Build command `npm run build`, output directory `dist`.
4. Add your custom domain under the project's "Custom domains".
5. Firebase console -> Authentication -> Settings -> **Authorized domains** -> add your domain (otherwise login fails).
6. Deploy Firestore rules (works on Spark): `firebase deploy --only firestore:rules`

## 2. Brevo (free SMTP, 300 emails/day, no card)
1. Create an account at brevo.com and wait for approval (sending is enabled after review).
2. SMTP & API -> SMTP -> note the login and generate an SMTP key.
   Host `smtp-relay.brevo.com`, port `587`.
3. Add and verify your sending domain/address (Senders & IP) and set up its SPF/DKIM records, or mail lands in spam.
   `MAIL_FROM` must be a verified sender.

## 3. GitHub secrets and variables
Firebase console -> Project settings -> Service accounts -> **Generate new private key** (works on Spark).
Never commit that file.

Repo -> Settings -> Secrets and variables -> Actions:

| Type | Name | Value |
|---|---|---|
| Secret | `FIREBASE_SERVICE_ACCOUNT` | the whole key JSON file contents |
| Secret | `SMTP_PASS` | Brevo SMTP key |
| Variable | `SMTP_HOST` | `smtp-relay.brevo.com` |
| Variable | `SMTP_PORT` | `587` |
| Variable | `SMTP_USER` | Brevo SMTP login |
| Variable | `MAIL_FROM` | e.g. `Gradacus <reminders@yourdomain.com>` |
| Variable | `APP_URL` | `https://yourdomain.com` |
| Variable | `DEFAULT_TIMEZONE` | e.g. `Asia/Dhaka` |
| Variable | `DAILY_EMAIL_CAP` | `280` (a little under Brevo's 300) |

Then Actions tab -> "Send deadline reminders" -> Run workflow, and read the log line starting `deadline reminders {...}`.

## 4. Reliable timing (recommended)
GitHub's own cron can start 5-30+ minutes late, and public repos pause scheduled workflows after 60 days without
repo activity. So also trigger it from a free external scheduler such as cron-job.org, every 5 minutes:

* Create a fine-grained GitHub token: only this repo, permission **Actions: Read and write**.
* cron-job.org job: `POST https://api.github.com/repos/OWNER/REPO/actions/workflows/reminders.yml/dispatches`
  * Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
  * Body: `{"ref":"main"}` (use your default branch name). Success is HTTP 204.

The workflow's concurrency group stops overlapping runs, and the per-reminder claim logs prevent duplicates, so
extra triggers are harmless.

## Limits to know
* **Daily cap:** when `DAILY_EMAIL_CAP` is reached, remaining reminders wait; any that fall outside the 45-minute
  grace window are skipped, not sent late. The counter resets on the **UTC** day; check when Brevo's own limit resets
  and adjust the cap if needed.
* **Spark quotas are hard caps:** 20K Firestore writes/day (about 3 per reminder email, plus normal app saves).
* If you later add a card: switch SMTP to Amazon SES (about $0.10 per 1,000 emails) and raise `DAILY_EMAIL_CAP`.

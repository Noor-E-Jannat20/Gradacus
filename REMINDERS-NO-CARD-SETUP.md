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

## 2. SMTP Provider (Free, No Card)

You can use any standard SMTP provider. **Gmail** is the easiest because it requires no approval, no phone verification wait, and allows up to 500 emails/day.

### Option A: Gmail (Recommended & Easiest)
1. Go to your [Google Account](https://myaccount.google.com/) -> **Security**.
2. Ensure **2-Step Verification** is turned on.
3. Open [App Passwords](https://myaccount.google.com/apppasswords) (search "App passwords" in settings if needed).
4. Enter an app name (e.g. `Gradacus`) and click **Create**.
5. Copy the generated 16-letter password (e.g. `xxxx xxxx xxxx xxxx`).

Settings for Gmail:
- `SMTP_HOST`: `smtp.gmail.com`
- `SMTP_PORT`: `465` (or `587`)
- `SMTP_USER`: your Gmail address (e.g. `example@gmail.com`)
- `SMTP_PASS`: the 16-letter app password (without spaces)
- `MAIL_FROM`: `Gradacus <example@gmail.com>`
- `DAILY_EMAIL_CAP`: `480`

### Option B: Brevo (if verification works for you)
1. Account at brevo.com.
2. SMTP & API -> generate an SMTP key.
3. `SMTP_HOST`: `smtp-relay.brevo.com`, `SMTP_PORT`: `587`.
4. `DAILY_EMAIL_CAP`: `280`.

### Option C: Resend / Mailjet
- Resend (`smtp.resend.com`, port `465`, user `resend`, API key as pass). Requires verified domain.
- Mailjet (`in-v3.mailjet.com`, port `587`, free 200/day).

## 3. GitHub secrets and variables
Firebase console -> Project settings -> Service accounts -> **Generate new private key** (works on Spark).
Never commit that file.

Repo -> Settings -> Secrets and variables -> Actions:

| Type | Name | Value (for Gmail) | Value (for Brevo) |
|---|---|---|---|
| Secret | `FIREBASE_SERVICE_ACCOUNT` | Firebase service account key JSON | Firebase service account key JSON |
| Secret | `SMTP_PASS` | 16-character Google App Password | Brevo SMTP key |
| Variable | `SMTP_HOST` | `smtp.gmail.com` | `smtp-relay.brevo.com` |
| Variable | `SMTP_PORT` | `465` (or `587`) | `587` |
| Variable | `SMTP_USER` | `yourname@gmail.com` | Brevo SMTP login |
| Variable | `MAIL_FROM` | `Gradacus <yourname@gmail.com>` | `Gradacus <reminders@yourdomain.com>` |
| Variable | `APP_URL` | `https://yourdomain.com` | `https://yourdomain.com` |
| Variable | `DEFAULT_TIMEZONE` | e.g. `Asia/Dhaka` | e.g. `Asia/Dhaka` |
| Variable | `DAILY_EMAIL_CAP` | `480` | `280` |

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

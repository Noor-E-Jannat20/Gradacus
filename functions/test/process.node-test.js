'use strict';
// Exercises processUser() against a tiny in-memory Firestore stand-in to prove idempotency,
// concurrency safety, failure handling and index (nextReminderAt) maintenance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { processUser } = require('../lib/process');
const R = require('../lib/reminders');

const DEL = { __delete: true };
const INC = n => ({ __inc: n });
const TS = { fromMillis: ms => ({ toMillis: () => ms, ms }) };
const FieldValue = { delete: () => DEL, increment: INC };

function applyUpdate(obj, patch) {
  Object.keys(patch).forEach(k => {
    const v = patch[k];
    if (v === DEL) delete obj[k];
    else if (v && v.__inc !== undefined) obj[k] = (obj[k] || 0) + v.__inc;
    else obj[k] = v;
  });
}

class FakeDb {
  constructor() { this.docs = new Map(); this.lock = Promise.resolve(); }
  doc(path) { return new Ref(this, path); }
  async runTransaction(fn) {                       // serialises transactions (Firestore would retry on contention)
    const run = this.lock.then(async () => {
      const writes = [];
      const tx = {
        get: async ref => ref.get(),
        set: (ref, data, opt) => writes.push(() => ref._set(data, opt)),
        update: (ref, patch) => writes.push(() => ref._update(patch))
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      return out;
    });
    this.lock = run.catch(() => {});
    return run;
  }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return { doc: id => new Ref(this.db, `${this.path}/${name}/${id}`) }; }
  async get() { const d = this.db.docs.get(this.path); return { exists: !!d, data: () => d && JSON.parse(JSON.stringify(d, (k, v) => v)) , ...(d ? { _raw: d } : {}) }; }
  _set(data, opt) { const cur = (opt && opt.merge && this.db.docs.get(this.path)) || {}; this.db.docs.set(this.path, Object.assign(cur, data)); }
  _update(patch) { const d = this.db.docs.get(this.path); if (!d) throw new Error('not found'); applyUpdate(d, patch); }
  async update(patch) { this._update(patch); }
}
// keep Timestamp objects intact when reading (data() above would JSON-clone them)
Ref.prototype.get = async function () {
  const d = this.db.docs.get(this.path);
  return { exists: !!d, data: () => d };
};

const TZ = 'Asia/Dhaka';
const DUE = R.zonedToEpoch('2026-10-05T23:59', TZ);

function setup(extra = {}) {
  const db = new FakeDb();
  const state = { deadlines: {
    courses: [{ id: 'c1', code: 'CSE401', name: 'AI' }], prefs: { tz: TZ },
    items: [{ id: 'a', title: 'ML Report', courseId: 'c1', type: 'Assignment', due: '2026-10-05T23:59', reminders: [1440, 60] }] } };
  Object.assign(state.deadlines.prefs, extra.prefs || {});
  db.docs.set('users/u1', { data: JSON.stringify(state), nextReminderAt: DUE - 1440 * 60000 });
  const sent = [];
  const deps = {
    db, FieldValue, Timestamp: TS, defaultTz: 'UTC', appUrl: '',
    getUserEmail: async () => extra.noEmail ? null : 'student@example.com',
    sendMail: async m => { if (extra.failSend && extra.failSend()) throw new Error('smtp down'); sent.push(m); },
    log: () => {}
  };
  return { db, deps, sent, ref: db.doc('users/u1') };
}

test('sends once when the reminder is due, marks it sent, re-arms the index', async () => {
  const { db, deps, sent, ref } = setup();
  const now = DUE - 1440 * 60000 + 60000;
  const r = await processUser(deps, 'u1', ref, now);
  assert.equal(r.sent, 1); assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'student@example.com');
  assert.equal(sent[0].subject, 'Deadline Reminder — CSE401 Assignment');
  const logs = [...db.docs.entries()].filter(([k]) => k.includes('/reminderLog/'));
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].emailSent, true);
  assert.ok(logs[0][1].emailSentAt);
  assert.equal(db.docs.get('users/u1').nextReminderAt, DUE - 60 * 60000, 'index points at the next (1h) reminder');
});

test('running again (and again) never sends a duplicate', async () => {
  const { deps, sent, ref } = setup();
  const now = DUE - 1440 * 60000 + 60000;
  await processUser(deps, 'u1', ref, now);
  await processUser(deps, 'u1', ref, now + 60000);
  await processUser(deps, 'u1', ref, now + 120000);
  assert.equal(sent.length, 1);
});

test('two parallel runs send only one email', async () => {
  const { deps, sent, ref } = setup();
  const now = DUE - 1440 * 60000 + 60000;
  await Promise.all([processUser(deps, 'u1', ref, now), processUser(deps, 'u1', ref, now), processUser(deps, 'u1', ref, now)]);
  assert.equal(sent.length, 1);
});

test('both reminders send exactly once each over time', async () => {
  const { deps, sent, ref } = setup();
  const t1 = DUE - 1440 * 60000 + 60000, t2 = DUE - 60 * 60000 + 60000;
  for (const t of [t1, t1 + 300000, t2, t2 + 300000, t2 + 600000]) await processUser(deps, 'u1', ref, t);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Time remaining: 59 minutes/);
});

test('failed send is released and retried; success afterwards sends once', async () => {
  let fail = true;
  const { db, deps, sent, ref } = setup({ failSend: () => fail });
  const now = DUE - 1440 * 60000 + 60000;
  const r1 = await processUser(deps, 'u1', ref, now);
  assert.equal(r1.failed, 1); assert.equal(sent.length, 0);
  assert.ok(db.docs.get('users/u1').nextReminderAt <= now, 'kept armed for retry');
  fail = false;
  const r2 = await processUser(deps, 'u1', ref, now + 300000);
  assert.equal(r2.sent, 1); assert.equal(sent.length, 1);
  await processUser(deps, 'u1', ref, now + 600000);
  assert.equal(sent.length, 1);
});

test('stale claim from a crashed run is retried after the TTL, a fresh claim is respected', async () => {
  const { db, deps, sent, ref } = setup();
  const now = DUE - 1440 * 60000 + 60000;
  const key = R.reminderKey({ id: 'a', due: '2026-10-05T23:59' }, 1440);
  db.docs.set(`users/u1/reminderLog/${key}`, { emailSent: false, attempts: 0, claimedAt: TS.fromMillis(now - 30000) });
  await processUser(deps, 'u1', ref, now);
  assert.equal(sent.length, 0, 'fresh claim by another run is respected');
  db.docs.set(`users/u1/reminderLog/${key}`, { emailSent: false, attempts: 0, claimedAt: TS.fromMillis(now - 11 * 60000) });
  await processUser(deps, 'u1', ref, now);
  assert.equal(sent.length, 1, 'stale claim is taken over');
});

test('editing the due time creates a new reminder (old log does not block it)', async () => {
  const { db, deps, sent, ref } = setup();
  const now = DUE - 1440 * 60000 + 60000;
  await processUser(deps, 'u1', ref, now);
  assert.equal(sent.length, 1);
  const st = JSON.parse(db.docs.get('users/u1').data);
  st.deadlines.items[0].due = '2026-10-07T23:59';
  db.docs.get('users/u1').data = JSON.stringify(st);
  const due2 = R.zonedToEpoch('2026-10-07T23:59', TZ);
  await processUser(deps, 'u1', ref, due2 - 1440 * 60000 + 60000);
  assert.equal(sent.length, 2);
});

test('respects the ON/OFF setting, completed items and missing account email', async () => {
  const now = DUE - 1440 * 60000 + 60000;
  const off = setup({ prefs: { emailRem: false } });
  await processUser(off.deps, 'u1', off.ref, now);
  assert.equal(off.sent.length, 0);
  assert.equal('nextReminderAt' in off.db.docs.get('users/u1'), false, 'index cleared when off');

  const ne = setup({ noEmail: true });
  const r = await processUser(ne.deps, 'u1', ne.ref, now);
  assert.equal(ne.sent.length, 0); assert.equal(r.skipped, 1);

  const done = setup();
  const st = JSON.parse(done.db.docs.get('users/u1').data);
  st.deadlines.items[0].completedAt = '2026-10-01T00:00:00Z';
  done.db.docs.get('users/u1').data = JSON.stringify(st);
  await processUser(done.deps, 'u1', done.ref, now);
  assert.equal(done.sent.length, 0);
});

test('works when the user has never saved a time zone (uses the default)', async () => {
  const { db, deps, sent, ref } = setup();
  const st = JSON.parse(db.docs.get('users/u1').data);
  delete st.deadlines.prefs.tz;
  db.docs.get('users/u1').data = JSON.stringify(st);
  deps.defaultTz = 'Asia/Dhaka';
  await processUser(deps, 'u1', ref, DUE - 1440 * 60000 + 60000);
  assert.equal(sent.length, 1);
});

test('corrupt data does not throw and clears the index', async () => {
  const { db, deps, sent, ref } = setup();
  db.docs.get('users/u1').data = '{not json';
  const r = await processUser(deps, 'u1', ref, DUE - 1440 * 60000 + 60000);
  assert.equal(sent.length, 0); assert.equal(r.sent, 0);
  assert.equal('nextReminderAt' in db.docs.get('users/u1'), false);
});

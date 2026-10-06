'use strict';
// Digest email (several due reminders -> one email) and the daily email cap.
const test = require('node:test');
const assert = require('node:assert/strict');
const { processUser } = require('../lib/process');
const { makeQuota } = require('../lib/quota');
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
  collection(name) { return { doc: id => new Ref(this, `${name}/${id}`) }; }
  async runTransaction(fn) {
    const run = this.lock.then(async () => {
      const writes = [];
      const tx = { get: async ref => ref.get(), set: (ref, d, o) => writes.push(() => ref._set(d, o)), update: (ref, p) => writes.push(() => ref._update(p)) };
      const out = await fn(tx); writes.forEach(w => w()); return out;
    });
    this.lock = run.catch(() => {});
    return run;
  }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return { doc: id => new Ref(this.db, `${this.path}/${name}/${id}`) }; }
  async get() { const d = this.db.docs.get(this.path); return { exists: !!d, data: () => d }; }
  _set(data, opt) { const cur = (opt && opt.merge && this.db.docs.get(this.path)) || {}; applyUpdate(cur, data); this.db.docs.set(this.path, cur); }
  _update(patch) { const d = this.db.docs.get(this.path); if (!d) throw new Error('not found'); applyUpdate(d, patch); }
  async update(patch) { this._update(patch); }
  async set(data, opt) { this._set(data, opt); }
}

const TZ = 'Asia/Dhaka';
const DUE = R.zonedToEpoch('2026-10-05T23:59', TZ);

function setup(extra = {}) {
  const db = new FakeDb();
  const state = { deadlines: {
    courses: [{ id: 'c1', code: 'CSE401', name: 'AI' }, { id: 'c2', code: 'CSE330', name: 'Numerical' }], prefs: { tz: TZ },
    items: [
      { id: 'a', title: 'ML Report', courseId: 'c1', type: 'Assignment', due: '2026-10-05T23:59', reminders: [60] },
      { id: 'b', title: 'Quiz 2', courseId: 'c2', type: 'Quiz', due: '2026-10-05T23:59', reminders: [60] }
    ] } };
  db.docs.set('users/u1', { data: JSON.stringify(state), nextReminderAt: DUE - 60 * 60000 });
  const sent = [];
  const deps = {
    db, FieldValue, Timestamp: TS, defaultTz: 'UTC', appUrl: '',
    getUserEmail: async () => 'student@example.com',
    sendMail: async m => { if (extra.failSend && extra.failSend()) throw new Error('smtp down'); sent.push(m); },
    log: () => {}
  };
  if (extra.quota) { deps.reserveEmail = () => extra.quota.reserve(); deps.refundEmail = () => extra.quota.release(); }
  return { db, deps, sent, ref: db.doc('users/u1') };
}
const NOW = DUE - 60 * 60000 + 60000;
const logs = db => [...db.docs.entries()].filter(([k]) => k.includes('/reminderLog/')).map(([, v]) => v);

test('two reminders due together -> ONE email listing both, both marked sent', async () => {
  const { db, deps, sent, ref } = setup();
  const r = await processUser(deps, 'u1', ref, NOW);
  assert.equal(sent.length, 1);
  assert.equal(r.sent, 2); assert.equal(r.emails, 1);
  assert.match(sent[0].subject, /2 deadlines coming up/);
  assert.match(sent[0].text, /CSE401 Assignment — ML Report/);
  assert.match(sent[0].text, /CSE330 Quiz — Quiz 2/);
  assert.match(sent[0].html, /ML Report/);
  assert.equal(logs(db).length, 2);
  assert.ok(logs(db).every(l => l.emailSent === true));
  await processUser(deps, 'u1', ref, NOW + 60000);
  assert.equal(sent.length, 1, 'no duplicate on the next run');
});

test('failed digest releases both claims and retries as one email', async () => {
  let fail = true;
  const { db, deps, sent, ref } = setup({ failSend: () => fail });
  const r1 = await processUser(deps, 'u1', ref, NOW);
  assert.equal(r1.failed, 2); assert.equal(sent.length, 0);
  assert.ok(db.docs.get('users/u1').nextReminderAt <= NOW, 'index stays armed for retry');
  fail = false;
  const r2 = await processUser(deps, 'u1', ref, NOW + 300000);
  assert.equal(r2.sent, 2); assert.equal(sent.length, 1);
});

test('daily cap reached: nothing is sent, claims are released without using attempts, sent later', async () => {
  const db0 = new FakeDb();
  const quota = await makeQuota({ db: db0, FieldValue, cap: 0 }).load();
  const { db, deps, sent, ref } = setup({ quota });
  const r = await processUser(deps, 'u1', ref, NOW);
  assert.equal(sent.length, 0); assert.equal(r.deferred, 2);
  assert.ok(logs(db).every(l => !l.claimedAt && !l.attempts && l.emailSent === false), 'claims released, no attempt counted');
  assert.ok(db.docs.get('users/u1').nextReminderAt <= NOW, 'index stays armed');
  deps.reserveEmail = async () => true;                         // next day / cap raised
  const r2 = await processUser(deps, 'u1', ref, NOW + 300000);
  assert.equal(r2.sent, 2); assert.equal(sent.length, 1);
});

test('quota counts emails (not reminders), refunds a failed send, and stops at the cap', async () => {
  const db0 = new FakeDb();
  const quota = await makeQuota({ db: db0, FieldValue, cap: 2 }).load();
  let fail = true;
  const { deps, ref } = setup({ quota, failSend: () => fail });
  await processUser(deps, 'u1', ref, NOW);
  assert.equal(quota.used(), 0, 'failed send is refunded');
  fail = false;
  await processUser(deps, 'u1', ref, NOW + 300000);
  assert.equal(quota.used(), 1, 'a digest of 2 reminders costs 1 email');
  assert.equal(await quota.reserve(), true);
  assert.equal(await quota.reserve(), false, 'cap of 2 reached');
  await quota.flush();
  const day = [...db0.docs.entries()].find(([k]) => k.startsWith('meta/emailQuota-'));
  assert.equal(day[1].count, 2, 'count is persisted to Firestore');
});

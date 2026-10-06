'use strict';
/*
 * Daily email cap (e.g. Brevo's free plan = 300/day). The count lives in  meta/emailQuota-YYYY-MM-DD  (UTC day),
 * a document the browser can never touch (no Firestore rule matches it; the Admin SDK bypasses rules).
 *
 * The runner is the only sender at any moment (the GitHub workflow uses a concurrency group), so the count is
 * held in memory for speed and written through to Firestore after every change.
 */
function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

function makeQuota({ db, FieldValue, cap, now = Date.now }) {
  const ref = db.collection('meta').doc('emailQuota-' + dayKey(now()));
  let used = 0;
  let chain = Promise.resolve();
  const persist = delta => {
    chain = chain.then(() => ref.set({ count: FieldValue.increment(delta), day: dayKey(now()) }, { merge: true }))
                 .catch(() => {});
    return chain;
  };
  return {
    async load() {
      const snap = await ref.get();
      used = snap.exists ? Number((snap.data() || {}).count) || 0 : 0;
      return this;
    },
    remaining() { return Math.max(0, cap - used); },
    used() { return used; },
    async reserve() {                       // synchronous check + increment: safe across concurrent workers in one process
      if (used >= cap) return false;
      used++;
      persist(1);
      return true;
    },
    async release() { if (used > 0) { used--; persist(-1); } },
    flush() { return chain; }
  };
}

module.exports = { makeQuota, dayKey };

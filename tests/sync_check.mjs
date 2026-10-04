// Plays several devices syncing saved trips through the fake Supabase
// (tests/fake_supabase.py) and prints a JSON report; tests/test_sync.py
// starts the servers and checks the report. Needs Node 18+.
//
//   FAKE_URL, FAKE_KEY   the fake Supabase (normal tokens)
//   FAKE_SHORT_URL       a second one whose access tokens last 1 second

import { Cloud, checkConfig, isSecretKey } from '../web/js/cloud.js';
import { Sync, planSync } from '../web/js/sync.js';
import { localBackend } from '../web/js/api.js';

const URL1 = process.env.FAKE_URL;
const KEY = process.env.FAKE_KEY;
const SHORT = process.env.FAKE_SHORT_URL;
const report = { failures: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const memStore = () => {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), remove: (k) => m.delete(k) };
};

/** A device: its own storage, its own saved trips (the browser backend), its own sign-in. */
function device(url = URL1, opts = {}) {
  const store = memStore();
  const cloud = new Cloud({ url, key: KEY }, { store, ...opts });
  const backend = localBackend({ items: [] }); // no localStorage in Node: trips stay in memory, per device
  const sync = new Sync(cloud, backend, { store, online: () => true });
  return { cloud, backend, sync, store };
}

async function syncAll(label, ...devices) {
  for (const d of devices) {
    await d.sync.run();
    if (d.sync.status.state !== 'idle') report.failures.push(`${label}: ${d.sync.status.state} ${d.sync.status.error || ''}`);
  }
}
const trips = (d) => d.backend.listTrips();
const find = async (d, name) => (await trips(d)).find((t) => t.name === name);
const names = async (d) => (await trips(d)).map((t) => t.name).sort();
const code = (p) => p.then(() => 'ok', (e) => e.code || String(e));

// 1. sign up on A, save a trip, sync
const A = device();
report.signup = await code(A.cloud.signUp('alice@example.com', 'correct horse'));
await A.backend.saveTrip({ name: 'Tokyo', saved_at: 1000, qty: { tshirt: 3 } });
await syncAll('first push', A);
report.firstPush = { trips: A.sync.status.trips, rows: (await A.cloud.listTrips()).length };

// 2. B signs in to the same account and gets it, unchanged
const B = device();
report.signin = await code(B.cloud.signIn('alice@example.com', 'correct horse'));
await syncAll('second device', B);
const bTokyo = await find(B, 'Tokyo');
report.secondDevice = bTokyo ? { savedAt: bTokyo.saved_at, tshirt: bTokyo.qty.tshirt, sameId: bTokyo.id === (await find(A, 'Tokyo')).id } : null;

// 3. an edit on B reaches A
await B.backend.saveTrip({ ...bTokyo, qty: { tshirt: 5 }, saved_at: 2000 });
await syncAll('edit', B, A);
const aTokyo = await find(A, 'Tokyo');
report.edit = aTokyo && [aTokyo.saved_at, aTokyo.qty.tshirt];

// 4. a delete on A reaches B
await A.backend.deleteTrip(aTokyo.id);
await syncAll('delete', A, B);
report.delete = { a: await names(A), b: await names(B) };

// 5. both change the same trip while apart: the later change wins, whichever syncs first
await A.backend.saveTrip({ name: 'Paris', saved_at: 3000, qty: { tshirt: 1 } });
await syncAll('paris', A, B);
await A.backend.saveTrip({ ...(await find(A, 'Paris')), qty: { tshirt: 2 }, saved_at: 3100 });
await B.backend.saveTrip({ ...(await find(B, 'Paris')), qty: { tshirt: 9 }, saved_at: 3200 });
await syncAll('conflict', A, B, A);
report.conflict = [(await find(A, 'Paris')).qty.tshirt, (await find(B, 'Paris')).qty.tshirt];

// 6. the same name saved separately on both: one trip, the newer one
await A.backend.saveTrip({ name: 'Rome', saved_at: 4000, qty: { tshirt: 1 } });
await B.backend.saveTrip({ name: 'Rome', saved_at: 4100, qty: { tshirt: 4 } });
await syncAll('same name', A, B, A);
const romes = async (d) => (await trips(d)).filter((t) => t.name === 'Rome').map((t) => t.qty.tshirt);
report.sameName = { a: await romes(A), b: await romes(B) };

// 7. deleted on A while B changed it: the change wins, nothing is lost
await A.backend.saveTrip({ name: 'Oslo', saved_at: 5000, qty: { tshirt: 1 } });
await syncAll('oslo', A, B);
await A.backend.deleteTrip((await find(A, 'Oslo')).id);
await B.backend.saveTrip({ ...(await find(B, 'Oslo')), qty: { tshirt: 7 }, saved_at: 5100 });
await syncAll('delete vs edit', B, A);
const aOslo = await find(A, 'Oslo');
report.deleteVsEdit = aOslo ? aOslo.qty.tshirt : null;

// 8. another account sees and touches nothing of Alice's
const C = device();
report.bobSignup = await code(C.cloud.signUp('bob@example.com', 'another pass'));
await syncAll('bob', C);
report.bob = { trips: await names(C), rows: (await C.cloud.listTrips()).length };
report.bobWrite = await code(C.cloud.upsertTrips([{ user_id: A.cloud.user.id, id: 'x1', name: 'x', data: {}, deleted: false }]));

// 9. sign-in problems come back as Supabase's error codes
report.errors = {
  wrongPassword: await code(device().cloud.signIn('alice@example.com', 'nope')),
  duplicate: await code(device().cloud.signUp('alice@example.com', 'whatever123')),
  weak: await code(device().cloud.signUp('carol@example.com', '123')),
  badEmail: await code(device().cloud.signUp('not-an-email', 'whatever123')),
  offline: await code(new Cloud({ url: 'http://127.0.0.1:9', key: KEY }, { store: memStore() }).signIn('a@b.co', 'x')),
  badKey: await code(new Cloud({ url: URL1, key: 'wrong' }, { store: memStore() }).signIn('alice@example.com', 'correct horse')),
};

// 10. access tokens expire: refreshed before use, and after a 401
const S = device(SHORT, { refreshMargin: 0 });
await S.cloud.signUp('dave@example.com', 'long enough 1');
const firstToken = S.cloud.session.access_token;
await sleep(2100);
await S.backend.saveTrip({ name: 'Lima', saved_at: 6000 });
await syncAll('refresh before', S);
const secondToken = S.cloud.session.access_token;
await sleep(2100);
S.cloud.session.expires_at = Math.floor(Date.now() / 1000) + 3600; // the device thinks it's still valid
await S.backend.saveTrip({ name: 'Quito', saved_at: 6100 });
await syncAll('refresh after 401', S);
report.refresh = {
  rows: (await S.cloud.listTrips()).length,
  rotated: firstToken !== secondToken && secondToken !== S.cloud.session.access_token,
  signedIn: !!S.cloud.user,
};
// the refresh token stops working (signed out elsewhere): this device signs out too
S.cloud.session.refresh_token = 'gone';
S.cloud.store.set('spa-session-v1', JSON.stringify(S.cloud.session));
S.cloud.session.expires_at = 0;
await S.sync.run();
report.ended = { state: S.sync.status.state, error: S.sync.status.error, user: S.cloud.user };

// 11. a password-reset link signs in and lets you choose a new password
const R = device();
const res = await fetch(`${URL1}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'alice@example.com', password: 'correct horse' }),
});
const link = await res.json();
const back = await R.cloud.takeRedirect(`#access_token=${link.access_token}&expires_in=3600&refresh_token=${link.refresh_token}&token_type=bearer&type=recovery`);
report.redirect = { type: back && back.type, email: R.cloud.user && R.cloud.user.email };
await R.cloud.updatePassword('new password 1');
report.newPassword = await code(device().cloud.signIn('alice@example.com', 'new password 1'));
report.shareLinkIgnored = await R.cloud.takeRedirect('#t=abcdefabcdefabcdefabcdef');
report.badLink = await R.cloud.takeRedirect('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
report.resetEmail = await code(R.cloud.sendPasswordReset('alice@example.com', 'http://127.0.0.1:8765/'));

// 12. signing out, removing the synced trips from the device
await syncAll('before sign-out', B);
const bBefore = (await names(B)).length;
await B.backend.saveTrip({ name: 'Unsynced', saved_at: 7000 });
await B.cloud.signOut();
await B.sync.forget(true);
report.signOut = { before: bBefore, after: await names(B), user: B.cloud.user, state: B.sync.status.state };

// 13. a device that already has trips signs in: they join the account
const D = device();
await D.backend.saveTrip({ name: 'Lisbon', saved_at: 8000 });
await D.cloud.signIn('alice@example.com', 'new password 1');
await syncAll('join', D, A);
report.join = { d: await names(D), a: await names(A) };

// 14. deleting the account removes it and its trips
report.deleteAccount = await code(C.cloud.deleteAccount());
report.afterDelete = { user: C.cloud.user, signIn: await code(device().cloud.signIn('bob@example.com', 'another pass')) };

// 15. settings checks
const jwt = (payload) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`;
report.config = {
  ok: !!checkConfig({ supabase_url: 'https://abc.supabase.co/', supabase_key: 'sb_publishable_x' }),
  plainHttp: !!checkConfig({ supabase_url: 'http://abc.supabase.co', supabase_key: 'k' }),
  localTest: !!checkConfig({ supabase_url: 'http://127.0.0.1:8790', supabase_key: 'k' }),
  secretKey: !!checkConfig({ supabase_url: 'https://abc.supabase.co', supabase_key: 'sb_secret_abc' }),
  serviceRole: isSecretKey(jwt({ role: 'service_role' })),
  anonRole: isSecretKey(jwt({ role: 'anon' })),
  empty: !!checkConfig({ supabase_url: '', supabase_key: '' }),
  path: !!checkConfig({ supabase_url: 'https://abc.supabase.co/rest/v1', supabase_key: 'k' }),
};

// 16. the plan on its own (no I/O)
const k = { a: { t: 10 }, b: { t: 10 }, c: { t: 10, del: true } };
const plan = planSync(
  [{ id: 'a', name: 'A', saved_at: 10 }, { id: 'd', name: 'D', saved_at: 30 }],
  [{ id: 'b', name: 'B', data: { saved_at: 20 }, deleted: false, updated_at: 'x' },
    { id: 'e', name: 'E', data: { saved_at: 5 }, deleted: true, updated_at: 'y' }],
  k, 100,
);
report.plan = {
  saveLocal: plan.saveLocal.map((t) => t.id), deleteLocal: plan.deleteLocal,
  push: plan.push.map((r) => [r.id, r.deleted]), known: plan.known,
};
// a trip deleted elsewhere, but changed here afterwards, comes back
const back2 = planSync([{ id: 'a', name: 'A', saved_at: 50 }], [{ id: 'a', name: '', data: { saved_at: 40 }, deleted: true, updated_at: 'z' }], { a: { t: 30 } }, 100);
report.resurrect = back2.push.map((r) => [r.id, r.deleted]);

console.log(JSON.stringify(report));

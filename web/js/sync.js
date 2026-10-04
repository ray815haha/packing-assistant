// Keeps the saved trips on this device in step with the user's account.
//
// Every trip carries `saved_at` (seconds, from the clock of the device that
// last changed it), and the newest version of a trip wins, deletes included.
// Two trips with the same name are the same trip (as when saving locally),
// so there too the newer one wins. In the cloud each trip is one row (a
// deleted trip stays as a row marked deleted, so other devices hear about
// it), stamped by the server, so each sync only fetches what changed since
// the one before.

export const META_KEY = 'spa-sync-meta-v1'; // { user, cursor, known }
const OVERLAP_MS = 2 * 60 * 1000; // re-read the last two minutes each time: writes can land out of order

const when = (x) => Number(x && x.saved_at) || 0;

/**
 * Work out a sync. Pure: no I/O.
 *
 * @param local  trips on this device
 * @param remote cloud rows changed since the last sync ({ id, name, data, deleted, updated_at })
 * @param known  what both sides agreed on last time: { id: { t: saved_at, del?: true } }
 * @param now    the time now, in seconds (used to date deletes made on this device)
 * @returns { saveLocal: [trip], deleteLocal: [id], push: [row], known }
 */
export function planSync(local, remote, known = {}, now = Math.floor(Date.now() / 1000)) {
  const L = new Map(local.filter((x) => x && x.id).map((x) => [x.id, x]));
  const R = new Map();
  for (const r of remote) if (r && r.id) R.set(r.id, r); // oldest first, so the last one is current
  const saveLocal = new Map(); // id -> trip
  const deleteLocal = new Set();
  const push = new Map(); // id -> row
  const next = { ...known };

  const pushLive = (trip) => {
    push.set(trip.id, { id: trip.id, name: trip.name || '', data: trip, deleted: false });
    next[trip.id] = { t: when(trip) };
  };
  const pushDead = (id, t) => {
    push.set(id, { id, name: '', data: { saved_at: t }, deleted: true });
    next[id] = { t, del: true };
  };
  const fromRow = (r) => ({ ...(r.data && typeof r.data === 'object' ? r.data : {}), id: r.id, name: r.name || (r.data && r.data.name) || '' });

  for (const id of new Set([...L.keys(), ...R.keys(), ...Object.keys(known)])) {
    const l = L.get(id), r = R.get(id), k = known[id];
    const deletedHere = !l && k && !k.del; // we had it at the last sync, and it's gone now
    if (r) {
      const rt = when(r.data);
      if (r.deleted) {
        if (l && when(l) > rt) pushLive(l); // changed here after it was deleted elsewhere: keep it
        else {
          if (l) deleteLocal.add(id);
          next[id] = { t: rt, del: true };
        }
      } else if (l) {
        if (when(l) > rt) pushLive(l);
        else {
          if (rt > when(l)) saveLocal.set(id, fromRow(r));
          next[id] = { t: rt };
        }
      } else if (deletedHere && rt <= k.t) {
        pushDead(id, Math.max(now, k.t + 1)); // deleted here; nobody changed it since
      } else if (k && k.del && rt <= k.t) {
        pushDead(id, k.t); // our delete didn't reach the cloud yet
      } else {
        saveLocal.set(id, fromRow(r)); // new, or changed elsewhere after we deleted it: keep the change
        next[id] = { t: rt };
      }
    } else if (l) {
      if (!k || k.del || when(l) > k.t) pushLive(l); // new or changed here
    } else if (deletedHere) {
      pushDead(id, Math.max(now, k.t + 1));
    }
  }

  // Same name, different trips: keep the newest (as saving locally would).
  const live = new Map(); // id -> trip, as things will be after this sync
  for (const [id, l] of L) if (!deleteLocal.has(id)) live.set(id, l);
  for (const [id, trip] of saveLocal) live.set(id, trip);
  const byName = new Map();
  for (const trip of live.values()) {
    const name = String(trip.name || '').trim();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(trip);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => when(b) - when(a) || String(b.id).localeCompare(String(a.id)));
    for (const loser of group.slice(1)) {
      saveLocal.delete(loser.id);
      if (L.has(loser.id)) deleteLocal.add(loser.id);
      pushDead(loser.id, Math.max(now, when(loser) + 1));
    }
  }
  return { saveLocal: [...saveLocal.values()], deleteLocal: [...deleteLocal], push: [...push.values()], known: next };
}

/** Syncs a backend's saved trips (api.js) with a Cloud (cloud.js). */
export class Sync {
  /**
   * @param cloud    a Cloud
   * @param backend  { listTrips, saveTrip, deleteTrip } (saveTrip must keep the trip's id and saved_at)
   * @param options  store (get/set/remove strings), onTripsChanged(), onStatus(status), now (ms), online()
   */
  constructor(cloud, backend, { store, onTripsChanged = () => {}, onStatus = () => {}, now = () => Date.now(),
    online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false) } = {}) {
    this.cloud = cloud;
    this.backend = backend;
    this.store = store || cloud.store;
    this.onTripsChanged = onTripsChanged;
    this.onStatus = onStatus;
    this.now = now;
    this.online = online;
    this.status = { state: cloud.user ? 'idle' : 'signed-out', last: null, error: null, trips: this._count() };
    this._running = null;
    this._again = false;
    this._timer = 0;
  }

  /** Sync now; if a sync is already running, run once more after it. */
  run() {
    if (this._running) {
      this._again = true;
      return this._running;
    }
    this._running = (async () => {
      try {
        do {
          this._again = false;
          await this._once();
        } while (this._again);
      } finally {
        this._running = null;
      }
    })();
    return this._running;
  }

  /** Sync a little later (several changes in a row make one sync). */
  schedule(ms = 1000) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.run(), ms);
  }

  /** In the browser: sync on sign-in, when back online or back in the tab, and every few minutes. */
  start() {
    this.cloud.onChange(() => {
      this._set({ state: this.cloud.user ? 'idle' : 'signed-out', error: null, trips: this._count() });
      if (this.cloud.user) this.schedule(0);
    });
    window.addEventListener('online', () => this.schedule(300));
    window.addEventListener('offline', () => { if (this.cloud.user) this._set({ state: 'offline' }); });
    window.addEventListener('storage', (e) => { if (e.key === null || e.key.startsWith('spa-session')) this.cloud.reload(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.schedule(300); });
    setInterval(() => { if (document.visibilityState === 'visible' && this.cloud.user) this.run(); }, 3 * 60 * 1000);
    if (this.cloud.user) this.schedule(0);
  }

  /** After signing out: forget what was synced (and, if asked, remove those trips from this device). */
  async forget(removeTrips = false) {
    const meta = this._meta();
    if (removeTrips) {
      for (const [id, k] of Object.entries(meta.known || {})) {
        if (!k.del) await this.backend.deleteTrip(id).catch(() => {});
      }
      this.onTripsChanged();
    }
    this.store.remove(META_KEY);
    this._set({ state: 'signed-out', last: null, error: null, trips: 0 });
  }

  async _once() {
    const user = this.cloud.user;
    if (!user) return this._set({ state: 'signed-out' });
    if (!this.online()) return this._set({ state: 'offline' });
    this._set({ state: 'syncing' });
    try {
      let meta = this._meta();
      if (meta.user !== user.id) meta = { user: user.id, cursor: null, known: {} }; // first sync for this account here
      const since = meta.cursor ? new Date(Date.parse(meta.cursor) - OVERLAP_MS).toISOString() : null;
      const remote = await this.cloud.listTrips(since);
      const local = await this.backend.listTrips();
      const plan = planSync(local, remote, meta.known, Math.floor(this.now() / 1000));
      for (const id of plan.deleteLocal) await this.backend.deleteTrip(id).catch(() => {});
      for (const trip of plan.saveLocal) await this.backend.saveTrip(trip);
      if (plan.push.length) await this.cloud.upsertTrips(plan.push.map((row) => ({ ...row, user_id: user.id })));
      // the newest change we've read becomes the starting point next time
      let newest = meta.cursor;
      for (const r of remote) if (!newest || Date.parse(r.updated_at) > Date.parse(newest)) newest = r.updated_at;
      this._saveMeta({ user: user.id, cursor: newest, known: plan.known });
      this._set({ state: 'idle', last: this.now(), error: null, trips: this._count() });
      if (plan.saveLocal.length || plan.deleteLocal.length) this.onTripsChanged();
    } catch (err) {
      if (err.code === 'offline') this._set({ state: 'offline' });
      else if (!this.cloud.user) this._set({ state: 'signed-out', error: 'expired' });
      else this._set({ state: 'error', error: err.message || String(err) });
    }
  }

  _count() {
    return Object.values(this._meta().known || {}).filter((k) => !k.del).length;
  }

  _meta() {
    try {
      const m = JSON.parse(this.store.get(META_KEY) || 'null');
      return m && typeof m === 'object' && m.known && typeof m.known === 'object' ? m : { user: null, cursor: null, known: {} };
    } catch {
      return { user: null, cursor: null, known: {} };
    }
  }

  _saveMeta(m) {
    this.store.set(META_KEY, JSON.stringify(m));
  }

  _set(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }
}

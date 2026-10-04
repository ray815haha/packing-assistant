// Talks to the Supabase project that keeps accounts and synced trips (see
// supabase/setup.sql and the README's "Accounts and sync"). Plain fetch
// calls to Supabase's Auth and Data APIs: no SDK, nothing to build.
//
// The project's address and public key come from web/sync.json; with that
// file empty, sync is simply off. Only a public key belongs there: the
// database's row-level security is what keeps each person's trips private.

export const SESSION_KEY = 'spa-session-v1';
const REFRESH_MARGIN_S = 60; // refresh the access token this long before it expires

/** Read web/sync.json; null if sync isn't set up (or the settings can't be used). */
export async function loadSyncConfig(fetchImpl = (...a) => fetch(...a)) {
  try {
    const res = await fetchImpl('sync.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return checkConfig(await res.json());
  } catch {
    return null;
  }
}

/** { url, key } from the settings, or null if they're missing or unsafe. */
export function checkConfig(c) {
  const url = String((c && c.supabase_url) || '').trim().replace(/\/+$/, '');
  const key = String((c && c.supabase_key) || '').trim();
  if (!url || !key) return null;
  // https only (plain http just for a test server on this computer)
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url)) return null;
  if (isSecretKey(key)) return null; // a secret key would bypass the database's protections
  return { url, key };
}

/** True for keys that must never be shipped in a web page. */
export function isSecretKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  const parts = String(key).split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

/** An error from the cloud: `code` is Supabase's error code ('offline' if unreachable). */
export class CloudError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function errorFrom(res) {
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  // Auth errors: { error_code, msg } (older servers: { error, error_description });
  // Data API errors: { code, message }
  const code = body.error_code || (typeof body.code === 'string' ? body.code : '') || body.error || `http_${res.status}`;
  const message = body.msg || body.error_description || body.message || `HTTP ${res.status}`;
  return new CloudError(code, message, res.status);
}

/** localStorage, or memory where that isn't available. */
export function browserStore() {
  const mem = new Map();
  return {
    get(k) { try { return localStorage.getItem(k); } catch { return mem.has(k) ? mem.get(k) : null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } },
    remove(k) { try { localStorage.removeItem(k); } catch { mem.delete(k); } },
  };
}

export class Cloud {
  /**
   * @param config  { url, key } from checkConfig()
   * @param options store (get/set/remove strings), fetchImpl, now (ms),
   *                refreshMargin (seconds)
   */
  constructor(config, { store = browserStore(), fetchImpl = (...a) => fetch(...a), now = () => Date.now(),
    refreshMargin = REFRESH_MARGIN_S } = {}) {
    this.url = config.url;
    this.key = config.key;
    this.store = store;
    this.fetch = fetchImpl;
    this.now = now;
    this.refreshMargin = refreshMargin;
    this.listeners = new Set();
    this.session = this._read();
  }

  /** The signed-in user ({ id, email }) or null. */
  get user() {
    return this.session ? this.session.user : null;
  }

  /** Call `fn(user)` whenever someone signs in or out (in this tab or another). */
  onChange(fn) {
    this.listeners.add(fn);
  }

  /** Pick up a sign-in or sign-out from another tab. */
  reload() {
    const s = this._read();
    const was = this.user && this.user.id;
    this.session = s;
    if ((s && s.user.id) !== was) for (const fn of this.listeners) fn(this.user);
  }

  // -- accounts ---------------------------------------------------------------
  /** Create an account. Resolves { signedIn } or, if the project wants email
   * confirmation first, { needsConfirmation: true }. */
  async signUp(email, password) {
    const data = await this._auth('POST', 'signup', { email, password });
    const session = data.access_token ? data : data.session;
    if (session && session.access_token) {
      this._save(session);
      return { signedIn: true };
    }
    return { needsConfirmation: true };
  }

  async signIn(email, password) {
    this._save(await this._auth('POST', 'token?grant_type=password', { email, password }));
  }

  /** Sign out on this device (other devices stay signed in). */
  async signOut() {
    const s = this.session;
    this._save(null);
    if (s) {
      try {
        await this.fetch(`${this.url}/auth/v1/logout?scope=local`, {
          method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${s.access_token}` },
        });
      } catch { /* offline: the token simply expires */ }
    }
  }

  /** Email a link for choosing a new password (needs an email provider set up in Supabase). */
  async sendPasswordReset(email, redirectTo) {
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    await this._auth('POST', `recover${q}`, { email });
  }

  async updatePassword(password) {
    const token = await this._token();
    await this._auth('PUT', 'user', { password }, token);
  }

  /** Delete the account and everything synced to it (supabase/setup.sql: delete_my_account). */
  async deleteAccount() {
    await this._rest('POST', 'rpc/delete_my_account', {});
    this._save(null);
  }

  /**
   * Finish a sign-in that came back in the page address (an email
   * confirmation or password-reset link: #access_token=...&type=...).
   * Resolves null if the address has nothing for us, else { type } or
   * { error } (and the caller should clear the address).
   */
  async takeRedirect(hash) {
    const h = String(hash || '').replace(/^#/, '');
    if (!/(^|&)(access_token|error_description|error_code)=/.test(h)) return null;
    const p = new URLSearchParams(h);
    if (!p.get('access_token')) return { error: p.get('error_description') || p.get('error') || 'sign-in link failed' };
    const access = p.get('access_token');
    let user;
    try {
      user = await this._auth('GET', 'user', null, access);
    } catch (err) {
      return { error: err.message };
    }
    this._save({
      access_token: access, refresh_token: p.get('refresh_token'),
      expires_at: Number(p.get('expires_at')) || Math.floor(this.now() / 1000) + (Number(p.get('expires_in')) || 3600),
      user,
    });
    return { type: p.get('type') || 'signin' };
  }

  // -- trips -----------------------------------------------------------------
  /** Rows changed after `since` (ISO time; null = all), oldest change first. */
  async listTrips(since = null) {
    const rows = [];
    const page = 500;
    for (let offset = 0; ; offset += page) {
      const q = new URLSearchParams({ select: 'id,name,data,deleted,updated_at', order: 'updated_at.asc,id.asc' });
      if (since) q.set('updated_at', `gt.${since}`);
      q.set('limit', String(page));
      q.set('offset', String(offset));
      const got = await this._rest('GET', `trips?${q}`);
      rows.push(...got);
      if (got.length < page) return rows;
    }
  }

  /** Insert or replace rows ({ user_id, id, name, data, deleted }); resolves the stored rows. */
  async upsertTrips(rows) {
    const out = [];
    for (let i = 0; i < rows.length; i += 100) {
      out.push(...await this._rest('POST', 'trips?on_conflict=user_id,id', rows.slice(i, i + 100),
        { Prefer: 'resolution=merge-duplicates,return=representation' }));
    }
    return out;
  }

  // -- plumbing ----------------------------------------------------------------
  _read() {
    try {
      const s = JSON.parse(this.store.get(SESSION_KEY) || 'null');
      return s && s.access_token && s.refresh_token && s.user && s.user.id ? s : null;
    } catch {
      return null;
    }
  }

  /** Keep a session (a token response from Supabase) or forget it (null). */
  _save(data) {
    const was = this.user && this.user.id;
    if (data) {
      const nowS = Math.floor(this.now() / 1000);
      this.session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Number(data.expires_at) || nowS + (Number(data.expires_in) || 3600),
        user: { id: data.user.id, email: data.user.email || '' },
      };
      this.store.set(SESSION_KEY, JSON.stringify(this.session));
    } else {
      this.session = null;
      this.store.remove(SESSION_KEY);
    }
    if ((this.user && this.user.id) !== was) for (const fn of this.listeners) fn(this.user);
  }

  async _call(url, init) {
    try {
      return await this.fetch(url, init);
    } catch {
      throw new CloudError('offline', 'Can\'t reach the sync service');
    }
  }

  async _auth(method, path, body, token = null) {
    const headers = { apikey: this.key };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await this._call(`${this.url}/auth/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw await errorFrom(res);
    return res.status === 204 ? {} : res.json().catch(() => ({}));
  }

  /** A current access token, refreshing it first if it's about to expire. */
  async _token(force = false) {
    // another tab may have refreshed (or signed out) since we last looked
    const stored = this._read();
    if (!stored || !this.session || stored.refresh_token !== this.session.refresh_token) this.reload();
    const s = this.session;
    if (!s) throw new CloudError('signed_out', 'Not signed in');
    if (!force && s.expires_at - this.refreshMargin > this.now() / 1000) return s.access_token;
    if (!this._refreshing) {
      this._refreshing = (async () => {
        try {
          this._save(await this._auth('POST', 'token?grant_type=refresh_token', { refresh_token: s.refresh_token }));
        } catch (err) {
          // the sign-in has ended (signed out elsewhere, or expired): sign out here too
          if (err.status >= 400 && err.status < 500) this._save(null);
          throw err;
        } finally {
          this._refreshing = null;
        }
      })();
    }
    await this._refreshing;
    return this.session.access_token;
  }

  async _rest(method, path, body, extra = {}, retried = false) {
    const token = await this._token();
    const headers = { apikey: this.key, Authorization: `Bearer ${token}`, ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this._call(`${this.url}/rest/v1/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) { // token expired early (clock skew): refresh once and retry
      await this._token(true);
      return this._rest(method, path, body, extra, true);
    }
    if (!res.ok) throw await errorFrom(res);
    if (res.status === 204) return [];
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  }
}

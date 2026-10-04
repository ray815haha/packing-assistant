// Accounts and sync, on screen: the account button in the top bar (with a dot
// showing the sync state) and its dialog: sign in, create an account, reset
// a forgotten password, see how syncing is going, sign out, delete the account.

import { $, el } from './dom.js';
import { t, lang } from './i18n.js';

// Supabase error codes -> what to tell people
const ERRORS = {
  invalid_credentials: 'acct.err.credentials',
  invalid_grant: 'acct.err.credentials',
  user_already_exists: 'acct.err.exists',
  email_exists: 'acct.err.exists',
  weak_password: 'acct.err.weak',
  email_not_confirmed: 'acct.err.unconfirmed',
  over_request_rate_limit: 'acct.err.tooMany',
  over_email_send_rate_limit: 'acct.err.tooMany',
  http_429: 'acct.err.tooMany',
  signup_disabled: 'acct.err.noSignup',
  email_address_invalid: 'acct.err.email',
  validation_failed: 'acct.err.email',
  email_address_not_authorized: 'acct.err.noEmail',
  offline: 'acct.err.offline',
};

export function errorText(err) {
  const key = ERRORS[err && err.code];
  return key ? t(key) : t('acct.err.other', { msg: (err && err.message) || String(err) });
}

/**
 * Wire up the account button and dialog.
 * @returns { render, handleRedirect } (render again after a language change)
 */
export function initAccount({ cloud, sync, toast }) {
  const btn = $('accountBtn');
  const dlg = $('accountDialog');
  const body = $('accountBody');
  let view = 'signin'; // signed out: 'signin' | 'signup'; from a reset link: 'recovery'
  let confirming = null; // 'signout' | 'delete'
  let busy = false;
  let msg = null; // { kind: 'error' | 'info', text }
  let email = '';
  let expiredShown = false;

  btn.hidden = false;
  btn.addEventListener('click', () => open());
  $('accountClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the dimmed backdrop
  dlg.addEventListener('close', () => { confirming = null; msg = null; });

  cloud.onChange((user) => {
    if (user) { view = 'signin'; expiredShown = false; }
    render();
  });
  const onStatus = sync.onStatus;
  sync.onStatus = (s) => {
    onStatus(s);
    if (s.state === 'signed-out' && s.error === 'expired' && !expiredShown) {
      expiredShown = true;
      toast(t('acct.expired'));
    }
    render();
  };

  function open() {
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    render(); // after opening: render() only fills an open dialog
    const first = body.querySelector('input, button');
    if (first) first.focus();
  }

  const message = () => (msg ? el('p', { class: `auth-msg ${msg.kind}`, role: msg.kind === 'error' ? 'alert' : 'status' }, msg.text) : null);

  function render() {
    // the dot on the button
    const user = cloud.user;
    const s = sync.status;
    const dot = $('syncDot');
    dot.className = `sync-dot ${!user ? '' : s.state === 'idle' ? 'ok' : s.state}`;
    btn.title = user ? `${t('acct.button')}: ${user.email}` : t('acct.button');
    btn.setAttribute('aria-label', btn.title);
    if (!dlg.open && !dlg.hasAttribute('open')) return;
    body.innerHTML = '';
    const parts = user && view === 'recovery' ? recoveryView() : user ? accountView(user, s) : signedOutView();
    body.append(...parts.filter(Boolean));
  }

  // -- signed out: sign in / create account --------------------------------
  function signedOutView() {
    const create = view === 'signup';
    const tab = (v, label) => el('button', {
      type: 'button', role: 'tab', class: 'kind-opt', 'aria-selected': String(view === v), 'aria-checked': String(view === v),
      onclick: () => { view = v; msg = null; render(); },
    }, t(label));
    return [
      el('p', { class: 'hint' }, t('acct.intro')),
      el('div', { class: 'kinds auth-tabs', role: 'tablist' }, tab('signin', 'acct.tabSignIn'), tab('signup', 'acct.tabCreate')),
      el('form', { class: 'auth-form', onsubmit: submit },
        el('label', {}, el('span', {}, t('acct.email')),
          el('input', { name: 'email', type: 'email', autocomplete: 'email', required: true, value: email, maxlength: '254' })),
        el('label', {}, el('span', {}, t('acct.password')),
          el('input', { name: 'password', type: 'password', autocomplete: create ? 'new-password' : 'current-password', required: true, minlength: create ? '8' : null, maxlength: '72' })),
        create ? el('p', { class: 'hint' }, t('acct.pwHint')) : null,
        el('button', { class: 'btn primary', type: 'submit', disabled: busy }, t(create ? 'acct.create' : 'acct.signIn')),
        create ? null : el('button', { class: 'link', type: 'button', onclick: forgot, disabled: busy }, t('acct.forgot')),
        message()),
    ];
  }

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    email = String(f.get('email') || '').trim();
    const password = String(f.get('password') || '');
    busy = true;
    msg = null;
    render();
    try {
      if (view === 'signup') {
        const r = await cloud.signUp(email, password);
        if (r.needsConfirmation) {
          view = 'signin';
          msg = { kind: 'info', text: t('acct.confirmSent', { email }) };
        } else {
          toast(t('acct.welcome'));
        }
      } else {
        await cloud.signIn(email, password);
        toast(t('acct.signedIn', { email }));
      }
    } catch (err) {
      msg = { kind: 'error', text: errorText(err) };
    }
    busy = false;
    render();
  }

  async function forgot() {
    const input = body.querySelector('input[name=email]');
    email = input.value.trim();
    if (!email || !input.checkValidity()) {
      msg = { kind: 'error', text: t('acct.forgotNeedEmail') };
      render();
      body.querySelector('input[name=email]').focus();
      return;
    }
    busy = true;
    render();
    try {
      await cloud.sendPasswordReset(email, location.origin + location.pathname);
      msg = { kind: 'info', text: t('acct.resetSent', { email }) };
    } catch (err) {
      msg = { kind: 'error', text: errorText(err) };
    }
    busy = false;
    render();
  }

  // -- signed in -------------------------------------------------------------
  function accountView(user, s) {
    const out = [
      el('p', { class: 'acct-who' }, `${t('acct.signedInAs')} `, el('b', {}, user.email)),
      el('p', { class: `sync-line ${s.state}` }, el('span', { class: 'sync-state', 'aria-hidden': 'true' }), statusText(s)),
      el('p', { class: 'hint' }, s.trips === 1 ? t('acct.tripsCount1') : t('acct.tripsCount', { n: s.trips || 0 })),
    ];
    if (confirming === 'signout') {
      out.push(el('div', { class: 'acct-confirm' },
        el('label', { class: 'toggle' }, el('input', { type: 'checkbox', id: 'removeTrips' }), el('span', {}, t('acct.removeTrips'))),
        el('div', { class: 'acct-actions' },
          el('button', { class: 'btn primary', type: 'button', onclick: signOut, disabled: busy }, t('acct.signOut')),
          el('button', { class: 'link', type: 'button', onclick: () => { confirming = null; render(); } }, t('trips.cancel')))));
    } else if (confirming === 'delete') {
      out.push(el('div', { class: 'acct-confirm danger' },
        el('p', {}, t('acct.deleteWarn')),
        el('div', { class: 'acct-actions' },
          el('button', { class: 'btn danger', type: 'button', onclick: deleteAccount, disabled: busy }, t('acct.deleteBtn')),
          el('button', { class: 'link', type: 'button', onclick: () => { confirming = null; render(); } }, t('trips.cancel')))));
    } else {
      out.push(el('div', { class: 'acct-actions' },
        el('button', { class: 'btn secondary', type: 'button', onclick: () => sync.run(), disabled: s.state === 'syncing' }, t('acct.syncNow')),
        el('button', { class: 'btn secondary', type: 'button', onclick: () => { confirming = 'signout'; msg = null; render(); } }, t('acct.signOut'))));
      out.push(el('button', { class: 'link danger-link', type: 'button', onclick: () => { confirming = 'delete'; msg = null; render(); } }, t('acct.delete')));
    }
    out.push(message());
    return out;
  }

  function statusText(s) {
    if (s.state === 'syncing') return t('acct.syncing');
    if (s.state === 'offline') return t('acct.offline');
    if (s.state === 'error') return t('acct.syncError', { msg: s.error });
    return s.last ? t('acct.synced', { ago: ago(s.last) }) : t('acct.notYet');
  }

  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 45) return t('acct.justNow');
    if (s < 3600) return t('acct.minAgo', { n: Math.max(1, Math.round(s / 60)) });
    return new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  }

  async function signOut() {
    const remove = !!($('removeTrips') && $('removeTrips').checked);
    busy = true;
    render();
    await sync.run().catch(() => {}); // send the latest changes first
    await cloud.signOut();
    await sync.forget(remove);
    busy = false;
    confirming = null;
    view = 'signin';
    msg = null;
    toast(t('acct.signedOut'));
    render();
  }

  async function deleteAccount() {
    busy = true;
    render();
    try {
      await cloud.deleteAccount();
      await sync.forget(false);
      confirming = null;
      view = 'signin';
      toast(t('acct.deleted'));
    } catch (err) {
      msg = { kind: 'error', text: errorText(err) };
    }
    busy = false;
    render();
  }

  // -- choosing a new password (after a reset link) ----------------------------
  function recoveryView() {
    return [
      el('h3', { class: 'acct-sub' }, t('acct.recoveryTitle')),
      el('form', {
        class: 'auth-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const password = String(new FormData(e.target).get('password') || '');
          busy = true;
          msg = null;
          render();
          try {
            await cloud.updatePassword(password);
            view = 'signin';
            toast(t('acct.pwChanged'));
          } catch (err) {
            msg = { kind: 'error', text: errorText(err) };
          }
          busy = false;
          render();
        },
      },
      el('input', { type: 'email', name: 'email', autocomplete: 'username', value: cloud.user ? cloud.user.email : '', hidden: true, readonly: true }),
      el('label', {}, el('span', {}, t('acct.newPassword')),
        el('input', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: '8', maxlength: '72' })),
      el('p', { class: 'hint' }, t('acct.pwHint')),
      el('button', { class: 'btn primary', type: 'submit', disabled: busy }, t('acct.savePw')),
      message()),
    ];
  }

  /** Finish a sign-in from an emailed link (#access_token=... in the address). */
  async function handleRedirect() {
    const r = await cloud.takeRedirect(location.hash);
    if (!r) return false;
    history.replaceState(null, '', location.pathname + location.search);
    if (r.error) {
      msg = { kind: 'error', text: t('acct.linkFailed', { msg: r.error }) };
      open();
    } else if (r.type === 'recovery') {
      view = 'recovery';
      open();
    } else {
      toast(t('acct.signedIn', { email: cloud.user.email }));
    }
    return true;
  }

  render();
  return { render, handleRedirect };
}

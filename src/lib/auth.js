// Sign-in with a one-time code sent by email (Supabase Auth), using plain fetch.
// A code (not a link) on purpose: on iPhone, links open Safari instead of the Home Screen app.

import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

const KEY = 'nbt.session';

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
};
let session = read();

function write(next) {
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the session lasts until the page closes.
  }
}

export const currentUser = () => session?.user ?? null;

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.msg || data?.message || data?.error_description || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error_code || data?.code;
    throw err;
  }
  return data;
}

const keep = (d) => ({
  access_token: d.access_token,
  refresh_token: d.refresh_token,
  expires_at: d.expires_at ?? Math.floor(Date.now() / 1000) + d.expires_in,
  user: { id: d.user.id, email: d.user.email },
});

export async function sendCode(email) {
  await call('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
}

export async function verifyCode(email, token) {
  write(keep(await call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token } })));
  return session.user;
}

// Refreshing uses up the refresh token, so concurrent callers share one refresh.
let refreshing = null;
async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  refreshing ??= call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })
    .then((d) => write(keep(d)))
    .catch((err) => {
      // A rejected refresh token means the sign-in ended (e.g. signed out elsewhere); a network error doesn't.
      if (err.status === 400 || err.status === 401) write(null);
      throw err;
    })
    .finally(() => (refreshing = null));
  await refreshing;
  return session?.access_token ?? null;
}

export async function authedFetch(path, opts = {}) {
  const token = await accessToken();
  if (!token) throw Object.assign(new Error('Not signed in'), { status: 401 });
  return call(path, { ...opts, token });
}

export function signOut() {
  const token = session?.access_token;
  write(null);
  if (token) call('/auth/v1/logout', { method: 'POST', token }).catch(() => {});
}

export async function deleteAccount() {
  await authedFetch('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} });
  write(null);
}

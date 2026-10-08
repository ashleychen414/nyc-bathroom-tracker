// Keeps the phone's places in step with the signed-in account (Supabase table `places`).
// Local-first: the app always reads and edits the phone's copy; this runs in the background
// after changes, when the app opens or comes back to the foreground, and when back online.

import { loadAll, replaceAll, planSync, mergePlaces, onLocalChange } from './storage.js';
import { authedFetch, currentUser } from './auth.js';

const toRow = (p) => ({ id: p.id, data: p, updated_at: p.updatedAt, deleted_at: p.deletedAt ?? null });

// Timestamps come back from Postgres as "...+00:00"; normalize to the app's ISO form so they compare.
const iso = (t) => (t ? new Date(t).toISOString() : undefined);
const fromRow = (r) => {
  const place = { ...r.data, id: r.id, updatedAt: iso(r.updated_at) };
  if (r.deleted_at) place.deletedAt = iso(r.deleted_at);
  else delete place.deletedAt;
  return place;
};

// state: 'off' (signed out) | 'syncing' | 'synced' | 'offline' | 'error'
export const syncStatus = { state: currentUser() ? 'synced' : 'off', at: null, error: '' };

let running = null;
let again = false;
let onUpdate = () => {};

async function syncOnce() {
  const rows = await authedFetch('/rest/v1/places?select=id,data,updated_at,deleted_at');
  const before = JSON.stringify(loadAll());
  const { merged, toPush } = planSync(rows.map(fromRow), loadAll());
  if (toPush.length) {
    await authedFetch('/rest/v1/places', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: toPush.map(toRow),
    });
  }
  // Edits made while this was in flight win over what we fetched.
  const latest = mergePlaces(merged, loadAll()).places;
  replaceAll(latest);
  return JSON.stringify(latest) !== before;
}

export async function syncNow() {
  if (!currentUser()) {
    Object.assign(syncStatus, { state: 'off', error: '' });
    return false;
  }
  if (running) {
    again = true; // a change landed mid-sync: run once more afterwards
    return running;
  }
  Object.assign(syncStatus, { state: 'syncing', error: '' });
  onUpdate(false);
  running = (async () => {
    let changed = false;
    try {
      do {
        again = false;
        changed = (await syncOnce()) || changed;
      } while (again);
      Object.assign(syncStatus, { state: 'synced', at: new Date().toISOString() });
    } catch (err) {
      const offline = !navigator.onLine || err instanceof TypeError; // fetch network failure
      Object.assign(syncStatus, {
        state: !currentUser() ? 'off' : offline ? 'offline' : 'error',
        error: offline ? '' : err.message,
      });
    } finally {
      running = null;
    }
    onUpdate(changed);
    return changed;
  })();
  return running;
}

let timer = null;
const soon = () => {
  clearTimeout(timer);
  timer = setTimeout(syncNow, 1200);
};

// update(changed): called when the status changes; changed = places were updated from the account.
export function startSync(update) {
  onUpdate = update;
  onLocalChange(soon);
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  syncNow();
}

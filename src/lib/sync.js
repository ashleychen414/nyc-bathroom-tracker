// Keeps the phone's places in step with the signed-in account: your list (Supabase table
// list_items, on your default list) and the bathrooms you created (bathrooms, created_by = you).
// Local-first: the app always reads and edits the phone's copy; this runs in the background
// after changes, when the app opens or comes back to the foreground, and when back online.

import { loadAll, replaceAll, planSync, mergeBy, onLocalChange } from './storage.js';
import { authedFetch, currentUser } from './auth.js';

// Timestamps come back from Postgres as "...+00:00"; normalize to the app's ISO form so they compare.
const iso = (t) => (t ? new Date(t).toISOString() : undefined);
const withoutEmpty = (x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined));

const BATHROOM_COLUMNS = 'id,name,lat,lng,address,hours,access,visibility,created_at,updated_at,deleted_at';
const ITEM_COLUMNS = 'bathroom_id,notes,created_at,updated_at,deleted_at,bathroom:bathrooms(name,lat,lng)';

export const bathroomFromRow = (r) =>
  withoutEmpty({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    address: r.address ?? '',
    hours: r.hours ?? null,
    access: r.access,
    visibility: r.visibility,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: iso(r.deleted_at),
  });

// The server sets owner, source, status and updated_at itself.
export const bathroomToRow = (b) => ({
  id: b.id,
  name: b.name,
  lat: b.lat,
  lng: b.lng,
  address: b.address || null,
  hours: b.hours ?? null,
  access: b.access,
  visibility: b.visibility,
  deleted_at: b.deletedAt ?? null,
});

export const itemFromRow = (r) =>
  withoutEmpty({
    bathroomId: r.bathroom_id,
    notes: r.notes ?? undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: iso(r.deleted_at),
    snapshot: r.bathroom ? { name: r.bathroom.name, lat: r.bathroom.lat, lng: r.bathroom.lng } : undefined,
  });

export const itemToRow = (i, listId) => ({
  list_id: listId,
  bathroom_id: i.bathroomId,
  notes: i.notes ?? null,
  created_at: i.createdAt,
  updated_at: i.updatedAt,
  deleted_at: i.deletedAt ?? null,
});

// Plans one sync of your bathrooms and list items. Pure, so it can be tested.
// Your bathrooms: one changed on this phone (dirty) or missing from the account is sent; otherwise
// the account's copy wins. (The server stamps its own save time, so phone and server clocks are
// never compared.) A bathroom that's Public on the server stays Public, whatever the phone says.
export function planAll(server, local) {
  const serverById = new Map(server.mine.map((b) => [b.id, b]));
  const keepPublic = (b) => (serverById.get(b.id)?.visibility === 'public' && b.visibility !== 'public' ? { ...b, visibility: 'public', deletedAt: undefined } : b);
  const toPush = local.mine.filter((b) => b.dirty || !serverById.has(b.id)).map(keepPublic).map(withoutEmpty);
  const pushIds = new Set(toPush.map((b) => b.id));
  const merged = [
    ...toPush,
    ...server.mine.filter((b) => !pushIds.has(b.id)),
    ...local.mine.filter((b) => !pushIds.has(b.id) && !serverById.has(b.id)),
  ];
  return { bathrooms: { merged, toPush }, items: planSync(server.items, local.items, 'bathroomId') };
}

// After a push: what the phone keeps. Bathrooms edited again while the push was in flight stay dirty;
// the rest are marked saved. Items: newer edit wins, as in planSync.
export function afterPush(plan, latest) {
  const pushed = new Map(plan.bathrooms.toPush.map((b) => [b.id, b]));
  const mine = plan.bathrooms.merged.map((b) => {
    const now = latest.mine.find((x) => x.id === b.id);
    if (now?.dirty && now.updatedAt !== pushed.get(b.id)?.updatedAt) return now; // edited mid-sync
    const { dirty, ...saved } = b;
    return saved;
  });
  for (const b of latest.mine) if (!mine.some((x) => x.id === b.id)) mine.push(b); // added mid-sync
  return { mine, items: mergeBy(plan.items.merged, latest.items, 'bathroomId').list };
}

// state: 'off' (signed out) | 'syncing' | 'synced' | 'offline' | 'error'
// sharePromptDue: the account has places moved over as Private and hasn't seen the prompt yet.
export const syncStatus = { state: currentUser() ? 'synced' : 'off', at: null, error: '', sharePromptDue: false };

let running = null;
let again = false;
let onUpdate = () => {};
let listId = null; // your default list

async function defaultList() {
  if (listId) return listId;
  const [row] = await authedFetch('/rest/v1/lists?select=id&is_default=eq.true');
  if (!row) throw new Error('Your list is missing. Try signing out and in again.');
  return (listId = row.id);
}

async function syncOnce() {
  const user = currentUser();
  const list = await defaultList();
  const [mineRows, itemRows, [profile]] = await Promise.all([
    authedFetch(`/rest/v1/bathrooms?select=${BATHROOM_COLUMNS}&created_by=eq.${user.id}`),
    authedFetch(`/rest/v1/list_items?select=${ITEM_COLUMNS}&list_id=eq.${list}`),
    authedFetch('/rest/v1/profiles?select=share_prompt_due'),
  ]);
  syncStatus.sharePromptDue = Boolean(profile?.share_prompt_due);

  const before = JSON.stringify(loadAll());
  const server = { mine: mineRows.map(bathroomFromRow), items: itemRows.map(itemFromRow) };
  const plan = planAll(server, loadAll());
  const { bathrooms, items } = plan;
  // Bathrooms first: an item can only point at a bathroom the server already has.
  if (bathrooms.toPush.length) {
    await authedFetch('/rest/v1/bathrooms?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: bathrooms.toPush.map(bathroomToRow),
    });
  }
  if (items.toPush.length) {
    await authedFetch('/rest/v1/list_items?on_conflict=list_id,bathroom_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: items.toPush.map((i) => itemToRow(i, list)),
    });
  }
  // Edits made while this was in flight win over what we fetched.
  const merged = afterPush(plan, loadAll());
  replaceAll(merged);
  return JSON.stringify(merged) !== before;
}

export async function syncNow() {
  if (!currentUser()) {
    listId = null;
    Object.assign(syncStatus, { state: 'off', error: '', sharePromptDue: false });
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

// The one-time "Share your places?" prompt was answered: don't show it again on any phone.
export async function clearSharePrompt() {
  syncStatus.sharePromptDue = false;
  const user = currentUser();
  if (!user) return;
  await authedFetch(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: { share_prompt_due: false },
  });
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

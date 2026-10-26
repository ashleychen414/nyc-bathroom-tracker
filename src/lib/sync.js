// Keeps the phone's places in step with the signed-in account: your list (Supabase table
// list_items, on your default list), the bathrooms you created (bathrooms, created_by = you), and
// your visits and ratings (visits; ones logged signed out upload here, at sign-in).
// Local-first: the app always reads and edits the phone's copy; this runs in the background
// after changes, when the app opens or comes back to the foreground, and when back online.

import { loadAll, replaceAll, planSync, mergeBy, onLocalChange } from './storage.js';
import { authedFetch, currentUser } from './auth.js';
import { loadVisits, replaceVisits, onVisitsChange } from './visits.js';

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

const VISIT_COLUMNS = 'id,bathroom_id,visited_at,clean,get_in,vibes,chips,smell,trash,lighting,stall_count,source,updated_at';

export const visitFromRow = (r) =>
  withoutEmpty({
    id: r.id,
    bathroomId: r.bathroom_id,
    visitedAt: iso(r.visited_at),
    clean: r.clean ?? undefined,
    getIn: r.get_in ?? undefined,
    vibes: r.vibes ?? undefined,
    chips: r.chips ?? [],
    smell: r.smell ?? undefined,
    trash: r.trash ?? undefined,
    lighting: r.lighting ?? undefined,
    stallCount: r.stall_count ?? undefined,
    source: r.source,
    updatedAt: iso(r.updated_at),
  });

// Every row has the same keys (a bulk insert needs that); chips is never null. The server fills in
// user_id and source.
export const visitToRow = (v) => ({
  id: v.id,
  bathroom_id: v.bathroomId,
  visited_at: v.visitedAt,
  clean: v.clean ?? null,
  get_in: v.getIn ?? null,
  vibes: v.vibes ?? null,
  chips: v.chips ?? [],
  smell: v.smell ?? null,
  trash: v.trash ?? null,
  lighting: v.lighting ?? null,
  stall_count: v.stallCount ?? null,
  updated_at: v.updatedAt,
});

// Visits: newer edit wins per visit (both times set by phones, as list items). What only this phone
// knows (the bathroom's name, a closed "Rate your last visit" card, a refused upload) is kept.
// Refused ones aren't sent again until they're edited. Pure, so it can be tested.
export function planVisits(server, local) {
  const { merged, toPush } = planSync(server, local, 'id');
  const localById = new Map(local.map((v) => [v.id, v]));
  const keep = (v) => {
    const l = localById.get(v.id);
    return l ? withoutEmpty({ ...v, name: l.name, dismissedAt: l.dismissedAt, stuck: v === l ? l.stuck : undefined }) : v;
  };
  return { merged: merged.map(keep), toPush: toPush.filter((v) => !v.stuck) };
}

// After a push: refused visits are marked stuck; a visit logged or rated mid-sync (newer edit) wins,
// and a "Rate your last visit" card closed mid-sync stays closed. Pure, so it can be tested.
export function afterVisitPush(plan, stuck, latest) {
  const planned = plan.merged.map((v) => (stuck.has(v.id) ? { ...v, stuck: true } : v));
  const latestById = new Map(latest.map((v) => [v.id, v]));
  return mergeBy(planned, latest, 'id').list.map((v) => {
    const dismissedAt = latestById.get(v.id)?.dismissedAt;
    return dismissedAt && !v.dismissedAt ? { ...v, dismissedAt } : v;
  });
}

// Sends visits. Old ratings carried over on this phone are only added, never written over: their
// id is the old place's, which may already be on the account (or, after a switch of account,
// someone else's). If the batch is refused, each is tried alone and the refused ones are marked
// stuck, so one bad visit (say, its bathroom was deleted) doesn't block the rest.
async function pushVisits(visits) {
  const send = (list, ignore) =>
    authedFetch('/rest/v1/visits?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=minimal` },
      body: list.map(visitToRow),
    });
  const stuck = new Set();
  for (const ignore of [true, false]) {
    const group = visits.filter((v) => (v.source === 'carried_over') === ignore);
    if (!group.length) continue;
    try {
      await send(group, ignore);
    } catch (err) {
      if (!err.status || err.status === 401 || err.status >= 500) throw err; // offline, signed out, server trouble: retry later
      for (const v of group) {
        try {
          await send([v], ignore);
        } catch (one) {
          if (!one.status || one.status === 401 || one.status >= 500) throw one;
          stuck.add(v.id);
        }
      }
    }
  }
  return stuck;
}

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
  const [mineRows, itemRows, [profile], visitRows] = await Promise.all([
    authedFetch(`/rest/v1/bathrooms?select=${BATHROOM_COLUMNS}&created_by=eq.${user.id}`),
    authedFetch(`/rest/v1/list_items?select=${ITEM_COLUMNS}&list_id=eq.${list}`),
    authedFetch('/rest/v1/profiles?select=share_prompt_due'),
    authedFetch(`/rest/v1/visits?select=${VISIT_COLUMNS}`),
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

  // Visits last: one can only point at a bathroom the server already has.
  const visitsBefore = JSON.stringify(loadVisits());
  const visitPlan = planVisits(visitRows.map(visitFromRow), loadVisits());
  const stuck = visitPlan.toPush.length ? await pushVisits(visitPlan.toPush) : new Set();
  const visits = afterVisitPush(visitPlan, stuck, loadVisits());
  replaceVisits(visits);
  if (visitPlan.toPush.length) syncStatus.visitsPushedAt = new Date().toISOString();
  return JSON.stringify(merged) !== before || JSON.stringify(visits) !== visitsBefore;
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
  onVisitsChange(soon);
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  syncNow();
}

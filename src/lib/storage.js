// Saved places ("My places"): your list, plus the bathrooms you created. The phone's copy is the
// source the app reads and edits; when signed in, src/lib/sync.js keeps it in step with the
// account (Supabase tables list_items and bathrooms).
//
// Stored (schema version 2):
// {
//   items: list items, one per saved bathroom (E2: one list, "My places"):
//     { bathroomId, notes?, createdAt, updatedAt, deletedAt?,
//       snapshot?: { name, lat, lng } }  shown if the bathroom isn't in the loaded data
//   mine: bathrooms you created:
//     { id: uuid, name, lat, lng, address, hours: hours model (see hours.js) | null,
//       access: 'public' | 'customers_only' | 'unknown', visibility: 'public' | 'private',
//       createdAt, updatedAt, deletedAt? (Private ones only),
//       dirty?: true  changed on this phone and not yet saved to the account }
// }
// Deleted things stay as hidden "tombstones" (deletedAt) so the delete syncs.
//
// The screens see one "place" per visible item (see toPlace): { id: the bathroom id, name, lat, lng,
// notes, createdAt, updatedAt } plus either own: true and the bathroom's fields (one you created),
// or publicId: the bathroom id (a shared bathroom you saved).
//
// Version 1 (before E2) kept whole place copies under nbt.places; they're moved over once, on load.
// That key is left in place: E3 carries its old ratings over to visits.

const KEY = 'nbt.lists';
const V1_KEY = 'nbt.places';
export const SCHEMA_VERSION = 2;

const empty = () => ({ items: [], mine: [] });

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (data && Array.isArray(data.items) && Array.isArray(data.mine)) return data;
    const v1 = JSON.parse(localStorage.getItem(V1_KEY) ?? 'null');
    if (Array.isArray(v1?.places)) {
      const moved = fromV1(v1.places);
      store(moved);
      return moved;
    }
  } catch {
    // Blocked or unreadable storage: start empty.
  }
  return empty();
}

// Throws if the browser blocks storage or is full; callers show the error.
function store(data) {
  localStorage.setItem(KEY, JSON.stringify({ version: SCHEMA_VERSION, items: data.items, mine: data.mine }));
}

const visible = (x) => !x.deletedAt;

// Lets the sync layer know something changed locally.
const listeners = new Set();
export const onLocalChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

// ---------- Moving version 1 places ----------

// A saved city restroom becomes an item pointing to it; a hand-added place becomes a Private
// bathroom of yours with the same id (as the server migration did), access unknown.
export function fromV1(places) {
  const data = empty();
  for (const p of places) {
    if (!p || typeof p.id !== 'string' || p.deletedAt || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const notes = p.log?.notes?.trim() || undefined;
    const times = { createdAt: p.createdAt ?? p.updatedAt, updatedAt: p.updatedAt };
    if (p.publicId) {
      data.items.push({ bathroomId: p.publicId, notes, ...times, snapshot: { name: p.name, lat: p.lat, lng: p.lng } });
    } else {
      data.mine.push({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, address: p.address ?? '', hours: p.hours ?? null, access: 'unknown', visibility: 'private', ...times });
      data.items.push({ bathroomId: p.id, notes, ...times });
    }
  }
  return data;
}

// ---------- What the screens use ----------

function toPlace(item, mineById) {
  const own = mineById.get(item.bathroomId);
  const base = { id: item.bathroomId, notes: item.notes ?? '', createdAt: item.createdAt, updatedAt: item.updatedAt };
  if (own) {
    const { id, createdAt, updatedAt, deletedAt, ...fields } = own;
    return { ...base, ...fields, own: true, updatedAt: own.updatedAt > item.updatedAt ? own.updatedAt : item.updatedAt };
  }
  return { ...base, publicId: item.bathroomId, ...(item.snapshot ?? {}) };
}

function places(data) {
  const mineById = new Map(data.mine.filter(visible).map((b) => [b.id, b]));
  return data.items.filter(visible).map((i) => toPlace(i, mineById));
}

export const listPlaces = () => places(load()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const getPlace = (id) => places(load()).find((p) => p.id === id) ?? null;

// Your bathrooms that are still Private (for the "Share your places?" prompt).
export const privatePlaces = () => listPlaces().filter((p) => p.own && p.visibility === 'private');

// place: { id?, publicId?, name, lat, lng, notes, and for your own: address, hours, access, visibility }
// Saving a shared bathroom only touches your item (notes); saving your own also saves the bathroom.
export function savePlace(place) {
  const data = load();
  const now = new Date().toISOString();
  const bathroomId = place.publicId ?? place.id ?? crypto.randomUUID();
  if (!place.publicId) {
    const existing = data.mine.find((b) => b.id === bathroomId);
    // Public is one-way: others may have saved it (the database refuses Public → Private too).
    const visibility = existing?.visibility === 'public' ? 'public' : place.visibility === 'public' ? 'public' : 'private';
    const bathroom = {
      id: bathroomId,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      address: place.address ?? '',
      hours: place.hours ?? null,
      access: ['public', 'customers_only'].includes(place.access) ? place.access : 'unknown',
      visibility,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      dirty: true,
    };
    upsert(data.mine, bathroom, (b) => b.id === bathroomId);
  }
  const item = data.items.find((i) => i.bathroomId === bathroomId);
  const notes = place.notes?.trim() || undefined;
  upsert(
    data.items,
    {
      bathroomId,
      notes,
      createdAt: item && !item.deletedAt ? item.createdAt : now,
      updatedAt: now,
      ...(place.publicId ? { snapshot: { name: place.name, lat: place.lat, lng: place.lng } } : {}),
    },
    (i) => i.bathroomId === bathroomId,
  );
  store(data);
  notify();
  return getPlace(bathroomId);
}

function upsert(list, value, match) {
  const index = list.findIndex(match);
  if (index === -1) list.push(value);
  else list[index] = value;
}

// Removes it from your list. A Private bathroom of yours is deleted too; a Public one stays on
// the map for everyone (others may have saved it).
export function deletePlace(id) {
  const data = load();
  const now = new Date().toISOString();
  data.items = data.items.map((i) => (i.bathroomId === id ? { ...i, deletedAt: now, updatedAt: now } : i));
  data.mine = data.mine.map((b) => (b.id === id && b.visibility === 'private' ? { ...b, deletedAt: now, updatedAt: now, dirty: true } : b));
  store(data);
  notify();
}

// Makes these bathrooms of yours Public (the "Share your places?" prompt).
export function makePublic(ids) {
  const data = load();
  const now = new Date().toISOString();
  data.mine = data.mine.map((b) => (ids.includes(b.id) && !b.deletedAt ? { ...b, visibility: 'public', updatedAt: now, dirty: true } : b));
  store(data);
  notify();
}

// ---------- For the sync layer ----------

export const loadAll = () => load(); // including tombstones
export const replaceAll = (data) => store(data); // no notify: sync writes here
export function clearLocal() {
  for (const key of [KEY, V1_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing to clear
    }
  }
}

// Newer edit wins per key, tombstones included. Pure, so it can be tested without a browser.
export function mergeBy(current, incoming, key) {
  const byKey = new Map(current.map((x) => [x[key], x]));
  const counts = { added: 0, updated: 0, unchanged: 0 };
  for (const x of incoming) {
    const existing = byKey.get(x[key]);
    if (!existing) counts.added++;
    else if (x.updatedAt > existing.updatedAt) counts.updated++;
    else {
      counts.unchanged++;
      continue;
    }
    byKey.set(x[key], x);
  }
  return { list: [...byKey.values()], counts };
}

// Given the account copy and the phone copy of list items, returns the merged list and the items
// the server needs (newer edit wins; both times are set by phones, as places did).
export function planSync(server, local, key) {
  const { list: merged } = mergeBy(server, local, key);
  const serverByKey = new Map(server.map((x) => [x[key], x]));
  const toPush = merged.filter((x) => !serverByKey.has(x[key]) || x.updatedAt > serverByKey.get(x[key]).updatedAt);
  return { merged, toPush };
}

// ---------- Backup ----------

const BACKUP_APP = 'nyc-bathroom-tracker';

export function exportPlaces() {
  const data = load();
  return {
    app: BACKUP_APP,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    places: places(data), // for reading; import uses items and mine
    items: data.items.filter(visible),
    mine: data.mine.filter(visible),
  };
}

const isItem = (i) => i && typeof i.bathroomId === 'string' && typeof i.updatedAt === 'string';
const isBathroom = (b) =>
  b && typeof b.id === 'string' && typeof b.name === 'string' && Number.isFinite(b.lat) && Number.isFinite(b.lng) && typeof b.updatedAt === 'string';

// Merges a backup into the current data; when something is in both, the newer edit wins.
// Version 1 backups (whole places) are moved over first. Pure, so it can be tested.
export function mergeBackup(current, backup) {
  const incoming = backup.version >= 2 ? { items: backup.items ?? [], mine: backup.mine ?? [] } : fromV1(backup.places ?? []);
  const mine = incoming.mine.filter(isBathroom);
  const mineIds = new Set([...current.mine, ...mine].map((b) => b.id));
  // An item for a bathroom of yours needs that bathroom; items for shared ones stand alone.
  const items = incoming.items.filter((i) => isItem(i) && (!incoming.mine.some((b) => b.id === i.bathroomId) || mineIds.has(i.bathroomId)));
  const total = backup.version >= 2 ? incoming.items.length : backup.places.length;
  // Counts are per saved place (its item), so a place you created counts once.
  const mergedItems = mergeBy(current.items, items, 'bathroomId');
  const mergedMine = mergeBy(current.mine, mine.map((b) => ({ ...b, dirty: true })), 'id');
  return { data: { items: mergedItems.list, mine: mergedMine.list }, counts: { ...mergedItems.counts, skipped: total - items.length } };
}

// Throws an Error with a readable message if the file isn't a backup from this app.
export function importPlaces(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a backup from this app.");
  }
  const ok = backup?.app === BACKUP_APP && (Array.isArray(backup.places) || Array.isArray(backup.items));
  if (!ok) throw new Error("That file isn't a backup from this app.");
  if (backup.version > SCHEMA_VERSION) throw new Error('That backup is from a newer version of the app. Reload and try again.');
  const { data, counts } = mergeBackup(load(), backup);
  store(data);
  notify();
  return counts;
}

// Asks the browser not to clear our data under storage pressure. Helps on Android/Chrome;
// on iOS, adding the app to the home screen is what protects it.
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

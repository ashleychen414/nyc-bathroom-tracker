// Saved places ("My places"). The phone's copy is the source the app reads and edits;
// when signed in, src/lib/sync.js keeps it in step with the account copy on the server.
//
// Place (schema version 1):
// {
//   id: uuid, name, lat, lng, address,
//   publicId?: NYC restroom id, when a public restroom was saved
//   log: {
//     lighting, cleanliness, trashCleanliness, smell: 1-5 (1 = very bad, 5 = very good)
//     hasTrash, hasStalls: boolean
//     stallCount: positive integer, only when hasStalls is true
//     notes: string
//   }  every log field is optional; only what the user chose to log is stored
//   hours?: hours model (see hours.js), your own places only
//   origin?: 'mine' (default) | 'imported' (lists phase 2), importedFrom?: { name, placeId }
//   createdAt, updatedAt: ISO strings
//   deletedAt?: ISO string. Deleted places stay as hidden "tombstones" so the delete syncs.
// }

const KEY = 'nbt.places';
export const SCHEMA_VERSION = 1;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(data?.places) ? data.places : [];
  } catch {
    return [];
  }
}

// Throws if the browser blocks storage or is full; callers show the error.
function store(places) {
  localStorage.setItem(KEY, JSON.stringify({ version: SCHEMA_VERSION, places }));
}

const visible = (p) => !p.deletedAt;

// Lets the sync layer know something changed locally.
const listeners = new Set();
export const onLocalChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

export const listPlaces = () => load().filter(visible).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const getPlace = (id) => load().find((p) => p.id === id && visible(p)) ?? null;

export function savePlace(place) {
  const places = load();
  const now = new Date().toISOString();
  const saved = { ...place, id: place.id ?? crypto.randomUUID(), createdAt: place.createdAt ?? now, updatedAt: now };
  const index = places.findIndex((p) => p.id === saved.id);
  if (index === -1) places.push(saved);
  else places[index] = saved;
  store(places);
  notify();
  return saved;
}

export function deletePlace(id) {
  const now = new Date().toISOString();
  store(load().map((p) => (p.id === id ? { ...p, deletedAt: now, updatedAt: now } : p)));
  notify();
}

// ---------- For the sync layer ----------

export const loadAll = () => load(); // including tombstones
export const replaceAll = (places) => store(places); // no notify: sync writes here
export function clearLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

// Given the account copy and the phone copy, returns the merged list (newer edit wins
// per place, tombstones included) and the places the server needs.
export function planSync(server, local) {
  const { places: merged } = mergePlaces(server, local);
  const serverById = new Map(server.map((p) => [p.id, p]));
  const toPush = merged.filter((p) => !serverById.has(p.id) || p.updatedAt > serverById.get(p.id).updatedAt);
  return { merged, toPush };
}

// ---------- Backup ----------

const BACKUP_APP = 'nyc-bathroom-tracker';

export function exportPlaces() {
  return { app: BACKUP_APP, version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), places: load().filter(visible) };
}

const isPlace = (p) =>
  p && typeof p.id === 'string' && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && typeof p.updatedAt === 'string';

// Merges a backup into the current list by id; when a place is in both, the newer edit wins.
// Pure, so it can be tested without a browser.
export function mergePlaces(current, incoming) {
  const byId = new Map(current.map((p) => [p.id, p]));
  const counts = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
  for (const p of incoming) {
    if (!isPlace(p)) {
      counts.skipped++;
      continue;
    }
    const existing = byId.get(p.id);
    if (!existing) counts.added++;
    else if (p.updatedAt > existing.updatedAt) counts.updated++;
    else {
      counts.unchanged++;
      continue;
    }
    byId.set(p.id, { log: {}, ...p });
  }
  return { places: [...byId.values()], counts };
}

// Throws an Error with a readable message if the file isn't a backup from this app.
export function importPlaces(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a backup from this app.");
  }
  if (data?.app !== BACKUP_APP || !Array.isArray(data.places)) throw new Error("That file isn't a backup from this app.");
  if (data.version > SCHEMA_VERSION) throw new Error('That backup is from a newer version of the app. Reload and try again.');
  const { places, counts } = mergePlaces(load(), data.places);
  store(places);
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

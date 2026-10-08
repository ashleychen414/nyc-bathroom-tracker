// Saved places ("My places"), stored on this device for the MVP.
// All reads and writes go through this module so follow-up #1 (sync to a server)
// only has to change this file.
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
//   createdAt, updatedAt: ISO strings
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

export const listPlaces = () => load().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const getPlace = (id) => load().find((p) => p.id === id) ?? null;

export function savePlace(place) {
  const places = load();
  const now = new Date().toISOString();
  const saved = { ...place, id: place.id ?? crypto.randomUUID(), createdAt: place.createdAt ?? now, updatedAt: now };
  const index = places.findIndex((p) => p.id === saved.id);
  if (index === -1) places.push(saved);
  else places[index] = saved;
  store(places);
  return saved;
}

export function deletePlace(id) {
  store(load().filter((p) => p.id !== id));
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

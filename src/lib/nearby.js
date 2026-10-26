// Builds the Nearby list: shared bathrooms (city restrooms and Public ones people added) and the
// user's own places, mixed, filtered, and sorted open-first then by distance.

import { getStatus, STATE_RANK } from './hours.js';
import { distanceMiles } from './geo.js';

export const RADII = [0.25, 0.5, 1];
export const MIN_RESULTS = 5;

// The user's own places are always "operational"; their status comes from the hours they logged.
export const placeStatus = (place, now = new Date()) =>
  getStatus({ status: 'Operational', season: null, hours: place.hours ?? null }, now);

// A bathroom someone added has no city status: its hours decide, unless we marked it closed.
export const bathroomStatus = (b, now = new Date()) => {
  if (b.source !== 'user') return getStatus(b, now);
  if (b.recordStatus === 'closed') return { state: 'closed', label: 'Closed' };
  return placeStatus(b, now);
};

// One entry per bathroom. A saved shared bathroom stays one entry (its data + your notes).
// Your own bathrooms always come from the phone's copy (it has your latest edits), even once
// they're Public and in the shared data. A saved bathroom missing from the data (e.g. it left the
// city data) falls back to being "yours". Duplicates (the same café added by two people) both show.
export function buildEntries(bathrooms, places, now = new Date()) {
  const placeById = new Map(places.map((p) => [p.id, p]));
  const shown = new Set();
  const entries = [];
  for (const b of bathrooms) {
    if (placeById.get(b.id)?.own) continue;
    shown.add(b.id);
    entries.push({ kind: 'public', id: b.id, name: b.name, lat: b.lat, lng: b.lng, bathroom: b, place: placeById.get(b.id) ?? null, status: bathroomStatus(b, now) });
  }
  for (const p of places) {
    if (shown.has(p.id) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    entries.push({ kind: 'mine', id: p.id, name: p.name, lat: p.lat, lng: p.lng, bathroom: null, place: p, status: placeStatus(p, now) });
  }
  return entries;
}

export function matches(entry, { kind = 'all', type = '', hideClosed = false, openNow = false, accessible = false, changing = false }) {
  // A type (Park, Library, ...) is a city-data field, so it narrows to public restrooms of that type.
  if (type && entry.bathroom?.type !== type) return false;
  if (hideClosed && entry.status.state === 'closed') return false;
  if (kind === 'public' && entry.kind !== 'public') return false;
  if (kind === 'mine' && !entry.place) return false;
  if (openNow && entry.status.state !== 'open') return false;
  // Accessible means fully accessible: "Partially" isn't enough to promise someone.
  if (accessible && entry.bathroom?.accessibility !== 'Fully Accessible') return false;
  if (changing && !entry.bathroom?.changingStations?.startsWith('Yes')) return false;
  return true;
}

const byStatusThenDistance = (a, b) => STATE_RANK[a.status.state] - STATE_RANK[b.status.state] || a.distance - b.distance;

// inside: everything within the radius. outside: the nearest beyond it, only when
// inside has fewer than MIN_RESULTS, topping the list up to MIN_RESULTS.
export function nearby(entries, here, { radius, ...filters }) {
  const candidates = entries.filter((e) => matches(e, filters)).map((e) => ({ ...e, distance: distanceMiles(here, e) }));
  const inside = candidates.filter((e) => e.distance <= radius).sort(byStatusThenDistance);
  const outside =
    inside.length >= MIN_RESULTS
      ? []
      : candidates
          .filter((e) => e.distance > radius)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, MIN_RESULTS - inside.length)
          .sort(byStatusThenDistance);
  return { inside, outside };
}

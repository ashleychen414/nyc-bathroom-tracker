// Builds the Nearby list: public restrooms and the user's own places, mixed,
// filtered, and sorted open-first then by distance.

import { getStatus, STATE_RANK } from './hours.js';
import { distanceMiles } from './geo.js';

export const RADII = [0.25, 0.5, 1];
export const MIN_RESULTS = 5;

// The user's own places are always "operational"; their status comes from the hours they logged.
export const placeStatus = (place, now = new Date()) =>
  getStatus({ status: 'Operational', season: null, hours: place.hours ?? null }, now);

// One entry per restroom. A saved public restroom stays one entry (public data + your log).
// A saved public restroom whose row has left the city data falls back to being "yours".
export function buildEntries(bathrooms, places, now = new Date()) {
  const publicIds = new Set(bathrooms.map((b) => b.id));
  const savedByPublicId = new Map(places.filter((p) => p.publicId).map((p) => [p.publicId, p]));
  return [
    ...bathrooms.map((b) => ({
      kind: 'public',
      id: b.id,
      name: b.name,
      lat: b.lat,
      lng: b.lng,
      bathroom: b,
      place: savedByPublicId.get(b.id) ?? null,
      status: getStatus(b, now),
    })),
    ...places
      .filter((p) => !p.publicId || !publicIds.has(p.publicId))
      .map((p) => ({ kind: 'mine', id: p.id, name: p.name, lat: p.lat, lng: p.lng, bathroom: null, place: p, status: placeStatus(p, now) })),
  ];
}

export function matches(entry, { kind = 'all', hideClosed = false, openNow = false, accessible = false, changing = false }) {
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

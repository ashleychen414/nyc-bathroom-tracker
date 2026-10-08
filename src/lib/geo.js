// Location helpers: GPS, distance, address search, Google Maps directions.

// Address search uses Photon (photon.komoot.io): free, no API key, built on OpenStreetMap.
// Fine for a friends-scale tool; revisit (e.g. Geoapify) if usage grows.
const PHOTON = 'https://photon.komoot.io';
const NYC_BBOX = '-74.26,40.49,-73.70,40.92';
const BROOKLYN = { lat: 40.65, lng: -73.95 };

export function getPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

export function distanceMiles(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function formatDistance(miles) {
  return miles < 0.1 ? `${Math.round(miles * 5280)} ft` : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

function toResult(feature) {
  const p = feature.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const area = p.district ?? p.city ?? p.county;
  const address = [street || (p.name !== area ? p.name : null), area].filter(Boolean).join(', ');
  const [lng, lat] = feature.geometry.coordinates;
  return { name: p.name ?? street ?? '', address: address || p.name || '', lat, lng };
}

export async function searchAddress(query, near = BROOKLYN, signal) {
  const params = new URLSearchParams({ q: query, limit: '5', lat: near.lat, lon: near.lng, bbox: NYC_BBOX });
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  return (await res.json()).features.map(toResult);
}

export async function reverseGeocode({ lat, lng }) {
  const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&limit=1`);
  if (!res.ok) return null;
  const [feature] = (await res.json()).features;
  return feature ? toResult(feature) : null;
}

export const directionsUrl = ({ lat, lng }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

// Map view of Nearby: the same results as the list, as pins colored by status.

import { loadLeaflet } from '../lib/leaflet-loader.js';
import { formatDistance, directionsUrl } from '../lib/geo.js';
import { esc } from '../lib/html.js';

const PIN = { open: '#1d7a45', unknown: '#8a867e', varies: '#c7841a', closed: '#b5b1a9' };
const MINE_RING = '#1f4e8c';
const YOU = '#2563eb';
const METERS_PER_MILE = 1609.34;

let map = null;

export function unmountMap() {
  map?.remove();
  map = null;
}

function popupHtml(e, approx) {
  const href = e.kind === 'public' ? `#/r/${encodeURIComponent(e.id)}` : `#/mine/${encodeURIComponent(e.id)}`;
  return `
    <div class="pin-popup">
      <p class="pin-name">${esc(e.name)}</p>
      <p class="pin-meta">${esc(e.status.label)} · ${approx ? '~' : ''}${formatDistance(e.distance)}${e.place ? ' · Your place' : ''}</p>
      <p class="pin-actions"><a href="${href}">Details</a><a href="${directionsUrl(e)}" target="_blank" rel="noopener">Directions</a></p>
    </div>`;
}

// el: the #map element just painted. Re-creates the map each time the list changes.
export async function mountMap(el, { entries, here, radius, approx, zip }) {
  let L;
  try {
    L = await loadLeaflet();
  } catch (err) {
    if (el.isConnected) el.innerHTML = `<p class="map-error">${esc(err.message)} Check your connection, or use the list.</p>`;
    return;
  }
  if (!el.isConnected) return; // the screen changed while Leaflet was loading
  unmountMap();

  map = L.map(el, { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const center = [here.lat, here.lng];
  L.circle(center, { radius: radius * METERS_PER_MILE, color: '#135633', weight: 1, fillOpacity: 0.04, interactive: false }).addTo(map);
  L.circleMarker(center, { radius: 8, color: '#fff', weight: 3, fillColor: YOU, fillOpacity: 1 })
    .bindTooltip(approx ? `Middle of ${zip}` : 'You are here')
    .addTo(map);

  for (const e of entries) {
    L.circleMarker([e.lat, e.lng], {
      radius: e.place ? 10 : 8,
      color: e.place ? MINE_RING : '#fff',
      weight: e.place ? 3 : 2,
      fillColor: PIN[e.status.state],
      fillOpacity: e.status.state === 'closed' ? 0.7 : 1,
    })
      .bindPopup(popupHtml(e, approx))
      .addTo(map);
  }

  // Frame the radius (computed from the center: a circle can't measure itself before the map has a view) plus every pin.
  const bounds = L.latLng(center).toBounds(2 * radius * METERS_PER_MILE);
  for (const e of entries) bounds.extend([e.lat, e.lng]);
  map.fitBounds(bounds.pad(0.08), { maxZoom: 17 });
}

export const mapLegend = `
  <div class="legend" aria-hidden="true">
    <span><i style="background:${PIN.open}"></i>Open</span>
    <span><i style="background:${PIN.unknown}"></i>Unknown</span>
    <span><i style="background:${PIN.varies}"></i>Varies</span>
    <span><i class="mine" style="background:#fff;border-color:${MINE_RING}"></i>Your place</span>
    <span><i style="background:${YOU}"></i>You</span>
  </div>`;

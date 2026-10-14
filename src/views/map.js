// Map view of Nearby (the default): full-screen map, pins colored by status, and a bottom
// card for the selected bathroom. Tapping a pin selects it; the card is rendered by nearby.js.

import { loadLeaflet } from '../lib/leaflet-loader.js';
import { esc } from '../lib/html.js';

export const PIN = { open: '#1d7a45', unknown: '#8a867e', varies: '#c7841a', closed: '#b5b1a9' };
const MINE_RING = '#1f4e8c';
const SELECTED_RING = '#1c1b19';
const YOU = '#2563eb';
const METERS_PER_MILE = 1609.34;

let map = null;
let markers = new Map(); // entry id -> { marker, entry }
let selectedId = null;

export function unmountMap() {
  map?.remove();
  map = null;
  markers = new Map();
  selectedId = null;
}

const pinStyle = (e, selected) => ({
  radius: selected ? 13 : e.place ? 10 : 8,
  color: selected ? SELECTED_RING : e.place ? MINE_RING : '#fff',
  weight: selected ? 4 : e.place ? 3 : 2,
  fillColor: PIN[e.status.state],
  fillOpacity: e.status.state === 'closed' ? 0.7 : 1,
});

// Highlights a pin and, if it's hidden behind the card, pans just enough to show it.
export function selectPin(id, { pan = false } = {}) {
  if (!map) return;
  markers.get(selectedId)?.marker.setStyle(pinStyle(markers.get(selectedId).entry, false));
  selectedId = id;
  const hit = markers.get(id);
  if (!hit) return;
  hit.marker.setStyle(pinStyle(hit.entry, true)).bringToFront();
  if (pan) map.panInside(hit.marker.getLatLng(), { paddingTopLeft: [24, 24], paddingBottomRight: [24, sheetHeight() + 24] });
}

let sheetEl = null;
const sheetHeight = () => sheetEl?.offsetHeight ?? 0;

// el: the #map element just painted; sheet: the card over the map (kept clear when framing).
export async function mountMap(el, { entries, here, radius, approx, zip, selected, sheet, onSelect }) {
  let L;
  try {
    L = await loadLeaflet();
  } catch (err) {
    if (el.isConnected) el.innerHTML = `<p class="map-error">${esc(err.message)} Check your connection, or switch to the list.</p>`;
    return;
  }
  if (!el.isConnected) return; // the screen changed while Leaflet was loading
  unmountMap();
  sheetEl = sheet;

  // Attribution top-right so the bottom card never covers it.
  map = L.map(el, { zoomControl: true, attributionControl: false });
  L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
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
    const marker = L.circleMarker([e.lat, e.lng], pinStyle(e, false))
      .bindTooltip(esc(e.name), { direction: 'top', offset: [0, -8] })
      .on('click', () => onSelect(e.id))
      .addTo(map);
    markers.set(e.id, { marker, entry: e });
  }

  // Frame the radius (computed from the center: a circle can't measure itself before the
  // map has a view) plus every pin, keeping them clear of the bottom card.
  const bounds = L.latLng(center).toBounds(2 * radius * METERS_PER_MILE);
  for (const e of entries) bounds.extend([e.lat, e.lng]);
  map.fitBounds(bounds, { maxZoom: 17, paddingTopLeft: [24, 24], paddingBottomRight: [24, sheetHeight() + 24] });
  if (selected) selectPin(selected);
}

export function mapLegend({ showClosed }) {
  const item = (color, label, extra = '') => `<span><i style="background:${color}${extra}"></i>${label}</span>`;
  return `
    <div class="legend legend-strip" role="note" aria-label="Map key">
      ${item(PIN.open, 'Open')}
      ${item(PIN.unknown, 'Unknown')}
      ${item(PIN.varies, 'Varies')}
      ${showClosed ? item(PIN.closed, 'Closed') : ''}
      <span><i class="mine" style="background:#fff;border-color:${MINE_RING}"></i>Your place</span>
      ${item(YOU, 'You')}
    </div>`;
}

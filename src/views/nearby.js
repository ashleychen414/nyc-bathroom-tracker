// Nearby tab: first-launch screen, the mixed list, and restroom detail screens.

import { esc, icon } from '../lib/html.js';
import { formatDistance, directionsUrl, googleMapsUrl } from '../lib/geo.js';
import { getStatus, describeHours } from '../lib/hours.js';
import { RADII, placeStatus } from '../lib/nearby.js';
import { statusBadge, mineBadge, logChips, hasLog, publicTags, restroomType, backBar, sourceDate } from './shared.js';
import { mapLegend } from './map.js';
import { cardExtras, wentHereButton, communitySection, accessSection, nudge } from '../proto/proto.js';
import { locationHelp, mobilePlatform, isStandalone, isIOSSafari } from '../lib/device.js';

const KINDS = [
  ['all', 'All'],
  ['public', 'Public'],
  ['mine', 'My places'],
];
const TOGGLES = [
  ['hideClosed', 'Hide closed'],
  ['openNow', 'Open now'],
  ['accessible', 'Accessible'],
  ['changing', 'Changing station'],
];

// City data location types (fixed list in NYC Open Data).
export const TYPES = [
  ['', 'All types'],
  ['Park', 'Parks'],
  ['Library', 'Libraries'],
  ['Transit', 'Transit'],
  ['Public Plaza', 'Public plazas'],
  ['Privately Owned Public Space', 'Privately owned public spaces'],
];

const SOURCE_URL = 'https://data.cityofnewyork.us/City-Government/Public-Restrooms/i7jb-7jku';

const radiusLabel = (r) => `${r} mi`;

// First visit: a card over a dimmed map of Brooklyn (the map is decoration; app.js mounts it).
export const welcomeView = () => `
  <main class="welcome">
    <div id="welcome-map" class="welcome-map" aria-hidden="true"></div>
    <section class="welcome-card" aria-labelledby="welcome-title">
      <img class="welcome-logo" src="public/brand/logo-badge.jpg" width="128" height="128" alt="NYC Poops: public restrooms, New York City">
      <h1 id="welcome-title">Need a restroom now?</h1>
      <p class="lead">Share your location to see the closest restrooms, sorted by what's open right now.</p>
      <div class="welcome-actions">
        <button class="btn primary block big" data-action="welcome-locate">Use my location</button>
        <button class="btn block big" data-action="welcome-places">Go to My places</button>
      </div>
      <p class="welcome-note">Public restrooms from NYC Open Data. We only say "Open" when the listed hours confirm it. Your location stays on this phone.</p>
    </section>
  </main>`;

function zipField(s) {
  return `
    <div class="zip-field">
      <label class="field-label" for="zip">Zip code</label>
      <input id="zip" class="input" inputmode="numeric" maxlength="5" autocomplete="postal-code"
             value="${esc(s.zipDraft)}" placeholder="e.g. 11215">
      <p class="hint" id="zip-status" role="status">${esc(s.zipStatus)}</p>
    </div>`;
}

function locationBlock(s) {
  if (s.here?.source === 'gps') {
    return `<p class="loc">${icon.pin()} Your location <button class="link" data-action="use-zip">Use a zip code</button></p>`;
  }
  if (s.locating) return `<p class="loc">${icon.locate(16)} Finding you…</p>`;
  // Using a zip already: one line, so the map keeps its room. The full explanation and field show on Change.
  if (s.here?.source === 'zip' && !s.zipEditing) {
    return `<p class="loc">${icon.pin()} Near ${esc(s.here.zip)} <span class="muted">(approx.)</span>
      <span class="loc-actions"><button class="link" data-action="edit-zip">Change</button></span></p>`;
  }
  // Blocked: the browser won't ask again, so "Use my location" would do nothing. Zip first, how-to below.
  if (s.locationIssue === 'denied') {
    return `
      <div class="banner">${icon.info()}<span>Location is blocked for this site. Enter a zip code to see restrooms now.</span></div>
      ${zipField(s)}
      ${deniedHelp(s)}`;
  }
  const why =
    s.locationIssue === 'unavailable'
        ? "Couldn't get your location, so distances are from the middle of your zip code."
        : 'Distances are from the middle of your zip code.';
  return `
    <div class="banner">${icon.info()}<span>${why} <button class="link" data-action="locate">Use my location</button></span></div>
    ${zipField(s)}`;
}

function deniedHelp(s) {
  const help = locationHelp({ platform: mobilePlatform(), standalone: isStandalone(), safari: isIOSSafari() });
  return `
    <details class="loc-help" id="loc-help" ${s.locationHelpOpen ? 'open' : ''}>
      <summary>Turn location back on</summary>
      <ol>${help.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
      ${help.also ? `<p class="hint">${esc(help.also)}</p>` : ''}
      <button class="btn small" data-action="reload">Reload</button>
    </details>`;
}

function controls(s) {
  const radius = `<label class="chip-select"><span class="visually-hidden">Radius</span><select id="radius-filter">${RADII.map(
    (r) => `<option value="${r}" ${s.radius === r ? 'selected' : ''}>Within ${radiusLabel(r)}</option>`,
  ).join('')}</select></label>`;
  const kinds = KINDS.map(
    ([k, label]) => `<button type="button" class="chip-btn ${s.filters.kind === k ? 'on' : ''}" aria-pressed="${s.filters.kind === k}" data-action="kind" data-value="${k}">${label}</button>`,
  ).join('');
  const toggles = TOGGLES.map(
    ([k, label]) => `<button type="button" class="chip-btn ${s.filters[k] ? 'on' : ''}" aria-pressed="${s.filters[k]}" data-action="toggle" data-value="${k}">${label}</button>`,
  ).join('');
  return `
    <div class="filter-row" role="group" aria-label="Filters">${radius}${kinds}${typeSelect(s.filters.type)}<span class="divider" aria-hidden="true"></span>${toggles}</div>`;
}

function typeSelect(type) {
  const options = TYPES.map(([v, label]) => `<option value="${esc(v)}" ${v === type ? 'selected' : ''}>${label}</option>`).join('');
  return `<label class="chip-select ${type ? 'on' : ''}"><span class="visually-hidden">Type</span><select id="type-filter">${options}</select></label>`;
}

const viewToggle = (view) => `
  <div class="view-toggle" role="group" aria-label="View">
    ${['list', 'map'].map((v) => `<button type="button" class="${view === v ? 'on' : ''}" aria-pressed="${view === v}" data-action="view" data-value="${v}">${v === 'list' ? 'List' : 'Map'}</button>`).join('')}
  </div>`;

function entryCard(e, approx) {
  const b = e.bathroom;
  const href = e.kind === 'public' ? `#/r/${encodeURIComponent(e.id)}` : `#/mine/${encodeURIComponent(e.id)}`;
  const sub = b ? esc(b.type ?? '') : esc(e.place.address ?? '');
  return `
    <a class="card ${e.status.state === 'closed' ? 'dim' : ''}" href="${href}">
      <div class="card-head"><h2>${esc(e.name)}</h2><span class="dist">${approx ? '~' : ''}${formatDistance(e.distance)}</span></div>
      <div class="badges">${statusBadge(e.status)}${e.place ? mineBadge : ''}${sub ? `<span class="type">${sub}</span>` : ''}</div>
      ${b ? publicTags(b) : ''}
      ${cardExtras(e)}
    </a>`;
}

function emptyBox(s, { inside, outside }) {
  if (inside.length) return '';
  const near = s.here.source === 'zip' ? ` of ${esc(s.here.zip)}` : '';
  const next = RADII.find((r) => r > s.radius);
  const what = s.filters.openNow ? 'open ' : '';
  return `<div class="empty-box">
         <p class="empty-title">Nothing ${what}within ${radiusLabel(s.radius)}${near}</p>
         ${outside.length ? `<p>Here are the closest ${what}restrooms outside your radius.</p>` : '<p>Try a wider radius or fewer filters.</p>'}
         <div class="row-actions">
           ${next ? `<button class="btn dark small" data-action="radius" data-value="${next}">Widen to ${radiusLabel(next)}</button>` : ''}
           ${s.filters.openNow ? '<button class="btn small" data-action="toggle" data-value="openNow">Include unknown hours</button>' : ''}
           ${s.filters.hideClosed && !s.filters.openNow ? '<button class="btn small" data-action="toggle" data-value="hideClosed">Show closed too</button>' : ''}
         </div>
       </div>`;
}

function results(s, list) {
  const { inside, outside } = list;
  const approx = s.here.source === 'zip';
  const near = approx ? ` of ${esc(s.here.zip)}` : '';
  return `
    ${inside.length ? `<p class="meta">${inside.length} within ${radiusLabel(s.radius)}${near} · open first, then nearest</p>` : ''}
    ${emptyBox(s, list)}
    ${inside.map((e) => entryCard(e, approx)).join('')}
    ${outside.length ? `<p class="section-label">Outside ${radiusLabel(s.radius)}</p>${outside.map((e) => entryCard(e, approx)).join('')}` : ''}`;
}

// The card over the map: the selected bathroom (default: the best match, open first then nearest).
export function mapSheet(s, list, selectedId) {
  const entries = [...list.inside, ...list.outside];
  if (!entries.length) return emptyBox(s, list) || '<p class="muted">No restrooms match these filters.</p>';
  const index = Math.max(0, entries.findIndex((e) => e.id === selectedId));
  const e = entries[index];
  const approx = s.here.source === 'zip';
  const outside = index >= list.inside.length;
  const label = !selectedId
    ? list.inside.length
      ? `Best match · ${list.inside.length} within ${radiusLabel(s.radius)}`
      : `Nothing within ${radiusLabel(s.radius)} · nearest outside`
    : outside
      ? `Outside ${radiusLabel(s.radius)}`
      : `${index + 1} of ${list.inside.length} within ${radiusLabel(s.radius)}`;
  const href = e.kind === 'public' ? `#/r/${encodeURIComponent(e.id)}` : `#/mine/${encodeURIComponent(e.id)}`;
  const sub = e.bathroom ? e.bathroom.type : e.place.address;
  return `
    <div class="sheet-head">
      <span class="section-label">${esc(label)}</span>
      <span class="pager">
        <button class="btn ghost small" data-action="sheet-step" data-value="-1" aria-label="Previous restroom" ${index === 0 ? 'disabled' : ''}>‹</button>
        <button class="btn ghost small" data-action="sheet-step" data-value="1" aria-label="Next restroom" ${index === entries.length - 1 ? 'disabled' : ''}>›</button>
      </span>
    </div>
    <div class="card-head">
      <h2>${esc(e.name)}</h2>
      <span class="dist-dir">
        <span class="dist">${approx ? '~' : ''}${formatDistance(e.distance)}</span>
        <a class="btn icon-btn dir" href="${directionsUrl(e)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(e.name)}">${icon.directions(20)}</a>
      </span>
    </div>
    <div class="badges">${statusBadge(e.status)}${e.place ? mineBadge : ''}${sub ? `<span class="type">${esc(sub)}</span>` : ''}</div>
    ${cardExtras(e)}
    <div class="actions">
      <button class="btn primary" data-action="proto-went" data-value="${esc(e.id)}">✋ I went here</button>
      <a class="btn" href="${href}">Details</a>
    </div>`;
}

export function nearbyView(s, list) {
  const header = `
    <header class="top">
      <div class="brand-row">
        <img class="brand-mark" src="public/brand/logo-badge.jpg" width="40" height="40" alt="NYC Poops"><h1>Nearby</h1>
        ${viewToggle(s.view)}
      </div>
      ${locationBlock(s)}
      ${controls(s)}
      ${nudge(s.findName)}
    </header>`;
  // Map view (default): legend always visible above the map, map fills the rest, card on top.
  if (s.view === 'map' && s.data && s.here && list) {
    return `${header}
      ${mapLegend({ showClosed: !s.filters.hideClosed })}
      <main class="map-main">
        <div id="map" class="map" role="region" aria-label="Map of nearby restrooms"></div>
        <section class="map-sheet" id="map-sheet" aria-live="polite">${mapSheet(s, list, s.selectedId)}</section>
      </main>`;
  }
  let body;
  if (s.dataError) body = '<p class="error">Couldn\'t load restrooms. Check your connection and reload.</p>';
  else if (!s.data) body = '<p class="meta">Loading restrooms…</p>';
  else if (!s.here) body = s.locating ? '' : '<p class="meta">Enter a zip code above to see restrooms near it.</p>';
  else body = results(s, list);
  return `${header}
    <main class="list">
      ${body}
      ${sourceDate(s.data)}
    </main>`;
}

function hoursRows(hours) {
  const rows = describeHours(hours);
  if (!rows) return '<p class="muted">Hours unknown</p>';
  return rows.map((r) => `<div class="kv"><span>${esc(r.label)}</span><span>${esc(r.text)}</span></div>`).join('');
}

function notesCard(place, addHref) {
  if (place && hasLog(place.log)) {
    return `
      <section class="group notes-card">
        <div class="kv-head"><h2 class="label">Your notes</h2></div>
        ${logChips(place.log)}
        ${place.log.notes ? `<p class="notes">${esc(place.log.notes)}</p>` : ''}
        <a class="btn outline block" href="#/edit/${encodeURIComponent(place.id)}">${icon.pencil()}Edit notes</a>
      </section>`;
  }
  return `
    <section class="group notes-card">
      <div class="kv-head"><h2 class="label">Your notes</h2><span class="muted small">Not logged yet</span></div>
      <p>Only you see these. A good place for door codes and tips for next time.</p>
      <a class="btn outline block" href="${place ? `#/edit/${encodeURIComponent(place.id)}` : addHref}">${icon.pencil()}Add notes</a>
      ${place ? '' : '<p class="hint">Adding notes also saves this restroom to My places.</p>'}
    </section>`;
}

// Structured hours when we could read them; otherwise the city's wording once, so it's never shown twice.
function publicHours(b) {
  const raw = b.hoursText?.replace(/\s*\n\s*/g, '; ');
  let body;
  if (describeHours(b.hours)) {
    body = hoursRows(b.hours) + (b.hours.kind === 'minimum' ? '<p class="hint">Open later in season.</p>' : '');
  } else if (raw) {
    body = `<p>${esc(raw)}</p><p class="hint">We couldn't read these hours exactly, so we don't mark this restroom as open.</p>`;
  } else {
    body = '<p class="muted">Hours unknown</p>';
  }
  return `${body}
    ${b.season === 'Seasonal' ? '<p class="hint">Seasonal restroom: it may be closed outside its season.</p>' : ''}
    <p class="source">Hours from <a href="${SOURCE_URL}" target="_blank" rel="noopener">NYC Open Data</a> · <a href="${googleMapsUrl(b)}" target="_blank" rel="noopener">View on Google Maps</a></p>`;
}

const kv = (label, value) => (value ? `<div class="kv"><span>${esc(label)}</span><span>${esc(value)}</span></div>` : '');

export function publicDetailView(s, b, place, distance) {
  const status = getStatus(b);
  const sub = [b.type, b.operator, distance !== null ? `${s.here?.source === 'zip' ? '~' : ''}${formatDistance(distance)} away` : null]
    .filter(Boolean)
    .join(' · ');
  return `
    ${backBar('Back')}
    <main class="detail">
      <div class="detail-head">
        <h1>${esc(b.name)}</h1>
        <p class="muted">${esc(sub)}</p>
        <div class="badges">${statusBadge(status)}${place ? mineBadge : ''}</div>
      </div>
      <a class="btn primary block big" href="${directionsUrl(b)}" target="_blank" rel="noopener">${icon.directions()}Directions</a>
      ${wentHereButton(b.id)}
      ${communitySection(b.id)}
      ${b.source === 'user' ? accessSection(b) : ''}
      ${notesCard(place, `#/log/${encodeURIComponent(b.id)}`)}
      <section class="group">
        <h2 class="label">Hours</h2>
        ${publicHours(b)}
      </section>
      <section class="group">
        <h2 class="label">What to expect</h2>
        ${kv('Accessibility', b.accessibility)}
        ${kv('Restroom type', b.restroomType && restroomType(b.restroomType))}
        ${kv('Changing station', b.changingStations)}
        ${kv('Open', b.season)}
        ${b.notes ? `<p class="hint">${esc(b.notes)}</p>` : ''}
        ${b.website ? `<a class="link-out" href="${esc(b.website)}" target="_blank" rel="noopener">Operator website</a>` : ''}
      </section>
      ${sourceDate(s.data)}
    </main>`;
}

export function mineDetailView(s, place, distance) {
  const sub = [place.address, distance !== null ? `${s.here?.source === 'zip' ? '~' : ''}${formatDistance(distance)} away` : null]
    .filter(Boolean)
    .join(' · ');
  return `
    ${backBar('Back')}
    <main class="detail">
      <div class="detail-head">
        <h1>${esc(place.name)}</h1>
        ${sub ? `<p class="muted">${esc(sub)}</p>` : ''}
        <div class="badges">${statusBadge(placeStatus(place))}${mineBadge}</div>
      </div>
      <a class="btn primary block big" href="${directionsUrl(place)}" target="_blank" rel="noopener">${icon.directions()}Directions</a>
      ${wentHereButton(place.id)}
      ${communitySection(place.id)}
      ${accessSection(place, { editHref: `#/edit/${encodeURIComponent(place.id)}` })}
      ${notesCard(place)}
      <section class="group">
        <div class="kv-head"><h2 class="label">Hours</h2><span class="muted small">Your hours</span></div>
        ${place.hours ? hoursRows(place.hours) : '<p class="muted">You haven\'t added hours yet.</p>'}
        <a class="link-out" href="#/edit/${encodeURIComponent(place.id)}">${place.hours ? 'Edit hours' : 'Add hours'}</a>
      </section>
    </main>`;
}

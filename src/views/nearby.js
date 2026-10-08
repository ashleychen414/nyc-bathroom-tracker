// Nearby tab: first-launch screen, the mixed list, and restroom detail screens.

import { esc, icon } from '../lib/html.js';
import { formatDistance, directionsUrl } from '../lib/geo.js';
import { getStatus, describeHours } from '../lib/hours.js';
import { RADII, placeStatus } from '../lib/nearby.js';
import { statusBadge, mineBadge, logChips, hasLog, publicTags, restroomType, backBar, sourceDate } from './shared.js';
import { mapLegend } from './map.js';

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

const radiusLabel = (r) => `${r} mi`;

export const welcomeView = () => `
  <main class="welcome">
    <div class="welcome-top">
      <img class="welcome-logo" src="public/brand/logo-badge.jpg" width="168" height="168" alt="NYC Poops: public restrooms, New York City">
      <h1>Find a restroom near you, fast</h1>
      <p class="lead">Allow location to see the closest restrooms, sorted by what's open right now.</p>
      <ol class="points">
        <li>Public restrooms from NYC Open Data, Brooklyn first</li>
        <li>We only say "Open" when the listed hours confirm it</li>
        <li>Your location is used on this phone to sort the list</li>
      </ol>
    </div>
    <div class="welcome-actions">
      <button class="btn primary block big" data-action="welcome-locate">Use my location</button>
      <button class="btn block big" data-action="welcome-zip">Enter a zip code instead</button>
    </div>
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
  const why =
    s.locationIssue === 'denied'
      ? 'Location is off for this site, so distances are from the middle of your zip code.'
      : s.locationIssue === 'unavailable'
        ? "Couldn't get your location, so distances are from the middle of your zip code."
        : 'Distances are from the middle of your zip code.';
  return `
    <div class="banner">${icon.info()}<span>${why} <button class="link" data-action="locate">Use my location</button></span></div>
    ${zipField(s)}`;
}

function controls(s) {
  const radius = RADII.map(
    (r) => `<button type="button" class="${s.radius === r ? 'on' : ''}" aria-pressed="${s.radius === r}" data-action="radius" data-value="${r}">${radiusLabel(r)}</button>`,
  ).join('');
  const kinds = KINDS.map(
    ([k, label]) => `<button type="button" class="chip-btn ${s.filters.kind === k ? 'on' : ''}" aria-pressed="${s.filters.kind === k}" data-action="kind" data-value="${k}">${label}</button>`,
  ).join('');
  const toggles = TOGGLES.map(
    ([k, label]) => `<button type="button" class="chip-btn ${s.filters[k] ? 'on' : ''}" aria-pressed="${s.filters[k]}" data-action="toggle" data-value="${k}">${label}</button>`,
  ).join('');
  return `
    <div class="radius" role="group" aria-label="Radius">${radius}</div>
    <div class="filter-row" role="group" aria-label="Filters">${kinds}<span class="divider" aria-hidden="true"></span>${toggles}</div>`;
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
      ${e.place ? logChips(e.place.log) : ''}
    </a>`;
}

function results(s, { inside, outside }) {
  const approx = s.here.source === 'zip';
  const near = approx ? ` of ${esc(s.here.zip)}` : '';
  const next = RADII.find((r) => r > s.radius);
  const what = s.filters.openNow ? 'open ' : '';
  const empty = inside.length
    ? ''
    : `<div class="empty-box">
         <p class="empty-title">Nothing ${what}within ${radiusLabel(s.radius)}${near}</p>
         ${outside.length ? `<p>Here are the closest ${what}restrooms outside your radius.</p>` : '<p>Try a wider radius or fewer filters.</p>'}
         <div class="row-actions">
           ${next ? `<button class="btn dark small" data-action="radius" data-value="${next}">Widen to ${radiusLabel(next)}</button>` : ''}
           ${s.filters.openNow ? '<button class="btn small" data-action="toggle" data-value="openNow">Include unknown hours</button>' : ''}
           ${s.filters.hideClosed && !s.filters.openNow ? '<button class="btn small" data-action="toggle" data-value="hideClosed">Show closed too</button>' : ''}
         </div>
       </div>`;
  return `
    ${inside.length ? `<p class="meta">${inside.length} within ${radiusLabel(s.radius)}${near} · open first, then nearest</p>` : ''}
    ${empty}
    ${
      s.view === 'map'
        ? `<div id="map" class="map" role="region" aria-label="Map of nearby restrooms"></div>${mapLegend}
           ${outside.length ? `<p class="hint">Includes the ${outside.length} nearest outside ${radiusLabel(s.radius)}.</p>` : ''}`
        : `${inside.map((e) => entryCard(e, approx)).join('')}
           ${outside.length ? `<p class="section-label">Outside ${radiusLabel(s.radius)}</p>${outside.map((e) => entryCard(e, approx)).join('')}` : ''}`
    }`;
}

export function nearbyView(s, list) {
  let body;
  if (s.dataError) body = '<p class="error">Couldn\'t load restrooms. Check your connection and reload.</p>';
  else if (!s.data) body = '<p class="meta">Loading restrooms…</p>';
  else if (!s.here) body = s.locating ? '' : '<p class="meta">Enter a zip code to see restrooms near it.</p>';
  else body = results(s, list);
  return `
    <header class="top">
      <div class="brand-row">
        <img class="brand-mark" src="public/brand/logo-badge.jpg" width="40" height="40" alt="NYC Poops"><h1>Nearby</h1>
        ${viewToggle(s.view)}
      </div>
      ${locationBlock(s)}
      ${controls(s)}
    </header>
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
      <p>Been here? Log lighting, cleanliness, smell, stalls and trash so you know what to expect next time.</p>
      <a class="btn outline block" href="${place ? `#/edit/${encodeURIComponent(place.id)}` : addHref}">${icon.pencil()}Add notes</a>
      ${place ? '' : '<p class="hint">Adding notes also saves this restroom to My places.</p>'}
    </section>`;
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
      ${notesCard(place, `#/log/${encodeURIComponent(b.id)}`)}
      <section class="group">
        <h2 class="label">Hours</h2>
        ${hoursRows(b.hours)}
        ${b.season === 'Seasonal' ? '<p class="hint">Seasonal restroom: it may be closed outside its season.</p>' : ''}
        ${b.hoursText ? `<p class="hint">City listing says: "${esc(b.hoursText.replace(/\s*\n\s*/g, '; '))}"</p>` : ''}
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
      ${notesCard(place)}
      <section class="group">
        <div class="kv-head"><h2 class="label">Hours</h2><span class="muted small">Your hours</span></div>
        ${place.hours ? hoursRows(place.hours) : '<p class="muted">You haven\'t added hours yet.</p>'}
        <a class="link-out" href="#/edit/${encodeURIComponent(place.id)}">${place.hours ? 'Edit hours' : 'Add hours'}</a>
      </section>
    </main>`;
}

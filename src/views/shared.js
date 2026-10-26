// Pieces used by more than one screen.

import { esc, icon } from '../lib/html.js';

// Who can use it (access) and who can see it (visibility). Users only ever see two access labels;
// 'unknown' shows no label on cards ("Access unknown" on the detail screen).
export const ACCESS = { public: 'Available to Public', customers_only: 'Customer Only' };

export const accessTag = (access) => (access === 'customers_only' ? '<span class="tag access">Customer Only</span>' : '');

export const visibilityTag = (visibility) =>
  visibility !== 'public' ? '<span class="tag vis-private">🔒 Private</span>' : '<span class="tag vis-public">Public</span>';

// Labels for a card: Customer Only, and Public / Private on bathrooms you created.
export function placeTags(bathroom, place) {
  const tags = [accessTag(bathroom?.access ?? place?.access), place?.own ? visibilityTag(place.visibility) : ''].filter(Boolean);
  return tags.length ? `<div class="tags">${tags.join('')}</div>` : '';
}

export const notesLine = (place) => (place?.notes ? `<p class="notes">${esc(place.notes)}</p>` : '');

export function statusBadge({ state, label }) {
  return `<span class="badge ${state}">${state === 'closed' ? '' : '<span class="dot"></span>'}${esc(label)}</span>`;
}

export const mineBadge = '<span class="badge mine">Your place</span>';

const RESTROOM_TYPES = {
  'Multi-Stall W/M Restrooms': 'Multi-stall',
  'Multi-Stall All Gender Restrooms': 'Multi-stall, all gender',
  'Single-Stall All Gender Restroom(s)': 'Single-stall, all gender',
  'Both Single-Stall All Gender and Multi-Stall W/M': 'Single + multi-stall',
};
export const restroomType = (raw) => RESTROOM_TYPES[raw] ?? raw;

export function publicTags(b) {
  const tags = [];
  if (b.accessibility === 'Fully Accessible') tags.push('Fully accessible');
  else if (b.accessibility === 'Partially Accessible') tags.push('Partially accessible');
  if (b.restroomType) tags.push(restroomType(b.restroomType));
  if (b.changingStations?.startsWith('Yes')) tags.push('Changing station');
  return tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : '';
}

export const backBar = (label) => `
  <header class="bar slim">
    <button class="btn ghost back" data-action="back">${icon.back()}${esc(label)}</button>
  </header>`;

export const tabBar = (active) => `
  <nav class="tabbar" aria-label="Sections">
    <a class="tab ${active === 'nearby' ? 'on' : ''}" href="#/nearby" ${active === 'nearby' ? 'aria-current="page"' : ''}>${icon.nearby()}Nearby</a>
    <a class="tab ${active === 'places' ? 'on' : ''}" href="#/places" ${active === 'places' ? 'aria-current="page"' : ''}>${icon.bookmark()}My places</a>
  </nav>`;

export const sourceDate = (data) =>
  data ? `<p class="fineprint">City data last updated ${new Date(data.sourceUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>` : '';

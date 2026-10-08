// Pieces used by more than one screen.

import { esc, icon } from '../lib/html.js';

export const RATING_WORDS = ['', 'Very bad', 'Bad', 'OK', 'Good', 'Very good'];

// Order follows the logging flow; trash cleanliness only applies if there are trash cans.
export const LOG_FIELDS = [
  { key: 'lighting', label: 'Lighting', emoji: '💡', type: 'rating' },
  { key: 'cleanliness', label: 'Bathroom cleanliness', emoji: '🧼', type: 'rating' },
  { key: 'smell', label: 'Smelly vibes', emoji: '🌸', type: 'rating' },
  { key: 'hasStalls', label: 'Stalls', type: 'yesno' },
  { key: 'stallCount', label: 'How many stalls?', type: 'count', showIf: (log) => log.hasStalls === true },
  { key: 'hasTrash', label: 'Trash cans', type: 'yesno' },
  { key: 'trashCleanliness', label: 'Trash cleanliness', emoji: '🗑️', type: 'rating', showIf: (log) => log.hasTrash !== false },
];

export function logChips(log = {}) {
  const chips = LOG_FIELDS.flatMap((f) => {
    const v = log[f.key];
    if (v === undefined || f.type === 'count') return [];
    if (f.type === 'rating') return [`<span class="chip rate-${v}" title="${f.label}: ${v} of 5">${f.emoji} <b>${v}</b></span>`];
    if (f.key === 'hasStalls' && v && log.stallCount) {
      return [`<span class="chip">${log.stallCount} stall${log.stallCount === 1 ? '' : 's'}</span>`];
    }
    return [`<span class="chip">${v ? f.label : `No ${f.label.toLowerCase()}`}</span>`];
  });
  return chips.length ? `<div class="chips">${chips.join('')}</div>` : '';
}

export const hasLog = (log = {}) => Object.keys(log).length > 0;

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

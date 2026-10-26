// Visits and ratings (E3): the line on cards, the Ratings section on a restroom's page, the
// "I went here" button, the "Rate your last visit" card, and the quick rating sheet.

import { esc } from '../lib/html.js';
import { DIMENSIONS } from '../lib/visits.js';

const RATING_WORDS = ['', 'Very bad', 'Bad', 'OK', 'Good', 'Very good'];

// 'YYYY-MM-DD' (a New York date from the database) or an ISO time → "Oct 26".
export function shortDate(value) {
  const [y, m, d] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').map(Number) : [];
  const date = y ? new Date(y, m - 1, d) : new Date(value);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
export const trustLine = (stat) => `Visited by ${people(stat.people)} · last visit ${shortDate(stat.lastVisit)}`;

// mine: your visits here, newest first (this phone).
const youWent = (mine) =>
  mine.length ? `You went here ${shortDate(mine[0].visitedAt)}${mine.length > 1 ? ` · ${mine.length} visits` : ''}` : '';

// For list cards and the map card: averages, facts and the trust line, or your own last visit.
export function cardRatings(stat, mine) {
  if (!stat) return mine.length ? `<p class="trust">${esc(youWent(mine))}</p>` : '';
  const chips = DIMENSIONS.filter((d) => stat.ratings[d.key] !== null).map((d) => {
    const avg = stat.ratings[d.key];
    return `<span class="chip rate-${Math.round(avg)}" title="${d.label}: ${avg.toFixed(1)} of 5">${d.emoji} ${d.label} <b>${avg.toFixed(1)}</b></span>`;
  });
  for (const f of stat.facts) chips.push(`<span class="chip fact">${esc(f)}</span>`);
  return `${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}<p class="trust">${esc(trustLine(stat))}</p>`;
}

export const wentHereButton = (id, { primary = false, block = true } = {}) =>
  `<button class="btn ${primary ? 'primary' : 'outline went'} ${block ? 'block big' : ''}" data-action="went-here" data-value="${esc(id)}">✋ I went here</button>`;

// The Ratings section on a restroom's page.
export function ratingsSection(stat, mine) {
  const you = youWent(mine);
  if (!stat) {
    return `<section class="group">
        <h2 class="label">Ratings</h2>
        <p class="muted">${mine.length ? "Your visits haven't reached the public counts yet." : 'No visits logged yet. Tap "I went here" after you go.'}</p>
        ${you ? `<p class="trust">${esc(you)}</p>` : ''}
      </section>`;
  }
  const rows = DIMENSIONS.filter((d) => stat.ratings[d.key] !== null).map((d) => {
    const avg = stat.ratings[d.key];
    const top = d.chips
      .map((c) => [c.label, stat.chips[c.key] ?? 0])
      .filter(([, n]) => n)
      .sort((a, b) => b[1] - a[1]);
    return `<div class="rating-row">
        <span>${d.emoji} ${d.label}</span>
        <span class="meter" aria-hidden="true"><i style="width:${(avg / 5) * 100}%"></i></span>
        <b>${avg.toFixed(1)}</b>
      </div>
      ${top.length ? `<p class="reasons">${top.map(([label, n]) => `<span>${esc(label)} · ${n}</span>`).join('')}</p>` : ''}`;
  });
  return `<section class="group">
      <div class="kv-head"><h2 class="label">Ratings</h2><span class="muted small">${people(stat.people)}</span></div>
      ${stat.facts.length ? `<div class="chips">${stat.facts.map((f) => `<span class="chip fact">${esc(f)}</span>`).join('')}</div>` : ''}
      ${rows.length ? rows.join('') : '<p class="muted">Visits logged, no ratings yet.</p>'}
      <p class="trust">${esc(trustLine(stat))}</p>
      ${you ? `<p class="trust">${esc(you)}</p>` : ''}
    </section>`;
}

// "Rate your last visit" (Nearby list and map), for an unrated visit from the last 7 days.
export function nudgeCard(visit) {
  if (!visit) return '';
  return `<div class="nudge" role="status">
      <span>Rate your last visit: <b>${esc(visit.name ?? 'your last stop')}</b></span>
      <button class="btn primary small" data-action="rate-visit" data-value="${esc(visit.id)}">Rate</button>
      <button class="btn ghost small" data-action="nudge-dismiss" data-value="${esc(visit.id)}" aria-label="Don't ask about this visit">✕</button>
    </div>`;
}

// ---------- The quick rating sheet ----------

// draft: { visitId, name, clean?, getIn?, vibes?, chips: [], smell?, trash?, lighting?, stallCount? }
export function rateSheetBody(draft, { signedIn }) {
  const dims = DIMENSIONS.map((d) => {
    const v = draft[d.key];
    const stars = [1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="star ${v >= n ? 'on' : ''}" aria-label="${d.label} ${n} of 5, ${RATING_WORDS[n]}" aria-pressed="${v === n}" data-action="rate-star" data-dim="${d.key}" data-value="${n}">${d.emoji}</button>`)
      .join('');
    return `<div class="field">
        <div class="field-row"><span class="field-label">${d.label}${d.optional ? ' <span class="muted small">optional</span>' : ''}</span>${v ? `<span class="hint">${RATING_WORDS[v]}</span>` : ''}</div>
        <div class="stars">${stars}</div>
        ${v && v < 5 ? chipsHtml(d, draft) : ''}
      </div>`;
  });
  return `<h2 id="rate-title">How was ${esc(draft.name ?? 'it')}?</h2>
     <p class="muted">Your visit is logged. Ratings are optional.</p>
     ${dims.join('')}
     <p class="hint">${signedIn ? 'Ratings count toward the public numbers. Nobody sees who rated.' : 'Saved on this phone. Sign in to add it to the public numbers.'}</p>
     <div class="sheet-actions">
       <button class="btn block" data-action="rate-later">Later</button>
       <button class="btn primary block" data-action="rate-save">Save</button>
     </div>`;
}

// Below 5 stars: tap what was a problem. An old log field's chip also opens its own rating.
function chipsHtml(d, draft) {
  const chips = d.chips
    .map((c) => {
      const on = draft.chips.includes(c.key);
      return `<button type="button" class="chip-btn small ${on ? 'on' : ''}" aria-pressed="${on}" data-action="rate-chip" data-value="${c.key}">${c.label}</button>`;
    })
    .join('');
  const extras = d.chips
    .filter((c) => c.field && draft.chips.includes(c.key))
    .map((c) => (c.type === 'count' ? countField(c, draft[c.field]) : miniScale(c, draft[c.field])))
    .join('');
  const code = d.key === 'getIn' && draft.chips.includes('code') ? '<p class="hint">Keep the code itself in your private notes.</p>' : '';
  return `<p class="hint">What was the problem?</p><div class="reason-chips">${chips}</div>${extras}${code}`;
}

// A chip's own 1–5 rating, with its emoji like the stars above (e.g. 💡 for lighting).
const miniScale = (c, value) => `
  <div class="sub-rating">
    <p class="hint">${c.question}</p>
    <div class="stars small" role="group" aria-label="${c.label}, 1 to 5">${[1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="star ${value >= n ? 'on' : ''}" aria-label="${c.label} ${n} of 5, ${RATING_WORDS[n]}" aria-pressed="${value === n}" data-action="rate-field" data-field="${c.field}" data-value="${n}">${c.emoji}</button>`)
      .join('')}</div>
  </div>`;

const countField = (c, value) => `
  <label class="sub-rating count-row">
    <span class="hint">${c.question}</span>
    <input id="rate-stall-count" class="input count" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${value ?? ''}" aria-label="${c.label}">
  </label>`;

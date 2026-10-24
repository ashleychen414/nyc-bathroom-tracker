// Prototype of the next build steps, to try before building them for real:
// - E2: who can use a bathroom (Available to Public / Customer Only) and who can see it (Public / Private),
//   plus the one-time "Make public?" prompt for places saved before sharing existed.
// - E3: one-tap "I went here", quick Clean / Getting in / Vibes ratings with reasons, a "Rate your last
//   visit" nudge, and the trust line once 3 people have visited.
// Everything here is sample data kept on this phone. Nothing is written to Supabase, and sign-in is off.
// Lives on the prototype/e2-e3 branch only; the real build replaces it.

import { esc, formatDate } from '../lib/html.js';
import { listPlaces, savePlace } from '../lib/storage.js';

export const TRUST_MIN = 3; // people, before counts and averages show (privacy + credibility)

export const DIMENSIONS = [
  { key: 'clean', label: 'Clean', emoji: '🧼', reasons: [['dirty', 'Dirty floors'], ['smell', 'Smells bad'], ['trash', 'Not enough trash cans']] },
  { key: 'getIn', label: 'Getting in', emoji: '🚪', reasons: [['code', 'Needs a code'], ['buy', 'Had to buy something'], ['wait', 'Had to wait'], ['find', 'Hard to find']] },
  { key: 'vibes', label: 'Vibes', emoji: '✨', optional: true, reasons: [['lighting', 'Lighting'], ['music', 'Music']] },
];
const REASON_LABEL = Object.fromEntries(DIMENSIONS.flatMap((d) => d.reasons));
// Reasons that become facts about the bathroom once enough people tap them.
const FACTS = { code: 'Code needed', buy: 'Purchase needed' };

export const ACCESS = { public: 'Available to Public', customers_only: 'Customer Only' };

// ---------- Local storage (best effort) ----------

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the prototype still works for this page load.
  }
};
const VISITS = 'proto.visits';
const FLAGS = 'proto.flags';
const visits = () => read(VISITS, []);
const flags = () => read(FLAGS, {});
const setFlag = (patch) => write(FLAGS, { ...flags(), ...patch });

// ---------- Sample data near wherever you are ----------

const MI_LAT = 1 / 69;
const MI_LNG = 1 / 52.4; // at New York's latitude
const near = (here, north, east) => ({ lat: here.lat + north * MI_LAT, lng: here.lng + east * MI_LNG });
const daily = (open, close) => ({ kind: 'weekly', days: Array.from({ length: 7 }, () => [[open * 60, close * 60]]) });

// Bathrooms other people created and marked Public (Customer Only places, mostly).
const SHARED = [
  {
    id: 'proto-bluebird', name: 'Bluebird Coffee', type: 'Café', access: 'customers_only', at: [0.12, 0.1], hours: daily(7, 19),
    community: { people: 11, last: 1, ratings: { clean: [4.4, 10], getIn: [3.1, 10], vibes: [4.6, 8] }, reasons: { code: 7, buy: 5, wait: 2 } },
  },
  {
    id: 'proto-grand-market', name: 'Grand Market', type: 'Grocery store', access: 'customers_only', at: [-0.2, -0.18], hours: daily(8, 22),
    community: { people: 6, last: 3, ratings: { clean: [2.8, 6], getIn: [4.5, 6], vibes: [3.0, 4] }, reasons: { smell: 4, trash: 3, dirty: 2, find: 1 } },
  },
  {
    id: 'proto-hotel-lobby', name: 'Hotel lobby on 4th Ave', type: 'Hotel', access: 'customers_only', at: [0.05, -0.28], hours: null,
    community: { people: 2, last: 6, ratings: { clean: [5, 2], getIn: [4, 2] }, reasons: {} },
  },
];

export function sharedBathrooms(here) {
  if (!here) return [];
  return SHARED.map((s) => ({
    ...near(here, ...s.at),
    id: s.id, name: s.name, type: s.type, access: s.access, hours: s.hours,
    status: 'Operational', season: 'Year Round', source: 'user', proto: true,
  }));
}

// City restrooms get made-up community data for about 4 in 10, so the map shows a realistic mix.
function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function sampleCommunity(id) {
  const shared = SHARED.find((s) => s.id === id);
  if (shared) return shared.community;
  const h = hash(id);
  if (h % 10 >= 4) return null;
  const pick = (n, k) => (Math.floor(h / k) % n);
  const people = 1 + pick(14, 7);
  const avg = (k) => Math.round((2.4 + pick(26, k) / 10) * 10) / 10;
  const reasons = {};
  if (pick(3, 11) === 0) reasons.smell = 1 + pick(4, 13);
  if (pick(3, 17) === 0) reasons.trash = 1 + pick(3, 19);
  if (pick(4, 23) === 0) reasons.wait = 1 + pick(3, 29);
  return { people, last: 1 + pick(20, 31), ratings: { clean: [avg(37), people], getIn: [avg(41), people], vibes: [avg(43), Math.max(1, people - 2)] }, reasons };
}

// Sample community data, plus your own visits from this phone.
export function stats(id) {
  const base = sampleCommunity(id);
  const mine = visits().filter((v) => v.bathroomId === id);
  if (!base && !mine.length) return null;
  const out = { people: base?.people ?? 0, lastAt: base ? daysAgo(base.last) : null, ratings: {}, reasons: { ...(base?.reasons ?? {}) }, mine };
  if (mine.length) {
    out.people += 1; // you
    const latest = mine[mine.length - 1].at;
    if (!out.lastAt || latest > out.lastAt) out.lastAt = latest;
  }
  for (const d of DIMENSIONS) {
    let [sum, n] = base?.ratings[d.key] ? [base.ratings[d.key][0] * base.ratings[d.key][1], base.ratings[d.key][1]] : [0, 0];
    const rated = [...mine].reverse().find((v) => v.ratings?.[d.key]);
    if (rated) [sum, n] = [sum + rated.ratings[d.key], n + 1];
    if (n) out.ratings[d.key] = { avg: sum / n, n };
  }
  for (const v of mine) for (const list of Object.values(v.reasons ?? {})) for (const r of list) out.reasons[r] = (out.reasons[r] ?? 0) + 1;
  return out;
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// ---------- Pieces shown on cards and detail screens ----------

const facts = (s) => Object.entries(FACTS).filter(([r]) => (s?.reasons[r] ?? 0) >= TRUST_MIN).map(([, label]) => label);

// One line for list cards and the map card: ratings and trust once 3 people have visited, plus access.
export function cardExtras(entry) {
  const b = entry.bathroom;
  const place = entry.place;
  const tags = [];
  if ((b?.access ?? place?.access) === 'customers_only') tags.push('<span class="tag access">Customer Only</span>');
  if (entry.kind === 'mine' && place) tags.push(visibilityTag(place));
  const s = stats(entry.id);
  let line = '';
  if (s && s.people >= TRUST_MIN) {
    const chips = DIMENSIONS.filter((d) => s.ratings[d.key]).map((d) => `<span class="chip rate-${Math.round(s.ratings[d.key].avg)}" title="${d.label}">${d.emoji} ${d.label} <b>${s.ratings[d.key].avg.toFixed(1)}</b></span>`);
    for (const f of facts(s)) chips.push(`<span class="chip fact">${esc(f)}</span>`);
    line = `<div class="chips">${chips.join('')}</div><p class="trust">Visited by ${s.people} people · last visit ${shortDate(s.lastAt)}</p>`;
  } else if (s?.mine.length) {
    line = `<p class="trust">You went here ${shortDate(s.mine[s.mine.length - 1].at)}</p>`;
  }
  return (tags.length ? `<div class="tags">${tags.join('')}</div>` : '') + line;
}

const visibilityTag = (p) =>
  p.visibility === 'public' ? '<span class="tag vis-public">Public</span>' : '<span class="tag vis-private">🔒 Private</span>';

export function wentHereButton(id) {
  return `<button class="btn outline block big went" data-action="proto-went" data-value="${esc(id)}">✋ I went here</button>`;
}

// Ratings, reasons and trust for the detail screen.
export function communitySection(id) {
  const s = stats(id);
  if (!s) {
    return `<section class="group"><h2 class="label">Ratings</h2><p class="muted">No visits logged yet. Be the first: tap "I went here".</p></section>`;
  }
  if (s.people < TRUST_MIN) {
    return `<section class="group"><h2 class="label">Ratings</h2>
      <p class="muted">Fewer than ${TRUST_MIN} people have logged a visit, so ratings aren't shown yet.</p>
      ${s.mine.length ? `<p class="trust">You went here ${shortDate(s.mine[s.mine.length - 1].at)}</p>` : ''}</section>`;
  }
  const rows = DIMENSIONS.filter((d) => s.ratings[d.key]).map((d) => {
    const { avg } = s.ratings[d.key];
    const top = d.reasons.map(([k, label]) => [label, s.reasons[k] ?? 0]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 2);
    return `<div class="rating-row">
        <span>${d.emoji} ${d.label}</span>
        <span class="meter" aria-hidden="true"><i style="width:${(avg / 5) * 100}%"></i></span>
        <b>${avg.toFixed(1)}</b>
      </div>
      ${top.length ? `<p class="reasons">${top.map(([label, n]) => `<span>${esc(label)} · ${n}</span>`).join('')}</p>` : ''}`;
  });
  const f = facts(s);
  return `<section class="group">
      <div class="kv-head"><h2 class="label">Ratings</h2><span class="muted small">${s.people} people</span></div>
      ${f.length ? `<div class="chips">${f.map((x) => `<span class="chip fact">${esc(x)}</span>`).join('')}</div>` : ''}
      ${rows.join('')}
      <p class="trust">Visited by ${s.people} people · last visit ${shortDate(s.lastAt)}${s.mine.length ? ` · you went ${shortDate(s.mine[s.mine.length - 1].at)}` : ''}</p>
    </section>`;
}

// Who can use it / who can see it, for a public bathroom someone created or one of your places.
export function accessSection(item, { editHref } = {}) {
  const access = ACCESS[item.access] ?? 'Not sure yet';
  const rows = [`<div class="kv"><span>Who can use it</span><span>${esc(access)}</span></div>`];
  if (item.access === 'customers_only') rows.push('<p class="hint">You may need to buy something or ask staff.</p>');
  if (item.visibility) {
    rows.push(`<div class="kv"><span>Who can see it</span><span>${item.visibility === 'public' ? 'Everyone (Public)' : 'Only you (Private)'}</span></div>`);
  } else if (item.source === 'user') {
    rows.push('<p class="hint">Added by someone in NYC Poops and shared with everyone.</p>');
  }
  return `<section class="group"><h2 class="label">Access</h2>${rows.join('')}${editHref ? `<a class="link-out" href="${editHref}">Change</a>` : ''}</section>`;
}

// ---------- "Rate your last visit" nudge ----------

export function nudge(findName) {
  const pending = [...visits()].reverse().find((v) => !v.rated && !v.dismissed && Date.now() - Date.parse(v.at) < 7 * 864e5);
  if (!pending) return '';
  return `<div class="nudge" role="status">
      <span>How was <b>${esc(findName(pending.bathroomId) ?? 'your last stop')}</b>?</span>
      <button class="btn primary small" data-action="proto-rate" data-value="${esc(pending.id)}">Rate</button>
      <button class="btn ghost small" data-action="proto-nudge-dismiss" data-value="${esc(pending.id)}" aria-label="Not now">✕</button>
    </div>`;
}

// ---------- Sheets ----------

const sheet = (id, body) => `
  <div class="sheet-backdrop" data-action="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}" tabindex="-1">
    <div class="grabber" aria-hidden="true"></div>
    ${body}
  </div>`;

let draft = null; // { visitId, name, ratings: {}, reasons: {} }

function rateSheet() {
  const dims = DIMENSIONS.map((d) => {
    const v = draft.ratings[d.key];
    const stars = [1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="star ${v >= n ? 'on' : ''}" aria-label="${d.label} ${n} of 5" aria-pressed="${v === n}" data-action="proto-star" data-dim="${d.key}" data-value="${n}">${d.emoji}</button>`)
      .join('');
    const reasons =
      v && v < 5
        ? `<p class="hint">What was missing?</p><div class="reason-chips">${d.reasons
            .map(([k, label]) => {
              const on = draft.reasons[d.key]?.includes(k);
              return `<button type="button" class="chip-btn small ${on ? 'on' : ''}" aria-pressed="${on}" data-action="proto-reason" data-dim="${d.key}" data-value="${k}">${label}</button>`;
            })
            .join('')}</div>`
        : '';
    return `<div class="field">
        <div class="field-row"><span class="field-label">${d.label}${d.optional ? ' <span class="muted small">optional</span>' : ''}</span></div>
        <div class="stars">${stars}</div>
        ${reasons}
      </div>`;
  });
  return sheet(
    'rate-title',
    `<h2 id="rate-title">How was ${esc(draft.name)}?</h2>
     <p class="muted">Your visit is logged. Ratings are optional and take a few seconds.</p>
     ${dims.join('')}
     <div class="sheet-actions">
       <button class="btn block" data-action="proto-rate-skip">Later</button>
       <button class="btn primary block" data-action="proto-rate-save">Save</button>
     </div>`,
  );
}

function shareSheet() {
  const places = migrated();
  const rows = places
    .map((p) => {
      const pub = shareChoices[p.id] === 'public';
      return `<div class="share-row">
        <div><b>${esc(p.name)}</b>${p.address ? `<p class="addr">${esc(p.address)}</p>` : ''}</div>
        <div class="segmented compact">
          <button type="button" class="seg ${pub ? '' : 'on'}" aria-pressed="${!pub}" data-action="proto-share-choice" data-id="${esc(p.id)}" data-value="private">Private</button>
          <button type="button" class="seg ${pub ? 'on' : ''}" aria-pressed="${pub}" data-action="proto-share-choice" data-id="${esc(p.id)}" data-value="public">Public</button>
        </div>
      </div>`;
    })
    .join('');
  return sheet(
    'share-title',
    `<h2 id="share-title">Share your places?</h2>
     <p class="muted">You saved ${places.length === 1 ? 'this place' : 'these places'} before NYC Poops could share bathrooms, so ${places.length === 1 ? "it's" : "they're"} <b>Private</b>: only you can see ${places.length === 1 ? 'it' : 'them'}. Make one Public to add it to the map for everyone.</p>
     <div class="share-list">${rows}</div>
     <div class="sheet-actions">
       <button class="btn block" data-action="proto-share-done" data-value="keep">Keep private</button>
       <button class="btn primary block" data-action="proto-share-done" data-value="save">Save</button>
     </div>
     <p class="hint">In the app this shows once, the next time you sign in. Your notes always stay private.</p>`,
  );
}

let shareChoices = {};
const migrated = () => listPlaces().filter((p) => p.migrated && !p.publicId);

export function protoSheet(name) {
  if (name === 'proto-rate' && draft) return rateSheet();
  if (name === 'proto-share') return shareSheet();
  return '';
}

// ---------- Seeding: places saved "before sharing existed" ----------

// Mirrors today's real data: two hand-added places (one duplicates a shared café) that move over as Private.
export function seed(here) {
  if (!here || flags().seeded) return false;
  setFlag({ seeded: true });
  if (listPlaces().length) {
    // Existing places on this phone count as saved before sharing.
    for (const p of listPlaces()) if (!p.publicId && !p.visibility) savePlace({ ...p, visibility: 'private', access: p.access ?? 'unknown', migrated: true });
    return true;
  }
  const blue = SHARED[0];
  savePlace({ name: blue.name, ...near(here, blue.at[0] + 0.01, blue.at[1] + 0.01), address: 'Saved before sharing', hours: null, log: { notes: 'Code is on the receipt' }, visibility: 'private', access: 'unknown', migrated: true });
  savePlace({ name: "Sam's office (5th floor)", ...near(here, -0.08, 0.22), address: 'Saved before sharing', hours: null, log: { notes: 'Ask the front desk' }, visibility: 'private', access: 'unknown', migrated: true });
  return true;
}

export const shouldPromptShare = () => !flags().sharePrompted && migrated().length > 0;

// ---------- Events (return true when handled) ----------

// api: { state, render, toast, findName }
export function handleProtoClick(target, api) {
  const { action, value } = target.dataset;
  switch (action) {
    case 'proto-went': {
      const visit = { id: crypto.randomUUID(), bathroomId: value, at: new Date().toISOString(), rated: false };
      write(VISITS, [...visits(), visit]);
      openRate(visit, api);
      return true;
    }
    case 'proto-rate': {
      const visit = visits().find((v) => v.id === value);
      if (visit) openRate(visit, api);
      return true;
    }
    case 'proto-star': {
      const dim = target.dataset.dim;
      const n = Number(value);
      draft.ratings[dim] = draft.ratings[dim] === n ? undefined : n;
      if (!draft.ratings[dim] || draft.ratings[dim] === 5) delete draft.reasons[dim];
      api.render();
      return true;
    }
    case 'proto-reason': {
      const dim = target.dataset.dim;
      const list = draft.reasons[dim] ?? [];
      draft.reasons[dim] = list.includes(value) ? list.filter((r) => r !== value) : [...list, value];
      api.render();
      return true;
    }
    case 'proto-rate-save': {
      const ratings = Object.fromEntries(Object.entries(draft.ratings).filter(([, v]) => v));
      updateVisit(draft.visitId, { ratings, reasons: draft.reasons, rated: Object.keys(ratings).length > 0 });
      draft = null;
      api.state.sheet = null;
      api.toast(Object.keys(ratings).length ? 'Thanks! Your rating helps the next person.' : 'Visit logged.');
      return true;
    }
    case 'proto-rate-skip':
      draft = null;
      api.state.sheet = null;
      api.toast("Visit logged. We'll remind you to rate it.");
      return true;
    case 'proto-nudge-dismiss':
      updateVisit(value, { dismissed: true });
      api.render();
      return true;
    case 'proto-share-choice':
      shareChoices[target.dataset.id] = value;
      api.render();
      return true;
    case 'proto-share-done': {
      const made = value === 'save' ? migrated().filter((p) => shareChoices[p.id] === 'public') : [];
      for (const p of made) savePlace({ ...p, visibility: 'public' });
      setFlag({ sharePrompted: true });
      shareChoices = {};
      api.state.sheet = null;
      api.toast(made.length ? `${made.length === 1 ? 'Shared' : `Shared ${made.length} places`} with everyone.` : 'Kept private. You can change this on each place.');
      return true;
    }
    case 'proto-reset':
      for (const k of [VISITS, FLAGS]) localStorage.removeItem(k);
      localStorage.removeItem('nbt.places');
      location.reload();
      return true;
    case 'open-signin':
    case 'open-account':
      api.toast('Sign-in is off in this prototype, so nothing reaches the real database.');
      return true;
  }
  return false;
}

function openRate(visit, api) {
  draft = { visitId: visit.id, name: api.findName(visit.bathroomId) ?? 'it', ratings: { ...(visit.ratings ?? {}) }, reasons: structuredClone(visit.reasons ?? {}) };
  api.state.sheet = 'proto-rate';
  api.render();
}

function updateVisit(id, patch) {
  write(VISITS, visits().map((v) => (v.id === id ? { ...v, ...patch } : v)));
}

// A new place was just saved: that usually means you were just there, so log the visit and ask.
export function afterNewPlace(place, api) {
  const visit = { id: crypto.randomUUID(), bathroomId: place.id, at: new Date().toISOString(), rated: false };
  write(VISITS, [...visits(), visit]);
  setTimeout(() => openRate(visit, api), 50);
}

export const protoStrip = `
  <div class="proto-strip">
    <span><b>Prototype</b> · sample data on this phone only</span>
    <button class="link" data-action="proto-reset">Start over</button>
  </div>`;

export { REASON_LABEL, formatDate };

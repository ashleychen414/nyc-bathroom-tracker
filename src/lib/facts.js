// Facts about a bathroom (Tier 1, smaller E5): accessible, layout, changing table, code needed.
// Decided by majority (Ashley, 2026-10-26): each person's latest answer counts once, and the city's
// value counts as one more. A tie goes to the newest answer (the city's counts as the oldest).
// Answers go through answer_fact(); the counts come from bathroom_fact_counts() (never who).
// A copy of the counts is kept on the phone so cards show facts right away, like stats.js.

import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';
import { currentUser, authedFetch } from './auth.js';
import { deviceId } from './corrections.js';

export const FACTS = [
  { key: 'accessible', label: 'Accessible', question: 'Wheelchair accessible?', options: [['full', 'Fully'], ['partial', 'Partly'], ['none', 'No']] },
  {
    key: 'layout',
    label: 'Layout',
    question: 'What is it like inside?',
    options: [['single', 'One single bathroom'], ['singles', 'Several single bathrooms'], ['stalls', 'One room with stalls'], ['mixed', 'Singles and stalls']],
  },
  { key: 'changing_table', label: 'Changing table', question: 'Is there a changing table?', options: [['yes', 'Yes'], ['no', 'No']] },
  { key: 'code', label: 'Code or key', question: 'Do you need a code or key?', options: [['yes', 'Yes'], ['no', 'No']] },
];

// Layout answers that take "how many": several singles (2 or more), or stalls (1 or more).
export const COUNTED = { singles: 2, stalls: 1 };

// The city's value for a fact, or null when it has none (or it's unclear). "Single-Stall All Gender
// Restroom(s)" doesn't say one or several, so it gives no layout answer.
export function cityAnswer(b, fact) {
  if (!b || b.source === 'user') return null;
  if (fact === 'accessible') {
    return { 'Fully Accessible': 'full', 'Partially Accessible': 'partial', 'Limited Accessibility': 'partial', 'Not Accessible': 'none' }[b.accessibility] ?? null;
  }
  if (fact === 'layout') {
    const t = b.restroomType ?? '';
    if (t.startsWith('Both')) return 'mixed';
    if (t.startsWith('Multi-Stall')) return 'stalls';
    return null;
  }
  if (fact === 'changing_table') {
    const c = b.changingStations ?? '';
    return c.startsWith('Yes') ? 'yes' : c === 'No' ? 'no' : null;
  }
  return null;
}

// rows: this bathroom's bathroom_fact_counts() rows. Returns { [fact]: { value, count, people,
// city, total, withCity } | null }: people = answers for the winning value, city = the city's value
// won, total = all answers, withCity = the city's value is one of them. Pure, for tests.
export function resolveFacts(b, rows = []) {
  const out = {};
  for (const { key } of FACTS) {
    const tally = new Map();
    const city = cityAnswer(b, key);
    if (city) tally.set(city, { value: city, people: 1, last: -Infinity, count: null, city: true });
    for (const r of rows.filter((r) => r.fact === key)) {
      const t = tally.get(r.value) ?? { value: r.value, people: 0, last: -Infinity, count: null, city: false };
      t.people += r.people;
      t.last = Math.max(t.last, Date.parse(r.last_at) || 0);
      t.count = r.count ?? null;
      tally.set(r.value, t);
    }
    const total = [...tally.values()].reduce((n, t) => n + t.people, 0);
    const [win] = [...tally.values()].sort((a, b) => b.people - a.people || b.last - a.last);
    out[key] = win ? { value: win.value, count: win.count, people: win.people, city: win.city, total, withCity: Boolean(city) } : null;
  }
  return out;
}

// Short words for cards, e.g. "3 single bathrooms", "Fully accessible". Pure, for tests.
export function factLabel(key, f) {
  if (!f) return null;
  if (key === 'accessible') return { full: 'Fully accessible', partial: 'Partly accessible', none: 'Not accessible' }[f.value];
  if (key === 'layout') {
    if (f.value === 'single') return 'One single bathroom';
    if (f.value === 'singles') return f.count ? `${f.count} single bathrooms` : 'Several single bathrooms';
    if (f.value === 'stalls') return f.count ? `${f.count} stall${f.count === 1 ? '' : 's'}` : 'Stalls';
    return 'Singles and stalls';
  }
  if (key === 'changing_table') return f.value === 'yes' ? 'Changing table' : 'No changing table';
  if (key === 'code') return f.value === 'yes' ? 'Code needed' : 'No code needed';
  return null;
}

// ---------- Counts from the database (and this phone's copy) ----------

const CACHE_KEY = 'nbt.facts';
const MINE_KEY = 'nbt.myFacts'; // this phone's own answers, to mark them: { bathroomId: { fact: value } }

const load = (key) => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key)) ?? {};
  } catch {
    return {};
  }
};
const save = (key, value) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {}
};

let counts = load(CACHE_KEY); // bathroomId → rows
let mine = load(MINE_KEY);

export const factsFor = (b) => (b ? resolveFacts(b, counts[b.id]) : null);
export const myFactAnswer = (bathroomId, fact) => mine[bathroomId]?.[fact] ?? null;

// Resolves true when the counts changed. Failures keep the last copy (the app works without them).
export async function refreshFacts(fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/bathroom_fact_counts`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return false;
    const next = {};
    for (const r of await res.json()) (next[r.bathroom_id] ??= []).push(r);
    const changed = JSON.stringify(next) !== JSON.stringify(counts);
    counts = next;
    save(CACHE_KEY, next);
    return changed;
  } catch {
    return false;
  }
}

// value null = "Not sure" (takes your answer back). Updates the counts for this bathroom.
export async function answerFact(bathroomId, fact, value, count = null) {
  const body = { p_bathroom_id: bathroomId, p_device_id: deviceId(), p_fact: fact, p_value: value, p_count: count };
  const path = '/rest/v1/rpc/answer_fact';
  let rows;
  if (currentUser()) rows = await authedFetch(path, { method: 'POST', body });
  else {
    let res;
    try {
      res = await fetch(SUPABASE_URL + path, { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new Error("Couldn't reach NYC Poops. Check your connection and try again.");
    }
    rows = await res.json().catch(() => null);
    if (!res.ok) throw new Error(rows?.message || `Request failed (${res.status})`);
  }
  counts[bathroomId] = rows ?? [];
  save(CACHE_KEY, counts);
  mine[bathroomId] = { ...mine[bathroomId], [fact]: value };
  if (value === null) delete mine[bathroomId][fact];
  save(MINE_KEY, mine);
}

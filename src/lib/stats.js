// Public visit counts and ratings per bathroom, from the database function bathroom_stats():
// counts only, never who or when anyone visited. The database decides how many people a bathroom
// needs before it shows (stats_min_people(), 1 for now), so the app shows whatever comes back.
// A copy is kept on the phone so cards show ratings right away; it's refreshed in the background.

import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

const CACHE_KEY = 'nbt.stats';

// Facts from chips, decided by the database ("facts" column).
export const FACTS = { code: 'Code needed', buy: 'Purchase needed' };

// Row → { people, visits, lastVisit: 'YYYY-MM-DD', ratings: { clean, getIn, vibes } (null = none
// yet), chips: { key: people }, facts: [labels] }. Pure, for tests.
export const statFromRow = (r) => ({
  people: r.people,
  visits: r.visits,
  lastVisit: r.last_visit,
  ratings: { clean: num(r.clean), getIn: num(r.get_in), vibes: num(r.vibes) },
  chips: r.chips ?? {},
  facts: (r.facts ?? []).map((f) => FACTS[f]).filter(Boolean),
});
const num = (x) => (x === null || x === undefined ? null : Number(x));

let stats = new Map();
try {
  stats = new Map(Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {}));
} catch {
  // no copy yet
}

export const statsFor = (bathroomId) => stats.get(bathroomId) ?? null;

// Resolves true when the numbers changed. Failures keep the last copy (the app works without them).
export async function refreshStats(fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/bathroom_stats`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout?.(8000), // a hung request keeps the last copy, like any failure
    });
    if (!res.ok) return false;
    const next = Object.fromEntries((await res.json()).map((r) => [r.bathroom_id, statFromRow(r)]));
    const changed = JSON.stringify(next) !== JSON.stringify(Object.fromEntries(stats));
    stats = new Map(Object.entries(next));
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {}
    return changed;
  } catch {
    return false;
  }
}

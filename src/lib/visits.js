// Visits ("I went here") and their optional ratings, kept on the phone first. Works signed out;
// when signed in, src/lib/sync.js uploads them to Supabase table visits (they only count toward
// public numbers once they're tied to an account).
//
// Stored under nbt.visits:
// {
//   visits: [{ id: uuid, bathroomId, name (for the "Rate your last visit" card), visitedAt,
//              clean?, getIn?, vibes? (1–5), chips: [chip keys tapped as problems],
//              smell?, trash?, lighting? (1–5), stallCount?,
//              source: 'app' | 'carried_over', updatedAt,
//              dismissedAt?  "Rate your last visit" closed (this phone only),
//              stuck?: true  the account refused it (e.g. the bathroom is gone); not retried }],
//   carried: true once the old ratings in nbt.places were carried over
// }

const KEY = 'nbt.visits';
const V1_KEY = 'nbt.places';
export const NUDGE_DAYS = 7;

// Chip keys match the database. Old log fields (trash cans, lighting, stalls) open their own rating
// when tapped: 'rating' (1–5, shown with the chip's emoji, like the stars) or 'count'. Smell is a
// plain chip (Ashley, 2026-10-26); old smell scores are kept in the database, not asked again.
export const DIMENSIONS = [
  {
    key: 'clean', label: 'Clean', emoji: '🧼',
    chips: [
      { key: 'dirty', label: 'Dirty floors' },
      { key: 'smell', label: 'Smell' },
      { key: 'trash', label: 'Trash cans', field: 'trash', type: 'rating', emoji: '🗑️', question: 'How were the trash cans?' },
    ],
  },
  {
    key: 'getIn', label: 'Getting in', emoji: '🚪',
    chips: [
      { key: 'code', label: 'Needs a code' },
      { key: 'buy', label: 'Had to buy something' },
      { key: 'wait', label: 'Had to wait' },
      { key: 'find', label: 'Hard to find' },
      { key: 'stalls', label: 'Number of stalls', field: 'stallCount', type: 'count', question: 'How many stalls?' },
    ],
  },
  {
    key: 'vibes', label: 'Vibes', emoji: '✨', optional: true,
    chips: [
      { key: 'lighting', label: 'Lighting', field: 'lighting', type: 'rating', emoji: '💡', question: 'How was the lighting?' },
      { key: 'music', label: 'Music' },
    ],
  },
];
export const RATING_KEYS = DIMENSIONS.map((d) => d.key);
export const FIELD_KEYS = ['trash', 'lighting', 'stallCount'];
const CHIP_KEYS = new Set(DIMENSIONS.flatMap((d) => d.chips.map((c) => c.key)));

const isRated = (v) => RATING_KEYS.some((k) => v[k]);

// ---------- Carrying over the old ratings in nbt.places ----------

const rating = (n) => (Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined);

// The same rules as the database migration (20261026154315), with the place's id as the visit id
// so a place that already reached the account lands on the same visit.
export function visitsFromV1(places) {
  const out = [];
  for (const p of places ?? []) {
    const log = p?.log;
    if (!p || typeof p.id !== 'string' || p.deletedAt || !log || typeof p.updatedAt !== 'string') continue;
    const v = {
      id: p.id,
      bathroomId: p.publicId ?? p.id,
      name: p.name,
      visitedAt: p.updatedAt,
      clean: rating(log.cleanliness),
      smell: rating(log.smell),
      trash: rating(log.trashCleanliness),
      lighting: rating(log.lighting),
      stallCount: Number.isInteger(log.stallCount) && log.stallCount > 0 ? log.stallCount : undefined,
      source: 'carried_over',
      updatedAt: p.updatedAt,
    };
    if (![v.clean, v.smell, v.trash, v.lighting, v.stallCount].some((x) => x !== undefined)) continue;
    v.chips = [['smell', v.smell], ['trash', v.trash], ['lighting', v.lighting]].filter(([, n]) => n && n <= 2).map(([k]) => k);
    out.push(withoutEmpty(v));
  }
  return out;
}

const withoutEmpty = (x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined));

// ---------- Storage ----------

function load() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    // unreadable: start over below
  }
  if (!data || !Array.isArray(data.visits)) data = { visits: [] };
  if (!data.carried) {
    try {
      const v1 = JSON.parse(localStorage.getItem(V1_KEY) ?? 'null');
      const carried = visitsFromV1(v1?.places);
      const ids = new Set(data.visits.map((v) => v.id));
      data.visits.push(...carried.filter((v) => !ids.has(v.id)));
      data.carried = true;
      store(data);
    } catch {
      // blocked storage: try again next time
    }
  }
  return data;
}

function store(data) {
  localStorage.setItem(KEY, JSON.stringify({ visits: data.visits, carried: Boolean(data.carried) }));
}

const listeners = new Set();
export const onVisitsChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

// ---------- What the screens use ----------

export const myVisits = (bathroomId) =>
  load().visits.filter((v) => v.bathroomId === bathroomId).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));

export const getVisit = (id) => load().visits.find((v) => v.id === id) ?? null;

// One tap: a visit with no rating yet. No limit on how many (Ashley, 2026-10-26).
export function logVisit(bathroomId, name, now = new Date()) {
  const data = load();
  const at = now.toISOString();
  const visit = { id: crypto.randomUUID(), bathroomId, name, visitedAt: at, chips: [], source: 'app', updatedAt: at };
  data.visits.push(visit);
  store(data);
  notify();
  return visit;
}

// ratings: { clean?, getIn?, vibes?, chips, smell?, trash?, lighting?, stallCount? }
export function rateVisit(id, ratings, now = new Date()) {
  const data = load();
  const visit = data.visits.find((v) => v.id === id);
  if (!visit) return null;
  const clean = cleanRatings(ratings);
  for (const k of [...RATING_KEYS, ...FIELD_KEYS]) delete visit[k];
  Object.assign(visit, clean, { updatedAt: now.toISOString() });
  delete visit.stuck; // edited: worth another try
  store(data);
  notify();
  return visit;
}

// Keeps only valid values: ratings 1–5, known chips, and a chip's own field only while it's tapped.
export function cleanRatings(r) {
  const out = {};
  for (const k of RATING_KEYS) if (rating(r[k])) out[k] = r[k];
  out.chips = [...new Set((r.chips ?? []).filter((c) => CHIP_KEYS.has(c)))];
  for (const d of DIMENSIONS) {
    for (const c of d.chips) {
      if (!c.field || !out.chips.includes(c.key)) continue;
      const v = r[c.field];
      if (c.type === 'rating' && rating(v)) out[c.field] = v;
      if (c.type === 'count' && Number.isInteger(v) && v >= 1 && v <= 50) out[c.field] = v;
    }
  }
  return out;
}

export function dismissNudge(id, now = new Date()) {
  const data = load();
  const visit = data.visits.find((v) => v.id === id);
  if (!visit) return;
  visit.dismissedAt = now.toISOString(); // this phone only: not sent to the account
  store(data);
}

// The newest unrated visit from the last 7 days, unless its card was closed. Pure, for tests.
export function pendingRating(visits, now = new Date()) {
  const since = now.getTime() - NUDGE_DAYS * 864e5;
  return (
    visits
      .filter((v) => v.source === 'app' && !isRated(v) && !v.dismissedAt && Date.parse(v.visitedAt) >= since)
      .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))[0] ?? null
  );
}
export const nextToRate = (now) => pendingRating(load().visits, now);

// ---------- For the sync layer ----------

export const loadVisits = () => load().visits;
export function replaceVisits(visits) {
  const data = load();
  store({ ...data, visits });
}
export function clearVisits() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

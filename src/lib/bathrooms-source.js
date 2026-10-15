// Loads the restrooms for the app from the shared Supabase table `bathrooms`, in the same shape
// as public/data/bathrooms.json. A copy is kept on the phone, so later opens only check whether
// anything changed (two tiny requests) instead of downloading every restroom again.
// If Supabase can't answer, it falls back to public/data/bathrooms.json, then to the phone's copy.

import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

const CACHE_KEY = 'nbt.bathrooms';
const SOURCE_ID = 'nyc-open-data';
const FILE = 'public/data/bathrooms.json';
export const PAGE = 1000; // Supabase returns at most 1,000 rows per request

// The city's own facts stay in source_data until they get columns of their own.
const CITY_FIELDS = ['type', 'operator', 'status', 'season', 'hoursText', 'accessibility', 'restroomType', 'changingStations', 'notes', 'website'];
export const BATHROOM_SELECT = [
  'id', 'name', 'borough', 'lat', 'lng', 'hours', 'hoursReviewed:hours_reviewed',
  ...CITY_FIELDS.map((f) => `${f}:source_data->>${f}`),
].join(',');

async function getJson(url, fetchImpl, headers = {}) {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}
const api = (path, fetchImpl) => getJson(`${SUPABASE_URL}/rest/v1/${path}`, fetchImpl, { apikey: SUPABASE_KEY });

// The dataset row plus a version string that changes whenever any visible restroom or the dataset changes.
export async function fetchVersion(fetchImpl = fetch) {
  const [[source], [latest]] = await Promise.all([
    api(`data_sources?select=source_updated_at,generated_at,special_days,updated_at&id=eq.${SOURCE_ID}`, fetchImpl),
    api('bathrooms?select=updated_at&order=updated_at.desc&limit=1', fetchImpl),
  ]);
  if (!source || !latest) throw new Error('Shared bathrooms are not set up yet');
  return { source, version: `${source.updated_at}|${latest.updated_at}` };
}

// Every restroom still in the city data, a page at a time.
export async function fetchAllBathrooms(fetchImpl = fetch) {
  const rows = [];
  for (;;) {
    const page = await api(`bathrooms?select=${BATHROOM_SELECT}&source_removed_at=is.null&order=id&limit=${PAGE}&offset=${rows.length}`, fetchImpl);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export const toData = (source, bathrooms) => ({
  generatedAt: source.generated_at,
  sourceUpdatedAt: source.source_updated_at,
  count: bathrooms.length,
  ...(source.special_days ? { specialDays: source.special_days } : {}),
  bathrooms,
});

const defaultStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

// Calls onData with restrooms as soon as there are some: the phone's copy first, then fresh data
// if it changed. Rejects only when nothing could be loaded at all.
export async function loadBathrooms(onData, { fetchImpl = fetch, storage = defaultStorage() } = {}) {
  let cached = null;
  try {
    cached = JSON.parse(storage?.getItem(CACHE_KEY));
  } catch {}
  const hasCache = Boolean(cached?.data?.bathrooms?.length);
  if (hasCache) onData(cached.data);

  try {
    const { source, version } = await fetchVersion(fetchImpl);
    if (hasCache && cached.version === version) return;
    const bathrooms = await fetchAllBathrooms(fetchImpl);
    if (!bathrooms.length) throw new Error('No restrooms returned');
    const data = toData(source, bathrooms);
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify({ version, data }));
    } catch {} // full or blocked storage: the app still works, it just downloads again next time
    onData(data);
  } catch {
    // Supabase unreachable or not ready: the published file is current as of the last deploy.
    try {
      onData(await getJson(FILE, fetchImpl));
    } catch (err) {
      if (!hasCache) throw err; // offline with nothing saved
    }
  }
}

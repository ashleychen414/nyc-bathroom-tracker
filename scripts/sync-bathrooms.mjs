// Copies public/data/bathrooms.json (city restrooms, hand-reviewed hours applied) into the
// shared Supabase table public.bathrooms, through the sync_seed_bathrooms() database function,
// and its dataset info (city data date, holiday closures) into public.data_sources.
// Needs a Supabase secret key (service role) in SUPABASE_SECRET_KEY; without it, it skips.
// Never commit the key: it bypasses row-level security.
//
// Run: SUPABASE_SECRET_KEY=... npm run sync:bathrooms

import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { SUPABASE_URL } from '../src/lib/supabase-config.js';

const key = process.env.SUPABASE_SECRET_KEY?.trim();
if (!key) {
  console.log('::notice::SUPABASE_SECRET_KEY is not set; skipping the bathrooms table update.');
  process.exit(0);
}

const { bathrooms, generatedAt, sourceUpdatedAt, specialDays } = JSON.parse(await readFile(new URL('../public/data/bathrooms.json', import.meta.url), 'utf8'));

// New-style secret keys (sb_secret_…) go in apikey only; legacy service_role keys are JWTs
// and also need the Authorization header.
const headers = { apikey: key, 'Content-Type': 'application/json' };
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

async function api(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: prefer ? { ...headers, Prefer: prefer } : headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Bathrooms table update failed: ${method} ${path} → HTTP ${res.status} ${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : null;
}

const r = await api('rpc/sync_seed_bathrooms', { method: 'POST', body: { rows: bathrooms } });

// The app re-downloads restrooms when this row changes, so write it only when something did.
const source = { id: 'nyc-open-data', source_updated_at: sourceUpdatedAt, generated_at: generatedAt, special_days: specialDays ?? null };
const [current] = await api('data_sources?select=source_updated_at,generated_at,special_days&id=eq.nyc-open-data');
const same = (a, b) => (a && b ? new Date(a).getTime() === new Date(b).getTime() : a === b);
const changed =
  !current ||
  !same(current.source_updated_at, source.source_updated_at) ||
  !same(current.generated_at, source.generated_at) ||
  !isDeepStrictEqual(current.special_days, source.special_days); // jsonb reorders keys
if (changed) await api('data_sources', { method: 'POST', body: source, prefer: 'resolution=merge-duplicates,return=minimal' });

console.log(`Bathrooms table: ${r.unique} restrooms from ${r.received} rows; ${r.inserted} added, ${r.updated} updated, ${r.marked_missing} no longer in the city data. Dataset info ${changed ? 'updated' : 'unchanged'}.`);

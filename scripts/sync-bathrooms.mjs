// Copies public/data/bathrooms.json (city restrooms, hand-reviewed hours applied) into the
// shared Supabase table public.bathrooms, through the sync_seed_bathrooms() database function.
// Needs a Supabase secret key (service role) in SUPABASE_SECRET_KEY; without it, it skips.
// Never commit the key: it bypasses row-level security.
//
// Run: SUPABASE_SECRET_KEY=... npm run sync:bathrooms

import { readFile } from 'node:fs/promises';
import { SUPABASE_URL } from '../src/lib/supabase-config.js';

const key = process.env.SUPABASE_SECRET_KEY?.trim();
if (!key) {
  console.log('::notice::SUPABASE_SECRET_KEY is not set; skipping the bathrooms table update.');
  process.exit(0);
}

const { bathrooms } = JSON.parse(await readFile(new URL('../public/data/bathrooms.json', import.meta.url), 'utf8'));

// New-style secret keys (sb_secret_…) go in apikey only; legacy service_role keys are JWTs
// and also need the Authorization header.
const headers = { apikey: key, 'Content-Type': 'application/json' };
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_seed_bathrooms`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ rows: bathrooms }),
});
const body = await res.text();
if (!res.ok) {
  console.error(`Bathrooms table update failed: HTTP ${res.status} ${body}`);
  process.exit(1);
}
const r = JSON.parse(body);
console.log(`Bathrooms table: ${r.unique} restrooms from ${r.received} rows; ${r.inserted} added, ${r.updated} updated, ${r.marked_missing} no longer in the city data.`);

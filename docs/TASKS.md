# Tasks

Updated 2026-10-08. Steps map to the MVP scope in `SPEC.md`.

## Now

- [ ] **Review Brooklyn hours** (`data/hours-review.md`, 52 rows). Owner: Ashley + Claude.
  - `assumed-daily` (18): confirm they really are daily (check operator websites)
  - `missing` (27): find hours or leave as "Hours unknown"
  - `unparsed` (7): write structured hours into `data/hours-overrides.json`
  - Watch for: "Temp Closed" (Paerdegat Athletic Facility) is listed as hours, not status
- [ ] **Fix git on this Mac** (Xcode developer tools are broken). Owner: Ashley. Then `git init` and the first commit.

## Next (MVP build order)

- [ ] Step 2: App shell (Vite), GPS + zip fallback, list sorted by status then distance, radius picker
- [ ] Step 3: Status badges and greyed-out states; "City data last updated" line
- [ ] Step 4: Public / My places filter; accessibility, stall, and changing-station tags; Google Maps link
- [ ] Step 5 (remaining): star a public restroom to save it to My places (needs the Nearby list from step 2)
- [ ] Test the My places prototype on a real iPhone (GPS, keyboard, stars at thumb size)
- [ ] Step 6: Add to Home Screen prompt (installable web app), permanent-storage request, export/import backup
- [ ] Step 7: Hosting (Vercel/Netlify/GitHub Pages) + nightly data refresh (GitHub Actions)
- [ ] Launch to friends; start logging in `FEEDBACK.md`

## Later

- [ ] **Follow-up #1: saved places last forever** (Supabase + magic link proposed; decide at kickoff)
- [ ] Shrink `bathrooms.json` (522 KB uncompressed): drop non-essential fields or split by borough
- [ ] "This info is wrong" report link
- [ ] Map view / tap a spot on a map to add a place
- [ ] Review hours for other boroughs

## Done

- [x] 2026-10-08: My places prototype: add (current location / address search), log 7 dimensions, edit, delete, Google Maps directions, stored on the phone (`src/lib/storage.js`, schema v1)
- [x] 2026-10-08: Planning and scope lock (see `SPEC.md`, `DECISIONS.md`)
- [x] 2026-10-08: Step 1: data pipeline (`npm run data`), strict hours parser + status logic with tests (`npm test`)

# Tasks

Updated 2026-10-08. Steps map to the MVP scope in `SPEC.md`.

## Now

- [ ] **Review Brooklyn hours** (`data/hours-review.md`, 52 rows). Owner: Ashley + Claude.
  - `assumed-daily` (18): confirm they really are daily (check operator websites)
  - `missing` (27): find hours or leave as "Hours unknown"
  - `unparsed` (7): write structured hours into `data/hours-overrides.json`
  - Watch for: "Temp Closed" (Paerdegat Athletic Facility) is listed as hours, not status

## Next (MVP build order)

- [ ] Test on a real iPhone once hosted: GPS, first-launch flow, time pickers, emoji tap targets (location only works on https)
- [ ] Launch to friends; start logging in `FEEDBACK.md`

## Later

- [ ] Pick the main link to share (Vercel or GitHub Pages) and optionally a nicer Vercel name or custom domain; consider turning the other one off

- [ ] Update GitHub Actions versions before GitHub drops Node 20 for actions (deploy shows a deprecation warning; still works)

- [ ] **Follow-up #1: saved places last forever** (Supabase + magic link proposed; decide at kickoff)
- [ ] Shrink `bathrooms.json` (522 KB uncompressed): drop non-essential fields or split by borough
- [ ] "This info is wrong" report link
- [ ] Map view / tap a spot on a map to add a place
- [ ] Review hours for other boroughs

## Done

- [x] 2026-10-08: Vercel hosting at https://nyc-bathroom-tracker-ashley-s-sandbox.vercel.app/ (linked to GitHub, login wall off); nightly refresh commits data only when it changes
- [x] 2026-10-08: Step 6: installable web app (icon, manifest), Add to Home Screen sheet after 1st and 3rd new place on phones, backup sheet (export via share sheet / download, import merges by id, newer edit wins)
- [x] 2026-10-08: Step 7: hosted on GitHub Pages at https://ashleychen414.github.io/nyc-bathroom-tracker/ with deploy on push + nightly data refresh (~5am NY)
- [x] 2026-10-08: Steps 2-5: Nearby tab (public + your places mixed, radius, filters, open-first sort, top-up to 5, empty state), first-launch location screen, zip fallback, restroom detail with "Add notes", Hours for your places, back-button-friendly routing
- [x] 2026-10-08: UX confirmed on the canvas; SPEC.md updated
- [x] 2026-10-08: Git set up (Xcode 27), first commit
- [x] 2026-10-08: My places prototype: add (current location / address search), log 7 dimensions, edit, delete, Google Maps directions, stored on the phone (`src/lib/storage.js`, schema v1)
- [x] 2026-10-08: Planning and scope lock (see `SPEC.md`, `DECISIONS.md`)
- [x] 2026-10-08: Step 1: data pipeline (`npm run data`), strict hours parser + status logic with tests (`npm test`)

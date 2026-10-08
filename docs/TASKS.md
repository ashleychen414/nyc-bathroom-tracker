# Tasks

Updated 2026-10-08. Steps map to the MVP scope in `SPEC.md`.

## Now

- [ ] **Supabase dashboard setup for sign-in** (Ashley): email templates show the code; Site URL and redirect URLs. Then test sign-in on localhost, then publish.

- [ ] **Review Brooklyn hours** (`data/hours-review.md`, 52 rows). Owner: Ashley + Claude.
  - `assumed-daily` (18): confirm they really are daily (check operator websites)
  - `missing` (27): find hours or leave as "Hours unknown"
  - `unparsed` (7): write structured hours into `data/hours-overrides.json`
  - Watch for: "Temp Closed" (Paerdegat Athletic Facility) is listed as hours, not status

## Next (MVP build order)

- [ ] **Lists phase 1: personal list kept forever** (accounts + sync). Plan: `docs/PLAN-saved-places-forever.md`. Decided: Supabase free plan + nightly keep-alive; upgrade only when a limit is hit
  - Priority #1 (Ashley, 2026-10-08). Once places are saved to an account, simplify the screens that exist only to protect phone-only data: the "Keep your places safe" Home Screen sheet, the backup sheet, and the "Saved on this phone only" notes. That should also resolve the "save confirmation screen" feedback below.
- [ ] **Saving without a confirmation step** (likely solved by lists phase 1; re-check with the tester after) (feedback 2026-10-08: "the save confirmation screen is confusing i wish i could just have it saved all the time"). First confirm which screen they meant:
  - The "Keep your places safe" sheet after saving → make it less interruptive (e.g. a small banner on My places instead of a pop-up), or show it only once.
  - The Save button on the log form → save changes automatically as you tap ratings/type notes (no Save/Cancel).
  - Or they want places kept without any extra steps → that's Follow-up #1 (places last forever), which removes the need for the Home Screen prompt.
- [ ] **Easier edit / delete for saved places** (Ashley, 2026-10-08; lower priority). Today it exists but is buried: My places → Edit log → "Delete place" at the bottom of the form. Make it obvious: e.g. Edit and Delete on each My places card and on the place's detail screen, with a confirm (or an Undo toast) for delete.
- [ ] Map view follow-ups: tap a spot on the map to add a place; remember the map position between visits.
- [ ] Test on a real iPhone once hosted: GPS, first-launch flow, time pickers, emoji tap targets (location only works on https)
- [ ] Launch to friends; start logging in `FEEDBACK.md`

## Later

- [ ] Pick the main link to share (Vercel or GitHub Pages) and optionally a nicer Vercel name or custom domain; consider turning the other one off

- [ ] Update GitHub Actions versions before GitHub drops Node 20 for actions (deploy shows a deprecation warning; still works)

- [ ] **Lists phase 2: share your list / import a friend's list** into your own (copies). Decided: snapshot links
- [ ] **Lists phase 3: Ashley's public list** shown to everyone in Nearby. Needs its own planning/spec conversation first (phase 1 tables already leave room for it)
- [ ] Shrink `bathrooms.json` (522 KB uncompressed): drop non-essential fields or split by borough
- [ ] "This info is wrong" report link
- [ ] Review hours for other boroughs

## Done

- [x] 2026-10-08: Bug: "Sign in" button on the My places banner wrapped onto two lines (Ashley). Fixed: the button keeps its width and doesn't wrap
- [x] 2026-10-08: Map view: List / Map toggle on Nearby (remembered), pins colored by status, your places ringed in blue, your location + radius circle, tap a pin → name, status, Details, Directions. Leaflet 1.9.4 from cdnjs (integrity-pinned) + OpenStreetMap tiles
- [x] 2026-10-08: Vercel hosting at https://nyc-bathroom-tracker-ashley-s-sandbox.vercel.app/ (linked to GitHub, login wall off); nightly refresh commits data only when it changes
- [x] 2026-10-08: Step 6: installable web app (icon, manifest), Add to Home Screen sheet after 1st and 3rd new place on phones, backup sheet (export via share sheet / download, import merges by id, newer edit wins)
- [x] 2026-10-08: Step 7: hosted on GitHub Pages at https://ashleychen414.github.io/nyc-bathroom-tracker/ with deploy on push + nightly data refresh (~5am NY)
- [x] 2026-10-08: Steps 2-5: Nearby tab (public + your places mixed, radius, filters, open-first sort, top-up to 5, empty state), first-launch location screen, zip fallback, restroom detail with "Add notes", Hours for your places, back-button-friendly routing
- [x] 2026-10-08: UX confirmed on the canvas; SPEC.md updated
- [x] 2026-10-08: Git set up (Xcode 27), first commit
- [x] 2026-10-08: My places prototype: add (current location / address search), log 7 dimensions, edit, delete, Google Maps directions, stored on the phone (`src/lib/storage.js`, schema v1)
- [x] 2026-10-08: Planning and scope lock (see `SPEC.md`, `DECISIONS.md`)
- [x] 2026-10-08: Step 1: data pipeline (`npm run data`), strict hours parser + status logic with tests (`npm test`)

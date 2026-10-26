# Tasks

Updated 2026-10-26. Steps map to the MVP scope in `SPEC.md`. Product improvements (Ashley, Oct 12) are sized and cross-referenced in `docs/IMPROVEMENTS-SCOPING.md`; epic numbers (E0–E13) refer to that doc.

## Now

- [ ] **Check E2 signed in on the live site** (not verified in #24): your list loads, the one-time "Share your places?" prompt shows for the 2 owners of moved places, and a place made Public shows on the map for others.
- [ ] **Brooklyn hours: Ashley's calls** on what's left after PR #2 (review list is down from 52 rows to 22):
  - Gravesend, Ryder and Leonard libraries are open per BPL but "Closed for Construction" in city data. They stay greyed out until overrides can set `status` (below).
  - Carver Playground is "Not Operational" in city data, but NYC Parks rated it "Acceptable" in Sept 2025. It may be open.
  - McCarren Indoor Tennis: operator site wouldn't load. It's Seasonal, so it never shows Open either way.

## Next

- [ ] **Decide the remaining open question in `docs/IMPROVEMENTS-SCOPING.md` §6**: milestone order (A → B → C proposed). Milestone A is nearly done (E0, E4, E9-lite shipped). Decided 2026-10-24: what "private bathroom" means (unblocks E2) and the rating dimensions (unblocks E3).
- [ ] **E3: visits and ratings** (unblocked 2026-10-24, after E2). Per DECISIONS.md: one-tap "I went here", optional Clean / Getting in / Vibes stars with reason tags, a "Rate your last visit" card for skipped ratings, reasons that confirm facts, trust line shown once 3 people have visited, existing ratings carried over. The old log fields come back as tags inside the rating dimensions; tapping one opens that field's old rating (Ashley, 2026-10-26): Clean: Trash cans, Smell; Getting in: Number of stalls; Vibes: Lighting. Old values to carry over are in the read-only `places` table and each phone's `nbt.places`.
- [ ] **E3 prototype: open questions to review before building** (prototype finished 2026-10-24; draft PR #17, closed unmerged; preview: https://nyc-bathroom-tracker-git-prototype-e2-e3-ashley-s-sandbox.vercel.app). The E2 questions were answered on 2026-10-24/26 (see DECISIONS.md). Prototyped answers in brackets:
  - **Ratings on list cards:** on every list card, or only on the map card and the restroom's page? (Cards got noticeably taller.) [every card]
  - **Directions icon on list cards** too, not just the map card? (Each list card is one big link today.) [map card only]
  - **Rate right after adding a new place?** Saving a place logs a visit and opens the quick rating. [yes]
  - **"Rate your last visit" nudge:** how long a skipped rating stays (7 days), and whether it also shows over the map. [7 days, list and map]
  - **Reasons become facts** ("Code needed") after how many people? [3, same as the trust line]
  - **Does "I went here" require being nearby?** And one visit per person per bathroom per day? (Open since the scoping doc.) [no check; unlimited]
- [ ] **Let hours overrides set `status`**, then mark Gravesend, Ryder and Leonard libraries open and Paerdegat Athletic "Temporarily closed" (today it reads "Closed for today").
- [ ] **NYPL holiday closures** (Manhattan, Bronx, Staten Island libraries). nypl.org/help/closings blocks automated reading, so copy the list in by hand.
- [ ] **Bathroom layout: several separate single bathrooms** (feedback 2026-10-08). Becomes E5 on the shared `bathrooms` table (on hold with the other fact fields). Proposal: replace Stalls with **Layout**:
  - One single bathroom
  - Several single bathrooms → how many?
  - One bathroom with stalls → how many stalls?
  - Card chips like "3 single bathrooms" / "1 bathroom, 4 stalls". Existing logs convert automatically.
- [ ] **Saving without a confirmation step** (feedback 2026-10-08). The pop-up is gone since lists phase 1; re-check with the tester. The rest is answered by E2 (save = list item) and E3 (log = visit).
- [ ] **Easier edit / delete for saved places** (Ashley, 2026-10-08; lower priority). Since E2: My places → Edit → "Delete place" (Private) or "Remove from My places" at the bottom of the form. Still open: a Remove action on the card itself.
- [ ] Map follow-ups: tap a spot on the map to add a place; remember the map position between visits; show your live location dot moving as you walk
- [ ] Test on a real iPhone: GPS, first-launch flow (new landing screen), time pickers, emoji tap targets, location blocked
- [ ] Launch to friends; keep logging in `FEEDBACK.md`

## Later

- [ ] **Needs-based onboarding** (Ashley, 2026-10-16, note on the landing screen mockup): ask about needs (medical/accessibility, pregnant, with toddlers) and shape the experience from it. Spec first.
- [ ] **E9 full: search our own `bathrooms` table first**, then a provider comparison (after E2). Non-food places OpenStreetMap is missing (e.g. GP-81, a Bushwick climbing gym) need another source (Overture Maps / Foursquare open places) or "drop a pin and type the name".
- [ ] **E7: rule for user corrections to seed rows.** Today a correction survives only until the city changes that row, because the nightly sync overwrites city facts when the city record changes.
- [ ] **Each December: next year's holiday dates** in `data/special-days.json` (City 2027 calendar, QPL after Jan 3 2027, BPL after June 2027).
- [ ] **Each spring: recheck seasonal rows**: Abe Stark season dates, Brooklyn Bridge Park restroom hours, Adventurer's Park, Luna Park.
- [ ] Decide whether to keep publishing `bathrooms.json` once Supabase reads have been reliable for a while (today it's the fallback and the sync's input).
- [ ] Turn off the GitHub Pages copy (www.nycpoops.com is the main link)
- [ ] "This info is wrong" report link (E7)
- [ ] Review hours for other boroughs

- [ ] **Flip the visibility default to Private, with a prompt to make places Public** (Ashley, 2026-10-26, future decision). Today new places start Public. Decide together with the growth hook below.
- [ ] **Public / Private known gaps** (kept as is, 2026-10-26; see DECISIONS.md): a Public place not yet on the server (added signed out, or before it syncs) is already locked as Public; hiding a Public place (`status = removed`) may not reach phones with a cached restroom list until other bathroom data changes. Revisit if a place ever needs to be hidden or un-shared quickly.
- [ ] **Drop the `places` table** once E3 has carried its old ratings over (read-only since E2).
- [ ] **Use the "Share your places?" prompt as a growth hook** (Ashley, 2026-10-24, from the E2/E3 prototype): beyond the one-time migration prompt, periodically invite people to batch-move Private places to Public, to grow the shared map. Decide when it shows and how often.
- [ ] **Carry into the E3 build:** on the map card, "I went here" becomes the main action (the Directions icon and the sheet layering fix shipped in #22).

- [ ] **Watch the location log for the iOS Home Screen bug:** rows with `permission_before = 'denied'` and `result = 'granted'` on `ios-homescreen` mean the phone said blocked but location worked (query in PR #21).
- [ ] **Location log upkeep:** delete the 7 `dev` test rows (query in PR #16), maybe leave `dev` rows out of the views, and add a rate limit if the public insert ever gets spammed.

### Future ideas (backlog, Ashley 2026-10-08; spec each before building)

- [ ] **Curated lists** (e.g. "Best bathrooms to cry in") that people can browse and save into their own list. Becomes E10 + public lists on the shared database.
- [ ] **Visit log** (E3): an "I went here" tap that records the time, plus your visit history per place, in a separate `visits` table.
- [ ] **Aggregated visits** (E3): "Visited 23 times by 9 people" per public restroom; counts only, never who; a minimum number of people before showing a count.
- [ ] **Lists phase 2: share your list / import a friend's** (E10). Now references to shared bathrooms, not copies; share links are snapshots of which bathrooms.
- [ ] **Lists phase 3: Ashley's public list** shown to everyone in Nearby. Needs its own planning conversation first.

## Done

- [x] 2026-10-26: **E2: lists, and saved places on the shared bathrooms table** (#24): `lists` / `list_items` (one list per person), `bathrooms` gets owner, visibility (Public / Private) and address; Add a place asks "Who can use it?" and "Who can see it?" (Public by default); cards and detail pages show Customer Only and Public / Private; the 6 `places` rows moved over (2 city restrooms as list items, 4 hand-added places as Private) with a one-time "Share your places?" prompt; `places` is read-only; deleting an account keeps its Public bathrooms
- [x] 2026-10-24: **Startup location check no longer trusts "denied" alone** (#21): shows the blocked state, quietly tries once, and switches to your location if it works; logs the real result
- [x] 2026-10-24: **Map card: Directions as an icon next to the distance** (#22), and bottom sheets now sit above the map card
- [x] 2026-10-24: **Anonymous location outcome log** (#16): one row per location attempt in `location_events` (no coordinates, user, zip or user agent), daily and 7-day views (see CLAUDE.md "Location log"); timeouts now separate from "unavailable", with Try again; welcome screen no longer says "Your location stays on this phone"
- [x] 2026-10-24: **Location-blocked dead end fixed** (#10, tester report): when location is blocked, Nearby leads with the zip code and shows how to turn location back on (iPhone Safari, Home Screen app, other browsers)
- [x] 2026-10-24: **Landing screen** (#9): "Need a restroom now?" card over a still map of Brooklyn with every city restroom as a grey dot; buttons Use my location / Go to My places
- [x] 2026-10-16: **E1 step 2** (#7): the app reads restrooms from Supabase, with a phone cache (re-downloads only when the data changed) and a `bathrooms.json` fallback. Holiday closures come through the new `data_sources` table
- [x] 2026-10-16: **Repeated city rows dropped** (#6): 1,066 rows → 1,063 restrooms; Tompkins Square Park shows Not Operational
- [x] 2026-10-16: **Brooklyn hours review** (#2): 29 hand-checked overrides with source URLs (review list 52 → 22), Paerdegat Athletic closed, holiday closures for Brooklyn and Queens libraries and NYC Parks restrooms
- [x] 2026-10-16: **E9-lite place search** (#3, #8): nearby businesses first, type and distance labels ("Café · 0.7 mi"), plus restaurants from the city's inspection data that OpenStreetMap is missing (Brooklyn sample: 12/30 found before, 27/30 after)
- [x] 2026-10-14: **`SUPABASE_SECRET_KEY` GitHub secret added**; 1,063 restrooms loaded into `bathrooms`
- [x] 2026-10-14: **E1 step 1**: `profiles` and `bathrooms` tables with row-level security, nightly sync step in the deploy workflow, GitHub Actions updated off Node 20
- [x] 2026-10-14: **Set up for parallel agents**: tests run on every pull request (`.github/workflows/test.yml`); parallel-work rules in `CLAUDE.md` (worktrees, PR-only, shared docs, one database owner, private docs link)
- [x] 2026-10-14: **E4 map-first home**: Nearby opens on a full-screen map (list remembered only if chosen); legend strip always visible between the filters and the map; bottom card with the best match (open first, then nearest), Directions + Details, ‹ › to step through results; tapping a pin selects it; compact header (one-line location, radius dropdown in the filter row)
- [x] 2026-10-14: **E0 quick wins**: hours show the formatted table + "Hours from NYC Open Data · View on Google Maps" (the city's wording only when it couldn't be read); filter by type (Parks, Libraries, Transit, Public plazas, Privately owned public spaces); database access-rule checks (`npm run test:rls` on every deploy, `supabase/tests/places_rls.sql` for signed-in users); migrations saved in `supabase/migrations/`
- [x] 2026-10-14: Sync confirmed end to end in production (2 accounts, 3 places in Supabase)
- [x] 2026-10-08: Lists phase 1 live on www.nycpoops.com: email-code sign-in (custom SMTP via Resend from nycpoops.com), background sync, account sheet. Ashley tested sign-in locally; place upload to the account still to confirm on a real phone
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

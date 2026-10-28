# Tasks

Updated 2026-10-26 (after #39, facts; Tier 1 #1 and #2 done). Steps map to the MVP scope in `SPEC.md`. Product improvements (Ashley, Oct 12) are sized and cross-referenced in `docs/IMPROVEMENTS-SCOPING.md`; epic numbers (E0–E13) refer to that doc.

## Now

- [ ] **Try confirm and correct, and facts, on a real iPhone, signed in and signed out** (#34, #39): "Was it open?" / "Hours right?" after "I went here", Suggest an edit, Report closed, Undo; answering a fact on "What to expect", and the "how many" step for Layout.
- [ ] **Brooklyn hours: Ashley's calls** (Ashley will do these later) on what's left after PR #2 (review list is down from 52 rows to 22):
  - Gravesend, Ryder and Leonard libraries are open per BPL but "Closed for Construction" in city data. They stay greyed out until overrides can set `status` (below).
  - Carver Playground is "Not Operational" in city data, but NYC Parks rated it "Acceptable" in Sept 2025. It may be open.
  - McCarren Indoor Tennis: operator site wouldn't load. It's Seasonal, so it never shows Open either way.

## Next, Tier 1: confirm, correct and fill in

Order set 2026-10-26 by two principles (see `DECISIONS.md` and `IMPROVEMENTS-SCOPING.md` §5): the app is only as good as its database, and users must be able to rate, confirm and edit incomplete information quickly.

- [ ] **Ask for what's missing** (next): cards with gaps say so ("Hours unknown · Know them?", "Access unknown", "Layout unknown") and open the fix form (Suggest an edit, `#/fix/<id>`, from #34) or the facts on "What to expect" (#39).

- [ ] **Where inside? (finding the restroom once you're there)** (Ashley, 2026-10-26): tapping a bathroom doesn't say where it is in a big place. Ex: "Penn Station LIRR Restroom" is too broad; you need to know where in Penn Station. The city data has no field for this (its note for Penn Station is generic: "outside of fare gates"), so it has to come from people: a short "How to find it" line (level, near which exit / track / store) on the detail page and map card, editable like other facts, and asked for when missing ("Where inside? · Know it?"). Matters most for stations, malls, parks, libraries and museums. Uses the Suggest an edit form (#34); pairs with the facts on "What to expect" (#39) and Ask for what's missing.

- [ ] **Public door codes** (Ashley, 2026-10-27; see DECISIONS.md): a public "Code" field on each bathroom, editable through Suggest an edit, shown with "Code needed" and when it was last added or confirmed. Change the copy that sends codes to private notes ("Only you see these. A good place for door codes", and "Keep the code itself in your private notes" on the rating sheet). Pairs with "Where inside?" (same kind of public text).

## Next, Tier 2: more bathrooms

- [ ] **"Share your places?" prompt as a growth hook** (Ashley, 2026-10-24): beyond the one-time migration prompt, invite people to move Private places to Public. Decide when it shows and how often.
- [ ] **Bulk-add bathrooms by category** (museums, hotels, grocery and department stores, Target, gas stations). First a 1-day Brooklyn spike: counts per category from OpenStreetMap, Overture Maps / Foursquare Open Places and NYC / NY State open data, hours and restroom-tag coverage, licenses (OpenStreetMap share-alike), a hand check of 20 places. Imports land as Customer Only, hours unknown, shown by default and labeled "Unconfirmed" (normal sort, not last), with "Is there a restroom here?".
- [ ] **Add a bathroom faster:** tap a spot on the map to add; only name, pin and access required; search our own bathrooms first (start of E9 full).
- [ ] **E8 duplicates, flag only** (~50 m and a similar name); merge tool when real duplicates show up.
- [ ] **E9 full and E11 Google Maps import.** Non-food places OpenStreetMap misses (e.g. GP-81, a Bushwick climbing gym) need another source. Check first whether Takeout exports include coordinates.
- [ ] **Hours for other boroughs:** filled in by Tier 1 corrections, not reviewed by hand.

## Next, other

- [ ] **Let hours overrides set `status`**, then mark Gravesend, Ryder and Leonard libraries open and Paerdegat Athletic "Temporarily closed" (today it reads "Closed for today").
- [ ] **NYPL holiday closures** (Manhattan, Bronx, Staten Island libraries). nypl.org/help/closings blocks automated reading, so copy the list in by hand.
- [ ] **Easier edit / delete for saved places** (Ashley, 2026-10-08; lower priority). Since E2: My places → Edit → "Delete place" (Private) or "Remove from My places" at the bottom of the form. Still open: a Remove action on the card itself.
- [ ] Map follow-ups: remember the map position between visits; show your live location dot moving as you walk
- [ ] Test on a real iPhone: GPS, first-launch flow (new landing screen), time pickers, emoji tap targets, location blocked
- [ ] Launch to friends; keep logging in `FEEDBACK.md`

## Later

- [ ] **Each December: next year's holiday dates** in `data/special-days.json` (City 2027 calendar, QPL after Jan 3 2027, BPL after June 2027).
- [ ] **Each spring: recheck seasonal rows**: Abe Stark season dates, Brooklyn Bridge Park restroom hours, Adventurer's Park, Luna Park.
- [ ] Decide whether to keep publishing `bathrooms.json` once Supabase reads have been reliable for a while (today it's the fallback and the sync's input).
- [ ] Turn off the GitHub Pages copy (www.nycpoops.com is the main link)

- [ ] **Public / Private known gaps** (kept as is, 2026-10-26; see DECISIONS.md): a Public place not yet on the server (added signed out, or before it syncs) is already locked as Public; hiding a Public place (`status = removed`) may not reach phones with a cached restroom list until other bathroom data changes. Revisit if a place ever needs to be hidden or un-shared quickly.
- [ ] **Drop the `places` table:** E3 carried its old ratings over as visits (#29); it has been read-only since E2.
- [ ] **Directions icon on list cards** too, not just the map card? Each list card is one big link today (open question from the E2/E3 prototype).

- [ ] **Location log:** maybe leave `dev` rows out of the views, and add a rate limit if the public insert ever gets spammed.
- [ ] **Watch the location log for the iOS Home Screen bug:** rows with `permission_before = 'denied'` and `result = 'granted'` on `ios-homescreen` mean the phone said blocked but location worked (query in PR #21).

- [ ] **"Hours from a visitor" label** next to "Open" when the hours came from a user (low priority, Ashley 2026-10-26): says where the hours came from, which may get more people to report a mistake. Since #34 the restroom page's source line says "Hours from a NYC Poops user"; cards and the map card don't yet.
- [ ] **"No, fix them" then tapping outside the rating sheet** doesn't open the hours form (it opens after Save or Later) (#34).
- [ ] **Old stall counts aren't used for Layout** (flagged, Ashley 2026-10-26; #39): 5 bathrooms have a "Number of stalls" from a visit. Revisit if Layout stays unanswered there, or if people keep tapping the "Number of stalls" rating chip instead of answering Layout.
- [ ] **A gender fact** (all gender / separate rooms), if the "All gender" tag from the city's restroom type proves useful (#39).
- [ ] **Public door codes pair with the Code fact** (#39, #40): the yes/no "Code or key" fact already exists; the planned public code text would show next to it.
- [ ] **Remove a visit:** a mistaken "I went here" still counts; there's no delete yet (#29).
- [ ] **Rate limit on visits** if spam ever shows up: one person can inflate the visit count, though not the people count (#29).
- [ ] **Raise `stats_min_people()` above 1** before the app opens beyond friends: with one visitor, the count, date and ratings are that person's (2026-10-26).

### Deferred (2026-10-26: serve neither principle directly)

- [ ] **E10 share lists**, **E6 public tips**, **E12 photos** (maybe entrance photos only, later), **E13** beyond rate limits.
- [ ] **Needs-based onboarding** (Ashley, 2026-10-16): ask about needs (medical/accessibility, pregnant, with toddlers) and shape the experience from it. Spec first.
- [ ] **Default new places to Private:** dropped for now; revisit only if many people keep their own saved lists.

### Future ideas (backlog, Ashley 2026-10-08; spec each before building)

- [ ] **Curated lists** (e.g. "Best bathrooms to cry in") that people can browse and save into their own list. Becomes E10 + public lists on the shared database.
- [ ] **Lists phase 2: share your list / import a friend's** (E10). Now references to shared bathrooms, not copies; share links are snapshots of which bathrooms.
- [ ] **Lists phase 3: Ashley's public list** shown to everyone in Nearby. Needs its own planning conversation first.

## Done

- [x] 2026-10-26: **Facts by majority** (#39, Tier 1 #2): "What to expect" on each restroom's page has Accessible (Fully / Partly / No), Layout (one single / several singles / one room with stalls / singles and stalls, with how many), Changing table and Code or key, each answered with a tap by anyone, signed in or not. Each person's latest answer counts once and the city's value counts as one more; a tie goes to the newest. Cards show tags like "3 single bathrooms" and "All gender"; the Accessible and Changing station filters follow the facts. Answers show in "Recent changes" and count in `bathroom_edits_per_person` (`fact_answers`), but can't be undone
- [x] 2026-10-26: **Ashley's account is an admin** (`profiles.role`), so it can undo anyone's edit (#34)
- [x] 2026-10-27: **Map: after dragging, the search centers on the part of the map you can see** (Ashley, from a real iPhone), not the middle of the whole map, part of which sits behind the card. Also checked on iPhone: sign-in with E2 lists and E3 visits works (Ashley)
- [x] 2026-10-26: **Confirm and correct any bathroom** (#34, Tier 1 #1): anyone, signed in or not, can Suggest an edit (name, who can use it, hours, "It's open again"), Report closed, and answer "Was it open?" / "Hours right?" after "I went here". Edits go live with a history ("Recent changes" on each restroom page, never who) and Undo for the person who made it or an admin. Two people reporting closed shows "Reported closed" until someone edits it open again. User hours can show "Open" and skip the Seasonal rule. The nightly sync keeps corrected names and hours. Edits per person: `select * from bathroom_edits_per_person;`. Limit: 60 changes per person per hour
- [x] 2026-10-26: **Backlog cleanup:** milestone order closed (Milestone A shipped; Milestone B's E1–E3 shipped, E5 on hold); "Saving without a confirmation step" closed (the pop-up is gone; saving is a list item since E2 and logging is a visit since E3); the `dev` test rows in `location_events` deleted (there were 6)
- [x] 2026-10-26: **E3: visits and ratings** (#29): `visits` table and counts-only `bathroom_stats()`; one-tap "I went here" (main button on the map card, and on every restroom's page); quick Clean / Getting in / Vibes rating with chips; "Rate your last visit"; ratings, facts and "Visited by N people" on cards and pages from the first visit; old ratings carried over as past visits; only signed-in users add places or keep My places
- [x] 2026-10-26: **Map: dragging shows the closest restrooms there** (#28, from user feedback): moving the map at least half the radius searches around the new center (distances stay from you); "Back to me" returns
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

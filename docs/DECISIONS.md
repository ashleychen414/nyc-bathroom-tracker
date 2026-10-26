# Decisions

Append-only. Newest at the bottom. Format: date, decision, why, who.

## 2026-10-08: MVP planning (Ashley + Claude)

- **Public data source = NYC Open Data API (`i7jb-7jku`), not the city's Google My Map.** The API returns JSON, needs no key, and is the city's own source; the My Map can't be queried.
- **Load all boroughs, Brooklyn is the focus for testing and hours review.** All ~1k rows is a small file, and users near borough lines would otherwise miss the closest restroom.
- **Private bathrooms in MVP = the user's own saved list only.** Getting reliable private-restroom data (does this Starbucks let customers use the restroom?) is the hardest, least accurate part, so we skip it.
- **Add a place via current location or address search. No tapping a map, no pasting Google Maps links.** Short Maps links need a server to open.
- **Location: GPS default, zip fallback. Radius 0.25 / 0.5 / 1 mi, default 0.5.** The core need is urgent and nearby.
- **Accuracy first:** never show a guessed "Open". Unknown hours → "Hours unknown". Closed/non-operational → shown greyed out, not hidden.
- **Personal/friends tool:** no moderation, analytics, or accounts.
- **Saved places stored on the phone for MVP; lasting forever is follow-up #1.** The storage code is written so it can move to a server later.
- **Seasonal restrooms never show "Open"** (source has no season dates). "8am-4pm, Open later seasonally" shows Open during 8am-4pm (the stated minimum) and "Hours vary" outside it.
- **Bare time ranges ("9:00am-5:00pm") are read as daily** and flagged `assumed-daily` in `data/hours-review.md` for spot-checking. This is the one place the parser assumes; revisit if a review finds counterexamples.
- **Typos in day-by-day hours (e.g. "Tuesday: 10:00 pm - 7:00 pm") make that day "Hours unknown"** instead of guessing the fix. Fix via `data/hours-overrides.json` once confirmed.

## 2026-10-08: My places logging (Ashley + Claude)

- **Log dimensions (Ashley):** lighting, bathroom cleanliness, trash cleanliness, smelly vibes (each 1-5 stars, 1 = very bad, 5 = very good); trash cans and stalls (yes/no); other notes (text).
- **Every dimension is optional;** tapping a selected answer again clears it. Only logged fields are stored.
- **Stalls = Yes shows "How many stalls?"** (number only, optional; dropped if Stalls is No). Card chip reads "3 stalls". (Ashley)
- **"Trash cans" comes before "Trash cleanliness",** and trash cleanliness is hidden (and not saved) when trash cans = No.
- **One log per place, overwritten on edit** (no visit history yet). Revisit if users want to see change over time.
- **Address search uses Photon (photon.komoot.io):** free, no key, OpenStreetMap-based. Fine at friends scale; revisit if usage grows.
- **Prototype has no build tool** (plain ES modules + `npm run dev` static server). Add Vite only when we need bundling or an installable-app build step.
- **Ratings use a different emoji per dimension instead of stars (Ashley, option B):** 💡 lighting, 🧼 bathroom cleanliness, 🗑️ trash cleanliness, 🌸 smelly vibes (more flowers = smells better, which removes the "5 smelly = very smelly?" confusion). Unselected emoji are shown greyed and faded. Avoided 💩 / 🚽 / 👃, whose meaning when repeated as a score is unclear.

## 2026-10-08: MVP UI/UX review (Ashley)

Canvas: https://claude.ai/artifact/TaZJrd5tawKGG1meXcGfdL (11 screens, requirements beside each row).

- **Nearby mixes public restrooms and your places.** This is the core experience. Filter chips: All · Public · My places.
- **Tapping a card opens a detail screen.** The detail has Directions plus an "Add notes" shortcut (replaces "Save & log"). Adding notes also saves the restroom to My places.
- **Your places get an Hours section:** Don't know (default) · 24 hours · Set hours (same every day, or per day with Closed). Used to show Open / Closed now, so your places sort by status like public ones. Saved public restrooms use the city's hours.
- **MVP filters:** All · Public · My places, Open now, Accessible, Changing station.
- **Backup:** export a .json file; import merges by place id, keeping the newer edit.
- **Kept as defaults (not yet confirmed):** "Closed now" is greyed out like closed restrooms; the Home Screen prompt shows after the first save.

## 2026-10-08: Name and logo (Ashley)

- **App name: NYC Poops** (page title, Home Screen name, install steps, backup file name).
- **Logo:** Ashley's circular badge (`design/NYC_POOPs_logo.jpeg`) used for the Home Screen icon, the welcome screen, and a small mark in the Nearby header. Icons are cropped from the badge with padding so iPhone's rounded corners and Android's masks don't clip the ring.
- **Colors follow the logo:** accent #135633 (logo green) and background #f8f4ed (logo cream), replacing the teal.

## 2026-10-08: After first feedback (Ashley)

- **Map view will be a List / Map toggle** on Nearby, not a replacement for the list.
- **Nearby shows only restrooms that are open or might be, by default.** Done as a "Hide closed" filter chip that starts on, not a hard rule (Ashley's call): tapping it brings closed restrooms back, greyed out. Your saved places always show in My places.

## 2026-10-08: Lists roadmap (Ashley)

1. **Personal list per person**, which they add to and edit (kept forever via accounts: phase 1).
2. **Share your list, or import a friend's** into your own list (imported places become your own copies: phase 2).
3. **Eventually a public list** Ashley publishes, added to the default restroom list in Nearby (phase 3).
- **Phase 1 runs on Supabase's free plan** with a nightly keep-alive query; upgrade only when a specific limit is hit (pausing despite the keep-alive, or nearing a free-plan quota).
- **Phase 2 share links are snapshots** of your list at the time you share it.
- **Phase 3 gets its own spec conversation later.** For now it only informs the data model (a published flag, an admin flag, notes private by default).

## 2026-10-08: Lists phase 1 build

- **Supabase project in Ashley's personal org (free plan),** not the koodoslabs company org (Enterprise, billed, employer-owned).
- **Sign in with a 6-digit email code, not a magic link.** On iPhone a link opens Safari rather than the Home Screen app, which keeps separate data.
- **Local-first sync:** the phone's copy is what the app shows and edits; it syncs with the account in the background (after changes, on open, when back online). Newer edit wins per place; deletes sync as tombstones.
- **Signing out removes places from that phone** (they stay in the account). If changes haven't synced yet, the app warns first.
- **The post-save "Keep your places safe" pop-up is gone.** My places shows a sign-in banner instead, and the Home Screen tip moved into the account sheet. This should resolve the "save confirmation screen" feedback.

## 2026-10-14: Improvements, resolving conflicts with earlier decisions (Ashley)

See `docs/IMPROVEMENTS-SCOPING.md` §2.

1. **Switch to a shared bathroom database.** Lists and shares point to one shared record per bathroom (references), not private copies, so visits and fixes raise trust for everyone. Replaces the Oct 8 phase 2 "imported places become your own copies" decision. Share links can still be snapshots of *which* bathrooms.
2. **Map-first home.** Nearby opens on the full-screen map by default, with a toggle to switch to the list. Replaces the Oct 8 "list stays the default" decision.
3. **Fact-based fields (stalls, layout, trash cans, etc.) on hold.** No decision on how facts vs. ratings display until that functionality is picked up.
4. **Notes stay private.** Public tips are a separate future feature, not a toggle on notes.
5. **No third-party analytics.** Measure the goal (10 regular users, 2 contributors) with counts from our own database.

## 2026-10-14: Map-first home details (E4)

- **The map legend is always visible** as a strip between the filters and the map, never below it (Ashley). Short labels so it fits one line on a phone.
- **Bottom card instead of pin popups:** shows the best match by default (open first, then nearest) with Directions and Details; ‹ › steps through results; tapping a pin selects it.
- **Compact header so the map keeps its room:** location is one line ("Near 11215 (approx.) · Change"); the radius is a dropdown in the filter row.

## 2026-10-14: Working with several agents in parallel

- **Each agent gets its own worktree and branch; changes reach `main` only through a pull request,** and tests run on every PR. Pushing straight to `main` deploys, so it's not a place for unreviewed parallel work.
- **Parallel branches don't edit `docs/TASKS.md` or `docs/DECISIONS.md`.** Notes go in the PR description and are copied in after merging, because every branch editing those files guarantees merge conflicts.
- **One agent at a time owns database (Supabase) changes,** so migrations don't collide.
- **`docs/private/` is linked into worktrees, not copied;** `.gitignore` now ignores the link too, so it can't be committed to the public repo.

## 2026-10-14: Shared bathrooms foundation (E1 step 1)

- **Fixed lists are text columns with check constraints, not Postgres enums.** They're easier to change later.
- **Seed `access = public` for all city restrooms,** including privately owned public spaces (POPS), which are public by law. `status` is our verification status. The city's Operational/Closed status stays in `source_data` until E7 gives it a home.
- **The nightly sync never deletes rows or changes `status`.** A row that leaves the city data gets `source_removed_at`, so saved places keep working.
- **The first GitHub secret is `SUPABASE_SECRET_KEY`:** a new-style Supabase secret key, used only by the deploy workflow.

## 2026-10-14: Hours review (PR #2)

- **Seasonal hours: use the shorter season's hours all year.** It may show closed when it's open, never the reverse.
- **A city time range that is really the park's hours** (Brooklyn Bridge Park 6am–1am) is replaced by the restroom's published hours.
- **`hours: null` with a note means "reviewed, no reliable hours":** the row leaves the review list but still shows "Hours unknown". Overrides now carry a `source` URL.
- **City hours with no days stated stay daily** when nothing contradicts them (McCarren Park Zone 3, Ashley's call).
- **Holidays:** libraries follow each system's published closure list (closed). NYC Parks restrooms read "hours unknown" on city holidays, because Parks publishes no holiday policy. A holiday never makes a closed or Seasonal restroom open.
- **Reopened libraries** (Gravesend, Ryder, Leonard) get hours but stay greyed out until the city updates their status, or overrides can set status.

## 2026-10-14: Place search (PRs #3, #8)

- **E9-lite keeps Photon/OpenStreetMap and re-ranks results in the app** (stronger location bias, then name match, kind of place, distance) instead of adding a paid provider. The main complaint was ranking, not coverage.
- **Restaurants come from a live query to the city's inspection data**, not a shipped file: about 5 KB per search versus a ~2 MB file that would change nightly. City results are a bonus: capped at 4 seconds, and Photon results show alone if the query fails.

## 2026-10-14: Reading restrooms from Supabase (PRs #6, #7)

- **Repeated city rows: the less-open copy wins**, in both `build-data` and the database sync (accuracy first).
- **Dataset-level info** (city "last updated" date, build time, holiday closures) lives in a `data_sources` table, not on each row.
- **Phones cache the restrooms** and re-download only when `data_sources` or any bathroom's `updated_at` changes. If Supabase fails, the app falls back to `bathrooms.json`, then the phone copy.
- **The map shows only seed and confirmed rows:** enforced by row-level security, so `needs_details` rows never reach the app.

## 2026-10-24: Landing screen (PR #9)

- **The welcome backdrop map shows restrooms as grey dots,** because it has no status and green would read as "Open".
- **The second welcome button goes to My places, not a zip code.** The zip code field still appears on Nearby whenever location isn't available.

## 2026-10-24: Location blocked (PR #10)

- **When location is denied, Nearby leads with the zip code and shows how to turn location back on,** instead of a "Use my location" button that can't work (iOS never asks again once a site is denied).
- **Safari's address-bar button is named loosely ("aA" or "⋯")** because Apple renames it between iOS versions.

## 2026-10-24: What "private bathroom" means (Ashley)

"Private" was two different ideas. They are now two separate fields on a bathroom:

- **Access** (who can use it), shown to users as:
  - **Available to Public**: today's city restrooms (`access = public` in the `bathrooms` table).
  - **Customer Only**: cafés, restaurants, stores and the like (`access = customers_only`). Customer Only bathrooms are **visible to everyone** on the map; the label tells people they may need to buy something.
- **Visibility** (who can see it), chosen by the user when they create a bathroom:
  - **Public**: saved to the shared NYC Poops database, visible to everyone.
  - **Private**: visible only to the person who created it (an office, a friend's apartment).
- **Users can create Customer Only bathrooms and mark each one Public or Private.**
- **Duplicates are accepted for now.** The same café can exist as a Public bathroom and as someone's Private one; the UI shows both entries, and nothing is merged automatically. Merging is E8 (duplicates) later.

Unblocks E2. Not decided here: whether the existing `key_or_code` access value stays as a third label, and how today's 2 privately logged places migrate (proposal: Private, so nothing logged privately becomes public without the owner choosing).

## 2026-10-24: Key-or-code access, and moving today's saved places (Ashley)

Follow-ups to "What private bathroom means" above.

- **"Key or code" folds into Customer Only.** Access stays two labels for users: Available to Public and Customer Only. Whether you need to ask for a code or key becomes a yes/no fact on the bathroom (with the other facts, E5). The code itself only ever goes in private notes. `unknown` stays as the internal default when the creator doesn't know; users see no label, or "Access unknown" on the detail screen.
- **The 2 hand-added saved places move over as Private,** since their owners saved them before Public existed. Their access starts as unknown.
- **On their next sign-in, each of those owners gets a one-time prompt** asking whether to make those bathrooms Public. Nothing becomes public unless the owner chooses it. The city restroom on a saved list just becomes a list item pointing to the shared record.

## 2026-10-24: Visits and ratings (Ashley)

Designed around two users: the person who needs a bathroom now (Is it open? Can I get in? Is it clean? Can I trust this?) and the person who just used one and can tell others.

- **Flow:** "I went here" is always one tap; it counts as a visit even with no rating. Quick star ratings appear right after and can be skipped. Skipped ratings come back later as a small "Rate your last visit" card in the app. No push notifications for now (on iPhone they only work after adding the app to the Home Screen).
- **Ratings (1–5): Clean, Getting in, Vibes.** "Getting in" replaces "Accessible", which mixed capacity, amenities and entry, and would mislead people who need step-free access. Vibes is optional and shown last.
- **Below 5 stars, tap what was missing:**
  - *Clean:* dirty floors, smells bad, not enough trash cans
  - *Getting in:* needs a code, had to buy something, had to wait, hard to find
  - *Vibes:* lighting, music
- **Reasons double as facts.** When enough people tap one (e.g. "Needs a code"), the bathroom shows it ("Code needed"). Stalls, baby changing and step-free are facts about the bathroom (E5), not ratings.
- **Codes stay private.** People can confirm *that* a code is needed; the code itself lives only in private notes. Sharing codes would be a public tip (E6), decided separately.
- **Trust signal:** "Visited by N people · last visit <date>", shown only once 3 different people have visited, so no one's visits can be singled out.
- **Existing ratings carry over:** cleanliness → Clean; low smell or trash scores → the matching Clean reasons; lighting → a Vibes reason.

## 2026-10-24: Location outcome log (PR #16)

- **Location outcomes are logged anonymously to our own Supabase table,** in line with "database counts only" (2026-10-14). The log holds no coordinates, user, zip code or user agent. Visitors can insert only, and it's read with the service role through two views. Opening the app with location already blocked is logged too, so blocked phones show up.
- **The welcome screen drops "Your location stays on this phone",** because location is shared with Photon (address lookups) and with the map tiles (Ashley).

## 2026-10-24: Startup location check (PR #21)

- **At startup, a "denied" from the browser's permission check isn't trusted on its own.** The app shows the blocked state (zip first), quietly tries to get the location once, and switches to it if that works. Why: on iOS 26/27, Home Screen apps can report "denied" while location actually works (Apple Developer Forums thread 804381). On a phone that really is blocked, the try fails at once with no prompt. `already_blocked` in the location log views keeps its meaning, so no database change.

## 2026-10-26: Lists and shared bathrooms (PR #24)

- **New places default to Public** for now (Ashley), to grow the shared map; one tap makes a place Private. Signed out, a Public place stays on the phone until sign-in ("Public after sign-in"). Flipping the default to Private with a make-public prompt is a likely future change.
- **Public bathrooms people add are readable by everyone right away,** without waiting for us to confirm them. The old "seed or confirmed" read rule would have kept a new Public café off the map until it was confirmed by hand. We can still hide one by setting its status to `removed` (its owner still sees it).
- **Making a place Public can't be undone** (Ashley): others may have saved it. The app locks the choice and a database trigger refuses Public → Private for every role. Creators can still edit a Public place. Users can delete only Private places; "Remove from My places" takes a place off your list only and leaves it on the map.
- **Deleting an account keeps that person's Public bathrooms,** with no owner (nobody can edit them in the app; corrections come through E7). Their Private bathrooms, list and notes are deleted.
- **One list per person ("My places")** until lists can be shared (E10) (Ashley).
- **Duplicates show as separate entries,** with no "possibly the same place" hint (prototype answer).
- **Old log fields become tappable tags inside the E3 rating dimensions** (Ashley): Clean: Trash cans, Smell; Getting in: Number of stalls; Vibes: Lighting. Tapping a tag opens that field's old rating. Until E3 they're off the form; the old values are kept to carry over.
- **Known gaps, kept as is** (Ashley): a Public place that hasn't reached the server yet is already locked, though nobody else can see it; and hiding a Public place may not reach phones that cached the restroom list until other bathroom data changes (the cache check only looks at the newest visible row). Fixes are noted in TASKS.md if they become needed.
- **Sync for your own bathrooms doesn't compare clocks:** a place changed on the phone is sent, otherwise the account's copy wins. List items keep "newer edit wins", as `places` did.

## 2026-10-26: Rating chips, and what needs an account (Ashley)

- **One set of chips per rating, no separate tags.** Tapping a chip marks it as a problem. Chips for the old log fields (Clean: Trash cans, Smell; Getting in: Number of stalls; Vibes: Lighting) also open that field's own 1–5 rating. The full chip list per rating: *Clean:* dirty floors, smell, trash cans; *Getting in:* needs a code, had to buy something, had to wait, hard to find, number of stalls; *Vibes:* lighting, music.
- **Signed-out visits are allowed.** "I went here" and ratings work without an account; they're kept on the phone and count toward public numbers only after sign-in, so "3 different people" stays reliable.
- **Only signed-in users can add new places or keep their own list (My places).** This replaces "Signed out, a Public place stays on the phone until sign-in" from the 2026-10-26 E2 entry. Places already saved on a signed-out phone are kept and move to the account at sign-in.

## 2026-10-26: Map searches where you drag it (user feedback)

- **The map searches the new area on its own, no "Search this area" button.** Someone who needs a restroom urgently shouldn't need an extra tap. Only moves made by hand count, and only once the map center is half the radius or more from the last search, so zooming in place or a small nudge keeps the current results and selected card.
- **Distances on the card stay measured from you,** not from the map center: the map decides which restrooms show and their order, but "how far is it" is always about the walk from where you are. "Back to me" returns to the search around you; a new location does the same. The list view always shows results around you.

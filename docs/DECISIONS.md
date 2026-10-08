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

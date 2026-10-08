# NYC Bathroom Tracker

Mobile web app to find the nearest usable restroom fast, for people who need to go urgently
(e.g. ostomy, pregnancy). Brooklyn first, NYC public data, plus each user's own saved places.
Audience: the owner (Ashley) and friends, so no moderation, analytics, or accounts in the MVP.

## Product principle: accuracy first

A wrong "Open" is the worst failure. Never show "Open" unless the source hours say so for
this exact day and time in New York. Ambiguity resolves to "Hours unknown" / "Hours vary",
never to "Open". Closed and non-operational restrooms are shown greyed out, not hidden.

## Where things live

- `docs/SPEC.md`: locked MVP scope, out of scope, follow-ups. Change only when Ashley decides.
- `docs/DECISIONS.md`: dated log of product and technical decisions and why. Append, don't rewrite.
- `docs/TASKS.md`: Now / Next / Later / Done. Keep it current at the end of every work session.
- `docs/FEEDBACK.md`: user feedback, logged verbatim with date and who. Triage into TASKS.md.
- `src/lib/hours.js`: hours parser + open/closed status (shared by build script and app).
- `src/lib/nearby.js`: builds the Nearby list (mix, filter, sort, top-up). `src/lib/hours-form.js`: Hours form ↔ hours model.
- `src/app.js`: state, hash routing, location. `src/views/*`: screens (nearby, places, form, shared pieces).
- `scripts/build-data.mjs`: pulls NYC Open Data → `public/data/bathrooms.json` and `data/hours-review.md`.
- `data/hours-overrides.json`: hand-reviewed structured hours, keyed by bathroom id. Wins over parsed hours.

## Commands

- `npm run data`: rebuild bathroom data from NYC Open Data (no API key needed)
- `npm test`: unit tests (node:test, no deps)
- `npm run dev`: local server at http://localhost:5173

## Data facts (verified 2026-10-08)

- Source: NYC Open Data "Public Restrooms" `i7jb-7jku` (Socrata). 1,066 rows citywide, 288 Brooklyn.
- Last updated by the city 2025-06-27, so statuses may be stale; the UI must show this date.
- No ID column: ids are `nyc-` + sha1(name|lat|lng). Renaming or moving a row in the source changes its id.
- No borough column: use computed region `:@computed_region_yeji_bk3q` (1 SI, 2 Brooklyn, 3 Queens, 4 Manhattan, 5 Bronx).
- `open` field: Year Round / Seasonal / Future. No season dates, so Seasonal never shows "Open".
- Hours are free text. Parser is strict on purpose; anything it can't read exactly goes to the review list.

## Working conventions

- No backend in the MVP. Saved places live on the user's phone behind a single storage module
  (`src/lib/storage.js`) so the follow-up sync to a server only touches that file.
- Saved places need permanent ids, createdAt/updatedAt, and a schema version, so they can be
  moved to the server later.
- Keep dependencies minimal. Flag any new paid service or API key to Ashley before adding it.
- When finishing work: update `docs/TASKS.md`, and add to `docs/DECISIONS.md` if a decision was made.

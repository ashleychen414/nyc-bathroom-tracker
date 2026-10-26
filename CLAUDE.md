# NYC Poops (NYC Bathroom Tracker)

App name shown to users: **NYC Poops**. Logo source: `design/NYC_POOPs_logo.jpeg`; brand green #135633 on cream #f8f4ed.

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
- `docs/private/` (git-ignored, on Ashley's Mac only): private product docs. `improvements.md` = product vision, target users, goals, friend feedback, proposed data model (Ashley, Oct 12). Read it for product context; never commit or quote it into public files. Sized and cross-referenced in `docs/IMPROVEMENTS-SCOPING.md`.
- `docs/FEEDBACK.md`: user feedback, logged verbatim with date and who. Triage into TASKS.md.
- `src/lib/location-log.js`: anonymous location outcomes → `location_events` (see Location log).
- `src/lib/hours.js`: hours parser + open/closed status (shared by build script and app).
- `src/lib/nearby.js`: builds the Nearby list (mix, filter, sort, top-up). `src/lib/hours-form.js`: Hours form ↔ hours model.
- `src/app.js`: state, hash routing, location. `src/views/*`: screens (nearby, places, form, shared pieces).
- `scripts/build-data.mjs`: pulls NYC Open Data → `public/data/bathrooms.json` and `data/hours-review.md`.
- `data/hours-overrides.json`: hand-reviewed structured hours, keyed by bathroom id. Wins over parsed hours.

## Hosting

- **Main link: https://www.nycpoops.com** (domain bought on Vercel; nycpoops.com redirects to www). Email codes are sent from noreply@nycpoops.com via Resend (custom SMTP in Supabase).
- Vercel: https://nyc-bathroom-tracker-ashley-s-sandbox.vercel.app/ (team ashley-s-sandbox, linked to GitHub; builds on every push via `vercel.json`).
- GitHub Pages: https://ashleychen414.github.io/nyc-bathroom-tracker/ (public repo ashleychen414/nyc-bathroom-tracker).
- Both publish `_site/` from `scripts/assemble-site.mjs`. `.github/workflows/deploy.yml` deploys Pages on every push, and nightly refreshes the city data and commits it only when it changed (that commit is what redeploys Vercel).
- Saved places are per web address: moving users between hosts needs backup export/import. The repo is public: never commit personal info, keys, or private doc links.
- Commits use the GitHub noreply email (set in this repo's git config).

## Accounts and sync (lists phase 1)

- Supabase project **NYC Poops** (`fvombovjjgffhiphzgiw`), org **Ashley's Sandbox**, free plan. Never use the koodoslabs org (Ashley's employer).
- Table `public.places` (id, user_id, data jsonb, updated_at, deleted_at) with row-level security: users read/insert/update only their own rows; no delete policy (deletes are tombstones). RPCs: `delete_my_account()`, `keep_alive()` (nightly GitHub Action).
- Sign-in is a one-time **code** by email (not a link: links open Safari instead of the Home Screen app). Needs `{{ .Token }}` in the Supabase email templates.
- `src/lib/auth.js` (plain fetch to Supabase Auth), `src/lib/sync.js` (local-first; newer edit wins per place via `planSync` in storage.js). The publishable key in `src/lib/supabase-config.js` is public by design.
- **Visits and ratings (E3):** `public.visits` (one row per "I went here", optional Clean / Getting in / Vibes ratings and chips; each person reads only their own). Others see `bathroom_stats()`: counts only, never who; its minimum number of people is `stats_min_people()` (1 for now). App side: `src/lib/visits.js` (on the phone first, works signed out), `src/lib/stats.js`, `src/views/ratings.js`; visits upload with the rest of the sync at sign-in.

## Location log (database counts only)

- `public.location_events`: one anonymous row per location attempt (`src/lib/location-log.js`): trigger, permission before, result, platform word, app version (short commit sha; `dev` = a local copy). No coordinates, user, zip or user agent. Visitors can only insert; reading needs the service role.
- **To read it**, in the Supabase SQL editor: `select * from location_events_daily limit 50;` (per New York day and platform: attempts, success_pct, counts by result) and `select * from location_events_weekly;` (last 7 days vs the 7 before, per platform and `all`; a big negative `success_change_pts` after a deploy = look at that deploy). `already_blocked` = the browser said location was denied for the site before the attempt; on startup the app still tries once, quietly, and logs the real result (iOS Home Screen apps can say denied while location works).
- Rows tagged `rls-check` come from `npm run test:rls` (one per deploy) and are left out of both views.

## Commands

- `npm run data`: rebuild bathroom data from NYC Open Data (no API key needed)
- `npm test`: unit tests (node:test, no deps)
- `npm run dev`: local server at http://localhost:5173
- `npm run test:rls`: checks what an anonymous visitor can do against the live Supabase project (also runs on every deploy)

**Database changes:** every schema change is a Supabase migration, saved in `supabase/migrations/` with the same version as in Supabase. After any change to a table or its policies, run `supabase/tests/places_rls.sql` (it rolls back, leaving nothing behind) and add matching checks for new tables.

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
  Exception: in parallel work (below), put these in the PR description instead.

## Parallel work (several agents at once)

- Each agent works in its own git worktree and branch, never in the main checkout. Changes reach
  `main` only through a pull request; `.github/workflows/test.yml` runs the tests on every PR.
- Split work by feature, not by layer. Two agents must not edit the same files at the same time.
- **Shared docs:** don't edit `docs/TASKS.md` or `docs/DECISIONS.md` on a parallel branch (every
  branch would conflict there). Write "Tasks:" and "Decisions:" notes in the PR description; they are
  copied into those files once, after merging.
- **Database:** only one agent at a time makes Supabase schema or policy changes (migrations). Say
  so in the PR title. Other agents don't touch `supabase/`.
- **Private docs:** `docs/private/` isn't in git, so a new worktree doesn't have it. Link it in,
  from the worktree's folder: `ln -s /Users/ashleychen/nyc-bathroom-tracker/docs/private docs/private`
  (git ignores the link). Never copy its contents into tracked files.
- **Local server:** give each worktree its own port, e.g. `PORT=5174 npm run dev`.
- Before merging, update the branch from `main` and rerun `npm test`.

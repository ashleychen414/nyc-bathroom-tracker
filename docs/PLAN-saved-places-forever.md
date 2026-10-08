# Plan: saved places last forever (Follow-up #1)

Status: **draft for Ashley's review**, 2026-10-08. Nothing built yet.

## 1. Decision

Should we store each person's saved places on a server (Supabase), tied to a sign-in by email link, so they survive a cleared browser, a new phone, or switching between our web addresses, and are deleted only when the person deletes them?

## 2. Facts

1. **Today places live only in the phone's browser.** They're lost if site data is cleared, on a new phone, or if iOS clears it (the Home Screen prompt only reduces that risk). Backup export/import is the only safety net.
2. **Places are also tied to one web address.** The github.io and vercel.app sites each keep their own copy. A server copy removes that problem too.
3. **The app is already built to move.** Every read/write goes through `src/lib/storage.js`; places have permanent ids, `createdAt`/`updatedAt` and a schema version; and import already merges two lists with "newer edit wins". Sync reuses that merge.
4. **"Forever" requires a way back in.** If the server copy is keyed to something stored only on the phone, losing the phone loses the key. So the person needs a recoverable sign-in (email is the simplest).
5. **Supabase free plan pauses inactive projects.** After ~7 days of low database activity it pauses (restorable for 90 days); paid plans never pause ([Supabase docs](https://supabase.com/docs/guides/platform/free-project-pausing)). For a friends-scale app with quiet weeks, this is a real risk to "forever".
6. **No secrets in the public repo.** Supabase's browser key is designed to be public; access is enforced on the server with row-level security (each person can read and write only their own rows). The admin key never goes in the app or the repo.
7. **OQ: sharing.** Do friends want to share a list (e.g. a group list), or is each list personal? This changes the data model. *Needs Ashley's answer before building.*
8. **OQ: budget.** Free plan + a daily "keep-alive" query from our nightly job, or the paid plan (no pausing)? *Needs Ashley's answer; check current Supabase pricing before deciding.* [Assumption: the paid plan is roughly $25/month; verify on supabase.com/pricing.]

## 3. Proposal

Keep the app **local-first**: the phone's copy stays the source for showing and editing (fast, works offline), and a server copy syncs in the background once the person signs in. Signing in is optional: the app keeps working exactly as today without an account; a banner on My places says "Sign in to keep your places forever". Sign-in is a magic link by email (no password). On first sign-in, places already on the phone upload and merge with any on the server (newer edit wins), so nothing is lost when someone signs in on a second phone or our other web address.

Deletes are kept as "tombstones" (a deleted flag + time) so a delete on one phone isn't undone by an older copy on another; a person's account and all their places are permanently removed only when they choose "Delete my account". Supabase on the free plan with our nightly GitHub Action also running one small query to prevent pausing; move to the paid plan if pausing ever happens or usage grows. Rough effort: **2–3 days** part-time. [Assumption: personal lists only, no sharing.]

## 4. Alternatives

1. **Stay phone-only, improve backups.** No accounts or server. Pro: zero cost, no privacy surface. Con: never truly "forever"; relies on people exporting.
2. **Supabase paid plan from day one.** Same as the proposal without the keep-alive. Pro: no pausing risk. Con: monthly cost for a handful of users.
3. **Anonymous account + a recovery code/link** instead of email. Pro: no email collected. Con: lose the code and the places are gone; that undercuts "forever".
4. **Sign in with Google / Apple** instead of (or in addition to) email links. Pro: one tap, no email round-trip. Con: OAuth setup per provider (Apple needs a paid developer account); can be added later on top of email.
5. **A different backend (Firebase, Vercel storage, own server).** Pro: none decisive for us. Con: Supabase already has the pieces (auth, Postgres, row-level security) and a connector in this workspace.

## Build steps (once approved)

1. Create the Supabase project; table `places` (id, user_id, data, updated_at, deleted_at) with row-level security: a user sees and changes only their own rows.
2. Enable email magic-link sign-in; set redirect URLs for both web addresses and localhost.
3. `src/lib/storage.js`: keep local storage as is, add a sync layer: push local changes, pull server changes, merge (newer wins), tombstones for deletes.
4. UI: "Sign in to keep your places forever" banner + sheet (email → "check your inbox"); signed-in state in the My places ⋯ menu (email, Sign out, Delete my account).
5. Nightly job: add the keep-alive query (free plan only).
6. Tests for the merge with tombstones; manual test on two devices (phone + Mac) and both web addresses.
7. Update the privacy line in the app ("Saved on this phone only" → what's stored where) and the docs.

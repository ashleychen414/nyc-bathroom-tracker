# Plan: saved places last forever (Follow-up #1)

Status: **approved for phase 1** (free plan), 2026-10-08. Phase 2 = snapshots. Phase 3 = separate spec later. Nothing built yet.

## Roadmap for lists (Ashley, 2026-10-08)

| Phase | What people get | Builds on |
|---|---|---|
| **1. Personal list, kept forever** | Each person has their own list they add to and edit, saved to their account | This plan (below) |
| **2. Share and import** | Share your list with a friend; import a friend's list into your own (copies their places in as yours) | Phase 1 accounts + a share link |
| **3. Public list** | Ashley publishes chosen places as a public list that everyone sees in Nearby, alongside the city's restrooms | Phase 1 + an "admin" role for Ashley. *Separate spec conversation later.* |

Phase 1 is designed so phases 2 and 3 don't need a data migration (see "Ready for phases 2 and 3").

## 1. Decision

Should we store each person's saved places on a server (Supabase), tied to a sign-in by email link, so they survive a cleared browser, a new phone, or switching between our web addresses, and are deleted only when the person deletes them?

## 2. Facts

1. **Today places live only in the phone's browser.** They're lost if site data is cleared, on a new phone, or if iOS clears it (the Home Screen prompt only reduces that risk). Backup export/import is the only safety net.
2. **Places are also tied to one web address.** The github.io and vercel.app sites each keep their own copy. A server copy removes that problem too.
3. **The app is already built to move.** Every read/write goes through `src/lib/storage.js`; places have permanent ids, `createdAt`/`updatedAt` and a schema version; and import already merges two lists with "newer edit wins". Sync reuses that merge.
4. **"Forever" requires a way back in.** If the server copy is keyed to something stored only on the phone, losing the phone loses the key. So the person needs a recoverable sign-in (email is the simplest).
5. **Supabase free plan pauses inactive projects.** After ~7 days of low database activity it pauses (restorable for 90 days); paid plans never pause ([Supabase docs](https://supabase.com/docs/guides/platform/free-project-pausing)). For a friends-scale app with quiet weeks, this is a real risk to "forever".
6. **No secrets in the public repo.** Supabase's browser key is designed to be public; access is enforced on the server with row-level security (each person can read and write only their own rows). The admin key never goes in the app or the repo.
7. **Sharing: answered.** Lists are personal first; sharing (phase 2) means sending a copy that the friend imports into their own list, not one shared list that several people edit.
8. **Budget: answered.** Free plan, with a daily keep-alive query from our nightly job. Upgrade only when we hit a specific limit: the project pauses despite the keep-alive, or usage nears a free-plan limit (database size, monthly active users, bandwidth; check current numbers on supabase.com/pricing).

## 3. Proposal

Keep the app **local-first**: the phone's copy stays the source for showing and editing (fast, works offline), and a server copy syncs in the background once the person signs in. Signing in is optional: the app keeps working exactly as today without an account; a banner on My places says "Sign in to keep your places forever". Sign-in is a magic link by email (no password). On first sign-in, places already on the phone upload and merge with any on the server (newer edit wins), so nothing is lost when someone signs in on a second phone or our other web address.

Deletes are kept as "tombstones" (a deleted flag + time) so a delete on one phone isn't undone by an older copy on another; a person's account and all their places are permanently removed only when they choose "Delete my account". Supabase on the free plan with our nightly GitHub Action also running one small query to prevent pausing; move to the paid plan if pausing ever happens or usage grows. Rough effort: **2–3 days** part-time.

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

## Ready for phases 2 and 3

Decisions made now so later phases are additive:

- **Each place records where it came from:** `origin` = `mine` | `imported`, plus `importedFrom` (the friend's display name and their place id) for imported ones. Re-importing the same friend's list then updates or skips places already imported instead of duplicating them, and your own edits to an imported place are never overwritten.
- **Places can carry a `publishedAt` time** (phase 3). Only Ashley's account (an admin flag on the server) can set it; row-level security lets everyone read published places and nobody else edit them.
- **Notes stay private by default.** Logs can hold things like door codes. Publishing (phase 3) shows the name, location, hours and ratings; notes only if Ashley ticks "include notes" per place.

### Phase 2 sketch: share and import

- **Share:** "Share my list" creates a link (`…/#/import/<code>`) to a read-only snapshot of your list on the server, opened through the phone's share sheet (Messages, WhatsApp…). You choose which places to include; notes are left out unless you tick "include notes".
- **Import:** opening the link shows the friend's places with a preview ("Sam's list · 6 places") and "Add to my list". They become copies in your own list (`origin: imported`) that you can edit or delete like any other.
- **Works without accounts too:** the existing backup file can already be shared and imported, so a file-based version of phase 2 can ship before phase 1 if wanted (import would need to copy places as new ones rather than merge by id).
- **Decided: snapshot.** A share link shows your list as it was when you shared it; sharing again makes a new snapshot.

### Phase 3: public list (data structure only)

Phase 3 gets its own planning/spec conversation when we get there. For now it only shapes the tables:

- `places.published_at` (nullable): set only by an admin account (Ashley); row-level security lets everyone read published places and only the owner/admin change them.
- Notes stay private unless a per-place "include notes" flag is set, so publishing never exposes door codes by accident.
- `profiles.is_admin` (boolean, default false), set by hand in the database, never from the app.

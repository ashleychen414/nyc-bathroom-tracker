# Improvements: sizing, scope and cross-reference

Companion to `docs/private/improvements.md` (Ashley, Oct 12; private, on Ashley's Mac only). Written 2026-10-14 against the actual code, database and `TASKS.md`.

**Sizes** are part-time build days with Claude doing the build, including tests and a deploy:
XS ≤ ½ day · S ≈ 1 day · M 2–3 days · L 4–6 days · XL 7+ days.
[Assumption: estimates assume decisions are made up front; open **DECIDE** items add time if they're settled mid-build.]

---

## 1. Answers from the code (the doc's "Claude Code: find out" items)

| Question in improvements.md | Answer |
|---|---|
| Where does the bathroom dataset come from? | **NYC Open Data "Public Restrooms" (`i7jb-7jku`)**, 1,066 restrooms citywide (288 Brooklyn). `scripts/build-data.mjs` pulls it nightly into a static file, `public/data/bathrooms.json`, which the app downloads whole. City data was last updated by the city on Jun 27, 2025. It is **not in Supabase**. |
| License for public use? | NYC Open Data is published for free public use. **To verify** before a public launch: the current NYC Open Data terms of use and attribution wording. [Assumption: no restriction blocks a free app.] |
| How does the map load bathrooms? | All 1,066 at once (≈520 KB file), then filters in the browser. Fine at today's size; it needs to change once user-added bathrooms live in the database (see E1). |
| Where are `places` read/written, and the `data` shape? | Only through `src/lib/storage.js` (phone copy) and `src/lib/sync.js` (account copy). `data` holds the whole place: name, lat/lng, address, optional `publicId` (city restroom id), `hours`, and `log` (💡 lighting, 🧼 cleanliness, 🌸 smell, 🗑️ trash cleanliness as 1–5; stalls, stall count, trash cans; notes). The screens that use it: My places, Nearby (mixed in), the detail screens, and the add/edit form. |
| Where is it hosted? | **www.nycpoops.com on Vercel** (team "Ashley's Sandbox", linked to GitHub) plus a GitHub Pages copy. The doc's "no matching Vercel project" is because the Vercel connector wasn't authorized for that team. |
| Hard-coded keys or secrets? | Only the Supabase **publishable** key (public by design) in `src/lib/supabase-config.js` and the nightly workflow. No secret keys anywhere. ✅ |
| Tests? | **27 unit tests** (hours parsing, open/closed, Nearby sorting/filtering, hours form, backup merge, sync merge and deletes). Row-level security was tested by hand once (user B couldn't read or edit A's rows) but **isn't an automated test yet**. |
| Error handling on save/sync? | Saves go to the phone first, so they never fail on bad signal. Sync retries on reopen and when back online, and shows "Offline" / "Couldn't reach your account" in My places. Sign-out warns if changes haven't synced. |
| Saving and logging coupled? | Yes: "Add notes" on a public restroom both saves it to My places and opens the log. |
| Hours show raw text? | Yes: formatted hours, then "City listing says: …". |
| Current rows | **2 accounts, 3 places** in Supabase today (the doc says 2), 1 of them a saved public restroom. |

### Corrections to the doc's tech-debt section

- **#3 `delete_my_account()`: confirmed safe.** It deletes only `auth.uid()` and refuses if not signed in; the warning is expected. Rule for new tables: give every user-owned table `references auth.users on delete cascade` (or a `profiles` row that cascades), and deletion keeps working without editing the function.
- **#4 Leaked password protection: not applicable.** The app has no passwords; sign-in is a one-time email code. Nothing to do.

---

## 2. Conflicts with earlier decisions

**Resolved 2026-10-14 (Ashley), see `DECISIONS.md`:** conflict 1 (copies vs. references) → shared database (references); conflict 3 (list vs. map) → map-first default with a list toggle; conflict 4 (ratings vs. facts) → fact display on hold; conflict 5 (notes vs. tips) → notes stay private, tips later; conflict 6 (analytics) → database counts only. Conflict 2 (local-first) follows from 1: the phone becomes a cache for shared facts, as proposed.


1. **Copies vs. references.** `DECISIONS.md` (Oct 8) says sharing gives the friend *their own copies*; improvements.md proposes *references to one shared bathroom* so visits and fixes help everyone. References are what make the trust goal possible, so **I recommend switching to references**, but it reverses the phase 2 "copies" decision. Snapshot links can still work: a share is a snapshot of *which* bathrooms, not of their details.
2. **Local-first.** Today the phone's copy is the source and works offline. A shared `bathrooms` table makes the server the source for shared facts. **Proposal:** keep the phone as a cache (read offline, queue your own visits/edits), but shared facts come from the server. Medium complexity; it's in E2's size.
3. **List vs. map home.** `DECISIONS.md` says Nearby keeps the list as default with a toggle; friend feedback asks for a full-screen map home (Citi Bike style). Recommend **map-first with a bottom sheet**, and the list one swipe away, which also serves the emergency user.
4. **Ratings vs. facts.** The current log mixes ratings (lighting, cleanliness, smell, trash cleanliness, 1–5) with facts about the bathroom (stalls, stall count, trash cans, layout). In the new model **ratings go to `visit_ratings`** (per visit, averaged) and **facts go to `bathrooms` through `bathroom_edits`** (one shared answer). Otherwise "3 stalls" gets averaged with "1 stall".
5. **Notes are private; tips are public.** Notes can hold door codes. Keep them private by default (`visits.note`), and make public tips a separate, deliberate action (`bathroom_tips`). Recommend **not** a "make this note public" toggle on notes: one mis-tap leaks a code.
6. **Analytics.** The MVP decided "no analytics", but the current goal (10 regular users, 2 contributors) can't be measured without some counting. **Proposal (S):** count from our own database (weekly active signed-in users, visits logged, edits submitted) in a small admin view. No third-party tracking. Emergency users who never sign in won't be counted, so also consider privacy-friendly page-view counts (Vercel Analytics). **DECIDE.**

---

## 3. Epics, sized

Ordered by the doc's suggested build order, with quick wins pulled forward.

| # | Epic | What's in it | Size | Depends on | Key open decisions |
|---|---|---|---|---|---|
| **E0** | Quick wins | Hours: replace raw text with "Hours from NYC Open Data · View on Google Maps" (**XS**). Filter by type for city data: Park / Library / Transit / Plaza / Privately owned public space (**S**). RLS automated test (**S**). | **S–M** (2d) | none | none |
| **E1** | Shared bathrooms foundation | `profiles` (display name, role), `bathrooms` table with fixed `venue_type` / `access` / `status` / `source` lists, load the 1,066 city restrooms (`source=seed`, `status=unverified`, keep `nyc-…` ids so saved ones still match), nightly job updates the table (needs a GitHub secret with a service key, the first secret in the project), app reads bathrooms from Supabase instead of the JSON file | **L** (4–6d) | none | Map shows only confirmed + seed (not `needs_details`)? |
| **E2** | Lists + migrate `places` | `lists`, `list_items` (references), default list per user, migrate the 3 places (match the 1 saved city restroom by id; create `bathrooms` rows for the 2 private ones, visible to their owner only), rewrite storage/sync from JSON copies to rows, offline cache, retire `places` after a read-only period | **L** (5–6d) | E1 | What "private bathroom" means (Story 1 question); private ones visible to the owner only? |
| **E3** | Visits + ratings + trust signals | `visits`, `rating_dimensions` (seed: lighting, cleanliness, smell, trash cleanliness), `visit_ratings`, aggregates (visit count, average per dimension, `last_confirmed_at`) via a database view or trigger; "I went here" button; shown in the detail screen and the map card; one visit per user per bathroom per day | **M–L** (3–5d) | E1 (E2 for "my visits") | Minimum people before showing counts/averages (privacy + credibility); does logging need to be nearby? |
| **E4** | Map-first home | Full-screen map, bottom sheet with the nearest open bathroom first (name, status, distance, ratings, Directions), list one swipe away, same filters; "emergency" path in ≤2 taps | **M** (2–3d) | E0 (E3 to show ratings) | Replaces the list-default decision |
| **E5** | Bathroom layout + accessibility fields | Layout (one single / several singles + how many / one with stalls + how many), step-free, grab bars, single-occupancy/family room, changing table, "customers only / ask for code" access, `location_in_building` | **S–M** (1–2d) on top of E1/E7 | E1; editable via E7 | Final field list |
| **E6** | Public tips + flags | `bathroom_tips` (visible/hidden/removed, helpful count), flag a tip, Ashley's review list for flagged tips | **M** (2–3d) | E1 + E8's admin view | Who can post (signed-in only, recommended) |
| **E7** | Corrections, new bathrooms, moderation | `bathroom_edits` (correction / new / report closed), admin review queue, approve applies the change, "N reports auto-flag possibly closed", freshness line | **L** (4–6d) | E1, profiles/roles | What goes live without review; N for auto-flag |
| **E8** | Duplicates | `duplicate_flags`, automatic "within ~50 m + similar name" flag, merge tool (move visits, ratings, list items, edits; dedupe; recalc; `merged_into`), dismiss | **M–L** (3–4d) | E7 (shares the admin view) | none beyond the doc |
| **E9** | Better place search | Search our own `bathrooms` first, then an external provider; label "needs details"; distance and type in results | **M** (2–3d) | E1 | Provider and cost ceiling; storage terms (Google limits what can be kept beyond place IDs) |
| **E10** | Share lists (accept some or all) | Share link (snapshot of which bathrooms), recipient picks all or some, adds references to their list, shows which ones the sharer has visited (no visit times) | **M** (2–3d) | E2, E3 | Does the recipient need an account? (Recommend: view without, save with) |
| **E11** | Google Maps list import | Upload a Google Takeout export, match or create places as `needs_details`, choose which to add | **M–L** (3–4d), **uncertain** | E1, E9 | **Verify first:** whether Takeout exports include coordinates or only names and links. If only links, each place needs a paid lookup. |
| **E12** | Photos | Upload on a visit, Supabase Storage, strip location metadata, size limit, pending → approved review, detail-screen carousel | **L** (4–5d) | E3, E7's admin view | Who can upload; review before showing (recommended: yes); people-in-photo rule. Free plan storage limit: check before launch. |
| **E13** | Launch checklist | Rate limits on submissions, privacy defaults, backups check, account deletion across all tables, freshness auto-flags, licensing check, analytics (§2.6) | **M** (2–4d) | everything above | Approved edits after account deletion: keep anonymized (recommended) |

**Total:** roughly **40–55 part-time days** for everything. [Assumption: no major rework from late decisions.] E12 photos and E11 import are the most cuttable.

### Not needed for v1
- **PostGIS / loading by area:** at a few thousand bathrooms, loading everything is still fine (Supabase can return them in one call). Revisit when user additions pass ~10k or the map feels slow.
- **"Is it one of these?" on add:** E9's "search our own table first" already gives most of this early.

---

## 4. Cross-reference with TASKS.md

### Open tasks → where they land

| TASKS.md item | Maps to | Notes |
|---|---|---|
| Review Brooklyn hours (52 rows) | Improvement 2 "accuracy of existing entries"; E1 seed | Still worth doing; the fixes carry into `bathrooms`. |
| Better place search | **E9** | Same item; E9 adds "search our own table first". |
| Bathroom layout (several single bathrooms) | **E5** | Becomes a shared fact on `bathrooms`, not a per-user log field. |
| Confirm sync end to end | Done | 2 accounts, 3 places in the account today. Mark done. |
| Lists phase 1 (listed under Next) | Done | Shipped Oct 8; the open entry is stale. Remove. |
| Saving without a confirmation step | §2 conflict 1 + E2/E3 | The pop-up is already gone. The remaining question, "separate saving from logging", is answered by E2 (save = list item) and E3 (log = visit). |
| Easier edit / delete | **E2** | List items get Remove on the card; corrections to facts go through E7. |
| Map view follow-ups (tap the map to add, remember position) | **E4** | Fold into map-first home. |
| Test on a real iPhone | **E13** + now | Do it now; repeat before launch. |
| Launch to friends | Goal: 10 users / 2 contributors | Needs §2.6 to measure. |
| Curated lists | **E10** + `lists.visibility = public` | Lists published by Ashley = public lists. |
| Visit log | **E3** | Same item. |
| Aggregated visits | **E3** | Same item; add the "minimum people" rule. |
| Lists phase 2 (share / import, snapshot copies) | **E10** | Switches from copies to references (§2 conflict 1). |
| Lists phase 3 (public list) | **E1/E10** (public lists) + E7 (Ashley as admin) | The separate spec conversation can be about which lists to publish; the data model is covered. |
| "This info is wrong" report link | **E7** (report closed / wrong) | Same item. |
| Shrink bathrooms.json | **E1** | Moot once the app reads from Supabase. |
| Review hours for other boroughs | Improvement 2 accuracy | Lower priority than user corrections (E7). |
| GitHub Actions Node 20 update | Tech debt | XS; do with E1 since that touches the workflow. |
| Pick main link / custom domain | Done | nycpoops.com is the main link. Turning off GitHub Pages is still open (XS). |

### In improvements.md but not in TASKS.md yet
Photos (E12), public tips (E6), filter by type (E0), hours source line (E0), map-first home (E4), profiles and roles (E1), moderation and the merge tool (E7, E8), Google Maps import (E11), accessibility fields (E5), freshness / `last_confirmed_at` (E3, E7), analytics to measure the goal (§2.6), automated RLS tests (E0).

---

## 5. Suggested sequence toward the current goal (10 regular users, 2 contributors)

**Milestone A: a better emergency tool (~1 week)**: E0 quick wins, E4 map-first home, E9-lite (improve today's search ranking and labels without a new provider). Serves the 8 who just need a bathroom now.

**Milestone B: the contributor loop (~2–3 weeks)**: E1 shared bathrooms, E2 lists + migration, E3 visits and ratings, E5 layout/accessibility, analytics (§2.6). Gives the 2 contributors something that visibly improves the map.

**Milestone C: community and scale (~3–4 weeks)**: E6 tips, E7 corrections + moderation, E8 duplicates, E10 sharing, then E9 full provider, E11 import and E12 photos as demand shows.

**Confidence: Medium.** The order follows the goal: utility first keeps the 8 emergency users; the contributor loop (B) is what the 2 contributors need. The main risk is B's migration (E1–E2) taking longer than sized; mitigation: ship E1 first with the app still reading the JSON file, then switch reads once the table is proven.

## 6. Decisions needed to start

1. ~~References instead of copies~~ **Decided: shared database (references).**
2. ~~Map-first home~~ **Decided: map-first, list toggle.**
3. **What "private bathroom" means**, and whether private ones are visible only to their owner. *Blocks E2.*
4. **Starting rating dimensions** (recommend the four 1–5 ratings). How facts like stalls/layout display is **on hold** until that work starts. *Blocks E3.*
5. ~~Analytics approach~~ **Decided: database counts only.**
6. **Milestone order:** A → B → C, or B first.

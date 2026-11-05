# Spike: bulk-add bathrooms by category (Brooklyn)

Research only, run 2026-10-26. No app code, database or import changes. Answers the Tier 2 item
"Bulk-add bathrooms by category" in `docs/TASKS.md`.

**Question.** Can NYC Poops bulk-add likely-restroom places (museums, hotels, grocery stores,
department stores, Target, gas stations) with enough quality to show them as "Unconfirmed"? Which
sources, at what cost, under what license?

## Short answer

- **Yes, for some categories, but not from one big dump.** No source has restroom data worth using
  (OpenStreetMap tags restrooms on 0 to 13% of these places, depending on category; the others have none). So every import
  is a guess by category. The guess is only good where the category nearly always has a customer
  restroom: Target, big department stores, hotels, big museums. It is weak for grocery stores and
  weakest for gas stations.
- **Location quality varies a lot by source.** In a hand check of 20 places, OpenStreetMap rows were
  right 10 of 14 times; Overture rows that OpenStreetMap doesn't have were right 2 of 6 times.
  The failures are mostly places that closed or moved, not wrong pins.
- **Hours: import none.** Only OpenStreetMap has hours, and 1 of the 6 hours I could check was wrong
  (plus a "24/7" gas station that is permanently closed). This matches the 2026-10-26 decision
  (imports start with hours unknown).
- **License is the real fork in the road.** OpenStreetMap is the best source but is share-alike
  (ODbL): mixing it into the shared `bathrooms` table could oblige us to publish that table under
  ODbL. The other sources have no share-alike. **Recommendation: keep OpenStreetMap out of the
  table for now** and build the first Brooklyn import (~300 places) from official store lists, New
  York State data and Overture, with a hand review. Details and the alternative are below.
- **No paid service and no API key is needed.** Foursquare needs a Hugging Face account and adds
  nothing the others don't, so skip it.

## Summary table (Brooklyn)

Counts are places in Brooklyn per source and category, pulled 2026-10-26. "Hours" = has an hours
field; "Restroom tags" = has any restroom field. Full method and queries are at the end.

| Category | OpenStreetMap | Overture Places | Foursquare OS Places ¹ | NYC / NY State open data | Ground truth |
|---|---|---|---|---|---|
| Museums | 27 (hours 12, restroom tag 1) | 75 (41 with confidence ≥ 0.9) | 91 | 12 (2014 list, stale) | — |
| Hotels | 94 (hours 4, restroom tag 4) | 215 (128) | 209 | 180 hotel buildings, **no names** (tax lots) | — |
| Grocery stores ² | 366 supermarkets (hours 236, restroom tag 9) | 1,950 "grocery store" (956), mostly bodegas | 1,563 | **224 food stores ≥ 10,000 sq ft** (180 without pharmacies and dollar stores) | — |
| Department stores ³ | 30 (hours 19, restroom tag 4) | 96 (61) | 239 | none | — |
| Target | **10 (hours 10, restroom tag 1)** | 7 (7) | 11 | none | **10** (target.com) |
| Gas stations | 167 (hours 63, restroom tag 0) | 350 (243) | 520 | **196** licensed stations with tanks in service | ~196 (state data) |
| **Hours format** | `opening_hours` syntax; a strict converter reads 92% of them into our hours model | none | none (hours are in the paid API) | none | |
| **IDs** | node/way id (stable unless remapped) | GERS id (UUID, stable since 2025-06) | `fsq_place_id` | license / program number | |
| **Update cadence** | minutely (live) | monthly (latest 2026-10-21.0) | monthly upstream; public mirror stuck at 2025-02-06 | NY food stores refreshed 2026-10-14; gas daily | |
| **License** | ODbL (share-alike) | CDLA-Permissive-2.0 (most rows), Apache-2.0 (Foursquare rows), CC0 | Apache-2.0 | NYC / NY open data terms (free use) | |
| **Cost / key** | free, no key; fair-use limits | free, no key (S3 download) | free; Hugging Face account + terms | free, no key | |

¹ Foursquare counts exclude rows with `date_closed`; only 35% of those were refreshed since 2024.
² OpenStreetMap `shop=supermarket`; Overture `*grocery_store`; Foursquare "Grocery Store" + "Supermarket".
³ Excluding Target, which OpenStreetMap tags as a department store.

Overlap: of the OpenStreetMap places, Overture also has (same category, within 100 m, similar
name) museums 16/27, hotels 70/94, grocery 209/366, department stores 20/30, Target 8/10, gas 108/167.

## Sources, one by one

### OpenStreetMap (Overpass API)

- **Coverage.** Best named, best placed and freshest (median last edit 2024-02; Target and department
  stores mostly 2024+). Matches the official Target list exactly (10/10). Weaker on gas stations
  (40 of 167 have no name) and small museums.
- **Hours.** `opening_hours` on 64% of supermarkets, 100% of Targets, 63% of department stores,
  38% of gas stations, 44% of museums, 4% of hotels. Our parser (`src/lib/hours.js`) reads the city's
  free text ("9:00am-5:00pm", one line per weekday), not this syntax. A strict converter (in
  `bulk-add-spike/osm_ohparse.py`: `24/7`, day ranges, times, `off`; anything else rejected) maps
  92% of them into the same hours model. The rest use public-holiday rules, date exceptions
  ("Dec 25 off"), sunset times (kosher stores) or free-text comments. Days the source doesn't
  mention stay unknown, never closed or open.
- **Restroom tags.** `toilets=*` on 19 of 694 places; `toilets:access=customers` on 4 hotels,
  `permissive` on 5 supermarkets, `public` on 2; `toilets:wheelchair=yes` on 1. Nothing on gas
  stations. Too sparse to filter on, but worth keeping as a hint.
- **Gotcha found.** Querying the area by name ("Kings County") also returns Kings County,
  California. The saved query uses the relation id (369518).
- **License.** ODbL 1.0, see "OpenStreetMap share-alike" below.
- **Cost and limits.** Free, no key. The public Overpass server asks for under ~10,000 requests and
  ~1 GB a day; it returned "at capacity" once during this spike, so an import should retry.
  One Brooklyn query is under 500 KB.

### Overture Maps Places

- **Coverage.** Two to five times more rows than OpenStreetMap, but noisier: "Museum of Natural
  History" placed in Williamsburg, The Peninsula (a Manhattan hotel) inside Brooklyn, a sukkah
  shop and an equipment company filed as hotels, Bed Bath & Beyond (closed 2023) as a department
  store, and 114 near-duplicate pairs among grocery stores. Missing 3 of the 10 Targets
  (Atlantic Terminal, Bensonhurst, Bay Parkway).
- **Confidence score.** Helps but doesn't save it: the 6 Overture-only places in the hand check all
  had confidence ≥ 0.91 and only 2 were right (one closed store had 0.99).
- **Hours / restrooms.** Neither exists in the schema (release 2026-10-21.0).
- **IDs.** GERS ids, UUIDs since release 2025-06-25.0, with a stability commitment, a per-release
  changelog and bridge files back to source ids.
- **License.** Per row, in `sources`: Meta, Microsoft, BrightQuery and others under
  CDLA-Permissive-2.0; Foursquare rows under Apache-2.0; AllThePlaces under CC0. None is
  share-alike. CDLA-Permissive needs the license text kept with the data when we share the data;
  Apache-2.0 needs Foursquare's NOTICE. Overture asks for "© Overture Maps Foundation" credit.
- **Cost.** Free, no key, parquet on public S3/Azure. The Brooklyn extract is 104,082 places, 19 MB,
  ~1 minute with DuckDB (a dev-only tool, not an app dependency).

### Foursquare Open Source Places

- **Access.** The official copy on Hugging Face is gated: you accept terms and share contact
  details, and accepting for an organization lets Foursquare use its name and logo. That's an
  account Ashley would have to create (I didn't). A public mirror on Source Cooperative (Fused) is
  stuck at the 2025-02-06 release; I used that for counts.
- **Coverage.** Largest counts, but the stalest: of 1,563 open grocery rows, 546 were refreshed
  since 2024. "Department store" covers 239 places, mostly discount and shoe stores.
- **Hours / restrooms.** None in the open data. Hours are part of Foursquare's paid Places API
  (**paid, needs a key: not recommended**).
- **License.** Apache-2.0; ship their NOTICE text with the data. Overture already includes some
  Foursquare rows, so it adds little on top.

### NYC and NY State open data

- **NY State "Retail Food Stores"** ([data.ny.gov 9a8c-vfzj](https://data.ny.gov/Economic-Development/Retail-Food-Stores/9a8c-vfzj)):
  every licensed food store, with **square footage**, license number (stable id), address and
  usually coordinates. 224 Brooklyn stores ≥ 10,000 sq ft; 180 after dropping pharmacies, dollar
  stores, BJ's and Target. 111 of those have an OpenStreetMap supermarket within 120 m. The size
  field is the only reliable way I found to tell a supermarket from a bodega. Names are upper case
  ("KEY FOOD"); 16 of 180 lack coordinates.
- **NY State DEC "Bulk Storage Facilities"** ([data.ny.gov pteg-c78n](https://data.ny.gov/Energy-Environment/Bulk-Storage-Facilities-in-New-York-State/pteg-c78n)):
  196 Brooklyn "Retail Gasoline Sales" sites with a tank in service. Good as a count (it shows
  Overture and Foursquare overstate gas stations 2–3×), poor for display: names are company names
  ("1249 FUEL STOP INC"), not brands.
- **NYC DOF "Hotels Properties Citywide"** ([tjus-cn27](https://data.cityofnewyork.us/City-Government/Hotels-Properties-Citywide/tjus-cn27)):
  hotel tax lots (180 Brooklyn buildings), owner names only. Not usable for names.
- **Museums.** NYC's museum list ([fn6f-htvy](https://data.cityofnewyork.us/Recreation/MUSEUM/fn6f-htvy))
  dates from 2014 (12 Brooklyn rows); DCLA's cultural organization list has no "museum" type.
- None has hours or restroom fields. NYC and NY State open data are free to use with no
  share-alike.

## Hand check (20 places)

Sample drawn at random (seed 2026) by `bulk-add-spike/sample.py`: 14 named OpenStreetMap places
across the six categories, plus 6 Overture places with confidence ≥ 0.9 that OpenStreetMap doesn't
have. Checked 2026-10-26 (a Monday) on Google Maps and, for Target, target.com. Hours were compared
for the full week on target.com, otherwise for Monday only (what Google Maps shows by default).

| # | Source | Category | Place | Exists, at that spot? | Hours (source vs check) |
|---|---|---|---|---|---|
| 1 | OSM | Museum | Spark Brooklyn Children's Museum Annex, 1 John St | ❌ permanently closed | — |
| 2 | OSM | Museum | MoCADA, 80 Hanson Pl | ❌ moved to 10 Lafayette Ave | — |
| 3 | OSM | Hotel | La Quinta Brooklyn Downtown, 531 3rd Ave | ✅ | — |
| 4 | OSM | Hotel | The Baltic Hotel, 489 Baltic St | ✅ | — |
| 5 | OSM | Hotel | Days Inn Borough Park, 1118 36th St | ✅ | — |
| 6 | OSM | Grocery | Key Food, 492 Myrtle Ave | ✅ | ❌ source says Mon to 11pm, Google says 9pm |
| 7 | OSM | Grocery | Frank & Sal Italian Market, 8008 18th Ave | ✅ | ✅ Mon to 6:30pm |
| 8 | OSM | Grocery | Breadberry, 1689 60th St | ✅ | no hours in source |
| 9 | OSM | Department | Peoples Department Store, 4 Ralph Ave | ✅ | ✅ Mon to 7:30pm |
| 10 | OSM | Department | Marshalls, 1710 E 14th St | ✅ | ✅ Mon to 9:30pm |
| 11 | OSM | Target | Target Kings Hwy, 5200 Kings Hwy | ✅ | ✅ 8am–10pm daily |
| 12 | OSM | Target | Target Brooklyn Junction, 1598 Flatbush Ave | ✅ | ✅ 8am–11pm daily |
| 13 | OSM | Gas | BP, 4001 4th Ave | ❌ permanently closed | ❌ source says 24/7 |
| 14 | OSM | Gas | Citgo, 571 Coney Island Ave | ⚠️ a station is there, but as "Allegiance"; Citgo listing closed | — |
| 15 | Overture | Museum | "Museum of Natural History", Williamsburg | ❌ no such museum (AMNH is in Manhattan) | — |
| 16 | Overture | Hotel | Williamsburg Guest House, 541 Lorimer St | ❌ Google's pin is ~1 km away, near N 6th St | — |
| 17 | Overture | Hotel | Howard Johnson by Wyndham, 524 Rockaway Ave | ✅ | — |
| 18 | Overture | Grocery | Busy Bee Food Exchange, 185 Nassau Ave | ❌ permanently closed (confidence 0.99) | — |
| 19 | Overture | Department | Shoppers World, 60 Graham Ave | ✅ | — |
| 20 | Overture | Gas | Speedway, 1885 Atlantic Ave | ❌ not found; nearby stations are BP and Sunoco | — |

**Hit rate: 12 of 20 (60%).** OpenStreetMap 10 of 14 (71%; 11 of 14 if a rebranded station
counts); Overture-only 2 of 6 (33%). Hours: 5 of 7 sources with hours were right, counting the
closed "24/7" station as wrong. Where a place existed, the pin was always at the right spot; errors
are closures, moves and phantom places. Small samples: treat these as direction, not rates.

## OpenStreetMap share-alike (ODbL): what it would mean for `bathrooms`

Not legal advice; based on the ODbL text and the OSM Foundation's community guidelines.

- Showing OSM data in the app is a "Produced Work": it needs a visible "© OpenStreetMap
  contributors" credit (the map already shows one for tiles).
- The shared `bathrooms` table would become a **Derivative Database** as soon as OSM rows are
  mixed in and **matched or de-duplicated** against city and user rows (the guidelines say merging
  another list with OSM and removing duplicates is not covered by the "collective database"
  safe harbor). Because the app uses it publicly, we'd then have to offer that database, or at
  least the OSM-derived part and everything merged with it, under ODbL to anyone who asks.
- User edits to OSM rows (a corrected name, hours, a "restroom: yes") make those rows derivative
  too. Ratings and visits that only point at a row (by id) can stay separate.
- In practice: we'd publish a periodic ODbL dump of the Public bathrooms (they are already readable
  by anyone through the app), credit OSM, and accept that the table can never mix in data with
  incompatible terms (for example anything copied from Google Maps).
- A clean alternative exists for the categories that matter, so the recommendation below avoids OSM
  for now. Using OSM later stays possible; taking it out again after users have edited OSM rows
  would be hard.

## Recommendation

| Category | Do it? | Source | Brooklyn size | Confidence |
|---|---|---|---|---|
| Target | ✅ first | Hand-enter from Target's store directory (official, all 10) | 10 | High that each exists; medium that the restroom is open to customers |
| Department stores | ✅ | Big chains only (Macy's, Kohl's, JCPenney, Burlington, Marshalls, TJ Maxx, Nordstrom Rack), hand-entered from each chain's store locator | ~18–25 | Medium |
| Hotels | ✅ | Overture `basic_category = hotel`, confidence ≥ 0.9, then a hand review | ~90–130 after review | Medium |
| Museums | ✅ small | Hand-picked list of real public museums (~15–20: Brooklyn Museum, Children's Museum, Transit Museum, Weeksville, Wyckoff House, Coney Island Museum…); skip "by appointment" and tiny ones | ~15–20 | High that they exist; restrooms are behind admission |
| Grocery stores | ⚠️ later, as a test | NY State food stores ≥ 10,000 sq ft (no pharmacies or dollar stores) | ~180 | Low that customers can use a restroom. Try 30–50 big stores first and look at the "Is there a restroom here?" answers before importing the rest |
| Gas stations | ❌ skip in Brooklyn | — | (196 exist) | Medium. No source tags restrooms, most are small kiosks, and 2 of 3 checked were closed or renamed |

**Why not just use OpenStreetMap?** It had the best hit rate. If Ashley is fine with ODbL for the
shared table (see above), switch hotels and department stores to OSM and skip most of the hand
review. That's a decision for Ashley, not a technical one.

**How imports map to `bathrooms`** (columns from `supabase/migrations/20261014192910_create_bathrooms.sql`
and `20261024175301_lists_and_user_bathrooms.sql`):

| Column | Value |
|---|---|
| `id` | source prefix + source id, e.g. `tgt-3326`, `nysfood-773630`, `ovt-a2e14077…` (fits the id check) |
| `name`, `address`, `lat`, `lng`, `borough` | from the source; title-case NY State names |
| `venue_type` | `museum`, `hotel`, `store` (Target, department, grocery). Gas would need `other` or a new value |
| `access` | `customers_only` |
| `status` | `unverified` |
| `hours` | `null` (hours unknown). Keep any source hours text in `source_data` as a hint only |
| `visibility` / `created_by` | `public` / null |
| `source` | Needs a new value such as `import` (today: `seed`, `user`, `admin`), so the app can tell imports from city restrooms (both start `unverified`) and show "Unconfirmed" plus "Is there a restroom here?". That is a migration, so it belongs with whoever owns database changes (now the Tier 1 session) |
| `source_data` | `{ provider, provider_id, license, fetched_at, category, raw }` for attribution and re-runs |

**Duplicate risk against existing rows: low.** Within 60 m of a Brooklyn city restroom: 4 OSM
museums (Center for Brooklyn History is the same place as the library row; Old Stone House, inside
Washington Park, may share the park's restroom), 1 hotel, 9 supermarkets and 3 gas stations (all different places next to a park or library).
Only 5 Public user-added bathrooms exist so far. The bigger risk is duplicates *inside* a source
(114 near-duplicate grocery pairs and 9 hotel pairs in Overture). Rule for the import: same category
within 75 m and a similar name = one place; anything within 60 m of an existing row goes to a review
list instead of being imported.

**Rough size of the import work** (part-time build days, as in `docs/IMPROVEMENTS-SCOPING.md`):

| Piece | Size |
|---|---|
| Import script: fetch, filter, map, de-duplicate, write SQL, review list; re-runnable per borough | M (2–3 days) |
| Hand curation for Brooklyn (Target, chains, museums, hotel review) | S (~1 day) |
| Database: `source = import` (or similar) and a "restroom here?" fact | XS (½ day), database owner |
| App: "Unconfirmed" label, "Is there a restroom here?", hide after two "no" answers | S–M, overlaps Tier 1 confirm-and-correct |
| **Total, Brooklyn** | **~4–5 days**; each further borough ~1 day (mostly curation) |

## Update, 2026-10-26: first Brooklyn batch, in hand review

Ashley chose department stores, hotels and **fast food** (new; not in the six categories above),
plus Target, with no OpenStreetMap data. `bulk-add-spike/build_candidates.py` builds the list:

| Group | Source | Rule | Candidates |
|---|---|---|---|
| Target | Target's store directory (ids), Foursquare addresses and pins | all 10 Brooklyn stores | 10 |
| Department stores | Overture | Macy's, Kohl's, JCPenney, Burlington, Marshalls, T.J. Maxx, Nordstrom Rack, Century 21; confidence ≥ 0.7 | 25 |
| Hotels | Overture | `basic_category = hotel`, confidence ≥ 0.9 | 121 |
| Fast food and coffee | Overture | McDonald's, Burger King, Wendy's, Popeyes, KFC, Taco Bell, Chipotle, Shake Shack, Chick-fil-A, Panera, White Castle, Starbucks; confidence ≥ 0.7. Dunkin' and Subway left out (often counters with no restroom) | 311 |

Only places Overture lists as open. Same chain within 75 m = one place. 48 are flagged for a
closer look (hotel names that don't look like hotels, low confidence, within 60 m of a city
restroom). Ashley reviews them in a private review page (Keep / Drop / Not sure, drop reason,
"restroom for customers?", corrected name, note); unflagged chain rows can be kept in one step
per category. The import itself waits for that review and for the database pieces under
"How imports map to `bathrooms`".

## What I couldn't verify

- **Whether customers can actually use the restroom** at any of these places. No source says, and
  the hand check only confirmed the places exist. This is the biggest unknown, especially for
  grocery stores and gas stations.
- Full-week hours outside Target (Google Maps showed Monday only), and Google Maps itself can be
  wrong.
- Exact license obligations: the ODbL reading above follows the OSM Foundation's guidelines, but
  it isn't legal advice. Foursquare's current Hugging Face terms beyond what the page shows.
- Foursquare's current release (I only had the February 2025 mirror).
- NY State food store totals for Brooklyn (the aggregate query was refused; the ≥ 10,000 sq ft list
  downloaded fine).
- The 20-place sample is small; the hit rates are ±20 points or so.

## Sources

- OpenStreetMap: [Overpass API](https://overpass-api.de/), [usage guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html),
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), [copyright and attribution](https://www.openstreetmap.org/copyright),
  [Collective Database guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline),
  [Brooklyn relation 369518](https://www.openstreetmap.org/relation/369518)
- Overture: [release catalog](https://stac.overturemaps.org/catalog.json) (2026-10-21.0),
  [attribution and licenses](https://docs.overturemaps.org/attribution/), [GERS ids](https://docs.overturemaps.org/gers/),
  [CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/)
- Foursquare: [FSQ OS Places on Hugging Face](https://huggingface.co/datasets/foursquare/fsq-os-places) (gated),
  [public mirror on Source Cooperative](https://source.coop/fused/fsq-os-places),
  [announcement](https://foursquare.com/resources/blog/products/foursquare-open-source-places-a-new-foundational-dataset-for-the-geospatial-community/)
- NY State: [Retail Food Stores](https://data.ny.gov/Economic-Development/Retail-Food-Stores/9a8c-vfzj),
  [Bulk Storage Facilities](https://data.ny.gov/Energy-Environment/Bulk-Storage-Facilities-in-New-York-State/pteg-c78n)
- NYC: [Hotels Properties Citywide](https://data.cityofnewyork.us/City-Government/Hotels-Properties-Citywide/tjus-cn27),
  [MUSEUM (2014)](https://data.cityofnewyork.us/Recreation/MUSEUM/fn6f-htvy),
  [Borough Boundaries](https://data.cityofnewyork.us/City-Government/Borough-Boundaries/gthc-hcne)
- Ground truth: [Target store directory, New York](https://www.target.com/store-locator/store-directory/new-york); Google Maps for the hand check

## Re-running it

Everything is in [`bulk-add-spike/`](bulk-add-spike/). Work in an empty folder outside the repo
with subfolders `osm/`, `overture/`, `fsq/`, `nyc/`, and Python 3 with `duckdb` (dev only:
`python3 -m venv venv && venv/bin/pip install duckdb`).

1. **Borough boundary:**
   `curl -s "https://data.cityofnewyork.us/resource/gthc-hcne.geojson" -o nyc/boroughs.geojson`
2. **OpenStreetMap:**
   `curl -s --data-urlencode data@osm-brooklyn.overpassql https://overpass-api.de/api/interpreter -o osm/brooklyn.json`,
   then `python3 osm_analyze.py osm/brooklyn.json <path to bulk-add-spike>` for the per-category
   counts (hours, parseable hours, restroom tags).
   ```
   area(id:3600369518)->.bk;   // Kings County, NY. Not by name: Kings County, CA exists too.
   ( nwr["tourism"="museum"](area.bk);  nwr["tourism"~"^(hotel|motel)$"](area.bk);
     nwr["shop"="supermarket"](area.bk); nwr["shop"="department_store"](area.bk);
     nwr["brand:wikidata"="Q1046951"](area.bk);  nwr["amenity"="fuel"](area.bk); );
   out center tags meta;
   ```
3. **Overture:** run `overture-extract.sql` in DuckDB (reads
   `s3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/*`, Brooklyn bounding
   box, clipped to the borough), then `overture-categories.sql` for the category view.
4. **Foursquare:** `fsq-extract.sql` (public mirror, release 2025-02-06), then `fsq-categories.sql`.
5. **NYC / NY State** (Socrata, no key):
   - Food stores ≥ 10,000 sq ft: `https://data.ny.gov/resource/9a8c-vfzj.json?$query=SELECT * WHERE county="KINGS" AND estab_type like "%A%" AND square_footage::number >= 10000 LIMIT 5000`
   - Gas: `https://data.ny.gov/resource/pteg-c78n.json?$query=SELECT * WHERE county="Kings" AND site_type_name="Retail Gasoline Sales" AND site_status_name="Active" LIMIT 5000`, then count distinct `program_number` where `tank_status = "In Service"`
   - Hotels: `https://data.cityofnewyork.us/resource/tjus-cn27.json?$query=SELECT * WHERE borough="BROOKLYN" AND taxyear="2027" LIMIT 5000`, distinct `bin`
6. **Overlap, duplicates and the hand-check sample:** `python match.py <repo>` and
   `python sample.py <repo>` (needs `public/data/bathrooms.json` from the repo).
7. **Review candidates (first batch):** run `fsq-categories.sql` first, then `python build_candidates.py <repo> > candidates.json`.

# MVP Spec: NYC Bathroom Tracker

Source spec: Bathroom Map Tracker: Product Spec (private Google Doc)
Scope locked 2026-10-08. Audience: personal/friends tool.

## User problems

1. Find a bathroom near me **now** (urgent: ostomy bag, pregnancy).
2. Know what to expect before I walk in: public or private, stalls, accessibility, open right now.
3. Route there with Google Maps.
4. Save places I like (including private ones) and my notes about them.

## MVP scope

1. **Public data:** NYC Open Data, all boroughs loaded (users near borough lines), Brooklyn hours hand-reviewed.
2. **Location:** GPS by default; zip code fallback if location is denied.
3. **Radius:** 0.25 / 0.5 / 1 mi walking distance, default 0.5. Always show the nearest 5 even if outside the radius.
4. **Status (accuracy first):**
   - Open: only when structured hours confirm it right now, in New York time
   - Hours unknown: no hours, or unparseable
   - Hours vary / Seasonal: may be closed; show the city's original text
   - Greyed out: Closed, Not Operational, Closed for Construction, Not open yet, Closed now
   - Sort: Open → Unknown/Varies → Greyed out, then by distance
   - Show "City data last updated <date>"
5. **Filters:** Public vs. My places. Tags: accessibility, multi-stall/single-stall, changing stations.
6. **My places (private bathrooms = personal list only):**
   - Add via "I'm here now" (current location) or address search with suggestions
   - Fields: name, location, free-text note; star a public restroom to save it too
   - Edit, delete
   - Kept between visits (stored on the phone)
7. **Directions:** tap any listing to open Google Maps walking directions (`/maps/dir/?api=1&destination=lat,lng&travelmode=walking`).
8. **Keeping saved places:** Add to Home Screen prompt (iOS clears website data after 7 days without use otherwise), a request that the browser store data permanently, and export/import backup. In-app note that saved places live on this phone only.

## Out of scope for MVP

- Private bathroom database (Geoapify places, chain lists)
- Tapping a spot on a map to add a place; pasting Google Maps links
- Shared/public notes, cleanliness ratings, moderation, accounts, analytics
- Map view (list only)

## Follow-ups (priority order)

1. **Saved places last forever** (top priority after MVP): stored on a server and tied to a recoverable identity, deleted only when the user chooses. Proposed: Supabase + magic-link email; app still works without signing in. Decision pending at kickoff.
2. "This info is wrong" report link.
3. Map view / tap a spot on a map to add a place.

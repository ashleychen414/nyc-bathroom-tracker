# MVP Spec: NYC Bathroom Tracker

Source spec: Bathroom Map Tracker: Product Spec (private Google Doc)
Scope locked 2026-10-08. UX confirmed 2026-10-08 on the [UX canvas](https://claude.ai/artifact/TaZJrd5tawKGG1meXcGfdL). Audience: personal/friends tool.

## User problems

1. Find a bathroom near me **now** (urgent: ostomy bag, pregnancy).
2. Know what to expect before I walk in: public or private, stalls, accessibility, open right now.
3. Route there with Google Maps.
4. Save places I like (including private ones) and my notes about them.

## MVP scope

1. **Public data:** NYC Open Data, all boroughs loaded (users near borough lines), Brooklyn hours hand-reviewed.
2. **Navigation:** two tabs, Nearby and My places. Detail and form screens hide the tabs and have a back/cancel.
3. **Location:** first launch explains why, then asks for GPS. "Enter a zip code instead" is always available. If location is off, the app uses the zip code's center and marks distances as approximate (~).
4. **Nearby list (core experience): public restrooms and your places, mixed.**
   - Radius 0.25 / 0.5 / 1 mi, default 0.5 (remembered)
   - Filter chips: All · Public · My places, plus toggles Hide closed (on by default), Open now, Accessible (fully accessible only), Changing station
   - Fewer than 5 inside the radius: fill to 5 with the nearest outside it, under an "Outside X mi" label. Nothing inside: say so, offer "Widen to …", plus "Include unknown hours" (Open now on) or "Show closed too" (Hide closed on)
   - Card: name, distance, status badge, "Your place" badge if saved, type, up to 3 tags, your emoji log if saved. Tap → detail
   - Footer: "City data last updated <date>"
5. **Status (accuracy first), same rules for public restrooms and your places:**
   - Open: only when structured hours confirm it right now, in New York time
   - Hours unknown: no hours, or unparseable (your places with no hours land here)
   - Hours vary / Seasonal: may be closed; show the city's original text
   - Greyed out: Closed, Not Operational, Closed for Construction, Not open yet, Closed now. **Hidden by default** via a "Hide closed" filter chip that starts on (2026-10-08); tap it to show them.
   - Sort: Open → Unknown/Varies → Greyed out, then by distance
6. **Restroom detail:** name, type · operator · distance, status, Directions, hours (structured + the city's original text), what to expect (accessibility, restroom type, changing station, season), and a "Your notes" card. "Add notes" saves the restroom to My places and opens the log; if already saved it shows your log and "Edit notes".
7. **My places:** your own places + public restrooms you saved, nearest first.
   - Add via "I'm here now" or address search with suggestions; name required
   - **Hours (your own places only):** Don't know (default) · 24 hours · Set hours (same every day, or per day with Closed). Times are required when Set hours is chosen. Saved public restrooms use the city's hours.
   - Log (all optional): 💡 lighting, 🧼 cleanliness, 🌸 smelly vibes (1-5), stalls Y/N + how many, trash cans Y/N, 🗑️ trash cleanliness (hidden if no trash cans), notes
   - Edit, delete (with confirmation). Stored on the phone.
8. **Directions:** Google Maps walking directions (`/maps/dir/?api=1&destination=lat,lng&travelmode=walking`) from detail and My places cards.
9. **Keeping saved places:** "Add to Home Screen" sheet after the first save (again after the 3rd if not installed), a silent request that the browser store data permanently, and backup (export a .json file; import merges by place id, newer edit wins). In-app note that saved places live on this phone only.

## Out of scope for MVP

- Private bathroom database (Geoapify places, chain lists)
- Tapping a spot on a map to add a place; pasting Google Maps links
- Shared/public notes, cleanliness ratings, moderation, accounts, analytics
- Map view (list only)

## Follow-ups (priority order)

1. **Saved places last forever** (top priority after MVP): stored on a server and tied to a recoverable identity, deleted only when the user chooses. Proposed: Supabase + magic-link email; app still works without signing in. Decision pending at kickoff.
2. "This info is wrong" report link.
3. Map view / tap a spot on a map to add a place.

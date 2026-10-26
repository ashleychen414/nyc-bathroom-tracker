# Feedback log

Log feedback as close to verbatim as possible. One entry per piece of feedback.
Triage: link the resulting task in `TASKS.md`, or mark `won't do` with a reason.

| Date | Who | Device | Feedback (verbatim) | Category | Triage |
|---|---|---|---|---|---|
| 2026-10-08 | Early tester (via Ashley) | ? | "i wish there was a map view, rather than list view" | feature request | TASKS.md → Next: Map view |
| 2026-10-08 | Early tester (via Ashley) | ? | "the save confirmation screen is confusing i wish i could just have it saved all the time" | UX | TASKS.md → Next: Saving without a confirmation step (needs clarifying which screen) |
| 2026-10-08 | Ashley | Mac (localhost) | Sign in button on the "Keep your places forever" banner wraps onto two lines | bug | Fixed same day (button no longer shrinks/wraps) |
| 2026-10-08 | Ashley | ? | "finding a restaurant/private location is hard - the search results in the current my places section is not very good" | UX | TASKS.md → Next: Better place search |
| 2026-10-08 | Ashley | ? | "some private locations have multiple, one stall bathrooms - that is tracking case that is not captured but necessary in NYC. this is different than one bathroom, many stalls" | feature request | TASKS.md → Next: Bathroom layout |
| 2026-10-16 | Ashley (note on the landing screen mockup) | design mockup | "Is there a quick onboarding experience here, like "I have medical/accessibility needs, versus pregnant/mom looking with toddlers, etc." If they onboard with a persona of needs, the rest of the experience could b…" [rest cut off in the screenshot] | feature request | TASKS.md → Later: Needs-based onboarding (added after the landing-screen PR merges) |
| 2026-10-24 | Tester (via Ashley) | iPhone Safari | Screenshot only, no message. Nearby (List view) showed: "Location is off for this site, so distances are from the middle of your zip code. Use my location", an empty Zip code field, and "Enter a zip code to see restrooms near it." with nothing else. | UX | Dead end: location was denied for the site, no saved zip, and iOS never re-asks, so "Use my location" did nothing. Fixed in the blocked-location PR: zip field first and focused, "Enter a zip code above…", and a "Turn location back on" how-to for Safari, Home Screen app and other browsers (opens by itself if a tap is refused). |
| 2026-10-26 | Ashley | ? | "As a user, when I tap on a bathroom, there's not enough context to know where the bathroom is. Ex: "Penn Station LIRR Restroom" is too broad. I'd want to know where in Penn Station the restrooms are" | UX | TASKS.md → Next, Tier 1: Where inside? |

Categories:
- **bug**: something broke
- **data accuracy**: wrong hours, wrong status, a restroom that doesn't exist (highest priority, given the accuracy-first principle)
- **UX**: confusing or slow
- **feature request**: something new

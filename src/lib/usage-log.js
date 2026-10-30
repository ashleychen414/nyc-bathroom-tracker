// Anonymous usage log (Supabase table public.usage_events), so we can see whether people look at a
// restroom, get directions, go, and fix what's wrong (Ashley, 2026-10-28). Database counts only,
// like location-log.js.
//
// A row holds only: the event, where in the app (place), the restroom, a random id for this app
// open (session), the platform word and the app version. Never a user or phone id, coordinates or
// zip. The session id lives only in memory, so the next open gets a new one. Sent with the public
// key only, even when signed in. Fire and forget: never blocks, never throws, skips when offline.

import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';
import { APP_VERSION } from '../version.js';
import { currentPlatformLabel } from './device.js';

export const EVENTS = [
  'restroom_view', 'directions', 'went_here', 'rating_saved', 'fact_answer', 'confirm_answer',
  'edit_open', 'edit_save', 'edit_cancel',
  'report_open', 'report_send', 'report_cancel',
  'feedback_open', 'feedback_send', 'feedback_cancel',
];
export const PLACES = ['page', 'map', 'list', 'sheet'];
const PLATFORMS = ['ios-safari', 'ios-homescreen', 'ios-other-browser', 'android', 'desktop', 'other'];

// The row to send, or null if any value is outside what the table accepts.
export function usageEvent(event, { bathroomId = null, place = null } = {}, { session, platform, version = APP_VERSION }) {
  if (!EVENTS.includes(event) || (place !== null && !PLACES.includes(place)) || !PLATFORMS.includes(platform)) return null;
  if (bathroomId !== null && (typeof bathroomId !== 'string' || bathroomId.length > 64)) return null;
  return { event, place, bathroom_id: bathroomId, session_id: session, platform, app_version: version || null };
}

// Exported for tests; the app uses logUsage below.
export function createUsageLog({ fetch = globalThis.fetch, online = () => navigator.onLine !== false, platform, session = crypto.randomUUID(), version = APP_VERSION } = {}) {
  return (event, details) => {
    try {
      const row = usageEvent(event, details, { session, platform: platform(), version });
      if (!row || !online()) return false;
      fetch(`${SUPABASE_URL}/rest/v1/usage_events`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(row),
        keepalive: true, // Directions leaves the page for the maps app: still send it
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  };
}

export const logUsage = createUsageLog({ platform: currentPlatformLabel });

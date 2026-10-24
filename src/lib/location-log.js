// Anonymous log of location outcomes (Supabase table public.location_events), so we can see per
// platform whether "allow location" works and spot a deploy that breaks it. Database counts only:
// no third-party analytics (decided 2026-10-14).
//
// A row holds only: trigger, permission before, result, platform word and app version. Never
// coordinates, accuracy, user id, zip or the user agent string. Sent with the public key only,
// even when signed in, so a row can't be tied to an account. Fire and forget: never blocks,
// never throws, skips when offline, and at most one row per trigger per page load.

import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';
import { APP_VERSION } from '../version.js';

const ALLOWED = {
  trigger: ['startup', 'button', 'welcome'],
  permission_before: ['granted', 'prompt', 'denied', 'unknown'],
  result: ['granted', 'denied', 'timeout', 'unavailable', 'unsupported'],
  platform: ['ios-safari', 'ios-homescreen', 'ios-other-browser', 'android', 'desktop', 'other'],
};

// The row to send, or null if any value is outside what the table accepts.
export function locationEvent({ trigger, permissionBefore, result, platform }, version = APP_VERSION) {
  const row = { trigger, permission_before: permissionBefore, result, platform, app_version: version || null };
  return Object.entries(ALLOWED).every(([key, values]) => values.includes(row[key])) ? row : null;
}

// Exported for tests; the app uses logLocation below.
export function createLocationLog({ fetch = globalThis.fetch, online = () => navigator.onLine !== false, version = APP_VERSION } = {}) {
  const sent = new Set();
  return (outcome) => {
    try {
      const row = locationEvent(outcome, version);
      if (!row || sent.has(row.trigger) || !online()) return false;
      sent.add(row.trigger);
      fetch(`${SUPABASE_URL}/rest/v1/location_events`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(row),
        keepalive: true, // still sent if the page reloads right away (the Reload button)
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  };
}

export const logLocation = createLocationLog();

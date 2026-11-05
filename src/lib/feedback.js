// "Send feedback": free text saved to Supabase (public.feedback) for later analysis (Ashley,
// 2026-10-28). Anonymous, like the usage log: only the message, the restroom page it came from,
// the platform word and the app version. Sent with the public key only, even when signed in.

import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';
import { APP_VERSION } from '../version.js';
import { currentPlatformLabel } from './device.js';

export const MAX_FEEDBACK = 2000;

// The row to send, or null when there's nothing to send. Pure, for tests.
export function feedbackRow(message, { bathroomId = null, platform, version = APP_VERSION }) {
  const text = (message ?? '').trim();
  if (!text) return null;
  return { message: text.slice(0, MAX_FEEDBACK), bathroom_id: bathroomId, platform, app_version: version || null };
}

// Resolves when saved; rejects with a message to show.
export async function sendFeedback(message, bathroomId = null) {
  const row = feedbackRow(message, { bathroomId, platform: currentPlatformLabel() });
  if (!row) throw new Error('Write something first.');
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch {
    throw new Error("Couldn't reach NYC Poops. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(`Couldn't send it (${res.status}). Try again.`);
}

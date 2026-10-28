// Confirm and correct any bathroom (Tier 1): "Suggest an edit", "Report closed", "Was it open?",
// "Hours right?", and undo. Everything goes through database functions (migration
// 20261026210000_bathroom_edits.sql) and goes live at once, for everyone.
// Works signed out: each phone keeps a random id of its own, so edits can be counted per person
// and undone from the same phone. Signed in, the account counts too (undo from any phone).

import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';
import { currentUser, authedFetch } from './auth.js';
import { FACTS, factLabel } from './facts.js'; // facts.js imports deviceId from here; both are used only inside functions

const DEVICE_KEY = 'nbt.device';
let memoryDeviceId = null;

const defaultStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

// This phone's random id. Never shown to anyone; with storage blocked it lasts until the page closes.
export function deviceId(storage = defaultStorage()) {
  try {
    const saved = storage?.getItem(DEVICE_KEY);
    if (saved) return saved;
  } catch {}
  memoryDeviceId ??= crypto.randomUUID();
  try {
    storage?.setItem(DEVICE_KEY, memoryDeviceId);
  } catch {}
  return memoryDeviceId;
}

async function rpc(name, body) {
  const path = `/rest/v1/rpc/${name}`;
  if (currentUser()) return authedFetch(path, { method: 'POST', body });
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach NYC Poops. Check your connection and try again.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(data?.message || `Request failed (${res.status})`), { status: res.status, code: data?.code });
  return data;
}

// changes: any of { name, hours, access, open: true }. Resolves { editId, bathroom: { id, name,
// hours, access, userFields, reportedClosedAt } }.
export const editBathroom = (id, changes) => rpc('edit_bathroom', { p_bathroom_id: id, p_device_id: deviceId(), p_changes: changes });

// kind: one of REPORTS' keys, 'confirm_open' or 'confirm_hours'. note: optional, with a report only
// (never shown publicly). Resolves like editBathroom.
export const reportBathroom = (id, kind, note = null) =>
  rpc('report_bathroom', { p_bathroom_id: id, p_device_id: deviceId(), p_kind: kind, p_note: note || null });

// "Something's wrong" choices. Only closed changes what the app shows (two people → Reported
// closed); the others are kept for review (bathroom_reports).
export const REPORTS = [
  ['report_closed', "It's closed", 'Reported closed'],
  ['report_not_here', "There's no restroom here", 'Reported not here'],
  ['report_wrong_spot', 'The pin is in the wrong spot', 'Reported the pin in the wrong spot'],
  ['report_other', 'Something else', 'Reported a problem'],
];

export const undoEdit = (editId) => rpc('undo_bathroom_edit', { p_edit_id: editId, p_device_id: deviceId() });

// The latest 20 changes: [{ id, kind, changes, previous, created_at, undone, mine, can_undo }]. Never who.
export const bathroomHistory = (id) => rpc('bathroom_history', { p_bathroom_id: id, p_device_id: deviceId() });

// Copies what the database sent back onto the app's copy of the bathroom.
export function applyResult(bathroom, result) {
  const b = result?.bathroom;
  if (!bathroom || !b) return bathroom;
  Object.assign(bathroom, { name: b.name, hours: b.hours, access: b.access, userFields: b.userFields ?? [], reportedClosedAt: b.reportedClosedAt ?? null });
  return bathroom;
}

// The city lists it as closed (Not Operational, Closed for Construction…) or not open yet.
// (As in nearby.js, anything not added by a user is a city row: the published file has no source.)
export const cityClosed = (b) => b.source !== 'user' && (b.status !== 'Operational' || b.season === 'Future');

// Shown closed in a way an "It's open again" edit can clear: two closed reports, or the city's own
// closed status that nobody has overridden yet.
export const canReopen = (b) => Boolean(b.reportedClosedAt) || (cityClosed(b) && !(b.userFields ?? []).includes('open'));

// Only what differs from the bathroom. draft: { name, access, hours (undefined = hours not
// touched), open }. Pure, for tests.
export function changesFrom(b, draft) {
  const changes = {};
  const name = draft.name?.trim();
  if (name && name !== b.name) changes.name = name;
  if (draft.access && draft.access !== (b.access ?? 'unknown')) changes.access = draft.access;
  if (draft.hours !== undefined && JSON.stringify(draft.hours ?? null) !== JSON.stringify(b.hours ?? null)) changes.hours = draft.hours;
  if (draft.open && canReopen(b)) changes.open = true;
  return changes;
}

const ACCESS_WORDS = { public: 'Available to Public', customers_only: 'Customer Only', key_or_code: 'Key or code', unknown: 'Access unknown' };

// One line per history row, e.g. "Name changed to Prospect Park Boathouse · Hours changed".
export function describeChange(row) {
  const report = REPORTS.find(([kind]) => kind === row.kind);
  if (report) return report[2];
  if (row.kind === 'confirm_open') return 'Confirmed open';
  if (row.kind === 'confirm_hours') return 'Confirmed the hours';
  if (row.kind === 'fact') {
    const { fact, value, count } = row.changes ?? {};
    const name = FACTS.find((f) => f.key === fact)?.label ?? fact;
    return value ? `${name}: ${factLabel(fact, { value, count })}` : `${name}: not sure`;
  }
  const c = row.changes ?? {};
  const parts = [];
  if ('name' in c) parts.push(`Name changed to ${c.name}`);
  if ('hours' in c) parts.push(c.hours ? 'Hours changed' : 'Hours marked unknown');
  if ('access' in c) parts.push(`Access: ${ACCESS_WORDS[c.access] ?? c.access}`);
  if (c.open) parts.push('Marked open again');
  return parts.join(' · ') || 'Edited';
}

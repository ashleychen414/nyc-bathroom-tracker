// Add / edit a place, and save a shared restroom with private notes. Owns its draft and its own
// events, and repaints only the parts that change so typing never loses focus.

import { getPlace, savePlace, deletePlace, requestPersistence } from '../lib/storage.js';
import { getPosition, locationPermission, searchAddress, reverseGeocode, resultMeta } from '../lib/geo.js';
import { logLocation } from '../lib/location-log.js';
import { currentPlatformLabel } from '../lib/device.js';
import { emptyHoursForm, formFromHours, hoursFromForm, DAY_SHORT, DISPLAY_ORDER } from '../lib/hours-form.js';
import { esc } from '../lib/html.js';
import { currentUser } from '../lib/auth.js';

let root = null;
let draft = null;
let formKey = null;
let onDone = null;
let onSaved = null;
let near = null;
let suggestions = [];
let searchTimer = null;
let searchAbort = null;

export const isFormOpen = (key) => draft !== null && formKey === key;

export function closeForm() {
  draft = null;
  formKey = null;
}

// opts: { key, placeId } to edit, { key, bathroom } to save a shared restroom, { key } to add.
export function openForm(container, opts, { here, done, saved }) {
  root = container;
  formKey = opts.key;
  onDone = done;
  onSaved = saved;
  near = here;
  suggestions = [];
  const existing = opts.placeId ? getPlace(opts.placeId) : null;
  if (existing) {
    draft = { ...structuredClone(existing), savedVisibility: existing.visibility, hoursForm: formFromHours(existing.hours) };
  } else if (opts.bathroom) {
    const b = opts.bathroom;
    draft = { name: b.name, lat: b.lat, lng: b.lng, address: '', publicId: b.id, publicType: b.source === 'user' ? b.address : b.type, notes: '', hoursForm: emptyHoursForm() };
  } else {
    // New places start Public, to grow the shared map (Ashley, 2026-10-24); one tap makes it Private.
    draft = { name: '', lat: null, lng: null, address: '', notes: '', access: undefined, visibility: 'public', hoursForm: emptyHoursForm() };
  }
  if (opts.placeId && !existing) {
    root.innerHTML = '<main class="list"><p class="error">That place no longer exists.</p></main>';
    return;
  }
  render();
}

const title = () => (draft.id ? (draft.publicId ? 'Edit notes' : 'Edit place') : draft.publicId ? 'Save restroom' : 'Add a place');

function render() {
  root.innerHTML = `
    <header class="bar">
      <button class="btn ghost" data-action="cancel">Cancel</button>
      <h1>${title()}</h1>
      <button class="btn primary" data-action="save">Save</button>
    </header>
    <main class="form">
      <section class="group">
        <h2>Where</h2>
        <div id="where">${whereHtml()}</div>
      </section>
      ${
        draft.publicId
          ? ''
          : `<section class="group">
        <label class="field-label" for="name">Name</label>
        <input id="name" class="input" value="${esc(draft.name)}" maxlength="200" placeholder="e.g. Whole Foods Gowanus" autocomplete="off">
      </section>
      <section class="group" id="access-group">${accessHtml()}</section>`
      }
      ${draft.publicId ? '' : `<section class="group" id="hours-group">${hoursHtml()}</section>`}
      <section class="group">
        <label class="field-label" for="notes">Private notes</label>
        <p class="hint">Only you see these. A good place for door codes.</p>
        <textarea id="notes" class="input" rows="3" maxlength="2000" placeholder="e.g. Code is on the receipt">${esc(draft.notes)}</textarea>
      </section>
      <p class="error" id="form-error" role="alert"></p>
      ${draft.id ? `<button class="btn danger block" data-action="delete">${draft.publicId || draft.savedVisibility === 'public' ? 'Remove from My places' : 'Delete place'}</button>` : ''}
    </main>`;
}

// ---------- Where ----------

function whereHtml() {
  if (draft.publicId) {
    return `<div class="picked"><span class="picked-text"><b>${esc(draft.name)}</b><br>${draft.publicType ? esc(draft.publicType) : 'Shared restroom'}</span></div>`;
  }
  if (draft.lat !== null) {
    return `
      <div class="picked">
        <span class="pin" aria-hidden="true">📍</span>
        <span class="picked-text">${esc(draft.address || `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`)}</span>
        <button class="btn ghost small" data-action="change-where">Change</button>
      </div>`;
  }
  return `
    <button class="btn block" data-action="here">📍 I'm here now</button>
    <div class="or"><span>or</span></div>
    <input id="address" class="input" type="search" placeholder="Search an address or place" autocomplete="off">
    <ul class="suggestions" id="suggestions"></ul>
    <p class="hint" id="where-status" role="status"></p>`;
}

const refreshWhere = () => (root.querySelector('#where').innerHTML = whereHtml());

function setWhereStatus(text) {
  const el = root.querySelector('#where-status');
  if (el) el.textContent = text;
}

function pickLocation({ lat, lng, address, name }) {
  Object.assign(draft, { lat, lng, address: address ?? '' });
  if (!draft.name && name) {
    draft.name = name;
    root.querySelector('#name').value = name;
  }
  suggestions = [];
  refreshWhere();
}

async function useCurrentLocation() {
  setWhereStatus('Finding you…');
  const permissionBefore = locationPermission();
  const log = async (result) => logLocation({ trigger: 'button', permissionBefore: await permissionBefore, result, platform: currentPlatformLabel() });
  try {
    const pos = await getPosition();
    log('granted');
    near = pos;
    const place = await reverseGeocode(pos).catch(() => null);
    if (draft) pickLocation({ lat: pos.lat, lng: pos.lng, address: place?.address, name: place?.name });
  } catch (err) {
    log(err.message);
    setWhereStatus(
      err.message === 'denied'
        ? 'Location is turned off for this site. Search an address instead.'
        : err.message === 'timeout'
          ? 'Taking too long to find you. Try again, or search an address.'
          : "Couldn't get your location. Search an address instead.",
    );
  }
}

function onAddressInput(query) {
  clearTimeout(searchTimer);
  searchAbort?.abort();
  if (query.trim().length < 3) {
    suggestions = [];
    renderSuggestions();
    return;
  }
  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    setWhereStatus('Searching…');
    try {
      suggestions = await searchAddress(query, near ?? undefined, searchAbort.signal);
      setWhereStatus(suggestions.length ? '' : 'No matches in NYC. Try a street address.');
    } catch (err) {
      if (err.name === 'AbortError') return;
      suggestions = [];
      setWhereStatus("Search isn't working right now. Try \"I'm here now\".");
    }
    renderSuggestions();
  }, 300);
}

function renderSuggestions() {
  const list = root.querySelector('#suggestions');
  if (!list) return;
  list.innerHTML = suggestions
    .map(
      (s, i) => {
        // "Café · 0.3 mi · 214 3rd Street, Brooklyn", so the right branch is obvious.
        const detail = [resultMeta(s), s.name && s.address !== s.name ? s.address : ''].filter(Boolean).join(' · ');
        return `<li><button type="button" data-suggest="${i}">
        <span class="s-name">${esc(s.name || s.address)}</span>
        ${detail ? `<span class="s-addr">${esc(detail)}</span>` : ''}
      </button></li>`;
      },
    )
    .join('');
}

// ---------- Hours ----------

function hoursHtml() {
  const h = draft.hoursForm;
  const mode = (value, text) =>
    `<button type="button" class="seg ${h.mode === value ? 'on' : ''}" aria-pressed="${h.mode === value}" data-hours-mode="${value}">${text}</button>`;
  let detail = '';
  if (h.mode === 'set') {
    const times = h.same
      ? `<div class="times">
           <label class="time"><span>Opens</span><input type="time" class="input" data-hours="open" value="${esc(h.open)}"></label>
           <label class="time"><span>Closes</span><input type="time" class="input" data-hours="close" value="${esc(h.close)}"></label>
         </div>`
      : `<div class="days">${DISPLAY_ORDER.map((i) => {
          const d = h.days[i];
          return `<div class="day-row">
              <div class="day-head">
                <span class="day">${DAY_SHORT[i]}</span>
                <label class="closed-toggle"><input type="checkbox" data-day-closed="${i}" ${d.closed ? 'checked' : ''}>Closed</label>
              </div>
              ${d.closed ? '' : `<input type="time" class="input" aria-label="${DAY_SHORT[i]} opens" data-day-open="${i}" value="${esc(d.open)}">
              <input type="time" class="input" aria-label="${DAY_SHORT[i]} closes" data-day-close="${i}" value="${esc(d.close)}">`}
            </div>`;
        }).join('')}</div>`;
    detail = `
      <label class="switch-row"><span>Same hours every day</span><input type="checkbox" class="switch" data-hours-same ${h.same ? 'checked' : ''}></label>
      ${times}
      <p class="hint">Closes after midnight? Enter the closing time, e.g. 1:00 AM.</p>`;
  }
  return `
    <div class="field-row"><h2>Hours</h2><span class="hint">Shows Open / Closed in lists</span></div>
    <div class="segmented">${mode('unknown', "Don't know")}${mode('always', '24 hours')}${mode('set', 'Set hours')}</div>
    ${detail}`;
}

const refreshHours = () => (root.querySelector('#hours-group').innerHTML = hoursHtml());

// ---------- Who can use it / who can see it ----------

// Public is one-way once saved (others may have it on their list), so an existing Public place is locked.
function accessHtml() {
  // Signed out you can only edit a place saved earlier on this phone; it can't be made Public
  // until you sign in (no more "Public after sign-in").
  const locked = (draft.id && draft.savedVisibility === 'public') || !currentUser();
  const seg = (field, value, text) =>
    `<button type="button" class="seg ${draft[field] === value ? 'on' : ''}" aria-pressed="${draft[field] === value}" data-choice="${field}" data-value="${value}" ${field === 'visibility' && locked ? 'disabled' : ''}>${text}</button>`;
  const accessHint =
    draft.access === 'customers_only'
      ? 'You may need to buy something or ask staff. Codes go in your private notes.'
      : draft.access === 'public'
        ? 'Anyone can walk in and use it.'
        : "Skip if you're not sure.";
  const visibilityHint = !currentUser()
    ? draft.visibility === 'public'
      ? 'Goes on the map for everyone when you sign in. Your notes stay private.'
      : 'Sign in to share places on the map.'
    : locked
      ? "It's on the map for everyone. Public places can't be made private again, since others may have saved them."
      : draft.visibility === 'public'
        ? 'Added to the NYC Poops map for everyone. Your notes stay private.'
        : "Only you can see it, e.g. your office or a friend's place.";
  return `
    <div class="field">
      <div class="field-row"><span class="field-label">Who can use it?</span></div>
      <div class="segmented">${seg('access', 'public', 'Available to Public')}${seg('access', 'customers_only', 'Customer Only')}</div>
      <p class="hint">${accessHint}</p>
    </div>
    <div class="field">
      <div class="field-row"><span class="field-label">Who can see it?</span></div>
      <div class="segmented">${seg('visibility', 'public', 'Public')}${seg('visibility', 'private', '🔒 Private')}</div>
      <p class="hint">${visibilityHint}</p>
    </div>`;
}

const refreshAccess = () => (root.querySelector('#access-group').innerHTML = accessHtml());

// ---------- Save / delete ----------

function save() {
  const error = root.querySelector('#form-error');
  draft.name = (draft.name ?? '').trim();
  // A shared restroom's name and location are its own; only your notes are saved.
  if (!draft.publicId && draft.lat === null) return (error.textContent = 'Add where this bathroom is.');
  if (!draft.publicId && !draft.name) return (error.textContent = 'Give this place a name.');

  let hours = null;
  if (!draft.publicId) {
    const result = hoursFromForm(draft.hoursForm);
    if (result.error) return (error.textContent = result.error);
    hours = result.hours;
  }

  const { hoursForm, publicType, savedVisibility, ...place } = draft;
  try {
    savePlace({ ...place, hours });
    requestPersistence();
  } catch {
    return (error.textContent = "Couldn't save on this phone. Check that your browser allows site data.");
  }
  onSaved?.({ isNew: !draft.id });
  finish();
}

function finish() {
  closeForm();
  onDone();
}

// ---------- Events (called by app.js; return true when handled) ----------

export function handleFormClick(target) {
  if (!draft) return false;
  if (target.dataset.choice) {
    const field = target.dataset.choice;
    const value = target.dataset.value;
    // Access can be left unanswered (tap again to clear); visibility always has a value.
    draft[field] = field === 'access' && draft[field] === value ? undefined : value;
    refreshAccess();
    return true;
  }
  if (target.dataset.hoursMode) {
    draft.hoursForm.mode = target.dataset.hoursMode;
    refreshHours();
    return true;
  }
  if (target.dataset.suggest !== undefined) {
    pickLocation(suggestions[Number(target.dataset.suggest)]);
    return true;
  }
  switch (target.dataset.action) {
    case 'cancel':
      finish();
      return true;
    case 'save':
      save();
      return true;
    case 'here':
      useCurrentLocation();
      return true;
    case 'change-where':
      Object.assign(draft, { lat: null, lng: null, address: '' });
      refreshWhere();
      root.querySelector('#address').focus();
      return true;
    case 'delete': {
      const what = draft.publicId
        ? `Remove "${draft.name}" and your notes from My places?`
        : draft.savedVisibility === 'public'
          ? `Remove "${draft.name}" and your notes from My places? It stays on the map for everyone.`
          : `Delete "${draft.name}" and your notes?`;
      if (confirm(`${what} This can't be undone.`)) {
        deletePlace(draft.id);
        finish();
      }
      return true;
    }
  }
  return false;
}

export function handleFormInput(e) {
  if (!draft) return false;
  const t = e.target;
  const h = draft.hoursForm;
  if (t.id === 'name') draft.name = t.value;
  else if (t.id === 'notes') draft.notes = t.value;
  else if (t.id === 'address') onAddressInput(t.value);
  else if (t.dataset.hours) h[t.dataset.hours] = t.value;
  else if (t.dataset.dayOpen) h.days[t.dataset.dayOpen].open = t.value;
  else if (t.dataset.dayClose) h.days[t.dataset.dayClose].close = t.value;
  else if (t.dataset.hoursSame !== undefined) {
    h.same = t.checked;
    // Carry "every day" times into each day (or back) so switching doesn't lose them.
    if (!h.same && h.open && h.close) h.days = h.days.map(() => ({ closed: false, open: h.open, close: h.close }));
    refreshHours();
  } else if (t.dataset.dayClosed) {
    h.days[t.dataset.dayClosed].closed = t.checked;
    refreshHours();
  } else return false;
  return true;
}

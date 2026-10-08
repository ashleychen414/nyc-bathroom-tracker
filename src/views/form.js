// Add / edit a place, and log a public restroom. Owns its draft and its own events,
// and repaints only the parts that change so typing never loses focus.

import { getPlace, savePlace, deletePlace, requestPersistence } from '../lib/storage.js';
import { getPosition, searchAddress, reverseGeocode } from '../lib/geo.js';
import { emptyHoursForm, formFromHours, hoursFromForm, DAY_SHORT, DISPLAY_ORDER } from '../lib/hours-form.js';
import { esc } from '../lib/html.js';
import { LOG_FIELDS, RATING_WORDS } from './shared.js';

let root = null;
let draft = null;
let formKey = null;
let onDone = null;
let near = null;
let suggestions = [];
let searchTimer = null;
let searchAbort = null;

export const isFormOpen = (key) => draft !== null && formKey === key;

export function closeForm() {
  draft = null;
  formKey = null;
}

// opts: { key, placeId } to edit, { key, bathroom } to log a public restroom, { key } to add.
export function openForm(container, opts, { here, done }) {
  root = container;
  formKey = opts.key;
  onDone = done;
  near = here;
  suggestions = [];
  const existing = opts.placeId ? getPlace(opts.placeId) : null;
  if (existing) {
    draft = { ...structuredClone(existing), hoursForm: formFromHours(existing.hours) };
  } else if (opts.bathroom) {
    const b = opts.bathroom;
    draft = { name: b.name, lat: b.lat, lng: b.lng, address: '', publicId: b.id, publicType: b.type, log: {}, hoursForm: emptyHoursForm() };
  } else {
    draft = { name: '', lat: null, lng: null, address: '', log: {}, hoursForm: emptyHoursForm() };
  }
  if (opts.placeId && !existing) {
    root.innerHTML = '<main class="list"><p class="error">That place no longer exists.</p></main>';
    return;
  }
  render();
}

const title = () => (draft.id ? (draft.publicId ? 'Edit notes' : 'Edit place') : draft.publicId ? 'Add notes' : 'Add a place');

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
      <section class="group">
        <label class="field-label" for="name">Name</label>
        <input id="name" class="input" value="${esc(draft.name)}" placeholder="e.g. Whole Foods Gowanus" autocomplete="off">
      </section>
      ${draft.publicId ? '' : `<section class="group" id="hours-group">${hoursHtml()}</section>`}
      <section class="group">
        <h2>How was it?</h2>
        <p class="hint">Log only what you want. Tap a selected answer again to clear it.</p>
        ${LOG_FIELDS.map(fieldHtml).join('')}
        <label class="field-label" for="notes">Other notes</label>
        <textarea id="notes" class="input" rows="4" placeholder="e.g. Ask for the code at the counter">${esc(draft.log.notes)}</textarea>
      </section>
      <p class="error" id="form-error" role="alert"></p>
      ${draft.id ? `<button class="btn danger block" data-action="delete">${draft.publicId ? 'Remove from My places' : 'Delete place'}</button>` : ''}
    </main>`;
}

// ---------- Where ----------

function whereHtml() {
  if (draft.publicId) {
    return `<div class="picked"><span class="picked-text">Public restroom${draft.publicType ? ` · ${esc(draft.publicType)}` : ''}</span></div>`;
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
  try {
    const pos = await getPosition();
    near = pos;
    const place = await reverseGeocode(pos).catch(() => null);
    if (draft) pickLocation({ lat: pos.lat, lng: pos.lng, address: place?.address, name: place?.name });
  } catch (err) {
    setWhereStatus(
      err.message === 'denied'
        ? 'Location is turned off for this site. Search an address instead.'
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
      (s, i) => `<li><button type="button" data-suggest="${i}">
        <span class="s-name">${esc(s.name || s.address)}</span>
        ${s.name && s.address !== s.name ? `<span class="s-addr">${esc(s.address)}</span>` : ''}
      </button></li>`,
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

// ---------- Log fields ----------

function fieldHtml(f) {
  const v = draft.log[f.key];
  const hidden = f.showIf && !f.showIf(draft.log) ? 'hidden' : '';
  if (f.type === 'rating') {
    const stars = [1, 2, 3, 4, 5]
      .map(
        (n) => `<button type="button" class="star ${v >= n ? 'on' : ''}" role="radio" aria-checked="${v === n}"
                 aria-label="${n} of 5: ${RATING_WORDS[n]}" data-rate="${f.key}" data-value="${n}">${f.emoji}</button>`,
      )
      .join('');
    return `
      <div class="field" data-field="${f.key}" ${hidden}>
        <div class="field-row">
          <span class="field-label" id="lbl-${f.key}">${f.label}</span>
          <span class="rating-word">${v ? RATING_WORDS[v] : 'Not logged'}</span>
        </div>
        <div class="stars" role="radiogroup" aria-labelledby="lbl-${f.key}">${stars}</div>
        <div class="scale"><span>Very bad</span><span>Very good</span></div>
      </div>`;
  }
  if (f.type === 'count') {
    return `
      <div class="field sub" data-field="${f.key}" ${hidden}>
        <label class="field-label" for="stall-count">${f.label}</label>
        <input id="stall-count" class="input count" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2"
               value="${esc(v)}" placeholder="e.g. 3" autocomplete="off">
      </div>`;
  }
  const opt = (value, text) =>
    `<button type="button" class="seg ${v === value ? 'on' : ''}" aria-pressed="${v === value}" data-yesno="${f.key}" data-value="${value}">${text}</button>`;
  return `
    <div class="field" data-field="${f.key}" ${hidden}>
      <div class="field-row"><span class="field-label">${f.label}</span></div>
      <div class="segmented">${opt(true, 'Yes')}${opt(false, 'No')}</div>
    </div>`;
}

function refreshField(key) {
  const f = LOG_FIELDS.find((x) => x.key === key);
  root.querySelector(`[data-field="${key}"]`).outerHTML = fieldHtml(f);
}

// ---------- Save / delete ----------

function save() {
  const error = root.querySelector('#form-error');
  draft.name = draft.name.trim();
  if (draft.lat === null) return (error.textContent = 'Add where this bathroom is.');
  if (!draft.name) return (error.textContent = 'Give this place a name.');

  let hours = null;
  if (!draft.publicId) {
    const result = hoursFromForm(draft.hoursForm);
    if (result.error) return (error.textContent = result.error);
    hours = result.hours;
  }

  const log = Object.fromEntries(Object.entries(draft.log).filter(([, v]) => v !== undefined && v !== ''));
  if (log.hasTrash === false) delete log.trashCleanliness;
  if (log.hasStalls === true && Number(log.stallCount) > 0) log.stallCount = Number(log.stallCount);
  else delete log.stallCount;
  if (log.notes) log.notes = log.notes.trim();
  if (!log.notes) delete log.notes;

  const { hoursForm, publicType, ...place } = draft;
  try {
    savePlace({ ...place, hours, log });
    requestPersistence();
  } catch {
    return (error.textContent = "Couldn't save on this phone. Check that your browser allows site data.");
  }
  finish();
}

function finish() {
  closeForm();
  onDone();
}

// ---------- Events (called by app.js; return true when handled) ----------

export function handleFormClick(target) {
  if (!draft) return false;
  if (target.dataset.rate) {
    const key = target.dataset.rate;
    const value = Number(target.dataset.value);
    draft.log[key] = draft.log[key] === value ? undefined : value;
    refreshField(key);
    return true;
  }
  if (target.dataset.yesno) {
    const key = target.dataset.yesno;
    const value = target.dataset.value === 'true';
    draft.log[key] = draft.log[key] === value ? undefined : value;
    // Refresh fields whose visibility depends on this answer (stall count, trash cleanliness).
    for (const f of LOG_FIELDS) if (f.key === key || f.showIf) refreshField(f.key);
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
      const what = draft.publicId ? `Remove "${draft.name}" and your notes from My places?` : `Delete "${draft.name}" and its log?`;
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
  else if (t.id === 'notes') draft.log.notes = t.value;
  else if (t.id === 'stall-count') {
    t.value = t.value.replace(/\D/g, '');
    draft.log.stallCount = t.value;
  } else if (t.id === 'address') onAddressInput(t.value);
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

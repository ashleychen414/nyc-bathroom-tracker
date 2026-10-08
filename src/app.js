import { listPlaces, getPlace, savePlace, deletePlace, requestPersistence } from './lib/storage.js';
import { getPosition, distanceMiles, formatDistance, searchAddress, reverseGeocode, directionsUrl } from './lib/geo.js';

const app = document.getElementById('app');

const RATING_WORDS = ['', 'Very bad', 'Bad', 'OK', 'Good', 'Very good'];

// Order follows the logging flow; trash cleanliness only applies if there are trash cans.
const FIELDS = [
  { key: 'lighting', label: 'Lighting', emoji: '💡', type: 'rating' },
  { key: 'cleanliness', label: 'Bathroom cleanliness', emoji: '🧼', type: 'rating' },
  { key: 'smell', label: 'Smelly vibes', emoji: '🌸', type: 'rating' },
  { key: 'hasStalls', label: 'Stalls', type: 'yesno' },
  { key: 'stallCount', label: 'How many stalls?', type: 'count', showIf: (log) => log.hasStalls === true },
  { key: 'hasTrash', label: 'Trash cans', type: 'yesno' },
  { key: 'trashCleanliness', label: 'Trash cleanliness', emoji: '🗑️', type: 'rating', showIf: (log) => log.hasTrash !== false },
];

let here = null;
let draft = null;
let suggestions = [];
let searchTimer = null;
let searchAbort = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ---------- List ----------

function renderList() {
  draft = null;
  let places = listPlaces();
  if (here) places = places.map((p) => ({ ...p, distance: distanceMiles(here, p) })).sort((a, b) => a.distance - b.distance);

  app.innerHTML = `
    <header class="bar">
      <h1>My places</h1>
      <button class="btn primary" data-action="add">+ Add</button>
    </header>
    <main class="list">
      ${
        places.length
          ? places.map(placeCard).join('')
          : `<div class="empty">
               <p class="empty-title">No saved places yet</p>
               <p>Save bathrooms you've used and log how they were, so you know what to expect next time.</p>
               <button class="btn primary" data-action="add">Add your first place</button>
             </div>`
      }
      <p class="fineprint">Saved on this phone only. Clearing your browser data will remove them.</p>
    </main>`;
}

function placeCard(p) {
  const chips = FIELDS.flatMap((f) => {
    const v = p.log?.[f.key];
    if (v === undefined || f.type === 'count') return [];
    if (f.type === 'rating') return [`<span class="chip rate-${v}" title="${f.label}: ${v} of 5">${f.emoji} <b>${v}</b></span>`];
    if (f.key === 'hasStalls' && v && p.log.stallCount) {
      return [`<span class="chip">${p.log.stallCount} stall${p.log.stallCount === 1 ? '' : 's'}</span>`];
    }
    return [`<span class="chip">${v ? f.label : `No ${f.label.toLowerCase()}`}</span>`];
  });
  return `
    <article class="card">
      <div class="card-head">
        <h2>${esc(p.name)}</h2>
        ${p.distance !== undefined ? `<span class="dist">${formatDistance(p.distance)}</span>` : ''}
      </div>
      ${p.address ? `<p class="addr">${esc(p.address)}</p>` : ''}
      ${chips.length ? `<div class="chips">${chips.join('')}</div>` : '<p class="meta">Nothing logged yet</p>'}
      ${p.log?.notes ? `<p class="notes">${esc(p.log.notes)}</p>` : ''}
      <p class="meta">Updated ${formatDate(p.updatedAt)}</p>
      <div class="actions">
        <a class="btn primary" href="${directionsUrl(p)}" target="_blank" rel="noopener">Directions</a>
        <button class="btn" data-action="edit" data-id="${p.id}">Edit log</button>
      </div>
    </article>`;
}

// ---------- Add / edit form ----------

function openForm(id) {
  const existing = id ? getPlace(id) : null;
  draft = existing ? structuredClone(existing) : { name: '', lat: null, lng: null, address: '', log: {} };
  suggestions = [];
  renderForm();
}

function renderForm() {
  app.innerHTML = `
    <header class="bar">
      <button class="btn ghost" data-action="cancel">Cancel</button>
      <h1>${draft.id ? 'Edit place' : 'Add a place'}</h1>
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
      <section class="group">
        <h2>How was it?</h2>
        <p class="hint">Log only what you want. Tap a selected answer again to clear it.</p>
        ${FIELDS.map(fieldHtml).join('')}
        <label class="field-label" for="notes">Other notes</label>
        <textarea id="notes" class="input" rows="4" placeholder="e.g. Ask for the code at the counter">${esc(draft.log.notes)}</textarea>
      </section>
      <p class="error" id="form-error" role="alert"></p>
      ${draft.id ? '<button class="btn danger block" data-action="delete">Delete place</button>' : ''}
    </main>`;
}

function whereHtml() {
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
  const f = FIELDS.find((x) => x.key === key);
  app.querySelector(`[data-field="${key}"]`).outerHTML = fieldHtml(f);
}

function refreshWhere() {
  app.querySelector('#where').innerHTML = whereHtml();
}

function setWhereStatus(text) {
  const el = app.querySelector('#where-status');
  if (el) el.textContent = text;
}

function pickLocation({ lat, lng, address, name }) {
  Object.assign(draft, { lat, lng, address: address ?? '' });
  if (!draft.name && name) {
    draft.name = name;
    app.querySelector('#name').value = name;
  }
  suggestions = [];
  refreshWhere();
}

async function useCurrentLocation() {
  setWhereStatus('Finding you…');
  try {
    const pos = await getPosition();
    here = pos;
    const place = await reverseGeocode(pos).catch(() => null);
    pickLocation({ lat: pos.lat, lng: pos.lng, address: place?.address, name: place?.name });
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
      suggestions = await searchAddress(query, here ?? undefined, searchAbort.signal);
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
  const list = app.querySelector('#suggestions');
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

function save() {
  const error = app.querySelector('#form-error');
  draft.name = draft.name.trim();
  if (draft.lat === null) return (error.textContent = 'Add where this bathroom is.');
  if (!draft.name) return (error.textContent = 'Give this place a name.');

  const log = Object.fromEntries(Object.entries(draft.log).filter(([, v]) => v !== undefined && v !== ''));
  if (log.hasTrash === false) delete log.trashCleanliness;
  if (log.hasStalls === true && Number(log.stallCount) > 0) log.stallCount = Number(log.stallCount);
  else delete log.stallCount;
  if (log.notes) log.notes = log.notes.trim();

  try {
    savePlace({ ...draft, log });
    requestPersistence();
    renderList();
  } catch {
    error.textContent = "Couldn't save on this phone. Check that your browser allows site data.";
  }
}

// ---------- Events ----------

app.addEventListener('click', (e) => {
  const target = e.target.closest('button');
  if (!target) return;

  if (target.dataset.rate) {
    const key = target.dataset.rate;
    const value = Number(target.dataset.value);
    draft.log[key] = draft.log[key] === value ? undefined : value;
    return refreshField(key);
  }
  if (target.dataset.yesno) {
    const key = target.dataset.yesno;
    const value = target.dataset.value === 'true';
    draft.log[key] = draft.log[key] === value ? undefined : value;
    // Refresh fields whose visibility depends on this answer (stall count, trash cleanliness).
    for (const f of FIELDS) if (f.key === key || f.showIf) refreshField(f.key);
    return;
  }
  if (target.dataset.suggest !== undefined) return pickLocation(suggestions[Number(target.dataset.suggest)]);

  switch (target.dataset.action) {
    case 'add':
      return openForm();
    case 'edit':
      return openForm(target.dataset.id);
    case 'cancel':
      return renderList();
    case 'save':
      return save();
    case 'here':
      return useCurrentLocation();
    case 'change-where':
      Object.assign(draft, { lat: null, lng: null, address: '' });
      refreshWhere();
      return app.querySelector('#address').focus();
    case 'delete':
      if (confirm(`Delete "${draft.name}" and its log? This can't be undone.`)) {
        deletePlace(draft.id);
        renderList();
      }
  }
});

app.addEventListener('input', (e) => {
  if (!draft) return;
  if (e.target.id === 'name') draft.name = e.target.value;
  if (e.target.id === 'notes') draft.log.notes = e.target.value;
  if (e.target.id === 'stall-count') {
    e.target.value = e.target.value.replace(/\D/g, '');
    draft.log.stallCount = e.target.value;
  }
  if (e.target.id === 'address') onAddressInput(e.target.value);
});

renderList();

// Sort by distance if location is already allowed; don't prompt on page load.
navigator.permissions
  ?.query({ name: 'geolocation' })
  .then((p) => p.state === 'granted' && getPosition())
  .then((pos) => {
    if (pos) {
      here = pos;
      if (!draft) renderList();
    }
  })
  .catch(() => {});

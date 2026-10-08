// App shell: state, hash routing (so the phone's back button works), location, events.
//
// Routes: #/nearby (default), #/places, #/welcome, #/r/<restroom id>, #/mine/<place id>,
//         #/add, #/edit/<place id>, #/log/<restroom id>

import { listPlaces, getPlace, exportPlaces, importPlaces } from './lib/storage.js';
import { isStandalone, mobilePlatform } from './lib/device.js';
import { getPosition, distanceMiles, lookupZip } from './lib/geo.js';
import { buildEntries, nearby } from './lib/nearby.js';
import { welcomeView, nearbyView, publicDetailView, mineDetailView } from './views/nearby.js';
import { placesView } from './views/places.js';
import { openForm, closeForm, isFormOpen, handleFormClick, handleFormInput } from './views/form.js';
import { tabBar } from './views/shared.js';
import { homeScreenSheet, backupSheet, backupResult } from './views/sheets.js';

const app = document.getElementById('app');

// ---------- Per-viewer preferences (best effort; the app works without them) ----------

const PREFS_KEY = 'nbt.prefs';
const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
  } catch {
    return {};
  }
})();
function savePrefs(patch) {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or blocked storage: keep going with in-memory prefs.
  }
}

const state = {
  data: null,
  dataError: false,
  here: null, // { lat, lng, source: 'gps' | 'zip', zip?, area? }
  locating: false,
  locationIssue: null, // 'denied' | 'unavailable'
  zipDraft: prefs.zip ?? '',
  zipStatus: '',
  radius: prefs.radius ?? 0.5,
  // Closed restrooms are hidden by default; the "Hide closed" chip turns that off.
  filters: { kind: 'all', hideClosed: true, openNow: false, accessible: false, changing: false },
  sheet: null, // 'homescreen' | 'backup'
  backupMessage: '',
  backupError: '',
};

// ---------- Routing ----------

const parseRoute = () => {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'nearby', id: id ? decodeURIComponent(id) : null };
};

let previousHash = null;
let currentHash = location.hash;
let paintedHash = null;

window.addEventListener('hashchange', () => {
  previousHash = currentHash;
  currentHash = location.hash;
  render();
});

// Back to wherever the user came from inside the app, or a sensible screen on a fresh load.
function goBack(fallback) {
  if (previousHash !== null) history.back();
  else location.replace(fallback);
}

function sheetHtml() {
  if (state.sheet === 'homescreen') return homeScreenSheet(mobilePlatform());
  if (state.sheet === 'backup') {
    return backupSheet({ count: listPlaces().length, lastExport: prefs.lastExport, message: state.backupMessage, error: state.backupError });
  }
  return '';
}

function paint(html, tab) {
  const hadSheet = Boolean(app.querySelector('.sheet'));
  app.innerHTML = html + (tab ? tabBar(tab) : '') + sheetHtml();
  document.body.classList.toggle('sheet-open', Boolean(state.sheet));
  if (state.sheet && !hadSheet) app.querySelector('.sheet')?.focus();
  app.classList.toggle('has-tabbar', Boolean(tab));
  if (paintedHash !== location.hash) window.scrollTo(0, 0);
  paintedHash = location.hash;
}

const findBathroom = (id) => state.data?.bathrooms.find((b) => b.id === id) ?? null;
const distanceTo = (p) => (state.here ? distanceMiles(state.here, p) : null);
const loading = () => paint('<main class="list"><p class="meta">Loading…</p></main>', null);

function render() {
  const { name, id } = parseRoute();
  const formRoutes = { add: 'add', edit: `edit:${id}`, log: `log:${id}` };
  if (!formRoutes[name]) closeForm();

  switch (name) {
    case 'welcome':
      return paint(welcomeView(), null);

    case 'places':
      return paint(placesView(state, listPlaces()), 'places');

    case 'r': {
      if (!state.data) return state.dataError ? paint(nearbyView(state), 'nearby') : loading();
      const b = findBathroom(id);
      if (!b) return paint('<main class="list"><p class="error">That restroom is no longer in the city data.</p></main>', 'nearby');
      const place = listPlaces().find((p) => p.publicId === id) ?? null;
      return paint(publicDetailView(state, b, place, distanceTo(b)), null);
    }

    case 'mine': {
      const place = getPlace(id);
      if (!place) return paint('<main class="list"><p class="error">That place no longer exists.</p></main>', 'places');
      return paint(mineDetailView(state, place, distanceTo(place)), null);
    }

    case 'add':
    case 'edit':
    case 'log': {
      const key = formRoutes[name];
      if (isFormOpen(key)) return; // already showing; don't wipe what's being typed
      let opts = { key };
      if (name === 'edit') opts.placeId = id;
      if (name === 'log') {
        const saved = listPlaces().find((p) => p.publicId === id);
        if (saved) return location.replace(`#/edit/${encodeURIComponent(saved.id)}`);
        if (!state.data) return loading();
        const bathroom = findBathroom(id);
        if (!bathroom) return location.replace('#/nearby');
        opts.bathroom = bathroom;
      }
      paintedHash = location.hash;
      app.classList.remove('has-tabbar');
      window.scrollTo(0, 0);
      return openForm(app, opts, {
        here: state.here,
        saved: ({ isNew }) => isNew && maybePromptHomeScreen(),
        done: () => goBack(name === 'log' ? `#/r/${encodeURIComponent(id)}` : '#/places'),
      });
    }

    default: {
      const list =
        state.data && state.here
          ? nearby(buildEntries(state.data.bathrooms, listPlaces()), state.here, { radius: state.radius, ...state.filters })
          : null;
      return paint(nearbyView(state, list), 'nearby');
    }
  }
}

// Re-render only screens that show location-dependent content, never an open form.
function refresh() {
  const { name } = parseRoute();
  if (!['add', 'edit', 'log', 'welcome'].includes(name)) render();
}

// ---------- Sheets ----------

// After the 1st and 3rd new place, on phones, until the app is on the Home Screen.
function maybePromptHomeScreen() {
  const saves = (prefs.saves ?? 0) + 1;
  savePrefs({ saves });
  if (mobilePlatform() && !isStandalone() && (saves === 1 || saves === 3)) state.sheet = 'homescreen';
}

function openSheet(name) {
  state.sheet = name;
  state.backupMessage = '';
  state.backupError = '';
  render();
}

function closeSheet() {
  state.sheet = null;
  render();
}

async function exportBackup() {
  const data = exportPlaces();
  const name = `nyc-poops-places-${data.exportedAt.slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
  try {
    // On phones the share sheet is the reliable way to save a file ("Save to Files").
    if (mobilePlatform() && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'NYC Poops backup' });
    else {
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // closed the share sheet
    state.backupError = "Couldn't export. Try again.";
    return render();
  }
  savePrefs({ lastExport: data.exportedAt });
  state.backupMessage = `Exported ${data.places.length} place${data.places.length === 1 ? '' : 's'} to ${name}.`;
  state.backupError = '';
  render();
}

async function importBackup(file) {
  try {
    state.backupMessage = backupResult(importPlaces(await file.text()));
    state.backupError = '';
  } catch (err) {
    state.backupMessage = '';
    state.backupError = err.message;
  }
  render();
}

// ---------- Location ----------

async function locate() {
  state.locating = true;
  state.locationIssue = null;
  refresh();
  try {
    const pos = await getPosition();
    state.here = { lat: pos.lat, lng: pos.lng, source: 'gps' };
    savePrefs({ source: 'gps' });
  } catch (err) {
    state.locationIssue = err.message === 'denied' ? 'denied' : 'unavailable';
    if (state.here?.source === 'gps') state.here = null;
    if (!state.here && prefs.zip) applyZip(prefs.zip);
  }
  state.locating = false;
  refresh();
}

let zipAbort = null;
async function applyZip(zip) {
  zipAbort?.abort();
  zipAbort = new AbortController();
  state.zipStatus = 'Looking up…';
  setZipStatus();
  try {
    const found = await lookupZip(zip, zipAbort.signal);
    if (!found) {
      state.zipStatus = "We couldn't find that zip code in NYC.";
      return setZipStatus();
    }
    state.here = { lat: found.lat, lng: found.lng, source: 'zip', zip, area: found.area };
    state.zipStatus = '';
    savePrefs({ zip, source: 'zip' });
    refresh();
  } catch (err) {
    if (err.name === 'AbortError') return;
    state.zipStatus = "Zip lookup isn't working right now. Try again in a moment.";
    setZipStatus();
  }
}

function setZipStatus() {
  const el = app.querySelector('#zip-status');
  if (el) el.textContent = state.zipStatus;
}

// Switch from GPS to typing a zip code.
function useZip() {
  state.here = null;
  state.locationIssue = null;
  if (prefs.zip) applyZip(prefs.zip);
  refresh();
  app.querySelector('#zip')?.focus();
}

// ---------- Events ----------

app.addEventListener('click', (e) => {
  const target = e.target.closest('button, [data-action="close-sheet"]');
  if (!target) return;
  if (handleFormClick(target)) return;

  const { action, value } = target.dataset;
  switch (action) {
    case 'close-sheet':
      return closeSheet();
    case 'open-backup':
      return openSheet('backup');
    case 'export':
      return exportBackup();
    case 'back':
      return goBack('#/nearby');
    case 'radius':
      state.radius = Number(value);
      savePrefs({ radius: state.radius });
      return render();
    case 'kind':
      state.filters.kind = value;
      return render();
    case 'toggle':
      state.filters[value] = !state.filters[value];
      return render();
    case 'locate':
      return locate();
    case 'use-zip':
      return useZip();
    case 'welcome-locate':
      savePrefs({ welcomed: true });
      location.replace('#/nearby');
      return locate();
    case 'welcome-zip':
      savePrefs({ welcomed: true });
      location.replace('#/nearby');
      return requestAnimationFrame(() => app.querySelector('#zip')?.focus());
  }
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'import-file' && e.target.files[0]) importBackup(e.target.files[0]);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sheet) closeSheet();
});

app.addEventListener('input', (e) => {
  if (handleFormInput(e)) return;
  if (e.target.id === 'zip') {
    const zip = e.target.value.replace(/\D/g, '').slice(0, 5);
    e.target.value = zip;
    state.zipDraft = zip;
    if (zip.length === 5) applyZip(zip);
    else {
      state.zipStatus = '';
      setZipStatus();
    }
  }
});

// ---------- Start ----------

fetch('public/data/bathrooms.json')
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then((data) => {
    state.data = data;
  })
  .catch(() => {
    state.dataError = true;
  })
  .finally(refresh);

(async () => {
  const permission = await navigator.permissions
    ?.query({ name: 'geolocation' })
    .then((p) => p.state)
    .catch(() => null);

  if (permission === 'granted') locate();
  else if (permission === 'denied') {
    state.locationIssue = 'denied';
    if (prefs.zip) applyZip(prefs.zip);
  } else if (!prefs.welcomed) {
    if (parseRoute().name === 'nearby') location.replace('#/welcome');
  } else if (prefs.source === 'zip' && prefs.zip) applyZip(prefs.zip);
  else locate();
  render();
})();

// App shell: state, hash routing (so the phone's back button works), location, events.
//
// Routes: #/nearby (default), #/places, #/welcome, #/r/<restroom id>, #/mine/<place id>,
//         #/add, #/edit/<place id>, #/log/<restroom id>

import { listPlaces, getPlace, exportPlaces, importPlaces, clearLocal } from './lib/storage.js';
import { currentUser, sendCode, verifyCode, signOut, deleteAccount } from './lib/auth.js';
import { startSync, syncNow, syncStatus } from './lib/sync.js';
import { isStandalone, mobilePlatform } from './lib/device.js';
import { getPosition, distanceMiles, lookupZip } from './lib/geo.js';
import { buildEntries, nearby } from './lib/nearby.js';
import { welcomeView, nearbyView, publicDetailView, mineDetailView } from './views/nearby.js';
import { placesView } from './views/places.js';
import { openForm, closeForm, isFormOpen, handleFormClick, handleFormInput } from './views/form.js';
import { tabBar } from './views/shared.js';
import { homeScreenSheet, backupSheet, backupResult } from './views/sheets.js';
import { mountMap, unmountMap } from './views/map.js';
import { signInSheet, accountSheet } from './views/account.js';

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
  view: prefs.view === 'map' ? 'map' : 'list',
  // Closed restrooms are hidden by default; the "Hide closed" chip turns that off.
  filters: { kind: 'all', hideClosed: true, openNow: false, accessible: false, changing: false },
  sheet: null, // 'homescreen' | 'backup' | 'signin' | 'account'
  signin: { step: 'email', email: '', code: '', busy: false, error: '', message: '' },
  toast: '',
  sync: syncStatus,
  get user() {
    return currentUser();
  },
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
  if (state.sheet === 'homescreen') return homeScreenSheet(mobilePlatform() ?? 'ios');
  if (state.sheet === 'signin') return signInSheet(state.signin);
  if (state.sheet === 'account' && state.user) {
    return accountSheet({ user: state.user, status: syncStatus, count: listPlaces().length, homeScreenTip: Boolean(mobilePlatform()) && !isStandalone() });
  }
  if (state.sheet === 'backup') {
    return backupSheet({ count: listPlaces().length, lastExport: prefs.lastExport, message: state.backupMessage, error: state.backupError });
  }
  return '';
}

function paint(html, tab) {
  const hadSheet = Boolean(app.querySelector('.sheet'));
  unmountMap();
  app.innerHTML = html + (tab ? tabBar(tab) : '') + sheetHtml() + (state.toast ? `<div class="toast" role="status">${state.toast}</div>` : '');
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
        done: () => goBack(name === 'log' ? `#/r/${encodeURIComponent(id)}` : '#/places'),
      });
    }

    default: {
      const list =
        state.data && state.here
          ? nearby(buildEntries(state.data.bathrooms, listPlaces()), state.here, { radius: state.radius, ...state.filters })
          : null;
      paint(nearbyView(state, list), 'nearby');
      const mapEl = app.querySelector('#map');
      if (mapEl && list) {
        const { here } = state;
        mountMap(mapEl, { entries: [...list.inside, ...list.outside], here, radius: state.radius, approx: here.source === 'zip', zip: here.zip });
      }
      return;
    }
  }
}

// Re-render only screens that show location-dependent content, never an open form.
function refresh() {
  const { name } = parseRoute();
  if (!['add', 'edit', 'log', 'welcome'].includes(name)) render();
}

// ---------- Sheets ----------

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

let toastTimer = null;
function toast(text) {
  state.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = '';
    app.querySelector('.toast')?.remove();
  }, 4000);
}

// ---------- Sign-in and account ----------

const FRIENDLY = {
  over_email_send_rate_limit: 'Too many codes sent. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many tries. Wait a few minutes and try again.',
  otp_expired: "That code didn't work or has expired. Check it, or send a new one.",
};
const friendly = (err) =>
  err instanceof TypeError ? "Can't reach the server. Check your connection." : FRIENDLY[err.code] ?? (err.status === 429 ? FRIENDLY.over_request_rate_limit : err.message);

function openSignIn() {
  state.signin = { step: 'email', email: state.signin.email, code: '', busy: false, error: '', message: '' };
  state.sheet = 'signin';
  render();
  app.querySelector('#signin-email')?.focus();
}

async function requestCode() {
  const email = state.signin.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    state.signin.error = 'Enter a valid email address.';
    return render();
  }
  Object.assign(state.signin, { email, busy: true, error: '', message: '' });
  render();
  try {
    await sendCode(email);
    Object.assign(state.signin, { step: 'code', code: '', message: 'Code sent.' });
  } catch (err) {
    state.signin.error = friendly(err);
  }
  state.signin.busy = false;
  render();
  app.querySelector('#signin-code')?.focus();
}

async function checkCode() {
  const code = state.signin.code.replace(/\D/g, '');
  if (code.length < 6) {
    state.signin.error = 'Enter the code from the email.';
    return render();
  }
  Object.assign(state.signin, { busy: true, error: '', message: '' });
  render();
  try {
    await verifyCode(state.signin.email, code);
  } catch (err) {
    Object.assign(state.signin, { busy: false, error: friendly(err) });
    return render();
  }
  state.signin.busy = false;
  state.sheet = null;
  const count = listPlaces().length;
  toast(count ? `Signed in. Saving your ${count} place${count === 1 ? '' : 's'} to your account…` : 'Signed in.');
  render();
  syncNow();
}

async function handleSignOut() {
  await syncNow();
  const unsaved = syncStatus.state !== 'synced';
  const message = unsaved
    ? "Some changes haven't reached your account yet (you may be offline). Sign out anyway? Those changes will be lost."
    : "Sign out? Your places stay in your account and come back when you sign in again. They'll be removed from this phone.";
  if (!confirm(message)) return;
  signOut();
  clearLocal();
  Object.assign(syncStatus, { state: 'off', at: null, error: '' });
  state.sheet = null;
  toast('Signed out.');
  render();
}

async function handleDeleteAccount() {
  if (!confirm("Delete your account and all your saved places? This can't be undone.")) return;
  try {
    await deleteAccount();
  } catch (err) {
    alert(`Couldn't delete your account: ${friendly(err)}`);
    return;
  }
  clearLocal();
  Object.assign(syncStatus, { state: 'off', at: null, error: '' });
  state.sheet = null;
  toast('Your account and saved places were deleted.');
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
    case 'open-account':
      return openSheet('account');
    case 'open-homescreen':
      return openSheet('homescreen');
    case 'open-signin':
      return openSignIn();
    case 'resend-code':
      return requestCode();
    case 'change-email':
      Object.assign(state.signin, { step: 'email', error: '', message: '' });
      render();
      return app.querySelector('#signin-email')?.focus();
    case 'sign-out':
      return handleSignOut();
    case 'delete-account':
      return handleDeleteAccount();
    case 'sync-now':
      return syncNow();
    case 'export':
      return exportBackup();
    case 'back':
      return goBack('#/nearby');
    case 'radius':
      state.radius = Number(value);
      savePrefs({ radius: state.radius });
      return render();
    case 'view':
      state.view = value;
      savePrefs({ view: value });
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

app.addEventListener('submit', (e) => {
  const form = e.target.dataset.form;
  if (!form) return;
  e.preventDefault();
  if (form === 'send-code') requestCode();
  if (form === 'verify-code') checkCode();
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'import-file' && e.target.files[0]) importBackup(e.target.files[0]);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sheet) closeSheet();
});

app.addEventListener('input', (e) => {
  if (handleFormInput(e)) return;
  if (e.target.id === 'signin-email') return void (state.signin.email = e.target.value);
  if (e.target.id === 'signin-code') return void (state.signin.code = e.target.value);
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

// Re-render after a sync only where it shows: My places, the account sheet, or when places changed.
startSync((changed) => {
  const { name } = parseRoute();
  if (['add', 'edit', 'log', 'welcome'].includes(name)) return;
  if (changed || name === 'places' || state.sheet === 'account') render();
});

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

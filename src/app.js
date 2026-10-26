// App shell: state, hash routing (so the phone's back button works), location, events.
//
// Routes: #/nearby (default), #/places, #/welcome, #/r/<restroom id>, #/mine/<place id>,
//         #/add, #/edit/<place id>, #/log/<restroom id>, #/fix/<restroom id> (Suggest an edit)

import { listPlaces, getPlace, privatePlaces, makePublic, exportPlaces, importPlaces, clearLocal } from './lib/storage.js';
import { currentUser, sendCode, verifyCode, signOut, deleteAccount } from './lib/auth.js';
import { startSync, syncNow, syncStatus, clearSharePrompt } from './lib/sync.js';
import { isStandalone, mobilePlatform, currentPlatformLabel } from './lib/device.js';
import { locationPermission, startupLocation, tryPosition, locationAfter, distanceMiles, lookupZip } from './lib/geo.js';
import { logLocation } from './lib/location-log.js';
import { buildEntries, nearby } from './lib/nearby.js';
import { loadBathrooms } from './lib/bathrooms-source.js';
import { welcomeView, nearbyView, publicDetailView, mineDetailView } from './views/nearby.js';
import { placesView } from './views/places.js';
import { openForm, closeForm, isFormOpen, handleFormClick, handleFormInput } from './views/form.js';
import { tabBar } from './views/shared.js';
import { homeScreenSheet, backupSheet, backupResult } from './views/sheets.js';
import { mountMap, mountBackdrop, unmountMap, selectPin, showArea } from './views/map.js';
import { mapSheet } from './views/nearby.js';
import { signInSheet, accountSheet, shareSheet } from './views/account.js';
import { logVisit, getVisit, rateVisit, cleanRatings, dismissNudge, clearVisits, DIMENSIONS } from './lib/visits.js';
import { refreshStats } from './lib/stats.js';
import { rateSheetBody } from './views/ratings.js';
import { openFix, closeFix, isFixOpen, handleFixClick, handleFixInput } from './views/fix.js';
import { reportBathroom, editBathroom, undoEdit, bathroomHistory, applyResult, canReopen } from './lib/corrections.js';
import { refreshFacts, answerFact, myFactAnswer, COUNTED } from './lib/facts.js';

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
  locationIssue: null, // 'denied' | 'timeout' | 'unavailable'
  locationHelpOpen: false, // how to unblock location, opened when a tap on "Use my location" was refused
  zipDraft: prefs.zip ?? '',
  zipStatus: '',
  zipEditing: false, // showing the zip field while already using a zip
  radius: prefs.radius ?? 0.5,
  // Map first (Oct 14 decision); the list is remembered only if someone switches to it.
  view: prefs.view === 'list' ? 'list' : 'map',
  selectedId: null, // pin selected on the map; null = best match
  // The map searched where the user dragged it: { center, here }. Only counts for that same `here`,
  // so a new location brings the map back to the user.
  mapArea: null,
  // Closed restrooms are hidden by default; the "Hide closed" chip turns that off.
  filters: { kind: 'all', type: '', hideClosed: true, openNow: false, accessible: false, changing: false },
  sheet: null, // 'homescreen' | 'backup' | 'signin' | 'account' | 'share' | 'rate'
  rateDraft: null, // the quick rating being filled in (see rateSheetBody)
  history: {}, // restroom id → its latest changes (bathroom_history), 'loading' or 'error'
  fixFocus: null, // 'hours' when "Hours right? No" opens Suggest an edit
  factBusy: null, // the fact being sent from a restroom's page
  afterSignIn: null, // where to go once signed in (e.g. #/add)
  shareChoices: {}, // "Share your places?": place id → 'public' (default Private)
  shareAnswered: false, // this session, so the prompt doesn't come back before the account hears
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

const sheetWrap = (id, body) => `
  <div class="sheet-backdrop" data-action="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}" tabindex="-1">
    <div class="grabber" aria-hidden="true"></div>
    ${body}
  </div>`;

function sheetHtml() {
  if (state.sheet === 'rate' && state.rateDraft) return sheetWrap('rate-title', rateSheetBody(state.rateDraft));
  if (state.sheet === 'homescreen') return homeScreenSheet(mobilePlatform() ?? 'ios');
  if (state.sheet === 'share') return shareSheet({ places: privatePlaces(), choices: state.shareChoices });
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
  app.classList.toggle('map-mode', Boolean(app.querySelector('.map-main')));
  if (paintedHash !== location.hash) window.scrollTo(0, 0);
  paintedHash = location.hash;
}

const findBathroom = (id) => state.data?.bathrooms.find((b) => b.id === id) ?? null;
const findName = (id) => findBathroom(id)?.name ?? getPlace(id)?.name ?? null;
const distanceTo = (p) => (state.here ? distanceMiles(state.here, p) : null);
const loading = () => paint('<main class="list"><p class="meta">Loading…</p></main>', null);

function render() {
  const { name, id } = parseRoute();
  const formRoutes = { add: 'add', edit: `edit:${id}`, log: `log:${id}` };
  if (!formRoutes[name]) closeForm();
  if (name !== 'fix') closeFix();

  switch (name) {
    case 'welcome':
      paint(welcomeView(), null);
      return mountBackdrop(app.querySelector('#welcome-map'), { bathrooms: state.data?.bathrooms });

    case 'places':
      return paint(placesView(state, listPlaces()), 'places');

    case 'r': {
      if (!state.data) return state.dataError ? paint(nearbyView(state), 'nearby') : loading();
      const place = getPlace(id);
      if (place?.own) return location.replace(`#/mine/${encodeURIComponent(id)}`); // your own: your latest copy
      const b = findBathroom(id);
      if (!b) return paint('<main class="list"><p class="error">That restroom is no longer in the city data.</p></main>', 'nearby');
      if (state.history[id] === undefined) loadHistory(id);
      return paint(publicDetailView(state, b, place, distanceTo(b)), null);
    }

    case 'fix': {
      if (!state.data) return loading();
      const b = findBathroom(id);
      if (!b) return location.replace('#/nearby');
      if (isFixOpen(id)) return; // already showing; don't wipe what's being typed
      const focus = state.fixFocus;
      state.fixFocus = null;
      paintedHash = location.hash;
      app.classList.remove('has-tabbar');
      window.scrollTo(0, 0);
      return openFix(app, b, {
        focus,
        done: (result) => {
          delete state.history[id];
          if (result) toast('Thanks! Changed for everyone. You can undo it on its page.');
          goBack(`#/r/${encodeURIComponent(id)}`);
        },
      });
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
      // Adding a place or saving one to My places needs an account (Ashley, 2026-10-26). Editing a
      // place already saved on this phone doesn't.
      if (!state.user && (name === 'add' || (name === 'log' && !getPlace(id)))) {
        const then = location.hash;
        location.replace(name === 'add' ? '#/places' : `#/r/${encodeURIComponent(id)}`);
        return askSignIn(then);
      }
      if (isFormOpen(key)) return; // already showing; don't wipe what's being typed
      let opts = { key };
      if (name === 'edit') opts.placeId = id;
      if (name === 'log') {
        const saved = getPlace(id);
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
      const list = nearbyList();
      currentList = list;
      if (list && state.selectedId && ![...list.inside, ...list.outside].some((e) => e.id === state.selectedId)) state.selectedId = null;
      paint(nearbyView(state, list), 'nearby');
      const mapEl = app.querySelector('#map');
      if (mapEl && list) {
        const { here } = state;
        mountMap(mapEl, {
          entries: [...list.inside, ...list.outside],
          here,
          center: list.area ?? here,
          radius: state.radius,
          approx: here.source === 'zip',
          zip: here.zip,
          selected: state.selectedId ?? [...list.inside, ...list.outside][0]?.id,
          sheet: app.querySelector('#map-sheet'),
          onSelect: (id) => selectOnMap(id),
          onMove: searchMapArea,
        });
      }
      return;
    }
  }
}

// The Nearby list around the user, or on the map around where they dragged it. Distances are
// always from the user; only which restrooms show (and their order) follows the map.
function nearbyList() {
  if (!state.data || !state.here) return null;
  const entries = buildEntries(state.data.bathrooms, listPlaces());
  const options = { radius: state.radius, ...state.filters };
  const area = state.view === 'map' && state.mapArea?.here === state.here ? state.mapArea.center : null;
  if (!area) return nearby(entries, state.here, options);
  const list = nearby(entries, area, options);
  const fromYou = (e) => ({ ...e, distance: distanceMiles(state.here, e) });
  return { inside: list.inside.map(fromYou), outside: list.outside.map(fromYou), area };
}

// ---------- Map selection (updates the card and the pin without rebuilding the map) ----------

let currentList = null;

// The user dragged the map somewhere new: show the closest restrooms there, keeping their view.
function searchMapArea(center) {
  state.mapArea = { center, here: state.here };
  state.selectedId = null;
  currentList = nearbyList();
  const entries = [...currentList.inside, ...currentList.outside];
  const sheet = app.querySelector('#map-sheet');
  if (sheet) sheet.innerHTML = mapSheet(state, currentList, null);
  showArea({ center, entries, selected: entries[0]?.id });
}

function selectOnMap(id, { pan = false } = {}) {
  state.selectedId = id;
  const sheet = app.querySelector('#map-sheet');
  if (sheet && currentList) sheet.innerHTML = mapSheet(state, currentList, id);
  selectPin(id, { pan });
}

function stepSelection(delta) {
  if (!currentList) return;
  const entries = [...currentList.inside, ...currentList.outside];
  const index = Math.max(0, entries.findIndex((e) => e.id === state.selectedId));
  const next = entries[Math.min(entries.length - 1, Math.max(0, index + delta))];
  if (next) selectOnMap(next.id, { pan: true });
}

// Re-render only screens that show location-dependent content, never an open form.
function refresh() {
  const { name } = parseRoute();
  if (!['add', 'edit', 'log', 'fix', 'welcome'].includes(name)) render();
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

// ---------- Visits and ratings ----------

// "I went here": logs the visit at once (even if the rating is skipped), then offers the rating.
// On a shared bathroom it also asks "Was it open?" and "Hours right?" (corrections.js).
function wentHere(id) {
  let visit;
  try {
    visit = logVisit(id, findName(id) ?? undefined);
  } catch {
    return toast("Couldn't save on this phone. Check that your browser allows site data.");
  }
  const b = findBathroom(id);
  openRate(visit, b ? { bathroomId: id, hoursKnown: Boolean(b.hours), open: null, hours: null } : null);
}

function openRate(visit, confirm = null) {
  const { id, name, bathroomId, chips = [], ...rest } = visit;
  const values = Object.fromEntries(['clean', 'getIn', 'vibes', 'smell', 'trash', 'lighting', 'stallCount'].filter((k) => rest[k] !== undefined).map((k) => [k, rest[k]]));
  state.rateDraft = { visitId: id, name: findName(bathroomId) ?? name, chips: [...chips], ...values, confirm };
  state.sheet = 'rate';
  render();
}

// Repaints only the open sheet, so tapping stars doesn't rebuild the map behind it.
function repaintSheet() {
  const el = app.querySelector('.sheet');
  if (!el) return render();
  const scroll = el.scrollTop;
  const tpl = document.createElement('template');
  tpl.innerHTML = sheetHtml();
  el.innerHTML = tpl.content.querySelector('.sheet').innerHTML;
  el.scrollTop = scroll;
}

function rateClick(action, target) {
  const d = state.rateDraft;
  if (!d) return;
  if (action === 'rate-star') {
    const dim = target.dataset.dim;
    const n = Number(target.dataset.value);
    d[dim] = d[dim] === n ? undefined : n;
    // Chips only apply below 5 stars: clearing a rating or giving 5 drops its chips and their values.
    if (!d[dim] || d[dim] === 5) {
      const chips = DIMENSIONS.find((x) => x.key === dim).chips;
      d.chips = d.chips.filter((c) => !chips.some((x) => x.key === c));
      for (const c of chips) if (c.field) delete d[c.field];
    }
  } else if (action === 'rate-chip') {
    const key = target.dataset.value;
    const chip = DIMENSIONS.flatMap((x) => x.chips).find((c) => c.key === key);
    d.chips = d.chips.includes(key) ? d.chips.filter((c) => c !== key) : [...d.chips, key];
    if (!d.chips.includes(key) && chip?.field) delete d[chip.field];
  } else if (action === 'rate-field') {
    const field = target.dataset.field;
    const n = Number(target.dataset.value);
    d[field] = d[field] === n ? undefined : n;
  }
  repaintSheet();
}

// "Was it open?" / "Hours right?" in the rating sheet: sent at once, once. "Yes, it was open" on a
// restroom shown closed is an edit ("It's open again"), the only thing that clears closed reports.
async function confirmClick(action, value) {
  const c = state.rateDraft?.confirm;
  if (!c) return;
  const field = action === 'confirm-open' ? 'open' : 'hours';
  if (c[field]) return;
  c[field] = value;
  c.error = '';
  repaintSheet();
  if (field === 'hours' && value === 'no') return; // the hours form opens once the sheet closes
  const b = findBathroom(c.bathroomId);
  try {
    let result;
    if (field === 'hours') result = await reportBathroom(c.bathroomId, 'confirm_hours');
    else if (value === 'no') result = await reportBathroom(c.bathroomId, 'report_closed');
    else if (b && canReopen(b)) {
      result = await editBathroom(c.bathroomId, { open: true });
      c.reopened = true;
    } else result = await reportBathroom(c.bathroomId, 'confirm_open');
    applyResult(b, result);
    delete state.history[c.bathroomId];
  } catch (err) {
    c[field] = null;
    c.error = err.message || "Couldn't send that. Try again.";
  }
  if (state.rateDraft?.confirm === c) repaintSheet();
}

function finishRating(save) {
  const d = state.rateDraft;
  if (d?.confirm?.hours === 'no') {
    state.fixFocus = 'hours';
    setTimeout(() => (location.hash = `#/fix/${encodeURIComponent(d.confirm.bathroomId)}`));
  }
  state.rateDraft = null;
  state.sheet = null;
  let rated = false;
  if (save && d) {
    const { visitId, name, ...values } = d;
    try {
      const clean = cleanRatings(values);
      rated = ['clean', 'getIn', 'vibes'].some((k) => clean[k]);
      rateVisit(visitId, clean);
    } catch {
      toast("Couldn't save on this phone. Check that your browser allows site data.");
      return render();
    }
  }
  toast(rated ? 'Thanks! Your rating helps the next person.' : "Visit logged. You can rate it later from Nearby.");
  render();
}

// ---------- Confirm and correct (Report closed, It's open again, Undo) ----------

function loadHistory(id) {
  state.history[id] = 'loading';
  bathroomHistory(id)
    .then((rows) => (state.history[id] = rows))
    .catch(() => (state.history[id] = 'error'))
    .finally(() => {
      const route = parseRoute();
      if (route.name === 'r' && route.id === id && !state.sheet) render();
    });
}

async function correct(id, send, thanks) {
  const b = findBathroom(id);
  if (!b) return;
  try {
    applyResult(b, await send());
    toast(thanks(b));
  } catch (err) {
    toast(err.message || "Couldn't send that. Try again.");
  }
  delete state.history[id];
  refresh();
}

function reportClosed(id) {
  if (!confirm(`Report "${findName(id)}" closed? It shows closed for everyone once two people report it.`)) return;
  correct(id, () => reportBathroom(id, 'report_closed'), (b) =>
    b.reportedClosedAt ? 'Thanks. It now shows closed for everyone.' : 'Thanks. It shows closed once one more person reports it.',
  );
}

const reopen = (id) => correct(id, () => editBathroom(id, { open: true }), () => 'Thanks! It shows open again for everyone.');

// Undo one of your changes (or anyone's, for an admin) on the restroom page you're on.
function undoChange(editId) {
  const { id } = parseRoute();
  correct(id, () => undoEdit(editId), () => 'Undone.');
}

// ---------- Facts (What to expect) ----------

// A tap gives your answer; tapping your own answer again takes it back ("Not sure"). Several
// singles / stalls then ask how many (fact-count).
async function answer(id, fact, value, count = null) {
  state.factBusy = fact;
  refresh();
  try {
    await answerFact(id, fact, value, count);
    delete state.history[id];
    toast(value === null ? 'Answer taken back.' : 'Thanks! Your answer counts toward what everyone sees.');
  } catch (err) {
    toast(err.message || "Couldn't send that. Try again.");
  }
  state.factBusy = null;
  refresh();
}

function factClick(target) {
  const { id, fact, value } = target.dataset;
  answer(id, fact, myFactAnswer(id, fact) === value ? null : value);
}

function factCount(target) {
  const { id, value } = target.dataset;
  const n = Number(app.querySelector('#fact-count')?.value);
  if (!Number.isInteger(n) || n < COUNTED[value] || n > 50) return toast(`Enter a number from ${COUNTED[value]} to 50.`);
  answer(id, 'layout', value, n);
}

// ---------- Sign-in and account ----------

// Sign-in first, then carry on to `then` (a route like #/add).
function askSignIn(then) {
  state.afterSignIn = then;
  openSignIn(then === '#/add' ? 'Sign in to add a place' : 'Sign in to save places');
}

const FRIENDLY = {
  over_email_send_rate_limit: 'Too many codes sent. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many tries. Wait a few minutes and try again.',
  otp_expired: "That code didn't work or has expired. Check it, or send a new one.",
};
const friendly = (err) =>
  err instanceof TypeError ? "Can't reach the server. Check your connection." : FRIENDLY[err.code] ?? (err.status === 429 ? FRIENDLY.over_request_rate_limit : err.message);

function openSignIn(reason = '') {
  if (!reason) state.afterSignIn = null;
  state.signin = { step: 'email', email: state.signin.email, code: '', busy: false, error: '', message: '', reason };
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
  const then = state.afterSignIn;
  state.afterSignIn = null;
  if (then) location.hash = then; // the hashchange renders
  else render();
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
  clearVisits();
  Object.assign(syncStatus, { state: 'off', at: null, error: '', sharePromptDue: false });
  state.sheet = null;
  toast('Signed out.');
  render();
}

async function handleDeleteAccount() {
  const message =
    "Delete your account, your list, your notes and your Private places? Places you made Public stay on the map for everyone. This can't be undone.";
  if (!confirm(message)) return;
  try {
    await deleteAccount();
  } catch (err) {
    alert(`Couldn't delete your account: ${friendly(err)}`);
    return;
  }
  clearLocal();
  clearVisits();
  Object.assign(syncStatus, { state: 'off', at: null, error: '', sharePromptDue: false });
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

// ---------- "Share your places?" (once, for places moved over as Private) ----------

function maybePromptShare() {
  if (!syncStatus.sharePromptDue || state.shareAnswered || state.sheet) return;
  if (['add', 'edit', 'log', 'welcome'].includes(parseRoute().name)) return;
  if (!privatePlaces().length) {
    state.shareAnswered = true;
    clearSharePrompt().catch(() => {});
    return;
  }
  state.shareChoices = {};
  state.sheet = 'share';
  render();
}

async function answerSharePrompt(save) {
  const chosen = save ? privatePlaces().filter((p) => state.shareChoices[p.id] === 'public').map((p) => p.id) : [];
  if (chosen.length) makePublic(chosen); // syncs like any edit
  state.shareAnswered = true;
  state.sheet = null;
  toast(chosen.length ? `Shared ${chosen.length === 1 ? '1 place' : `${chosen.length} places`} with everyone.` : 'Kept private. You can change this on each place.');
  render();
  try {
    await clearSharePrompt();
  } catch {
    // Offline: it shows again next time, with whatever is still Private.
  }
}

// ---------- Location ----------

// trigger: 'startup' | 'button' | 'welcome', for the anonymous location log (no coordinates).
async function locate(trigger, knownPermission) {
  state.locating = true;
  state.locationIssue = null;
  refresh();
  const permissionBefore = knownPermission ?? locationPermission(); // asked before the prompt can change it
  const outcome = await tryPosition();
  const next = locationAfter(outcome);
  state.locationIssue = next.locationIssue;
  if (next.here) {
    state.here = next.here;
    savePrefs({ source: 'gps' });
  } else {
    state.locationHelpOpen = state.locationIssue === 'denied';
    if (state.here?.source === 'gps') state.here = null;
    if (!state.here && prefs.zip) applyZip(prefs.zip);
  }
  state.locating = false;
  refresh();
  logLocation({ trigger, permissionBefore: await permissionBefore, result: outcome.result, platform: currentPlatformLabel() });
}

// Startup when the browser says location is denied: the blocked state is already showing (zip
// first), so try once without "Finding you…" and switch to the real location if it works.
async function retryBlocked() {
  const outcome = await tryPosition();
  const next = locationAfter(outcome, { blocked: true });
  if (next.here) {
    zipAbort?.abort(); // the saved zip may still be looking up: the real location wins
    state.here = next.here;
    state.locationIssue = null;
    state.zipEditing = false;
    savePrefs({ source: 'gps' });
    refresh();
  }
  // The real result, with what the browser had said: shows "said denied, but worked" in the log.
  logLocation({ trigger: 'startup', permissionBefore: 'denied', result: outcome.result, platform: currentPlatformLabel() });
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
    state.zipEditing = false;
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
  if (handleFixClick(target)) return;

  const { action, value } = target.dataset;
  switch (action) {
    case 'close-sheet':
      state.rateDraft = null; // closing the rating sheet keeps the visit, unrated
      return closeSheet();
    case 'went-here':
      return wentHere(value);
    case 'rate-visit': {
      const visit = getVisit(value);
      return visit ? openRate(visit) : render();
    }
    case 'nudge-dismiss':
      dismissNudge(value);
      return render();
    case 'rate-star':
    case 'rate-chip':
    case 'rate-field':
      return rateClick(action, target);
    case 'rate-save':
      return finishRating(true);
    case 'rate-later':
      return finishRating(false);
    case 'confirm-open':
    case 'confirm-hours':
      return confirmClick(action, value);
    case 'report-closed':
      return reportClosed(value);
    case 'reopen':
      return reopen(value);
    case 'undo-edit':
      return undoChange(value);
    case 'fact-answer':
      return factClick(target);
    case 'fact-count':
      return factCount(target);
    case 'signin-then':
      return askSignIn(value);
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
    case 'share-choice':
      state.shareChoices[target.dataset.id] = value;
      return render();
    case 'share-done':
      return answerSharePrompt(value === 'save');
    case 'export':
      return exportBackup();
    case 'back':
      return goBack('#/nearby');
    case 'radius':
      state.radius = Number(value);
      savePrefs({ radius: state.radius });
      return render();
    case 'edit-zip':
      state.zipEditing = true;
      render();
      return app.querySelector('#zip')?.focus();
    case 'sheet-step':
      return stepSelection(Number(value));
    case 'map-home':
      state.mapArea = null;
      state.selectedId = null;
      return render();
    case 'view':
      state.view = value;
      savePrefs({ view: value });
      return render();
    case 'kind':
      state.selectedId = null;
      state.filters.kind = value;
      return render();
    case 'toggle':
      state.filters[value] = !state.filters[value];
      return render();
    case 'locate':
      return locate('button');
    case 'use-zip':
      return useZip();
    case 'reload':
      return location.reload();
    case 'welcome-locate':
      savePrefs({ welcomed: true });
      location.replace('#/nearby');
      return locate('welcome');
    case 'welcome-places':
      savePrefs({ welcomed: true });
      return location.replace('#/places');
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
  if (e.target.id === 'radius-filter') {
    state.radius = Number(e.target.value);
    savePrefs({ radius: state.radius });
    return render();
  }
  if (e.target.id === 'type-filter') {
    state.filters.type = e.target.value;
    return render();
  }
  if (e.target.id === 'import-file' && e.target.files[0]) importBackup(e.target.files[0]);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sheet) closeSheet();
});

app.addEventListener('input', (e) => {
  if (handleFormInput(e)) return;
  if (handleFixInput(e)) return;
  if (e.target.id === 'signin-email') return void (state.signin.email = e.target.value);
  if (e.target.id === 'signin-code') return void (state.signin.code = e.target.value);
  if (e.target.id === 'rate-stall-count' && state.rateDraft) {
    const n = e.target.value.replace(/\D/g, '').slice(0, 2);
    e.target.value = n;
    state.rateDraft.stallCount = Number(n) || undefined;
    return;
  }
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
let statsPushSeen = null;
startSync((changed) => {
  // Visits just reached the account: fetch the public numbers again so they include them.
  if (syncStatus.visitsPushedAt && syncStatus.visitsPushedAt !== statsPushSeen) {
    statsPushSeen = syncStatus.visitsPushedAt;
    updateStats();
  }
  const { name } = parseRoute();
  if (['add', 'edit', 'log', 'fix', 'welcome'].includes(name)) return;
  // Never under an open rating sheet: it would lose the stars being picked.
  if ((changed || name === 'places' || state.sheet === 'account') && state.sheet !== 'rate') render();
  maybePromptShare();
});

// Public visit counts and ratings (counts only). Repaints only if they changed, never mid-rating.
async function updateStats() {
  if ((await refreshStats()) && state.sheet !== 'rate') refresh();
}
updateStats();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && updateStats());

// Facts by majority (counts only), the same way.
async function updateFacts() {
  if ((await refreshFacts()) && state.sheet !== 'rate') refresh();
}
updateFacts();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && updateFacts());

// Restrooms come from the shared Supabase table (phone copy first, then fresh if it changed).
loadBathrooms((data) => {
  for (const b of data.bathrooms) b.specialDays = data.specialDays?.[b.operator];
  state.data = data;
  refresh();
  if (parseRoute().name === 'welcome') render(); // add the restroom dots to the backdrop
}).catch(() => {
  state.dataError = true;
  refresh();
});

(async () => {
  let focusZip = false;
  const permission = await locationPermission();
  const plan = startupLocation(permission, prefs);

  if (plan === 'locate') locate('startup', permission);
  else if (plan === 'blocked-retry') {
    state.locationIssue = 'denied';
    if (prefs.zip) applyZip(prefs.zip);
    else focusZip = true;
  } else if (plan === 'welcome') {
    if (parseRoute().name === 'nearby') location.replace('#/welcome');
  } else applyZip(prefs.zip);
  render();
  // Blocked with no saved zip: the zip field is the only way forward, so put the cursor there.
  if (focusZip) app.querySelector('#zip')?.focus();
  if (plan === 'blocked-retry') retryBlocked();
})();

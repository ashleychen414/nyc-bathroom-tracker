// My places tab: the user's saved places, nearest first.

import { esc, formatDate, icon } from '../lib/html.js';
import { distanceMiles, formatDistance, directionsUrl } from '../lib/geo.js';
import { placeStatus, bathroomStatus } from '../lib/nearby.js';
import { statusBadge, placeTags, notesLine } from './shared.js';
import { signInBanner, syncLine } from './account.js';
import { statsFor } from '../lib/stats.js';
import { myVisits } from '../lib/visits.js';
import { cardRatings } from './ratings.js';

// Only signed-in users add places (Ashley, 2026-10-26): signed out, + Add asks to sign in first.
const addButton = (user, label, cls = 'btn primary') =>
  user ? `<a class="${cls}" href="#/add">${label}</a>` : `<button class="${cls}" data-action="signin-then" data-value="#/add">${label}</button>`;

function placeCard(p, bathroom, approx) {
  const status = bathroom ? bathroomStatus(bathroom) : placeStatus(p);
  const detail = bathroom ? `#/r/${encodeURIComponent(bathroom.id)}` : `#/mine/${encodeURIComponent(p.id)}`;
  const kind = bathroom ? (bathroom.source === 'user' ? 'Shared by NYC Poops users' : 'Saved public restroom') : p.own && p.hours ? 'Your hours' : '';
  return `
    <article class="card">
      <div class="card-head">
        <h2><a class="card-link" href="${detail}">${esc(p.name)}</a></h2>
        ${p.distance !== undefined ? `<span class="dist">${approx ? '~' : ''}${formatDistance(p.distance)}</span>` : ''}
      </div>
      ${p.address ? `<p class="addr">${esc(p.address)}</p>` : ''}
      <div class="badges">${statusBadge(status)}${kind ? `<span class="type">${kind}</span>` : ''}</div>
      ${placeTags(bathroom, p)}
      ${cardRatings(statsFor(p.id), myVisits(p.id))}
      ${notesLine(p)}
      <p class="meta">Updated ${formatDate(p.updatedAt)}</p>
      <div class="actions">
        <a class="btn primary" href="${directionsUrl(p)}" target="_blank" rel="noopener">Directions</a>
        <a class="btn" href="#/edit/${encodeURIComponent(p.id)}">Edit</a>
      </div>
    </article>`;
}

export function placesView(s, places) {
  const byId = new Map((s.data?.bathrooms ?? []).map((b) => [b.id, b]));
  // A saved shared bathroom takes its name and location from the shared data when it's loaded.
  let list = places.map((p) => {
    const b = p.own ? null : byId.get(p.id);
    return b ? { ...p, name: b.name, lat: b.lat, lng: b.lng } : p;
  });
  if (s.here) list = list.map((p) => ({ ...p, distance: distanceMiles(s.here, p) })).sort((a, b) => (a.distance || 0) - (b.distance || 0));
  const approx = s.here?.source === 'zip';

  return `
    <header class="bar">
      <h1>My places</h1>
      <div class="bar-actions">
        <button class="btn icon-btn" data-action="${s.user ? 'open-account' : 'open-backup'}" aria-label="${s.user ? 'Your account' : 'Back up your places'}">${icon.more()}</button>
        ${addButton(s.user, '+ Add')}
      </div>
    </header>
    <main class="list">
      ${s.user ? '' : signInBanner}
      ${
        list.length
          ? `<p class="meta">${list.length} place${list.length === 1 ? '' : 's'}${s.here ? ' · nearest first' : ''}</p>` +
            list.map((p) => placeCard(p, p.own ? null : byId.get(p.id) ?? null, approx)).join('')
          : `<div class="empty">
               <p class="empty-title">No saved places yet</p>
               <p>Save the bathrooms you've used, like a café or store. Share them on the map, or keep them private.</p>
               ${addButton(s.user, s.user ? 'Add your first place' : 'Sign in to add places')}
               <p class="hint">You can also save a public restroom, with private notes, from its detail page.</p>
             </div>`
      }
      <p class="fineprint">${syncLine(s.user, s.sync)}</p>
    </main>`;
}

// My places tab: the user's saved places, nearest first.

import { esc, formatDate } from '../lib/html.js';
import { distanceMiles, formatDistance, directionsUrl } from '../lib/geo.js';
import { getStatus } from '../lib/hours.js';
import { placeStatus } from '../lib/nearby.js';
import { statusBadge, logChips } from './shared.js';

function placeCard(p, bathroom, approx) {
  const status = bathroom ? getStatus(bathroom) : placeStatus(p);
  const detail = bathroom ? `#/r/${encodeURIComponent(bathroom.id)}` : `#/mine/${encodeURIComponent(p.id)}`;
  return `
    <article class="card">
      <div class="card-head">
        <h2><a class="card-link" href="${detail}">${esc(p.name)}</a></h2>
        ${p.distance !== undefined ? `<span class="dist">${approx ? '~' : ''}${formatDistance(p.distance)}</span>` : ''}
      </div>
      ${p.address ? `<p class="addr">${esc(p.address)}</p>` : ''}
      <div class="badges">${statusBadge(status)}<span class="type">${bathroom ? 'Saved public restroom' : p.hours ? 'Your hours' : ''}</span></div>
      ${logChips(p.log) || '<p class="meta">Nothing logged yet</p>'}
      ${p.log?.notes ? `<p class="notes">${esc(p.log.notes)}</p>` : ''}
      <p class="meta">Updated ${formatDate(p.updatedAt)}</p>
      <div class="actions">
        <a class="btn primary" href="${directionsUrl(p)}" target="_blank" rel="noopener">Directions</a>
        <a class="btn" href="#/edit/${encodeURIComponent(p.id)}">Edit log</a>
      </div>
    </article>`;
}

export function placesView(s, places) {
  const byId = new Map((s.data?.bathrooms ?? []).map((b) => [b.id, b]));
  let list = places;
  if (s.here) list = places.map((p) => ({ ...p, distance: distanceMiles(s.here, p) })).sort((a, b) => a.distance - b.distance);
  const approx = s.here?.source === 'zip';

  return `
    <header class="bar">
      <h1>My places</h1>
      <a class="btn primary" href="#/add">+ Add</a>
    </header>
    <main class="list">
      ${
        list.length
          ? `<p class="meta">${list.length} place${list.length === 1 ? '' : 's'}${s.here ? ' · nearest first' : ''}</p>` +
            list.map((p) => placeCard(p, p.publicId ? byId.get(p.publicId) : null, approx)).join('')
          : `<div class="empty">
               <p class="empty-title">No saved places yet</p>
               <p>Save the bathrooms you've used, like a café or store, and log how they were so you know what to expect next time.</p>
               <a class="btn primary" href="#/add">Add your first place</a>
               <p class="hint">You can also add notes to a public restroom from its detail page.</p>
             </div>`
      }
      <p class="fineprint">Saved on this phone only. Clearing your browser data will remove them.</p>
    </main>`;
}

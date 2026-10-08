// Bottom sheets: "Add to Home Screen" (keeps saved places on iPhone) and backup.

import { esc, icon } from '../lib/html.js';

const shareIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;

const sheet = (id, body) => `
  <div class="sheet-backdrop" data-action="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}" tabindex="-1">
    <div class="grabber" aria-hidden="true"></div>
    ${body}
  </div>`;

export function homeScreenSheet(platform) {
  const steps =
    platform === 'ios'
      ? `<li><span>Tap ${shareIcon} <b>Share</b> in Safari's toolbar</span></li>
         <li><span>Choose <b>Add to Home Screen</b></span></li>
         <li><span>Open NYC Poops from your Home Screen from now on</span></li>`
      : `<li><span>Tap your browser's <b>⋮</b> menu</span></li>
         <li><span>Choose <b>Add to Home screen</b> or <b>Install app</b></span></li>
         <li><span>Open NYC Poops from your Home Screen from now on</span></li>`;
  const why =
    platform === 'ios'
      ? "On iPhone, saved places can be cleared if you don't open this site for a week. Adding it to your Home Screen keeps them, and opens the app in one tap."
      : 'Adding it to your Home Screen keeps your saved places safer and opens the app in one tap.';
  return sheet(
    'hs-title',
    `<h2 id="hs-title">Keep your places safe</h2>
     <p class="muted">${why}</p>
     <ol class="steps">${steps}</ol>
     <div class="sheet-actions">
       <button class="btn block" data-action="close-sheet">Not now</button>
       <button class="btn primary block" data-action="close-sheet">Got it</button>
     </div>`,
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function backupSheet({ count, lastExport, message, error }) {
  const last = lastExport ? new Date(lastExport).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'never';
  return sheet(
    'bk-title',
    `<h2 id="bk-title">Back up your places</h2>
     <p class="muted">Your ${plural(count, 'place')} ${count === 1 ? 'is' : 'are'} saved on this phone only. Export a backup file to keep them safe or move them to a new phone.</p>
     <button class="opt" data-action="export" ${count ? '' : 'disabled'}>
       <span class="opt-icon">${icon.download()}</span>
       <span><b>Export backup</b><span class="sub">Saves a .json file to your phone or Files</span></span>
     </button>
     <label class="opt">
       <span class="opt-icon">${icon.upload()}</span>
       <span><b>Import backup</b><span class="sub">Adds places from a file. If a place is in both, the newer edit is kept.</span></span>
       <input type="file" id="import-file" accept=".json,application/json" class="visually-hidden">
     </label>
     ${message ? `<p class="success" role="status">${esc(message)}</p>` : ''}
     ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
     <p class="hint">Last exported: ${esc(last)}</p>
     <button class="btn block" data-action="close-sheet">Done</button>`,
  );
}

export const backupResult = ({ added, updated, unchanged, skipped }) =>
  [
    added && `Added ${plural(added, 'place')}`,
    updated && `updated ${updated}`,
    unchanged && `${unchanged} already up to date`,
    skipped && `skipped ${skipped} that couldn't be read`,
  ]
    .filter(Boolean)
    .join(' · ') || 'Nothing to import in that file.';

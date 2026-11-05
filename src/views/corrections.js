// "Is this right?" on a restroom's page: Something's wrong (closed, not here, wrong spot, other),
// It's open again, Suggest an edit, and the latest changes with Undo on your own (or on any, for
// an admin). Never shows who.

import { esc } from '../lib/html.js';
import { canReopen, describeChange } from '../lib/corrections.js';
import { shortDate } from './ratings.js';

const SHOWN = 5;

// history: the rows from bathroom_history(), 'loading', 'error', or undefined (not asked yet).
export function correctionsSection(b, history) {
  const reopen = canReopen(b);
  return `<section class="group" id="corrections">
      <h2 class="label">Is this right?</h2>
      ${reopen ? `<button class="btn outline block" data-action="reopen" data-value="${esc(b.id)}">It's open again</button>` : ''}
      <div class="actions">
        <button class="btn outline" data-action="report-open" data-value="${esc(b.id)}">Something's wrong</button>
        <a class="btn outline" href="#/fix/${encodeURIComponent(b.id)}">Suggest an edit</a>
      </div>
      ${reopen && b.reportedClosedAt ? '<p class="hint">Two people reported it closed. Saw it open? Tap "It\'s open again".</p>' : ''}
      ${historyHtml(history)}
    </section>`;
}

function historyHtml(history) {
  if (history === 'loading') return '<p class="hint">Loading changes…</p>';
  if (!Array.isArray(history) || !history.length) return '';
  const rows = history.slice(0, SHOWN).map((row) => {
    const what = esc(describeChange(row));
    const meta = [shortDate(row.created_at), row.mine ? 'you' : '', row.undone ? 'undone' : ''].filter(Boolean).join(' · ');
    return `<li class="change ${row.undone ? 'undone' : ''}">
        <span><span class="${row.undone ? 'muted' : ''}">${what}</span> <span class="muted small">${esc(meta)}</span></span>
        ${row.can_undo ? `<button class="btn ghost small" data-action="undo-edit" data-value="${esc(row.id)}">Undo</button>` : ''}
      </li>`;
  });
  return `<h3 class="label">Recent changes</h3><ul class="changes">${rows.join('')}</ul>`;
}

// "Something's wrong" and "Send feedback" sheets, and the feedback button at the bottom of each
// restroom page. Both send at once and close; a note or message is never shown publicly.

import { esc } from '../lib/html.js';
import { REPORTS } from '../lib/corrections.js';
import { MAX_FEEDBACK } from '../lib/feedback.js';

// draft: { bathroomId, name, kind, note, busy, error }
export function reportSheetBody(d) {
  const choices = REPORTS.map(([kind, label]) => {
    const on = d.kind === kind;
    return `<button type="button" class="opt ${on ? 'on' : ''}" aria-pressed="${on}" data-action="report-kind" data-value="${kind}">${esc(label)}</button>`;
  }).join('');
  const hint =
    d.kind === 'report_closed'
      ? 'It shows closed for everyone once two people report it.'
      : d.kind
        ? "This doesn't change the map right away. We'll look into it."
        : '';
  return `<h2 id="report-title">Something wrong at ${esc(d.name ?? 'this restroom')}?</h2>
    <div class="opts" role="group" aria-label="What's wrong">${choices}</div>
    ${hint ? `<p class="hint">${hint}</p>` : ''}
    <label class="field-label" for="report-note">Anything to add? <span class="muted small">optional</span></label>
    <textarea id="report-note" class="input" rows="3" maxlength="500" placeholder="${d.kind === 'report_wrong_spot' ? 'e.g. The entrance is on 5th Ave, inside the park house' : 'e.g. Locked with a sign saying under repair'}">${esc(d.note)}</textarea>
    <p class="hint">Only the NYC Poops team sees this note.</p>
    ${d.error ? `<p class="error" role="alert">${esc(d.error)}</p>` : ''}
    <div class="sheet-actions">
      <button class="btn block" data-action="report-cancel">Cancel</button>
      <button class="btn primary block" data-action="report-send" ${!d.kind || d.busy ? 'disabled' : ''}>${d.busy ? 'Sending…' : 'Send'}</button>
    </div>`;
}

// draft: { bathroomId, name, text, busy, error }
export function feedbackSheetBody(d) {
  return `<h2 id="feedback-title">Send feedback</h2>
    <p class="muted">What's working, what's not, what you wish it did. It goes to the NYC Poops team, without your name or email.</p>
    <label class="field-label" for="feedback-text">Your feedback${d.name ? ` <span class="muted small">about ${esc(d.name)}</span>` : ''}</label>
    <textarea id="feedback-text" class="input" rows="5" maxlength="${MAX_FEEDBACK}" placeholder="e.g. I couldn't find the door, the map was slow…">${esc(d.text)}</textarea>
    ${d.error ? `<p class="error" role="alert">${esc(d.error)}</p>` : ''}
    <div class="sheet-actions">
      <button class="btn block" data-action="feedback-cancel">Cancel</button>
      <button class="btn primary block" data-action="feedback-send" ${d.busy ? 'disabled' : ''}>${d.busy ? 'Sending…' : 'Send'}</button>
    </div>`;
}

// At the bottom of every restroom page.
export const feedbackButton = (id) =>
  `<button class="btn ghost block feedback-link" data-action="feedback-open" data-value="${esc(id ?? '')}">💬 Send feedback</button>`;

// The "Hours" section shared by the place form (form.js) and "Suggest an edit" (fix.js).
// It edits an hours form object (lib/hours-form.js) in place; the caller repaints the section
// when told to, so typing a time never loses focus.

import { DAY_SHORT, DISPLAY_ORDER } from '../lib/hours-form.js';
import { esc } from '../lib/html.js';

export function hoursFieldsHtml(h, { hint = 'Shows Open / Closed in lists' } = {}) {
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
    <div class="field-row"><h2>Hours</h2><span class="hint">${esc(hint)}</span></div>
    <div class="segmented">${mode('unknown', "Don't know")}${mode('always', '24 hours')}${mode('set', 'Set hours')}</div>
    ${detail}`;
}

// A tap on "Don't know" / "24 hours" / "Set hours". Returns true when handled (repaint the section).
export function hoursClick(h, target) {
  if (!target.dataset.hoursMode) return false;
  h.mode = target.dataset.hoursMode;
  return true;
}

// Typing or toggling inside the section. Returns 'repaint' when the section's layout changed,
// 'kept' when only a value changed, or false when the input isn't part of the section.
export function hoursInput(h, t) {
  if (t.dataset.hours) h[t.dataset.hours] = t.value;
  else if (t.dataset.dayOpen) h.days[t.dataset.dayOpen].open = t.value;
  else if (t.dataset.dayClose) h.days[t.dataset.dayClose].close = t.value;
  else if (t.dataset.hoursSame !== undefined) {
    h.same = t.checked;
    // Carry "every day" times into each day (or back) so switching doesn't lose them.
    if (!h.same && h.open && h.close) h.days = h.days.map(() => ({ closed: false, open: h.open, close: h.close }));
    return 'repaint';
  } else if (t.dataset.dayClosed) {
    h.days[t.dataset.dayClosed].closed = t.checked;
    return 'repaint';
  } else return false;
  return 'kept';
}

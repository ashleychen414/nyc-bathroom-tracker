// "Suggest an edit" on any shared bathroom (city restrooms included): name, who can use it, hours,
// and "It's open again" when it shows closed. Changes go live for everyone right away and can be
// undone from the restroom's page (corrections.js). Like form.js, it owns its draft and events and
// repaints only the parts that change, so typing never loses focus.

import { emptyHoursForm, formFromHours, hoursFromForm } from '../lib/hours-form.js';
import { changesFrom, canReopen, editBathroom, applyResult } from '../lib/corrections.js';
import { hoursFieldsHtml, hoursClick, hoursInput } from './hours-fields.js';
import { esc } from '../lib/html.js';

let root = null;
let bathroom = null;
let draft = null;
let onDone = null;
let busy = false;

export const isFixOpen = (id) => draft !== null && bathroom?.id === id;

export function closeFix() {
  draft = null;
  bathroom = null;
}

// done(result): called after a save (result = the database's answer) or a cancel (null).
// focus: 'hours' scrolls to the hours ("Hours right? No").
export function openFix(container, b, { done, focus }) {
  root = container;
  bathroom = b;
  onDone = done;
  busy = false;
  // Hours the form can't show (e.g. "at least 8am–4pm") start as "Don't know" in the form, so
  // they're only sent once someone touches the Hours section.
  draft = { name: b.name, access: b.access ?? 'unknown', hoursForm: b.hours ? formFromHours(b.hours) : emptyHoursForm(), hoursTouched: false, open: false };
  render();
  if (focus === 'hours') root.querySelector('#fix-hours')?.scrollIntoView({ block: 'start' });
}

function render() {
  const reopen = canReopen(bathroom);
  root.innerHTML = `
    <header class="bar">
      <button class="btn ghost" data-action="fix-cancel">Cancel</button>
      <h1>Suggest an edit</h1>
      <button class="btn primary" data-action="fix-save">Save</button>
    </header>
    <main class="form">
      <p class="hint">Fix what's wrong at <b>${esc(bathroom.name)}</b>. Changes show for everyone right away, and you can undo them from its page.</p>
      ${
        reopen
          ? `<section class="group">
        <label class="switch-row"><span>It's open again</span><input type="checkbox" class="switch" id="fix-open" ${draft.open ? 'checked' : ''}></label>
        <p class="hint">${bathroom.reportedClosedAt ? 'People reported it closed.' : 'The city lists it as closed.'} Only turn this on if you saw it open.</p>
      </section>`
          : ''
      }
      <section class="group">
        <label class="field-label" for="fix-name">Name</label>
        <input id="fix-name" class="input" value="${esc(draft.name)}" maxlength="200" autocomplete="off">
      </section>
      <section class="group" id="fix-access">${accessHtml()}</section>
      <section class="group" id="fix-hours">${hoursFieldsHtml(draft.hoursForm, { hint: 'Only if you know them' })}</section>
      <p class="error" id="fix-error" role="alert"></p>
    </main>`;
}

function accessHtml() {
  const seg = (value, text) =>
    `<button type="button" class="seg ${draft.access === value ? 'on' : ''}" aria-pressed="${draft.access === value}" data-fix-access="${value}">${text}</button>`;
  return `
    <div class="field-row"><span class="field-label">Who can use it?</span></div>
    <div class="segmented">${seg('public', 'Available to Public')}${seg('customers_only', 'Customer Only')}${seg('unknown', 'Not sure')}</div>`;
}

const refreshHours = () => (root.querySelector('#fix-hours').innerHTML = hoursFieldsHtml(draft.hoursForm, { hint: 'Only if you know them' }));

async function save() {
  if (busy) return;
  const error = root.querySelector('#fix-error');
  let hours;
  if (draft.hoursTouched) {
    const result = hoursFromForm(draft.hoursForm);
    if (result.error) return (error.textContent = result.error);
    hours = result.hours;
  }
  const changes = changesFrom(bathroom, { name: draft.name, access: draft.access, hours, open: draft.open });
  if (!draft.name.trim()) return (error.textContent = 'A name is needed.');
  if (!Object.keys(changes).length) return (error.textContent = 'Nothing has changed yet.');
  busy = true;
  error.textContent = '';
  root.querySelector('[data-action="fix-save"]').textContent = 'Saving…';
  try {
    const result = await editBathroom(bathroom.id, changes);
    applyResult(bathroom, result);
    const done = onDone;
    closeFix();
    done(result);
  } catch (err) {
    busy = false;
    root.querySelector('[data-action="fix-save"]').textContent = 'Save';
    error.textContent = err.message || "Couldn't save. Try again.";
  }
}

// ---------- Events (called by app.js; return true when handled) ----------

export function handleFixClick(target) {
  if (!draft) return false;
  if (target.dataset.fixAccess) {
    draft.access = target.dataset.fixAccess;
    root.querySelector('#fix-access').innerHTML = accessHtml();
    return true;
  }
  if (hoursClick(draft.hoursForm, target)) {
    draft.hoursTouched = true;
    refreshHours();
    return true;
  }
  if (target.dataset.action === 'fix-cancel') {
    const done = onDone;
    closeFix();
    done(null);
    return true;
  }
  if (target.dataset.action === 'fix-save') {
    save();
    return true;
  }
  return false;
}

export function handleFixInput(e) {
  if (!draft) return false;
  const t = e.target;
  if (t.id === 'fix-name') draft.name = t.value;
  else if (t.id === 'fix-open') draft.open = t.checked;
  else {
    const changed = hoursInput(draft.hoursForm, t);
    if (!changed) return false;
    draft.hoursTouched = true;
    if (changed === 'repaint') refreshHours();
  }
  return true;
}

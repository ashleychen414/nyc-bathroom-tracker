// Facts on cards ("Fully accessible", "3 single bathrooms") and the "What to expect" answers on a
// restroom's page (lib/facts.js). Each fact shows the majority answer and how many said so; a tap
// gives your own answer, and tapping it again takes it back ("Not sure").
// The door code itself is public (Ashley, 2026-10-27): it replaces "Code needed" on cards, and its
// own section on the page asks "Know the code?" when one is needed but nobody added it yet.

import { esc } from '../lib/html.js';
import { FACTS, COUNTED, factsFor, factLabel, myFactAnswer } from '../lib/facts.js';
import { FACTS as STAT_FACTS } from '../lib/stats.js';
import { codeText } from '../lib/corrections.js';

// Before anyone answers "Code or key", a "Code needed" from visit ratings (the code chip) stands in.
function withStats(facts, stat) {
  if (!facts.code && stat?.facts.includes(STAT_FACTS.code)) facts.code = { value: 'yes', count: null, people: 0, city: false, total: 0, fromVisits: true };
  return facts;
}

// Is a code needed, by the answers (or visit ratings)? A known code shows whatever they say.
export const codeNeeded = (b, stat) => withStats(factsFor(b), stat).code?.value === 'yes';

// Card chips. Negative answers ("No changing table") stay off cards; they show on the page.
// A known code replaces "Code needed": "Code: 4321 · confirmed Oct 27".
export function factTags(b, stat) {
  const facts = withStats(factsFor(b), stat);
  const tags = FACTS.map(({ key }) => (key === 'code' && b.code ? null : facts[key]))
    .map((f, i) => (f && !['none', 'no'].includes(f.value) ? factLabel(FACTS[i].key, f) : null))
    .filter(Boolean);
  if (b.code) tags.unshift(codeText(b));
  // Not one of the facts yet, but the city says so.
  if (/All Gender/.test(b.restroomType ?? '')) tags.push('All gender');
  return tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : '';
}

const said = (f) => {
  if (f.fromVisits) return 'from visit ratings';
  if (f.city && f.total === 1) return 'city data';
  // With the city's value in the count, it's "answers"; otherwise every answer is a person.
  const unit = f.withCity ? 'answers' : f.total === 1 ? 'person' : 'people';
  if (f.people === f.total) return f.withCity ? `city data + ${f.total - 1} ${f.total === 2 ? 'person' : 'people'}` : `${f.total} ${unit}`;
  return `${f.people} of ${f.total} ${unit}`;
};

// The "What to expect" facts on a restroom's page. busy: the fact being sent, if any.
export function factsSection(b, stat, busy = null) {
  const facts = withStats(factsFor(b), stat);
  const rows = FACTS.map(({ key, label, question, options }) => {
    const f = facts[key];
    const mine = myFactAnswer(b.id, key);
    const now = f ? `<span class="hint"><b>${esc(factLabel(key, f))}</b> · ${esc(said(f))}</span>` : '<span class="hint">Unknown. Know it? Tap below.</span>';
    const chips = options
      .map(([value, text]) => {
        const on = mine === value;
        return `<button type="button" class="chip-btn small ${on ? 'on' : ''}" aria-pressed="${on}" data-action="fact-answer" data-id="${esc(b.id)}" data-fact="${key}" data-value="${value}" ${busy === key ? 'disabled' : ''}>${esc(text)}</button>`;
      })
      .join('');
    const counted = key === 'layout' && COUNTED[mine] !== undefined;
    const count = counted
      ? `<div class="count-row">
          <label class="hint" for="fact-count">How many ${mine === 'stalls' ? 'stalls' : 'single bathrooms'}?</label>
          <input id="fact-count" class="input count" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${esc(f?.value === mine && f.count ? f.count : '')}">
          <button type="button" class="btn small outline" data-action="fact-count" data-id="${esc(b.id)}" data-value="${mine}">Save</button>
        </div>`
      : '';
    return `<div class="fact">
        <div class="field-row"><span class="field-label">${esc(label)}</span>${now}</div>
        <p class="hint">${esc(question)}${mine ? ' Tap your answer again if you\'re not sure.' : ''}</p>
        <div class="reason-chips">${chips}</div>
        ${count}
      </div>`;
  });
  return rows.join('');
}

// The door code near the top of a restroom's page: the code with "Still works" and "Edit", or,
// when a code is needed and nobody added it, "Know the code?". Nothing otherwise (Suggest an edit
// still has the field).
export function codeSection(b, stat) {
  const id = esc(b.id);
  if (b.code) {
    return `<section class="group code-card" id="door-code">
        <p class="code-line">${esc(codeText(b))}</p>
        <p class="hint">Public: everyone sees it. Codes change, so say if it still works.</p>
        <div class="actions">
          <button class="btn outline small" data-action="confirm-code" data-value="${id}">Still works</button>
          <button class="btn outline small" data-action="edit-code" data-value="${id}">Edit code</button>
        </div>
      </section>`;
  }
  if (!codeNeeded(b, stat)) return '';
  return `<section class="group code-card" id="door-code">
      <p class="code-line">Code needed</p>
      <button class="btn outline small" data-action="edit-code" data-value="${id}">Know the code?</button>
    </section>`;
}

// One line for the card over the map: the code, or "Code needed" with "Know the code?".
export function codeMapLine(b, stat) {
  if (b.code) return `<p class="code-line small">${esc(codeText(b))}</p>`;
  if (!codeNeeded(b, stat)) return '';
  return `<div class="code-ask"><span class="code-line small">Code needed</span><button class="btn ghost small" data-action="edit-code" data-value="${esc(b.id)}">Know the code?</button></div>`;
}

// Converts between the hours model (see hours.js) and the "Hours" section of the
// My places form. Times are "HH:MM" strings, as <input type="time"> uses.

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

const MAX_AFTER_MIDNIGHT = 4 * 60;

const blankDay = () => ({ closed: false, open: '', close: '' });

// Times start empty on purpose: a prefilled guess saved unchanged would show a false "Open".
export const emptyHoursForm = () => ({ mode: 'unknown', same: true, open: '', close: '', days: Array.from({ length: 7 }, blankDay) });

export function toMinute(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function toTimeValue(minute) {
  const m = minute % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function rangeFromTimes(open, close) {
  const start = toMinute(open);
  let end = toMinute(close);
  if (start === null || end === null) return null;
  if (end <= start) {
    if (end > MAX_AFTER_MIDNIGHT) return null;
    end += 1440;
  }
  return [start, end];
}

function timeError(open, close) {
  return !open || !close
    ? 'add an opening and a closing time.'
    : 'closing time must be after opening time (or by 4am for late nights).';
}

// Returns { hours } or { error }.
export function hoursFromForm(form) {
  if (form.mode === 'unknown') return { hours: null };
  if (form.mode === 'always') return { hours: { kind: 'always' } };
  if (form.same) {
    const range = rangeFromTimes(form.open, form.close);
    if (!range) return { error: `Hours: ${timeError(form.open, form.close)}` };
    return { hours: { kind: 'weekly', days: Array.from({ length: 7 }, () => [range]) } };
  }
  const days = [];
  for (const [i, day] of form.days.entries()) {
    if (day.closed) {
      days.push([]);
      continue;
    }
    const range = rangeFromTimes(day.open, day.close);
    if (!range) return { error: `${DAY_NAMES[i]}: ${timeError(day.open, day.close)}` };
    days.push([range]);
  }
  return { hours: { kind: 'weekly', days } };
}

export function formFromHours(hours) {
  const form = emptyHoursForm();
  if (!hours) return form;
  if (hours.kind === 'always') return { ...form, mode: 'always' };
  if (hours.kind !== 'weekly') return form;

  form.mode = 'set';
  form.days = hours.days.map((d) =>
    d?.length ? { closed: false, open: toTimeValue(d[0][0]), close: toTimeValue(d[0][1]) } : { ...blankDay(), closed: Array.isArray(d) },
  );
  const [first] = form.days;
  form.same = form.days.every((d) => !d.closed && d.open && d.open === first.open && d.close === first.close);
  if (form.same) Object.assign(form, { open: first.open, close: first.close });
  return form;
}

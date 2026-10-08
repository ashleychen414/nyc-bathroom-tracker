import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursFromForm, formFromHours, emptyHoursForm } from './hours-form.js';
import { describeHours } from './hours.js';

test("Don't know and 24 hours", () => {
  assert.deepEqual(hoursFromForm(emptyHoursForm()), { hours: null });
  assert.deepEqual(hoursFromForm({ ...emptyHoursForm(), mode: 'always' }), { hours: { kind: 'always' } });
});

test('same hours every day, including after midnight', () => {
  const { hours } = hoursFromForm({ ...emptyHoursForm(), mode: 'set', open: '07:00', close: '22:00' });
  assert.deepEqual(hours.days[3], [[420, 1320]]);
  const late = hoursFromForm({ ...emptyHoursForm(), mode: 'set', open: '18:00', close: '01:00' }).hours;
  assert.deepEqual(late.days[0], [[1080, 1500]]);
});

test('set hours require valid times', () => {
  assert.match(hoursFromForm({ ...emptyHoursForm(), mode: 'set' }).error, /add an opening and a closing time/);
  assert.match(hoursFromForm({ ...emptyHoursForm(), mode: 'set', open: '10:00', close: '09:00' }).error, /after opening/);
});

test('per-day hours with a closed day', () => {
  const form = { ...emptyHoursForm(), mode: 'set', same: false };
  form.days = form.days.map((_, i) => (i === 0 ? { closed: true, open: '', close: '' } : { closed: false, open: '10:00', close: '18:00' }));
  const { hours } = hoursFromForm(form);
  assert.deepEqual(hours.days[0], []);
  assert.deepEqual(describeHours(hours), [
    { label: 'Mon–Sat', text: '10am – 6pm' },
    { label: 'Sun', text: 'Closed' },
  ]);

  form.days[2] = { closed: false, open: '', close: '' };
  assert.match(hoursFromForm(form).error, /^Tuesday:/);
});

test('form round-trips the hours it saved', () => {
  const same = hoursFromForm({ ...emptyHoursForm(), mode: 'set', open: '07:00', close: '22:00' }).hours;
  const f = formFromHours(same);
  assert.equal(f.same, true);
  assert.equal(f.open, '07:00');
  assert.equal(f.close, '22:00');
  assert.equal(formFromHours({ kind: 'always' }).mode, 'always');
  assert.equal(formFromHours(null).mode, 'unknown');
});

test('describeHours', () => {
  assert.deepEqual(describeHours({ kind: 'always' }), [{ label: 'Every day', text: 'Open 24 hours' }]);
  assert.equal(describeHours(null), null);
});

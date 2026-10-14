import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, parseRange, getStatus, formatTime } from './hours.js';

// Wed Oct 8 2025 at the given NY local time (EDT, UTC-4).
const nyWed = (hh, mm = 0) => new Date(Date.UTC(2025, 9, 8, hh + 4, mm));

test('parseRange handles common formats', () => {
  assert.deepEqual(parseRange('10am - 8pm'), [600, 1200]);
  assert.deepEqual(parseRange('11:00am-6:00pm'), [660, 1080]);
  assert.deepEqual(parseRange('10 am to 5 pm'), [600, 1020]);
  assert.deepEqual(parseRange('7 a.m.-7 p.m.'), [420, 1140]);
});

test('parseRange allows after-midnight closes but rejects typos', () => {
  assert.deepEqual(parseRange('6am-1am'), [360, 1500]);
  assert.deepEqual(parseRange('8am - 12am'), [480, 1440]);
  assert.equal(parseRange('10:00 pm - 7:00 pm'), null);
});

test('parseHours: single ranges', () => {
  assert.deepEqual(parseHours('6:00am-8:00pm Daily').flags, []);
  assert.deepEqual(parseHours('Everyday 8:00 am-10:00 pm').flags, []);
  assert.deepEqual(parseHours('9:00am-5:00pm').flags, ['assumed-daily']);
  assert.equal(parseHours('24 Hours').hours.kind, 'always');
});

test('parseHours: seasonal minimum', () => {
  const { hours } = parseHours('8am-4pm, Open later seasonally');
  assert.deepEqual(hours, { kind: 'minimum', range: [480, 960] });
});

test('parseHours: per-day lists, including tab format and typos', () => {
  const tab = parseHours('Monday\t10 am - 6 pm\nTuesday\t1 pm - 8 pm\nWednesday\t10 am - 6 pm\nThursday\t10 am - 8 pm\nFriday\t10 am - 6 pm\nSaturday\t10 am - 5 pm\nSunday\tCLOSED');
  assert.deepEqual(tab.hours.days[0], []);
  assert.deepEqual(tab.hours.days[2], [[780, 1200]]);

  const typo = parseHours('Sunday: Closed \nMonday: 10:00 am - 7:00 pm \nTuesday: 10:00 pm - 7:00 pm \nWednesday: 10:00 am - 7:00 pm \nThursday: 10:00 am - 7:00 pm \nFriday: 10:00 am - 5:00 pm \nSaturday: 10:00 am - 5:00 pm');
  assert.equal(typo.hours.days[2], null);
  assert.deepEqual(typo.flags, ['invalid-tuesday']);
});

test('parseHours: refuses anything it cannot read exactly', () => {
  for (const raw of ['Open by permit', 'Park Hours', '7:30am - dusk', 'Tues-Sun 12pm-10pm', 'https://sifunpark.com/2023-hours/']) {
    assert.equal(parseHours(raw).hours, null, raw);
  }
  assert.deepEqual(parseHours(undefined).flags, ['missing']);
});

test('getStatus never guesses open', () => {
  const op = (raw, extra = {}) => ({ status: 'Operational', season: 'Year Round', hours: parseHours(raw).hours, ...extra });

  assert.equal(getStatus(op('10am - 8pm'), nyWed(12)).state, 'open');
  assert.equal(getStatus(op('10am - 8pm'), nyWed(21)).state, 'closed');
  assert.equal(getStatus(op(undefined), nyWed(12)).state, 'unknown');
  assert.equal(getStatus(op('8am-4pm, Open later seasonally'), nyWed(12)).state, 'open');
  assert.equal(getStatus(op('8am-4pm, Open later seasonally'), nyWed(18)).state, 'varies');
  assert.equal(getStatus(op('10am - 8pm', { season: 'Seasonal' }), nyWed(12)).state, 'varies');
  assert.equal(getStatus(op('10am - 8pm', { status: 'Not Operational' }), nyWed(12)).state, 'closed');
  assert.equal(getStatus(op('10am - 8pm', { season: 'Future' }), nyWed(12)).state, 'closed');
});

test('getStatus: after-midnight hours carry into the next day', () => {
  const b = { status: 'Operational', season: 'Year Round', hours: parseHours('6am-1am').hours };
  assert.equal(getStatus(b, nyWed(0, 30)).label, 'Open until 1am');
  assert.equal(getStatus(b, nyWed(2)).state, 'closed');
});

test('getStatus: unknown day stays unknown', () => {
  const hours = parseHours('Sunday: Closed\nMonday: 10:00 am - 7:00 pm\nTuesday: 10:00 am - 7:00 pm\nWednesday: 10:00 pm - 7:00 pm\nThursday: 10:00 am - 7:00 pm\nFriday: 10:00 am - 5:00 pm\nSaturday: 10:00 am - 5:00 pm').hours;
  assert.equal(getStatus({ status: 'Operational', season: 'Year Round', hours }, nyWed(12)).state, 'unknown');
});

test('formatTime', () => {
  assert.equal(formatTime(630), '10:30am');
  assert.equal(formatTime(1440), 'midnight');
  assert.equal(formatTime(720), 'noon');
});

test('getStatus: special days (holidays) replace the day', () => {
  const hours = parseHours('10am - 8pm Daily').hours;
  const lib = (specialDays, extra = {}) => ({ status: 'Operational', season: 'Year Round', hours, specialDays, ...extra });
  assert.equal(getStatus(lib({ '2025-10-08': [] }), nyWed(12)).state, 'closed');
  assert.equal(getStatus(lib({ '2025-10-08': [] }), nyWed(12)).label, 'Closed today (holiday)');
  assert.equal(getStatus(lib({ '2025-10-08': null }), nyWed(12)).state, 'unknown');
  assert.equal(getStatus(lib({ '2025-10-08': [[600, 780]] }), nyWed(12)).state, 'open');
  assert.equal(getStatus(lib({ '2025-10-08': [[600, 780]] }), nyWed(14)).state, 'closed');
  // Other days, and restrooms without special days, are unaffected.
  assert.equal(getStatus(lib({ '2025-10-09': [] }), nyWed(12)).state, 'open');
  assert.equal(getStatus(lib(undefined), nyWed(12)).state, 'open');
  // A holiday never reopens a restroom that is closed or not operational.
  assert.equal(getStatus(lib({ '2025-10-08': [[600, 780]] }, { status: 'Closed for Construction' }), nyWed(12)).state, 'closed');
  // 24-hour restrooms on an unknown holiday read as unknown, not open.
  assert.equal(getStatus({ status: 'Operational', hours: { kind: 'always' }, specialDays: { '2025-10-08': null } }, nyWed(3)).state, 'unknown');
});

test('getStatus: the holiday date is the New York date, not UTC', () => {
  // 11pm Wed in New York is already Thursday in UTC.
  const b = { status: 'Operational', hours: { kind: 'always' }, specialDays: { '2025-10-09': [] } };
  assert.equal(getStatus(b, nyWed(23)).state, 'open');
});

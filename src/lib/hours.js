// Hours parsing and open/closed status. Shared by the data build script and the app.
//
// Accuracy rule: never show "Open" unless the source hours say so for this exact
// day and time. Anything ambiguous resolves to "unknown" or "varies", never "open".
//
// Hours model (null = unknown):
//   { kind: 'always' }                         open 24 hours, every day
//   { kind: 'weekly', days: [7 x Range[]|null] } index 0 = Sunday; [] = closed that day; null = unknown that day
//   { kind: 'minimum', range: Range }           open at least this range daily, unknown outside it
//                                              (e.g. "8am-4pm, Open later seasonally")
// Range = [startMinute, endMinute]; endMinute may exceed 1440 when closing after midnight.

export const TIME_ZONE = 'America/New_York';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MAX_AFTER_MIDNIGHT = 4 * 60; // a close time of 4am or earlier is read as "after midnight"

export function parseTime(text) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i.exec(text.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return (hour % 12) * 60 + minute + (m[3].toLowerCase() === 'p' ? 720 : 0);
}

// Returns a Range, or null if the text isn't a single clean time range.
export function parseRange(text) {
  const parts = text.trim().split(/\s*(?:-|–|\bto\b)\s*/i);
  if (parts.length !== 2) return null;
  const start = parseTime(parts[0]);
  let end = parseTime(parts[1]);
  if (start === null || end === null) return null;
  if (end <= start) {
    // Closing after midnight is plausible ("6am-1am"); anything else is a source typo
    // like "10:00 pm - 7:00 pm", which we refuse to guess at.
    if (end > MAX_AFTER_MIDNIGHT) return null;
    end += 1440;
  }
  return [start, end];
}

// Parses the city's free-text hours. Returns { hours, flags } where flags explain
// anything a human should review (see data/hours-review.md).
export function parseHours(raw) {
  const text = (raw ?? '').trim();
  if (!text) return { hours: null, flags: ['missing'] };
  if (/^24 hours$/i.test(text)) return { hours: { kind: 'always' }, flags: [] };

  const seasonal = /^(.+?),\s*open later seasonally$/i.exec(text);
  if (seasonal) {
    const range = parseRange(seasonal[1]);
    return range ? { hours: { kind: 'minimum', range }, flags: [] } : { hours: null, flags: ['unparsed'] };
  }

  if (/\n/.test(text)) return parseWeekly(text);

  const daily = /^(?:everyday|daily)\s+(.+)$/i.exec(text) ?? /^(.+?)\s+(?:everyday|daily)$/i.exec(text);
  const range = parseRange(daily ? daily[1] : text);
  if (range) {
    return {
      hours: { kind: 'weekly', days: DAY_NAMES.map(() => [range]) },
      // A bare range like "9:00am-5:00pm" doesn't say which days; we read it as daily.
      flags: daily ? [] : ['assumed-daily'],
    };
  }
  return { hours: null, flags: ['unparsed'] };
}

function parseWeekly(text) {
  const days = new Array(7).fill(undefined);
  const flags = [];
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([a-z]+)\s*[:\t]?\s*(.+)$/i.exec(line);
    const index = m ? DAY_NAMES.indexOf(m[1].toLowerCase()) : -1;
    if (index === -1) return { hours: null, flags: ['unparsed'] };
    if (/^closed$/i.test(m[2].trim())) {
      days[index] = [];
    } else {
      const range = parseRange(m[2]);
      days[index] = range ? [range] : null;
      if (!range) flags.push(`invalid-${DAY_NAMES[index]}`);
    }
  }
  if (days.includes(undefined)) return { hours: null, flags: ['unparsed'] };
  return { hours: { kind: 'weekly', days }, flags };
}

export function formatTime(minute) {
  const m = minute % 1440;
  if (m === 0) return 'midnight';
  if (m === 720) return 'noon';
  const h = Math.floor(m / 60) % 12 || 12;
  const mm = m % 60;
  return `${h}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${m < 720 ? 'am' : 'pm'}`;
}

// Day of week (0 = Sunday) and minute of day in New York, regardless of device time zone.
export function nyClock(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

// state: 'open' | 'unknown' | 'varies' | 'closed'. 'closed' renders greyed out.
export function getStatus(bathroom, now = new Date()) {
  const { status, season, hours } = bathroom;
  if (status !== 'Operational') return { state: 'closed', label: status || 'Not operational' };
  if (season === 'Future') return { state: 'closed', label: 'Not open yet' };
  // The source gives no season dates, so a seasonal restroom may be closed right now.
  if (season === 'Seasonal') return { state: 'varies', label: 'Seasonal: may be closed' };
  if (!hours) return { state: 'unknown', label: 'Hours unknown' };
  if (hours.kind === 'always') return { state: 'open', label: 'Open 24 hours' };

  const { day, minute } = nyClock(now);

  if (hours.kind === 'minimum') {
    const [start, end] = hours.range;
    return minute >= start && minute < end
      ? { state: 'open', label: `Open until at least ${formatTime(end)}` }
      : { state: 'varies', label: 'Hours vary seasonally' };
  }

  // Yesterday's after-midnight hours can still be running now.
  const yesterday = hours.days[(day + 6) % 7] ?? [];
  for (const [, end] of yesterday) {
    if (end > 1440 && minute < end - 1440) return { state: 'open', label: `Open until ${formatTime(end)}` };
  }
  const today = hours.days[day];
  if (today === null) return { state: 'unknown', label: 'Hours unknown today' };
  for (const [start, end] of today) {
    if (minute >= start && minute < end) return { state: 'open', label: `Open until ${formatTime(end)}` };
  }
  const next = today.find(([start]) => start > minute);
  return { state: 'closed', label: next ? `Closed now · opens ${formatTime(next[0])}` : 'Closed for today' };
}

// Sort rank within a radius: open first, then unknown/varies, then greyed-out.
export const STATE_RANK = { open: 0, unknown: 1, varies: 1, closed: 2 };

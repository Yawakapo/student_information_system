const text = (value) => String(value ?? '').trim();
const pad = (value) => String(value).padStart(2, '0');

const timePart = (value) => {
  if (value instanceof Date) {
    return value.toISOString().slice(11, 19);
  }
  return text(value);
};

/**
 * Parse a clock value into an unambiguous 24-hour representation.
 * Values without an AM/PM marker are treated as 24-hour clock values when
 * they contain an hour greater than 12, and as AM otherwise.
 */
const parseClock = (value) => {
  const raw = timePart(value);
  if (!raw) return null;

  const match = raw.match(/(\d{1,2})(?::(\d{2}))(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = (match[4] || '').toUpperCase();

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'AM' && hour === 12) hour = 0;
    if (period === 'PM' && hour !== 12) hour += 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return {
    hour,
    minute,
    time: `${pad(hour)}:${pad(minute)}:00`
  };
};

const formatClock12 = (value) => {
  const parsed = typeof value === 'object' && value !== null && 'hour' in value
    ? value
    : parseClock(value);
  if (!parsed) return timePart(value);

  const hour = parsed.hour % 12 || 12;
  const period = parsed.hour >= 12 ? 'PM' : 'AM';
  return `${hour}:${pad(parsed.minute)} ${period}`;
};

const splitClassTime = (value) => {
  const raw = timePart(value);
  if (!raw) return { start: '', end: '' };
  const parts = raw.split(/\s*(?:-|–|—|\bto\b)\s*/i);
  return {
    start: parts[0]?.trim() || '',
    end: parts.slice(1).join(' - ').trim() || ''
  };
};

const formatClassTime = (value) => {
  const raw = timePart(value);
  if (!raw) return '';
  const { start, end } = splitClassTime(raw);
  const parsedStart = parseClock(start);
  const parsedEnd = parseClock(end);
  if (parsedStart && parsedEnd) {
    return `${formatClock12(parsedStart)} - ${formatClock12(parsedEnd)}`;
  }
  if (parsedStart && !end) return formatClock12(parsedStart);
  return raw;
};

const parseClassTime = (value) => {
  const { start, end } = splitClassTime(value);
  return {
    startTime: parseClock(start)?.time || null,
    endTime: parseClock(end)?.time || null,
    display: formatClassTime(value)
  };
};

module.exports = {
  formatClassTime,
  formatClock12,
  parseClassTime,
  parseClock
};

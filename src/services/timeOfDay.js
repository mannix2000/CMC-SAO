/**
 * Helpers for the event-level Morning/Afternoon Start & Cutoff schedule.
 * Stored as Postgres TIME (via Prisma @db.Time), which Prisma reads/writes as a
 * UTC-based Date with an arbitrary date part - only the UTC hours/minutes matter.
 */

function buildTimeOptions(stepMinutes = 15) {
  const options = [{ value: '', label: '—' }];
  for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const value = `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    options.push({ value, label: formatHm(h24, m) });
  }
  return options;
}

function formatHm(h24, m) {
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatTimeOfDay(date) {
  if (!date) return '';
  return formatHm(date.getUTCHours(), date.getUTCMinutes());
}

function timeOfDayToValue(date) {
  if (!date) return '';
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function parseTimeOfDay(value) {
  if (!value) return null;
  return new Date(`1970-01-01T${value}:00.000Z`);
}

module.exports = { buildTimeOptions, formatTimeOfDay, timeOfDayToValue, parseTimeOfDay };

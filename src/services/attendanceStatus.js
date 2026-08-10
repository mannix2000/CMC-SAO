/**
 * Derives an attendance check's status (present/late/absent) automatically from the
 * event's morning/afternoon cutoff schedule and the times an officer has actually
 * recorded, instead of an officer picking a status by hand. A session only "counts"
 * if the event has a cutoff configured for it - without a cutoff there's no deadline
 * to judge lateness or lapse against, so that session is skipped entirely.
 */

/**
 * Combines an event's calendar date with a @db.Time-style time-of-day value (stored
 * as a UTC-based Date where only the UTC hours/minutes are meaningful, per
 * services/timeOfDay.js) into a real, comparable moment in the server's local time zone.
 */
function buildScheduledMoment(eventDate, timeOfDay) {
  if (!eventDate || !timeOfDay) return null;
  return new Date(
    eventDate.getUTCFullYear(),
    eventDate.getUTCMonth(),
    eventDate.getUTCDate(),
    timeOfDay.getUTCHours(),
    timeOfDay.getUTCMinutes(),
    0,
    0
  );
}

function computeSessionState({ eventDate, cutoff, timeIn, now }) {
  const cutoffMoment = buildScheduledMoment(eventDate, cutoff);
  if (!cutoffMoment) return null;
  if (timeIn) return timeIn > cutoffMoment ? 'late' : 'present';
  return now > cutoffMoment ? 'absent' : null;
}

/**
 * Returns 'present' | 'late' | 'absent' | null (null = still pending; not enough
 * has happened yet to grade it - either no cutoff is configured, or the cutoff
 * hasn't passed yet and the student hasn't checked in).
 */
function computeAutoStatus(event, check, now = new Date()) {
  const amState = computeSessionState({
    eventDate: event.eventDate,
    cutoff: event.morningCutoff,
    timeIn: check?.timeInAm,
    now,
  });
  const pmState = computeSessionState({
    eventDate: event.eventDate,
    cutoff: event.afternoonCutoff,
    timeIn: check?.timeInPm,
    now,
  });

  const states = [amState, pmState].filter((s) => s !== null);
  if (states.length === 0) return null;
  if (states.includes('absent')) return 'absent';
  if (states.includes('late')) return 'late';
  return 'present';
}

module.exports = { computeAutoStatus, buildScheduledMoment };

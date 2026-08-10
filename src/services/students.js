const prisma = require('../config/db');

async function getFilterOptions() {
  const [courses, yearLevels, sections] = await Promise.all([
    prisma.student.findMany({ distinct: ['course'], select: { course: true }, orderBy: { course: 'asc' } }),
    prisma.student.findMany({ distinct: ['yearLevel'], select: { yearLevel: true }, orderBy: { yearLevel: 'asc' } }),
    prisma.student.findMany({ distinct: ['section'], select: { section: true }, orderBy: { section: 'asc' } }),
  ]);
  return {
    courses: courses.map((c) => c.course),
    yearLevels: yearLevels.map((y) => y.yearLevel),
    sections: sections.map((s) => s.section),
  };
}

function buildStudentWhere({ q, course, yearLevel, section }) {
  const and = [];
  if (q) {
    and.push({
      OR: [
        { studentNumber: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { course: { contains: q, mode: 'insensitive' } },
        { section: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (course) and.push({ course });
  if (yearLevel) and.push({ yearLevel });
  if (section) and.push({ section });
  return and.length ? { AND: and } : {};
}

function nextStudentNumber(value) {
  const match = value.match(/^(.*?)(\d+)$/);
  if (!match) return `${value}-2`;
  const [, prefix, digits] = match;
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return `${prefix}${next}`;
}

/**
 * Returns `desired` if free, otherwise bumps its trailing number (e.g. "1A-003" -> "1A-004")
 * until it finds one that isn't already taken, so adding a student never blocks on a duplicate.
 */
async function resolveAvailableStudentNumber(desired) {
  let candidate = desired;
  for (let attempts = 0; attempts < 1000; attempts += 1) {
    const existing = await prisma.student.findUnique({ where: { studentNumber: candidate }, select: { id: true } });
    if (!existing) return candidate;
    candidate = nextStudentNumber(candidate);
  }
  throw new Error('Could not find an available student number.');
}

module.exports = { getFilterOptions, buildStudentWhere, resolveAvailableStudentNumber };

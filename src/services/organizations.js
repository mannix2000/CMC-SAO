const prisma = require('../config/db');

async function listOrganizations() {
  return prisma.organization.findMany({
    include: { _count: { select: { members: true } } },
    orderBy: { name: 'asc' },
  });
}

async function getOrganization(id) {
  return prisma.organization.findUnique({ where: { id } });
}

/**
 * Adds/removes members of an organization based on which of the given candidate
 * student IDs are checked, scoped to just that candidate set so it never touches
 * memberships for students outside the current search/filter view.
 */
async function syncMembers(organizationId, candidateStudentIds, checkedStudentIds) {
  const checked = new Set(checkedStudentIds.map(Number));
  const toAdd = candidateStudentIds.filter((id) => checked.has(id));
  const toRemove = candidateStudentIds.filter((id) => !checked.has(id));

  await prisma.$transaction([
    ...toAdd.map((studentId) =>
      prisma.organizationMember.upsert({
        where: { organizationId_studentId: { organizationId, studentId } },
        create: { organizationId, studentId },
        update: {},
      })
    ),
    prisma.organizationMember.deleteMany({
      where: { organizationId, studentId: { in: toRemove } },
    }),
  ]);
}

async function listMemberStudentIds(organizationId) {
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId));
}

module.exports = { listOrganizations, getOrganization, syncMembers, listMemberStudentIds };

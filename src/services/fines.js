const prisma = require('../config/db');
const { getSettings } = require('./settings');
const { toCsv } = require('./csv');
const { formatClockTime } = require('./timeOfDay');

const FINABLE_STATUSES = ['absent', 'late'];

/**
 * Creates, updates, or removes the Fine tied to an attendance check, based on the
 * check's current status and the school's configured Absent/Late fees. Paid fines
 * are left untouched (they're a settled financial record) even if the underlying
 * attendance status is later corrected.
 */
async function syncFineForCheck(check) {
  const settings = await getSettings();
  const existing = await prisma.fine.findUnique({ where: { attendanceCheckId: check.id } });

  if (FINABLE_STATUSES.includes(check.status)) {
    const amount = check.status === 'absent' ? settings.absentFee : settings.lateFee;

    if (existing) {
      if (existing.status === 'unpaid') {
        await prisma.fine.update({
          where: { id: existing.id },
          data: { reason: check.status, amount, orgRole: check.officerRole },
        });
      }
      return;
    }

    if (Number(amount) > 0) {
      await prisma.fine.create({
        data: {
          attendanceCheckId: check.id,
          studentId: check.studentId,
          eventId: check.eventId,
          orgRole: check.officerRole,
          reason: check.status,
          amount,
          status: 'unpaid',
        },
      });
    }
    return;
  }

  if (existing && existing.status === 'unpaid') {
    await prisma.fine.delete({ where: { id: existing.id } });
  }
}

async function listFines({ orgRole, status } = {}) {
  return prisma.fine.findMany({
    where: { orgRole: orgRole || undefined, status: status || undefined },
    include: { student: true, event: true, paidBy: true, attendanceCheck: true },
    orderBy: [{ createdAt: 'desc' }],
  });
}

async function getFineSummary(orgRole) {
  const [unpaidAgg, paidAgg] = await Promise.all([
    prisma.fine.aggregate({ where: { orgRole, status: 'unpaid' }, _sum: { amount: true }, _count: true }),
    prisma.fine.aggregate({ where: { orgRole, status: 'paid' }, _sum: { amount: true }, _count: true }),
  ]);
  return {
    unpaidTotal: Number(unpaidAgg._sum.amount || 0),
    unpaidCount: unpaidAgg._count,
    paidTotal: Number(paidAgg._sum.amount || 0),
    paidCount: paidAgg._count,
  };
}

async function markPaid(id, paidById) {
  return prisma.fine.update({
    where: { id },
    data: { status: 'paid', paidAt: new Date(), paidById },
  });
}

async function markUnpaid(id) {
  return prisma.fine.update({
    where: { id },
    data: { status: 'unpaid', paidAt: null, paidById: null },
  });
}

function buildFinesCsv(fines) {
  const columns = [
    { label: 'Date', value: (f) => f.createdAt.toISOString().slice(0, 10) },
    { label: 'Org', value: (f) => f.orgRole.toUpperCase() },
    { label: 'Student Number', value: (f) => f.student.studentNumber },
    { label: 'Student Name', value: (f) => `${f.student.lastName}, ${f.student.firstName}` },
    { label: 'Event', value: (f) => f.event.name },
    { label: 'Reason', value: (f) => f.reason },
    { label: 'Morning Time In', value: (f) => formatClockTime(f.attendanceCheck?.timeInAm) || '' },
    { label: 'Morning Time Out', value: (f) => formatClockTime(f.attendanceCheck?.timeOutAm) || '' },
    { label: 'Afternoon Time In', value: (f) => formatClockTime(f.attendanceCheck?.timeInPm) || '' },
    { label: 'Afternoon Time Out', value: (f) => formatClockTime(f.attendanceCheck?.timeOutPm) || '' },
    { label: 'Amount', value: (f) => Number(f.amount).toFixed(2) },
    { label: 'Status', value: (f) => f.status },
    { label: 'Paid By', value: (f) => f.paidBy?.username || '' },
  ];
  return toCsv(fines, columns);
}

module.exports = { syncFineForCheck, listFines, getFineSummary, markPaid, markUnpaid, buildFinesCsv };

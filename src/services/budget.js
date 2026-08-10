const prisma = require('../config/db');
const { toCsv } = require('./csv');

const ORG_ROLES = ['ssg', 'nstp'];

async function getSummary(orgRole) {
  const [incomeAgg, expenseAgg] = await Promise.all([
    prisma.budgetEntry.aggregate({ where: { orgRole, type: 'income' }, _sum: { amount: true } }),
    prisma.budgetEntry.aggregate({ where: { orgRole, type: 'expense' }, _sum: { amount: true } }),
  ]);
  const income = Number(incomeAgg._sum.amount || 0);
  const expense = Number(expenseAgg._sum.amount || 0);
  return { income, expense, balance: income - expense };
}

async function getSummaries() {
  const summaries = {};
  for (const orgRole of ORG_ROLES) {
    summaries[orgRole] = await getSummary(orgRole);
  }
  return summaries;
}

/** Same shape as getSummary, but scoped to a custom Organization instead of SSG/NSTP. */
async function getOrganizationSummary(organizationId) {
  const [incomeAgg, expenseAgg] = await Promise.all([
    prisma.budgetEntry.aggregate({ where: { organizationId, type: 'income' }, _sum: { amount: true } }),
    prisma.budgetEntry.aggregate({ where: { organizationId, type: 'expense' }, _sum: { amount: true } }),
  ]);
  const income = Number(incomeAgg._sum.amount || 0);
  const expense = Number(expenseAgg._sum.amount || 0);
  return { income, expense, balance: income - expense };
}

async function listEntries({ orgRole, organizationId, category, type } = {}) {
  let scopeFilter;
  if (organizationId) {
    scopeFilter = { organizationId };
  } else if (orgRole) {
    scopeFilter = { orgRole };
  } else {
    // No specific org/role requested: the SSG/NSTP combined view, never mixing in
    // entries that belong to a custom Organization instead.
    scopeFilter = { orgRole: { not: null } };
  }

  return prisma.budgetEntry.findMany({
    where: {
      ...scopeFilter,
      category: category ? { equals: category, mode: 'insensitive' } : undefined,
      type: type || undefined,
    },
    include: { event: true, recordedBy: true, organization: true },
    orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
  });
}

function buildBudgetCsv(entries) {
  const columns = [
    { label: 'Date', value: (e) => e.entryDate.toISOString().slice(0, 10) },
    { label: 'Org', value: (e) => (e.organization ? e.organization.name : e.orgRole.toUpperCase()) },
    { label: 'Type', value: (e) => e.type },
    { label: 'Category', value: (e) => e.category },
    { label: 'Description', value: (e) => e.description },
    { label: 'Amount', value: (e) => Number(e.amount).toFixed(2) },
    { label: 'Event', value: (e) => e.event?.name || '' },
    { label: 'Recorded By', value: (e) => e.recordedBy?.username || '' },
  ];
  return toCsv(entries, columns);
}

module.exports = { ORG_ROLES, getSummary, getSummaries, getOrganizationSummary, listEntries, buildBudgetCsv };

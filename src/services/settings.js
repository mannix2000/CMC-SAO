const prisma = require('../config/db');

let cached = null;

async function getSettings() {
  if (cached) return cached;
  cached = await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  return cached;
}

async function updateSettings(data) {
  cached = await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  return cached;
}

module.exports = { getSettings, updateSettings };

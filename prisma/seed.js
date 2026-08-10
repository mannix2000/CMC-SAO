require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error('SEED_ADMIN_PASSWORD must be set in .env before seeding.');
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`Admin user "${username}" already exists, skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { username, email, passwordHash, role: 'admin' },
  });

  console.log(`Created admin user "${username}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

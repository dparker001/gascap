// Must set env BEFORE any imports that use it
import { config } from 'dotenv';
config({ path: '.env.local' });

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/lib/generated/prisma/client';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const users = await prisma.user.findMany({
    where: { isProTrial: true },
    select: { name:true, email:true, trialExpiresAt:true, createdAt:true, loginCount:true, calcCount:true, streak:true },
    orderBy: { createdAt: 'asc' }
  });

  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
  await pool.end();
}
main().catch(console.error);

/**
 * Prisma client singleton — Prisma 7 driver-adapter pattern.
 *
 * Prisma 7 uses driver adapters instead of the built-in query engine.
 * We use @prisma/adapter-pg with the standard `pg` Pool.
 *
 * The singleton pattern prevents multiple Pool + Client instances in
 * Next.js dev mode (hot reload creates new module instances).
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function createPrismaClient(): PrismaClient {
  const pool = globalForPrisma.pgPool ?? new Pool({
    connectionString: process.env.DATABASE_URL,
    // Railway PostgreSQL requires SSL in production
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.pgPool = pool;
  }

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

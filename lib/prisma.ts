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

export const pgPool = globalForPrisma.pgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max:             10,   // cap concurrent connections (Railway starter allows ~25 total)
  idleTimeoutMillis: 30_000,   // release idle connections after 30s
  connectionTimeoutMillis: 5_000,  // fail fast if pool is exhausted rather than hang
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.pgPool = pgPool;

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg(pgPool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

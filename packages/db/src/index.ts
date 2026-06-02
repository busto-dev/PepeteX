import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  __pepetexPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__pepetexPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pepetexPrisma = prisma;
}

export * from '@prisma/client';

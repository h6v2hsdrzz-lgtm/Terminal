import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Client Prisma unique, sur PostgreSQL.
 *
 * En développement, Next recharge les modules à chaque modification : sans ce
 * cache sur `globalThis`, chaque rechargement ouvrirait un pool de connexions
 * de plus — et une base gratuite en compte peu.
 */
const global_ = globalThis as unknown as { prisma?: PrismaClient };

function creerClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquante — voir joie/README.md.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export const prisma = global_.prisma ?? creerClient();

if (process.env.NODE_ENV !== "production") global_.prisma = prisma;

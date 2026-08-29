import "server-only";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Client Prisma unique. En développement, Next recharge les modules à chaque
 * modification : sans ce cache sur `globalThis`, chaque rechargement ouvrirait
 * une connexion SQLite de plus.
 */
const global_ = globalThis as unknown as { prisma?: PrismaClient };

function creerClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

export const prisma = global_.prisma ?? creerClient();

if (process.env.NODE_ENV !== "production") global_.prisma = prisma;

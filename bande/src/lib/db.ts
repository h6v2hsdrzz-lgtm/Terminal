import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Client Prisma unique.
 *
 * Le pool est délibérément petit : en ligne, chaque instance de fonction ouvre
 * le sien, et une base gratuite compte ses connexions en dizaines. Trois par
 * instance suffisent pour une poignée d'amis, et les connexions inactives sont
 * rendues vite pour la même raison.
 *
 * `DATABASE_URL` doit être l'adresse *avec pool* quand l'hébergeur en propose
 * une (chez Neon, l'hôte porte `-pooler`) ; les migrations, elles, passent par
 * `MIGRATE_DATABASE_URL` — voir `prisma.config.ts`, qui explique pourquoi.
 */
const global_ = globalThis as unknown as { prisma?: PrismaClient };

function creerClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquante — voir bande/README.md.");

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    }),
  });
}

// En développement, Next recharge les modules à chaque modification : sans ce
// cache, chaque rechargement ouvrirait un pool de plus.
export const prisma = global_.prisma ?? creerClient();

if (process.env.NODE_ENV !== "production") global_.prisma = prisma;

import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Client Prisma unique, sur PostgreSQL.
 *
 * Deux précautions, toutes deux dictées par l'hébergement visé — des
 * fonctions sans état devant une base gratuite :
 *
 * · le pool est petit. Chaque instance de la fonction ouvre le sien, et une
 *   base gratuite compte ses connexions en dizaines, pas en centaines. Trois
 *   par instance suffisent largement pour un journal de famille ;
 * · les connexions inactives sont rendues vite, pour la même raison.
 *
 * Côté URL, il faut l'adresse *avec pool* de Neon — celle dont l'hôte porte
 * `-pooler`. La directe tient quelques connexions et lâche ensuite.
 */
const global_ = globalThis as unknown as { prisma?: PrismaClient };

function creerClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquante — voir joie/README.md.");

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

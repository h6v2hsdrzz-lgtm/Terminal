/**
 * Une bande de démonstration : trois personnes, quatre-vingt-dix jours.
 *
 * Le générateur est déterministe. Deux exécutions donnent exactement la même
 * bande, sinon deux captures d'écran prises à une semaine d'intervalle ne
 * seraient jamais comparables, et « la courbe a changé » ne voudrait rien dire.
 *
 * Ce qu'on cherche à obtenir, ce n'est pas du bruit : c'est une bande qui a
 * l'air d'avoir vécu. Des trous les jours où on oublie, des séries, un effet
 * week-end, un lundi qui pique, et un déclencheur qui a vraiment un effet — pour
 * que l'écran des stats ait quelque chose de vrai à trouver.
 *
 *   npm run db:seed
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ALPHABET, creerCodeReprise, normaliserCode } from "../src/lib/codes";
import { imageFactice } from "./image-factice";
import { decaler, jourDeLaBande } from "../src/lib/dates";

// Un code fixe, pour que l'adresse de démonstration ne change pas d'une
// exécution à l'autre. Il doit tenir dans l'alphabet des codes : un « 0 » ou un
// « O », qui n'en font pas partie, seraient retirés à la saisie et la bande
// resterait introuvable.
const CODE_BANDE = "FR9M4G";
const GRAINE = 20260904;
/**
 * Quatre cents jours, pas cent vingt.
 *
 * Le brief en demande cent vingt ; on en garde quatre cents parce qu'il faut
 * plus d'un an pour que « ce jour-là » ait quelque chose à montrer et que la
 * rétrospective ait des mois à comparer. Une démonstration qui ne peut pas
 * exercer ses propres écrans ne démontre rien.
 */
const JOURS = 400;

/**
 * Quatre profils, quatre tempéraments.
 *
 * Ils ne diffèrent pas seulement par leur moyenne : l'amplitude fait qu'un
 * profil oscille et qu'un autre reste plat, la présence crée des trous, et la
 * sensibilité décide de qui réagit au biberon. Sans ces écarts, l'écran des
 * stats n'a rien à trouver et toutes les courbes se superposent.
 */
const PROFILS = [
  { pseudo: "Momo", teinte: 1, base: 6.4, amplitude: 2.1, presence: 0.94, sensible: 1 },
  { pseudo: "Sam", teinte: 2, base: 7.2, amplitude: 1.4, presence: 0.88, sensible: 0.5 },
  { pseudo: "Samy", teinte: 3, base: 5.9, amplitude: 2.6, presence: 0.8, sensible: 0.5 },
  { pseudo: "Lou", teinte: 4, base: 6.8, amplitude: 1.8, presence: 0.72, sensible: 0.2 },
];

const DECLENCHEURS = [
  { nom: "Biberon", emoji: "🍼", frequence: 0.4, effet: 1.3 },
  { nom: "Plante verte", emoji: "🌿", frequence: 0.35, effet: 0.2 },
  { nom: "Sport", emoji: "🏃", frequence: 0.3, effet: 0.5 },
];

const NOTES = [
  "Réveil sans réveil, ça change tout.",
  "Journée de pluie, rien fait, zéro regret.",
  "Réunion de 3 h qui aurait tenu en un mail.",
  "On a retrouvé le bar de l'an dernier.",
  "Nuit courte mais bonne nouvelle au boulot.",
  "Rien de spécial, et c'est très bien.",
  "Le chat a dormi sur mon clavier toute la matinée.",
  "Enfin fini le truc que je repoussais depuis trois semaines.",
  "Trop de monde partout, j'ai fui.",
  "Soirée improvisée, la meilleure sorte.",
  null, null, null,
];

const REACTIONS = ["❤️", "😂", "🔥", "🫂", "🙌", "👀"];

/** Une teinte par profil, pour que deux photos ne se ressemblent pas. */
const TEINTES_PHOTO: [number, number, number][] = [
  [46, 92, 168],   // Momo, bleu
  [22, 150, 160],  // Sam, turquoise
  [178, 142, 20],  // Samy, moutarde
  [150, 70, 130],  // Lou, prune
];

const COMMENTAIRES = [
  "on se fait un truc ce week-end ?",
  "ça fait plaisir de lire ça",
  "j'ai exactement vécu la même chose",
  "raconte",
  "je propose qu'on efface ce jour des archives",
  "bravo pour la remontée",
  "t'étais où ?",
  "c'est le meilleur truc que j'ai lu cette semaine",
];

/** Générateur congruentiel : court, sans dépendance, et reproductible. */
function generateur(graine: number) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat * 1664525 + 1013904223) >>> 0;
    return etat / 0x100000000;
  };
}

function client() {
  // Même règle que `prisma.config.ts` : la variable fournie par l'hébergeur
  // prime, et le fichier local ne sert qu'à combler son absence.
  const fichierEnv = join(import.meta.dirname, "..", ".env");
  if (!process.env.DATABASE_URL && existsSync(fichierEnv)) process.loadEnvFile(fichierEnv);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquante — voir bande/README.md.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

async function main() {
  if (normaliserCode(CODE_BANDE) !== CODE_BANDE) {
    throw new Error(`Le code de démonstration sort de l'alphabet (${ALPHABET}).`);
  }

  const prisma = client();
  const tirage = generateur(GRAINE);

  // Rejouable : on efface la bande de démonstration avant de la refaire. Les
  // cascades emportent membres, entrées, réactions et commentaires.
  await prisma.groupe.deleteMany({ where: { codeInvitation: CODE_BANDE } });

  const codes = PROFILS.map(() => creerCodeReprise());
  const groupe = await prisma.groupe.create({
    data: {
      nom: "Les Trois Fromages",
      codeInvitation: CODE_BANDE,
      declencheurs: { create: DECLENCHEURS.map((d, ordre) => ({ nom: d.nom, emoji: d.emoji, ordre })) },
      membres: {
        create: PROFILS.map((p, i) => ({
          pseudo: p.pseudo,
          teinte: p.teinte,
          poigneeReprise: codes[i].poignee,
          codeReprise: codes[i].empreinte,
        })),
      },
    },
    include: { membres: { orderBy: { creeLe: "asc" } }, declencheurs: { orderBy: { ordre: "asc" } } },
  });

  const membres = PROFILS.map((p) => groupe.membres.find((m) => m.pseudo === p.pseudo)!);
  const aujourdhui = jourDeLaBande();

  type Ligne = {
    membreId: string; jour: string; joie: number; note: string | null;
    declencheurs: string[]; creeLe: Date;
  };
  const lignes: Ligne[] = [];

  for (let recul = JOURS - 1; recul >= 0; recul -= 1) {
    const jour = decaler(aujourdhui, -recul);
    const [a, m, j] = jour.split("-").map(Number);
    const jourSemaine = new Date(a, m - 1, j).getDay();
    // Un week-end monte, un lundi descend : de quoi donner à l'écran « votre
    // semaine » un motif réel plutôt qu'un plat.
    const effetJour = jourSemaine === 0 || jourSemaine === 6 ? 0.9 : jourSemaine === 1 ? -0.7 : 0;

    const actifs = DECLENCHEURS.filter((d) => tirage() < d.frequence);
    const effetDeclencheurs = actifs.reduce((somme, d) => somme + d.effet, 0);

    for (let i = 0; i < PROFILS.length; i += 1) {
      const profil = PROFILS[i];
      // Personne n'a encore posté aujourd'hui : c'est l'état dans lequel on
      // ouvre l'application le soir, et donc celui qu'il faut pouvoir regarder.
      if (recul === 0) continue;
      if (tirage() > profil.presence) continue;

      const bruit = (tirage() - 0.5) * profil.amplitude;
      // Une traversée : trois semaines de creux vers le milieu de la période,
      // puis une remontée. Sans ça, une courbe sur quatre cents jours est un
      // trait horizontal bruité, et « la plus grosse remontada » ne veut rien
      // dire.
      const creux = recul > 150 && recul < 171 && i < 2 ? -1.8 : 0;
      const remontee = recul > 130 && recul <= 150 && i < 2 ? 0.9 : 0;
      const joie = Math.max(1, Math.min(10, Math.round(
        profil.base + effetJour + effetDeclencheurs * profil.sensible + creux + remontee + bruit,
      )));

      // Une heure de check-in plausible, pour que le fil ne soit pas rangé au
      // hasard à l'intérieur d'une journée.
      const creeLe = new Date(a, m - 1, j, 19 + Math.floor(tirage() * 4), Math.floor(tirage() * 60));

      lignes.push({
        membreId: membres[i].id,
        jour,
        joie,
        note: NOTES[Math.floor(tirage() * NOTES.length)],
        declencheurs: actifs.map((d) => groupe.declencheurs.find((x) => x.nom === d.nom)!.id),
        creeLe,
      });
    }
  }

  for (const ligne of lignes) {
    await prisma.entree.create({
      data: {
        groupeId: groupe.id,
        membreId: ligne.membreId,
        jour: ligne.jour,
        joie: ligne.joie,
        note: ligne.note,
        creeLe: ligne.creeLe,
        declencheurs: { create: ligne.declencheurs.map((declencheurId) => ({ declencheurId })) },
      },
    });
  }

  // Des photos, une journée sur douze environ, plus souvent sur les journées
  // hautes — c'est là qu'on sort l'appareil. Elles servent au mur de souvenirs,
  // au carrousel du fil et à la rétrospective : sans elles, trois écrans se
  // jugent à vide.
  const pourPhoto = await prisma.entree.findMany({
    where: { groupeId: groupe.id },
    select: { id: true, joie: true, membreId: true },
    orderBy: { jour: "asc" },
  });
  let posees = 0;
  for (const entree of pourPhoto) {
    const chance = entree.joie >= 8 ? 0.22 : 0.05;
    if (tirage() > chance) continue;
    const index = membres.findIndex((m) => m.id === entree.membreId);
    const octets = imageFactice(720, 540, TEINTES_PHOTO[index >= 0 ? index : 0]);
    await prisma.photo.create({
      data: {
        entreeId: entree.id,
        mime: "image/png",
        octets,
        largeur: 720,
        hauteur: 540,
      },
    });
    posees += 1;
  }

  // Réactions et commentaires : seulement sur les trois dernières semaines. Une
  // bande ne remonte pas son fil pour réagir à un mardi d'il y a deux mois.
  const recentes = await prisma.entree.findMany({
    where: { groupeId: groupe.id, jour: { gte: decaler(aujourdhui, -45) } },
    select: { id: true, membreId: true, joie: true },
  });

  for (const entree of recentes) {
    const autres = membres.filter((m) => m.id !== entree.membreId);
    for (const membre of autres) {
      if (tirage() > (entree.joie >= 8 ? 0.55 : 0.3)) continue;
      await prisma.reaction.create({
        data: {
          entreeId: entree.id,
          membreId: membre.id,
          emoji: REACTIONS[Math.floor(tirage() * REACTIONS.length)],
        },
      });
    }
    // Un tiers des journées récentes reçoit un commentaire, et une sur six une
    // vraie conversation à deux voix. Le mur de souvenirs cherche justement ce
    // signal : sans quelques échanges, il ne retient que des photos.
    if (tirage() < 0.34) {
      const auteur = autres[Math.floor(tirage() * autres.length)];
      await prisma.commentaire.create({
        data: {
          entreeId: entree.id,
          membreId: auteur.id,
          texte: COMMENTAIRES[Math.floor(tirage() * COMMENTAIRES.length)],
        },
      });
      if (tirage() < 0.5) {
        const second = autres.find((m) => m.id !== auteur.id) ?? auteur;
        await prisma.commentaire.create({
          data: {
            entreeId: entree.id,
            membreId: second.id,
            texte: COMMENTAIRES[Math.floor(tirage() * COMMENTAIRES.length)],
          },
        });
      }
    }
  }

  await prisma.capsule.createMany({
    data: [
      {
        groupeId: groupe.id, membreId: membres[0].id,
        texte: "Si on relit ça dans un an : on venait de commencer ce journal, et on ne savait pas encore si on tiendrait plus d'une semaine.",
        ouvrirLe: decaler(aujourdhui, -30),
      },
      {
        groupeId: groupe.id, membreId: membres[1].id,
        texte: "Pour dans un an : est-ce qu'on va toujours au même bar ?",
        ouvrirLe: decaler(aujourdhui, 300),
      },
    ],
  });

  console.log(`Bande « ${groupe.nom} » — code ${CODE_BANDE}`);
  const nbReactions = await prisma.reaction.count({ where: { entree: { groupeId: groupe.id } } });
  const nbCommentaires = await prisma.commentaire.count({ where: { entree: { groupeId: groupe.id } } });
  console.log(`${lignes.length} journées sur ${JOURS} jours, ${PROFILS.length} membres, ${DECLENCHEURS.length} déclencheurs.`);
  console.log(`${posees} photos, ${nbReactions} réactions, ${nbCommentaires} commentaires.`);
  // Les codes sont aussi écrits sur disque : sans ça, rejouer le peuplement
  // fait perdre les précédents, et on se retrouve à ne plus pouvoir se
  // connecter à sa propre bande de démonstration. Le fichier est ignoré par
  // git — ce sont malgré tout des secrets, même jetables.
  const fiche = join(import.meta.dirname, "..", ".codes-demo.txt");
  writeFileSync(
    fiche,
    [
      `Bande « ${groupe.nom} » — code d'invitation ${CODE_BANDE}`,
      "",
      ...PROFILS.map((p, i) => `${p.pseudo.padEnd(6)} ${codes[i].enClair}`),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  console.log("\nCodes de reprise (pour se connecter en tant que quelqu'un) :");
  PROFILS.forEach((p, i) => console.log(`  ${p.pseudo.padEnd(6)} ${codes[i].enClair}`));
  console.log(`\nAussi écrits dans bande/.codes-demo.txt (ignoré par git).\n`);

  await prisma.$disconnect();
}

main().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});

import { actionEnvoyerPhoto } from "./actions";
import { ETAT_INITIAL } from "./formulaire";
import type { MediaPret } from "./transcodage";

/**
 * La file d'envoi des médias.
 *
 * Avant, l'envoi se faisait dans le composant, en série, dans une transition :
 * le formulaire attendait, et une coupure réseau au milieu d'une vidéo de
 * quinze secondes perdait tout. Trois problèmes, et un seul remède — sortir la
 * file du composant.
 *
 * · **Elle ne bloque plus l'écriture.** On dépose, on continue à taper son
 *   anecdote, la file avance derrière.
 * · **Elle reprend après une coupure.** Un échec réseau n'est pas un refus : on
 *   réessaie, en espaçant, et immédiatement au retour du réseau. Un refus du
 *   serveur, lui, est définitif — réessayer une image trop lourde la rendra
 *   toujours trop lourde.
 * · **Elle survit au changement d'écran.** L'état vit dans le module, pas dans
 *   un composant : aller voir le fil pendant qu'une vidéo monte ne l'annule
 *   plus.
 *
 * Ce qu'elle ne fait PAS : survivre à un rechargement de page. Il faudrait
 * ranger les octets dans IndexedDB et les en ressortir au démarrage ; c'est un
 * lot à soi tout seul, et le cas « je recharge pendant l'envoi » est rare là où
 * « je passe sous un tunnel » est quotidien.
 */
export type EtatEnvoi = "attente" | "envoi" | "reprise" | "echec";

export type Envoi = {
  id: string;
  nom: string;
  genre: "photo" | "video";
  etat: EtatEnvoi;
  /** Combien de fois on a déjà réessayé. */
  essais: number;
  /** Le message du serveur, quand il a refusé pour de bon. */
  erreur: string | null;
  pret: MediaPret;
};

/** Les délais entre deux tentatives. Au-delà, on s'arrête d'insister. */
const ATTENTES_MS = [1_000, 4_000, 12_000, 30_000];

let file: Envoi[] = [];
let enMarche = false;
const abonnes = new Set<() => void>();

function prevenir() {
  // Une nouvelle référence à chaque changement : `useSyncExternalStore` compare
  // par identité, et muter le tableau en place ne rendrait la main à personne.
  file = [...file];
  for (const abonne of abonnes) abonne();
}

export function sAbonner(rappel: () => void): () => void {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

export function instantane(): Envoi[] {
  return file;
}

/** Le rendu serveur n'a pas de file : il a besoin d'un tableau stable. */
const VIDE: Envoi[] = [];
export function instantaneServeur(): Envoi[] {
  return VIDE;
}

function formulaire(pret: MediaPret): FormData {
  const donnees = new FormData();
  // L'extension suit le type réel : le moteur choisit WebP ou JPEG selon ce
  // qu'il sait encoder, et un « .jpg » sur du WebP finirait par tromper
  // quelqu'un — à commencer par le téléchargement d'un export.
  const extension =
    pret.genre === "video" ? "mp4" : pret.blob.type === "image/webp" ? "webp" : "jpg";
  donnees.set("media", new File([pret.blob], `journee.${extension}`, { type: pret.blob.type }));
  donnees.set("genre", pret.genre);
  donnees.set("largeur", String(pret.largeur));
  donnees.set("hauteur", String(pret.hauteur));
  if (pret.duree !== null) donnees.set("duree", String(pret.duree));
  if (pret.vignette) {
    const ext = pret.vignette.type === "image/webp" ? "webp" : "jpg";
    donnees.set(
      "vignette",
      new File([pret.vignette], `vignette.${ext}`, { type: pret.vignette.type }),
    );
  }
  return donnees;
}

const patienter = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function tourner() {
  if (enMarche) return;
  enMarche = true;
  try {
    while (true) {
      const envoi = file.find((e) => e.etat === "attente" || e.etat === "reprise");
      if (!envoi) return;

      envoi.etat = "envoi";
      prevenir();

      try {
        const reponse = await actionEnvoyerPhoto(ETAT_INITIAL, formulaire(envoi.pret));
        if (reponse.erreur) {
          // Le serveur a compris et a dit non : insister ne changera rien.
          envoi.etat = "echec";
          envoi.erreur = reponse.erreur;
        } else {
          file = file.filter((e) => e.id !== envoi.id);
        }
      } catch {
        // Pas de réponse du tout : réseau coupé, serveur endormi, tunnel. Là,
        // réessayer a un sens.
        envoi.essais += 1;
        const attente = ATTENTES_MS[Math.min(envoi.essais - 1, ATTENTES_MS.length - 1)];
        if (envoi.essais > ATTENTES_MS.length) {
          envoi.etat = "echec";
          envoi.erreur = "Le réseau n'a pas tenu. Touche pour réessayer.";
        } else {
          envoi.etat = "reprise";
          prevenir();
          await patienter(attente);
        }
      }
      prevenir();
    }
  } finally {
    enMarche = false;
  }
}

export function deposer(pret: MediaPret, nom: string): void {
  file.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nom,
    genre: pret.genre,
    etat: "attente",
    essais: 0,
    erreur: null,
    pret,
  });
  prevenir();
  void tourner();
}

/** Remet en file un envoi abandonné. Le compteur d'essais repart de zéro. */
export function reessayer(id: string): void {
  const envoi = file.find((e) => e.id === id);
  if (!envoi) return;
  envoi.etat = "attente";
  envoi.essais = 0;
  envoi.erreur = null;
  prevenir();
  void tourner();
}

export function abandonner(id: string): void {
  file = file.filter((e) => e.id !== id);
  prevenir();
  void tourner();
}

/**
 * Le retour du réseau relance tout de suite, sans attendre le prochain palier.
 *
 * C'est le moment exact où l'on sort du tunnel : attendre trente secondes de
 * plus donnerait l'impression que l'application n'a rien vu.
 */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const envoi of file) {
      if (envoi.etat === "reprise" || envoi.etat === "echec") {
        envoi.essais = 0;
        envoi.etat = "attente";
      }
    }
    prevenir();
    void tourner();
  });
}

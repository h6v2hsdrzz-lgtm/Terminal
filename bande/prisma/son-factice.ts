/**
 * Un son de peuplement : un vrai fichier, pas un octet de remplissage.
 *
 * Il aurait été plus court d'écrire n'importe quoi dans la colonne et de
 * fabriquer des niveaux à part. Ç'aurait aussi été un mensonge dans la base de
 * démonstration : le lecteur afficherait une onde, et appuyer sur lecture ne
 * donnerait rien. On génère donc un WAV valide, et on en mesure les niveaux —
 * l'onde dessinée est celle du son qu'on entend.
 *
 * Le format est du PCM 16 bits mono : quarante-quatre octets d'en-tête et des
 * échantillons. Tous les navigateurs le lisent, Safari compris, et il n'y a
 * aucune bibliothèque à installer.
 *
 * Rien de tout cela ne tourne en production : l'application enregistre ce que
 * le navigateur produit, du MP4/AAC sur iPhone et du WebM/Opus ailleurs.
 */
const FREQUENCE = 16_000;
const BARRES = 48;

export type SonFactice = {
  mime: string;
  octets: Uint8Array<ArrayBuffer>;
  duree: number;
  niveaux: number[];
};

function ecrireTexte(vue: DataView, position: number, texte: string) {
  for (let i = 0; i < texte.length; i += 1) vue.setUint8(position + i, texte.charCodeAt(i));
}

/**
 * Une phrase murmurée, en gros : des syllabes séparées par des respirations.
 *
 * Le détail sonore n'a aucune importance — ce qu'on veut, c'est une enveloppe
 * qui ressemble à une voix plutôt qu'à un bip, pour que la forme d'onde des
 * captures d'écran ait l'air de quelque chose.
 */
export function sonFactice(dureeMs: number, graine: number): SonFactice {
  let etat = graine >>> 0;
  const tirage = () => {
    etat = (etat * 1_664_525 + 1_013_904_223) >>> 0;
    return etat / 0xffffffff;
  };

  const echantillons = Math.round((dureeMs / 1000) * FREQUENCE);
  const pcm = new Int16Array(echantillons);

  // Des syllabes de 120 à 260 ms, séparées de silences courts.
  const syllabes: { debut: number; fin: number; hauteur: number }[] = [];
  let curseur = Math.round(FREQUENCE * 0.05);
  while (curseur < echantillons) {
    const longueur = Math.round(FREQUENCE * (0.12 + tirage() * 0.14));
    const fin = Math.min(echantillons, curseur + longueur);
    syllabes.push({ debut: curseur, fin, hauteur: 110 + tirage() * 90 });
    curseur = fin + Math.round(FREQUENCE * (0.04 + tirage() * 0.09));
  }

  for (const syllabe of syllabes) {
    const longueur = syllabe.fin - syllabe.debut;
    for (let i = 0; i < longueur; i += 1) {
      // Une attaque et une chute douces : une syllabe carrée claque.
      const avancement = i / longueur;
      const enveloppe = Math.sin(Math.PI * avancement) ** 1.5;
      const phase = (2 * Math.PI * syllabe.hauteur * i) / FREQUENCE;
      // Deux harmoniques et un peu de souffle : plus proche d'une voix qu'une
      // sinusoïde pure, qui sonne comme une alarme.
      const onde =
        Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.25 + (tirage() - 0.5) * 0.15;
      pcm[syllabe.debut + i] = Math.round(onde * enveloppe * 0.45 * 32767);
    }
  }

  const tampon = new ArrayBuffer(44 + pcm.length * 2);
  const vue = new DataView(tampon);
  ecrireTexte(vue, 0, "RIFF");
  vue.setUint32(4, 36 + pcm.length * 2, true);
  ecrireTexte(vue, 8, "WAVE");
  ecrireTexte(vue, 12, "fmt ");
  vue.setUint32(16, 16, true);       // taille du bloc de format
  vue.setUint16(20, 1, true);        // PCM
  vue.setUint16(22, 1, true);        // mono
  vue.setUint32(24, FREQUENCE, true);
  vue.setUint32(28, FREQUENCE * 2, true); // octets par seconde
  vue.setUint16(32, 2, true);        // alignement de bloc
  vue.setUint16(34, 16, true);       // bits par échantillon
  ecrireTexte(vue, 36, "data");
  vue.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) vue.setInt16(44 + i * 2, pcm[i], true);

  // Les niveaux, mesurés sur les échantillons qu'on vient d'écrire : la même
  // moyenne quadratique que l'enregistreur calcule dans le navigateur.
  const niveaux: number[] = [];
  const parBarre = Math.max(1, Math.floor(pcm.length / BARRES));
  for (let barre = 0; barre < BARRES; barre += 1) {
    let somme = 0;
    const debut = barre * parBarre;
    const fin = Math.min(pcm.length, debut + parBarre);
    for (let i = debut; i < fin; i += 1) somme += (pcm[i] / 32767) ** 2;
    const moyenne = Math.sqrt(somme / Math.max(1, fin - debut));
    niveaux.push(Math.max(0, Math.min(100, Math.round(moyenne * 260))));
  }

  return {
    mime: "audio/wav",
    octets: new Uint8Array(tampon),
    duree: dureeMs,
    niveaux,
  };
}

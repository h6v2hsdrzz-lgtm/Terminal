/**
 * Chercher dans ce que la bande a écrit.
 *
 * ## Pourquoi pas `LIKE` en base
 *
 * Parce qu'il faudrait choisir entre « ete » qui ne trouve pas « été » et une
 * extension PostgreSQL (`unaccent`) à installer sur Neon, plus un index
 * fonctionnel, plus une migration — pour une bande de trois personnes et
 * quelques milliers de lignes de texte court. Le corpus entier tient dans une
 * requête et se filtre ici, en français correct : accents ignorés, casse
 * ignorée, plusieurs mots dans n'importe quel ordre.
 *
 * Si la bande devenait un réseau social, il faudrait retourner ce choix. Elle
 * ne le deviendra pas : c'est trois personnes, et c'est écrit dans le brief.
 *
 * ## Ce fichier n'a aucune dépendance
 *
 * L'écran de recherche est un composant client et surligne les mots trouvés
 * avec les mêmes fonctions que le serveur utilise pour filtrer. Deux
 * découpages différents donneraient un surlignage qui rate ce qu'il a trouvé.
 */

/** Deux lettres : en dessous, tout ressort et rien ne ressort. */
export const LONGUEUR_MINIMALE = 2;

/**
 * Au-delà, ce n'est plus une recherche, c'est le journal.
 *
 * Elle vit ICI et pas dans le dépôt : un composant client qui prend une
 * constante dans un fichier qui touche Prisma entraîne `pg` dans le paquet du
 * navigateur. Et pas dans les actions non plus : un fichier « use server » ne
 * peut exporter que des fonctions asynchrones.
 */
export const TROUVAILLES_MAX = 60;

/**
 * Minuscules, sans accents, **et de la même longueur**.
 *
 * `NFD` sépare le caractère de son accent, et `\u0300-\u036f` est exactement la
 * plage des accents ainsi détachés. C'est la seule façon portable de faire
 * « é » = « e » sans table de correspondance. Le `NFC` d'abord garantit qu'on
 * part d'un seul caractère : sans lui, un texte déjà décomposé perdrait un
 * caractère de plus que prévu.
 *
 * Elle ne touche PAS aux espaces, et c'est volontaire : `surligner` s'appuie
 * sur le fait que les indices de la version aplatie sont ceux du texte
 * d'origine. Écraser les espaces doubles ici décalerait tout ce qui suit.
 */
export function aplatir(texte: string): string {
  return texte
    .normalize("NFC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Aplatie, et les espaces écrasés : la forme dans laquelle on compare. */
export function normaliser(texte: string): string {
  return aplatir(texte).replace(/\s+/g, " ").trim();
}

/** Les mots d'une requête, normalisés, sans doublon et sans les trop courts. */
export function motsDe(requete: string): string[] {
  const vus = new Set<string>();
  for (const mot of normaliser(requete).split(/[^\p{L}\p{N}]+/u)) {
    if (mot.length >= LONGUEUR_MINIMALE) vus.add(mot);
  }
  return [...vus];
}

/**
 * Tous les mots doivent être là, mais pas forcément dans le même champ.
 *
 * « pluie halles » trouve une journée intitulée « Pluie » posée aux Halles :
 * c'est ce qu'on veut. Exiger tous les mots dans une seule chaîne ne
 * trouverait rien, et n'en exiger qu'un rendrait la moitié du journal.
 */
export function correspond(champs: (string | null | undefined)[], mots: string[]): boolean {
  if (mots.length === 0) return false;
  const foin = champs.filter(Boolean).map((c) => normaliser(String(c)));
  return mots.every((mot) => foin.some((champ) => champ.includes(mot)));
}

export type Morceau = { texte: string; fort: boolean };

/**
 * Le texte découpé en morceaux, ceux qui correspondent marqués.
 *
 * Le découpage se fait sur la version NORMALISÉE mais les morceaux rendus sont
 * tirés du texte d'origine, aux mêmes indices : la normalisation ne change
 * jamais le nombre de caractères — `NFD` en ajoute, d'où le
 * `normalize("NFC")` d'abord, et le retrait des accents en retire autant qu'il
 * en avait ajouté. Sans cette précaution, surligner « été » décalerait tout ce
 * qui suit d'un caractère.
 */
export function surligner(texte: string, mots: string[]): Morceau[] {
  const source = texte.normalize("NFC");
  const plat = aplatir(source);
  // La garde de longueur est une ceinture : `aplatir` la préserve, sauf sur
  // quelques caractères turcs dont la minuscule compte deux points de code. Un
  // extrait non surligné vaut mieux qu'un surlignage décalé.
  if (plat.length !== source.length || mots.length === 0) return [{ texte: source, fort: false }];

  const marque = new Array<boolean>(source.length).fill(false);
  for (const mot of mots) {
    let depuis = plat.indexOf(mot);
    while (depuis !== -1) {
      for (let i = depuis; i < depuis + mot.length; i += 1) marque[i] = true;
      depuis = plat.indexOf(mot, depuis + 1);
    }
  }

  const morceaux: Morceau[] = [];
  let debut = 0;
  for (let i = 1; i <= source.length; i += 1) {
    if (i === source.length || marque[i] !== marque[debut]) {
      morceaux.push({ texte: source.slice(debut, i), fort: marque[debut] });
      debut = i;
    }
  }
  return morceaux;
}

/**
 * Un extrait centré sur le premier mot trouvé.
 *
 * Une note de deux cent quatre-vingts caractères dont le mot cherché est à la
 * fin ne doit pas s'afficher depuis le début : on ne verrait jamais pourquoi
 * elle est là.
 */
export function extraire(texte: string, mots: string[], largeur = 120): string {
  const source = texte.normalize("NFC");
  if (source.length <= largeur) return source;

  const plat = aplatir(source);
  const positions = mots.map((mot) => plat.indexOf(mot)).filter((i) => i !== -1);
  const centre = positions.length > 0 ? Math.min(...positions) : 0;

  const vise = Math.max(0, centre - Math.floor(largeur / 3));

  // Reculer jusqu'au blanc d'avant plutôt que de couper au milieu d'un mot —
  // mais pas plus loin que vingt caractères. Sans cette borne, un texte sans
  // espace sur deux cents caractères ramène la fenêtre au tout début, et
  // l'extrait n'affiche justement pas ce qu'on cherchait.
  let debut = vise;
  const plancher = Math.max(0, vise - 20);
  while (debut > plancher && source[debut - 1] !== " ") debut -= 1;
  if (debut === plancher && plancher > 0 && source[plancher] !== " ") debut = vise;

  const fin = Math.min(source.length, debut + largeur);

  return (debut > 0 ? "…" : "") + source.slice(debut, fin).trim() + (fin < source.length ? "…" : "");
}

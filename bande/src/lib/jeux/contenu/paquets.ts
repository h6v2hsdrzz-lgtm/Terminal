/**
 * Les paquets de « Devine qui je suis ».
 *
 * ## Ce qu'on met sur une carte, et ce qu'on n'y met pas
 *
 * Une carte porte **un nom, rien d'autre**. Pas de description, pas de vanne
 * écrite d'avance sur la personne. C'est un choix, et il tient à la limite
 * posée par le plan : « rien qui vise une personne réelle en dehors de la
 * bande ». Faire deviner Zidane n'est pas viser Zidane ; écrire une pique sur
 * lui dans l'application, si — et ce serait en plus moins drôle que ce que les
 * trois autour de la table vont inventer eux-mêmes.
 *
 * L'humour noir demandé par le plan vit donc dans la partie, pas dans le
 * fichier. Le seul paquet où la bande écrit ce qu'elle veut est « Nos potes »,
 * qui est en base et qui n'appartient qu'à elle.
 *
 * ## Pourquoi ils sont dans le code
 *
 * Ce sont des constantes : les mêmes pour toutes les bandes, jamais modifiées
 * en jouant. Les ranger en base aurait obligé à recopier neuf cents lignes à
 * chaque création de bande, pour la seule satisfaction de pouvoir les changer
 * sans redéployer.
 */
export type Paquet = {
  cle: string;
  nom: string;
  emoji: string;
  cartes: string[];
};

export const PAQUETS: Paquet[] = [
  {
    cle: "rap-fr",
    nom: "Rap FR",
    emoji: "🎤",
    cartes: [
      "IAM", "NTM", "Booba", "Kaaris", "Nekfeu", "Orelsan", "PNL", "Jul", "SCH", "Ninho",
      "Damso", "Gazo", "Freeze Corleone", "Alpha Wann", "Lomepal", "Vald", "Laylow", "Dinos",
      "Sofiane", "Niska", "Aya Nakamura", "Diam's", "Rohff", "La Fouine", "Sniper", "Lunatic",
      "MC Solaar", "Oxmo Puccino", "Lino", "Sefyu", "Kery James", "Youssoupha", "Disiz",
      "Soprano", "Black M", "Maître Gims", "Tiakola", "Werenoi", "Zola", "Hamza",
      "Josman", "Luidji", "Alkpote", "Seth Gueko", "Fianso",
    ],
  },
  {
    cle: "foot",
    nom: "Foot",
    emoji: "⚽",
    cartes: [
      "Zinédine Zidane", "Thierry Henry", "Kylian Mbappé", "Antoine Griezmann", "Karim Benzema",
      "Didier Deschamps", "Michel Platini", "Fabien Barthez", "Lilian Thuram", "Patrick Vieira",
      "Franck Ribéry", "Hugo Lloris", "N'Golo Kanté", "Paul Pogba", "Olivier Giroud",
      "Lionel Messi", "Cristiano Ronaldo", "Neymar", "Ronaldinho", "Ronaldo",
      "Diego Maradona", "Pelé", "Zlatan Ibrahimović", "Andrés Iniesta", "Xavi",
      "Sergio Ramos", "Iker Casillas", "Manuel Neuer", "Erling Haaland", "Vinícius Júnior",
      "Pep Guardiola", "José Mourinho", "Arsène Wenger", "Éric Cantona", "David Beckham",
      "Le PSG", "L'OM", "Le Real Madrid", "Le Barça", "La Coupe du monde 98",
      "Le but de la main de Maradona", "Le coup de boule de Zidane", "La remontada",
      "Un carton rouge", "La VAR",
    ],
  },
  {
    cle: "cinema",
    nom: "Cinéma",
    emoji: "🎬",
    cartes: [
      "Titanic", "Le Parrain", "Pulp Fiction", "Matrix", "Inception", "Fight Club",
      "Forrest Gump", "Jurassic Park", "Le Seigneur des anneaux", "Star Wars",
      "Harry Potter", "Le Roi Lion", "Retour vers le futur", "Alien", "Shining",
      "Les Dents de la mer", "E.T.", "Rocky", "Terminator", "Gladiator",
      "Intouchables", "Les Bronzés", "La Cité de la peur", "OSS 117", "Le Dîner de cons",
      "Astérix Mission Cléopâtre", "La Haine", "Amélie Poulain", "Taxi", "Les Visiteurs",
      "Léon", "Le Fabuleux Destin", "Bienvenue chez les Ch'tis", "Qu'est-ce qu'on a fait au Bon Dieu",
      "Brice de Nice", "Louis de Funès", "Jean Reno", "Omar Sy", "Marion Cotillard",
      "Vincent Cassel", "Quentin Tarantino", "Steven Spielberg", "Christopher Nolan",
      "Leonardo DiCaprio", "Brad Pitt", "Tom Cruise",
    ],
  },
  {
    cle: "series",
    nom: "Séries",
    emoji: "📺",
    cartes: [
      "Breaking Bad", "Game of Thrones", "The Office", "Friends", "Stranger Things",
      "The Walking Dead", "Peaky Blinders", "Narcos", "La Casa de Papel", "Squid Game",
      "Black Mirror", "Sherlock", "Dexter", "Prison Break", "Lost",
      "How I Met Your Mother", "The Big Bang Theory", "Sex Education", "Euphoria", "Succession",
      "Kaamelott", "Bref", "Le Bureau des légendes", "Dix pour cent", "Engrenages",
      "Un gars une fille", "Caméra café", "Plus belle la vie", "Validé", "Family Business",
      "Les Simpson", "South Park", "Rick et Morty", "Bojack Horseman", "Arcane",
      "Walter White", "Tony Soprano", "Michael Scott", "Daenerys", "Eleven",
    ],
  },
  {
    cle: "tele",
    nom: "Télé et télé-réalité",
    emoji: "📡",
    cartes: [
      "Koh-Lanta", "Top Chef", "The Voice", "Danse avec les stars", "Fort Boyard",
      "Pékin Express", "Les Marseillais", "Les Ch'tis", "Secret Story", "Loft Story",
      "L'amour est dans le pré", "Qui veut gagner des millions", "Questions pour un champion",
      "Le Juste Prix", "N'oubliez pas les paroles", "C'est mon choix", "Les Anges",
      "Star Academy", "Nouvelle Star", "Incroyable Talent",
      "Cyril Hanouna", "Jean-Pierre Foucault", "Nagui", "Denis Brogniart", "Stéphane Bern",
      "Laurent Ruquier", "Michel Drucker", "Thierry Ardisson", "Sophie Davant",
      "Le 20 heures", "La météo", "Une page de publicité", "Le générique de fin",
      "Un candidat éliminé", "Le poteau de Koh-Lanta", "Le père Fouras",
    ],
  },
  {
    cle: "internet",
    nom: "Internet et mèmes",
    emoji: "💀",
    cartes: [
      "Un tuto YouTube", "Une story Instagram", "Un vocal de trois minutes", "Un thread Twitter",
      "Le mode avion", "La batterie à 1 %", "Le wifi de la SNCF", "Un CAPTCHA",
      "Les conditions d'utilisation", "Un mot de passe oublié", "La double authentification",
      "Un mail de relance", "Une réunion qui aurait pu être un mail", "Un lien mort",
      "Le bouton « accepter tous les cookies »", "Une vidéo qui buffer", "Un fil d'actualité",
      "Le mode sombre", "Un correcteur automatique", "Un émoji mal choisi",
      "Un groupe WhatsApp de famille", "Le « vu » sans réponse", "Un message supprimé",
      "Un pote qui like une photo de 2014", "Une notification à 3 h du matin",
      "Un chargeur qui ne charge plus", "Un écran fissuré", "Le nuage de points",
      "Un influenceur", "Un placement de produit", "Un algorithme", "Une IA",
      "Un abonnement qu'on oublie de résilier", "Un mot de passe écrit sur un post-it",
      "Le Rickroll", "Un deepfake", "Un flou artistique",
    ],
  },
  {
    cle: "dessins",
    nom: "Dessins animés",
    emoji: "🧸",
    cartes: [
      "Goku", "Naruto", "Luffy", "Sangoku", "Vegeta", "Sasuke", "Zoro", "Levi",
      "Pikachu", "Bulbizarre", "Salamèche", "Sacha", "Team Rocket",
      "Mickey", "Donald", "Dingo", "Bugs Bunny", "Titi et Grosminet", "Bip Bip et Coyote",
      "Tom et Jerry", "Scooby-Doo", "Les Razmoket", "Les Supers Nanas", "Bob l'éponge",
      "Patrick", "Homer Simpson", "Bart Simpson", "Eric Cartman", "Shrek", "Nemo",
      "Simba", "Mufasa", "Aladdin", "Elsa", "Woody", "Buzz l'Éclair", "Wall-E",
      "Totoro", "Chihiro", "Le Chat potté", "Astérix", "Obélix", "Idéfix", "Titeuf",
      "Kirikou", "Oui-Oui", "Casimir", "Les Minions",
    ],
  },
  {
    cle: "quotidien",
    nom: "Objets du quotidien",
    emoji: "🧦",
    cartes: [
      "Une télécommande", "Un tire-bouchon", "Une passoire", "Un grille-pain", "Un aspirateur",
      "Un parapluie", "Une brosse à dents", "Un rouleau de scotch", "Une agrafeuse",
      "Un trombone", "Une clé USB", "Un chargeur", "Une multiprise", "Un tournevis",
      "Une ampoule", "Un thermomètre", "Un réveil", "Un miroir", "Un cintre",
      "Une chaussette dépareillée", "Un sac de courses", "Un caddie", "Un ticket de caisse",
      "Un post-it", "Un surligneur", "Une gomme", "Un taille-crayon", "Une règle",
      "Un ventilateur", "Un radiateur", "Une bouilloire", "Une cafetière", "Un micro-ondes",
      "Un frigo", "Un congélateur", "Une machine à laver", "Un fer à repasser",
      "Une balance", "Un tapis de souris", "Un casque audio",
    ],
  },
  {
    cle: "mamie",
    nom: "Trucs qu'on trouve chez mamie",
    emoji: "🫖",
    cartes: [
      "Un napperon", "Un service à café jamais utilisé", "Des bonbons dans un pot à biscuits",
      "Un calendrier des postes", "Un canapé sous plastique", "Un cadre avec une photo de mariage",
      "Un vase en cristal", "Une horloge qui sonne", "Un tapis persan", "Un buffet en bois massif",
      "Un poste de radio", "Une boîte à couture dans une boîte de biscuits", "Un pèse-personne mécanique",
      "Une nappe cirée", "Un dessus-de-lit au crochet", "Une cocotte-minute", "Un moulin à légumes",
      "Un livre de recettes taché", "Un porte-clés souvenir", "Une carte postale de 1987",
      "Un album photo", "Une pendule à balancier", "Un vieux fauteuil", "Un plaid en laine",
      "Une bouteille de liqueur maison", "Un pot de confiture étiqueté à la main",
      "Des sacs plastique dans un sac plastique", "Une boîte de chocolats vide",
      "Un dessin d'enfant sur le frigo", "Un chausse-pied", "Une machine à coudre",
      "Un fer à cheval au-dessus de la porte", "Une collection de dés à coudre",
      "Un chat en porcelaine", "Une clé qui n'ouvre plus rien",
    ],
  },
  {
    cle: "musique",
    nom: "Musique internationale",
    emoji: "🎧",
    cartes: [
      "The Beatles", "Queen", "Michael Jackson", "Madonna", "Prince", "David Bowie",
      "Nirvana", "Pink Floyd", "Led Zeppelin", "The Rolling Stones", "AC/DC", "Metallica",
      "Bob Marley", "Elvis Presley", "Johnny Cash", "Aretha Franklin", "Stevie Wonder",
      "Daft Punk", "Rihanna", "Beyoncé", "Adele", "Amy Winehouse", "Lady Gaga",
      "Eminem", "Jay-Z", "Kanye West", "Kendrick Lamar", "Drake", "Snoop Dogg", "2Pac",
      "Taylor Swift", "Billie Eilish", "The Weeknd", "Dua Lipa", "Coldplay", "Radiohead",
      "Johnny Hallyday", "Serge Gainsbourg", "Jacques Brel", "Édith Piaf", "Céline Dion",
      "Stromae", "Angèle", "Christine and the Queens", "Indochine", "Téléphone",
    ],
  },
  {
    cle: "histoire",
    nom: "Figures historiques",
    emoji: "🏛️",
    cartes: [
      "Napoléon", "Jeanne d'Arc", "Louis XIV", "Charles de Gaulle", "Marie Curie",
      "Victor Hugo", "Molière", "Voltaire", "Jean Moulin", "Vercingétorix",
      "Cléopâtre", "Jules César", "Alexandre le Grand", "Toutânkhamon", "Attila",
      "Christophe Colomb", "Léonard de Vinci", "Michel-Ange", "Galilée", "Isaac Newton",
      "Albert Einstein", "Charles Darwin", "Nikola Tesla", "Thomas Edison", "Louis Pasteur",
      "Gandhi", "Nelson Mandela", "Martin Luther King", "Rosa Parks", "Winston Churchill",
      "Neil Armstrong", "Youri Gagarine", "Coco Chanel", "Pablo Picasso", "Vincent van Gogh",
      "Frida Kahlo", "Simone Veil", "Simone de Beauvoir", "Olympe de Gouges",
    ],
  },
  {
    cle: "metiers",
    nom: "Métiers et situations",
    emoji: "🧑‍🔧",
    cartes: [
      "Un dentiste", "Un plombier", "Un pompier", "Un facteur", "Un boulanger",
      "Un boucher", "Un coiffeur", "Un vétérinaire", "Un pilote de ligne", "Un contrôleur SNCF",
      "Un agent immobilier", "Un notaire", "Un huissier", "Un serrurier", "Un déménageur",
      "Un serveur débordé", "Un vigile de boîte de nuit", "Un maître-nageur", "Un moniteur d'auto-école",
      "Un prof de sport", "Un surveillant de collège", "Un guide touristique", "Un DJ de mariage",
      "Un livreur", "Un caissier", "Un standardiste", "Un community manager",
      "Un premier rendez-vous", "Un entretien d'embauche", "Un contrôle fiscal",
      "Un dimanche pluvieux", "Un déménagement", "Une panne d'ascenseur", "Une file d'attente",
      "Un embouteillage", "Un lundi matin", "Un réveil qui n'a pas sonné",
    ],
  },
];

export function paquetParCle(cle: string): Paquet | undefined {
  return PAQUETS.find((p) => p.cle === cle);
}

/** Le mode roulette : tout, mélangé. */
export function toutesLesCartes(): string[] {
  return PAQUETS.flatMap((p) => p.cartes);
}

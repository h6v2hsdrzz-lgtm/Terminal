# Hypothèses pré-enregistrées

> **Ce fichier est écrit AVANT la première optimisation et n'est pas modifié
> ensuite.** Une hypothèse sans justification économique rédigée à l'avance ne
> doit pas être testée : c'est le filtre qui sépare la recherche du data mining.
>
> Ordre de test : H1 → H8. Une hypothèse rejetée est **close** — on n'y revient
> pas avec des valeurs légèrement différentes (§16.4.1).
>
> Budget global : **200 configurations** sur l'in-sample, toutes briques
> confondues. Le compteur est tenu automatiquement dans
> `research/research_log.jsonl` et alimente la pénalité du Deflated Sharpe.
> Toute la recherche se fait **exclusivement sur 2020-01 → 2024-12**.

---

## Baseline (hors budget — pas une optimisation)

Les paramètres du mandat (§5) sont exécutés une fois chacun, tels quels, pour
établir le point de départ. Ces exécutions sont enregistrées avec
`hypothesis: "baseline"` et comptent dans le registre, mais elles ne
constituent pas une recherche de paramètres : aucune sélection n'est faite
entre elles.

---

## H1 — Horizons alternatifs du momentum time-series

**Paramètre visé** : `strategies.ts_momentum.horizons_hours`
**Grille** : {12, 48, 336}, {24, 72, 168} (référence), {48, 168, 504},
{24, 120, 336}, {12, 24, 72}
**Budget** : ≤ 12 configurations (horizons × k ∈ {0.7, 1.0, 1.4})

**Rationale économique.** Le bon horizon d'un signal de momentum dépend de la
vitesse à laquelle l'information se diffuse dans le prix. Cette vitesse n'est
pas une constante de la nature : elle dépend de la structure de participation
du marché. Entre 2020 et 2026, les perpétuels crypto sont passés d'un marché
dominé par le retail à un marché où l'arbitrage professionnel et les market
makers systématiques sont majoritaires, ce qui raccourcit mécaniquement la
persistance des tendances courtes tout en laissant intactes les tendances
longues portées par les flux d'allocation. Il est donc légitime de tester si la
combinaison {24h, 72h, 168h} du mandat est bien centrée, ou si l'edge s'est
déplacé vers des horizons plus longs.

**Critère de rejet.** Aucune combinaison ne dépasse la référence de plus de
0,15 de Sharpe in-sample, ou la surface de performance est un pic isolé plutôt
qu'un plateau (§11.5).

---

## H2 — Extension de l'univers cross-sectionnel à 8-10 perpétuels OKX

**Paramètre visé** : `strategies.cross_sectional.universe`
**Grille** : `base` (3 actifs) vs `extended` (10 actifs), × lookback
{72h, 168h, 336h}
**Budget** : ≤ 8 configurations

**Rationale économique.** Le momentum cross-sectionnel exploite la dispersion
des rendements *à l'intérieur* d'un univers. Sur 3 actifs, le z-score en coupe
ne dispose que de 3 points, le rang médian est mécaniquement neutralisé, et la
stratégie dégénère en un unique spread long/short — soit une seule source de
risque, très corrélée au bêta crypto résiduel. Sur 8-10 perpétuels liquides,
la dispersion transversale est structurellement plus exploitable : le nombre de
paires indépendantes croît en n², la neutralité dollar devient effective plutôt
que nominale, et le bruit idiosyncratique de chaque actif se diversifie. C'est
la limite la plus évidente du mandat tel qu'écrit, et elle est explicitement
signalée au §5.

**Critère de rejet.** L'extension n'améliore pas le Sharpe out-of-sample de la
brique 2 testée seule, ou dégrade sa corrélation avec la brique 1 (l'intérêt de
la brique 2 est sa décorrélation, pas son Sharpe propre).

---

## H3 — Recalibration des seuils de déclenchement de la brique cascade

**Paramètre visé** : `strategies.cascade_reversal.*`
**Grille** : `return_threshold` {0.03, 0.04, 0.05}, `volume_multiple` {5, 8, 12},
`oi_drop_1h` {-0.02, -0.03, -0.05}
**Budget** : ≤ 15 configurations

**Rationale économique.** Les cinq seuils du mandat sont des estimations *a
priori*, pas des mesures. Ils décrivent une intention — « une vraie cascade de
liquidations » — dont la traduction chiffrée dépend de la distribution réelle
des événements sur la période. Un seuil trop lâche capture du bruit
directionnel ordinaire et détruit l'argument structurel de la brique ; un seuil
trop strict produit trop peu d'événements pour conclure quoi que ce soit
(§15 : pas de conclusion sous 300 trades). La recalibration doit donc être
guidée par la distribution empirique des cascades, avec une contrainte
explicite : conserver un régime de rareté (ordre de grandeur : quelques
déclenchements par mois, pas par jour).

**Critère de rejet.** Aucun jeu de seuils ne produit à la fois ≥ 30
déclenchements in-sample et une espérance par trade positive nette de coûts ;
ou l'espérance ne devient positive qu'en relâchant les seuils au point que les
événements ne sont plus des cascades (volume < 4× la médiane).

---

## H4 — Filtre de régime par volatilité réalisée

**Paramètre visé** : nouveau `strategies.ts_momentum.vol_regime_filter`
**Grille** : coupure du momentum quand la vol réalisée dépasse son quantile
{0.90, 0.95, 0.99} sur 1 an ; réduction {0 %, 50 %}
**Budget** : ≤ 8 configurations

**Rationale économique.** Le momentum time-series se dégrade dans les régimes
de volatilité explosive, pour une raison mécanique et non statistique : en vol
extrême, la distribution des rendements devient fortement leptokurtique et les
retournements se produisent plus vite que la fenêtre d'estimation du signal ne
peut les intégrer. Le signal continue donc de pointer dans la direction de la
tendance passée au moment précis où cette tendance se casse. C'est le mode de
défaillance classique des CTA lors des chocs de volatilité. Couper ou réduire
l'exposition dans ce régime est une protection structurelle, pas un filtre
ajouté pour améliorer un chiffre.

**Réserve explicite.** Cette hypothèse est à la limite de l'interdit du §15
(« ne pas ajouter d'indicateurs pour améliorer une brique qui déçoit »). Elle
n'est testée que parce que son mécanisme est identifié *a priori* et qu'elle
utilise une grandeur déjà présente dans la brique (la volatilité réalisée sert
déjà au vol targeting) — aucun indicateur nouveau n'est introduit. Si elle
n'améliore pas le Sharpe **et** ne réduit pas le drawdown, elle est rejetée
sans variante.

---

## H5 — Fréquence de rééquilibrage et largeur du deadband

**Paramètre visé** : `strategies.ts_momentum.deadband`,
`strategies.*.rebalance_timeframe`
**Grille** : deadband {0.10, 0.20, 0.30, 0.40} × rebalance {1H, 4H, 1D}
**Budget** : ≤ 12 configurations

**Rationale économique.** Arbitrage direct et quantifiable entre réactivité du
signal et coûts de friction. À 0,10 % d'aller-retour taker et un notionnel de
4× l'equity, chaque aller-retour coûte 0,4 % de l'equity : le deadband n'est
pas un paramètre de confort, c'est le principal levier de survie économique de
la stratégie. Sa valeur optimale dépend du rapport entre la vitesse de
décroissance du signal et le coût unitaire de transaction, deux grandeurs
mesurables. C'est l'hypothèse dont le mécanisme est le plus solidement établi.

**Critère de rejet.** Le plateau de performance est plat au point que le
paramètre est indifférent — auquel cas on conserve la valeur du mandat (0,20)
par principe de parcimonie.

---

## H6 — Volatilité cible du portefeuille et méthode d'allocation entre briques

**Paramètre visé** : `portfolio.target_vol_annualized`,
`portfolio.allocation`
**Grille** : vol cible {8 %, 10 %, 12 %, 15 %} × allocation
{risk_parity, equal}
**Budget** : ≤ 8 configurations

**Rationale économique.** La volatilité cible avant levier détermine le point
de fonctionnement du module de calibration du levier (§8) : une vol cible trop
basse force un levier élevé pour atteindre le rendement, une vol cible trop
haute sature la contrainte de drawdown. Ces deux paramètres n'ajoutent aucun
signal — ils déplacent le portefeuille le long de sa propre frontière
rendement/risque. C'est donc une hypothèse de dimensionnement, pas de
prédiction, et le risque de surajustement y est structurellement plus faible.

**Critère de rejet.** Le Sharpe est insensible à ces paramètres (attendu, s'ils
ne font que remettre à l'échelle) **et** aucune valeur ne relâche la contrainte
binding identifiée au §8.

---

## H7 — Pondération du signal par la qualité de la tendance

**Paramètre visé** : nouveau `strategies.ts_momentum.trend_quality`
**Grille** : pondération du signal par le ratio |rendement cumulé| / somme des
|rendements de barre| sur l'horizon, exposant {0, 0.5, 1.0}
**Budget** : ≤ 6 configurations

**Rationale économique.** Deux séries peuvent afficher le même rendement sur
168h avec des trajectoires radicalement différentes : une progression régulière
(diffusion lente d'information, tendance exploitable) ou un unique saut suivi
d'un range (choc ponctuel déjà intégré, aucune persistance attendue).
L'efficiency ratio distingue les deux à partir de données déjà utilisées par la
brique, sans introduire d'indicateur externe. Le mécanisme économique est la
distinction entre une tendance portée par un flux et un repricing instantané.

**Réserve explicite.** Même réserve qu'en H4 vis-à-vis du §15. Testée en
dernier parmi les hypothèses de signal, et rejetée sans variante si le gain de
Sharpe est inférieur à 0,15.

---

## H8 — Asymétrie long/short du modulateur de funding

**Paramètre visé** : `funding_modulator.damping`, `z_high`, `z_low`
**Grille** : damping {0.3, 0.5, 0.7} × seuils {±1.5, ±2.0, ±2.5}
**Budget** : ≤ 9 configurations

**Rationale économique.** Le funding extrême signale un positionnement
surchargé d'un côté du marché, donc une fragilité asymétrique aux cascades. Les
seuils ±2 et l'amortissement 0,5 du mandat sont des valeurs rondes choisies *a
priori*. La question empirique est de savoir à partir de quel z-score le
déséquilibre devient réellement informatif sur le risque de cascade — et si ce
seuil est symétrique, ce qui n'est pas acquis : le funding négatif extrême est
plus rare et se produit dans des conditions de marché différentes (capitulation
plutôt qu'euphorie).

**Critère de rejet.** Le modulateur ne réduit pas le drawdown maximum. Son rôle
est défensif ; s'il n'améliore que le rendement, c'est qu'il capture du carry
déguisé, ce que le mandat interdit explicitement (§6).

---

## Ce qui ne sera PAS testé, et pourquoi

- **Une brique de carry de funding.** Interdit par le §6. Le Sharpe du carry
  crypto s'est comprimé de ~6,5 (2020-2025) à ~4 (2024) puis en territoire
  négatif (2025). Cet edge se comprime structurellement et ne doit rien porter.
- **Des indicateurs techniques supplémentaires** (RSI, MACD, croisements de
  moyennes, bandes). Interdit par le §5 et le §15. Aucun mécanisme économique
  ne les justifie ici, et leur ajout est le mode de surajustement le plus
  courant.
- **Un 4ᵉ horizon de momentum.** Explicitement signalé comme du surajustement
  probable au §5.
- **Le relèvement d'une limite de drawdown** pour atteindre l'objectif.
  Interdit par le §15.
- **Toute modification après ouverture de l'out-of-sample.** Interdit par le
  §15 et le §16.4.3.

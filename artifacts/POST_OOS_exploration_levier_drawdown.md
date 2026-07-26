# Exploration post-OOS : tripler le rendement en acceptant 2× le drawdown

> **AVERTISSEMENT MÉTHODOLOGIQUE.** Tout ce document est produit **après**
> l'ouverture de l'out-of-sample (2026-07-25 21:54 UTC). L'audit du §11.1 ne
> s'applique plus : l'OOS a servi de jeu de vérification et ne peut plus servir
> de preuve. Environ 30 configurations supplémentaires ont été consommées ici.
> Aucun de ces résultats n'a la valeur probante des résultats du rapport
> principal. Ils sont exploratoires, et étiquetés comme tels.

---

## 1. Correction d'une prémisse

La demande partait de « levier ×10 ferait du 1,7 %/mois », obtenu en
extrapolant linéairement les +2,06 %/an du levier 1×. **Cette extrapolation est
fausse**, et la table de sensibilité le montre déjà :

| Levier | Rendement annualisé | DD max | Compte tué |
|---|---|---|---|
| 1× | **+2,06 %** | −24 % | non |
| 1,5× | −1,27 % | −39 % | non |
| 2× | −9,69 % | −40 % | **oui** |
| 10× | −9,65 % | −40 % | **oui** |

Deux mécanismes cassent la linéarité : le drag de volatilité croît en L², et
surtout les coupe-circuits se déclenchent — chaque halt cristallise la perte et
rate le rebond, puis le kill switch à −40 % arrête définitivement.

## 2. Pourquoi le levier ne peut pas échanger du drawdown contre du rendement

Le levier multiplie le rendement **et** le drawdown au même rythme : le ratio
rendement/drawdown (Calmar) lui est invariant, au drag près. Accepter 2× le
drawdown peut donc au mieux **doubler** le rendement, jamais le tripler.

Tripler le rendement à 2× le drawdown exige un **Calmar 1,5× meilleur**, c'est-à-dire
une meilleure stratégie — pas plus de levier. C'est une contrainte
arithmétique, pas une opinion.

## 3. Mesure : élargir le budget de drawdown

Budget de drawdown doublé (quotidien −10 %, hebdo −24 %, mensuel −50 %,
kill −80 %), configuration H5 :

| Budget | Levier | Rendement annuel | DD max | Tué |
|---|---|---|---|---|
| mandat | 1× | +2,03 % | −24 % | non |
| **×2** | 1× | **+2,03 %** | −24 % | non |
| ×2 | 2× | −6,93 % | −55 % | non |
| ×2 | 3× | −17,8 % | −74 % | non |
| ×2 | 4× et + | −27,5 % | −80 % | oui |

**Élargir les coupe-circuits n'améliore rien** et laisse les pertes courir plus
longtemps. À levier 1× le rendement est identique dans les deux mandats, parce
que les coupe-circuits n'y étaient pas la contrainte active.

## 4. Le vrai levier : les coûts

Les frais représentaient 123 % du PnL brut. Diagnostic : une foule de
micro-ajustements passait le filtre anti-poussière (0,2 % de l'equity).
En relevant ce seuil :

| Seuil min. d'ordre | 0,05 | 0,075 | 0,10 | 0,125 | **0,15** | 0,20 | 0,30 |
|---|---|---|---|---|---|---|---|
| Sharpe | 0,242 | 0,256 | 0,364 | 0,368 | **0,383** | 0,404 | −0,041 |
| Frais | 12 140 | 11 406 | 9 886 | 8 703 | **8 603** | 5 582 | 1 248 |
| Trades | 1 257 | 1 068 | 812 | 638 | **512** | 274 | 51 |

La progression est **monotone de 0,05 à 0,20** : c'est un plateau ascendant, pas
un pic. L'effondrement à 0,30 n'est pas une perte d'edge mais une perte
d'échantillon (51 trades en 5 ans). Le point retenu est **0,15**, dernier
niveau respectant le minimum de 300 trades du §15.

### Résultat in-sample

| | Départ | Après correction des coûts | |
|---|---|---|---|
| Rendement annuel | 2,06 % | **7,14 %** | **×3,5** |
| Rendement mensuel | 0,17 % | **0,59 %** | ×3,5 |
| Drawdown max | −24,0 % | **−13,0 %** | **divisé par 2** |
| Sharpe | 0,149 | 0,383 | ×2,6 |
| Frais | 18 482 | 8 603 | −53 % |

**La demande est dépassée en in-sample** : ×3,5 sur le rendement avec un
drawdown *deux fois plus petit*, pas deux fois plus grand. Le budget de
drawdown supplémentaire s'avère inutile — et le levier reste contre-productif
(à 1,5× : 5,61 %/an ; à 2× : 3,08 % ; au-delà : compte tué).

## 5. Vérification hors échantillon — et c'est là que ça casse

| Métrique | In-sample | Out-of-sample |
|---|---|---|
| Sharpe | 0,383 | **0,056** |
| Rendement annuel | 7,14 % | **0,61 %** |
| Drawdown max | −13,0 % | −11,4 % |
| Profit factor | 1,233 | **1,001** |
| Trades | 512 | 204 |
| Coûts / PnL brut | 21,8 % | 92,1 % |

- **Dégradation du Sharpe : 85,5 %** (le §13 exige moins de 35 %).
- **Alpha out-of-sample : +0,23 %/an, t = 0,12** — indiscernable de zéro.
- Profit factor de 1,001 : très exactement le seuil de rentabilité.
- 204 trades, sous le minimum de 300.

La réduction des coûts est **réelle en tant que mécanisme** — les frais baissent
de 53 %, c'est de l'arithmétique, pas de l'ajustement. Mais le gain de
performance qui l'accompagnait en in-sample **ne survit pas** à la validation.

## 6. Conclusion

**Non, il n'existe pas de solution fiable pour tripler ce rendement**, ni par le
levier, ni en acceptant deux fois plus de drawdown.

1. Le levier est exclu : il ne change pas le Calmar, et au-delà de 1,5× il tue
   le compte. Élargir les coupe-circuits aggrave la situation, c'est mesuré.
2. La réduction des coûts triple bien le rendement **en in-sample**, avec
   moitié moins de drawdown — mais s'effondre hors échantillon (dégradation de
   85,5 %, alpha t = 0,12).
3. Ce résultat est **l'illustration exacte du §16.1** : en testant assez de
   configurations, on finit toujours par en trouver une qui brille en
   in-sample. Trente essais supplémentaires ont suffi.

### Ce qui serait nécessaire

Pour 5 %/mois (80 %/an) à un levier admissible :

| Levier | Rendement non-levier requis | Observé | Facteur manquant |
|---|---|---|---|
| 1× | 80 %/an | 7,1 % | ×11 |
| 2× | 40 %/an | 7,1 % | ×5,6 |
| 3× | 26,7 %/an | 7,1 % | ×3,8 |

Aucun réglage de paramètre ne comble un facteur 4 à 11. Il faut une source
d'edge supplémentaire — les trois pistes du rapport principal (carnet niveau 2,
flux on-chain, volatilité implicite des options), qui demandent de **nouvelles
données**.

### Conséquence pratique

L'out-of-sample est désormais consommé. Toute reprise de la recherche exige un
**nouveau jeu de validation** : soit réserver 2026 intégralement, soit passer
directement par du paper trading, qui est le seul hors-échantillon qu'on ne
peut pas surajuster.

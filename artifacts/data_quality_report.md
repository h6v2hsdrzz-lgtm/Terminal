# Rapport de qualite des donnees

Genere le 2026-07-25T21:24:39.038255+00:00

## Points bloquants

Aucun.

## BTC-USDT-SWAP

### OHLCV

| TF | lignes | debut | fin | couverture | trous | barres manquantes | vol nul | outliers 10σ |
|---|---|---|---|---|---|---|---|---|
| 1m | 3,452,881 | 2020-01-01 00:00 | 2026-07-25 20:00 | 100.00 % | 0 | 0 | 7,702 | 1907 |
| 15m | 230,191 | 2020-01-01 00:00 | 2026-07-25 19:30 | 100.00 % | 0 | 0 | 81 | 126 |
| 1H | 57,548 | 2020-01-01 00:00 | 2026-07-25 19:00 | 100.00 % | 0 | 0 | 9 | 21 |
| 4H | 14,387 | 2020-01-01 00:00 | 2026-07-25 16:00 | 100.00 % | 0 | 0 | 1 | 3 |
| 1D | 2,398 | 2020-01-01 16:00 | 2026-07-25 16:00 | 100.00 % | 0 | 0 | 0 | 0 |

### Funding, open interest, basis

- funding : 7,119 reglements, 2020-01-01 -> 2026-06-30, moyenne 11.92 %/an, 85.5 % positifs (source : binance_vision_usdm)
- open interest : 619,426 points au pas 5 min
- controle croise funding OKX vs Binance sur 212 reglements (2026-04-21 -> 2026-06-30) : correlation 0.597, biais moyen -0.31 %/an, erreur absolue moyenne 3.47 %/an, accord de signe 76.9 %
- basis perp/index : mediane 0.1 bps, p99 13.5 bps, max 516.3 bps

## ETH-USDT-SWAP

### OHLCV

| TF | lignes | debut | fin | couverture | trous | barres manquantes | vol nul | outliers 10σ |
|---|---|---|---|---|---|---|---|---|
| 1m | 3,452,881 | 2020-01-01 00:00 | 2026-07-25 20:00 | 100.00 % | 0 | 0 | 15,998 | 1735 |
| 15m | 230,191 | 2020-01-01 00:00 | 2026-07-25 19:30 | 100.00 % | 0 | 0 | 97 | 98 |
| 1H | 57,548 | 2020-01-01 00:00 | 2026-07-25 19:00 | 100.00 % | 0 | 0 | 10 | 21 |
| 4H | 14,387 | 2020-01-01 00:00 | 2026-07-25 16:00 | 100.00 % | 0 | 0 | 1 | 2 |
| 1D | 2,398 | 2020-01-01 16:00 | 2026-07-25 16:00 | 100.00 % | 0 | 0 | 0 | 0 |

### Funding, open interest, basis

- funding : 7,119 reglements, 2020-01-01 -> 2026-06-30, moyenne 14.18 %/an, 86.0 % positifs (source : binance_vision_usdm)
- open interest : 488,592 points au pas 5 min
- controle croise funding OKX vs Binance sur 212 reglements (2026-04-21 -> 2026-06-30) : correlation 0.652, biais moyen +0.82 %/an, erreur absolue moyenne 3.60 %/an, accord de signe 78.8 %
- basis perp/index : mediane -0.0 bps, p99 16.3 bps, max 351.4 bps

## SOL-USDT-SWAP

### OHLCV

| TF | lignes | debut | fin | couverture | trous | barres manquantes | vol nul | outliers 10σ |
|---|---|---|---|---|---|---|---|---|
| 1m | 2,895,181 | 2021-01-22 07:00 | 2026-07-25 20:00 | 100.00 % | 0 | 0 | 3,665 | 1425 |
| 15m | 193,011 | 2021-01-22 07:00 | 2026-07-25 19:30 | 100.00 % | 0 | 0 | 69 | 92 |
| 1H | 48,253 | 2021-01-22 07:00 | 2026-07-25 19:00 | 100.00 % | 0 | 0 | 9 | 17 |
| 4H | 12,063 | 2021-01-22 08:00 | 2026-07-25 16:00 | 100.00 % | 0 | 0 | 1 | 3 |
| 1D | 2,011 | 2021-01-22 16:00 | 2026-07-25 16:00 | 100.00 % | 0 | 0 | 0 | 1 |

### Funding, open interest, basis

- funding : 6,032 reglements, 2021-01-22 -> 2026-06-30, moyenne 1.53 %/an, 71.3 % positifs (source : binance_vision_usdm)
- open interest : 488,574 points au pas 5 min
- controle croise funding OKX vs Binance sur 212 reglements (2026-04-21 -> 2026-06-30) : correlation 0.840, biais moyen +1.45 %/an, erreur absolue moyenne 3.79 %/an, accord de signe 82.5 %
- basis perp/index : mediane -0.5 bps, p99 26.6 bps, max 2142.4 bps

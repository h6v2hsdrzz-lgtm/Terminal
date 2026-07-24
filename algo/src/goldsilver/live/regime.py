"""Moniteur de régime : détecte la mort de la tendance et met le bot en pause.

POURQUOI (critère de conception, pas d'optimisation) : le test de detrending
de la validation a montré que l'edge du breakout 4h disparaît hors tendance
(Sharpe +0.51 sur données réelles -> -0.27 une fois la dérive retirée).
Trader ce système dans le chop, c'est payer des faux départs sans espérance.

CRITÈRE CHOISI (documenté, deux conditions par instrument) :

1. **Ancre de tendance** : close > EMA(``trend_ema``) sur 4h ET la pente de
   cette EMA sur ``slope_lookback_bars`` bougies 4h est >= ``min_slope_pct``.
   C'est l'ancre même de la stratégie (EMA 100 x 4h par défaut) : si elle
   est plate ou descendante, le régime qui portait l'edge n'existe plus.

2. **Efficience du mouvement** (Kaufman Efficiency Ratio sur 4h) :
   |close_t - close_{t-n}| / somme(|variations|) >= ``er_min``.
   Proche de 1 = tendance nette ; proche de 0 = chop. Le chop 2021-2022 —
   qui a produit le -78 % de la frontière à haut risque — a un ER bas.

Un instrument dont l'UNE des conditions échoue est en pause : AUCUNE
nouvelle entrée dessus (les positions ouvertes gardent leurs SL/TP broker,
on ne coupe pas un trade en cours sur un simple changement de régime).
La stratégie étant long-only, un régime baissier est aussi une pause.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from goldsilver.strategy.indicators import ema


@dataclass(frozen=True)
class RegimeConfig:
    trend_ema: int = 100
    slope_lookback_bars: int = 30
    min_slope_pct: float = 0.0
    use_efficiency_ratio: bool = True
    er_window_bars: int = 60
    er_min: float = 0.20


@dataclass(frozen=True)
class RegimeStatus:
    instrument: str
    trading_allowed: bool
    trend_ok: bool
    slope_pct: float
    er_ok: bool
    er_value: float
    detail: str


def efficiency_ratio(close: pd.Series, window: int) -> float:
    if len(close) < window + 1:
        return float("nan")
    seg = close.iloc[-(window + 1):]
    net = abs(float(seg.iloc[-1]) - float(seg.iloc[0]))
    path = float(seg.diff().abs().sum())
    return net / path if path > 0 else 0.0


def assess_regime(instrument: str, candles_4h: pd.DataFrame,
                  cfg: RegimeConfig) -> RegimeStatus:
    """Évalue le régime sur des bougies 4h TERMINÉES (dernière = plus récente)."""
    close = candles_4h["close"]
    needed = max(cfg.trend_ema + cfg.slope_lookback_bars, cfg.er_window_bars) + 1
    if len(close) < needed:
        return RegimeStatus(instrument, False, False, float("nan"), False,
                            float("nan"),
                            f"historique insuffisant ({len(close)} < {needed} bougies 4h)")

    e = ema(close, cfg.trend_ema)
    e_now = float(e.iloc[-1])
    e_then = float(e.iloc[-1 - cfg.slope_lookback_bars])
    slope_pct = e_now / e_then - 1.0
    above = float(close.iloc[-1]) > e_now
    trend_ok = above and slope_pct >= cfg.min_slope_pct

    er_value = efficiency_ratio(close, cfg.er_window_bars)
    er_ok = (not cfg.use_efficiency_ratio) or er_value >= cfg.er_min

    allowed = trend_ok and er_ok
    detail = (
        f"close{'>' if above else '<='}EMA{cfg.trend_ema}, "
        f"pente {100 * slope_pct:+.2f} % / {cfg.slope_lookback_bars} bougies "
        f"(min {100 * cfg.min_slope_pct:+.2f} %), "
        f"ER({cfg.er_window_bars}) = {er_value:.2f} (min {cfg.er_min:.2f})"
    )
    return RegimeStatus(instrument, allowed, trend_ok, slope_pct, er_ok,
                        er_value, detail)

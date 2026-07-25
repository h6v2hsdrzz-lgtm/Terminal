"""Brique 3 — reversal apres cascade de liquidations (§5).

Seule brique court terme legitime du dispositif : son edge est structurel
(liquidations forcees, carnet asseche, vendeurs non discretionnaires), pas
statistique. Elle doit donc etre RARE. Si elle declenche des centaines de fois
par an, c'est que les seuils ne selectionnent plus des cascades.

Conditions, toutes requises, sur la fenetre de 15 minutes :
    1. |rendement_15m|          > 4 %
    2. volume_15m               > 8 x mediane(volume_15m, 30 j)
    3. |perp - index| / index   > 0.30 %
    4. delta_open_interest_1h   < -3 %
    5. la bougie 1m extreme porte une meche > 60 % de son range

Execution :
    entree contrarienne en 3 tranches limites echelonnees, jamais au marche ;
    stop au-dela de l'extreme de la meche + 0.5 x ATR(1H) ;
    sortie au retour sur le VWAP de la fenetre de cascade, ou a 8h, au premier
    des deux ; une seule cascade active a la fois.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from ..data.panel import Panel
from ..features.core import atr, shift1
from .base import Brick, BrickOutput

log = logging.getLogger("okx_algo.cascade")

HOURS_PER_YEAR = 24 * 365


class CascadeReversal(Brick):
    name = "cascade_reversal"
    kind = "cascade"

    def compute(self, panel: Panel) -> BrickOutput:
        p = self.params
        step_min = {"1m": 1, "15m": 15, "1H": 60}[panel.timeframe]
        bars_per_hour = 60 // step_min
        win_bars = max(1, int(p["window_minutes"]) // step_min)
        median_bars = int(30 * 24 * bars_per_hour)
        tranches = int(p.get("entry_tranches", 3))
        time_exit_bars = int(float(p["time_exit_hours"]) * bars_per_hour)
        cooldown_bars = int(float(p.get("cooldown_hours", 24)) * bars_per_hour)
        target_vol = float(p.get("target_vol_annualized", 0.10))
        vol_bars = int(p.get("vol_estimator_window_days", 20)) * 24 * bars_per_hour

        n, m = panel.n, len(panel.symbols)
        out = Brick.empty(panel, kind=self.kind)
        weights = np.zeros((n, m))
        stops = np.full((n, m), np.nan)
        exit_by = np.full((n, m), -1, dtype=np.int64)
        events: list[dict] = []

        # ---- 1. detection vectorisee, par actif -------------------------
        triggers: list[tuple[int, int, int, float, float, float]] = []
        for j, sym in enumerate(panel.symbols):
            d = panel.data[sym]
            close = d.close.astype(float)
            with np.errstate(divide="ignore", invalid="ignore"):
                r = close / _shift(close, win_bars) - 1.0

            vol = d.volume_quote.astype(float)
            volwin = (pd.Series(vol).rolling(win_bars, min_periods=1).sum().to_numpy()
                      if win_bars > 1 else vol)
            med = (pd.Series(volwin).rolling(median_bars, min_periods=median_bars // 4)
                   .median().to_numpy())

            with np.errstate(divide="ignore", invalid="ignore"):
                basis = np.abs(close - d.index_close) / d.index_close
                oi_chg = d.open_interest / _shift(d.open_interest, bars_per_hour) - 1.0

            a1h = atr(d.high, d.low, d.close, max(2, bars_per_hour))

            cond = (
                (np.abs(r) > float(p["return_threshold"]))
                & (volwin > float(p["volume_multiple"]) * med)
                & (basis > float(p["basis_dislocation"]))
                & (oi_chg < float(p["oi_drop_1h"]))
                & d.valid
            )
            cond &= np.isfinite(med) & np.isfinite(oi_chg) & np.isfinite(basis) & np.isfinite(a1h)

            for i in np.where(cond)[0]:
                direction = -int(np.sign(r[i]))     # contrarien
                wick_ok, extreme = _wick_check(d, i, win_bars, direction,
                                               float(p["wick_ratio_min"]))
                if not wick_ok:
                    continue
                vwap = _window_vwap(d, i, win_bars)
                if not np.isfinite(vwap) or not np.isfinite(extreme):
                    continue
                triggers.append((i, j, direction, extreme, vwap, a1h[i]))

        triggers.sort(key=lambda t: t[0])

        # ---- 2. arbitrage : une seule cascade active, plus cooldown ------
        vol_scale = _vol_scale(panel, target_vol, vol_bars)
        busy_until = -1
        cooldown_until = np.full(m, -1)
        for (i, j, direction, extreme, vwap, a1h_i) in triggers:
            if i <= busy_until or i <= cooldown_until[j]:
                continue
            d = panel.data[panel.symbols[j]]
            stop = extreme - direction * float(p["stop_atr_multiple"]) * a1h_i
            exit_idx = _exit_bar(d.close, i, direction, vwap, time_exit_bars, n)

            size = float(vol_scale[i, j]) if np.isfinite(vol_scale[i, j]) else 0.0
            if size <= 0:
                continue
            # entree en 3 tranches : la cible monte par paliers sur `tranches` barres
            for t in range(tranches):
                b = i + 1 + t
                if b >= exit_idx or b >= n:
                    break
                weights[b:exit_idx, j] = direction * size * (t + 1) / tranches
            stops[i + 1:exit_idx, j] = stop
            exit_by[i + 1:exit_idx, j] = exit_idx
            busy_until = exit_idx
            cooldown_until[j] = i + cooldown_bars
            events.append({
                "datetime": str(panel.index[i]), "symbol": panel.symbols[j],
                "direction": direction, "extreme": float(extreme), "vwap": float(vwap),
                "stop": float(stop), "exit_index": int(exit_idx),
                "hours_held": round((exit_idx - i) / bars_per_hour, 2),
            })

        out.weights = Brick.sanitize(weights, panel, float(p.get("max_abs_position", 1.0)))
        out.stops = stops
        out.exit_by = exit_by
        out.diagnostics = {
            "n_candidate_triggers": len(triggers),
            "n_taken": len(events),
            "events": events[:200],
            "triggers_per_year": (len(events) /
                                  max((panel.index[-1] - panel.index[0]).days / 365.25, 1e-9)),
        }
        log.info("cascade: %d declenchements retenus sur %d candidats",
                 len(events), len(triggers))
        return out


# ----------------------------------------------------------------------
def _shift(a: np.ndarray, k: int) -> np.ndarray:
    out = np.full_like(a, np.nan, dtype=float)
    if k < len(a):
        out[k:] = a[:-k]
    return out


def _wick_check(d, i: int, win_bars: int, direction: int,
                min_ratio: float) -> tuple[bool, float]:
    """La bougie 1m extreme de la fenetre porte-t-elle une meche assez longue ?

    direction = +1 (on achete apres une cascade baissiere) -> meche BASSE.
    """
    a = d.m1_slice[max(i - win_bars + 1, 0)][0] if len(d.m1_slice) > i else 0
    b = d.m1_slice[i][1] if len(d.m1_slice) > i else 0
    if b <= a or len(d.m1_low) == 0:
        return False, np.nan
    lo, hi = d.m1_low[a:b], d.m1_high[a:b]
    op, cl = d.m1_open[a:b], d.m1_close[a:b]
    k = int(np.argmin(lo)) if direction > 0 else int(np.argmax(hi))
    rng = hi[k] - lo[k]
    if rng <= 0:
        return False, np.nan
    body_edge = min(op[k], cl[k]) if direction > 0 else max(op[k], cl[k])
    wick = (body_edge - lo[k]) if direction > 0 else (hi[k] - body_edge)
    extreme = lo[k] if direction > 0 else hi[k]
    return bool(wick / rng > min_ratio), float(extreme)


def _window_vwap(d, i: int, win_bars: int) -> float:
    a = d.m1_slice[max(i - win_bars + 1, 0)][0] if len(d.m1_slice) > i else 0
    b = d.m1_slice[i][1] if len(d.m1_slice) > i else 0
    if b <= a or len(d.m1_close) == 0:
        return np.nan
    px = (d.m1_high[a:b] + d.m1_low[a:b] + d.m1_close[a:b]) / 3.0
    v = d.m1_volume[a:b]
    tot = v.sum()
    return float((px * v).sum() / tot) if tot > 0 else float(px.mean())


def _exit_bar(close: np.ndarray, i: int, direction: int, vwap: float,
              time_exit_bars: int, n: int) -> int:
    """Premier retour au VWAP de la cascade, sinon sortie temporelle."""
    hard = min(i + time_exit_bars, n - 1)
    seg = close[i + 1:hard + 1]
    if len(seg) == 0:
        return hard
    hit = np.where(seg >= vwap)[0] if direction > 0 else np.where(seg <= vwap)[0]
    return int(i + 1 + hit[0]) if len(hit) else hard


def _vol_scale(panel: Panel, target_vol: float, vol_bars: int) -> np.ndarray:
    """Meme normalisation par la volatilite que les autres briques : sans cela
    l'allocation risk parity comparerait des tailles non comparables."""
    n, m = panel.n, len(panel.symbols)
    bars_per_year = HOURS_PER_YEAR * (vol_bars / max(vol_bars, 1))
    out = np.zeros((n, m))
    step_min = {"1m": 1, "15m": 15, "1H": 60}[panel.timeframe]
    ann = np.sqrt(365 * 24 * 60 / step_min)
    for j, sym in enumerate(panel.symbols):
        c = panel.data[sym].close.astype(float)
        with np.errstate(divide="ignore", invalid="ignore"):
            r = np.diff(np.log(c), prepend=np.nan)
        vol = pd.Series(r).rolling(vol_bars, min_periods=vol_bars // 4).std().to_numpy() * ann
        with np.errstate(divide="ignore", invalid="ignore"):
            s = np.where(vol > 1e-9, target_vol / vol, 0.0)
        out[:, j] = np.clip(np.nan_to_num(shift1(s, fill=0.0)), 0.0, 5.0)
    return out

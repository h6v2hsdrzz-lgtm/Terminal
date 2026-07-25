"""Combinaison des briques en portefeuille (§7).

Chaine de traitement, dans l'ordre :

  1. modulateur de funding applique aux poids de chaque brique ;
  2. allocation risk parity entre briques, sur la volatilite realisee glissante
     du PnL propre de chaque brique et la matrice de correlation MESUREE
     (contribution au risque egalisee, pas simple inverse-vol) ;
  3. netting : les expositions opposees sur un meme actif se compensent en une
     position nette unique, chaque compensation etant journalisee ;
  4. vol targeting du portefeuille agrege sur `target_vol_annualized` ;
  5. plafond d'exposition : 2 actifs simultanes hors cascade.

Tout est causal : l'allocation de la barre t n'utilise que des PnL realises
jusqu'a t-1, et le recalcul n'a lieu qu'une fois par mois pour rester realiste.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from ..backtest.engine import Targets
from ..data.panel import Panel
from ..features.core import shift1
from ..modulators.funding import apply_funding_modulator, funding_zscore
from ..strategies.base import BrickOutput

log = logging.getLogger("okx_algo.portfolio")

HOURS_PER_YEAR = 24 * 365


def bars_per_hour(timeframe: str) -> float:
    return 60.0 / {"1m": 1, "15m": 15, "1H": 60, "4H": 240, "1D": 1440}[timeframe]


def brick_pnl_proxy(weights: np.ndarray, panel: Panel) -> np.ndarray:
    """PnL horaire theorique d'une brique (hors couts), pour l'allocation seule."""
    n, m = weights.shape
    ret = np.zeros((n, m))
    for j, sym in enumerate(panel.symbols):
        c = panel.data[sym].close.astype(float)
        with np.errstate(divide="ignore", invalid="ignore"):
            r = np.diff(np.log(c), prepend=np.nan)
        ret[:, j] = np.nan_to_num(r, nan=0.0, posinf=0.0, neginf=0.0)
    # le poids de la barre t est deja decale : il s'applique au rendement de t
    return np.nansum(weights * ret, axis=1)


def _erc_weights(cov: np.ndarray, iters: int = 200) -> np.ndarray:
    """Contribution au risque egale, par iteration multiplicative."""
    k = cov.shape[0]
    w = np.ones(k) / k
    if not np.isfinite(cov).all():
        return w
    for _ in range(iters):
        mrc = cov @ w
        port_var = float(w @ cov @ w)
        if port_var <= 0 or not np.isfinite(port_var):
            return np.ones(k) / k
        rc = w * mrc
        target = port_var / k
        with np.errstate(divide="ignore", invalid="ignore"):
            adj = np.where(rc > 0, (target / rc) ** 0.25, 1.0)
        w = np.clip(w * adj, 1e-6, None)
        w = w / w.sum()
    return w


def risk_parity_allocation(pnls: dict[str, np.ndarray], index: pd.DatetimeIndex,
                           cfg, bph: float = 1.0) -> pd.DataFrame:
    """Poids d'allocation par brique, recalcules mensuellement, bornes par §5."""
    names = list(pnls)
    vol_window = max(8, int(round(cfg.get("portfolio.pnl_vol_window_days") * 24 * bph)))
    corr_window = max(16, int(round(cfg.get("portfolio.corr_window_days") * 24 * bph)))
    bars_per_year = HOURS_PER_YEAR * bph
    bounds = cfg.get("portfolio.risk_budget_bounds")
    method = cfg.get("portfolio.allocation")

    mat = pd.DataFrame({n: pnls[n] for n in names}, index=index)
    alloc = pd.DataFrame(index=index, columns=names, dtype=float)

    first = index[0].normalize().replace(day=1)
    month_starts = pd.date_range(first, index[-1], freq="MS", tz=index.tz)
    last = np.ones(len(names)) / len(names)
    for ms in month_starts:
        end = index.searchsorted(ms)          # information strictement anterieure
        if end < max(vol_window, int(240 * bph)):
            alloc.iloc[index.searchsorted(ms):
                       index.searchsorted(ms + pd.offsets.MonthBegin(1))] = last
            continue
        win = mat.iloc[max(0, end - corr_window):end]
        if method == "equal" or win.std().eq(0).all():
            w = np.ones(len(names)) / len(names)
        else:
            vol = win.iloc[-vol_window:].std().to_numpy() * np.sqrt(bars_per_year)
            vol = np.where(np.isfinite(vol) & (vol > 1e-9), vol, np.nan)
            if np.isnan(vol).all():
                w = np.ones(len(names)) / len(names)
            else:
                vol = np.where(np.isnan(vol), np.nanmedian(vol), vol)
                corr = win.corr().to_numpy()
                corr = np.where(np.isfinite(corr), corr, 0.0)
                np.fill_diagonal(corr, 1.0)
                cov = np.outer(vol, vol) * corr
                w = _erc_weights(cov)
        w = _apply_bounds(w, names, bounds)
        i0 = index.searchsorted(ms)
        i1 = index.searchsorted(ms + pd.offsets.MonthBegin(1))
        alloc.iloc[i0:i1] = w
        last = w
    return alloc.ffill().fillna(1.0 / len(names))


def _apply_bounds(w: np.ndarray, names: list[str], bounds: dict) -> np.ndarray:
    lo = np.array([bounds.get(n, [0.0, 1.0])[0] for n in names])
    hi = np.array([bounds.get(n, [0.0, 1.0])[1] for n in names])
    w = np.clip(w, lo, hi)
    s = w.sum()
    if s <= 0:
        return np.ones(len(names)) / len(names)
    w = w / s
    # une seule passe de reprojection suffit pour 3 briques
    return np.clip(w, lo, hi) / max(np.clip(w, lo, hi).sum(), 1e-9)


# ----------------------------------------------------------------------
def combine(bricks: dict[str, BrickOutput], panel: Panel, cfg,
            apply_modulator: bool = True) -> tuple[Targets, dict]:
    n, m = panel.n, len(panel.symbols)
    names = list(bricks)

    z = funding_zscore(panel, cfg.get("funding_modulator.zscore_window_days"))
    modulated = {}
    for name, b in bricks.items():
        w = b.weights
        if apply_modulator and b.kind != "cascade":
            w = apply_funding_modulator(w, z, cfg)
        modulated[name] = w

    bph = bars_per_hour(panel.timeframe)
    pnls = {name: brick_pnl_proxy(w, panel) for name, w in modulated.items()}
    alloc = risk_parity_allocation(pnls, panel.index, cfg, bph=bph)

    # -- 2/3. allocation puis netting --------------------------------------
    combined = np.zeros((n, m))
    per_brick_scaled = {}
    for name in names:
        a = alloc[name].to_numpy()[:, None]
        scaled = modulated[name] * a
        per_brick_scaled[name] = scaled
        combined += scaled

    gross_before = np.abs(np.stack([per_brick_scaled[n_] for n_ in names])).sum(axis=0)
    netting_saved = gross_before - np.abs(combined)

    # -- 4. vol targeting du portefeuille agrege ---------------------------
    port_pnl = brick_pnl_proxy(combined, panel)
    window = max(8, int(round(cfg.get("portfolio.vol_estimator_window_days") * 24 * bph)))
    realized = (pd.Series(port_pnl).rolling(window, min_periods=window // 2).std()
                .to_numpy() * np.sqrt(HOURS_PER_YEAR * bph))
    target_vol = float(cfg.get("portfolio.target_vol_annualized"))
    with np.errstate(divide="ignore", invalid="ignore"):
        scale = np.where(realized > 1e-9, target_vol / realized, 1.0)
    scale = np.clip(np.nan_to_num(shift1(scale, fill=1.0), nan=1.0, posinf=1.0), 0.0, 5.0)
    combined = combined * scale[:, None]

    # -- 5. plafond d'exposition -------------------------------------------
    cascade_mask = np.zeros((n, m), dtype=bool)
    stops = np.full((n, m), np.nan)
    exit_by = np.full((n, m), -1, dtype=np.int64)
    for name, b in bricks.items():
        if b.kind != "cascade":
            continue
        active = b.weights != 0.0
        cascade_mask |= active
        stops = np.where(active, b.stops, stops)
        exit_by = np.where(active, b.exit_by, exit_by)

    combined = _cap_positions(combined, cascade_mask,
                              int(cfg.get("portfolio.max_concurrent_positions")))

    diagnostics = {
        "allocation_mean": {k: float(alloc[k].mean()) for k in names},
        "allocation_last": {k: float(alloc[k].iloc[-1]) for k in names},
        "netting_hours": int((netting_saved > 1e-9).sum()),
        "netting_gross_saved_mean": float(np.nanmean(netting_saved)),
        "mean_gross_weight": float(np.nanmean(np.abs(combined).sum(axis=1))),
        "mean_vol_scale": float(np.nanmean(scale)),
        "funding_damped_hours": int(((np.abs(z) > cfg.get("funding_modulator.z_high"))).sum()),
        "cascade_hours": int(cascade_mask.any(axis=1).sum()),
    }
    targets = Targets(weights=combined, stops=stops, exit_by=exit_by,
                      cascade=cascade_mask,
                      attribution={k: v for k, v in per_brick_scaled.items()})
    return targets, diagnostics


def _cap_positions(w: np.ndarray, cascade: np.ndarray, max_core: int) -> np.ndarray:
    """Conserve les `max_core` expositions les plus fortes hors cascade."""
    out = w.copy()
    core = np.where(cascade, 0.0, np.abs(w))
    if core.shape[1] <= max_core:
        return out
    order = np.argsort(-core, axis=1)
    keep = np.zeros_like(core, dtype=bool)
    rows = np.arange(core.shape[0])[:, None]
    keep[rows, order[:, :max_core]] = True
    return np.where(cascade | keep, out, 0.0)

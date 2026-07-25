"""Grilles des hypotheses pre-enregistrees (§16.3).

Ce module ne fait que TRADUIRE `research/HYPOTHESES.md` en configurations.
Il n'invente aucune hypothese : toute grille ajoutee ici sans justification
economique ecrite a l'avance dans le document viole le protocole.

H2 (extension de l'univers cross-sectionnel) n'est pas dans cette boucle : elle
change l'univers, donc le panel, et fait l'objet d'une etude dediee
(`universe_study`), dont les essais sont comptes dans le meme registre.
"""
from __future__ import annotations

import itertools
from typing import Any

from ..core.config import Config

HYPOTHESIS_ORDER = ["H1", "H3", "H4", "H5", "H6", "H7", "H8"]

BUDGETS = {"H1": 12, "H2": 8, "H3": 15, "H4": 8, "H5": 12, "H6": 8, "H7": 6, "H8": 9}


def build_variants(cfg: Config, hyp: str, panel) -> list[tuple[str, dict, list | None]]:
    """Retourne [(label, {"overrides": {...}}, bricks_ou_None), ...]."""
    fn = {
        "H1": _h1_horizons,
        "H3": _h3_cascade_thresholds,
        "H4": _h4_vol_regime,
        "H5": _h5_deadband,
        "H6": _h6_target_vol,
        "H7": _h7_trend_quality,
        "H8": _h8_funding_modulator,
    }[hyp]
    variants = fn(cfg)
    return variants[: BUDGETS[hyp]]


# ----------------------------------------------------------------------
def _v(label: str, overrides: dict[str, Any], bricks=None):
    return (label, {"overrides": overrides}, bricks)


def _h1_horizons(cfg: Config) -> list:
    grids = [[12, 48, 336], [24, 72, 168], [48, 168, 504], [24, 120, 336], [12, 24, 72]]
    ks = [0.7, 1.0, 1.4]
    out = []
    for h, k in itertools.product(grids, ks):
        if h == [24, 72, 168] and k == 1.0:
            continue                      # c'est la baseline, deja mesuree
        out.append(_v(f"H1_h{'-'.join(map(str, h))}_k{k}",
                      {"strategies.ts_momentum.horizons_hours": h,
                       "strategies.ts_momentum.k": k}))
    return out


def _h3_cascade_thresholds(cfg: Config) -> list:
    out = []
    for rt, vm, oi in itertools.product([0.03, 0.04, 0.05], [5.0, 8.0, 12.0],
                                        [-0.02, -0.03, -0.05]):
        if (rt, vm, oi) == (0.04, 8.0, -0.03):
            continue
        out.append(_v(f"H3_r{rt}_v{vm}_oi{oi}",
                      {"strategies.cascade_reversal.return_threshold": rt,
                       "strategies.cascade_reversal.volume_multiple": vm,
                       "strategies.cascade_reversal.oi_drop_1h": oi}))
    return out


def _h4_vol_regime(cfg: Config) -> list:
    out = []
    for q, red in itertools.product([0.90, 0.95, 0.99], [0.0, 0.5]):
        out.append(_v(f"H4_q{q}_red{red}",
                      {"strategies.ts_momentum.vol_regime_filter":
                       {"enabled": True, "quantile": q, "reduction": red,
                        "lookback_days": 365}}))
    return out


def _h5_deadband(cfg: Config) -> list:
    out = []
    for db, rb in itertools.product([0.10, 0.20, 0.30, 0.40], ["1H", "4H", "1D"]):
        if db == 0.20 and rb == "1H":
            continue
        out.append(_v(f"H5_db{db}_rb{rb}",
                      {"strategies.ts_momentum.deadband": db,
                       "strategies.ts_momentum.rebalance_timeframe": rb}))
    return out


def _h6_target_vol(cfg: Config) -> list:
    out = []
    for tv, alloc in itertools.product([0.08, 0.10, 0.12, 0.15],
                                       ["risk_parity", "equal"]):
        if tv == 0.10 and alloc == "risk_parity":
            continue
        out.append(_v(f"H6_vol{tv}_{alloc}",
                      {"portfolio.target_vol_annualized": tv,
                       "portfolio.allocation": alloc}))
    return out


def _h7_trend_quality(cfg: Config) -> list:
    return [_v(f"H7_exp{e}", {"strategies.ts_momentum.trend_quality": {"exponent": e}})
            for e in [0.5, 1.0]]


def _h8_funding_modulator(cfg: Config) -> list:
    out = []
    for damp, z in itertools.product([0.3, 0.5, 0.7], [1.5, 2.0, 2.5]):
        if damp == 0.5 and z == 2.0:
            continue
        out.append(_v(f"H8_d{damp}_z{z}",
                      {"funding_modulator.damping": damp,
                       "funding_modulator.z_high": z,
                       "funding_modulator.z_low": -z}))
    return out

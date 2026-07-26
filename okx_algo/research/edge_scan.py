"""Recherche d'edge sur les donnees de positionnement et de flux (post-OOS).

Methode : coefficient d'information (IC) = correlation de rang entre un signal
DECALE et le rendement FUTUR. C'est le test rapide et rigoureux qui dit s'il y
a quelque chose a exploiter AVANT d'investir dans une strategie complete.

Un IC de 0.02-0.05 stable est deja exploitable ; en dessous de 0.01 il n'y a
rien. Le t-stat compte autant que l'IC : un IC de 0.05 sur 200 points ne veut
rien dire.
"""
from __future__ import annotations
import sys
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, '/home/user/Terminal')

from okx_algo.core.config import load_config
from okx_algo.data.panel import build_panel
from okx_algo.features.core import shift1, zscore


def build_signals(d, bph: float) -> dict[str, np.ndarray]:
    """Signaux candidats, chacun avec un mecanisme economique explicite."""
    h = lambda n: max(2, int(round(n * bph)))
    close = d.close.astype(float)
    oi = d.open_interest.astype(float)
    lsr = d.long_short_ratio
    tlr = d.taker_ls_ratio
    if lsr is not None and not np.isfinite(lsr).any():
        lsr = None
    if tlr is not None and not np.isfinite(tlr).any():
        tlr = None

    with np.errstate(divide="ignore", invalid="ignore"):
        ret24 = close / _sh(close, h(24)) - 1.0
        doi24 = oi / _sh(oi, h(24)) - 1.0
        doi4 = oi / _sh(oi, h(4)) - 1.0

    sig = {}
    # 1. Accumulation de levier : OI qui monte AVEC le prix = longs surcharges.
    #    Mecanisme : positions financees a credit, fragiles a la moindre baisse.
    sig["oi_build_contrarian"] = -np.sign(ret24) * np.nan_to_num(doi24)
    # 2. Desendettement : OI qui baisse = liquidations/fermetures forcees.
    #    Mecanisme : vendeurs non discretionnaires, donc prix depasse la valeur.
    sig["oi_deleveraging"] = -np.nan_to_num(doi4)
    # 3. Divergence prix/OI : prix monte sans OI = short covering, pas de flux neuf.
    sig["oi_price_divergence"] = np.nan_to_num(np.sign(ret24) * -doi24)
    # 4. Flux agressif : desequilibre des ordres au marche.
    if tlr is not None and len(tlr):
        z = zscore(np.log(np.clip(tlr, 1e-6, None)), h(24 * 7))
        sig["taker_flow"] = np.nan_to_num(z)
        sig["taker_flow_contrarian"] = -np.nan_to_num(z)
    # 5. Positionnement des comptes : contrarien aux extremes.
    if lsr is not None and len(lsr):
        z = zscore(np.log(np.clip(lsr, 1e-6, None)), h(24 * 30))
        sig["account_positioning_contrarian"] = -np.nan_to_num(z)
    # 6. Funding : reference deja connue.
    f = pd.Series(np.where(d.funding != 0, d.funding, np.nan)).ffill().to_numpy()
    sig["funding_contrarian"] = -np.nan_to_num(zscore(f, h(24 * 30)))
    return {k: shift1(v, fill=0.0) for k, v in sig.items()}


def _sh(a, k):
    out = np.full_like(a, np.nan, dtype=float)
    if k < len(a):
        out[k:] = a[:-k]
    return out


def ic_table(cfg, symbols, horizons_h=(4, 24, 72, 168), end="2024-12-31") -> pd.DataFrame:
    panel = build_panel(cfg, symbols=symbols, timeframe="1H", with_minute=False)
    bph = 1.0
    i0, i1 = panel.slice("2020-10-01", end)
    rows = []
    for sym in symbols:
        d = panel.data[sym]
        sigs = build_signals(d, bph)
        close = d.close.astype(float)
        for name, s in sigs.items():
            for H in horizons_h:
                fwd = np.full(len(close), np.nan)
                with np.errstate(divide="ignore", invalid="ignore"):
                    fwd[:-H] = close[H:] / close[:-H] - 1.0
                x, y = s[i0:i1], fwd[i0:i1]
                m = np.isfinite(x) & np.isfinite(y) & (x != 0)
                if m.sum() < 500:
                    continue
                ic, _ = stats.spearmanr(x[m], y[m])
                n_eff = m.sum() / max(H, 1)          # chevauchement des fenetres
                t = ic * np.sqrt(max(n_eff - 2, 1)) / np.sqrt(max(1 - ic ** 2, 1e-9))
                rows.append(dict(signal=name, symbole=sym, horizon_h=H,
                                 IC=ic, t_stat=t, n_eff=int(n_eff)))
    return pd.DataFrame(rows)


if __name__ == "__main__":
    cfg = load_config()
    syms = cfg.get("universe.symbols")
    df = ic_table(cfg, syms)
    pd.set_option("display.width", 200)
    agg = (df.groupby(["signal", "horizon_h"])
             .agg(IC_moyen=("IC", "mean"), t_moyen=("t_stat", "mean"),
                  IC_min=("IC", "min"), IC_max=("IC", "max"))
             .reset_index().sort_values("IC_moyen", key=abs, ascending=False))
    print("=== IC par signal et horizon (moyenne sur les 3 actifs, in-sample) ===")
    print(agg.to_string(index=False, float_format=lambda x: f"{x:8.4f}"))
    print("\n=== Signaux dont l'IC est coherent sur LES TROIS actifs ===")
    ok = agg[(agg.IC_moyen.abs() > 0.02) & (np.sign(agg.IC_min) == np.sign(agg.IC_max))
             & (agg.t_moyen.abs() > 2)]
    print(ok.to_string(index=False, float_format=lambda x: f"{x:8.4f}") if len(ok)
          else "  AUCUN — aucun signal ne depasse IC 0.02 avec un signe stable et t>2")
    df.to_csv("/home/user/Terminal/artifacts/edge_scan_ic.csv", index=False)

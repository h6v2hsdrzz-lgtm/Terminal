"""Série de funding 8h complète : réel quand il existe, reconstruit sinon.

Contrainte de terrain : l'API publique OKX ne conserve qu'environ **3 mois**
d'historique de funding, alors que le backtest couvre 2020→aujourd'hui. Or en
levier x10 sur des trades de plusieurs jours, le funding est un poste de coût
majeur : l'ignorer ou le mettre à zéro fausse le résultat dans le sens
favorable. On le reconstruit donc à partir de la donnée qui, elle, est
disponible sur tout l'historique : la **prime perp vs index**.

Méthode, et pourquoi elle a été corrigée
----------------------------------------
1. prime horaire ``p_t = (perp_close_t - index_close_t) / index_close_t`` ;
2. moyenne de la prime sur la fenêtre de 8h précédant chaque règlement ;
3. **pente** calibrée sur la période de chevauchement, appliquée à la prime
   centrée sur sa **moyenne glissante longue** (et non sur la moyenne de la
   fenêtre de calibration) ;
4. **niveau** fixé par une hypothèse documentée (``execution.funding.base_rate``,
   la composante d'intérêt standard des perpétuels), et non par la constante
   d'une régression.

La première version utilisait une régression libre ``a + b·prime``. En fenêtre
de calibration elle était excellente (R² 0,78, biais nul), mais la prime mesurée
y est biaisée de −4,8 bps (le perp cote sous l'index) alors que le funding réel
y vaut +0,0023 % : la constante absorbait donc ce biais. Appliquée à 2020-2024,
où la prime ne porte pas le même biais, elle imposait un plancher de +3,7 bps
par cycle, soit **+50 %/an de coût de portage** contre ~2,5 %/an réellement
observés — un artefact qui écrasait notamment le benchmark buy & hold.

Centrer sur la moyenne de calibration ne suffisait pas non plus : la prime y est
biaisée de −4,8 bps alors qu'elle est proche de zéro sur 2020-2024, si bien que
le centrage reportait ce biais dans le niveau (+62 %/an). Le niveau de la prime
n'est en réalité pas comparable d'une période à l'autre — OKX calcule son indice
de prime sur des cotations pondérées par la profondeur, pas sur le dernier prix
traité. On centre donc sur une **moyenne glissante longue**, ce qui n'utilise la
prime que pour ses écarts de court terme.

Conséquence assumée : le **niveau** du funding reconstruit est une hypothèse,
pas une mesure ; seule sa **variation de court terme** est calibrée. Le rapport
le dit, et le stress des coûts (×1,5, ×2) borne la sensibilité à ce choix.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import Config, resolve_path
from ..utils import dt_to_ms, get_logger, utc_index
from .store import ParquetStore

log = get_logger("data.funding")

FUNDING_CAP = 0.0075  # écrêtage prudent (±0.75 % / 8h), au-delà du vécu OKX


@dataclass
class FundingCalibration:
    symbol: str
    n_overlap: int = 0
    intercept: float = 0.0          # niveau assumé (base_rate), pas estimé
    slope: float = 1.0
    premium_mean_overlap: float = 0.0
    real_mean_overlap: float = float("nan")
    implied_annual_cost: float = float("nan")
    level_is_assumption: bool = True
    r2: float = float("nan")
    rmse: float = float("nan")
    real_points: int = 0
    reconstructed_points: int = 0
    real_start: str | None = None
    real_end: str | None = None
    fallback_used: bool = False
    notes: list[str] = field(default_factory=list)

    def as_row(self) -> dict:
        return {
            "symbol": self.symbol,
            "n_overlap": self.n_overlap,
            "intercept_assumed": self.intercept,
            "slope": self.slope,
            "premium_mean_overlap": self.premium_mean_overlap,
            "real_mean_overlap": self.real_mean_overlap,
            "implied_annual_cost": self.implied_annual_cost,
            "level_is_assumption": self.level_is_assumption,
            "r2": self.r2,
            "rmse": self.rmse,
            "real_points": self.real_points,
            "reconstructed_points": self.reconstructed_points,
            "real_start": self.real_start,
            "real_end": self.real_end,
            "fallback_used": self.fallback_used,
            "notes": "; ".join(self.notes),
        }


def _funding_grid(start: pd.Timestamp, end: pd.Timestamp, hours: list[int]) -> pd.DatetimeIndex:
    days = pd.date_range(start.normalize(), end.normalize() + pd.Timedelta(days=1), freq="D", tz="UTC")
    stamps = [d + pd.Timedelta(hours=h) for d in days for h in sorted(hours)]
    idx = pd.DatetimeIndex(sorted(stamps))
    return idx[(idx >= start) & (idx <= end)]


def build_funding_series(
    cfg: Config,
    symbol: str,
    store: ParquetStore | None = None,
    premium_timeframe: str = "1h",
) -> tuple[pd.DataFrame, FundingCalibration]:
    """Renvoie ``(df[timestamp, funding_rate, source], calibration)``."""
    store = store or ParquetStore(resolve_path(cfg, cfg.get_path("data.store_path")))
    hours = list(cfg.get_path("execution.funding.hours_utc"))
    fallback = float(cfg.get_path("execution.funding.fallback_rate"))
    base_rate = float(cfg.get_path("execution.funding.base_rate"))
    centring_window = int(cfg.get_path("execution.funding.centring_periods"))
    cal = FundingCalibration(symbol=symbol)

    real = store.read("funding", symbol)
    real_s = pd.Series(dtype=float)
    if not real.empty:
        r = utc_index(real).sort_index()
        real_s = r["funding_rate"].astype(float)
        real_s = real_s[~real_s.index.duplicated(keep="last")]
        cal.real_points = len(real_s)
        cal.real_start, cal.real_end = str(real_s.index.min()), str(real_s.index.max())

    perp = store.read("ohlcv", symbol, premium_timeframe)
    index = store.read("index", symbol, premium_timeframe)
    premium_8h = pd.Series(dtype=float)
    if not perp.empty and not index.empty:
        p = utc_index(perp).sort_index()["close"].astype(float)
        i = utc_index(index).sort_index()["close"].astype(float)
        joined = pd.concat([p.rename("perp"), i.rename("index")], axis=1).dropna()
        if not joined.empty:
            premium = (joined["perp"] - joined["index"]) / joined["index"]
            # moyenne sur la fenêtre de 8h qui précède chaque règlement
            premium_8h = premium.rolling("8h", min_periods=2).mean()
    else:
        cal.notes.append("prime indisponible (perp ou index manquant)")

    # --- grille de règlement ---
    bounds = []
    for s in (real_s, premium_8h):
        if len(s):
            bounds.append((s.index.min(), s.index.max()))
    if not bounds:
        cal.fallback_used = True
        cal.notes.append("aucune donnée : taux constant de repli")
        return pd.DataFrame(columns=["timestamp", "funding_rate", "source"]), cal
    start = min(b[0] for b in bounds)
    end = max(b[1] for b in bounds)
    grid = _funding_grid(start, end, hours)

    out = pd.DataFrame(index=grid)
    out["funding_rate"] = np.nan
    out["source"] = "fallback"

    # --- calibration : pente seule, niveau assumé ---
    cal.intercept = base_rate
    if len(premium_8h) and len(real_s):
        prem_on_grid = premium_8h.reindex(grid, method="ffill", tolerance=pd.Timedelta("2h"))
        both = pd.concat([prem_on_grid.rename("prem"), real_s.reindex(grid).rename("real")], axis=1).dropna()
        cal.n_overlap = len(both)
        if len(both) >= 30:
            x = both["prem"].to_numpy()
            y = both["real"].to_numpy()
            cal.premium_mean_overlap = float(x.mean())
            cal.real_mean_overlap = float(y.mean())
            xc = x - x.mean()
            denom = float((xc ** 2).sum())
            cal.slope = float((xc * (y - y.mean())).sum() / denom) if denom > 0 else 0.0
            # qualité de l'ajustement de la **variation** (le niveau est imposé)
            pred_in_window = y.mean() + cal.slope * xc
            ss_res = float(((y - pred_in_window) ** 2).sum())
            ss_tot = float(((y - y.mean()) ** 2).sum())
            cal.r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")
            cal.rmse = float(np.sqrt(ss_res / len(y)))
            if abs(cal.real_mean_overlap - base_rate) > 5e-4:
                cal.notes.append(
                    f"niveau assumé {base_rate:.5f} vs moyenne réelle observée "
                    f"{cal.real_mean_overlap:.5f} sur le chevauchement"
                )
        else:
            cal.notes.append(f"chevauchement insuffisant ({len(both)} points) : pente nulle")
            cal.slope = 0.0

    # --- remplissage : réel prioritaire, reconstruction ensuite, repli enfin ---
    if len(premium_8h):
        prem_on_grid = premium_8h.reindex(grid, method="ffill", tolerance=pd.Timedelta("2h"))
        # centrage glissant : aucun niveau n'est transféré d'une période à l'autre
        baseline = prem_on_grid.rolling(centring_window, min_periods=30, center=False).mean()
        baseline = baseline.bfill()
        centred = prem_on_grid - baseline
        recon = (base_rate + cal.slope * centred).clip(-FUNDING_CAP, FUNDING_CAP)
        mask = recon.notna()
        out.loc[mask, "funding_rate"] = recon[mask]
        out.loc[mask, "source"] = "reconstructed"
        cal.reconstructed_points = int(mask.sum())

    if len(real_s):
        aligned = real_s.reindex(grid)
        mask = aligned.notna()
        out.loc[mask, "funding_rate"] = aligned[mask]
        out.loc[mask, "source"] = "real"

    missing = out["funding_rate"].isna()
    if missing.any():
        out.loc[missing, "funding_rate"] = fallback
        cal.fallback_used = True
        cal.notes.append(f"{int(missing.sum())} règlements en taux de repli constant")

    out = out.reset_index().rename(columns={"index": "dt"})
    out["timestamp"] = dt_to_ms(out["dt"])
    out = out[["timestamp", "funding_rate", "source"]]
    mean_rate = float(out["funding_rate"].mean()) if len(out) else float("nan")
    cal.implied_annual_cost = float((1 + mean_rate) ** (3 * 365) - 1) if np.isfinite(mean_rate) else float("nan")
    log.info(
        "%s funding : %d réels, %d reconstruits, R²(variation)=%.3f (n=%d), "
        "coût annuel implicite %.1f%%",
        symbol, cal.real_points, cal.reconstructed_points, cal.r2, cal.n_overlap,
        cal.implied_annual_cost * 100,
    )
    return out, cal


def build_and_store_funding(cfg: Config, symbols: list[str] | None = None) -> pd.DataFrame:
    """Construit la série 'funding_full' de chaque symbole et l'écrit dans le cache."""
    store = ParquetStore(resolve_path(cfg, cfg.get_path("data.store_path")))
    symbols = symbols or list(cfg.get_path("universe.symbols"))
    rows = []
    for sym in symbols:
        df, cal = build_funding_series(cfg, sym, store=store)
        if not df.empty:
            store.write(df, "funding_full", sym)
        rows.append(cal.as_row())
    table = pd.DataFrame(rows)
    out_dir = resolve_path(cfg, cfg.get_path("reports.output_dir")) / "data_quality"
    out_dir.mkdir(parents=True, exist_ok=True)
    table.to_csv(out_dir / "funding_calibration.csv", index=False)
    return table

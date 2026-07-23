"""Pair trading or/argent : mean-reversion du ratio XAU/XAG.

Hypothèse de marché (différente du suivi de tendance) : l'or et l'argent
sont fortement corrélés ; leur RATIO oscille autour d'une moyenne locale.
Quand le ratio s'étire (z-score au-delà de ``z_entry``), on vend le métal
relativement cher et on achète le relativement bon marché, et on déboucle
quand le ratio revient vers sa moyenne (``|z| < z_exit``), via
``exit_signal``. La position est ainsi ~neutre au marché : peu importe que
les métaux montent ou baissent ensemble, seul l'écart compte.

Garde-fous de trader (SL/TP définis, exigés par l'utilisateur) :
- chaque jambe garde un stop dur à ``sl_atr_mult`` x ATR(1h) ;
- un TP par jambe à ``tp_rr`` x SL (large : la sortie normale est le signal) ;
- stop temps ``max_bars_held`` si le ratio ne converge pas.

Les signaux ne sont émis que sur les bougies où LES DEUX actifs cotent.
"""

from __future__ import annotations

from typing import Any, ClassVar, Mapping

import numpy as np
import pandas as pd

from goldsilver.strategy.base import Strategy, register
from goldsilver.strategy.indicators import atr


@register
class RatioReversionStrategy(Strategy):
    name: ClassVar[str] = "ratio_reversion"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {
            "asset_a": "XAUUSD",       # numérateur du ratio
            "asset_b": "XAGUSD",       # dénominateur
            "z_window": 480,           # fenêtre du z-score (bougies 1h, ~1 mois)
            "z_entry": 2.0,            # |z| d'entrée
            "z_exit": 0.5,             # |z| de sortie (retour vers la moyenne)
            "atr_period": 14,
            "sl_atr_mult": 2.5,        # stop dur par jambe
            "tp_rr": 5.0,              # TP par jambe, volontairement lointain
            "max_bars_held": 480,      # ~1 mois : le spread doit converger
        }

    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        raise NotImplementedError(
            "ratio_reversion est cross-actifs : utiliser generate_all"
        )

    def generate_all(
        self, tfs_by_asset: Mapping[str, Mapping[str, pd.DataFrame]]
    ) -> dict[str, pd.DataFrame]:
        p = self.params
        a_name, b_name = str(p["asset_a"]), str(p["asset_b"])
        if a_name not in tfs_by_asset or b_name not in tfs_by_asset:
            raise KeyError(
                f"{self.name} : il faut {a_name} et {b_name} dans les données"
            )
        base_a = next(iter(tfs_by_asset[a_name].values()))
        base_b = next(iter(tfs_by_asset[b_name].values()))

        common = base_a.index.intersection(base_b.index)
        ca = base_a.loc[common, "close"]
        cb = base_b.loc[common, "close"]
        ratio = ca / cb

        w = int(p["z_window"])
        mean = ratio.rolling(w, min_periods=w).mean()
        std = ratio.rolling(w, min_periods=w).std(ddof=1)
        z = (ratio - mean) / std
        z = z.where(std > 0)

        z_entry = float(p["z_entry"])
        z_exit = float(p["z_exit"])
        prev = z.shift(1)
        # ratio trop HAUT : or riche / argent bon marché -> short A, long B
        enter_high = (prev < z_entry) & (z >= z_entry)
        # ratio trop BAS : long A, short B
        enter_low = (prev > -z_entry) & (z <= -z_entry)
        exit_sig = (prev.abs() > z_exit) & (z.abs() <= z_exit)

        out: dict[str, pd.DataFrame] = {}
        for name, base, sign in ((a_name, base_a, -1), (b_name, base_b, +1)):
            df = base.copy()
            sig = pd.Series(0, index=common, dtype=np.int8)
            sig[enter_high] = sign          # z haut : -1 pour A, +1 pour B
            sig[enter_low] = -sign          # z bas : miroir
            a_ind = atr(base, int(p["atr_period"]))
            sl_dist = float(p["sl_atr_mult"]) * a_ind
            valid = sl_dist.reindex(common).notna() & (sl_dist.reindex(common) > 0)
            sig = sig.where(valid, 0)

            df["signal"] = sig.reindex(base.index).fillna(0).astype(np.int8)
            df["sl_dist"] = sl_dist
            df["tp_dist"] = float(p["tp_rr"]) * sl_dist
            df["exit_signal"] = (
                exit_sig.reindex(base.index).fillna(False).astype(np.int8)
            )
            out[name] = df
        return out

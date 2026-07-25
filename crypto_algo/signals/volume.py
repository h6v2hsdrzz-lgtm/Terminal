"""Famille e) — Volume.

OBV, volume relatif vs moyenne 20, VWAP ancré + bandes de déviation, volume
profile (POC / VAH / VAL) sur fenêtre glissante.

Note honnête sur le CVD : le Cumulative Volume Delta exige les trades tick avec
leur côté agresseur. L'API publique OKX ne fournit pas cet historique sur
plusieurs années (seulement les trades récents). Le CVD n'est donc **pas**
implémenté à partir d'une approximation bougie par bougie, qui aurait donné
l'illusion de l'information sans en avoir le contenu ; ``obv`` joue ce rôle avec
ses limites assumées. Le module ``cvd_from_trades`` reste disponible pour le
paper trading, où les trades tick sont collectables en direct.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import SignalContext, SignalFamily, sign_score, squash


class VolumeFamily(SignalFamily):
    name = "volume"

    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        out: dict[str, pd.Series] = {}
        rel_vol_scale = float(ctx.cfg.get_path("signals.rel_volume_scale", 1.5))

        for tf in self.timeframes:
            close = ctx.col("close", tf)
            if close.isna().all():
                continue

            # --- OBV vs sa moyenne : confirmation du flux ---
            obv = ctx.col("obv", tf)
            obv_ema = ctx.col("obv_ema", tf)
            out[f"obv_trend_{tf}"] = sign_score(obv > obv_ema, obv < obv_ema)

            # --- divergence OBV / prix : le flux ne suit pas le prix ---
            obv_chg = obv.diff(20)
            price_chg = close.diff(20)
            div_bear = (price_chg > 0) & (obv_chg < 0)
            div_bull = (price_chg < 0) & (obv_chg > 0)
            out[f"obv_divergence_{tf}"] = sign_score(div_bull, div_bear)

            # --- VWAP ancré : position et bandes ---
            vwap = ctx.col("vwap", tf)
            sd = ctx.col("vwap_sd", tf).replace(0.0, np.nan)
            z = ((close - vwap) / sd).clip(-3.0, 3.0)
            # au-dessus du VWAP = flux acheteur dominant (continuation)
            out[f"vwap_position_{tf}"] = squash(z.fillna(0.0), 2.0)
            # mais au-delà de 2 sigma, l'écart devient une tension (retour)
            out[f"vwap_stretch_{tf}"] = -((z.abs() > 2.0).astype(float) * np.sign(z)).fillna(0.0)

            # --- volume profile : position vs POC et zone de valeur ---
            poc = ctx.col("vp_poc", tf)
            vah = ctx.col("vp_vah", tf)
            val = ctx.col("vp_val", tf)
            if not poc.isna().all():
                out[f"value_area_{tf}"] = sign_score(close < val, close > vah)
                out[f"poc_side_{tf}"] = 0.5 * sign_score(close > poc, close < poc)

            # --- volume relatif : simple pondération de conviction, non directionnel ---
            rel = ctx.col("rel_volume", tf)
            direction = np.sign(close.diff().fillna(0.0))
            out[f"rel_volume_push_{tf}"] = (
                squash((rel - 1.0).clip(lower=0.0).fillna(0.0), rel_vol_scale) * direction
            )
        return out


def cvd_from_trades(trades: pd.DataFrame, timeframe: str = "1m") -> pd.Series:
    """CVD à partir de trades tick réels (``side`` agresseur requis).

    Réservé au paper trading / live : l'historique tick pluriannuel n'est pas
    disponible via l'API publique.
    """
    if trades is None or trades.empty:
        return pd.Series(dtype=float)
    required = {"timestamp", "amount", "side"}
    if not required.issubset(trades.columns):
        raise ValueError(f"colonnes requises : {sorted(required)}")
    signed = np.where(trades["side"].str.lower() == "buy", trades["amount"], -trades["amount"])
    s = pd.Series(signed, index=pd.to_datetime(trades["timestamp"], unit="ms", utc=True))
    return s.resample(timeframe).sum().cumsum()

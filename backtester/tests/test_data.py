from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from quantbt.data.cleaning import clean_ohlcv
from quantbt.data.loader import load_csv
from quantbt.data.resample import align_multi_tf, resample_ohlcv


def test_clean_fixes_inverted_and_out_of_range_bars():
    idx = pd.date_range("2024-01-01", periods=3, freq="15min", tz="UTC")
    df = pd.DataFrame(
        {
            "open": [10.0, 10.0, 10.0],
            "high": [9.0, 11.0, 10.5],   # first bar inverted vs low
            "low": [11.0, 9.5, 9.5],
            "close": [10.2, 12.0, 10.0],  # second bar close above high
            "volume": [1.0, np.nan, 1.0],
        },
        index=idx,
    )
    out = clean_ohlcv(df)
    assert (out["high"] >= out["low"]).all()
    assert (out["high"] >= out[["open", "close"]].max(axis=1)).all()
    assert (out["low"] <= out[["open", "close"]].min(axis=1)).all()
    assert out["volume"].notna().all()


def test_load_csv_flexible_columns(tmp_path, ohlcv):
    p = tmp_path / "d.csv"
    df = ohlcv.head(100).reset_index()
    df.columns = ["Date", "O", "H", "L", "C", "Vol"]
    df.to_csv(p, index=False)
    out = load_csv(p)
    assert list(out.columns) == ["open", "high", "low", "close", "volume"]
    assert len(out) == 100
    assert out.index.tz is not None


def test_resample_aggregates_correctly(ohlcv):
    h = resample_ohlcv(ohlcv, "1h")
    first_hour = ohlcv.iloc[:4]
    assert h.iloc[0]["open"] == first_hour["open"].iloc[0]
    assert h.iloc[0]["close"] == first_hour["close"].iloc[-1]
    assert h.iloc[0]["high"] == first_hour["high"].max()
    assert h.iloc[0]["volume"] == pytest.approx(first_hour["volume"].sum())


def test_multi_tf_alignment_has_no_lookahead(ohlcv):
    h = resample_ohlcv(ohlcv, "1h")
    joined = align_multi_tf(ohlcv, h, "1h", "_1h")
    # At 10:15 the visible 1h bar must be the one that CLOSED at 10:00
    # (i.e. the 09:00-10:00 bar), never the still-forming 10:00-11:00 bar.
    ts = ohlcv.index[5]  # 01:15 of day one
    visible = joined.loc[ts, "close_1h"]
    closed_bar = h[h.index + pd.Timedelta("1h") <= ts].iloc[-1]
    assert visible == closed_bar["close"]

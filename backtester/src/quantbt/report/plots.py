"""Plotly figures for the HTML report."""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go

from quantbt.engine.backtester import BacktestResult

_LAYOUT = dict(template="plotly_white", margin=dict(l=50, r=20, t=50, b=40), height=380)


def equity_fig(result: BacktestResult, oos_equity: pd.Series | None = None) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=result.equity.index, y=result.equity.values,
                             name="Equity", line=dict(width=1.5)))
    if oos_equity is not None and len(oos_equity):
        scaled = oos_equity * result.initial_capital
        fig.add_trace(go.Scatter(x=scaled.index, y=scaled.values,
                                 name="Walk-forward OOS (stitched)",
                                 line=dict(width=1.2, dash="dot")))
    fig.update_layout(title="Equity curve", yaxis_title="Equity", **_LAYOUT)
    return fig


def drawdown_fig(result: BacktestResult) -> go.Figure:
    eq = result.equity
    dd = eq / eq.cummax() - 1.0
    fig = go.Figure(go.Scatter(x=dd.index, y=dd.values, fill="tozeroy",
                               name="Drawdown", line=dict(width=1)))
    fig.update_layout(title="Drawdown", yaxis_tickformat=".0%", **_LAYOUT)
    return fig


def montecarlo_fig(payload: dict) -> go.Figure | None:
    method = "shuffle" if "shuffle" in payload else ("bootstrap" if "bootstrap" in payload else None)
    if method is None:
        return None
    paths = payload[method]["paths"]
    fig = go.Figure()
    x = np.arange(paths.shape[1])
    for row in paths[:60]:
        fig.add_trace(go.Scatter(x=x, y=row, mode="lines", showlegend=False,
                                 line=dict(width=0.6, color="rgba(70,110,180,0.25)")))
    med = np.median(paths, axis=0)
    fig.add_trace(go.Scatter(x=x, y=med, name="Median path", line=dict(width=2, color="#1f4e9c")))
    fig.update_layout(title=f"Monte-Carlo equity paths ({method}, x initial capital)",
                      xaxis_title="Trade #", **_LAYOUT)
    return fig


def montecarlo_hist_fig(payload: dict) -> go.Figure | None:
    method = "shuffle" if "shuffle" in payload else ("bootstrap" if "bootstrap" in payload else None)
    if method is None:
        return None
    fig = go.Figure()
    fig.add_trace(go.Histogram(x=payload[method]["finals"], name="Final equity (x)",
                               nbinsx=60, opacity=0.7))
    fig.add_trace(go.Histogram(x=payload[method]["maxdds"], name="Max drawdown",
                               nbinsx=60, opacity=0.7))
    fig.update_layout(title=f"Monte-Carlo distributions ({method})", barmode="overlay", **_LAYOUT)
    return fig


def sensitivity_fig(payload: dict) -> go.Figure | None:
    heat: pd.DataFrame | None = payload.get("heatmap")
    if heat is None:
        return None
    fig = go.Figure(
        go.Heatmap(z=heat.values, x=list(heat.columns), y=list(heat.index),
                   colorscale="RdYlGn", zmid=0)
    )
    fig.update_layout(title=f"Parameter sensitivity ({heat.index.name} × {heat.columns.name})",
                      xaxis_title=heat.columns.name, yaxis_title=heat.index.name, **_LAYOUT)
    return fig


def noise_fig(payload: dict) -> go.Figure | None:
    dist: pd.DataFrame | None = payload.get("distribution")
    if dist is None or dist.empty:
        return None
    base = payload["baseline"]["expectancy_r"]
    fig = go.Figure(go.Histogram(x=dist["expectancy_r"], nbinsx=30, name="Noisy runs"))
    fig.add_vline(x=base, line_color="#d62728", annotation_text="baseline")
    fig.update_layout(title="Expectancy (R) under price noise", **_LAYOUT)
    return fig

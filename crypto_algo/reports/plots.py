"""Graphiques du rapport (§9). Sortie PNG, encodable en base64 pour le HTML."""

from __future__ import annotations

import base64
import io
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from ..utils import ensure_dir, get_logger  # noqa: E402
from .metrics import drawdown_series, monthly_table  # noqa: E402

log = get_logger("reports.plots")

plt.rcParams.update(
    {
        "figure.dpi": 110,
        "savefig.dpi": 110,
        "font.size": 9,
        "axes.grid": True,
        "grid.alpha": 0.25,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.autolayout": True,
    }
)


def _finish(fig, path: Path | None) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    data = buf.getvalue()
    if path is not None:
        ensure_dir(path.parent)
        path.write_bytes(data)
    return base64.b64encode(data).decode("ascii")


def equity_curve(
    equity: pd.Series,
    benchmarks: dict[str, pd.Series] | None = None,
    path: Path | None = None,
    log_scale: bool = True,
    title: str = "Courbe d'equity (échelle log)",
) -> str:
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(equity.index, equity.to_numpy(), label="stratégie", linewidth=1.6, color="#1f4e79")
    for name, series in (benchmarks or {}).items():
        if series is None or len(series) == 0:
            continue
        ax.plot(series.index, series.to_numpy(), label=name, linewidth=1.0, alpha=0.75)
    if log_scale:
        ax.set_yscale("log")
    ax.set_title(title)
    ax.set_ylabel("equity (USDT)")
    ax.legend(loc="upper left", fontsize=8)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    return _finish(fig, path)


def underwater(equity: pd.Series, path: Path | None = None) -> str:
    dd = drawdown_series(equity) * 100.0
    fig, ax = plt.subplots(figsize=(11, 3))
    ax.fill_between(dd.index, dd.to_numpy(), 0, color="#b22222", alpha=0.5)
    ax.set_title("Underwater plot (drawdown depuis le high-water mark)")
    ax.set_ylabel("%")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    return _finish(fig, path)


def monthly_heatmap(equity: pd.Series, path: Path | None = None) -> str:
    table = monthly_table(equity)
    if table.empty:
        return ""
    values = table.to_numpy(dtype=float) * 100.0
    fig, ax = plt.subplots(figsize=(10, max(2.2, 0.42 * len(table) + 1)))
    vmax = np.nanmax(np.abs(values)) if np.isfinite(values).any() else 1.0
    im = ax.imshow(values, cmap="RdYlGn", vmin=-vmax, vmax=vmax, aspect="auto")
    ax.set_xticks(range(len(table.columns)))
    ax.set_xticklabels([f"{int(c):02d}" for c in table.columns])
    ax.set_yticks(range(len(table.index)))
    ax.set_yticklabels(table.index)
    for i in range(values.shape[0]):
        for j in range(values.shape[1]):
            v = values[i, j]
            if np.isfinite(v):
                ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=7)
    ax.set_title("Rendements mensuels (%)")
    fig.colorbar(im, ax=ax, shrink=0.8, label="%")
    ax.grid(False)
    return _finish(fig, path)


def r_distribution(trades: pd.DataFrame, path: Path | None = None) -> str:
    if trades is None or trades.empty or "r_multiple" not in trades:
        return ""
    r = trades["r_multiple"].replace([np.inf, -np.inf], np.nan).dropna()
    if r.empty:
        return ""
    fig, ax = plt.subplots(figsize=(7, 3.5))
    ax.hist(r, bins=40, color="#1f4e79", alpha=0.85)
    ax.axvline(0, color="black", linewidth=1)
    ax.axvline(r.mean(), color="#b22222", linestyle="--", linewidth=1.2,
               label=f"espérance = {r.mean():.3f} R")
    ax.set_title("Distribution des R (PnL net / risque au stop)")
    ax.set_xlabel("R")
    ax.legend(fontsize=8)
    return _finish(fig, path)


def monte_carlo_distribution(mc, path: Path | None = None) -> str:
    if mc is None or len(getattr(mc, "max_drawdowns", [])) == 0:
        return ""
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))
    axes[0].hist(mc.max_drawdowns * 100, bins=60, color="#b22222", alpha=0.8)
    axes[0].axvline(mc.ruin_threshold * 100, color="black", linestyle="--",
                    label=f"seuil de ruine {mc.ruin_threshold:.0%}")
    if "max_drawdown" in mc.observed:
        axes[0].axvline(mc.observed["max_drawdown"] * 100, color="#1f4e79",
                        label="DD observé")
    axes[0].set_title(f"Max drawdown simulé — P(ruine) = {mc.ruin_probability:.2%}")
    axes[0].set_xlabel("%")
    axes[0].legend(fontsize=8)

    axes[1].hist(np.clip(mc.cagrs, -1, 5) * 100, bins=60, color="#1f4e79", alpha=0.8)
    axes[1].axvline(0, color="black", linewidth=1)
    if "cagr" in mc.observed and np.isfinite(mc.observed["cagr"]):
        axes[1].axvline(mc.observed["cagr"] * 100, color="#b22222", label="CAGR observé")
        axes[1].legend(fontsize=8)
    axes[1].set_title("CAGR simulé")
    axes[1].set_xlabel("%")
    return _finish(fig, path)


def parameter_heatmap(pivot: pd.DataFrame, title: str, path: Path | None = None) -> str:
    if pivot is None or pivot.empty:
        return ""
    values = pivot.to_numpy(dtype=float)
    fig, ax = plt.subplots(figsize=(6.5, 4))
    im = ax.imshow(values, cmap="viridis", aspect="auto")
    ax.set_xticks(range(len(pivot.columns)))
    ax.set_xticklabels(pivot.columns)
    ax.set_yticks(range(len(pivot.index)))
    ax.set_yticklabels(pivot.index)
    ax.set_xlabel(pivot.columns.name or "")
    ax.set_ylabel(pivot.index.name or "")
    for i in range(values.shape[0]):
        for j in range(values.shape[1]):
            v = values[i, j]
            if np.isfinite(v):
                ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=7, color="white")
    ax.set_title(title)
    ax.grid(False)
    fig.colorbar(im, ax=ax, shrink=0.85)
    return _finish(fig, path)


def walk_forward_plot(table: pd.DataFrame, path: Path | None = None, criterion: str = "sharpe") -> str:
    if table is None or table.empty:
        return ""
    train_col, test_col = f"train_{criterion}", f"test_{criterion}"
    if train_col not in table or test_col not in table:
        return ""
    fig, ax = plt.subplots(figsize=(10, 3.6))
    x = np.arange(len(table))
    ax.bar(x - 0.2, table[train_col].astype(float), width=0.4, label="in-sample (train)", color="#1f4e79")
    ax.bar(x + 0.2, table[test_col].astype(float), width=0.4, label="out-of-sample (test)", color="#b22222")
    ax.axhline(0, color="black", linewidth=1)
    ax.set_xticks(x)
    ax.set_xticklabels(table["label"], rotation=60, fontsize=7)
    ax.set_ylabel(criterion)
    ax.set_title("Walk-forward : dégradation train -> test")
    ax.legend(fontsize=8)
    return _finish(fig, path)


def risk_sensitivity_plot(table: pd.DataFrame, path: Path | None = None) -> str:
    """Couple rendement / probabilité de ruine selon risk_per_trade (§6.1)."""
    if table is None or table.empty:
        return ""
    fig, ax1 = plt.subplots(figsize=(7, 3.8))
    x = table["risk_per_trade"] * 100
    ax1.plot(x, table["median_cagr"] * 100, marker="o", color="#1f4e79", label="CAGR médian")
    ax1.set_xlabel("risque par trade (% de l'equity)")
    ax1.set_ylabel("CAGR médian (%)", color="#1f4e79")
    ax2 = ax1.twinx()
    ax2.plot(x, table["ruin_probability"] * 100, marker="s", color="#b22222",
             label="probabilité de ruine")
    ax2.set_ylabel("probabilité de ruine (%)", color="#b22222")
    ax2.grid(False)
    ax1.set_title("Rendement contre risque de ruine")
    return _finish(fig, path)

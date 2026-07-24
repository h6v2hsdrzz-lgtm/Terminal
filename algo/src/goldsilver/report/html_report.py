"""Rapport HTML autonome : equity, drawdown, Monte-Carlo, heatmaps, verdict.

Un seul fichier HTML (plotly inline par défaut : lisible hors-ligne).
Toutes les figures viennent des résultats de validation — rien n'est
recalculé ici, le rapport ne fait que MONTRER.
"""

from __future__ import annotations

import html
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import plotly.graph_objects as go

from goldsilver.config import Config
from goldsilver.metrics.performance import Metrics, monthly_return_table
from goldsilver.pipeline import RunResult
from goldsilver.report.verdict import Verdict
from goldsilver.validation.detrend import DetrendResult
from goldsilver.validation.monte_carlo import MonteCarloResult
from goldsilver.validation.noise import NoiseResult
from goldsilver.validation.oos import OOSResult
from goldsilver.validation.sensitivity import SensitivityResult
from goldsilver.validation.walk_forward import WalkForwardResult

GOLD = "#c9a227"
SILVER = "#9aa5b1"
RED = "#e05252"
GREEN = "#3fa66a"
BG = "#101418"
PANEL = "#171c22"
TEXT = "#d7dde4"

_LAYOUT = dict(
    template="plotly_dark",
    paper_bgcolor=PANEL,
    plot_bgcolor=PANEL,
    font=dict(color=TEXT, size=12),
    margin=dict(l=50, r=20, t=48, b=40),
    height=380,
)


@dataclass(frozen=True)
class ReportInputs:
    cfg: Config
    full_run: RunResult
    oos: OOSResult
    wf: WalkForwardResult
    mc: MonteCarloResult
    noise: NoiseResult
    detrend: DetrendResult
    sens: SensitivityResult
    verdict: Verdict
    data_summary: dict[str, dict[str, Any]]


# --------------------------------------------------------------------- utils

def _fig_html(fig: go.Figure, include_js: str | bool) -> str:
    return fig.to_html(full_html=False, include_plotlyjs=include_js,
                       config={"displaylogo": False})


def _pct(x: float, nd: int = 2) -> str:
    return "n/a" if x is None or not np.isfinite(x) else f"{100 * x:+.{nd}f} %"


def _num(x: float, nd: int = 2) -> str:
    return "n/a" if x is None or not np.isfinite(x) else f"{x:.{nd}f}"


def _metrics_rows(pairs: list[tuple[str, Metrics]]) -> str:
    keys = [
        ("Rendement total", lambda m: _pct(m.total_return)),
        ("CAGR", lambda m: _pct(m.cagr)),
        ("Rendement mensuel moyen", lambda m: _pct(m.monthly_mean)),
        ("Écart-type mensuel", lambda m: _pct(m.monthly_std)),
        ("Sharpe", lambda m: _num(m.sharpe)),
        ("Sortino", lambda m: _num(m.sortino)),
        ("Max drawdown", lambda m: _pct(-m.max_drawdown)),
        ("Trades", lambda m: str(m.n_trades)),
        ("Win rate", lambda m: _pct(m.win_rate, 1)),
        ("Profit factor", lambda m: _num(m.profit_factor)),
        ("Espérance (R)", lambda m: _num(m.expectancy_r, 3)),
        ("Espérance ($)", lambda m: _num(m.expectancy_usd)),
        ("Swap total payé ($)", lambda m: _num(m.total_swap_paid)),
    ]
    head = "<tr><th></th>" + "".join(f"<th>{html.escape(n)}</th>" for n, _ in pairs) + "</tr>"
    rows = []
    for label, fn in keys:
        cells = "".join(f"<td>{fn(m)}</td>" for _, m in pairs)
        rows.append(f"<tr><td class='k'>{label}</td>{cells}</tr>")
    return f"<table class='metrics'>{head}{''.join(rows)}</table>"


# -------------------------------------------------------------------- figures

def fig_equity(run: RunResult, split: pd.Timestamp | None) -> go.Figure:
    eq = run.equity
    dd = eq / eq.cummax() - 1.0
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=eq.index, y=eq.to_numpy(), name="Equity",
                             line=dict(color=GOLD, width=1.4)))
    fig.add_trace(go.Scatter(x=dd.index, y=100 * dd.to_numpy(), name="Drawdown (%)",
                             yaxis="y2", line=dict(color=RED, width=1),
                             fill="tozeroy", opacity=0.6))
    if split is not None:
        fig.add_vline(x=split, line_dash="dash", line_color=SILVER)
        fig.add_annotation(x=split, y=1, yref="paper", text="split OOS",
                           showarrow=False, font=dict(color=SILVER, size=11))
    fig.update_layout(
        **_LAYOUT,
        title="Equity mark-to-market et drawdown (paramètres par défaut, toute la période)",
        yaxis=dict(title="Equity ($)"),
        yaxis2=dict(title="DD (%)", overlaying="y", side="right", showgrid=False),
        legend=dict(orientation="h", y=1.08),
    )
    return fig


def fig_monthly_heatmap(run: RunResult, initial_equity: float) -> go.Figure:
    table = monthly_return_table(run.equity, initial_equity)
    z = 100 * table.to_numpy(dtype=float)
    fig = go.Figure(go.Heatmap(
        z=z,
        x=[f"{m:02d}" for m in table.columns],
        y=[str(y) for y in table.index],
        colorscale=[[0, RED], [0.5, "#20262e"], [1, GREEN]],
        zmid=0.0,
        text=np.where(np.isfinite(z), np.vectorize(lambda v: f"{v:+.1f}")(np.nan_to_num(z)), ""),
        texttemplate="%{text}",
        colorbar=dict(title="%"),
    ))
    fig.update_layout(**_LAYOUT, title="Rendements mensuels (%) — backtest complet",
                      yaxis=dict(autorange="reversed"))
    return fig


def fig_wf(wf: WalkForwardResult) -> go.Figure:
    x = [f"F{f.fold}<br>{f.train_end.date()}" for f in wf.folds]
    fig = go.Figure()
    fig.add_trace(go.Bar(x=x, y=[100 * f.is_annual_return for f in wf.folds],
                         name="IS annualisé (train)", marker_color=SILVER, opacity=0.55))
    fig.add_trace(go.Bar(x=x, y=[100 * f.oos_annual_return for f in wf.folds],
                         name="OOS annualisé (test)", marker_color=GOLD))
    fig.update_layout(**_LAYOUT, barmode="group",
                      title="Walk-forward : rendement annualisé par fold (IS vs OOS)",
                      yaxis=dict(title="%/an"))
    return fig


def fig_wf_equity(wf: WalkForwardResult) -> go.Figure:
    s = wf.stitched_equity
    fig = go.Figure(go.Scatter(x=s.index, y=s.to_numpy(), name="Equity OOS chaînée",
                               line=dict(color=GOLD, width=1.4)))
    fig.update_layout(**_LAYOUT,
                      title="Equity 100 % out-of-sample (segments de test chaînés, base 1.0)",
                      yaxis=dict(title="multiple"))
    return fig


def fig_mc(mc: MonteCarloResult) -> go.Figure:
    from plotly.subplots import make_subplots
    fig = make_subplots(rows=1, cols=3, subplot_titles=(
        "Rendement final (reshuffle)", "Max drawdown (reshuffle)", "Chemins d'equity (extraits)"))
    fig.add_trace(go.Histogram(x=100 * mc.shuffle.final_returns, nbinsx=60,
                               marker_color=GOLD, name="reshuffle"), 1, 1)
    fig.add_trace(go.Histogram(x=100 * mc.bootstrap.final_returns, nbinsx=60,
                               marker_color=SILVER, opacity=0.55, name="bootstrap"), 1, 1)
    fig.add_trace(go.Histogram(x=100 * mc.shuffle.max_drawdowns, nbinsx=60,
                               marker_color=RED, name="max DD"), 1, 2)
    paths = mc.shuffle.sample_paths
    xs = np.arange(paths.shape[1])
    for k in range(min(60, paths.shape[0])):
        fig.add_trace(go.Scatter(x=xs, y=paths[k], mode="lines", showlegend=False,
                                 line=dict(color=GOLD, width=0.5), opacity=0.18), 1, 3)
    fig.update_layout(**{**_LAYOUT, "height": 360},
                      title=f"Monte-Carlo ({mc.shuffle.final_returns.size} runs, {mc.n_trades} trades)")
    fig.update_xaxes(title_text="%", row=1, col=1)
    fig.update_xaxes(title_text="%", row=1, col=2)
    fig.update_xaxes(title_text="n° de trade", row=1, col=3)
    return fig


def fig_noise(noise: NoiseResult) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Histogram(x=noise.sharpes, nbinsx=40, marker_color=GOLD,
                               name="Sharpe (runs bruités)"))
    fig.add_vline(x=noise.base_sharpe, line_color=TEXT, line_dash="dash")
    fig.add_annotation(x=noise.base_sharpe, y=1, yref="paper",
                       text=f"base {noise.base_sharpe:.2f}", showarrow=False)
    fig.update_layout(**_LAYOUT,
                      title=(f"Noise test : Sharpe sous bruit {noise.atr_frac:.0%} x ATR "
                             f"({noise.n_runs} runs, {noise.profitable_frac:.0%} profitables)"))
    return fig


def fig_detrend(dt: DetrendResult) -> go.Figure:
    cats = ["Sharpe", "Rendement mensuel moyen (%)", "Max DD (%)"]
    base_m, det_m = dt.base.metrics, dt.detrended.metrics
    fig = go.Figure()
    fig.add_trace(go.Bar(x=cats, name="Données réelles", marker_color=GOLD,
                         y=[base_m.sharpe, 100 * base_m.monthly_mean, -100 * base_m.max_drawdown]))
    fig.add_trace(go.Bar(x=cats, name="Données détendues", marker_color=SILVER,
                         y=[det_m.sharpe, 100 * det_m.monthly_mean, -100 * det_m.max_drawdown]))
    drift = ", ".join(f"{a}: {v:+.1f} %/an" for a, v in dt.drift_annual_pct.items())
    fig.update_layout(**_LAYOUT, barmode="group",
                      title=f"Detrending — dérive retirée ({drift})")
    return fig


def fig_sensitivity(m) -> go.Figure:
    fig = go.Figure(go.Heatmap(
        z=m.grid,
        x=[str(v) for v in m.x_values],
        y=[str(v) for v in m.y_values],
        colorscale="Cividis",
        colorbar=dict(title=m.metric),
        text=np.round(m.grid, 2), texttemplate="%{text}",
    ))
    if m.default_cell is not None:
        iy, ix = m.default_cell
        fig.add_annotation(x=str(m.x_values[ix]), y=str(m.y_values[iy]),
                           text="▣", showarrow=False,
                           font=dict(color="#ffffff", size=16))
    fig.update_layout(**_LAYOUT,
                      title=(f"Sensibilité {m.metric} : {m.param_x} (x) × {m.param_y} (y) — "
                             f"plateau {m.plateau_score:.2f}, ▣ = défaut"),
                      xaxis=dict(title=m.param_x, type="category"),
                      yaxis=dict(title=m.param_y, type="category"))
    return fig


def fig_r_histogram(run: RunResult) -> go.Figure:
    trades = run.trades
    fig = go.Figure()
    for asset, color in zip(sorted(trades["asset"].unique()), (GOLD, SILVER)):
        sub = trades[trades["asset"] == asset]
        fig.add_trace(go.Histogram(x=sub["r_multiple"], nbinsx=50, name=asset,
                                   marker_color=color, opacity=0.7))
    fig.update_layout(**_LAYOUT, barmode="overlay",
                      title="Distribution des trades en multiples de R",
                      xaxis=dict(title="R"))
    return fig


# --------------------------------------------------------------------- report

def write_report(inputs: ReportInputs, out_path: Path) -> Path:
    cfg = inputs.cfg
    v = inputs.verdict
    include_js: str | bool = True if cfg.report.plotlyjs == "inline" else "cdn"

    figs: list[go.Figure] = [
        fig_equity(inputs.full_run, inputs.oos.split_time),
        fig_monthly_heatmap(inputs.full_run, cfg.engine.initial_equity),
        fig_wf(inputs.wf),
        fig_wf_equity(inputs.wf),
        fig_mc(inputs.mc),
        fig_noise(inputs.noise),
        fig_detrend(inputs.detrend),
        *[fig_sensitivity(m) for m in inputs.sens.maps],
        fig_r_histogram(inputs.full_run),
    ]
    fig_html: list[str] = []
    for i, f in enumerate(figs):
        fig_html.append(_fig_html(f, include_js if i == 0 else False))

    verdict_class = {"ROBUSTE": "ok", "FRAGILE": "warn"}.get(v.label, "bad")
    checks_rows = "".join(
        f"<tr class='{'pass' if c.passed else 'fail'}'>"
        f"<td>{'✔' if c.passed else '✘'}</td>"
        f"<td>{html.escape(c.name)}{' <span class=core>(cœur)</span>' if c.core else ''}</td>"
        f"<td>{html.escape(c.value)}</td><td>{html.escape(c.threshold)}</td></tr>"
        for c in v.checks
    )

    oos_m = inputs.oos.default_oos.metrics
    is_m = inputs.oos.default_is.metrics
    t_is, t_oos = inputs.oos.tuned_is.metrics, inputs.oos.tuned_oos.metrics
    comparison = _metrics_rows([
        ("IS (défaut)", is_m), ("OOS (défaut)", oos_m),
        ("IS (optimisé)", t_is), ("OOS (optimisé)", t_oos),
    ])

    per_asset_rows = ""
    trades = inputs.full_run.trades
    for asset in sorted(cfg.data.assets):
        sub = trades[trades["asset"] == asset]
        if len(sub) == 0:
            per_asset_rows += f"<tr><td class='k'>{asset}</td><td colspan=5>aucun trade</td></tr>"
            continue
        wr = float((sub["pnl"] > 0).mean())
        gw, gl = sub.loc[sub["pnl"] > 0, "pnl"].sum(), -sub.loc[sub["pnl"] <= 0, "pnl"].sum()
        pf = gw / gl if gl > 0 else float("inf")
        per_asset_rows += (
            f"<tr><td class='k'>{asset}</td><td>{len(sub)}</td><td>{_pct(wr, 1)}</td>"
            f"<td>{_num(pf)}</td><td>{_num(sub['r_multiple'].mean(), 3)}</td>"
            f"<td>{_num(sub['pnl'].sum())}</td></tr>"
        )

    data_rows = "".join(
        f"<tr><td class='k'>{a}</td><td>{d['bars']}</td><td>{d['start']}</td>"
        f"<td>{d['end']}</td><td>{d['median_spread']}</td><td>{d['spread_p90']}</td></tr>"
        for a, d in inputs.data_summary.items()
    )

    params_json = html.escape(json.dumps(inputs.full_run.params, indent=2, ensure_ascii=False))
    wf_params = inputs.wf.params_stability.to_html(index=False, border=0, classes="metrics")

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lo, hi = v.benchmark_pct

    page = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Validation XAU/XAG — {html.escape(v.label)}</title>
<style>
  body {{ background:{BG}; color:{TEXT}; font:14px/1.55 -apple-system,'Segoe UI',Roboto,sans-serif;
         margin:0; padding:24px; }}
  .wrap {{ max-width:1180px; margin:0 auto; }}
  h1 {{ font-size:22px; color:{GOLD}; }} h2 {{ font-size:17px; margin-top:36px;
       border-bottom:1px solid #2a323c; padding-bottom:6px; }}
  .banner {{ padding:18px 22px; border-radius:10px; margin:18px 0; font-size:17px; }}
  .banner.ok {{ background:#12351f; border:1px solid {GREEN}; }}
  .banner.warn {{ background:#3a2f10; border:1px solid {GOLD}; }}
  .banner.bad {{ background:#3a1512; border:1px solid {RED}; }}
  .banner .label {{ font-size:26px; font-weight:700; letter-spacing:1px; }}
  .callout {{ background:{PANEL}; border-left:4px solid {GOLD}; padding:12px 16px;
              border-radius:6px; margin:14px 0; }}
  table.metrics {{ border-collapse:collapse; width:100%; margin:12px 0; font-size:13px; }}
  table.metrics th, table.metrics td {{ border:1px solid #2a323c; padding:6px 10px;
      text-align:right; }}
  table.metrics td.k, table.metrics th:first-child {{ text-align:left; }}
  tr.pass td {{ color:{GREEN}; }} tr.fail td {{ color:{RED}; }}
  .core {{ color:{SILVER}; font-size:11px; }}
  .fig {{ background:{PANEL}; border-radius:10px; padding:8px; margin:16px 0; }}
  pre {{ background:{PANEL}; padding:12px; border-radius:8px; overflow-x:auto; }}
  .muted {{ color:{SILVER}; font-size:12.5px; }}
</style></head><body><div class="wrap">

<h1>Validation anti-overfitting — algo or (XAU/USD) &amp; argent (XAG/USD)</h1>
<p class="muted">Généré le {generated} · stratégie <b>{html.escape(cfg.strategy.name)}</b> ·
seed {cfg.seed} · spread <b>{html.escape(cfg.engine.costs.spread_mode)}</b>
(x{cfg.engine.costs.pessimistic_spread_mult:g} pessimiste) · risque
{100 * cfg.engine.risk_pct:g} %/trade · worst-case intrabar :
{"oui" if cfg.engine.intrabar_worst_case else "non"}</p>

<div class="banner {verdict_class}">
  <div class="label">VERDICT : {html.escape(v.label)}</div>
  <div>{v.n_passed}/{v.n_total} contrôles passés
  ({v.n_core_passed}/3 contrôles cœur : OOS, dégradation, walk-forward)</div>
</div>

<div class="callout">
  <b>Rendement mensuel RÉEL observé</b> (paramètres par défaut, période 100 %
  out-of-sample, coûts pessimistes) :
  <b>{_pct(v.oos_monthly_mean)}</b> / mois en moyenne,
  écart-type {_pct(v.oos_monthly_std)} sur ~{v.oos_n_months:.0f} mois.
  Walk-forward (segments OOS chaînés) : <b>{_pct(v.wf_oos_annual_return)}</b> / an.<br>
  <span class="muted">Cible affichée par l'utilisateur : {lo:g}-{hi:g} %/mois —
  traitée comme un benchmark à mesurer, jamais comme une contrainte.</span><br>
  {html.escape(v.benchmark_verdict)}
</div>

<h2>Contrôles</h2>
<table class="metrics">
<tr><th></th><th>Contrôle</th><th>Mesuré</th><th>Seuil</th></tr>
{checks_rows}
</table>

<h2>Backtest complet (contexte in-sample — à lire avec méfiance)</h2>
<div class="fig">{fig_html[0]}</div>
<div class="fig">{fig_html[1]}</div>

<h2>In-sample vs out-of-sample (split {html.escape(str(inputs.oos.split_time.date()))})</h2>
<p class="muted">« défaut » = paramètres de la config appliqués tels quels.
« optimisé » = grid-search sur le train uniquement
(paramètres retenus : {html.escape(json.dumps(inputs.oos.tuned_params))}), figés sur le test.</p>
{comparison}

<h2>Walk-forward</h2>
<div class="fig">{fig_html[2]}</div>
<div class="fig">{fig_html[3]}</div>
<p class="muted">Stabilité des paramètres retenus par fold (des paramètres qui
changent du tout au tout à chaque fold = optimisation de bruit) :</p>
{wf_params}

<h2>Monte-Carlo</h2>
<div class="fig">{fig_html[4]}</div>

<h2>Noise test</h2>
<div class="fig">{fig_html[5]}</div>

<h2>Detrending</h2>
<div class="fig">{fig_html[6]}</div>

<h2>Sensibilité aux paramètres</h2>
{''.join(f'<div class="fig">{h}</div>' for h in fig_html[7:-1])}

<h2>Trades (backtest complet, par actif)</h2>
<table class="metrics">
<tr><th>Actif</th><th>Trades</th><th>Win rate</th><th>PF</th><th>R moyen</th><th>PnL net ($)</th></tr>
{per_asset_rows}
</table>
<div class="fig">{fig_html[-1]}</div>

<h2>Données &amp; reproductibilité</h2>
<table class="metrics">
<tr><th>Actif</th><th>Bougies</th><th>Début</th><th>Fin</th>
<th>Spread médian ($)</th><th>Spread p90 ($)</th></tr>
{data_rows}
</table>
<p class="muted">Paramètres de stratégie utilisés :</p>
<pre>{params_json}</pre>
<p class="muted">Ce rapport mesure un backtest, pas l'avenir. Les coûts réels
(spread en période de news, slippage sur stops, swaps) peuvent être pires que
les hypothèses — elles sont volontairement pessimistes mais pas garanties.
Rien ici n'est un conseil en investissement.</p>

</div></body></html>"""

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(page, encoding="utf-8")
    return out_path

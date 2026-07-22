"""Self-contained HTML report: verdict banner, metrics table, validation
details and all plots."""

from __future__ import annotations

import html as html_mod
from pathlib import Path

import plotly.graph_objects as go

from quantbt.config import ReportConfig
from quantbt.engine.backtester import BacktestResult
from quantbt.metrics.core import Metrics
from quantbt.report import plots
from quantbt.validation.common import ValidationOutcome
from quantbt.validation.verdict import Verdict

_VERDICT_COLORS = {"ROBUST": "#1a7f37", "FRAGILE": "#b58105", "OVERFIT": "#c62828"}

_PCT_KEYS = {"max_drawdown", "win_rate", "exposure", "total_return", "cagr"}

_CSS = """
body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0;
       background: #f6f7f9; color: #1c2733; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
.banner { color: white; padding: 18px 24px; border-radius: 10px; margin: 16px 0;
          font-size: 1.3rem; font-weight: 700; }
.banner small { display:block; font-size: .85rem; font-weight: 400; margin-top: 6px; }
table.metrics { border-collapse: collapse; width: 100%; background: white;
                border-radius: 8px; overflow: hidden; }
table.metrics th, table.metrics td { padding: 8px 14px; text-align: left;
                border-bottom: 1px solid #e8ebee; font-size: .9rem; }
table.metrics th { background: #eef1f4; }
.flag { padding: 6px 12px; border-radius: 6px; margin: 4px 0; font-size: .88rem; }
.flag.pass { background: #e6f4ea; } .flag.warn { background: #fdf3d7; }
.flag.fail { background: #fde3e1; }
.fig { background: white; border-radius: 8px; padding: 8px; margin: 12px 0; }
"""


def _fmt(key: str, val: object) -> str:
    if isinstance(val, float):
        if key in _PCT_KEYS:
            return f"{val:.1%}"
        return f"{val:.2f}"
    return html_mod.escape(str(val))


def _metrics_table(title: str, columns: dict[str, Metrics | dict]) -> str:
    cols = {
        name: (m.as_dict() if isinstance(m, Metrics) else m) for name, m in columns.items()
    }
    keys = list(next(iter(cols.values())).keys())
    head = "".join(f"<th>{html_mod.escape(c)}</th>" for c in cols)
    rows = "".join(
        "<tr><td>{}</td>{}</tr>".format(
            html_mod.escape(k), "".join(f"<td>{_fmt(k, cols[c][k])}</td>" for c in cols)
        )
        for k in keys
    )
    return (
        f"<h2>{html_mod.escape(title)}</h2>"
        f"<table class='metrics'><tr><th>metric</th>{head}</tr>{rows}</table>"
    )


def build_report(
    result: BacktestResult,
    metrics: Metrics,
    outcomes: list[ValidationOutcome],
    verdict: Verdict,
    cfg: ReportConfig,
    out_path: str | Path | None = None,
) -> Path:
    by_module = {o.module: o for o in outcomes}
    include_js: str | bool = "cdn" if cfg.plotlyjs == "cdn" else True
    first_fig = True

    def render(fig: go.Figure | None) -> str:
        nonlocal first_fig
        if fig is None:
            return ""
        inc = include_js if first_fig else False
        first_fig = False
        return "<div class='fig'>" + fig.to_html(full_html=False, include_plotlyjs=inc) + "</div>"

    parts: list[str] = []
    parts.append(f"<h1>{html_mod.escape(cfg.title)}</h1>")
    meta = result.meta
    parts.append(
        f"<p>Strategy <b>{html_mod.escape(str(meta.get('strategy')))}</b> — params "
        f"<code>{html_mod.escape(str(meta.get('params')))}</code> — "
        f"{len(result.trades)} trades, {len(result.equity)} bars.</p>"
    )

    color = _VERDICT_COLORS.get(verdict.label, "#555")
    reasons = "<br>".join(html_mod.escape(r) for r in verdict.reasons[:8])
    parts.append(
        f"<div class='banner' style='background:{color}'>VERDICT : {verdict.label} "
        f"(score {verdict.score:.0%})<small>{reasons}</small></div>"
    )

    parts.append(_metrics_table("Performance (full sample)", {"value": metrics}))
    wf_eq = by_module.get("walkforward")
    parts.append("<h2>Equity & drawdown</h2>")
    parts.append(render(plots.equity_fig(
        result, wf_eq.payload.get("oos_equity") if wf_eq else None)))
    parts.append(render(plots.drawdown_fig(result)))

    if "oos" in by_module and by_module["oos"].payload:
        p = by_module["oos"].payload
        parts.append(_metrics_table(
            f"In-sample vs out-of-sample (split at {p.get('split_time')})",
            {"in-sample": p["in_sample"], "out-of-sample": p["out_of_sample"]},
        ))

    if "montecarlo" in by_module and by_module["montecarlo"].payload:
        parts.append("<h2>Monte-Carlo</h2>")
        parts.append(render(plots.montecarlo_fig(by_module["montecarlo"].payload)))
        parts.append(render(plots.montecarlo_hist_fig(by_module["montecarlo"].payload)))

    if "noise" in by_module and by_module["noise"].payload:
        parts.append("<h2>Noise test</h2>")
        parts.append(render(plots.noise_fig(by_module["noise"].payload)))

    if "sensitivity" in by_module and by_module["sensitivity"].payload:
        parts.append("<h2>Parameter sensitivity</h2>")
        parts.append(render(plots.sensitivity_fig(by_module["sensitivity"].payload)))

    if "detrend" in by_module and by_module["detrend"].payload:
        p = by_module["detrend"].payload
        parts.append(_metrics_table("Raw vs detrended",
                                    {"raw": p["raw"], "detrended": p["detrended"]}))

    parts.append("<h2>Validation checks</h2>")
    for o in outcomes:
        for f in o.flags:
            parts.append(
                f"<div class='flag {f.status}'><b>{html_mod.escape(f.name)}</b> "
                f"[{f.status}] — {html_mod.escape(f.detail)}</div>"
            )

    body = "\n".join(parts)
    doc = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{html_mod.escape(cfg.title)}</title><style>{_CSS}</style></head>"
        f"<body><div class='wrap'>{body}</div></body></html>"
    )

    out = Path(out_path) if out_path else Path(cfg.output_dir) / "report.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
    return out

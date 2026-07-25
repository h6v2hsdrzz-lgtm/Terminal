"""Rapport HTML autoportant (images embarquées en base64).

Le rapport est publié **quelle que soit la conclusion** (§12). Il expose donc,
au même niveau de visibilité que la performance : le nombre d'essais, la
dégradation in-sample -> out-of-sample, les limites de données et les tests qui
échouent.
"""

from __future__ import annotations

import html as html_lib
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..utils import ensure_dir, get_logger

log = get_logger("reports.html")

CSS = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       margin: 0 auto; max-width: 1180px; padding: 24px 18px 80px; line-height: 1.55;
       background: #ffffff; color: #16202a; }
h1 { font-size: 1.7rem; margin: 0 0 4px; }
h2 { font-size: 1.22rem; margin: 34px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #e3e8ee; }
h3 { font-size: 1.02rem; margin: 22px 0 8px; }
.sub { color: #5b6b7c; margin: 0 0 18px; font-size: .93rem; }
table { border-collapse: collapse; width: 100%; font-size: .84rem; margin: 10px 0 18px; }
th, td { border: 1px solid #dfe5ec; padding: 5px 8px; text-align: right; }
th { background: #f3f6f9; font-weight: 600; text-align: right; }
td:first-child, th:first-child { text-align: left; }
tbody tr:nth-child(even) { background: #fafbfc; }
img { max-width: 100%; height: auto; display: block; margin: 12px 0 20px; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 10px; margin: 16px 0 22px; }
.kpi { border: 1px solid #dfe5ec; border-radius: 8px; padding: 10px 12px; background: #fbfcfd; }
.kpi .label { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: #5b6b7c; }
.kpi .value { font-size: 1.28rem; font-weight: 650; margin-top: 3px; }
.pos { color: #14683a; } .neg { color: #a01c2c; } .neutral { color: #16202a; }
.callout { border-left: 4px solid #1f4e79; background: #f2f7fc; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0; }
.callout.warn { border-left-color: #b8860b; background: #fdf8ec; }
.callout.bad { border-left-color: #a01c2c; background: #fcf2f3; }
.callout.good { border-left-color: #14683a; background: #f1f8f3; }
.callout p:first-child { margin-top: 0; } .callout p:last-child { margin-bottom: 0; }
code { background: #f3f6f9; padding: 1px 5px; border-radius: 4px; font-size: .86em; }
.scroll { overflow-x: auto; }
footer { margin-top: 50px; font-size: .8rem; color: #5b6b7c; border-top: 1px solid #e3e8ee; padding-top: 14px; }
@media (prefers-color-scheme: dark) {
  body { background: #12181f; color: #e6edf3; }
  h2 { border-bottom-color: #2a3542; }
  th { background: #1b2530; } th, td { border-color: #2a3542; }
  tbody tr:nth-child(even) { background: #161d26; }
  .kpi { background: #171f28; border-color: #2a3542; }
  .callout { background: #16222e; } .callout.warn { background: #262117; }
  .callout.bad { background: #2a1a1d; } .callout.good { background: #16241b; }
  code { background: #1b2530; }
  .pos { color: #4ade80; } .neg { color: #f87171; }
}
"""

PCT_KEYS = {
    "cagr", "total_return", "max_drawdown", "monthly_median", "monthly_mean", "monthly_std",
    "monthly_positive_share", "win_rate", "exposure_ratio", "halted_ratio", "var_95", "var_99",
    "cvar_95", "cvar_99", "best_day", "worst_day", "volatility_annual", "benchmark_cagr",
    "benchmark_max_drawdown", "excess_cagr", "months_beating_benchmark", "costs_over_gross_pnl",
    "monthly_median_ci_low", "monthly_median_ci_high", "ruin_probability", "net_over_gross",
    "ambiguous_resolution_share",
}


def fmt(value: Any, key: str = "") -> str:
    if value is None:
        return "—"
    if isinstance(value, (bool, np.bool_)):
        return "oui" if value else "non"
    if isinstance(value, (int, np.integer)):
        return f"{int(value):,}".replace(",", " ")
    if isinstance(value, (float, np.floating)):
        if not np.isfinite(value):
            return "—"
        if key in PCT_KEYS:
            return f"{value * 100:.2f} %"
        if abs(value) >= 1000:
            return f"{value:,.0f}".replace(",", " ")
        return f"{value:.3f}"
    return html_lib.escape(str(value))


def table_html(df: pd.DataFrame, max_rows: int = 200, percent_cols: set[str] | None = None) -> str:
    if df is None or len(df) == 0:
        return "<p><em>aucune donnée</em></p>"
    percent_cols = percent_cols or set()
    view = df.head(max_rows)
    head = "".join(f"<th>{html_lib.escape(str(c))}</th>" for c in view.columns)
    rows = []
    for _, row in view.iterrows():
        cells = []
        for col, value in row.items():
            key = str(col) if str(col) in PCT_KEYS or str(col) in percent_cols else ""
            cells.append(f"<td>{fmt(value, key)}</td>")
        rows.append("<tr>" + "".join(cells) + "</tr>")
    extra = "" if len(df) <= max_rows else f"<p><em>… {len(df) - max_rows} lignes supplémentaires</em></p>"
    return f'<div class="scroll"><table><thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></div>{extra}'


def kpi_grid(items: list[tuple[str, Any, str]]) -> str:
    cells = []
    for label, value, key in items:
        css = "neutral"
        if isinstance(value, (int, float, np.floating)) and np.isfinite(value):
            if key in {"max_drawdown", "var_95", "var_99", "cvar_95", "cvar_99"}:
                css = "neg" if value < 0 else "neutral"
            elif key not in {"trades", "months"}:
                css = "pos" if value > 0 else ("neg" if value < 0 else "neutral")
        cells.append(
            f'<div class="kpi"><div class="label">{html_lib.escape(label)}</div>'
            f'<div class="value {css}">{fmt(value, key)}</div></div>'
        )
    return f'<div class="kpi-grid">{"".join(cells)}</div>'


def image(b64: str, alt: str = "") -> str:
    if not b64:
        return ""
    return f'<img src="data:image/png;base64,{b64}" alt="{html_lib.escape(alt)}">'


def callout(text: str, kind: str = "") -> str:
    cls = f"callout {kind}".strip()
    return f'<div class="{cls}">{text}</div>'


def render_report(
    title: str,
    subtitle: str,
    sections: list[tuple[str, str]],
    path: str | Path,
) -> Path:
    body = "\n".join(f"<h2>{html_lib.escape(name)}</h2>\n{content}" for name, content in sections)
    html_doc = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html_lib.escape(title)}</title>
<style>{CSS}</style>
</head>
<body>
<h1>{html_lib.escape(title)}</h1>
<p class="sub">{subtitle}</p>
{body}
<footer>
Rapport généré par <code>crypto_algo</code> — framework de recherche et de backtest.
Le backtest est un outil d'audit&nbsp;: sa fonction est de pouvoir invalider la stratégie.
</footer>
</body>
</html>
"""
    p = Path(path)
    ensure_dir(p.parent)
    p.write_text(html_doc, encoding="utf-8")
    log.info("Rapport écrit : %s", p)
    return p

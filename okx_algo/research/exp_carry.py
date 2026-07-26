"""Brique 5 (carry de funding relatif) — test IS + OOS. Post-OOS."""
import sys; sys.path.insert(0,'/home/user/Terminal')
import numpy as np, pandas as pd, logging
logging.basicConfig(level=logging.ERROR)
from okx_algo.core.config import load_config
from okx_algo.research.pipeline import get_panel, make_targets, run_engine, window
from okx_algo.backtest.metrics import summarize, monthly_returns

cfg = load_config()
cfg.set("strategies.funding_carry.enabled", True)
cfg.set("strategies.ts_momentum.rebalance_timeframe","1D")
cfg.set("strategies.ts_momentum.deadband",0.10)
cfg.set("backtest.min_order_fraction",0.15)
panel = get_panel(cfg)

for names,lab in [(["funding_carry"],"brique 5 (carry relatif) seule"),
                  (["ts_momentum","funding_carry"],"briques 1+5")]:
    print(f"\n### {lab}")
    for w in ["is","oos"]:
        c=cfg.copy(); tgt,diag=make_targets(c,panel,names)
        a,b=window(c,panel,w)
        r=run_engine(c,panel,tgt,a,b,leverage=1.0,label=lab)
        m=summarize(r); mr=monthly_returns(r.equity)
        print(f"  {w.upper():4s} sharpe {m['sharpe']:7.3f} | annuel {m['cagr']*100:7.2f}% "
              f"| vol {(m['cagr']/m['sharpe']*100 if m['sharpe'] else 0):6.2f}% "
              f"| DD {m['max_drawdown']*100:7.2f}% | trades {m['n_trades']:5d} "
              f"| PF {m['profit_factor']:5.2f} | funding {m['funding_total']:9.0f}")
    if names==["funding_carry"]:
        print("  diagnostics:", {k:(round(v,4) if isinstance(v,float) else v)
                                 for k,v in diag.items() if k in ()} )

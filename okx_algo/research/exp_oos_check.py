import sys; sys.path.insert(0,'/home/user/Terminal')
import numpy as np, pandas as pd, logging
logging.basicConfig(level=logging.ERROR)
from okx_algo.core.config import load_config
from okx_algo.research.pipeline import get_panel, make_targets, run_engine, window
from okx_algo.backtest.metrics import summarize, monthly_returns, alpha_beta
from okx_algo.backtest import benchmarks as bm

cfg = load_config()
cfg.set("strategies.ts_momentum.rebalance_timeframe","1D")
cfg.set("strategies.ts_momentum.deadband",0.10)
cfg.set("backtest.min_order_fraction",0.15)
panel = get_panel(cfg); tgt,_ = make_targets(cfg,panel)
print("Configuration : rebalance 1D, deadband 0.10, seuil min d'ordre 15% de l'equity, levier 1x\n")
out={}
for w in ["is","oos"]:
    a,b = window(cfg,panel,w)
    r = run_engine(cfg,panel,tgt,a,b,leverage=1.0,label=w)
    m = summarize(r); mr=monthly_returns(r.equity); out[w]=(m,mr,r,a,b)
    print(f"--- {w.upper()} ---")
    for k in ("sharpe","cagr","monthly_return_median","max_drawdown","n_trades",
              "win_rate","profit_factor","costs_pct_of_gross_pnl","n_liquidations"):
        v=m.get(k); print(f"   {k:26s} {v:9.4f}" if isinstance(v,(int,float)) and v==v else f"   {k:26s} {v}")
    print(f"   {'mensuel median (%/mois)':26s} {float(mr.median())*100:9.2f}")

mi,_,_,_,_ = out["is"]; mo,mro,ro,a,b = out["oos"]
deg = (mi["sharpe"]-mo["sharpe"])/abs(mi["sharpe"]) if mi["sharpe"] else float('nan')
print(f"\ndegradation Sharpe IS->OOS : {deg*100:.1f}%")
bench = bm.btc_hold(panel, ro.stats["initial_equity"], i0=a, i1=b)
ab = alpha_beta(ro.returns, bench.pct_change())
print(f"alpha OOS {ab['alpha_annualized']*100:+.2f}%/an (t={ab['alpha_tstat']:.2f}), beta {ab['beta']:.3f}")
print(f"BTC hold sur la meme fenetre : {bench.iloc[-1]/bench.iloc[0]-1:+.2%}")

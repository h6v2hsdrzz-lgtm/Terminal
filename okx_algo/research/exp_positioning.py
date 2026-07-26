"""Test de la brique 4 (positionnement) seule puis combinee. Post-OOS."""
import sys; sys.path.insert(0,'/home/user/Terminal')
import numpy as np, pandas as pd, logging
logging.basicConfig(level=logging.ERROR)
from okx_algo.core.config import load_config
from okx_algo.research.pipeline import get_panel, make_targets, run_engine, window
from okx_algo.backtest.metrics import summarize, monthly_returns

cfg = load_config()
cfg.set("strategies.ts_momentum.rebalance_timeframe","1D")
cfg.set("strategies.ts_momentum.deadband",0.10)
cfg.set("backtest.min_order_fraction",0.15)
cfg.set("strategies.positioning.enabled", True)
panel = get_panel(cfg)

combos = [(["positioning"],"brique 4 seule"),
          (["ts_momentum"],"brique 1 seule"),
          (["ts_momentum","positioning"],"briques 1+4"),
          (["ts_momentum","cross_sectional","cascade_reversal","positioning"],"portefeuille 4 briques")]
rows=[]
for names,lab in combos:
    for w in ["is","oos"]:
        c=cfg.copy(); tgt,_=make_targets(c,panel,names)
        a,b=window(c,panel,w)
        r=run_engine(c,panel,tgt,a,b,leverage=1.0,label=lab)
        m=summarize(r); mr=monthly_returns(r.equity)
        rows.append(dict(config=lab,fenetre=w.upper(),sharpe=m["sharpe"],annuel=m["cagr"],
            mensuel=float(mr.median()),dd=m["max_drawdown"],trades=m["n_trades"],
            pf=m["profit_factor"],couts=m.get("costs_pct_of_gross_pnl")))
df=pd.DataFrame(rows); pd.set_option("display.width",220)
print(df.to_string(index=False,float_format=lambda x:f"{x:9.4f}"))
df.to_csv("/home/user/Terminal/artifacts/exp_positioning.csv",index=False)

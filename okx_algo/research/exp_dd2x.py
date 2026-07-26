import sys; sys.path.insert(0,'/home/user/Terminal')
import numpy as np, pandas as pd, logging
logging.basicConfig(level=logging.ERROR)
from okx_algo.core.config import load_config
from okx_algo.research.pipeline import get_panel, make_targets, run_engine, window
from okx_algo.backtest.metrics import summarize, monthly_returns

cfg = load_config()
# configuration retenue par la recherche (H5)
cfg.set("strategies.ts_momentum.deadband", 0.10)
cfg.set("strategies.ts_momentum.rebalance_timeframe", "1D")
panel = get_panel(cfg)
i0, i1 = window(cfg, panel, "is")

def relax(c, k):
    """k = facteur d'elargissement du budget de drawdown."""
    c.set("risk.daily_dd_stop",   -0.05*k)
    c.set("risk.weekly_dd_stop",  -0.12*k)
    c.set("risk.monthly_dd_stop", -0.25*k)
    c.set("risk.global_kill_switch", -0.40*k)
    return c

def _wm(eq):
    g=eq.groupby([eq.index.year,eq.index.month])
    return min((s/s.cummax()-1).min() for _,s in g)

rows=[]
for k,label in [(1.0,"mandat"),(2.0,"DD x2")]:
    c = cfg.copy(); relax(c,k)
    tgt,_ = make_targets(c, panel)
    for L in [1,2,3,4,5,6,8,10]:
        r = run_engine(c, panel, tgt, i0, i1, leverage=float(L), label=f"k{k}L{L}")
        m = summarize(r); mr = monthly_returns(r.equity)
        rows.append(dict(budget=label, k=k, levier=L,
            annuel=m["cagr"], mensuel_med=float(mr.median()),
            sharpe=m["sharpe"], dd=m["max_drawdown"],
            dd_mensuel_pire=float(_wm(r.equity)), tue=r.stats["killed"],
            trades=m["n_trades"]))


df=pd.DataFrame(rows)
pd.set_option("display.width",200)
print(df.to_string(index=False,float_format=lambda x:f"{x:8.4f}"))
df.to_csv("/home/user/Terminal/artifacts/exp_dd_relaxed.csv",index=False)

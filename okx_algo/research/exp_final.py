import sys; sys.path.insert(0,'/home/user/Terminal')
import numpy as np, pandas as pd, logging
logging.basicConfig(level=logging.ERROR)
from okx_algo.core.config import load_config
from okx_algo.research.pipeline import get_panel, make_targets, run_engine, window
from okx_algo.backtest.metrics import summarize, monthly_returns

def worst_month(eq):
    g=eq.groupby([eq.index.year,eq.index.month])
    return min((s/s.cummax()-1).min() for _,s in g)

cfg = load_config()
cfg.set("strategies.ts_momentum.rebalance_timeframe","1D")
cfg.set("strategies.ts_momentum.deadband",0.10)
cfg.set("backtest.min_order_fraction",0.15)
panel = get_panel(cfg); i0,i1=window(cfg,panel,"is")
tgt,_ = make_targets(cfg,panel)

rows=[]
for k,lab in [(1.0,"mandat (DD 25%)"),(2.0,"DD x2 (50%)")]:
    c=cfg.copy()
    c.set("risk.daily_dd_stop",-0.05*k); c.set("risk.weekly_dd_stop",-0.12*k)
    c.set("risk.monthly_dd_stop",-0.25*k); c.set("risk.global_kill_switch",-0.40*k)
    for L in [1,1.5,2,2.5,3,4,5]:
        r=run_engine(c,panel,tgt,i0,i1,leverage=float(L),label="f")
        m=summarize(r); mr=monthly_returns(r.equity)
        rows.append(dict(budget=lab,levier=L,annuel=m["cagr"],
            mensuel_med=float(mr.median()),sharpe=m["sharpe"],dd=m["max_drawdown"],
            pire_mois=worst_month(r.equity),tue=r.stats["killed"],trades=m["n_trades"]))
df=pd.DataFrame(rows); pd.set_option("display.width",220)
print(df.to_string(index=False,float_format=lambda x:f"{x:9.4f}"))
df.to_csv("/home/user/Terminal/artifacts/exp_final_dd2x.csv",index=False)

print("\n=== REPONSE A LA DEMANDE ===")
base=0.0206   # rendement du mandat d'origine, levier 1x
for lab in ["mandat (DD 25%)","DD x2 (50%)"]:
    sub=df[(df.budget==lab)&(~df.tue)]
    if len(sub):
        b=sub.loc[sub.annuel.idxmax()]
        print(f"{lab:18s} meilleur : levier {b.levier}x -> {b.annuel*100:6.2f}%/an "
              f"({b.annuel/12*100:5.2f}%/mois), DD {b.dd*100:6.1f}%, pire mois {b.pire_mois*100:6.1f}%, "
              f"x{b.annuel/base:.1f} vs depart")

"""Configuration a levier x10 STRICT, vol cible adaptee pour que ce soit viable.

Le levier est fixe a 10x par contrainte. Le seul degre de liberte restant est
la vol cible : l'exposition effective vaut levier x vol cible. On cherche la vol
cible qui maximise la croissance geometrique sous cette contrainte.
"""
import sys; sys.path.insert(0,'/home/user/Terminal')
import numpy as np, pandas as pd, logging
logging.basicConfig(level=logging.ERROR)
from okx_algo.core.config import load_config
from okx_algo.research.pipeline import get_panel, make_targets, run_engine, window
from okx_algo.backtest.metrics import summarize, monthly_returns

base = load_config()
base.set("strategies.ts_momentum.rebalance_timeframe","1D")
base.set("strategies.ts_momentum.deadband",0.10)
base.set("backtest.min_order_fraction",0.15)
panel = get_panel(base)

rows=[]
for tv in [0.003,0.005,0.0075,0.010,0.015,0.020,0.030]:
    c = base.copy(); c.set("portfolio.target_vol_annualized", tv)
    tgt,_ = make_targets(c, panel, ["ts_momentum"])
    for w in ["is","oos"]:
        a,b = window(c,panel,w)
        r = run_engine(c,panel,tgt,a,b,leverage=10.0,label="x10")   # LEVIER 10x IMPOSE
        m = summarize(r); mr=monthly_returns(r.equity)
        rows.append(dict(vol_cible=tv, expo_effective=tv*10, fenetre=w.upper(),
            sharpe=m["sharpe"], annuel=m["cagr"], mensuel=float(mr.median()),
            dd=m["max_drawdown"], levier_brut_moyen=m["mean_gross_leverage"],
            levier_brut_max=m["max_gross_leverage"], trades=m["n_trades"],
            liq=m["n_liquidations"], tue=m["killed"]))
df=pd.DataFrame(rows); pd.set_option("display.width",240)
print("LEVIER FIXE A 10x — seule la vol cible varie\n")
print(df.to_string(index=False,float_format=lambda x:f"{x:9.4f}"))
df.to_csv("/home/user/Terminal/artifacts/exp_levier_x10.csv",index=False)

oos=df[df.fenetre=="OOS"]
b=oos.loc[oos.annuel.idxmax()]
print(f"\nMeilleur hors echantillon a levier 10x : vol cible {b.vol_cible*100:.2f}% "
      f"-> {b.annuel*100:.2f}%/an ({b.annuel/12*100:.2f}%/mois), DD {b.dd*100:.1f}%, "
      f"levier brut moyen reellement porte {b.levier_brut_moyen:.2f}x")

import sys; sys.path.insert(0,'/home/user/Terminal')
import numpy as np, pandas as pd, logging
logging.basicConfig(level=logging.ERROR)
from okx_algo.core.config import load_config
from okx_algo.research.pipeline import get_panel, make_targets, run_engine, window
from okx_algo.backtest.metrics import summarize

cfg = load_config()
cfg.set("strategies.ts_momentum.rebalance_timeframe","1D")
cfg.set("strategies.ts_momentum.deadband",0.10)
panel = get_panel(cfg); i0,i1 = window(cfg,panel,"is")
tgt,_ = make_targets(cfg, panel)
rows=[]
for mof in [0.002,0.01,0.02,0.05,0.10]:
    c = cfg.copy(); c.set("backtest.min_order_fraction", mof)
    r = run_engine(c, panel, tgt, i0, i1, leverage=1.0, label="d")
    m = summarize(r); g=m.get("gross_pnl") or 0
    rows.append(dict(seuil_min_ordre=mof, sharpe=m["sharpe"], annuel=m["cagr"],
        brut=g, frais=m["fees_total"], net=m["net_pnl"],
        ratio=(m["fees_total"]+abs(m["funding_total"]))/abs(g) if g else np.nan,
        trades=m["n_trades"], dd=m["max_drawdown"]))
df=pd.DataFrame(rows); pd.set_option("display.width",200)
print(df.to_string(index=False,float_format=lambda x:f"{x:10.4f}"))

best=df.loc[df.sharpe.idxmax()]
print(f"\nMeilleur seuil : {best.seuil_min_ordre}  -> sharpe {best.sharpe:.4f}, annuel {best.annuel*100:.2f}%")
print("\n--- Que faudrait-il pour 5%/mois (80%/an) ? ---")
for L in [1,2,3]:
    need = 0.80/L
    print(f"  a levier {L}x : rendement non-leverage requis = {need*100:.1f}%/an  (observe : {best.annuel*100:.2f}%)")
print(f"\n  facteur d'amelioration requis du PnL net : x{0.80/max(best.annuel,1e-9)/1:.0f} a levier 1x,"
      f" x{0.80/3/max(best.annuel,1e-9):.0f} a levier 3x")

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
print("=== TEST DE PLATEAU sur le seuil minimal d'ordre ===")
rows=[]
for mof in [0.05,0.075,0.10,0.125,0.15,0.20,0.30,0.50]:
    c = cfg.copy(); c.set("backtest.min_order_fraction", mof)
    r = run_engine(c, panel, tgt, i0, i1, leverage=1.0, label="p")
    m = summarize(r)
    rows.append(dict(seuil=mof, sharpe=m["sharpe"], annuel=m["cagr"],
                     frais=m["fees_total"], trades=m["n_trades"], dd=m["max_drawdown"]))
df=pd.DataFrame(rows); pd.set_option("display.width",200)
print(df.to_string(index=False,float_format=lambda x:f"{x:10.4f}"))
sh=df.sharpe.to_numpy()
print(f"\nsharpe min/max sur la plage 0.075-0.30 : {sh[1:7].min():.3f} / {sh[1:7].max():.3f}")
print("PLATEAU" if sh[1:7].min() > 0.20 else "PIC ISOLE -> artefact probable")

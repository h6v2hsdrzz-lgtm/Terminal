import sys; sys.path.insert(0,'/home/user/Terminal')
import numpy as np, pandas as pd, logging
logging.basicConfig(level=logging.ERROR)
from okx_algo.core.config import load_config
from okx_algo.research.pipeline import get_panel, make_targets, run_engine, window
from okx_algo.backtest.metrics import summarize, monthly_returns

cfg = load_config()
panel = get_panel(cfg); i0,i1 = window(cfg,panel,"is")
rows=[]
for rb in ["1D","1W"]:
    for db in [0.10,0.20,0.35]:
        for mk_timeout in [2,12]:
            c = cfg.copy()
            c.set("strategies.ts_momentum.rebalance_timeframe", rb)
            c.set("strategies.ts_momentum.deadband", db)
            c.set("strategies.cross_sectional.rebalance_timeframe", rb)
            c.set("costs.maker.timeout_bars", mk_timeout)
            tgt,_ = make_targets(c, panel)
            r = run_engine(c, panel, tgt, i0, i1, leverage=1.0, label="c")
            m = summarize(r)
            gross = m.get("gross_pnl") or 0.0
            rows.append(dict(rb=rb, deadband=db, maker_timeout=mk_timeout,
                sharpe=m["sharpe"], annuel=m["cagr"],
                brut=gross, frais=m["fees_total"], funding=m["funding_total"],
                ratio_couts=(m["fees_total"]+abs(m["funding_total"]))/abs(gross) if gross else np.nan,
                maker_fill=m["maker_fill_rate"], trades=m["n_trades"], dd=m["max_drawdown"]))
df=pd.DataFrame(rows).sort_values("sharpe",ascending=False)
pd.set_option("display.width",220)
print(df.to_string(index=False,float_format=lambda x:f"{x:9.4f}"))
df.to_csv("/home/user/Terminal/artifacts/exp_cost_reduction.csv",index=False)

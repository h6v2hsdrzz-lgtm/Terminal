# Validation du moteur de backtest

Genere le 2026-07-25T21:25:48.725807+00:00
Fenetre de test : 2022-01-01 -> 2023-01-01

**Resultat global : TOUS LES TESTS PASSENT**

| Test | Resultat | Details |
|---|---|---|
| T1_buy_and_hold_fidelity | OK | analytic_return=-0.643419, engine_return=-0.605981, abs_error=0.0374379, tolerance=0.05 |
| T2_costs_degrade | OK | equity_no_costs=39401.9, equity_costs=35228.3, equity_costs_x2=31504.7, fees_charged=3400.07 |
| T3_funding_sign | OK | mean_funding_rate=1.19144e-06, long_funding_paid=2714.83, short_funding_paid=-5443.35 |
| T4_random_control_loses | OK | n_runs=30, mean_return=-0.385616, median_return=-0.389164, pct_profitable=0, mean_sharpe=-1.61545 |
| T5_leverage_cap | OK | cap=10, max_observed_leverage=0, n_orders_refused=35040 |
| T6_drawdown_halts | OK | n_daily_halts=35 |
| T7_no_lookahead_features | OK | checks={'log_return_168': True, 'ewma_vol': True, 'zscore_720': True, 'rolling_median_720': True} |
"""Familles de signaux (§4) et routage par régime (§5), testés isolément."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crypto_algo.config import load_config
from crypto_algo.data.loader import synthetic_market_data
from crypto_algo.features.pipeline import FeatureStore
from crypto_algo.regime.classifier import CHAOS, RANGE, REGIMES, TREND_DOWN, TREND_UP, RegimeClassifier
from crypto_algo.regime.router import RoutingViolation, SignalRouter
from crypto_algo.signals import FAMILY_REGISTRY, build_families
from crypto_algo.signals.base import SignalContext
from crypto_algo.tests.test_no_lookahead import _corrupt_future

SYMBOLS = ["BTC/USDT:USDT", "ETH/USDT:USDT"]
TFS = ["15m", "1h", "4h"]


def build_context(seed=5, n_bars=3000, regime="random_walk", cfg=None):
    cfg = cfg or load_config(
        overrides={"universe.symbols": SYMBOLS, "data.signal_timeframes": TFS,
                   "data.execution_timeframe": "15m"}
    )
    md = synthetic_market_data(
        symbols=SYMBOLS, timeframes=TFS, n_bars=n_bars, exec_timeframe="15m",
        seed=seed, regime=regime,
    )
    features = FeatureStore(cfg).build(md)
    ctx = SignalContext(
        cfg=cfg, symbol=SYMBOLS[0], features=features,
        funding=md.funding, index_price=md.index, benchmark=SYMBOLS[0],
    )
    return cfg, md, features, ctx


@pytest.fixture(scope="module")
def context():
    return build_context()


# ------------------------------------------------------- contrat des familles
@pytest.mark.parametrize("family_name", sorted(FAMILY_REGISTRY))
def test_family_score_is_bounded_and_finite(family_name, context):
    cfg, md, features, ctx = context
    # la corrélation et le statarb ont besoin d'un actif secondaire
    ctx_local = SignalContext(
        cfg=cfg, symbol=SYMBOLS[1], features=features, funding=md.funding,
        index_price=md.index, benchmark=SYMBOLS[0],
    )
    family = FAMILY_REGISTRY[family_name](cfg)
    score = family.score(ctx_local)
    assert len(score) == len(features[SYMBOLS[1]])
    assert np.isfinite(score.to_numpy()).all()
    assert score.abs().max() <= 1.0 + 1e-9


@pytest.mark.parametrize("family_name", sorted(FAMILY_REGISTRY))
def test_family_score_is_causal(family_name, context):
    """Bruit injecté dans le futur : les scores passés ne bougent pas."""
    cfg, md, features, _ = context
    cut_ratio = 0.6
    corrupted_md = synthetic_market_data(
        symbols=SYMBOLS, timeframes=TFS, n_bars=3000, exec_timeframe="15m", seed=5
    )
    for key in list(corrupted_md.ohlcv):
        corrupted_md.ohlcv[key] = _corrupt_future(corrupted_md.ohlcv[key], cut_ratio=cut_ratio)
    corrupted_features = FeatureStore(cfg).build(corrupted_md)

    family = FAMILY_REGISTRY[family_name](cfg)
    ctx_clean = SignalContext(cfg=cfg, symbol=SYMBOLS[1], features=features,
                              funding=md.funding, index_price=md.index, benchmark=SYMBOLS[0])
    ctx_dirty = SignalContext(cfg=cfg, symbol=SYMBOLS[1], features=corrupted_features,
                              funding=corrupted_md.funding, index_price=corrupted_md.index,
                              benchmark=SYMBOLS[0])
    clean = family.score(ctx_clean)
    dirty = family.score(ctx_dirty)
    cut = int(len(clean) * cut_ratio)
    assert np.allclose(clean.iloc[:cut].to_numpy(), dirty.iloc[:cut].to_numpy(), atol=1e-9), (
        f"{family_name} : fuite d'information depuis le futur"
    )


def test_trend_family_is_positive_in_an_uptrend():
    cfg, md, features, ctx = build_context(seed=3, n_bars=12000, regime="trend")
    family = build_families(cfg, ["trend"])["trend"]
    score = family.score(ctx).iloc[4000:]
    price = features[SYMBOLS[0]]["close"]
    assert price.iloc[-1] > price.iloc[4000]
    assert score.mean() > 0.1, "la famille tendance ne voit pas une tendance haussière"


def test_range_family_fades_extremes():
    """En range, le signal doit être négatif en haut de bande et positif en bas."""
    cfg, md, features, ctx = build_context(seed=9, n_bars=3000, regime="range")
    family = build_families(cfg, ["range"])["range"]
    score = family.score(ctx)
    df = features[SYMBOLS[0]]
    mid, upper = df["bb_mid_1h"], df["bb_upper_1h"]
    z = (df["close"] - mid) / (upper - mid)
    mask = z.notna() & score.notna()
    corr = np.corrcoef(z[mask], score[mask])[0, 1]
    assert corr < -0.2, f"le signal de range ne fade pas les extrêmes (corr={corr:.2f})"


def test_correlation_family_ignores_persistent_decorrelation():
    """Une décorrélation qui dure est un changement de régime, pas un signal."""
    cfg, md, features, _ = build_context(seed=4, n_bars=3000)
    # on fait diverger ETH de BTC de façon monotone et durable
    eth = features[SYMBOLS[1]]
    drift = np.linspace(0, 0.8, len(eth))
    eth = eth.copy()
    eth["close"] = eth["close"] * np.exp(drift)
    features = {SYMBOLS[0]: features[SYMBOLS[0]], SYMBOLS[1]: eth}
    ctx = SignalContext(cfg=cfg, symbol=SYMBOLS[1], features=features, funding=md.funding,
                        index_price=md.index, benchmark=SYMBOLS[0])
    family = build_families(cfg, ["correlation"])["correlation"]
    score = family.score(ctx)
    tail = score.iloc[-500:]
    assert tail.abs().mean() < 0.15, "la décorrélation persistante est traitée comme un signal"


# ------------------------------------------------------------------- régime
def test_classifier_returns_only_known_regimes(context):
    cfg, md, features, ctx = context
    diagnostics = RegimeClassifier(cfg).classify(ctx)
    assert set(diagnostics.stable.unique()).issubset(set(REGIMES))


def test_classifier_detects_trend_and_range():
    # 12 000 barres 15m = 125 jours : indispensable pour que l'EMA 200 en 4h
    # (800 heures d'historique) soit définie — cf. effective_warmup().
    cfg_t, _, _, ctx_trend = build_context(seed=3, n_bars=12000, regime="trend")
    cfg_r, _, _, ctx_range = build_context(seed=9, n_bars=12000, regime="range")
    trend_regimes = RegimeClassifier(cfg_t).classify(ctx_trend).stable
    range_regimes = RegimeClassifier(cfg_r).classify(ctx_range).stable
    assert (trend_regimes == TREND_UP).mean() > (range_regimes == TREND_UP).mean()
    assert (range_regimes == RANGE).mean() > 0.5


def test_chaos_regime_forbids_any_position(context):
    cfg, md, features, ctx = context
    idx = features[SYMBOLS[0]].index
    regimes = pd.Series(CHAOS, index=idx)
    scores = {"trend": pd.Series(1.0, index=idx), "range": pd.Series(-1.0, index=idx)}
    routed = SignalRouter(cfg).route(regimes, scores)
    assert (routed.score == 0).all()


def test_mean_reversion_is_forbidden_in_trend(context):
    """Contrainte centrale du §5 : pas de mean reversion en tendance."""
    cfg, md, features, ctx = context
    idx = features[SYMBOLS[0]].index
    regimes = pd.Series(TREND_UP, index=idx)
    scores = {
        "trend": pd.Series(0.0, index=idx),
        "range": pd.Series(-1.0, index=idx),      # famille interdite en tendance
        "reversal": pd.Series(-1.0, index=idx),   # idem
    }
    router = SignalRouter(cfg)
    routed = router.route(regimes, scores)
    assert (routed.contributions["range"] == 0).all()
    assert (routed.contributions["reversal"] == 0).all()
    assert (routed.score == 0).all()
    router.assert_no_forbidden_contribution(routed, regimes)


def test_trend_following_is_forbidden_in_range(context):
    cfg, md, features, ctx = context
    idx = features[SYMBOLS[0]].index
    regimes = pd.Series(RANGE, index=idx)
    scores = {"trend": pd.Series(1.0, index=idx), "range": pd.Series(0.0, index=idx)}
    routed = SignalRouter(cfg).route(regimes, scores)
    assert (routed.contributions["trend"] == 0).all()


def test_direction_constraint_is_enforced(context):
    cfg, md, features, ctx = context
    idx = features[SYMBOLS[0]].index
    up = SignalRouter(cfg).route(pd.Series(TREND_UP, index=idx), {"trend": pd.Series(-1.0, index=idx)})
    down = SignalRouter(cfg).route(pd.Series(TREND_DOWN, index=idx), {"trend": pd.Series(1.0, index=idx)})
    assert (up.score >= 0).all(), "short autorisé en trend_up"
    assert (down.score <= 0).all(), "long autorisé en trend_down"


def test_routing_violation_is_detected(context):
    """Le contrôle a posteriori doit attraper une contribution illégale."""
    cfg, md, features, ctx = context
    idx = features[SYMBOLS[0]].index
    regimes = pd.Series(TREND_UP, index=idx)
    router = SignalRouter(cfg)
    routed = router.route(regimes, {"trend": pd.Series(0.5, index=idx), "range": pd.Series(0.0, index=idx)})
    routed.contributions["range"] = -0.5      # injection manuelle d'une infraction
    with pytest.raises(RoutingViolation):
        router.assert_no_forbidden_contribution(routed, regimes)


def test_regime_persistence_smooths_flapping(context):
    """Un régime ne bascule pas sur une seule barre isolée."""
    cfg, md, features, ctx = context
    classifier = RegimeClassifier(cfg)
    noisy = pd.Series([RANGE] * 20 + [TREND_UP] + [RANGE] * 20, index=range(41))
    smoothed = classifier._apply_persistence(noisy)
    assert (smoothed == RANGE).all(), "une barre isolée a suffi à basculer le régime"


def test_composite_strategy_respects_routing_end_to_end():
    from crypto_algo.strategies.composite import RoutedMultiFamilyStrategy

    cfg = load_config(
        overrides={
            "universe.symbols": SYMBOLS,
            "data.signal_timeframes": TFS,
            "data.execution_timeframe": "15m",
            "backtest.warmup_bars": 300,
        }
    )
    md = synthetic_market_data(symbols=SYMBOLS, timeframes=TFS, n_bars=4000,
                               exec_timeframe="15m", seed=12)
    strat = RoutedMultiFamilyStrategy(cfg)
    strat.prepare(md, cfg)
    for symbol in SYMBOLS:
        dec = strat.decisions(symbol)
        chaos_rows = dec[dec["regime"] == CHAOS]
        assert (chaos_rows["signal"] == 0).all(), "position en régime chaotique"
        up_rows = dec[dec["regime"] == TREND_UP]
        assert (up_rows["signal"] >= 0).all()
        down_rows = dec[dec["regime"] == TREND_DOWN]
        assert (down_rows["signal"] <= 0).all()
        # tout signal non nul est accompagné d'un stop
        active = dec[dec["signal"] != 0]
        assert active["stop_price"].notna().all(), "signal sans stop"


def test_inverted_strategy_produces_opposite_signals():
    """Le contrôle d'inversion doit réellement inverser.

    Régression : le cache partagé entre points de grille était indexé sur la
    seule fenêtre temporelle, si bien que la variante inversée relisait le cœur
    non inversé et rendait des résultats identiques — un diagnostic qui ne
    diagnostique rien.
    """
    from crypto_algo.strategies.composite import RoutedMultiFamilyStrategy

    cfg = load_config(
        overrides={"universe.symbols": SYMBOLS, "data.signal_timeframes": TFS,
                   "data.execution_timeframe": "15m", "backtest.warmup_bars": 200,
                   "backtest.auto_warmup": False}
    )
    md = synthetic_market_data(symbols=SYMBOLS, timeframes=TFS, n_bars=4000,
                               exec_timeframe="15m", seed=77)
    normal = RoutedMultiFamilyStrategy(cfg)
    normal.prepare(md, cfg)
    inverted = RoutedMultiFamilyStrategy(cfg, invert_signals=True)
    inverted.prepare(md, cfg)

    n_diff = 0
    for symbol in SYMBOLS:
        a = normal.decisions(symbol)["signal"]
        b = inverted.decisions(symbol)["signal"]
        n_diff += int((a != b).sum())
        # en régime range (les deux sens autorisés), un signal inversé doit
        # être l'opposé ; ailleurs le routage peut l'annuler, jamais le conserver
        both_active = (a != 0) & (b != 0)
        assert (a[both_active] == -b[both_active]).all()
    assert n_diff > 0, "l'inversion n'a produit aucune différence"


def test_shared_cache_is_invalidated_by_a_different_core_configuration():
    """Deux configurations aux features différentes ne partagent pas un cache."""
    from crypto_algo.validation.runner import ValidationRunner

    base = load_config(
        overrides={"universe.symbols": [SYMBOLS[0]], "data.signal_timeframes": ["15m", "1h"],
                   "data.execution_timeframe": "15m", "backtest.warmup_bars": 200,
                   "backtest.auto_warmup": False, "execution.rejects.enabled": False}
    )
    other = base.with_overrides({"features.ema_periods": [10, 30, 100]})
    md = synthetic_market_data(symbols=[SYMBOLS[0]], timeframes=["15m", "1h"],
                               n_bars=2500, exec_timeframe="15m", seed=91)
    shared: dict = {}
    r1 = ValidationRunner(base, md, shared_cache=shared)
    r1.run_once({}, None, None, label="a", record=False)
    fingerprint_a = next(iter(shared.values()))["_fingerprint"]

    r2 = ValidationRunner(other, md, shared_cache=shared)
    r2.run_once({}, None, None, label="b", record=False)
    fingerprint_b = next(iter(shared.values()))["_fingerprint"]
    assert fingerprint_a != fingerprint_b


# ------------------------------------------------- hypothèse « cassure 4h »
def test_donchian_breakout_is_causal():
    """Bruit injecté dans le futur : les décisions passées ne bougent pas."""
    from crypto_algo.strategies.breakout import DonchianBreakoutStrategy

    cfg = load_config(overrides={"universe.symbols": [SYMBOLS[0]],
                                 "data.signal_timeframes": TFS,
                                 "data.execution_timeframe": "15m"})
    md = synthetic_market_data(symbols=[SYMBOLS[0]], timeframes=TFS, n_bars=6000,
                               exec_timeframe="15m", seed=5)
    clean = DonchianBreakoutStrategy(cfg)
    clean.prepare(md, cfg)
    a = clean.decisions(SYMBOLS[0])["signal"]

    dirty_md = synthetic_market_data(symbols=[SYMBOLS[0]], timeframes=TFS, n_bars=6000,
                                     exec_timeframe="15m", seed=5)
    for key in list(dirty_md.ohlcv):
        dirty_md.ohlcv[key] = _corrupt_future(dirty_md.ohlcv[key], cut_ratio=0.6)
    dirty = DonchianBreakoutStrategy(cfg)
    dirty.prepare(dirty_md, cfg)
    b = dirty.decisions(SYMBOLS[0])["signal"]

    cut = int(len(a) * 0.6)
    assert np.allclose(a.iloc[:cut].to_numpy(), b.iloc[:cut].to_numpy())


def test_donchian_channel_excludes_the_current_bar():
    """Le canal ne doit pas contenir la bougie qui déclenche la cassure —
    sinon le prix ne peut jamais franchir son propre plus haut."""
    from crypto_algo.strategies.breakout import DonchianBreakoutStrategy

    cfg = load_config(overrides={"universe.symbols": [SYMBOLS[0]],
                                 "data.signal_timeframes": TFS,
                                 "data.execution_timeframe": "15m"})
    md = synthetic_market_data(symbols=[SYMBOLS[0]], timeframes=TFS, n_bars=6000,
                               exec_timeframe="15m", seed=9, regime="trend")
    strat = DonchianBreakoutStrategy(cfg, entry_period=20, exit_period=10)
    strat.prepare(md, cfg)
    signal = strat.decisions(SYMBOLS[0])["signal"]
    assert (signal != 0).any(), "aucune cassure détectée sur une série en tendance"


def test_breakout_signal_always_carries_a_stop():
    from crypto_algo.strategies.breakout import DonchianBreakoutStrategy

    cfg = load_config(overrides={"universe.symbols": [SYMBOLS[0]],
                                 "data.signal_timeframes": TFS,
                                 "data.execution_timeframe": "15m"})
    md = synthetic_market_data(symbols=[SYMBOLS[0]], timeframes=TFS, n_bars=6000,
                               exec_timeframe="15m", seed=12)
    strat = DonchianBreakoutStrategy(cfg)
    strat.prepare(md, cfg)
    dec = strat.decisions(SYMBOLS[0])
    active = dec[dec["signal"] != 0]
    assert len(active) > 0
    assert active["stop_price"].notna().all()
    long_rows = active[active["signal"] > 0]
    assert (long_rows["stop_price"] < long_rows.index.map(
        lambda ts: md.get(SYMBOLS[0], "15m").loc[ts, "close"])).all()

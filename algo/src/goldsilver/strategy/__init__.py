from __future__ import annotations

from goldsilver.strategy.base import STRATEGIES, Strategy, get_strategy
from goldsilver.strategy.daily_breakout import DailyBreakoutStrategy
from goldsilver.strategy.ratio_reversion import RatioReversionStrategy
from goldsilver.strategy.trend_pullback import TrendPullbackStrategy

__all__ = [
    "STRATEGIES",
    "Strategy",
    "get_strategy",
    "TrendPullbackStrategy",
    "RatioReversionStrategy",
    "DailyBreakoutStrategy",
]

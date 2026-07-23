"""Moteur d'exécution : un cycle par clôture de bougie 4h.

Ordre STRICT des opérations d'un cycle — chaque étape peut interrompre :

1. Fichier KILL ?                    -> flatten + halte persistée.
2. Halte déjà en place ?             -> ne rien faire (reset manuel requis).
3. Données broker (H1) ;             -> échec = AUCUNE action de trading ce
   cycle (les SL/TP restent posés côté broker, la position est protégée).
4. Paper : simulation des SL/TP sur les bougies écoulées.
   Demo/live : RÉCONCILIATION — l'état réel du compte broker fait foi,
   jamais l'inverse. Trades clôturés -> compteur de pertes, journal, notif.
5. Kill switches (perte jour, drawdown, pertes consécutives)
                                     -> flatten + halte persistée.
6. Signal : MÊME code que le backtest (clean_ohlcv + build_timeframes +
   Strategy.generate_all). Seule la dernière bougie 1h TERMINÉE et non
   encore traitée peut déclencher une entrée (anti-double-entrée persistant).
7. Filtre de régime -> pause des nouvelles entrées, notif aux transitions.
8. Sizing (risk % <= plafond dur re-vérifié à l'ordre), R:R >= min_rr,
   ordre au marché avec SL/TP posés chez le broker, slippage journalisé.
9. Persistance de l'état + résumé de cycle au journal.

Écart assumé vs backtest : le backtest entre à l'ouverture de la bougie 1h
suivant le signal ; le bot, cadencé en 4h, peut entrer jusqu'à
``max_signal_age_bars`` heures après. Cet écart d'exécution est précisément
ce que le tracking de slippage MESURE (forward test). Pour une parité
maximale, mettre ``poll.granularity_hours: 1``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from goldsilver.config import Config, load_config
from goldsilver.data.cleaning import clean_ohlcv
from goldsilver.data.timeframes import build_timeframes
from goldsilver.engine.sizing import position_size
from goldsilver.live.broker.base import BrokerAdapter, BrokerError
from goldsilver.live.broker.paper import PaperBroker
from goldsilver.live.config import LiveConfig
from goldsilver.live.journal import Journal, record_slippage
from goldsilver.live.killswitch import (
    check_kill_switches,
    register_closed_trade,
    update_daily_anchor,
)
from goldsilver.live.modes import TradingMode
from goldsilver.live.notify import TelegramNotifier
from goldsilver.live.regime import assess_regime
from goldsilver.live.risk import (
    HARD_MAX_RISK_PCT,
    assert_order_within_cap,
    validate_configured_risk,
)
from goldsilver.live.state import StateStore
from goldsilver.strategy.base import get_strategy

log = logging.getLogger(__name__)


@dataclass
class CycleReport:
    actions: list[str] = field(default_factory=list)
    halted: bool = False
    equity: float | None = None

    def note(self, msg: str) -> None:
        self.actions.append(msg)
        log.info("cycle: %s", msg)


class LiveEngine:
    def __init__(
        self,
        live_cfg: LiveConfig,
        broker: BrokerAdapter,
        state_store: StateStore,
        journal: Journal,
        notifier: TelegramNotifier,
    ) -> None:
        validate_configured_risk(live_cfg.risk.risk_pct, live_cfg.risk.max_open_risk_pct)
        self.cfg = live_cfg
        self.strategy_cfg: Config = load_config(live_cfg.resolve(live_cfg.strategy_config))
        self.strategy = get_strategy(self.strategy_cfg.strategy.name,
                                     self.strategy_cfg.strategy.params)
        self.broker = broker
        self.store = state_store
        self.journal = journal
        self.notify = notifier
        self.assets = list(live_cfg.broker.instruments)
        unknown = set(self.assets) - set(self.strategy_cfg.data.assets)
        if unknown:
            raise ValueError(f"Instruments sans AssetSpec dans la stratégie : {unknown}")

    # ------------------------------------------------------------------ cycle

    def run_cycle(self, now: pd.Timestamp | None = None) -> CycleReport:
        now = now or pd.Timestamp.now(tz="UTC")
        report = CycleReport()
        state = self.store.load()
        if self.cfg.mode is TradingMode.PAPER:
            from goldsilver.live.broker.paper import default_paper_state

            if state.get("paper") is None:
                state["paper"] = default_paper_state(self.cfg.paper_initial_equity)
            assert isinstance(self.broker, PaperBroker)
            self.broker.bind_state(state["paper"])

        # 1. kill manuel — prioritaire sur tout, y compris une halte existante
        kill_path = self.cfg.resolve(self.cfg.kill.kill_file)
        if kill_path.exists():
            self._halt(state, report, f"fichier {self.cfg.kill.kill_file} présent")
            return report

        # 2. halte persistée
        if state.get("halted"):
            report.halted = True
            report.note(f"HALTE en place ({state.get('halt_reason')}) — aucun trading. "
                        "Lever avec: goldsilver-live reset-halt")
            return report

        # 3. données — échec => on ne trade PAS ce cycle
        try:
            candles = {
                a: self.broker.get_candles(self.cfg.broker.instruments[a],
                                           self.cfg.poll.history_hours)
                for a in self.assets
            }
        except BrokerError as exc:
            self.journal.write("error", stage="data", error=str(exc))
            self.notify.send(f"⚠️ Données broker indisponibles, cycle sans action : {exc}")
            report.note(f"échec données : {exc} — aucun trading ce cycle")
            return report

        # 4. fills simulés (paper) ou réconciliation (demo/live)
        try:
            self._settle_and_reconcile(state, candles, report)
            account = self.broker.get_account()
        except BrokerError as exc:
            self.journal.write("error", stage="reconcile", error=str(exc))
            self.notify.send(f"⚠️ Réconciliation impossible, cycle sans action : {exc}")
            report.note(f"échec réconciliation : {exc} — aucun trading ce cycle")
            self.store.save(state)
            return report

        equity = account.equity
        report.equity = equity
        update_daily_anchor(state, now.to_pydatetime(), equity)

        # 5. kill switches automatiques
        decision = check_kill_switches(state, equity, self.cfg.kill, self.cfg.root)
        if decision.tripped:
            self._halt(state, report, decision.reason)
            return report

        # 6-8. signaux, régime, entrées
        try:
            self._maybe_enter(state, candles, equity, now, report)
        except BrokerError as exc:
            self.journal.write("error", stage="orders", error=str(exc))
            self.notify.send(f"⚠️ Erreur broker pendant les ordres : {exc}")
            report.note(f"erreur ordres : {exc}")

        # 9. persistance + résumé
        self.store.save(state)
        self.journal.write("cycle", equity=round(equity, 2),
                           actions=report.actions, mode=self.cfg.mode.value)
        return report

    # ------------------------------------------------------------- sous-étapes

    def _settle_and_reconcile(self, state: dict[str, Any],
                              candles: dict[str, pd.DataFrame],
                              report: CycleReport) -> None:
        if self.cfg.mode is TradingMode.PAPER:
            paper = self.broker
            assert isinstance(paper, PaperBroker)
            for a in self.assets:
                for closed in paper.simulate_fills(self.cfg.broker.instruments[a],
                                                   candles[a]):
                    register_closed_trade(state, closed.realized_pnl)
                    self.journal.write("trade_closed", instrument=closed.instrument,
                                       trade_id=closed.trade_id,
                                       pnl=round(closed.realized_pnl, 2),
                                       price=closed.close_price)
                    self.notify.send(
                        f"📕 PAPER {closed.instrument} fermé @ {closed.close_price} "
                        f"PnL {closed.realized_pnl:+.2f} $"
                    )
                    report.note(f"{a} fermé pnl {closed.realized_pnl:+.2f}")
            return

        # demo / live : le broker fait foi
        open_pos = {p.instrument: p for p in self.broker.get_open_positions()}
        known: dict[str, str] = dict(state.get("known_trades", {}))
        for a in self.assets:
            instr = self.cfg.broker.instruments[a]
            if a in known and instr not in open_pos:
                # la position connue a été clôturée (SL/TP broker, hors-ligne…)
                # l'adaptateur renvoie les clôtures POSTÉRIEURES au marqueur,
                # triées ; le marqueur est opaque (id numérique, horodatage…)
                closed = self.broker.get_closed_trades_since(
                    state.get("last_closed_trade_id")
                )
                for c in closed:
                    register_closed_trade(state, c.realized_pnl)
                    state["last_closed_trade_id"] = c.trade_id
                    self.journal.write("trade_closed", instrument=c.instrument,
                                       trade_id=c.trade_id,
                                       pnl=round(c.realized_pnl, 2),
                                       price=c.close_price)
                    self.notify.send(f"📕 {c.instrument} fermé, "
                                     f"PnL {c.realized_pnl:+.2f}")
                    report.note(f"{c.instrument} clôturé pnl {c.realized_pnl:+.2f}")
                known.pop(a, None)
            elif instr in open_pos and a not in known:
                known[a] = open_pos[instr].trade_id
                self.journal.write("reconcile_adopted", instrument=instr,
                                   trade_id=open_pos[instr].trade_id,
                                   units=open_pos[instr].units)
                report.note(f"position inconnue adoptée sur {instr}")
        state["known_trades"] = known

    def _maybe_enter(self, state: dict[str, Any], candles: dict[str, pd.DataFrame],
                     equity: float, now: pd.Timestamp, report: CycleReport) -> None:
        cleaned = {a: clean_ohlcv(candles[a])[0] for a in self.assets}
        tfs_by_asset = {
            a: build_timeframes(
                cleaned[a],
                self.strategy_cfg.data.base_timeframe,
                self.strategy_cfg.data.timeframes,
                self.strategy_cfg.data.session_day_offset_hours,
            )
            for a in self.assets
        }
        signals = self.strategy.generate_all(tfs_by_asset)
        open_instruments = {p.instrument for p in self.broker.get_open_positions()}
        open_positions = list(self.broker.get_open_positions())

        for a in self.assets:
            instr = self.cfg.broker.instruments[a]
            frame = signals[a]
            last_done = state["last_signal_bar"].get(a)
            fresh_cut = now - pd.Timedelta(hours=self.cfg.poll.max_signal_age_bars)
            new_bars = frame[frame.index > pd.Timestamp(last_done)] if last_done else frame
            state["last_signal_bar"][a] = frame.index[-1].isoformat()

            candidates = new_bars[(new_bars["signal"] != 0)
                                  & (new_bars.index >= fresh_cut)]
            if candidates.empty:
                continue
            bar = candidates.iloc[-1]
            bar_ts = candidates.index[-1]
            side = int(bar["signal"])
            sl_dist = float(bar["sl_dist"])
            tp_dist = float(bar["tp_dist"])
            self.journal.write("decision", instrument=instr, asset=a,
                               signal=side, bar=str(bar_ts),
                               sl_dist=sl_dist, tp_dist=tp_dist)

            if instr in open_instruments:
                report.note(f"{a} signal ignoré : position déjà ouverte")
                continue

            # filtre de régime (issu du detrending)
            status = assess_regime(a, tfs_by_asset[a]["4h"], self.cfg.regime)
            paused_before = state.setdefault("regime_paused", {}).get(a, False)
            state["regime_paused"][a] = not status.trading_allowed
            if paused_before != (not status.trading_allowed):
                emoji = "⏸️" if not status.trading_allowed else "▶️"
                self.notify.send(f"{emoji} Régime {a} : "
                                 f"{'PAUSE' if not status.trading_allowed else 'actif'} "
                                 f"— {status.detail}")
            self.journal.write("regime", asset=a, allowed=status.trading_allowed,
                               detail=status.detail)
            if not status.trading_allowed:
                report.note(f"{a} signal bloqué par le régime ({status.detail})")
                continue

            if tp_dist < self.cfg.risk.min_rr * sl_dist - 1e-9:
                self.journal.write("reject", instrument=instr,
                                   reason=f"R:R {tp_dist / sl_dist:.2f} < "
                                          f"{self.cfg.risk.min_rr}")
                report.note(f"{a} rejeté : R:R insuffisant")
                continue

            quote = self.broker.get_quote(instr)
            if not quote.tradeable:
                self.journal.write("reject", instrument=instr, reason="marché fermé")
                report.note(f"{a} rejeté : marché fermé")
                continue

            spec = self.strategy_cfg.data.assets[a]
            open_risk = sum(
                abs(p.units) * abs(p.avg_price - p.sl) if p.sl else 0.0
                for p in open_positions
            )
            open_notional = sum(abs(p.units) * p.avg_price for p in open_positions)
            risk_pct = min(self.cfg.risk.risk_pct, HARD_MAX_RISK_PCT)
            ref_price = quote.ask if side > 0 else quote.bid
            decision = position_size(
                equity=equity,
                risk_pct=risk_pct,
                sl_dist=sl_dist,
                price=ref_price,
                spec=spec,
                risk_budget_left=equity * self.cfg.risk.max_open_risk_pct - open_risk,
                max_leverage=self.strategy_cfg.engine.max_leverage,
                open_notional=open_notional,
            )
            if decision.units <= 0:
                self.journal.write("reject", instrument=instr, reason=decision.reason)
                report.note(f"{a} rejeté : {decision.reason}")
                continue
            assert_order_within_cap(decision.risk_amount, equity)

            sl_price = ref_price - side * sl_dist
            tp_price = ref_price + side * tp_dist
            result = self.broker.place_market_order(
                instr, side * decision.units, sl_price, tp_price,
                client_tag=f"gs-{a}-{bar_ts.strftime('%Y%m%d%H')}",
            )
            self.journal.write(
                "order", instrument=instr, units=side * decision.units,
                sl=sl_price, tp=tp_price, risk_amount=decision.risk_amount,
                accepted=result.accepted, reason=result.reason,
                trade_id=result.trade_id, fill=result.fill_price,
            )
            if not result.accepted:
                report.note(f"{a} ordre rejeté par le broker : {result.reason}")
                continue
            if result.trade_id:
                state.setdefault("known_trades", {})[a] = result.trade_id
            # slippage vs hypothèse backtest : le backtest remplit à
            # l'ouverture de la bougie suivant le signal, côté ask.
            signal_close = float(bar["close"])
            spread_col = float(bar.get("spread", 0.0) or 0.0)
            expected = signal_close + spread_col if side > 0 else signal_close
            drift = record_slippage(
                state, self.journal, instrument=instr,
                expected_price=expected, fill_price=result.fill_price or ref_price,
                units=side * decision.units, risk_amount=decision.risk_amount,
                alert_threshold_r=self.cfg.slippage_alert_r,
            )
            if drift is not None:
                self.notify.send(
                    f"⚠️ Slippage moyen {drift:.1%} de R > seuil "
                    f"{self.cfg.slippage_alert_r:.0%} — hypothèses backtest dépassées"
                )
            self.notify.send(
                f"📗 {self.cfg.mode.value.upper()} {instr} "
                f"{'ACHAT' if side > 0 else 'VENTE'} {decision.units:g} u "
                f"@ {result.fill_price} (SL {sl_price:.2f} / TP {tp_price:.2f}, "
                f"risque {decision.risk_amount:.0f} $)"
            )
            report.note(f"{a} entré : {side * decision.units:+g} u, "
                        f"risque {decision.risk_amount:.0f} $")

    # ---------------------------------------------------------------- helpers

    def _halt(self, state: dict[str, Any], report: CycleReport, reason: str) -> None:
        report.halted = True
        flat_results = []
        for a in self.assets:
            instr = self.cfg.broker.instruments[a]
            try:
                res = self.broker.close_position(instr)
                flat_results.append(f"{instr}: {res.reason}")
                if res.accepted and res.units:
                    self.journal.write("flatten", instrument=instr,
                                       price=res.fill_price, units=res.units)
            except BrokerError as exc:
                flat_results.append(f"{instr}: ÉCHEC {exc}")
                self.journal.write("error", stage="flatten", instrument=instr,
                                   error=str(exc))
        state["halted"] = True
        state["halt_reason"] = reason
        state["known_trades"] = {}
        self.store.save(state)
        self.journal.write("killswitch", reason=reason, flatten=flat_results)
        self.notify.send(f"🛑 KILL SWITCH : {reason}. Positions fermées : "
                         f"{'; '.join(flat_results) or 'aucune'}. Trading arrêté "
                         "(reset manuel requis).")
        report.note(f"HALTE : {reason}")

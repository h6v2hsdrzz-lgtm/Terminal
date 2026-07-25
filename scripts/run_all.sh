#!/usr/bin/env bash
# Pipeline complet, dans l'ordre du plan de construction.
#
#   bash scripts/run_all.sh                 # données + qualité + in-sample + validation
#   bash scripts/run_all.sh --with-oos "motif d'ouverture"
#
# L'out-of-sample n'est ouvert que si le motif est fourni explicitement : c'est
# la traduction opérationnelle de « on ne le regarde qu'une fois, à la fin ».
set -euo pipefail

cd "$(dirname "$0")/.."
SYMBOLS=("BTC/USDT:USDT" "ETH/USDT:USDT" "SOL/USDT:USDT")
OOS_REASON=""
if [[ "${1:-}" == "--with-oos" ]]; then
  OOS_REASON="${2:?un motif explicite est requis pour ouvrir l out-of-sample}"
fi

echo "=== 0. tests (aucune recherche sans moteur validé) ==="
python3 -m pytest crypto_algo/tests -q

echo "=== 1. données ==="
for symbol in "${SYMBOLS[@]}"; do
  python3 scripts/fetch_history.py --symbol "$symbol"
done

echo "=== 2. contrôle qualité + reconstruction du funding ==="
python3 scripts/run_research.py --phase quality

echo "=== 3. in-sample + protocole de validation ==="
python3 scripts/run_research.py --phase research

echo "=== 4. diagnostics ==="
python3 scripts/run_inversion_check.py
python3 scripts/run_intrabar_study.py || echo "(1m absent : étude intrabar ignorée)"

if [[ -n "$OOS_REASON" ]]; then
  echo "=== 5. ouverture de l'out-of-sample (une seule fois) ==="
  python3 scripts/run_research.py --phase oos --reuse-research --unlock-oos "$OOS_REASON"
else
  echo '=== 5. out-of-sample non ouvert (relancer avec --with-oos "motif") ==='
fi

echo
echo "Rapport : reports_out/rapport_audit.html"
echo "Phase 7 : python3 scripts/paper_trade.py  (60 jours minimum avant tout capital réel)"

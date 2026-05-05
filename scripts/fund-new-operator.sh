#!/bin/bash
#
# Fund the new staking provider and operator before running run-new-operator-setup.sh.
#
# Step 1: Transfer 80,000 T from deployer to staking provider
# Step 2: Sepolia ETH - use a faucet (see below)
#
# Usage:
#   source .env
#   source .env.new-operator
#   bash scripts/fund-new-operator.sh
#
# Or with an explicit env file (paths relative to repo root or absolute):
#   bash scripts/fund-new-operator.sh /path/to/.env.new-operator
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
T_JSON="$REPO_ROOT/tbtc-v2/solidity/deployments/sepolia/T.json"
if [ ! -f "$T_JSON" ]; then
  echo "ERROR: T.json not found at $T_JSON" >&2
  echo "       Ensure tbtc-v2 is checked out at $REPO_ROOT/tbtc-v2 and Sepolia deployments exist." >&2
  exit 1
fi
T_TOKEN="$(jq -re '.address' "$T_JSON")"
AMOUNT_80K="$(cast to-wei 80000)"

cd "$SCRIPT_DIR/.."
if [ -f .env ]; then source .env; fi
if [ -n "${1:-}" ] && [ -f "$1" ]; then
  # shellcheck source=/dev/null
  source "$1"
elif [ -f .env.new-operator ]; then
  # shellcheck source=/dev/null
  source .env.new-operator
fi

: "${CHAIN_API_URL:?Set CHAIN_API_URL}"
: "${NEW_STAKING_PROVIDER_ADDRESS:?Run setup-new-staking-provider.js first}"
: "${NEW_OPERATOR_ADDRESS:?Run setup-new-staking-provider.js first}"
: "${CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY:?Set CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY (deployer with T balance)}"

echo "=== Transfer 80,000 T to staking provider ==="
ETH_PRIVATE_KEY="$CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY" \
  cast send "$T_TOKEN" "transfer(address,uint256)" "$NEW_STAKING_PROVIDER_ADDRESS" "$AMOUNT_80K" \
  --rpc-url "$CHAIN_API_URL"

echo ""
echo "=== Sepolia ETH ==="
echo "Fund these addresses with Sepolia ETH (faucets):"
echo "  Staking provider: $NEW_STAKING_PROVIDER_ADDRESS"
echo "  Operator:         $NEW_OPERATOR_ADDRESS"
echo ""
echo "Faucets:"
echo "  https://sepoliafaucet.com"
echo "  https://www.alchemy.com/faucets/ethereum-sepolia"
echo "  https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
echo ""
echo "After funding, run: bash scripts/run-new-operator-setup.sh"

#!/bin/bash
#
# Register multiple operators for DKG.
#
# Modes:
#   --new      Create new staking providers + operators (fund, stake, authorize, register, join).
#   --existing Use existing operators from .env.operators-N (authorize, register, join only).
#              Auto-selected when N=3 and .env.operators-3 exists.
#
# Prerequisites (--new): Deployer has N×80k T and ~N×0.2 ETH
#   TokenStaking proxy MUST use ExtendedTokenStaking (implements stake()). If stake() is missing,
#   txs revert with empty data (~30k gas) and increaseAuthorization fails with "Not authorizer".
#   One-time: cd solidity-contracts && yarn deploy --network sepolia --tags TokenStakingUpgrade
#   Beacon + ECDSA sortition pools must not require chaosnet beta operators, or joinSortitionPool on
#   WalletRegistry reverts: "Not beta operator for chaosnet". One-time from repo root:
#   bash scripts/deactivate-chaosnet.sh
# Prerequisites (--existing): .env.operators-3 with OPn_STAKING_PROVIDER_*, OPn_OPERATOR_*;
#                            staking providers already staked with 80k T.
#
# Usage:
#   source .env
#   bash scripts/setup-multiple-operators.sh [N] [password] [--new|--existing]
#
# Examples:
#   bash scripts/setup-multiple-operators.sh 3 mypassword --existing   # 3 existing operators
#   bash scripts/setup-multiple-operators.sh 3 mypassword --new       # 3 new operators
#   bash scripts/setup-multiple-operators.sh 100 mypassword           # 100 new operators
#
set -e

N="${1:-100}"
PASSWORD="${2:-}"
USE_EXISTING=false
MODE_EXPLICIT=false
for arg in "$@"; do
  case "$arg" in
    --existing) USE_EXISTING=true; MODE_EXPLICIT=true ;;
    --new)      USE_EXISTING=false; MODE_EXPLICIT=true ;;
  esac
done

ETH_PER_OPERATOR="0.001ether"

# Contract addresses (from tbtc-v2 deployments)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENTS="$(cd "$SCRIPT_DIR/../../tbtc-v2/solidity/deployments/sepolia" && pwd)"
TOKEN_STAKING="$(jq -re '.address' "$DEPLOYMENTS/TokenStaking.json")"
RANDOM_BEACON="$(jq -re '.address' "$DEPLOYMENTS/RandomBeacon.json")"
WALLET_REGISTRY="$(jq -re '.address' "$DEPLOYMENTS/WalletRegistry.json")"
T_TOKEN="$(jq -re '.address' "$DEPLOYMENTS/T.json")"
AMOUNT_40K="$(cast to-wei 40000)"
AMOUNT_80K="$(cast to-wei 80000)"
# Some RPCs return execution reverted (empty) for eth_estimateGas on TokenStaking.stake (proxy + T
# transfer) while the tx is valid. Override if needed: OPERATOR_STAKE_GAS_LIMIT=800000
OPERATOR_STAKE_GAS_LIMIT="${OPERATOR_STAKE_GAS_LIMIT:-700000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [ -f .env ]; then source .env; fi

: "${CHAIN_API_URL:?Set CHAIN_API_URL in .env}"

# cast send often exits 0 even when the mined tx reverts. Abort if receipt status != 1 so we do not
# run increaseAuthorization next (that fails with "Not authorizer" when stake never succeeded).
cast_send_ok() {
  local out tx st
  out=$(cast send "$@" 2>&1) || {
    echo "$out"
    return 1
  }
  echo "$out"
  # Match only the receipt line; do not use /transactionHash/ — logs JSON also contains "transactionHash".
  tx=$(echo "$out" | awk '/^[[:space:]]*transactionHash[[:space:]]/ {print $2; exit}')
  if [ -z "$tx" ] || [ "${#tx}" -ne 66 ] || [ "${tx#0x}" = "$tx" ]; then
    echo "cast_send_ok: could not parse top-level transactionHash from cast output (got: ${tx:-empty})" >&2
    return 1
  fi
  st=$(cast receipt "$tx" --rpc-url "$CHAIN_API_URL" | awk '/^status[[:space:]]+/ {print $2; exit}')
  if [ "$st" != "1" ]; then
    echo "cast_send_ok: transaction reverted on-chain (status=$st): $tx" >&2
    echo "If this was stake(), fix that before increaseAuthorization — otherwise you see \"Not authorizer\"." >&2
    return 1
  fi
  return 0
}

# Auto-detect existing mode when no --new/--existing passed: N=3 and .env.operators-3 exists
if [ "$MODE_EXPLICIT" = false ] && [ "$N" = "3" ] && [ -f ".env.operators-3" ]; then
  USE_EXISTING=true
  echo "Found .env.operators-3, using existing operators (use --new to create new)"
fi

if [ "$USE_EXISTING" = true ]; then
  : "${CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY:-}"
  OPERATORS_CONFIG="${OPERATORS_CONFIG:-.env.operators-3}"
  [ -f "$OPERATORS_CONFIG" ] || { echo "Missing $OPERATORS_CONFIG. Copy from .env.operators-3.example"; exit 1; }
  source "$OPERATORS_CONFIG"
  echo "=== Registering $N existing operators (authorize, register, join) ==="
else
  : "${CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY:?Set CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY in .env}"
  echo "=== Registering $N new operators ==="
  echo "T required: $((N * 80000)) (80k per operator)"
  echo "ETH required: ~$((N * 2)) (0.001 ETH × 2 addresses × $N)"
  echo "TokenStaking: use ExtendedTokenStaking (yarn deploy --network sepolia --tags TokenStakingUpgrade)"
  echo "Chaosnet: run bash scripts/deactivate-chaosnet.sh from repo root (uses pools linked on-chain)"
fi
echo ""

run_existing_operator() {
  local i=$1
  local sp_addr="OP${i}_STAKING_PROVIDER_ADDRESS"
  local sp_key="OP${i}_STAKING_PROVIDER_KEY"
  local op_addr="OP${i}_OPERATOR_ADDRESS"
  local op_key="OP${i}_OPERATOR_KEY"
  sp_addr=${!sp_addr}
  sp_key=${!sp_key}
  op_addr=${!op_addr}
  op_key=${!op_key}
  [ -n "$sp_addr" ] && [ -n "$sp_key" ] && [ -n "$op_addr" ] && [ -n "$op_key" ] || return 1
  echo "--- Operator $i/$N (existing) ---"
  ETH_PRIVATE_KEY="$sp_key" cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
    "$sp_addr" $RANDOM_BEACON $AMOUNT_40K \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$sp_key" cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
    "$sp_addr" $WALLET_REGISTRY $AMOUNT_40K \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$sp_key" cast_send_ok $RANDOM_BEACON "registerOperator(address)" "$op_addr" \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$sp_key" cast_send_ok $WALLET_REGISTRY "registerOperator(address)" "$op_addr" \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$op_key" cast_send_ok $RANDOM_BEACON "joinSortitionPool()" \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$op_key" cast_send_ok $WALLET_REGISTRY "joinSortitionPool()" \
    --rpc-url $CHAIN_API_URL
  echo "  Registered: $op_addr"
}

if [ "$USE_EXISTING" = true ]; then
  for i in $(seq 1 "$N"); do
    run_existing_operator "$i" || { echo "Skipping operator $i (missing OP${i}_* in config)"; }
  done
  echo ""
  echo "=== Done. $N existing operators registered. ==="
  exit 0
fi

for i in $(seq 1 "$N"); do
  echo "--- Operator $i/$N ---"

  # Generate new staking provider + operator (writes .env.operator-$i when index passed)
  node scripts/setup-new-staking-provider.js "${PASSWORD:-operator-$i}" "$i" > /dev/null 2>&1
  # shellcheck source=/dev/null
  source ".env.operator-${i}"

  _sp_derived=$(cast wallet address "$NEW_STAKING_PROVIDER_KEY")
  _sp_a=$(echo "$_sp_derived" | tr '[:upper:]' '[:lower:]')
  _sp_b=$(echo "$NEW_STAKING_PROVIDER_ADDRESS" | tr '[:upper:]' '[:lower:]')
  if [ "$_sp_a" != "$_sp_b" ]; then
    echo "ERROR: NEW_STAKING_PROVIDER_KEY derives ${_sp_derived} but NEW_STAKING_PROVIDER_ADDRESS=${NEW_STAKING_PROVIDER_ADDRESS} (.env.operator-${i})" >&2
    exit 1
  fi

  # Fund with T
  ETH_PRIVATE_KEY="$CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY" cast_send_ok $T_TOKEN "transfer(address,uint256)" "$NEW_STAKING_PROVIDER_ADDRESS" $AMOUNT_80K \
    --rpc-url $CHAIN_API_URL

  # Fund with ETH
  ETH_PRIVATE_KEY="$CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY" cast_send_ok "$NEW_STAKING_PROVIDER_ADDRESS" --value $ETH_PER_OPERATOR \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY" cast_send_ok "$NEW_OPERATOR_ADDRESS" --value $ETH_PER_OPERATOR \
    --rpc-url $CHAIN_API_URL

  # Stake, authorize, register, join
  ETH_PRIVATE_KEY="$NEW_STAKING_PROVIDER_KEY" cast_send_ok $T_TOKEN "approve(address,uint256)" $TOKEN_STAKING $AMOUNT_80K \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$NEW_STAKING_PROVIDER_KEY" cast_send_ok $TOKEN_STAKING "stake(address,address,address,uint96)" \
    "$NEW_STAKING_PROVIDER_ADDRESS" "$NEW_STAKING_PROVIDER_ADDRESS" "$NEW_STAKING_PROVIDER_ADDRESS" $AMOUNT_80K \
    --gas-limit "$OPERATOR_STAKE_GAS_LIMIT" \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$NEW_STAKING_PROVIDER_KEY" cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
    "$NEW_STAKING_PROVIDER_ADDRESS" $RANDOM_BEACON $AMOUNT_40K \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$NEW_STAKING_PROVIDER_KEY" cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
    "$NEW_STAKING_PROVIDER_ADDRESS" $WALLET_REGISTRY $AMOUNT_40K \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$NEW_STAKING_PROVIDER_KEY" cast_send_ok $RANDOM_BEACON "registerOperator(address)" "$NEW_OPERATOR_ADDRESS" \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$NEW_STAKING_PROVIDER_KEY" cast_send_ok $WALLET_REGISTRY "registerOperator(address)" "$NEW_OPERATOR_ADDRESS" \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$NEW_OPERATOR_KEY" cast_send_ok $RANDOM_BEACON "joinSortitionPool()" \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$NEW_OPERATOR_KEY" cast_send_ok $WALLET_REGISTRY "joinSortitionPool()" \
    --rpc-url $CHAIN_API_URL

  echo "  Registered: $NEW_OPERATOR_ADDRESS"
done

echo ""
echo "=== Done. $N operators registered. ==="
echo "Keystores in operator-1-keystore/ (use for keep-client on each node)"

#!/bin/bash
#
# Register multiple operators for DKG.
#
# Modes:
#   --new      Create new staking providers + operators (fund, stake, authorize, register, join).
#   --existing Use existing operators from .env.operators-N (authorize, register, join only).
#              Auto-selected when N=3 and .env.operators-3 exists.
#
# Prerequisites (--new): python3; deployer has N×80k T and enough native ETH: per operator the deployer
#   sends ETH_PER_OPERATOR (default 0.05ether) to each new staking provider and operator (2×), plus gas
#   for T transfers and those sends. Or AUTO_FUND_T=1 (default) when deployer / T_MINTER_PRIVATE_KEY is
#   T owner so T shortfall is minted (does not mint native ETH).
#   TokenStaking proxy MUST use SepoliaTokenStaking (implements stake()). If stake() is missing,
#   txs revert with empty data (~30k gas) and increaseAuthorization fails with "Not authorizer".
#   One-time: cd solidity-contracts && yarn deploy --network sepolia --tags TokenStakingUpgrade
#   Beacon + ECDSA sortition pools must not require chaosnet beta operators, or joinSortitionPool on
#   WalletRegistry reverts: "Not beta operator for chaosnet". One-time from repo root:
#   bash scripts/deactivate-chaosnet.sh
# Prerequisites (--existing): .env.operators-3 with OPn_STAKING_PROVIDER_*, OPn_OPERATOR_*;
#                            staking providers already staked with 80k T.
#
# Optional env (--new): AUTO_FUND_T=1 (default if unset) mints missing T via T.mint when deployer or
#   T_MINTER_PRIVATE_KEY matches T.owner(). Set AUTO_FUND_T=0 to require a pre-funded deployer.
#   ETH_PER_OPERATOR: native ETH sent to each new SP and each operator (default 0.05ether).
#   Unitless amounts are interpreted as ether. Sepolia gas for stake/register/join can exceed
#   0.001ether per address; override if your network is cheaper.
#   Ambiguous transaction submission stops setup; reconcile the original transaction before retrying.
#   python3 is required for --new. Parent/Ansible export wins over .env for deployer / T minter keys.
#
# Usage:
#   source ./.env
#   bash scripts/setup-multiple-operators.sh [N] [password] [--new|--existing]
#
# Examples:
#   bash scripts/setup-multiple-operators.sh 3 mypassword --existing   # 3 existing operators
#   bash scripts/setup-multiple-operators.sh 3 mypassword --new       # 3 new operators
#   bash scripts/setup-multiple-operators.sh 100 mypassword           # 100 new operators
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/cast-helpers.sh
source "$SCRIPT_DIR/lib/cast-helpers.sh"

# CRLF or stray whitespace in .env / vault-sourced vars breaks `cast` ("Failed to decode private key").
strip_secret() {
  local s="$1"
  s="${s//$'\r'/}"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

normalize_addr() {
  echo "$1" | tr '[:upper:]' '[:lower:]'
}

N="${1:-100}"
PASSWORD="${2:-}"
USE_EXISTING=false
MODE_EXPLICIT=false
for arg in "$@"; do
  case "$arg" in
    --existing)
      USE_EXISTING=true
      MODE_EXPLICIT=true
      ;;
    --new)
      USE_EXISTING=false
      MODE_EXPLICIT=true
      ;;
  esac
done

ETH_PER_OPERATOR="${ETH_PER_OPERATOR:-0.05ether}"

# Contract addresses (from tbtc-v2 deployments). Script may live under
# solidity-contracts/scripts/ OR be staged at <workspace>/scripts/ (runner); resolve workspace first.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${THRESHOLD_WORKSPACE_ROOT:-}" ] && [ -d "${THRESHOLD_WORKSPACE_ROOT}/tbtc-v2/solidity/deployments/sepolia" ]; then
  _ws="$(cd "${THRESHOLD_WORKSPACE_ROOT}" && pwd)"
elif [ -d "$SCRIPT_DIR/../tbtc-v2/solidity/deployments/sepolia" ]; then
  _ws="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -d "$SCRIPT_DIR/../../tbtc-v2/solidity/deployments/sepolia" ]; then
  _ws="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  echo "ERROR: cannot find tbtc-v2/solidity/deployments/sepolia (set THRESHOLD_WORKSPACE_ROOT to the repo root)." >&2
  exit 1
fi
DEPLOYMENTS="$(cd "$_ws/tbtc-v2/solidity/deployments/sepolia" && pwd)"
SOLIDITY_CONTRACTS_DIR="${SOLIDITY_CONTRACTS_DIR:-$_ws/solidity-contracts}"
TOKEN_STAKING="$(jq -re '.address' "$DEPLOYMENTS/TokenStaking.json")"
RANDOM_BEACON="$(jq -re '.address' "$DEPLOYMENTS/RandomBeacon.json")"
WALLET_REGISTRY="$(jq -re '.address' "$DEPLOYMENTS/WalletRegistry.json")"
T_TOKEN="$(jq -re '.address' "$DEPLOYMENTS/T.json")"
AMOUNT_40K="$(cast to-wei 40000)"
AMOUNT_80K="$(cast to-wei 80000)"
# Some RPCs return execution reverted (empty) for eth_estimateGas on TokenStaking.stake (proxy + T
# transfer) while the tx is valid. Override if needed: OPERATOR_STAKE_GAS_LIMIT=800000
OPERATOR_STAKE_GAS_LIMIT="${OPERATOR_STAKE_GAS_LIMIT:-700000}"

cd "$SOLIDITY_CONTRACTS_DIR"

# If the parent (Ansible/CI) exported CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY / T_MINTER_PRIVATE_KEY,
# do not let a stale solidity-contracts/.env overwrite them when sourced.
_saved_contract_owner_pk="${CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY:-}"
_saved_t_minter_pk="${T_MINTER_PRIVATE_KEY:-}"
if [ -f .env ]; then source ./.env; fi
if [ -n "$_saved_contract_owner_pk" ]; then
  CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY="$_saved_contract_owner_pk"
fi
if [ -n "$_saved_t_minter_pk" ]; then
  T_MINTER_PRIVATE_KEY="$_saved_t_minter_pk"
fi
CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY=$(strip_secret "${CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY:-}")
T_MINTER_PRIVATE_KEY=$(strip_secret "${T_MINTER_PRIVATE_KEY:-}")

: "${CHAIN_API_URL:?Set CHAIN_API_URL in .env}"

compute_t_shortfall_between() {
  python3 -c "
import sys
def parse(s):
    s = s.strip().split()[0]
    return int(s, 16) if s.lower().startswith('0x') else int(s)
bal, need = parse(sys.argv[1]), parse(sys.argv[2])
print(max(0, need - bal))
" "$1" "$2"
}

compute_shortfall_between() {
  python3 -c "
import sys
def parse(s):
    s = s.strip().split()[0]
    return int(s, 16) if s.lower().startswith('0x') else int(s)
have, need = parse(sys.argv[1]), parse(sys.argv[2])
print(max(0, need - have))
" "$1" "$2"
}

to_decimal_wei() {
  python3 -c "
import sys
s = sys.argv[1].strip().split()[0]
print(int(s, 16) if s.lower().startswith('0x') else int(s))
" "$1"
}

ensure_deployer_eth_at_least() {
  local min_need="$1"
  local bal_raw sf min_need_dec bal_dec
  bal_raw=$(cast balance "$_deployer_addr" --rpc-url "$CHAIN_API_URL" | awk '{print $1; exit}')
  min_need_dec=$(to_decimal_wei "$min_need")
  bal_dec=$(to_decimal_wei "$bal_raw")
  sf=$(compute_shortfall_between "$bal_raw" "$min_need")
  if python3 -c "import sys; sys.exit(0 if int(sys.argv[1]) <= 0 else 1)" "$sf" 2> /dev/null; then
    return 0
  fi
  echo "ERROR: Deployer $_deployer_addr has insufficient native ETH for operator bootstrap." >&2
  echo "       Needed at least $(cast from-wei "$min_need_dec") ETH, current balance $(cast from-wei "$bal_dec") ETH." >&2
  echo "       This check covers only direct funding transfers (SP + operator), not gas." >&2
  echo "       Fund deployer or lower ETH_PER_OPERATOR (current: $ETH_PER_OPERATOR)." >&2
  exit 1
}

resolve_t_minter_private_key() {
  local _t_owner _t_owner_lc _mk_addr
  _t_owner=$(cast call "$T_TOKEN" "owner()(address)" --rpc-url "$CHAIN_API_URL" | awk '{print $1; exit}')
  _t_owner_lc=$(normalize_addr "$_t_owner")
  if [ "$(normalize_addr "$_deployer_addr")" = "$_t_owner_lc" ]; then
    printf '%s' "$_DEPLOYER_ACCOUNT_PRIVATE_KEY"
    return 0
  fi
  if [ -n "${T_MINTER_PRIVATE_KEY:-}" ]; then
    _mk_addr=$(ETH_PRIVATE_KEY="${T_MINTER_PRIVATE_KEY}" derive_address_safe)
    if [ "$(normalize_addr "$_mk_addr")" = "$_t_owner_lc" ]; then
      printf '%s' "${T_MINTER_PRIVATE_KEY}"
      return 0
    fi
    echo "ERROR: T_MINTER_PRIVATE_KEY controls ${_mk_addr}, not T owner ($_t_owner)." >&2
    if [ "$(normalize_addr "$_mk_addr")" = "$(normalize_addr "$_deployer_addr")" ]; then
      echo "       That key is the deployer; t_minter must be the separate owner key (or pre-fund T and use AUTO_FUND_T=0)." >&2
    fi
    return 1
  fi
  echo "ERROR: No key matches T owner ($_t_owner); deployer is $_deployer_addr." >&2
  echo "       Set T_MINTER_PRIVATE_KEY to the owner key, or Ansible vault t_minter_private_key for operators register." >&2
  echo "       Or pre-fund the deployer with T and set AUTO_FUND_T=0." >&2
  return 1
}

# Args: minimum deployer T balance (wei), decimal or 0x string from cast to-wei / balanceOf.
# When shortfall > 0 and AUTO_FUND_T=1, mints to deployer if deployer or T_MINTER_PRIVATE_KEY is T.owner().
ensure_deployer_t_at_least() {
  local min_need="$1"
  local sf _mpk
  _t_bal_raw=$(cast call "$T_TOKEN" "balanceOf(address)(uint256)" "$_deployer_addr" --rpc-url "$CHAIN_API_URL" | awk '{print $1; exit}')
  sf=$(compute_t_shortfall_between "$_t_bal_raw" "$min_need")
  if python3 -c "import sys; sys.exit(0 if int(sys.argv[1]) <= 0 else 1)" "$sf" 2> /dev/null; then
    return 0
  fi
  if [ "${AUTO_FUND_T:-0}" != "1" ]; then
    echo "ERROR: Deployer $_deployer_addr has insufficient T (need >= ${min_need} wei, balance raw: $_t_bal_raw, shortfall wei ${sf}). T=$T_TOKEN" >&2
    echo "       Set AUTO_FUND_T=1 (default) and ensure deployer or T_MINTER_PRIVATE_KEY is T owner; or fund manually." >&2
    exit 1
  fi
  echo "=== AUTO_FUND_T=1: minting ${sf} wei T to deployer $_deployer_addr ==="
  if ! _mpk="$(resolve_t_minter_private_key)"; then
    exit 1
  fi
  ETH_PRIVATE_KEY="$_mpk" cast_send_ok "$T_TOKEN" "mint(address,uint256)" "$_deployer_addr" "$sf" \
    --rpc-url "$CHAIN_API_URL"
  _t_bal_raw=$(cast call "$T_TOKEN" "balanceOf(address)(uint256)" "$_deployer_addr" --rpc-url "$CHAIN_API_URL" | awk '{print $1; exit}')
  sf=$(compute_t_shortfall_between "$_t_bal_raw" "$min_need")
  if ! python3 -c "import sys; sys.exit(0 if int(sys.argv[1]) <= 0 else 1)" "$sf" 2> /dev/null; then
    echo "ERROR: Deployer still below minimum after mint (shortfall ${sf} wei)." >&2
    exit 1
  fi
  echo "=== Deployer T OK after mint ==="
}

# Auto-detect existing mode when no --new/--existing passed: N=3 and .env.operators-3 exists
if [ "$MODE_EXPLICIT" = false ] && [ "$N" = "3" ] && [ -f ".env.operators-3" ]; then
  USE_EXISTING=true
  echo "Found .env.operators-3, using existing operators (use --new to create new)"
fi

if [ "$USE_EXISTING" = true ]; then
  : "${CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY:-}"
  OPERATORS_CONFIG="${OPERATORS_CONFIG:-.env.operators-3}"
  case "$OPERATORS_CONFIG" in
    /*) ;;
    *) OPERATORS_CONFIG="./$OPERATORS_CONFIG" ;;
  esac
  [ -f "$OPERATORS_CONFIG" ] || {
    echo "Missing $OPERATORS_CONFIG. Copy from .env.operators-3.example"
    exit 1
  }
  source -- "$OPERATORS_CONFIG"
  CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY=$(strip_secret "${CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY:-}")
  echo "=== Registering $N existing operators (authorize, register, join) ==="
else
  : "${CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY:?Set CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY in .env}"
  echo "=== Registering $N new operators ==="
  echo "T required: $((N * 80000)) (80k per operator)"
  echo "ETH: deployer funds each new SP + operator with ETH_PER_OPERATOR=$ETH_PER_OPERATOR (override via env)"
  echo "TokenStaking: use SepoliaTokenStaking (yarn deploy --network sepolia --tags TokenStakingUpgrade)"
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
  sp_addr=$(strip_secret "$sp_addr")
  sp_key=$(strip_secret "$sp_key")
  op_addr=$(strip_secret "$op_addr")
  op_key=$(strip_secret "$op_key")
  [ -n "$sp_addr" ] && [ -n "$sp_key" ] && [ -n "$op_addr" ] && [ -n "$op_key" ] || return 1
  echo "--- Operator $i/$N (existing) ---"
  ETH_PRIVATE_KEY="$sp_key" cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
    "$sp_addr" $RANDOM_BEACON $AMOUNT_40K \
    --rpc-url "$CHAIN_API_URL" || return 1
  ETH_PRIVATE_KEY="$sp_key" cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
    "$sp_addr" $WALLET_REGISTRY $AMOUNT_40K \
    --rpc-url "$CHAIN_API_URL" || return 1
  ETH_PRIVATE_KEY="$sp_key" cast_send_ok $RANDOM_BEACON "registerOperator(address)" "$op_addr" \
    --rpc-url "$CHAIN_API_URL" || return 1
  ETH_PRIVATE_KEY="$sp_key" cast_send_ok $WALLET_REGISTRY "registerOperator(address)" "$op_addr" \
    --rpc-url "$CHAIN_API_URL" || return 1
  ETH_PRIVATE_KEY="$op_key" cast_send_ok $RANDOM_BEACON "joinSortitionPool()" \
    --rpc-url "$CHAIN_API_URL" || return 1
  ETH_PRIVATE_KEY="$op_key" cast_send_ok $WALLET_REGISTRY "joinSortitionPool()" \
    --rpc-url "$CHAIN_API_URL" || return 1
  echo "  Registered: $op_addr"
}

if [ "$USE_EXISTING" = true ]; then
  failed=0
  for i in $(seq 1 "$N"); do
    if ! run_existing_operator "$i"; then
      echo "ERROR: Operator $i setup is incomplete (missing configuration or failed transaction)." >&2
      failed=$((failed + 1))
    fi
  done
  if [ "$failed" -ne 0 ]; then
    echo "ERROR: $failed of $N existing operators could not be registered." >&2
    exit 1
  fi
  echo ""
  echo "=== Done. $N existing operators registered. ==="
  exit 0
fi

# Sourcing .env.operator-* must not clobber the deployer key (stale files sometimes set CONTRACT_OWNER_*).
_DEPLOYER_ACCOUNT_PRIVATE_KEY="$CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY"

_deployer_addr=$(ETH_PRIVATE_KEY="$_DEPLOYER_ACCOUNT_PRIVATE_KEY" derive_address_safe)
command -v python3 > /dev/null 2>&1 || {
  echo "ERROR: python3 is required for --new (T balance checks and AUTO_FUND_T mint)." >&2
  echo "       Install python3 on the runner, then retry." >&2
  exit 1
}
AUTO_FUND_T="${AUTO_FUND_T:-1}"
_required_t_wei=$(cast to-wei $((N * 80000)))
if [[ "$ETH_PER_OPERATOR" == *ether ]]; then
  _eth_per_operator_wei=$(cast to-wei "${ETH_PER_OPERATOR%ether}" ether)
else
  _eth_per_operator_wei=$(cast to-wei "$ETH_PER_OPERATOR")
fi
_eth_per_operator_wei_dec=$(to_decimal_wei "$_eth_per_operator_wei")
_required_eth_transfer_wei=$(python3 -c "import sys; print(int(sys.argv[1]) * int(sys.argv[2]) * 2)" "$N" "$_eth_per_operator_wei_dec")
echo "T preflight: deployer $_deployer_addr needs >= $((N * 80000)) T (AUTO_FUND_T=$AUTO_FUND_T)"
ensure_deployer_t_at_least "$_required_t_wei"
echo "ETH preflight: deployer $_deployer_addr needs >= $(cast from-wei "$_required_eth_transfer_wei") ETH for direct transfers"
ensure_deployer_eth_at_least "$_required_eth_transfer_wei"

for i in $(seq 1 "$N"); do
  echo "--- Operator $i/$N ---"

  # Generate new staking provider + operator (writes .env.operator-$i when index passed)
  if ! node scripts/setup-new-staking-provider.js "${PASSWORD:-operator-$i}" "$i" > /dev/null; then
    echo "ERROR: setup-new-staking-provider.js failed for operator index $i (see stderr above)." >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  source "./.env.operator-${i}"
  NEW_STAKING_PROVIDER_KEY=$(strip_secret "${NEW_STAKING_PROVIDER_KEY:-}")
  NEW_OPERATOR_KEY=$(strip_secret "${NEW_OPERATOR_KEY:-}")
  NEW_STAKING_PROVIDER_ADDRESS=$(strip_secret "${NEW_STAKING_PROVIDER_ADDRESS:-}")
  NEW_OPERATOR_ADDRESS=$(strip_secret "${NEW_OPERATOR_ADDRESS:-}")
  CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY="$_DEPLOYER_ACCOUNT_PRIVATE_KEY"
  if [ -z "${NEW_STAKING_PROVIDER_KEY:-}" ] || [ -z "${NEW_OPERATOR_KEY:-}" ]; then
    echo "ERROR: .env.operator-${i} is missing NEW_STAKING_PROVIDER_KEY / NEW_OPERATOR_KEY." >&2
    echo "       Preserve existing key files and restore the missing keys from your backup before resuming." >&2
    exit 1
  fi

  _sp_derived=$(ETH_PRIVATE_KEY="$NEW_STAKING_PROVIDER_KEY" derive_address_safe)
  _sp_a=$(echo "$_sp_derived" | tr '[:upper:]' '[:lower:]')
  _sp_b=$(echo "$NEW_STAKING_PROVIDER_ADDRESS" | tr '[:upper:]' '[:lower:]')
  if [ "$_sp_a" != "$_sp_b" ]; then
    echo "ERROR: NEW_STAKING_PROVIDER_KEY derives ${_sp_derived} but NEW_STAKING_PROVIDER_ADDRESS=${NEW_STAKING_PROVIDER_ADDRESS} (.env.operator-${i})" >&2
    exit 1
  fi

  # Fund with T (re-check: runners without prior mint must not skip mid-run)
  ensure_deployer_t_at_least "$AMOUNT_80K"
  ETH_PRIVATE_KEY="$CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY" cast_send_ok $T_TOKEN "transfer(address,uint256)" "$NEW_STAKING_PROVIDER_ADDRESS" $AMOUNT_80K \
    --rpc-url $CHAIN_API_URL

  # Fund with the same wei amount checked by ETH preflight.
  ETH_PRIVATE_KEY="$CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY" cast_send_ok "$NEW_STAKING_PROVIDER_ADDRESS" --value "$_eth_per_operator_wei_dec" \
    --rpc-url $CHAIN_API_URL
  ETH_PRIVATE_KEY="$CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY" cast_send_ok "$NEW_OPERATOR_ADDRESS" --value "$_eth_per_operator_wei_dec" \
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

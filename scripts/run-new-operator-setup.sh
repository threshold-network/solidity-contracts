#!/bin/bash
#
# Run the full operator setup for a NEW staking provider + operator.
#
# Prerequisites:
#   0. TokenStaking must be upgraded to ExtendedTokenStaking (adds stake()):
#      yarn deploy --network sepolia --tags TokenStakingUpgrade
#   1. Run: node scripts/setup-new-staking-provider.js "your-password"
#   2. Fund: bash scripts/fund-new-operator.sh
#      - Transfers 80,000 T from deployer to staking provider
#      - Use faucets for Sepolia ETH: sepoliafaucet.com, alchemy.com/faucets/ethereum-sepolia
#   4. If sortition pools are in chaosnet mode, deactivate first:
#      cast send $BEACON_SORTITION_POOL "deactivateChaosnet()" ...
#      cast send $ECDSA_SORTITION_POOL "deactivateChaosnet()" ...
#   5. Source .env and .env.new-operator, or export the variables below
#
# Usage:
#   source .env
#   source .env.new-operator   # or export NEW_* vars manually
#   bash scripts/run-new-operator-setup.sh
#
set -e

# Contract addresses (from tbtc-v2 deployments)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENTS="$(cd "$SCRIPT_DIR/../../tbtc-v2/solidity/deployments/sepolia" && pwd)"
TOKEN_STAKING="$(jq -re '.address' "$DEPLOYMENTS/TokenStaking.json")"
RANDOM_BEACON="$(jq -re '.address' "$DEPLOYMENTS/RandomBeacon.json")"
WALLET_REGISTRY="$(jq -re '.address' "$DEPLOYMENTS/WalletRegistry.json")"
T_TOKEN="$(jq -re '.address' "$DEPLOYMENTS/T.json")"

# 40_000 / 80_000 T in wei (18 decimals); cast to-wei avoids manual wei / hex mistakes.
AMOUNT_40K="$(cast to-wei 40000)"
AMOUNT_80K="$(cast to-wei 80000)"
OPERATOR_STAKE_GAS_LIMIT="${OPERATOR_STAKE_GAS_LIMIT:-700000}"

# Load env
if [ -f .env ]; then source .env; fi
if [ -f .env.new-operator ]; then source .env.new-operator; fi

: "${CHAIN_API_URL:?Set CHAIN_API_URL}"
: "${NEW_STAKING_PROVIDER_ADDRESS:?Run setup-new-staking-provider.js first}"
: "${NEW_STAKING_PROVIDER_KEY:?Run setup-new-staking-provider.js first}"
: "${NEW_OPERATOR_ADDRESS:?Run setup-new-staking-provider.js first}"
: "${NEW_OPERATOR_KEY:?Run setup-new-staking-provider.js first}"

SP="$NEW_STAKING_PROVIDER_ADDRESS"
SP_KEY="$NEW_STAKING_PROVIDER_KEY"
OP="$NEW_OPERATOR_ADDRESS"
OP_KEY="$NEW_OPERATOR_KEY"

cast_send_ok() {
  local out tx st
  out=$(cast send "$@" 2>&1) || {
    echo "$out"
    return 1
  }
  echo "$out"
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

echo "=== Step 1: Approve TokenStaking to spend T ==="
cast_send_ok $T_TOKEN "approve(address,uint256)" $TOKEN_STAKING $AMOUNT_80K \
  --rpc-url $CHAIN_API_URL --private-key $SP_KEY

echo "=== Step 2: Stake 80,000 T (stakingProvider = beneficiary = authorizer) ==="
cast_send_ok $TOKEN_STAKING "stake(address,address,address,uint96)" \
  $SP $SP $SP $AMOUNT_80K \
  --gas-limit "$OPERATOR_STAKE_GAS_LIMIT" \
  --rpc-url $CHAIN_API_URL --private-key $SP_KEY

echo "=== Step 3: Authorize for RandomBeacon (40,000 T) ==="
cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
  $SP $RANDOM_BEACON $AMOUNT_40K \
  --rpc-url $CHAIN_API_URL --private-key $SP_KEY

echo "=== Step 4: Authorize for WalletRegistry (40,000 T) ==="
cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
  $SP $WALLET_REGISTRY $AMOUNT_40K \
  --rpc-url $CHAIN_API_URL --private-key $SP_KEY

echo "=== Step 5: Register operator in RandomBeacon (staking provider signs) ==="
cast_send_ok $RANDOM_BEACON "registerOperator(address)" $OP \
  --rpc-url $CHAIN_API_URL --private-key $SP_KEY

echo "=== Step 6: Register operator in WalletRegistry (staking provider signs) ==="
cast_send_ok $WALLET_REGISTRY "registerOperator(address)" $OP \
  --rpc-url $CHAIN_API_URL --private-key $SP_KEY

echo "=== Step 7: Operator joins BeaconSortitionPool ==="
cast_send_ok $RANDOM_BEACON "joinSortitionPool()" \
  --rpc-url $CHAIN_API_URL --private-key $OP_KEY

echo "=== Step 8: Operator joins EcdsaSortitionPool ==="
cast_send_ok $WALLET_REGISTRY "joinSortitionPool()" \
  --rpc-url $CHAIN_API_URL --private-key $OP_KEY

echo ""
echo "=== Done. Operator $OP is registered and in both sortition pools. ==="
echo "Use OPERATOR_KEYSTORE_PATH in keep-client config.toml KeyFile."

#!/bin/bash
#
# Run the full operator setup for a NEW staking provider + operator.
#
# Prerequisites:
#   0. TokenStaking must be upgraded to SepoliaTokenStaking (adds stake()):
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
#   source ./.env
#   source ./.env.new-operator          # provides addresses + OPERATOR_KEYSTORE_PATH
#   export NEW_STAKING_PROVIDER_KEY=0x...  # key shown once by setup-new-staking-provider.js
#   export NEW_OPERATOR_KEY=0x...          # or use OPERATOR_KEYSTORE_PATH + password instead
#   bash scripts/run-new-operator-setup.sh
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/cast-helpers.sh
source "$SCRIPT_DIR/lib/cast-helpers.sh"

# Contract addresses (from tbtc-v2 deployments)
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
if [ -f .env ]; then source ./.env; fi
if [ -f .env.new-operator ]; then source ./.env.new-operator; fi

: "${CHAIN_API_URL:?Set CHAIN_API_URL}"
: "${NEW_STAKING_PROVIDER_ADDRESS:?Run setup-new-staking-provider.js first}"
: "${NEW_STAKING_PROVIDER_KEY:?Export NEW_STAKING_PROVIDER_KEY (shown once by setup-new-staking-provider.js)}"
: "${NEW_OPERATOR_ADDRESS:?Run setup-new-staking-provider.js first}"
: "${NEW_OPERATOR_KEY:?Export NEW_OPERATOR_KEY (shown once by setup-new-staking-provider.js)}"

SP="$NEW_STAKING_PROVIDER_ADDRESS"
SP_KEY="$NEW_STAKING_PROVIDER_KEY"
OP="$NEW_OPERATOR_ADDRESS"
OP_KEY="$NEW_OPERATOR_KEY"

_sp_cast_send_ok() {
  ETH_PRIVATE_KEY="$SP_KEY" cast_send_ok "$@"
}
_op_cast_send_ok() {
  ETH_PRIVATE_KEY="$OP_KEY" cast_send_ok "$@"
}

echo "=== Step 1: Approve TokenStaking to spend T ==="
_sp_cast_send_ok $T_TOKEN "approve(address,uint256)" $TOKEN_STAKING $AMOUNT_80K \
  --rpc-url $CHAIN_API_URL

echo "=== Step 2: Stake 80,000 T (stakingProvider = beneficiary = authorizer) ==="
_sp_cast_send_ok $TOKEN_STAKING "stake(address,address,address,uint96)" \
  $SP $SP $SP $AMOUNT_80K \
  --gas-limit "$OPERATOR_STAKE_GAS_LIMIT" \
  --rpc-url $CHAIN_API_URL

echo "=== Step 3: Authorize for RandomBeacon (40,000 T) ==="
_sp_cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
  $SP $RANDOM_BEACON $AMOUNT_40K \
  --rpc-url $CHAIN_API_URL

echo "=== Step 4: Authorize for WalletRegistry (40,000 T) ==="
_sp_cast_send_ok $TOKEN_STAKING "increaseAuthorization(address,address,uint96)" \
  $SP $WALLET_REGISTRY $AMOUNT_40K \
  --rpc-url $CHAIN_API_URL

echo "=== Step 5: Register operator in RandomBeacon (staking provider signs) ==="
_sp_cast_send_ok $RANDOM_BEACON "registerOperator(address)" $OP \
  --rpc-url $CHAIN_API_URL

echo "=== Step 6: Register operator in WalletRegistry (staking provider signs) ==="
_sp_cast_send_ok $WALLET_REGISTRY "registerOperator(address)" $OP \
  --rpc-url $CHAIN_API_URL

echo "=== Step 7: Operator joins BeaconSortitionPool ==="
_op_cast_send_ok $RANDOM_BEACON "joinSortitionPool()" \
  --rpc-url $CHAIN_API_URL

echo "=== Step 8: Operator joins EcdsaSortitionPool ==="
_op_cast_send_ok $WALLET_REGISTRY "joinSortitionPool()" \
  --rpc-url $CHAIN_API_URL

echo ""
echo "=== Done. Operator $OP is registered and in both sortition pools. ==="
echo "Use OPERATOR_KEYSTORE_PATH in keep-client config.toml KeyFile."

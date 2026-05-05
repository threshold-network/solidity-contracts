#!/bin/bash
# Shared cast helpers for operator setup scripts.

# cast send often exits 0 even when the mined tx reverts. Abort if receipt
# status != 1 so dependent steps (increaseAuthorization, joinSortitionPool)
# are not attempted after a silent revert.
#
# Public RPCs (e.g. Alchemy) sometimes return "nonce too low" when the node
# has not caught up to the previous tx. Retry with exponential backoff.
# Override max retries via CAST_SEND_MAX_RETRIES (default 10).
cast_send_ok() {
  local out tx st attempts max sleep_s
  local _pk="${ETH_PRIVATE_KEY:-}"
  if [ -z "$_pk" ]; then
    echo "cast_send_ok: ETH_PRIVATE_KEY is unset or empty" >&2
    return 1
  fi
  attempts=1
  max="${CAST_SEND_MAX_RETRIES:-10}"
  sleep_s=1
  while true; do
    if out=$(cast send "$@" --private-key "$_pk" 2>&1); then
      break
    fi
    if echo "$out" | grep -qiE 'nonce too low|nonce has already been used|transaction already|already known'; then
      if [ "$attempts" -ge "$max" ]; then
        echo "$out" >&2
        echo "cast_send_ok: exhausted $max retries for nonce/RPC race" >&2
        return 1
      fi
      echo "cast_send_ok: transient RPC/nonce error (attempt $attempts/$max), retrying in ${sleep_s}s..." >&2
      sleep "$sleep_s"
      attempts=$((attempts + 1))
      if [ "$sleep_s" -lt 16 ]; then
        sleep_s=$((sleep_s * 2))
      fi
      continue
    fi
    echo "$out"
    return 1
  done
  echo "$out"
  tx=$(echo "$out" | awk '/^[[:space:]]*transactionHash[[:space:]]/ {print $2; exit}')
  if [ -z "$tx" ] || [ "${#tx}" -ne 66 ] || [ "${tx#0x}" = "$tx" ]; then
    echo "cast_send_ok: could not parse top-level transactionHash from cast output (got: ${tx:-empty})" >&2
    return 1
  fi
  st=$(cast receipt "$tx" --rpc-url "$CHAIN_API_URL" | awk '/^status[[:space:]]+/ {print $2; exit}')
  if [ "$st" != "1" ]; then
    echo "cast_send_ok: transaction reverted on-chain (status=$st): $tx" >&2
    echo "If this was stake(), fix that before increaseAuthorization -- otherwise you see \"Not authorizer\"." >&2
    return 1
  fi
  return 0
}

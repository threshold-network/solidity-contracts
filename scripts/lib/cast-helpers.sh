#!/bin/bash
# Shared cast helpers for operator setup scripts.
#
# Signing keys reach `cast` via a process-local v3 keystore + password file
# rather than `--private-key` on the command line, so the key is never visible
# in /proc/<pid>/cmdline or `ps auxww` output. The keystore directory is
# created on first use (mode 700, in $TMPDIR) and removed by an EXIT trap.
# Per-key keystores are cached by derived address so repeated cast_send_ok
# calls with the same ETH_PRIVATE_KEY do not re-encrypt.

_CAST_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Lazy-init the shared per-process temp keystore directory and register an
# EXIT trap that removes it. Chains onto any existing EXIT trap.
_cast_keystore_init() {
  if [ -n "${_CAST_KEYSTORE_DIR:-}" ]; then
    return 0
  fi
  _CAST_KEYSTORE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cast-keystores.XXXXXX") || return 1
  chmod 700 "$_CAST_KEYSTORE_DIR"
  local _prev
  _prev=$(trap -p EXIT 2> /dev/null | sed -E "s/^trap -- '(.*)' EXIT\$/\\1/")
  if [ -n "$_prev" ]; then
    # shellcheck disable=SC2064
    trap "$_prev; rm -rf \"$_CAST_KEYSTORE_DIR\"" EXIT
  else
    # shellcheck disable=SC2064
    trap "rm -rf \"$_CAST_KEYSTORE_DIR\"" EXIT
  fi
}

# Ensure a v3 keystore + password file exist for $ETH_PRIVATE_KEY and assign
# their paths to _CAST_LAST_KEYSTORE / _CAST_LAST_PASSFILE. Cached by address.
_cast_keystore_for_key() {
  if [ -z "${ETH_PRIVATE_KEY:-}" ]; then
    echo "_cast_keystore_for_key: ETH_PRIVATE_KEY is unset" >&2
    return 1
  fi
  _cast_keystore_init || return 1
  local _addr
  _addr=$(node "$_CAST_HELPERS_DIR/wallet.js" address) || return 1
  _addr=$(printf '%s' "$_addr" | tr '[:upper:]' '[:lower:]')
  _addr="${_addr#0x}"
  _CAST_LAST_KEYSTORE="$_CAST_KEYSTORE_DIR/$_addr.json"
  _CAST_LAST_PASSFILE="$_CAST_KEYSTORE_DIR/$_addr.password"
  if [ ! -f "$_CAST_LAST_KEYSTORE" ]; then
    head -c 32 /dev/urandom | xxd -p -c 64 > "$_CAST_LAST_PASSFILE"
    chmod 600 "$_CAST_LAST_PASSFILE"
    node "$_CAST_HELPERS_DIR/wallet.js" import "$_CAST_LAST_PASSFILE" "$_CAST_LAST_KEYSTORE" > /dev/null || return 1
    chmod 600 "$_CAST_LAST_KEYSTORE"
  fi
}

# Print the checksum address derived from $ETH_PRIVATE_KEY without ever
# placing the key on a command line. Use in place of `cast wallet address`.
derive_address_safe() {
  if [ -z "${ETH_PRIVATE_KEY:-}" ]; then
    echo "derive_address_safe: ETH_PRIVATE_KEY is unset or empty" >&2
    return 1
  fi
  node "$_CAST_HELPERS_DIR/wallet.js" address
}

# cast send often exits 0 even when the mined tx reverts. Abort if receipt
# status != 1 so dependent steps (increaseAuthorization, joinSortitionPool)
# are not attempted after a silent revert.
#
# A rejected/ambiguous broadcast may already be pending or mined. Never rebuild
# it with a fresh nonce: the caller must reconcile it before another attempt.
cast_send_ok() {
  local out tx st receipt
  if [ -z "${ETH_PRIVATE_KEY:-}" ]; then
    echo "cast_send_ok: ETH_PRIVATE_KEY is unset or empty" >&2
    return 1
  fi
  _cast_keystore_for_key || return 1
  if ! out=$(env -u ETH_PRIVATE_KEY cast send "$@" --keystore "$_CAST_LAST_KEYSTORE" --password-file "$_CAST_LAST_PASSFILE" 2>&1); then
    echo "$out" >&2
    echo "cast_send_ok: submission failed or is ambiguous; not resubmitting. Reconcile pending/mined transactions before retrying setup." >&2
    return 1
  fi
  echo "$out"
  tx=$(echo "$out" | awk '/^[[:space:]]*transactionHash[[:space:]]/ {print $2; exit}')
  if [ -z "$tx" ] || [ "${#tx}" -ne 66 ] || [ "${tx#0x}" = "$tx" ]; then
    echo "cast_send_ok: could not parse top-level transactionHash from cast output (got: ${tx:-empty})" >&2
    return 1
  fi
  if ! receipt=$(env -u ETH_PRIVATE_KEY cast receipt "$tx" --rpc-url "$CHAIN_API_URL"); then
    echo "cast_send_ok: could not confirm receipt for $tx; not resubmitting" >&2
    return 1
  fi
  st=$(echo "$receipt" | awk '/^status[[:space:]]+/ {print $2; exit}')
  if [ "$st" != "1" ]; then
    echo "cast_send_ok: transaction reverted on-chain (status=$st): $tx" >&2
    echo "If this was stake(), fix that before increaseAuthorization -- otherwise you see \"Not authorizer\"." >&2
    return 1
  fi
  return 0
}

#!/usr/bin/env node
// Wallet helpers for operator setup scripts.
//
// Reads the private key from $ETH_PRIVATE_KEY (env, never argv) so signing
// keys do not appear in /proc/<pid>/cmdline or `ps auxww` output. Used by
// scripts/lib/cast-helpers.sh to materialize an ephemeral v3 keystore that
// `cast send --keystore` consumes in place of `--private-key`.
//
//   address                       Print the checksum address derived from the
//                                 key on stdout.
//   import <pwd-file> <ks-out>    Encrypt the key under the password read from
//                                 <pwd-file> and write a v3 keystore JSON to
//                                 <ks-out>. Print the address on stdout.

const fs = require("fs")
const path = require("path")

let ethers
try {
  ethers = require("ethers")
} catch (_) {
  console.error(
    "wallet.js: cannot load 'ethers' — run `yarn install` from the repo root first."
  )
  process.exit(1)
}

function readKeyOrDie() {
  const k = process.env.ETH_PRIVATE_KEY
  if (!k) {
    console.error("wallet.js: ETH_PRIVATE_KEY is unset or empty")
    process.exit(1)
  }
  return k.startsWith("0x") ? k : `0x${k}`
}

async function cmdAddress() {
  const wallet = new ethers.Wallet(readKeyOrDie())
  console.log(wallet.address)
}

async function cmdImport(pwdFile, ksOut) {
  if (!pwdFile || !ksOut) {
    console.error("Usage: wallet.js import <password-file> <keystore-output>")
    process.exit(1)
  }
  const password = fs.readFileSync(pwdFile, "utf8").replace(/\s+$/g, "")
  if (!password) {
    console.error("wallet.js: password file is empty")
    process.exit(1)
  }
  const wallet = new ethers.Wallet(readKeyOrDie())
  // Lower scrypt cost — keystore is process-local, lives in $TMPDIR with
  // mode 600, removed on shell EXIT. Threat model is process argv exposure,
  // not offline dictionary attack on a leaked keystore.
  const raw = await wallet.encrypt(password, { scrypt: { N: 1 << 13 } })
  // ethers v5 serialises the secret-storage payload under "Crypto"; Foundry
  // (cast/forge) follows the EIP-2335 / Web3 Secret Storage spec and only
  // accepts lower-case "crypto". Rewrite before persisting.
  const obj = JSON.parse(raw)
  if (obj.Crypto && !obj.crypto) {
    obj.crypto = obj.Crypto
    delete obj.Crypto
  }
  fs.mkdirSync(path.dirname(ksOut), { recursive: true })
  fs.writeFileSync(ksOut, JSON.stringify(obj), { mode: 0o600 })
  console.log(wallet.address)
}

async function main() {
  const cmd = process.argv[2]
  if (cmd === "address") {
    await cmdAddress()
  } else if (cmd === "import") {
    await cmdImport(process.argv[3], process.argv[4])
  } else {
    console.error("Usage: wallet.js {address | import <pwd-file> <ks-out>}")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(`wallet.js: ${e && e.message ? e.message : e}`)
  process.exit(1)
})

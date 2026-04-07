#!/usr/bin/env node
/**
 * Create a new encrypted keystore for keep-client SPV maintainer (separate from operators).
 * Writes to solidity-contracts/spv-maintainer-keystore/ (gitignored).
 *
 * Usage: node scripts/create-spv-maintainer-keystore.js <password>
 *
 * Prints one line: ABS_PATH|0xADDRESS (for bash IFS='|' read)
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const password = process.argv[2] || "";

async function main() {
  if (!password) {
    console.error("Usage: node scripts/create-spv-maintainer-keystore.js <password>");
    process.exit(1);
  }
  const wallet = ethers.Wallet.createRandom();
  const encrypted = await wallet.encrypt(password);

  const dir = path.join(__dirname, "../spv-maintainer-keystore");
  const filename = "spv-" + wallet.address.toLowerCase().slice(2, 10) + "-maintainer";
  const filepath = path.join(dir, filename);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filepath, encrypted);

  process.stdout.write(filepath + "|" + wallet.address + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

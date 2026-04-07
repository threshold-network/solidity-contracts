#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const password = process.argv[2] || "";

async function main() {
  const wallet = ethers.Wallet.createRandom();
  const encrypted = await wallet.encrypt(password);

  const dir = path.join(__dirname, "../operator-1-keystore");
  const filename = wallet.address.toLowerCase().slice(2, 10) + "-new-operator";
  const filepath = path.join(dir, filename);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filepath, encrypted);

  console.log("Address:", wallet.address);
  console.log("Private key:", wallet.privateKey);
  console.log("Keystore saved to:", filepath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

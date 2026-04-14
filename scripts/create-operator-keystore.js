#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const password = process.argv[2];
if (!password) {
  console.error("Usage: node create-operator-keystore.js <password>");
  console.error("A non-empty password is required to encrypt the keystore.");
  process.exit(1);
}

async function main() {
  try {
    const wallet = ethers.Wallet.createRandom();
    const encrypted = await wallet.encrypt(password);

    const dir = path.join(__dirname, "../operator-1-keystore");
    const filename = wallet.address.toLowerCase().slice(2, 10) + "-new-operator";
    const filepath = path.join(dir, filename);

    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filepath, encrypted);

    console.log("Address:", wallet.address);
    console.log("Keystore saved to:", filepath);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();

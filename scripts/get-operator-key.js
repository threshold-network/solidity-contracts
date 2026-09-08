#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

if (!process.argv[2]) {
  console.error("Usage: node get-operator-key.js <keystore-path> [password]");
  console.error("       node get-operator-key.js --list");
  process.exit(1);
}

const keystorePath = process.argv[2];
const password = process.argv[3] || "";

async function main() {
  try {
    if (keystorePath === "--list") {
      const dir = path.join(__dirname, "../operator-1-keystore");
      const files = (await fs.promises.readdir(dir)).filter(
        (f) => !f.startsWith(".") && f.length > 10
      );
      for (const file of files) {
        try {
          const content = await fs.promises.readFile(
            path.join(dir, file),
            "utf8"
          );
          // Keystore JSON has an unencrypted "address" field -- no decryption needed.
          const parsed = JSON.parse(content);
          const addr = parsed.address
            ? `0x${parsed.address.replace(/^0x/, "")}`
            : "(no address field)";
          console.log(file, "->", addr);
        } catch (e) {
          console.log(file, "-> error:", e.message);
        }
      }
      return;
    }

    const json = await fs.promises.readFile(keystorePath, "utf8");
    const wallet = await ethers.Wallet.fromEncryptedJson(json, password);
    console.log("Address:", wallet.address);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();

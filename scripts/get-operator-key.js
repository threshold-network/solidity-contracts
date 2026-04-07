#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const keystorePath = process.argv[2] || path.join(__dirname, "../operator-1-keystore/c88df450-36e6-473e-908a-3349242f463e");
const password = process.argv[3] || "";

// If --list, show addresses for all keystores in operator-1-keystore
if (process.argv[2] === "--list") {
  const dir = path.join(__dirname, "../../operator-1-keystore");
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith(".") && f.length > 10);
  for (const file of files) {
    try {
      let content = fs.readFileSync(path.join(dir, file), "utf8");
      const json = content.split("\n")[0]; // some files have extra content
      if (json.startsWith("{")) {
        const wallet = ethers.Wallet.fromEncryptedJsonSync(json, "");
        console.log(file, "->", wallet.address);
      }
    } catch (e) {
      console.log(file, "-> error:", e.message);
    }
  }
  process.exit(0);
}

const json = fs.readFileSync(keystorePath, "utf8");
const wallet = ethers.Wallet.fromEncryptedJsonSync(json, password);
console.log("Address:", wallet.address);
console.log("Private key:", wallet.privateKey);

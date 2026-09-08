// Pack the prebuilt publication and exercise it in an independent runtime.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

const major = process.argv[2]
if (!["5", "6"].includes(major))
  throw new Error("Usage: node prepare.js 5|6 [directory]")
const directory = path.resolve(
  process.argv[3] ||
    fs.mkdtempSync(path.join(os.tmpdir(), `threshold-deploy-v${major}-`))
)
fs.mkdirSync(directory, { recursive: true })
for (const name of ["hardhat.config.js", "smoke.js", "contracts"]) {
  fs.cpSync(path.join(__dirname, name), path.join(directory, name), {
    recursive: true,
  })
}
const packed = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
    {
      cwd: path.join(__dirname, "../.."),
      encoding: "utf8",
    }
  )
)[0]
const dependencies = {
  hardhat: "2.29.0",
  "hardhat-deploy": major === "5" ? "0.11.45" : "1.0.4",
  ethers: major === "5" ? "5.8.0" : "6.17.0",
  "@keep-network/hardhat-helpers": major === "5" ? "0.6.0-pre.15" : "0.7.2",
  "@openzeppelin/hardhat-upgrades": major === "5" ? "1.28.0" : "2.5.1",
  "@threshold-network/solidity-contracts": `file:./${packed.filename}`,
  "fs-extra": "11.2.0",
  ...(major === "5"
    ? {
        "@nomiclabs/hardhat-ethers": "2.2.3",
        "@nomiclabs/hardhat-etherscan": "3.1.8",
      }
    : {
        "@nomicfoundation/hardhat-ethers": "3.1.0",
        "@nomicfoundation/hardhat-verify": "2.1.3",
        "@nomicfoundation/hardhat-network-helpers": "1.1.2",
      }),
}
fs.writeFileSync(
  path.join(directory, "package.json"),
  JSON.stringify(
    {
      name: `threshold-deploy-consumer-v${major}`,
      private: true,
      dependencies,
    },
    null,
    2
  )
)
// helpers 0.7 advertises upgrades 3; deliberately cover the consumer's upgrades
// 2.x stack too. These scripts use HRE upgrades directly, not helpers.deployProxy.
execFileSync(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--legacy-peer-deps",
    "--no-audit",
    "--no-fund",
  ],
  { cwd: directory, stdio: "inherit" }
)
for (const mode of ["direct", "proxy"]) {
  execFileSync("npx", ["--no-install", "hardhat", "run", "smoke.js"], {
    cwd: directory,
    stdio: "inherit",
    env: { ...process.env, DEPLOY_CONSUMER_MODE: mode },
  })
}

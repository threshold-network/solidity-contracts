const path = require("path")
const major = require("ethers").version.split(".")[0]
require(major === "6"
  ? "@nomicfoundation/hardhat-ethers"
  : "@nomiclabs/hardhat-ethers")
require("hardhat-deploy")
require("@keep-network/hardhat-helpers")

module.exports = {
  solidity: {
    version: "0.8.9",
    settings: { optimizer: { enabled: true, runs: 10 } },
  },
  networks: { hardhat: { tags: ["allowStubs"] } },
  namedAccounts: { deployer: 1, thresholdCouncil: 2 },
  external: {
    contracts: [
      {
        artifacts: path.join(
          __dirname,
          "node_modules/@threshold-network/solidity-contracts/export/artifacts"
        ),
        deploy: path.join(
          __dirname,
          "node_modules/@threshold-network/solidity-contracts/export/deploy"
        ),
      },
    ],
  },
}

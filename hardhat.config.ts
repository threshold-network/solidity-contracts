import { HardhatUserConfig } from "hardhat/config"

import "@nomiclabs/hardhat-etherscan"
import "@keep-network/hardhat-helpers"
import "@nomiclabs/hardhat-waffle"
import "@openzeppelin/hardhat-upgrades"
import "@tenderly/hardhat-tenderly"

import "hardhat-contract-sizer"
import "hardhat-deploy"
import "hardhat-gas-reporter"

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10,
          },
        },
      },
    ],
  },
  paths: {
    artifacts: "./build",
  },
  networks: {
    hardhat: {
      forking: {
        // forking is enabled only if FORKING_URL env is provided
        enabled: !!process.env.FORKING_URL,
        // URL should point to a node with archival data (Alchemy recommended)
        url: process.env.FORKING_URL || "",
        // latest block is taken if FORKING_BLOCK env is not provided
        blockNumber: process.env.FORKING_BLOCK
          ? parseInt(process.env.FORKING_BLOCK)
          : undefined,
      },
      tags: ["allowStubs"],
    },
    development: {
      url: "http://localhost:8545",
      chainId: 1101,
      tags: ["allowStubs"],
    },
    goerli: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 5,
      accounts: process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
        ? [
            process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY,
            process.env.KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY,
          ]
        : undefined,
      tags: ["etherscan", "tenderly"],
    },
    mainnet: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 1,
      accounts: process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
        ? [process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY]
        : undefined,
      tags: ["etherscan", "tenderly"],
    },
  },
  tenderly: {
    username: "thesis",
    project: "thesis/threshold-network",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  external: {
    contracts: [
      {
        // Due to a limitation of `hardhat-deploy` plugin, we have
        // to modify the artifacts imported from NPM. Please see
        // `scripts/prepare-dependencies.sh` for details.
        artifacts: "external/npm/@keep-network/keep-core/artifacts",
        // Example if we want to use deployment scripts from external package:
        // deploy: "node_modules/@keep-network/keep-core/deploy",
      },
    ],
    deployments: {
      // For hardhat environment we can fork the mainnet, so we need to point it
      // to the contract artifacts.
      hardhat: process.env.FORKING_URL ? ["./external/mainnet"] : [],
      // For development environment we expect the local dependencies to be linked
      // with `yarn link` command, uncomment the line below to use the linked
      // dependencies.
      // development: ["external/npm/@keep-network/keep-core/artifacts"],
      goerli: ["external/npm/@keep-network/keep-core/artifacts"],
      mainnet: ["./external/mainnet"],
    },
  },
  namedAccounts: {
    deployer: {
      default: 1, // take the first account as deployer
      goerli: 0,
      // mainnet: "0x123694886DBf5Ac94DDA07135349534536D14cAf",
    },
    thresholdCouncil: {
      mainnet: "0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f",
    },
    keepRegistryKeeper: {
      default: 1, // same as the deployer
      goerli: "0x68ad60CC5e8f3B7cC53beaB321cf0e6036962dBc",
    },
  },
  mocha: {
    timeout: 60000,
  },
}

export default config

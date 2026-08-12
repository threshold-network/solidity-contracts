import { extendEnvironment, HardhatUserConfig } from "hardhat/config"
import { lazyObject } from "hardhat/plugins"

import "@keep-network/hardhat-helpers"
import "@nomiclabs/hardhat-ethers"
import "@nomicfoundation/hardhat-chai-matchers"
import "@openzeppelin/hardhat-upgrades"
import { Tenderly } from "@tenderly/hardhat-tenderly/dist/Tenderly"
import "@tenderly/hardhat-tenderly/dist/type-extensions"

import "hardhat-contract-sizer"
import "hardhat-deploy"
import "hardhat-gas-reporter"
import "solidity-docgen"

// Tenderly 1.8's public setup() registers one module-scope extendEnvironment
// (which fetches the network catalog via populateNetworks() on every hardhat
// command) plus one extendConfig, and separately registers tenderly:push /
// tenderly:verify tasks. This adapter imports Tenderly/type-extensions
// directly to skip setup() and avoid that network call; only hre.tenderly is
// used by deploy/*.ts. Revalidate against dist/tenderly/extender.js before
// changing the pin.
extendEnvironment((hre) => {
  hre.tenderly = lazyObject(() => new Tenderly(hre))
})

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
    sepolia: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 11155111,
      accounts: process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
        ? [
            process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY,
            process.env.KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY, // TODO: verify if we have different owner here or can we remove this
          ]
        : undefined,
      tags: ["tenderly"],
    },
    mainnet: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 1,
      accounts: process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
        ? [process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY]
        : undefined,
      tags: ["tenderly"],
    },
  },
  tenderly: {
    username: "thesis",
    project: "thesis/threshold-network",
  },
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
  },
  external: {
    deployments: {
      // For hardhat environment we can fork the mainnet, so we need to point it
      // to the contract artifacts.
      hardhat: process.env.FORKING_URL ? ["./external/mainnet"] : [],
      mainnet: ["./external/mainnet"],
    },
  },
  namedAccounts: {
    deployer: {
      default: 1, // take the first account as deployer
      sepolia: 0,
      // mainnet: "0x123694886DBf5Ac94DDA07135349534536D14cAf",
    },
    thresholdCouncil: {
      mainnet: "0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f",
    },
  },
  mocha: {
    timeout: 60000,
  },
  gasReporter: {
    // Off by default: hardhat-gas-reporter v2 pulls in a second EVM client
    // stack (viem) and network-capable HTTP client, so keep it opt-in.
    enabled: !!process.env.REPORT_GAS,
  },
  docgen: {
    outputDir: "generated-docs",
    templates: "docgen-templates",
    pages: "files", // `single`, `items` or `files`
    exclude: ["./test"],
  },
}

export default config

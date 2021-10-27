import { HardhatUserConfig } from "hardhat/config"

import "@keep-network/hardhat-helpers"
import "@keep-network/hardhat-local-networks-config"
import "@nomiclabs/hardhat-waffle"
// import "@nomiclabs/hardhat-ethers"
import "hardhat-gas-reporter"
import "hardhat-deploy"
// import "solidity-coverage"
import "@tenderly/hardhat-tenderly"

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.4",
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
      tags: ["local"],
    },
    development: {
      url: "http://localhost:8545",
      chainId: 1101,
      tags: ["local"],
    },
    ropsten: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 3,
      accounts: process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
        ? [process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY]
        : undefined,
      tags: ["tenderly"],
    },
  },
  tenderly: {
    username: "thesis",
    project: "",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  // // Define local networks configuration file path to load networks from the file.
  // localNetworksConfig: "./.hardhat/networks.ts",
  external: {
    contracts: [
      {
        artifacts: "node_modules/@keep-network/keep-core/artifacts",
        // Example if we want to use deployment scripts from external package:
        // deploy: "node_modules/@keep-network/keep-core/deploy",
      },
      {
        artifacts: "node_modules/@keep-network/tbtc/artifacts",
      },
    ],
    deployments: {
      // For hardhat environment we can fork the mainnet, so we need to point it
      // to the contract artifacts.
      // hardhat: ["./external/mainnet"],
      // For development environment we expect the local dependencies to be linked
      // with `yarn link` command.
      development: [
        "node_modules/@keep-network/keep-core/artifacts",
        "node_modules/@keep-network/tbtc/artifacts",
      ],
      ropsten: [
        "node_modules/@keep-network/keep-core/artifacts",
        "node_modules/@keep-network/tbtc/artifacts",
        "./external/ropsten",
      ],
      mainnet: ["./external/mainnet"],
    },
  },
  namedAccounts: {
    deployer: {
      default: 0, // take the first account as deployer
    },
    // rewardManager: {
    //   default: 1,
    //   ropsten: 0, // use deployer account
    //   mainnet: 0, // use deployer account
    // },
    // keepCommunityMultiSig: {
    //   mainnet: "0x19FcB32347ff4656E4E6746b4584192D185d640d",
    // },
  },
  // mocha: {
  //   timeout: 30000,
  // },
}

export default config

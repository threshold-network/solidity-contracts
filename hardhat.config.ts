import { HardhatUserConfig } from "hardhat/config"

import "@keep-network/hardhat-helpers"
import "@keep-network/hardhat-local-networks-config"
import "@nomiclabs/hardhat-waffle"
import "@openzeppelin/hardhat-upgrades"
import "@tenderly/hardhat-tenderly"
import 'hardhat-dependency-compiler'

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
      accounts: {
        accountsBalance: "1000000000000000000000000"
      },
      tags: ["local"],
    },
    development: {
      url: "http://localhost:8545",
      chainId: 1101,
      tags: ["local"],
    },
    rinkeby: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 4,
      accounts: process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
        ? [process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY]
        : undefined,
      tags: ["tenderly"],
    },
    ropsten: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 3,
      accounts: process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
        ? [
            process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY,
            process.env.KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY,
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
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  // // Define local networks configuration file path to load networks from the file.
  // localNetworksConfig: "./.hardhat/networks.ts",
  external: {
    contracts: [
      {
        // Due to a limitation of `hardhat-deploy` plugin limitation, we have
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
      // with `yarn link` command.
      development: ["external/npm/@keep-network/keep-core/artifacts"],
      ropsten: ["external/npm/@keep-network/keep-core/artifacts"],
      mainnet: ["./external/mainnet"],
    },
  },
  namedAccounts: {
    deployer: {
      default: 0, // take the first account as deployer
      // mainnet: "0x123694886DBf5Ac94DDA07135349534536D14cAf",
    },
    thresholdCouncil: {
      mainnet: "0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f",
    },
    keepDeployer: {
      default: 0,
      ropsten: "0x923C5Dbf353e99394A21Aa7B67F3327Ca111C67D",
    },
  },
  mocha: {
    timeout: 60000,
  },
  dependencyCompiler: {
    // These contracts will be compiled and added to HardHat artifacts, avoiding
    // the need to add them in contracts folder.
    paths: [
      '@nucypher/nucypher-contracts/contracts/contracts/NuCypherToken.sol',
      '@nucypher/nucypher-contracts/contracts/contracts/StakingEscrow.sol',
      '@nucypher/nucypher-contracts/contracts/contracts/WorkLock.sol',
      '@nucypher/nucypher-contracts/contracts/contracts/proxy/Dispatcher.sol',
    ],
  },
}

export default config

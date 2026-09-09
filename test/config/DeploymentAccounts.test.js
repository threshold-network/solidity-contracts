const { expect } = require("chai")
const { spawnSync } = require("child_process")
const path = require("path")

// Synthetic keys used only to load configuration; no provider is contacted.
const deployerKey = `0x${"11".repeat(32)}`
const keepKey = `0x${"22".repeat(32)}`
const projectRoot = path.resolve(__dirname, "../..")

// Validate the real configuration without initializing providers or HRE plugins.
function loadConfiguration(network, keys = {}) {
  return spawnSync(
    process.execPath,
    [
      "-r",
      "ts-node/register",
      "-e",
      `const { HardhatContext } = require("hardhat/internal/context");
       HardhatContext.createHardhatContext();
       const { loadConfigAndTasks } = require("hardhat/internal/core/config/config-loading");
       const { resolvedConfig } = loadConfigAndTasks({ network: process.env.HARDHAT_NETWORK });
       console.log(JSON.stringify({
         mainnet: resolvedConfig.networks.mainnet.accounts,
         sepolia: resolvedConfig.networks.sepolia.accounts
       }));`,
    ],
    {
      cwd: projectRoot,
      env: Object.assign(
        {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          HARDHAT_NETWORK: network,
          CHAIN_API_URL: "http://127.0.0.1:1",
        },
        keys
      ),
      encoding: "utf8",
      timeout: 20000,
    }
  )
}

function expectConfiguration(network, keys, accounts) {
  const result = loadConfiguration(network, keys)
  expect(result.error).to.equal(undefined)
  expect(result.status, result.stderr).to.equal(0)
  expect(JSON.parse(result.stdout)).to.deep.equal(accounts)
}

describe("Deployment account configuration", () => {
  for (const network of ["mainnet", "sepolia"]) {
    it(`loads ${network} with only the deployment key`, () => {
      expectConfiguration(
        network,
        { CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: deployerKey },
        { mainnet: [deployerKey], sepolia: [deployerKey] }
      )
    })
  }

  it("preserves deployment and legacy Keep account order when both are set", () => {
    expectConfiguration(
      "sepolia",
      {
        CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: deployerKey,
        KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: keepKey,
      },
      { mainnet: [deployerKey], sepolia: [deployerKey, keepKey] }
    )
  })

  it("treats an empty legacy Keep key as absent", () => {
    expectConfiguration(
      "sepolia",
      {
        CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: deployerKey,
        KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: "",
      },
      { mainnet: [deployerKey], sepolia: [deployerKey] }
    )
  })

  it("retains RPC-managed accounts when neither key is set", () => {
    expectConfiguration("mainnet", {}, { mainnet: "remote", sepolia: "remote" })
  })

  it("does not promote a legacy Keep key to the deployment account", () => {
    expectConfiguration(
      "sepolia",
      { KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: keepKey },
      { mainnet: "remote", sepolia: "remote" }
    )
  })

  it("still rejects a malformed legacy Keep key when supplied", () => {
    const result = loadConfiguration("sepolia", {
      CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: deployerKey,
      KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: "invalid-test-key",
    })
    expect(result.error).to.equal(undefined)
    expect(result.status).not.to.equal(0)
    expect(result.stderr).to.include("Invalid account: #1 for network: sepolia")
  })
})

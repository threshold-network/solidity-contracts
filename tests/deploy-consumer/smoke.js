const assert = require("assert/strict")
const fs = require("fs")
const path = require("path")
const hre = require("hardhat")
const root = path.dirname(
  require.resolve("@threshold-network/solidity-contracts/package.json")
)
const script = (file) => require(path.join(root, "export/deploy", file)).default
const target = BigInt("4500000000000000000000000000")
const sameAddress = (actual, expected) =>
  assert.equal(actual.toLowerCase(), expected.toLowerCase())

async function main() {
  const { deployments, getNamedAccounts, network, upgrades, ethers } = hre
  // Exercise the mainnet-only proxy and ownership scripts on the local in-memory
  // provider. No RPC URL or live-network credentials are used by this fixture.
  const proxyMode = process.env.DEPLOY_CONSUMER_MODE === "proxy"
  if (proxyMode) network.name = "mainnet"
  const { deployer, thresholdCouncil } = await getNamedAccounts()
  const address = async (name) => (await deployments.get(name)).address
  const read = (name, method, ...args) =>
    deployments.read(name, method, ...args)
  const nonces = () =>
    Promise.all(
      [deployer, thresholdCouncil].map((account) =>
        network.provider.send("eth_getTransactionCount", [account, "latest"])
      )
    )
  const options = {
    resetMemory: false,
    deletePreviousDeployments: false,
    writeDeploymentsToFiles: true,
  }
  await deployments.run(undefined, {
    ...options,
    resetMemory: true,
    deletePreviousDeployments: true,
  })

  const machine = await address("VendingMachineNuCypher")
  const staking = await address("TokenStaking")
  const governor = await address("TokenholderGovernor")
  const proposerRole = await read("TokenholderTimelock", "PROPOSER_ROLE")
  const adminRole = await read("TokenholderTimelock", "TIMELOCK_ADMIN_ROLE")
  assert.equal(
    (await read("T", "balanceOf", machine)).toString(),
    target.toString()
  )
  assert(await read("TokenholderTimelock", "hasRole", proposerRole, governor))
  assert.equal(
    await read("TokenholderTimelock", "hasRole", adminRole, deployer),
    false
  )
  sameAddress(
    await read("TokenStaking", "governance"),
    proxyMode ? thresholdCouncil : deployer
  )
  if (proxyMode) {
    const adminAddress = await upgrades.erc1967.getAdminAddress(staking)
    const admin = await ethers.getContractAt(
      ["function owner() view returns (address)"],
      adminAddress
    )
    sameAddress(await admin.owner(), thresholdCouncil)
    sameAddress(await read("T", "owner"), thresholdCouncil)
    const standalone = JSON.parse(fs.readFileSync("TokenStaking.json"))
    sameAddress(standalone.address, staking)
    assert(Array.isArray(standalone.abi))
  }
  const before = await nonces()
  const addressesBefore = Object.fromEntries(
    Object.entries(await deployments.all()).map(([name, deployment]) => [
      name,
      deployment.address,
    ])
  )
  fs.rmSync(
    path.join(hre.config.paths.deployments, network.name, ".migrations.json"),
    { force: true }
  )
  await deployments.run(undefined, options)
  assert.deepEqual(await nonces(), before, "replay sent transactions")
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(await deployments.all()).map(([name, deployment]) => [
        name,
        deployment.address,
      ])
    ),
    addressesBefore
  )

  // Check transfer shortfalls/overfunding at the exported script's I/O boundary.
  // Bigints ensure amounts stay exact even beyond JavaScript's safe integers.
  const transfer = script("05_transfer_t.js")
  let transferred = null
  const context = (balance, available) => ({
    ...hre,
    deployments: {
      ...deployments,
      read: async (_name, _method, account) =>
        (account === machine ? balance : available).toString(),
      execute: async (_name, _options, method, recipient, amount) => {
        assert.equal(method, "transfer")
        sameAddress(recipient, machine)
        transferred = amount.toString()
      },
    },
  })
  await transfer(context(target - BigInt(17), BigInt(17)))
  assert.equal(transferred, "17")
  transferred = null
  await transfer(context(target + BigInt(1), BigInt(0)))
  assert.equal(transferred, null)
  await assert.rejects(
    transfer(context(target - BigInt(17), BigInt(16))),
    /deployer only has/
  )

  // Recover a direct deployment interrupted before initialize().
  if (!proxyMode) {
    const uninitialized = await deployments.deploy(
      "UninitializedTokenStaking",
      {
        contract: "TokenStaking",
        from: deployer,
        args: [await address("T")],
      }
    )
    await deployments.save("TokenStaking", uninitialized)
    await script("07_deploy_token_staking.js")(hre)
    sameAddress(await read("TokenStaking", "governance"), deployer)
    const initializedNonce = await nonces()
    await script("07_deploy_token_staking.js")(hre)
    assert.deepEqual(await nonces(), initializedNonce)
  }
  console.log(
    `PASS: published exports, ethers ${require("ethers").version}, ${
      proxyMode ? "proxy + ownership handoff" : "direct"
    }, fresh deploy + replay + transfer guards`
  )
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(
      (error.stack || String(error))
        .split("\n")
        .slice(0, 12)
        .map((line) => line.slice(0, 400))
        .join("\n")
    )
    process.exit(1)
  }
)

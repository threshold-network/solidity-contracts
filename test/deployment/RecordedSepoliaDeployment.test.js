const { expect } = require("chai")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

const root = path.resolve(__dirname, "../..")

describe("Recorded Sepolia staking deployment", function () {
  // Each entrypoint runs with a fresh copy of the shipped network manifest.
  // eslint-disable-next-line no-invalid-this
  this.timeout(60000)

  for (const entrypoint of ["deployment", "standalone", "reject-base"]) {
    it(`uses the recorded fixture history for ${entrypoint}`, () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "sepolia-history-")
      )
      try {
        fs.symlinkSync(
          path.join(root, "node_modules"),
          path.join(directory, "node_modules"),
          "dir"
        )
        fs.mkdirSync(path.join(directory, ".openzeppelin"))
        // Only the filename changes for the local chain ID. No history is generated.
        fs.copyFileSync(
          path.join(root, ".openzeppelin/unknown-11155111.json"),
          path.join(directory, ".openzeppelin/unknown-31337.json")
        )
        fs.writeFileSync(
          path.join(directory, "package.json"),
          '{"name":"sepolia-history-test","private":true}'
        )
        fs.writeFileSync(
          path.join(directory, "hardhat.config.js"),
          `
require("ts-node").register({ project: ${JSON.stringify(
            path.join(root, "tsconfig.json")
          )}, files: true })
require("@nomiclabs/hardhat-ethers")
require("@keep-network/hardhat-helpers")
require("@openzeppelin/hardhat-upgrades")
require("hardhat-deploy")
module.exports = { solidity: "0.8.9", paths: { artifacts: ${JSON.stringify(
            path.join(root, "build")
          )} } }
`
        )
        fs.writeFileSync(path.join(directory, "check.js"), check)
        const output = execFileSync(
          process.execPath,
          [
            path.join(directory, "node_modules/hardhat/internal/cli/cli.js"),
            "run",
            "--no-compile",
            "check.js",
          ],
          {
            cwd: directory,
            env: Object.assign({}, process.env, {
              STAKING_ROOT: root,
              STAKING_ENTRYPOINT: entrypoint,
            }),
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
          }
        )
        expect(output).to.include("Recorded Sepolia history checks passed")
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    })
  }
})

const check = `
const assert = require("assert")
const path = require("path")
const hre = require("hardhat")
const root = process.env.STAKING_ROOT
const recorded = require(path.join(root, "test/fixtures/recorded-sepolia-staking.json"))
const deployment = require(path.join(root, "deployments/sepolia/TokenStaking.json"))
const upgrade = require(path.join(root, "deploy/54_upgrade_token_staking_extended")).default
const { stakingContractFactory } = require(path.join(root, "scripts/staking-artifacts"))
const { Manifest } = require("@openzeppelin/upgrades-core")

async function main() {
  const [owner, provider, beneficiary, authorizer, application] = await hre.ethers.getSigners()
  const { utils } = hre.ethers
  const word = value => utils.hexZeroPad(value, 32)
  const slot = name => utils.hexZeroPad(utils.hexlify(BigInt(utils.id(name)) - 1n), 32)
  // The snapshot is code and addresses only. All storage and transactions below
  // belong to this in-process Hardhat network; no public RPC is configured.
  for (const [address, code] of [
    [recorded.proxy, recorded.proxyCode],
    [recorded.implementation, recorded.implementationCode],
    [recorded.admin, recorded.adminCode],
  ]) await hre.network.provider.send("hardhat_setCode", [address, code])
  await hre.network.provider.send("hardhat_setStorageAt", [recorded.proxy, slot("eip1967.proxy.implementation"), word(recorded.implementation)])
  await hre.network.provider.send("hardhat_setStorageAt", [recorded.proxy, slot("eip1967.proxy.admin"), word(recorded.admin)])
  await hre.network.provider.send("hardhat_setStorageAt", [recorded.admin, "0x0", word(owner.address)])
  assert.strictEqual(utils.keccak256(recorded.implementationCode), recorded.runtimeHash)
  assert.strictEqual(deployment.address, recorded.proxy)

  const deployedToken = await (await hre.ethers.getContractFactory("T")).deploy()
  await deployedToken.deployed()
  await hre.network.provider.send("hardhat_setCode", [recorded.token, await hre.ethers.provider.getCode(deployedToken.address)])
  await hre.network.provider.send("hardhat_setStorageAt", [recorded.token, "0x0", word(owner.address)])
  const token = await hre.ethers.getContractAt("T", recorded.token)
  await token.mint(owner.address, 1000)
  const staking = await hre.ethers.getContractAt(deployment.abi, recorded.proxy)
  await staking.initialize()
  await staking.setMinimumStakeAmount(42)
  await token.approve(recorded.proxy, 100)
  await staking.stake(provider.address, beneficiary.address, authorizer.address, 100)
  await staking.approveApplication(application.address)
  await staking.setAuthorization(provider.address, application.address, 75)
  await staking.setAuthorizedApplications(provider.address, [application.address])
  await staking.addToSkipList(application.address)
  const skipSlot = utils.keccak256(utils.defaultAbiCoder.encode(["address", "uint256"], [application.address, 62]))
  const skipValue = await hre.ethers.provider.getStorageAt(recorded.proxy, skipSlot)
  assert.strictEqual(BigInt(skipValue), 1n)

  await hre.deployments.save("T", { address: recorded.token, abi: (await hre.artifacts.readArtifact("T")).abi })
  await hre.deployments.save("TokenStaking", { ...deployment, linkedData: { retained: true } })
  hre.getNamedAccounts = async () => ({ deployer: owner.address })
  hre.network.name = "sepolia"
  const nonce = await owner.getTransactionCount()
  if (process.env.STAKING_ENTRYPOINT === "reject-base") {
    const { factory } = await stakingContractFactory(hre, "TokenStaking", owner.address)
    await assert.rejects(hre.upgrades.upgradeProxy(recorded.proxy, factory, { constructorArgs: [recorded.token], kind: "transparent" }), /Deleted.*skipList/s)
    assert.strictEqual(await owner.getTransactionCount(), nonce)
    assert.strictEqual(await hre.upgrades.erc1967.getImplementationAddress(recorded.proxy), recorded.implementation)
  } else {
    if (process.env.STAKING_ENTRYPOINT === "standalone") {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Standalone upgrade did not complete")), 15000)
        hre.deployments.log = message => {
          if (message.startsWith("Upgraded TokenStaking")) { clearTimeout(timer); resolve() }
        }
        require(path.join(root, "scripts/upgrade-token-staking"))
      })
    } else {
      await upgrade(hre)
    }
    const updated = await hre.deployments.get("TokenStaking")
    const safe = await hre.ethers.getContractAt(updated.abi, recorded.proxy)
    assert.strictEqual(updated.address, recorded.proxy)
    assert.deepStrictEqual(updated.linkedData, { retained: true })
    assert.notStrictEqual(updated.implementation, recorded.implementation)
    assert.strictEqual(await safe.governance(), owner.address)
    assert.strictEqual((await safe.minTStakeAmount()).toString(), "42")
    assert.strictEqual((await safe.stakeAmount(provider.address)).toString(), "100")
    const roles = await safe.rolesOf(provider.address)
    assert.deepStrictEqual(Array.from(roles), [owner.address, beneficiary.address, authorizer.address])
    assert.strictEqual((await safe.authorizedStake(provider.address, application.address)).toString(), "75")
    assert.strictEqual(await hre.ethers.provider.getStorageAt(recorded.proxy, skipSlot), skipValue)
    assert.strictEqual((await token.balanceOf(recorded.proxy)).toString(), "100")
    const manifest = await (await Manifest.forNetwork(hre.network.provider)).read()
    assert(manifest.proxies.some(p => p.address === recorded.proxy && p.kind === "transparent"))
    assert.strictEqual(manifest.impls[recorded.implementationVersion].address, recorded.implementation)
  }
  console.log("Recorded Sepolia history checks passed")
}
main().catch(error => { console.error(error); process.exitCode = 1 })
`

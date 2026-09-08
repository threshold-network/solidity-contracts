const { expect } = require("chai")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

const root = path.resolve(__dirname, "../..")

describe("Packaged staking deployments", function () {
  // Compilation and packing exercise the actual consumer distribution.
  // eslint-disable-next-line no-invalid-this
  this.timeout(180000)
  let directory
  let tarball

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "staking-package-"))
    const env = Object.assign({}, process.env, {
      npm_config_cache: path.join(directory, "npm-cache"),
    })
    execFileSync("npm", ["run", "prepack"], { cwd: root, env, stdio: "pipe" })
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--pack-destination", directory, "--json"],
        { cwd: root, env, encoding: "utf8" }
      )
    )[0]
    tarball = path.join(directory, packed.filename)
    const files = packed.files.map((file) => file.path)
    expect(files).to.include("export/scripts/staking-artifacts.js")
    expect(
      files.some((file) => file.startsWith("export/staking-build-info/"))
    ).to.equal(true)
    expect(files).not.to.include("cache/validations.json")
  })

  after(() => fs.rmSync(directory, { recursive: true, force: true }))

  for (const scenario of [
    "deploy",
    "missing-metadata",
    "mismatched-artifact",
  ]) {
    it(`supports an external-only consumer: ${scenario}`, () => {
      const consumer = path.join(directory, scenario)
      fs.mkdirSync(consumer)
      execFileSync("tar", ["-xzf", tarball, "-C", consumer])
      fs.symlinkSync(
        process.env.STAKING_CONSUMER_NODE_MODULES ||
          path.join(root, "node_modules"),
        path.join(consumer, "node_modules"),
        "dir"
      )
      fs.writeFileSync(
        path.join(consumer, "package.json"),
        '{"name":"staking-consumer","private":true}'
      )
      fs.mkdirSync(path.join(consumer, "contracts"))
      fs.writeFileSync(
        path.join(consumer, "contracts/ConsumerControl.sol"),
        "// SPDX-License-Identifier: MIT\npragma solidity 0.8.9; contract ConsumerControl { uint256 public value; }\n"
      )
      fs.writeFileSync(
        path.join(consumer, "hardhat.config.js"),
        `require("@nomiclabs/hardhat-ethers")
require("@keep-network/hardhat-helpers")
require("@openzeppelin/hardhat-upgrades")
require("hardhat-deploy")
module.exports = {
  solidity: "0.8.9",
  namedAccounts: { deployer: 0 },
  networks: { hardhat: { tags: ["allowStubs"] } },
  external: { contracts: [{
    artifacts: "package/export/artifacts",
    deploy: "package/export/deploy"
  }] }
}
`
      )
      fs.writeFileSync(path.join(consumer, "check.js"), consumerCheck)
      const result = execFileSync(
        process.execPath,
        [
          path.join(consumer, "node_modules/hardhat/internal/cli/cli.js"),
          "run",
          "check.js",
        ],
        {
          cwd: consumer,
          env: Object.assign({}, process.env, { STAKING_SCENARIO: scenario }),
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
        }
      )
      expect(result).to.include("External staking checks passed")
    })
  }
})

const consumerCheck = `
const assert = require("assert")
const fs = require("fs")
const path = require("path")
const hre = require("hardhat")
const core = require("@openzeppelin/upgrades-core")
const { readValidations } = require("@openzeppelin/hardhat-upgrades/dist/utils/validations")
const deploy = require("./package/export/deploy/07_deploy_token_staking").default
const upgrade = require("./package/export/deploy/54_upgrade_token_staking_extended").default

async function main() {
  const [owner] = await hre.ethers.getSigners()
  // The provider is already the in-process Hardhat network. Only the deployment
  // selector changes; these tests cannot send to a public network.
  hre.network.name = "sepolia"
  for (const name of ["TokenStaking", "SepoliaTokenStaking"]) {
    await assert.rejects(hre.artifacts.readArtifact(name), /HH700/)
    await assert.rejects(hre.ethers.getContractFactory(name), /HH700/)
  }
  const control = await hre.artifacts.readArtifact("ConsumerControl")
  core.getContractNameAndRunValidation(await readValidations(hre), core.getVersion(control.bytecode))
  const bundle = path.resolve("package/export/staking-build-info")
  const scenario = process.env.STAKING_SCENARIO

  if (scenario === "missing-metadata") {
    await hre.run("deploy", { tags: "T", write: false })
    await hre.deployments.execute("T", { from: owner.address }, "mint", owner.address, 1000)
    fs.renameSync(bundle, bundle + ".saved")
    const nonce = await owner.getTransactionCount()
    await assert.rejects(deploy(hre), /Missing matching compiler build info/)
    assert.strictEqual(await owner.getTransactionCount(), nonce)
    fs.renameSync(bundle + ".saved", bundle)
  }

  await hre.run("deploy", { tags: "TokenStaking", write: false })
  const original = await hre.deployments.get("TokenStaking")
  const staking = await hre.ethers.getContractAt(original.abi, original.address)
  await staking.setMinimumStakeAmount(42)
  await hre.deployments.save("TokenStaking", { ...original, linkedData: { retained: true } })

  if (scenario !== "deploy") {
    if (scenario === "missing-metadata") {
      fs.renameSync(bundle, bundle + ".saved")
    } else {
      const { Artifacts } = require("hardhat/internal/artifacts")
      const exported = new Artifacts(path.resolve("package/export/artifacts"))
      const file = (await exported.getArtifactPaths()).find(file => path.basename(file) === "SepoliaTokenStaking.json")
      const artifact = JSON.parse(fs.readFileSync(file))
      artifact.bytecode = artifact.bytecode.slice(0, -2) + (artifact.bytecode.endsWith("00") ? "01" : "00")
      fs.writeFileSync(file, JSON.stringify(artifact))
    }
    const nonce = await owner.getTransactionCount()
    await assert.rejects(upgrade(hre), /Missing matching compiler build info/)
    assert.strictEqual(await owner.getTransactionCount(), nonce)
    assert.strictEqual((await hre.deployments.get("TokenStaking")).address, original.address)
  } else {
    await hre.run("deploy", { tags: "TokenStakingUpgrade", write: false })
    const updated = await hre.deployments.get("TokenStaking")
    assert.strictEqual(updated.address, original.address)
    assert.deepStrictEqual(updated.linkedData, { retained: true })
    assert(updated.abi.some(entry => entry.name === "stake"))
    assert(!updated.abi.some(entry => entry.name === "setAuthorization"))
    assert.strictEqual((await staking.minTStakeAmount()).toString(), "42")
    const nonce = await owner.getTransactionCount()
    await hre.run("deploy", { tags: "TokenStaking", write: false })
    assert.strictEqual(await owner.getTransactionCount(), nonce)
    await hre.run("export", { export: "export.json" })
    assert(JSON.parse(fs.readFileSync("export.json")).contracts.TokenStaking.abi.some(entry => entry.name === "stake"))
    for (const name of ["TokenStaking", "SepoliaTokenStaking"]) {
      await assert.rejects(hre.artifacts.readArtifact(name), /HH700/)
      const artifact = await hre.deployments.getArtifact(name)
      core.getContractNameAndRunValidation(await readValidations(hre), core.getVersion(artifact.bytecode))
    }
    core.getContractNameAndRunValidation(await readValidations(hre), core.getVersion(control.bytecode))
  }
  console.log("External staking checks passed")
}
main().catch(error => { console.error(error); process.exitCode = 1 })
`

const { expect } = require("chai")
const { rejects } = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const hre = require("hardhat")
const deploy = require("../../deploy/07_deploy_token_staking").default
const upgrade =
  require("../../deploy/54_upgrade_token_staking_extended").default

describe("TokenStaking deployment entrypoints", () => {
  let localSepolia
  let owner
  let dir

  beforeEach(async () => {
    ;[owner] = await hre.ethers.getSigners()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "staking-deployment-"))
    await hre.deployments.delete("TokenStaking")
    const token = await (await hre.ethers.getContractFactory("T")).deploy()
    await token.deployed()
    await token.mint(owner.address, 1000)
    await hre.deployments.save("T", {
      address: token.address,
      abi: (await hre.artifacts.readArtifact("T")).abi,
    })
    localSepolia = Object.assign({}, hre, {
      network: Object.assign({}, hre.network, { name: "sepolia", tags: {} }),
      getNamedAccounts: async () => ({ deployer: owner.address }),
    })
  })

  afterEach(async () => {
    await hre.deployments.delete("TokenStaking")
    await hre.deployments.delete("T")
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("reuses the proxy, preserves upgraded metadata and exports the safe ABI", async () => {
    await deploy(localSepolia)
    const original = await hre.deployments.get("TokenStaking")
    const base = await hre.ethers.getContractAt(
      "TokenStaking",
      original.address
    )
    await base.setMinimumStakeAmount(42)
    await hre.deployments.save(
      "TokenStaking",
      Object.assign({}, original, { linkedData: { retained: true } })
    )
    await upgrade(localSepolia)
    const updated = await hre.deployments.get("TokenStaking")
    expect(updated.address).to.equal(original.address)
    expect(updated.linkedData).to.deep.equal({ retained: true })
    expect(updated.abi.some((entry) => entry.name === "stake")).to.equal(true)
    expect(
      updated.abi.some((entry) => entry.name === "setAuthorization")
    ).to.equal(false)
    const nonce = await owner.getTransactionCount()
    await deploy(localSepolia)
    expect(await owner.getTransactionCount()).to.equal(nonce)
    expect(await base.governance()).to.equal(owner.address)
    expect(await base.minTStakeAmount()).to.equal(42)
    expect((await hre.deployments.get("TokenStaking")).abi).to.deep.equal(
      updated.abi
    )
    const exportedPath = path.join(dir, "export.json")
    await hre.run("export", { export: exportedPath })
    const exported = JSON.parse(fs.readFileSync(exportedPath, "utf8"))
    expect(exported.contracts.TokenStaking.address).to.equal(original.address)
    expect(
      exported.contracts.TokenStaking.abi.some(
        (entry) => entry.name === "stake"
      )
    ).to.equal(true)
  })

  it("refuses to replace a recorded deployment whose code is missing", async () => {
    const address = "0x0000000000000000000000000000000000000123"
    await hre.deployments.save("TokenStaking", { address, abi: [] })
    const nonce = await owner.getTransactionCount()
    await rejects(deploy(localSepolia), /Recorded TokenStaking has no code/)
    expect(await owner.getTransactionCount()).to.equal(nonce)
    expect((await hre.deployments.get("TokenStaking")).address).to.equal(
      address
    )
  })

  it("updates direct deployments when constructor arguments change", async () => {
    const previousToken = await (
      await hre.ethers.getContractFactory("T")
    ).deploy()
    await previousToken.mint(owner.address, 1000)
    const { deployer } = await hre.getNamedAccounts()
    const previous = await hre.deployments.deploy("TokenStaking", {
      from: deployer,
      args: [previousToken.address],
    })
    await deploy(hre)
    const updated = await hre.deployments.get("TokenStaking")
    expect(updated.address).not.to.equal(previous.address)
    expect(updated.args).to.deep.equal([
      (await hre.deployments.get("T")).address,
    ])
    expect(await hre.deployments.read("TokenStaking", "governance")).to.equal(
      deployer
    )
  })

  it("rejects the shared standalone/deployment upgrade on other networks", async () => {
    for (const name of ["hardhat", "mainnet"]) {
      await rejects(
        upgrade(Object.assign({}, localSepolia, { network: { name } })),
        /only supported on Sepolia/
      )
    }
  })
})

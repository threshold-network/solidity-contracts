const { expect } = require("chai")
const { ethers, upgrades, artifacts, network } = require("hardhat")

describe("SepoliaTokenStaking", () => {
  let token
  let staking
  let owner
  let provider
  let authorizer
  let other
  let factory

  beforeEach(async () => {
    ;[owner, provider, authorizer, other] = await ethers.getSigners()
    token = await (await ethers.getContractFactory("T")).deploy()
    await token.deployed()
    await token.mint(owner.address, 1000)
    factory = await ethers.getContractFactory("SepoliaTokenStaking")
    staking = await upgrades.deployProxy(factory, [], {
      constructorArgs: [token.address],
      kind: "transparent",
    })
    await staking.deployed()
    await token.approve(staking.address, 100)
    await staking.stake(
      provider.address,
      owner.address,
      authorizer.address,
      100
    )
  })

  async function application() {
    const app = await (
      await ethers.getContractFactory("ApplicationMock")
    ).deploy(staking.address)
    await app.deployed()
    await staking.approveApplication(app.address)
    return app
  }

  it("exposes guarded staking without fixture mutation helpers", async () => {
    const abi = (await artifacts.readArtifact("SepoliaTokenStaking")).abi
    const names = abi
      .filter((entry) => entry.type === "function")
      .map((entry) => entry.name)
    for (const name of [
      "setAuthorization",
      "setAuthorizedApplications",
      "addToSkipList",
      "cleanAuthorizedApplications",
      "legacyApproveAuthorizationDecrease",
    ]) {
      expect(names).not.to.include(name)
    }
    const app = await application()
    await expect(
      staking.connect(other).approveApplication(other.address)
    ).to.be.revertedWith("Caller is not the governance")
    await expect(
      staking
        .connect(other)
        .increaseAuthorization(provider.address, app.address, 1)
    ).to.be.revertedWith("Not authorizer")
    await expect(
      staking.stake(provider.address, owner.address, authorizer.address, 1)
    ).to.be.revertedWith("Provider is already in use")
    await expect(
      staking
        .connect(authorizer)
        .increaseAuthorization(provider.address, app.address, 101)
    ).to.be.revertedWith("Not enough stake to authorize")
  })

  it("keeps both applications backed through independent decreases and withdrawals", async () => {
    const first = await application()
    const second = await application()
    for (const app of [first, second]) {
      await expect(
        staking
          .connect(authorizer)
          .increaseAuthorization(provider.address, app.address, 100)
      )
        .to.emit(staking, "AuthorizationIncreased")
        .withArgs(provider.address, app.address, 0, 100)
      expect(
        await staking.authorizedStake(provider.address, app.address)
      ).to.equal(100)
      expect(
        (await app.stakingProviders(provider.address)).authorized
      ).to.equal(100)
    }
    await staking
      .connect(authorizer)
      .requestAuthorizationDecrease(provider.address, first.address, 100)
    await first.approveAuthorizationDecrease(provider.address)
    expect(await staking.stakeAmount(provider.address)).to.equal(100)
    expect(await token.balanceOf(staking.address)).to.equal(100)
    expect(await staking.getMaxAuthorization(provider.address)).to.equal(100)
    await network.provider.send("evm_increaseTime", [86401])
    await network.provider.send("evm_mine")
    await expect(staking.unstakeT(provider.address, 1)).to.be.revertedWith(
      "Too much to unstake"
    )
    await staking
      .connect(authorizer)
      .requestAuthorizationDecrease(provider.address, second.address, 40)
    await second.approveAuthorizationDecrease(provider.address)
    await staking.unstakeT(provider.address, 40)
    expect(await staking.stakeAmount(provider.address)).to.equal(60)
    expect(
      await staking.authorizedStake(provider.address, second.address)
    ).to.equal(60)
    expect(await token.balanceOf(staking.address)).to.equal(60)
    await expect(staking.unstakeT(provider.address, 1)).to.be.revertedWith(
      "Too much to unstake"
    )
  })

  it("does not grant approved applications legacy migration access", async () => {
    const app = await application()
    await expect(app.migrateAndRelease(provider.address, 0)).to.be.revertedWith(
      "Migration is not supported on Sepolia"
    )
    expect(await staking.stakeAmount(provider.address)).to.equal(100)
  })

  it("rejects increases for disabled applications", async () => {
    const app = await application()
    await staking.disableApplication(app.address)
    await expect(
      staking
        .connect(authorizer)
        .increaseAuthorization(provider.address, app.address, 1)
    ).to.be.revertedWith("Application is not approved")
  })

  it("enforces base eligibility before changing authorization or notifying an application", async () => {
    const basePolicy = await upgrades.deployProxy(
      await ethers.getContractFactory("BaseAuthorizationStakingTest"),
      [],
      {
        constructorArgs: [token.address],
        kind: "transparent",
      }
    )
    await token.approve(basePolicy.address, 100)
    await basePolicy.stake(
      provider.address,
      owner.address,
      authorizer.address,
      100
    )
    const app = await (
      await ethers.getContractFactory("ApplicationMock")
    ).deploy(basePolicy.address)
    await basePolicy.approveApplication(app.address)
    await expect(
      basePolicy
        .connect(authorizer)
        .increaseAuthorization(provider.address, app.address, 1)
    ).to.be.revertedWith("Application is deprecated")
    expect(
      await basePolicy.authorizedStake(provider.address, app.address)
    ).to.equal(0)
    expect((await app.stakingProviders(provider.address)).authorized).to.equal(
      0
    )
  })

  for (const previous of ["TokenStaking", "ExtendedTokenStaking"]) {
    it(`passes storage validation upgrading from ${previous} and preserves state`, async () => {
      const original = await upgrades.deployProxy(
        await ethers.getContractFactory(previous),
        [],
        {
          constructorArgs: [token.address],
          kind: "transparent",
        }
      )
      await original.setMinimumStakeAmount(5)
      if (previous === "ExtendedTokenStaking") {
        await token.approve(original.address, 30)
        await original.stake(
          provider.address,
          owner.address,
          authorizer.address,
          30
        )
      }
      const updated = await upgrades.upgradeProxy(original.address, factory, {
        constructorArgs: [token.address],
        kind: "transparent",
      })
      expect(updated.address).to.equal(original.address)
      expect(await updated.governance()).to.equal(owner.address)
      expect(await updated.minTStakeAmount()).to.equal(5)
      expect(await updated.stakeAmount(provider.address)).to.equal(
        previous === "ExtendedTokenStaking" ? 30 : 0
      )
    })
  }
})

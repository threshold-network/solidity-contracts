const { expect } = require("chai")
const { to1e18, lastBlockNumber } = require("../helpers/contract-test-helpers")

describe("Checkpoints", () => {
  let tToken

  // Staker has 5 T tokens
  let staker
  const initialStakerBalance = to1e18(5)

  beforeEach(async () => {
    const T = await ethers.getContractFactory("T")
    tToken = await T.deploy()
    await tToken.deployed()

    const TestStaking = await ethers.getContractFactory(
      "TestStakingCheckpoints"
    )
    tStaking = await TestStaking.deploy(tToken.address)
    await tStaking.deployed()
    ;[staker, thirdParty] = await ethers.getSigners()
    await tToken.mint(staker.address, initialStakerBalance)
  })

  describe("setup", () => {
    context("once deployed", () => {
      it("staking contract balance should be 0", async () => {
        expect(await tToken.balanceOf(tStaking.address)).to.equal(0)
      })
      it("staker balance should be 5", async () => {
        expect(await tToken.balanceOf(staker.address)).to.equal(
          initialStakerBalance
        )
      })

      it("no checkpoints associated to staker", async () => {
        expect(await tStaking.numCheckpoints(staker.address)).to.equal(0)
      })

      it("trying to read a checkpoint should revert", async () => {
        await expect(tStaking.checkpoints(staker.address, 0)).to.be.reverted
      })
      // TODO: no total supply checkpoints, getPastTotalSupply, etc
    })
  })

  describe("without delegation", () => {
    const amount = initialStakerBalance

    beforeEach(async () => {
      await tToken.connect(staker).approve(tStaking.address, amount)
      tx = await tStaking.connect(staker).deposit(amount)
    })

    context("after first deposit from staker", () => {
      it("should transfer T tokens to staking contract", async () => {
        expect(await tToken.balanceOf(tStaking.address)).to.equal(amount)
        expect(await tToken.balanceOf(staker.address)).to.equal(0)
      })

      it("there's one associated checkpoint", async () => {
        expect(await tStaking.numCheckpoints(staker.address)).to.equal(1)
        const checkpoint = await tStaking.checkpoints(staker.address, 0)
        expect(checkpoint[0]).to.equal(await lastBlockNumber())
        expect(checkpoint[1]).to.equal(amount)
      })

      it("trying to read next checkpoint should revert", async () => {
        await expect(tStaking.checkpoints(staker.address, 1)).to.be.reverted
      })
    })

    context("after withdrawal from staker", () => {
      beforeEach(async () => {
        tx = await tStaking.connect(staker).withdraw(amount)
      })

      it("staking contract should transfer T tokens to staker", async () => {
        expect(await tToken.balanceOf(staker.address)).to.equal(amount)
        expect(await tToken.balanceOf(tStaking.address)).to.equal(0)
      })

      it("there's two associated checkpoints", async () => {
        expect(await tStaking.numCheckpoints(staker.address)).to.equal(2)
        const checkpoint = await tStaking.checkpoints(staker.address, 1)
        expect(checkpoint[0]).to.equal(await lastBlockNumber())
        expect(checkpoint[1]).to.equal(0)
      })

      it("trying to read next checkpoint should revert", async () => {
        await expect(tStaking.checkpoints(staker.address, 2)).to.be.reverted
      })
    })
  })
})

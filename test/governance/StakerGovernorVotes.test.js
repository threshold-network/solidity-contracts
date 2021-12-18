const { expect } = require("chai")

const { mineBlocks, lastBlockNumber } = helpers.time
const { to1e18 } = helpers.number

describe("StakerGovernorVotes", () => {
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
    await tToken.connect(staker).delegate(staker.address)

    const TestVotes = await ethers.getContractFactory("TestStakerGovernorVotes")
    tVotes = await TestVotes.deploy(tStaking.address)
    await tVotes.deployed()
  })

  describe("setup", () => {
    context("static parameters", () => {
      it("quorum denominator is 10000", async () => {
        expect(await tVotes.FRACTION_DENOMINATOR()).to.equal(10000)
      })

      it("quorum numerator is 125", async () => {
        expect(await tVotes.quorumNumerator()).to.equal(125)
      })
    })

    context("once deployed", () => {
      let atLastBlock
      beforeEach(async () => {
        atLastBlock = (await lastBlockNumber()) - 1
      })

      it("staked balance should be 0", async () => {
        expect(await tStaking.stake(staker.address)).to.equal(0)
      })

      it("past votes at last block should be 0", async () => {
        expect(await tVotes.getVotes(staker.address, atLastBlock)).to.equal(0)
      })

      it("total supply at last block should be 0", async () => {
        expect(await tVotes.getPastTotalSupply(atLastBlock)).to.equal(0)
      })
    })

    context("after a deposit", () => {
      let lastBlock
      const stake = to1e18(4)
      beforeEach(async () => {
        await tToken.connect(staker).approve(tStaking.address, stake)
        await tStaking.connect(staker).deposit(stake)
        lastBlock = (await mineBlocks(1)) - 1
      })

      it("liquid balance should decrease by 4", async () => {
        expect(await tToken.balanceOf(staker.address)).to.equal(
          initialStakerBalance.sub(stake)
        )
      })

      it("staked balance should be 4", async () => {
        expect(await tStaking.stake(staker.address)).to.equal(stake)
      })

      it("past votes at last block should be 4", async () => {
        expect(await tVotes.getVotes(staker.address, lastBlock)).to.equal(stake)
      })

      it("total supply at last block should be 4", async () => {
        expect(await tVotes.getPastTotalSupply(lastBlock)).to.equal(stake)
      })

      it("quorum at last block should be 1.25% (125/10000) of 4", async () => {
        expect(await tVotes.quorum(lastBlock)).to.equal(
          stake.mul(125).div(10000)
        )
      })
    })

    context("after a withdrawal", () => {
      let lastBlock
      const stake = to1e18(4)
      const withdrawal = to1e18(2)
      const newStake = stake.sub(withdrawal)
      beforeEach(async () => {
        await tToken.connect(staker).approve(tStaking.address, stake)
        await tStaking.connect(staker).deposit(stake)
        await tStaking.connect(staker).withdraw(withdrawal)
        lastBlock = (await mineBlocks(1)) - 1
      })

      it("liquid balance should increase by 2", async () => {
        expect(await tToken.balanceOf(staker.address)).to.equal(
          initialStakerBalance.sub(newStake)
        )
      })

      it("staked balance should be 2", async () => {
        expect(await tStaking.stake(staker.address)).to.equal(newStake)
      })

      it("past votes at last block should be 2", async () => {
        expect(await tVotes.getVotes(staker.address, lastBlock)).to.equal(
          newStake
        )
      })

      it("total supply at last block should be 2", async () => {
        expect(await tVotes.getPastTotalSupply(lastBlock)).to.equal(newStake)
      })

      it("quorum at last block should be 1.25% (125/10000) of 2", async () => {
        expect(await tVotes.quorum(lastBlock)).to.equal(
          newStake.mul(125).div(10000)
        )
      })
    })
  })
})

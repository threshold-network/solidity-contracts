const { expect } = require("chai")

const { lastBlockNumber } = helpers.time
const { to1e18 } = helpers.number

describe("TokenholderGovernorVotes", () => {
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

    const TestVotes = await ethers.getContractFactory(
      "TestTokenholderGovernorVotes"
    )
    tVotes = await TestVotes.deploy(tToken.address, tStaking.address)
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

      it("liquid balance should be 5", async () => {
        expect(await tToken.balanceOf(staker.address)).to.equal(
          initialStakerBalance
        )
      })

      it("staked balance should be 0", async () => {
        expect(await tStaking.stake(staker.address)).to.equal(0)
      })

      it("past votes at last block should be 5", async () => {
        expect(await tVotes.getVotes(staker.address, atLastBlock)).to.equal(
          initialStakerBalance
        )
      })

      it("total supply at last block should be 5", async () => {
        expect(await tVotes.getPastTotalSupply(atLastBlock)).to.equal(
          initialStakerBalance
        )
      })

      it("quorum at last block should be 1.25% (125/10000) of 5", async () => {
        expect(await tVotes.quorum(atLastBlock)).to.equal(
          initialStakerBalance.mul(125).div(10000)
        )
      })
    })
  })
})

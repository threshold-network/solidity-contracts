const { expect } = require("chai")

const { helpers } = require("hardhat")
const { to1e18 } = helpers.number
const { impersonateAccount } = helpers.account
const { resetFork } = helpers.forking

const { initContracts } = require("./init-contracts")
const { daoAgentAddress } = require("./constants")

const describeFn =
  process.env.NODE_ENV === "stakingescrow-test" ? describe : describe.skip

describeFn("System Tests: StakingEscrow", () => {
  const startingBlock = 13979631

  let purse
  let daoAgent

  // Contracts
  let nuCypherToken
  let tokenStaking
  let stakingEscrow
  let stakingEscrowImplementation

  beforeEach(async () => {
    await resetFork(startingBlock)

    purse = await ethers.getSigner(1)
    daoAgent = await impersonateAccount(daoAgentAddress, {
      from: purse,
      value: "10",
    })

    const contracts = await initContracts()
    nuCypherToken = contracts.nuCypherToken
    tokenStaking = contracts.tokenStaking
    stakingEscrow = contracts.stakingEscrow
    stakingEscrowImplementation = contracts.stakingEscrowImplementation

    await contracts.stakingEscrowDispatcher
      .connect(daoAgent)
      .upgrade(stakingEscrowImplementation.address)
  })

  describe("setup", () => {
    context("once proxy contract upgraded", () => {
      it("should dispatcher target address to new stakingEscrow", async () => {
        expect(await stakingEscrow.target()).to.equal(
          stakingEscrowImplementation.address
        )
      })

      it("should prev. target match with target before upgrade", async () => {
        let previousTarget = await stakingEscrow.previousTarget()
        await resetFork(startingBlock)
        expect(await stakingEscrow.target()).to.equal(previousTarget)
      })

      it("should stakers amount not be zero", async () => {
        expect(await stakingEscrow.getStakersLength()).to.not.equal(0)
      })
      it("should stakers number match with before upgrade", async () => {
        let stakersNumber = await stakingEscrow.getStakersLength()
        await resetFork(startingBlock)
        expect(await stakingEscrow.getStakersLength()).to.equal(stakersNumber)
      })
    })
  })

  describe("staking", () => {
    context("when I have not stake", () => {
      it("should be able to withdraw NU", async () => {
        let operatorAddress = await stakingEscrow.stakers(0)

        operator = await impersonateAccount(operatorAddress, {
          from: purse,
          value: "10",
        })

        expect(await tokenStaking.stakedNu(operator.address)).to.equal(0)
        expect(await stakingEscrow.getAllTokens(operator.address)).to.not.equal(0)
        
        console.log(await stakingEscrow.getAllTokens(operator.address))
        console.log(await nuCypherToken.balanceOf(operator.address))
        await stakingEscrow.connect(operator).withdraw(to1e18(10));
        console.log(await stakingEscrow.getAllTokens(operator.address))
        console.log(await nuCypherToken.balanceOf(operator.address))
      })
    })
  })
})

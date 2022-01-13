const { expect } = require("chai")

const { helpers } = require("hardhat")
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
    tokenStaking = contracts.tokenStaking
    stakingEscrow = contracts.stakingEscrow
    stakingEscrowImplementation = contracts.stakingEscrowImplementation

    let stakingEscrowDispatcher = contracts.stakingEscrowDispatcher
    await stakingEscrowDispatcher
      .connect(daoAgent)
      .upgrade(stakingEscrowImplementation.address)
  })

  describe("setup", () => {
    context("once upgraded", () => {
      it("should dispatcher target address to new stakingEscrow", async () => {
        expect(await stakingEscrow.target()).to.equal(
          stakingEscrowImplementation.address
        )
      })
    })
  })

  describe("staking", () => {
    context("when I have not stake", () => {
      it("should not be able to withdraw NU", async () => {
        expect(true).to.be.equal(true)
      })
    })
  })
})

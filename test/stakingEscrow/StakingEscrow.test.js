const { expect } = require("chai")
const fc = require("fast-check")

const { helpers } = require("hardhat")
const { impersonateAccount } = helpers.account
const { resetFork } = helpers.forking

const { initContracts } = require("./init-contracts")
const { daoAgentAddress, startingBlock, stakers } = require("./constants")

const describeFn =
  process.env.NODE_ENV === "stakingescrow-test" ? describe : describe.skip

describeFn("System Tests: StakingEscrow", () => {
  let purse
  let daoAgent

  // Contracts
  let nuCypherToken
  let tokenStaking
  let stakingEscrow
  let stakingEscrowImplementation

  async function impersonate(purse, account) {
    return await impersonateAccount(account, {
      from: purse,
      value: "10",
    })
  }

  before(() => {
    fc.configureGlobal({ numRuns: stakers.length, skipEqualValues: true })
  })

  beforeEach(async () => {
    await resetFork(startingBlock)

    const contracts = await initContracts()
    nuCypherToken = contracts.nuCypherToken
    tokenStaking = contracts.tokenStaking
    stakingEscrow = contracts.stakingEscrow
    stakingEscrowImplementation = contracts.stakingEscrowImplementation

    purse = await ethers.getSigner(1)
    daoAgent = await impersonate(purse, daoAgentAddress)

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
        const previousTarget = await stakingEscrow.previousTarget()
        await resetFork(startingBlock)
        expect(await stakingEscrow.target()).to.equal(previousTarget)
      })

      it("should stakers amount not be zero", async () => {
        expect(await stakingEscrow.getStakersLength()).to.not.equal(0)
      })

      it("should stakers number match before upgrade", async () => {
        const stakersNumber = await stakingEscrow.getStakersLength()
        await resetFork(startingBlock)
        expect(await stakingEscrow.getStakersLength()).to.equal(stakersNumber)
      })
    })
  })

  describe("staking", () => {
    context("when operator have no stake on token staking", () => {
      it("staked NU should be zero", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              expect(await tokenStaking.stakedNu(operatorAddress)).to.equal(0)
            }
          )
        )
      })

      it("withdraw should reduce the amount of NU properly", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              const operator = await impersonate(purse, operatorAddress)

              const tokens = await stakingEscrow.getAllTokens(operatorAddress)
              const withdrawTokens = tokens.div(2)
              const difference = tokens.sub(withdrawTokens)

              await stakingEscrow.connect(operator).withdraw(withdrawTokens)

              expect(
                await stakingEscrow.getAllTokens(operatorAddress)
              ).to.equal(difference)
            }
          )
        )
      })

      it("withdrawn NU should be transfered to account", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              const operator = await impersonate(purse, operatorAddress)

              const stakeTokens = await stakingEscrow.getAllTokens(
                operatorAddress
              )
              const nuBalance = await nuCypherToken.balanceOf(operatorAddress)

              await stakingEscrow.connect(operator).withdraw(stakeTokens)

              expect(await nuCypherToken.balanceOf(operatorAddress)).to.equal(
                nuBalance.add(stakeTokens)
              )
            }
          )
        )
      })
    })
  })
})

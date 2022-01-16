const { expect } = require("chai")
const fc = require("fast-check")

const { helpers } = require("hardhat")
const { impersonateAccount } = helpers.account
const { to1e18 } = helpers.number
const { resetFork } = helpers.forking

const { initContracts } = require("./init-contracts")
const { daoAgentAddress, startingBlock, stakers } = require("./constants")

const describeFn =
  process.env.NODE_ENV === "stakingescrow-test" ? describe : describe.skip

describeFn("System Tests: StakingEscrow", () => {
  let purse
  let daoAgent
  let floatingPointDivisor
  let nuCypherRatio

  // Contracts
  let nuCypherToken
  let tokenStaking
  let stakingEscrow
  let stakingEscrowImplementation
  let nuCypherVendingMachine

  async function impersonate(purse, account) {
    return await impersonateAccount(account, {
      from: purse,
      value: "10",
    })
  }

  const nuToT = (nuTokens) => {
    amount = ethers.BigNumber.from(nuTokens)
    const wrappedRemainder = amount.mod(floatingPointDivisor)
    amount = amount.sub(wrappedRemainder)
    return {
      tAmount: amount.mul(nuCypherRatio).div(floatingPointDivisor),
      remainder: wrappedRemainder,
    }
  }

  before(async () => {
    fc.configureGlobal({ numRuns: stakers.length, skipEqualValues: true })
    await resetFork(startingBlock)
    const contracts = await initContracts()
    nuCypherVendingMachine = contracts.nuCypherVendingMachine
    floatingPointDivisor = await nuCypherVendingMachine.FLOATING_POINT_DIVISOR()
    nuCypherRatio = await nuCypherVendingMachine.ratio()
  })

  beforeEach(async () => {
    await resetFork(startingBlock)

    const contracts = await initContracts()
    nuCypherToken = contracts.nuCypherToken
    tokenStaking = contracts.tokenStaking
    stakingEscrow = contracts.stakingEscrow
    stakingEscrowImplementation = contracts.stakingEscrowImplementation
    nuCypherVendingMachine = contracts.nuCypherVendingMachine

    purse = await ethers.getSigner(1)
    daoAgent = await impersonate(purse, daoAgentAddress)

    await contracts.stakingEscrowDispatcher
      .connect(daoAgent)
      .upgrade(stakingEscrowImplementation.address)
  })

  describe("setup", () => {
    context("once proxy contract is upgraded", () => {
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

      it("should number of stakers don't be zero", async () => {
        expect(await stakingEscrow.getStakersLength()).to.not.equal(0)
      })

      it("should stakers number match before upgrade", async () => {
        const stakersNumber = await stakingEscrow.getStakersLength()
        await resetFork(startingBlock)
        expect(await stakingEscrow.getStakersLength()).to.equal(stakersNumber)
      })
    })

    context("once NuCypher Vending machine is resolved", () => {
      it("should conversionToT calculates amount and remainder", async () => {
        await fc.assert(
          fc.asyncProperty(fc.bigUintN(64), async (tokens) => {
            const nuTokens = ethers.BigNumber.from(tokens)
            const convertedNuTokens =
              await nuCypherVendingMachine.conversionToT(nuTokens)
            expect(nuToT(nuTokens).tAmount).to.equal(convertedNuTokens.tAmount)
            expect(nuToT(nuTokens).remainder).to.equal(
              convertedNuTokens.wrappedRemainder
            )
          }),
          {
            numRuns: 20,
            examples: [
              [0],
              [BigInt(floatingPointDivisor)],
              [BigInt(floatingPointDivisor) * BigInt(128)],
            ],
          }
        )
      })
    })
  })

  describe("staking", () => {
    context("when operator has not staked on Token Staking", () => {
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
              const stakerAddress = stakers[index]
              const staker = await impersonate(purse, stakerAddress)
              const stakeTokens = await stakingEscrow.getAllTokens(
                stakerAddress
              )
              const nuBalance = await nuCypherToken.balanceOf(stakerAddress)
              await stakingEscrow.connect(staker).withdraw(stakeTokens)
              expect(await nuCypherToken.balanceOf(stakerAddress)).to.equal(
                nuBalance.add(stakeTokens)
              )
            }
          )
        )
      })
    })

    context("when staker has not NU staked on Staking Escrow", () => {
      it("should not be possible to withdraw NU", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const stakerAddress = stakers[index]
              const staker = await impersonate(purse, stakerAddress)
              const stakeTokens = await stakingEscrow.getAllTokens(
                stakerAddress
              )
              await stakingEscrow.connect(staker).withdraw(stakeTokens)
              await expect(
                stakingEscrow.connect(staker).withdraw(to1e18(10000))
              ).to.be.reverted
            }
          )
        )
      })
    })

    context("when operator stake all NU tokens on Token Staking", () => {
      it("should be staked or be reverted if insufficient NU", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              const operator = await impersonate(purse, operatorAddress)
              const escrowNu = await stakingEscrow.getAllTokens(operatorAddress)
              const escrowNuInT = nuToT(escrowNu)
              // If insufficient NU tokens, method reverts
              if (escrowNuInT.tAmount == 0) {
                await expect(
                  tokenStaking
                    .connect(operator)
                    .stakeNu(operatorAddress, operatorAddress, operatorAddress)
                ).to.be.revertedWith("Nothing to sync")
              } else {
                const [, , previouslyStakedNuInT] = await tokenStaking.stakes(
                  operatorAddress
                )
                const expectedStakedTokensInT = previouslyStakedNuInT.add(
                  escrowNuInT.tAmount
                )
                await tokenStaking
                  .connect(operator)
                  .stakeNu(operatorAddress, operatorAddress, operatorAddress)
                const [, , stakedNuInT] = await tokenStaking.stakes(
                  operatorAddress
                )
                expect(stakedNuInT).to.equal(expectedStakedTokensInT)
              }
            }
          )
        )
      }).timeout(120000)

      it("should not be able to withdraw NU", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              const operator = await impersonate(purse, operatorAddress)
              const escrowNu = await stakingEscrow.getAllTokens(operatorAddress)
              const escrowNuInT = nuToT(escrowNu)
              // Method reverts if insufficient tokens: skipping this case...
              if (escrowNuInT.tAmount > 0) {
                await tokenStaking
                  .connect(operator)
                  .stakeNu(operatorAddress, operatorAddress, operatorAddress)
                await expect(stakingEscrow.connect(operator).withdraw(escrowNu))
                  .to.be.reverted
              }
            }
          )
        )
      })
    })
  })
})

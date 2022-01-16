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
    // numRuns: is the number of runs of property-based tests. The max allowed
    // value is stakers.length, which implies an exhaustive testing (all stakers
    // of Staking Escrow contract are tested). Lower values speed up the tests,
    // but only that number of stakers (randomly selected) will be tested.
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

      it("should not be possible to unstake NU", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              const operator = await impersonate(purse, operatorAddress)

              if (await tokenStaking.stakedNu(operatorAddress) == 0) {
                await expect(tokenStaking
                  .connect(operator)
                  .unstakeNu(operatorAddress, to1e18(1000))).to.be.reverted
              }
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
      }).timeout(300000)

      it("staker should not be able to withdraw NU", async () => {
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

    context("when operator partially stake NU", () => {
      it("staker should be able to withdraw not staked NU", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              const operator = await impersonate(purse, operatorAddress)
              const escrowNu = await stakingEscrow.getAllTokens(operatorAddress)
              const nuToUnstakeInT = nuToT(escrowNu.div(2))

              // Method reverts if insufficient tokens: skipping this case...
              if (nuToUnstakeInT.tAmount > 0) {
                await tokenStaking
                  .connect(operator)
                  .stakeNu(operatorAddress, operatorAddress, operatorAddress)
                // Unstake the half of Nu staked
                await tokenStaking
                  .connect(operator)
                  .unstakeNu(operatorAddress, nuToUnstakeInT.tAmount)

                const stakedNu = await tokenStaking.stakedNu(operatorAddress)
                const withdrawableNu = escrowNu.sub(stakedNu)

                await stakingEscrow.connect(operator).withdraw(withdrawableNu)

                expect(
                  await stakingEscrow.getAllTokens(operatorAddress)
                ).to.equal(stakedNu)
              }
            }
          )
        )
      })

      it("staker should not be able to withdraw staked NU", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              const operator = await impersonate(purse, operatorAddress)
              const escrowNu = await stakingEscrow.getAllTokens(operatorAddress)
              const nuToUnstakeInT = nuToT(escrowNu.div(2))

              // Method reverts if insufficient tokens: skipping this case...
              if (nuToUnstakeInT.tAmount > 0) {
                await tokenStaking
                  .connect(operator)
                  .stakeNu(operatorAddress, operatorAddress, operatorAddress)
                // Unstake the half of Nu staked
                await tokenStaking
                  .connect(operator)
                  .unstakeNu(operatorAddress, nuToUnstakeInT.tAmount)

                await expect(stakingEscrow.connect(operator).withdraw(escrowNu))
                  .to.be.reverted
              }
            }
          )
        )
      })
    })

    context("when operator unstake all previously staked Nu", () => {
      it("staker should be able to withdraw all NU", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const operatorAddress = stakers[index]
              const operator = await impersonate(purse, operatorAddress)
              const escrowNu = await stakingEscrow.getAllTokens(operatorAddress)
              // Method reverts if insufficient tokens: skipping this case...
              if (nuToT(escrowNu).tAmount > 0) {
                await tokenStaking
                  .connect(operator)
                  .stakeNu(operatorAddress, operatorAddress, operatorAddress)
                await tokenStaking.connect(operator).unstakeAll(operatorAddress)
                await stakingEscrow.connect(operator).withdraw(escrowNu)
                expect(await tokenStaking.stakedNu(operatorAddress)).to.equal(0)
                expect(
                  await stakingEscrow.getAllTokens(operatorAddress)
                ).to.equal(0)
              }
            }
          )
        )
      })

      it("other operator should be able to stake again", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const ownerAddress = stakers[index]
              const owner = await impersonate(purse, ownerAddress)
              const escrowNu = await stakingEscrow.getAllTokens(ownerAddress)
              const otherOperatorAdd = ethers.Wallet.createRandom().address

              // Method reverts if insufficient tokens: skipping this case...
              if (nuToT(escrowNu).tAmount > 0) {
                await tokenStaking
                  .connect(owner)
                  .stakeNu(ownerAddress, ownerAddress, ownerAddress)
                await tokenStaking.connect(owner).unstakeAll(ownerAddress)
                await tokenStaking
                  .connect(owner)
                  .stakeNu(otherOperatorAdd, otherOperatorAdd, otherOperatorAdd)

                const roles = await tokenStaking.rolesOf(otherOperatorAdd)
                const [, , nuInTStake] = await tokenStaking.stakes(
                  otherOperatorAdd
                )

                expect(roles.owner).to.equal(ownerAddress)
                expect(roles.beneficiary).to.equal(otherOperatorAdd)
                expect(roles.authorizer).to.equal(otherOperatorAdd)
                expect(await tokenStaking.stakedNu(ownerAddress)).to.equal(0)
                expect(nuInTStake).to.equal(nuToT(escrowNu).tAmount)
              }
            }
          )
        )
      }).timeout(300000)
    })
  })
})

const { expect } = require("chai")
const fc = require("fast-check")

const { helpers } = require("hardhat")
const { impersonateAccount } = helpers.account
const { resetFork } = helpers.forking
const { createSnapshot, restoreSnapshot } = helpers.snapshot
const { lastBlockTime, increaseTime } = helpers.time
const { to1e18 } = helpers.number

const { initContracts } = require("./StakingEscrow-init-contracts")
const {
  daoAgentAddress,
  stakingEscrowStartingBlock,
  stakerList,
} = require("./constants")

const describeFn =
  process.env.NODE_ENV === "system-test" ||
  process.env.NODE_ENV === "stakingescrow-test"
    ? describe
    : describe.skip

describeFn("SystemTests: StakingEscrow", function () {
  // numRuns: is the number of runs of property-based tests. The max allowed
  // value is stakers.length, which implies an comprehensive testing (all
  // stakers of Staking Escrow contract are tested). Lower values speed up the
  // tests, but only that number of stakers (randomly selected) will be tested.
  const numRuns = process.env.NODE_ENV === "system-test" ? 30 : stakers.length

  // Mocha tests timeout
  this.timeout(1200000)

  let stakers
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
    fc.configureGlobal({ numRuns: numRuns, skipEqualValues: true })
    await resetFork(stakingEscrowStartingBlock)
    const contracts = await initContracts()
    nuCypherVendingMachine = contracts.nuCypherVendingMachine
    floatingPointDivisor = await nuCypherVendingMachine.FLOATING_POINT_DIVISOR()
    nuCypherRatio = await nuCypherVendingMachine.ratio()
    // Take random sumbset of stakers with numRuns length
    stakers = stakerList.sort(() => 0.5 - Math.random()).slice(0, numRuns)
  })

  beforeEach(async () => {
    await resetFork(stakingEscrowStartingBlock)

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
      it("should proxy address to new stakingEscrow", async () => {
        expect(await stakingEscrow.target()).to.equal(
          stakingEscrowImplementation.address
        )
      })

      it("should prev. target match with target before upgrade", async () => {
        const previousTarget = await stakingEscrow.previousTarget()
        await resetFork(stakingEscrowStartingBlock)
        expect(await stakingEscrow.target()).to.equal(previousTarget)
      })

      it("should number of stakers don't be zero", async () => {
        expect(await stakingEscrow.getStakersLength()).to.not.equal(0)
      })

      it("should stakers number match before upgrade", async () => {
        const stakersNumber = await stakingEscrow.getStakersLength()
        await resetFork(stakingEscrowStartingBlock)
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
              await expect(stakingEscrow.connect(staker).withdraw(to1e18(1000)))
                .to.be.reverted
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

              if ((await tokenStaking.stakedNu(operatorAddress)) == 0) {
                await expect(
                  tokenStaking
                    .connect(operator)
                    .unstakeNu(operatorAddress, to1e18(1000))
                ).to.be.reverted
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
      })

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

      it("should not be staked again with other operator address", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const ownerAddress = stakers[index]
              const owner = await impersonate(purse, ownerAddress)
              const otherOpAdd = ethers.Wallet.createRandom().address
              const escrowNu = await stakingEscrow.getAllTokens(ownerAddress)

              if (nuToT(escrowNu).tAmount > 0) {
                await tokenStaking
                  .connect(owner)
                  .stakeNu(ownerAddress, ownerAddress, ownerAddress)

                await expect(
                  tokenStaking
                    .connect(owner)
                    .stakeNu(otherOpAdd, otherOpAdd, otherOpAdd)
                ).to.be.reverted
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
              const otherOpAdd = ethers.Wallet.createRandom().address

              // Method reverts if insufficient tokens: skipping this case...
              if (nuToT(escrowNu).tAmount > 0) {
                await tokenStaking
                  .connect(owner)
                  .stakeNu(ownerAddress, ownerAddress, ownerAddress)
                await tokenStaking.connect(owner).unstakeAll(ownerAddress)
                await tokenStaking
                  .connect(owner)
                  .stakeNu(otherOpAdd, otherOpAdd, otherOpAdd)

                const roles = await tokenStaking.rolesOf(otherOpAdd)
                const [, , nuInTStake] = await tokenStaking.stakes(otherOpAdd)

                expect(roles.owner).to.equal(ownerAddress)
                expect(roles.beneficiary).to.equal(otherOpAdd)
                expect(roles.authorizer).to.equal(otherOpAdd)
                expect(await tokenStaking.stakedNu(ownerAddress)).to.equal(0)
                expect(nuInTStake).to.equal(nuToT(escrowNu).tAmount)
              }
            }
          )
        )
      })
    })
  })

  describe("vesting", () => {
    context("when not vesting parameter set up", () => {
      it("unvested NU should be zero", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const stakAdd = stakers[index]
              expect(await stakingEscrow.getUnvestedTokens(stakAdd)).to.equal(0)
            }
          )
        )
      })
    })

    context("when set up a vesting parameter with release rate zero", () => {
      beforeEach(async () => {
        const timestamp = (await lastBlockTime()) + 3600
        const releaseTimestamp = new Array(stakers.length).fill(timestamp)
        const releaseRate = new Array(stakers.length).fill(0)
        await stakingEscrow
          .connect(daoAgent)
          .setupVesting(stakers, releaseTimestamp, releaseRate)
      })

      it("all NU tokens should be registered as vested", async () => {
        await fc.assert(
          fc
            .asyncProperty(
              fc.integer({ min: 0, max: stakers.length - 1 }),
              async (index) => {
                const stakAdd = stakers[index]
                const stakTokens = await stakingEscrow.getAllTokens(stakAdd)
                const unvTokens = await stakingEscrow.getUnvestedTokens(stakAdd)
                expect(unvTokens).to.not.equal(0)
                expect(unvTokens).to.equal(stakTokens)
              }
            )
            .beforeEach(async () => {
              createSnapshot()
            })
            .afterEach(async () => {
              restoreSnapshot()
            })
        )
      })

      it("unvested tokens should not change during vesting time", async () => {
        await increaseTime(1800)
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const stakAdd = stakers[index]
              const stakTokens = await stakingEscrow.getAllTokens(stakAdd)
              const unvTokens = await stakingEscrow.getUnvestedTokens(stakAdd)
              expect(unvTokens).to.not.equal(0)
              expect(unvTokens).to.equal(stakTokens)
            }
          )
        )
      })

      it("should not be able to withdraw before release time", async () => {
        await increaseTime(1800)
        await fc.assert(
          fc
            .asyncProperty(
              fc.integer({ min: 0, max: stakers.length - 1 }),
              async (index) => {
                const stakAdd = stakers[index]
                const staker = await impersonate(purse, stakAdd)
                const stakTokens = await stakingEscrow.getAllTokens(stakAdd)
                const unvestedTokens = await stakingEscrow.getUnvestedTokens(
                  stakAdd
                )
                expect(unvestedTokens).to.above(0)
                await expect(stakingEscrow.connect(staker).withdraw(stakTokens))
                  .to.be.reverted
              }
            )
            .beforeEach(async () => {
              createSnapshot()
            })
            .afterEach(async () => {
              restoreSnapshot()
            })
        )
      })

      it("should be able to withdraw after release time", async () => {
        await increaseTime(3600)
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const stakAdd = stakers[index]
              const staker = await impersonate(purse, stakAdd)
              const stakTokens = await stakingEscrow.getAllTokens(stakAdd)
              const unvestTokens = await stakingEscrow.getUnvestedTokens(
                stakAdd
              )
              const preNuTokens = await nuCypherToken.balanceOf(stakAdd)
              await stakingEscrow.connect(staker).withdraw(stakTokens)
              const nuTokens = await nuCypherToken.balanceOf(stakAdd)
              expect(unvestTokens).to.equal(0)
              expect(stakTokens.add(preNuTokens)).to.equal(nuTokens)
            }
          )
        )
      })
    })

    context("when set up a vesting param with release rate not zero", () => {
      beforeEach(async () => {
        const timestamp = (await lastBlockTime()) + 3600
        const releaseTimestamp = new Array(stakers.length).fill(timestamp)
        const releaseRate = []
        for (const staker of stakers) {
          releaseRate.push((await stakingEscrow.getAllTokens(staker)).div(3600))
        }
        await stakingEscrow
          .connect(daoAgent)
          .setupVesting(stakers, releaseTimestamp, releaseRate)
      })

      it("after a time some staked Nu should be unvested", async () => {
        await increaseTime(1800)
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 0, max: stakers.length - 1 }),
            async (index) => {
              const stakAdd = stakers[index]
              const stakTokens = await stakingEscrow.getAllTokens(stakAdd)
              const unvTokens = await stakingEscrow.getUnvestedTokens(stakAdd)
              expect(unvTokens).to.below(stakTokens)
            }
          )
        )
      })

      it("after a time should be able to withdraw unvested NU", async () => {
        await increaseTime(1800)
        await fc.assert(
          fc
            .asyncProperty(
              fc.integer({ min: 0, max: stakers.length - 1 }),
              async (index) => {
                const stakAdd = stakers[index]
                const staker = await impersonate(purse, stakAdd)
                const stakTokens = await stakingEscrow.getAllTokens(stakAdd)
                const unvTokens = await stakingEscrow.getUnvestedTokens(stakAdd)
                const preNuTokens = await nuCypherToken.balanceOf(stakAdd)
                const freeTokens = stakTokens.sub(unvTokens)
                await stakingEscrow.connect(staker).withdraw(freeTokens)
                const nuTokens = await nuCypherToken.balanceOf(stakAdd)
                expect(freeTokens.add(preNuTokens)).to.equal(nuTokens)
              }
            )
            .beforeEach(async () => {
              await createSnapshot()
            })
            .afterEach(async () => {
              await restoreSnapshot()
            })
        )
      })
    })
  })
})

const { expect } = require("chai")

const { helpers } = require("hardhat")
const { lastBlockTime, mineBlocks, increaseTime } = helpers.time
const { to1e18, to1ePrecision } = helpers.number

const { AddressZero, Zero } = ethers.constants

const StakeTypes = {
  NU: 0,
  KEEP: 1,
  T: 2,
}
const ApplicationStatus = {
  NOT_APPROVED: 0,
  APPROVED: 1,
  PAUSED: 2,
  DISABLED: 3,
}
const { upgrades } = require("hardhat")

describe("TokenStaking", () => {
  let tToken
  let keepVendingMachine
  let nucypherVendingMachine
  let keepStakingMock
  let keepStake
  let nucypherStakingMock
  let application1Mock
  let application2Mock

  const floatingPointDivisor = to1ePrecision(1, 15)
  const tAllocation = to1e18("4500000000") // 4.5 Billion
  const maxKeepWrappedTokens = to1e18("1100000000") // 1.1 Billion
  const maxNuWrappedTokens = to1e18("900000000") // 0.9 Billion
  const keepRatio = floatingPointDivisor
    .mul(tAllocation)
    .div(maxKeepWrappedTokens)
  const nuRatio = floatingPointDivisor.mul(tAllocation).div(maxNuWrappedTokens)

  function convertToT(amount, ratio) {
    amount = ethers.BigNumber.from(amount)
    const wrappedRemainder = amount.mod(floatingPointDivisor)
    amount = amount.sub(wrappedRemainder)
    return {
      result: amount.mul(ratio).div(floatingPointDivisor),
      remainder: wrappedRemainder,
    }
  }

  function convertFromT(amount, ratio) {
    amount = ethers.BigNumber.from(amount)
    const tRemainder = amount.mod(ratio)
    amount = amount.sub(tRemainder)
    return {
      result: amount.mul(floatingPointDivisor).div(ratio),
      remainder: tRemainder,
    }
  }

  function rewardFromPenalty(penalty, rewardMultiplier) {
    return penalty.mul(5).div(100).mul(rewardMultiplier).div(100)
  }

  let tokenStaking

  let deployer
  let panicButton
  // Token staker has 5 (T/NU/KEEP) tokens
  let staker
  const initialStakerBalance = to1e18(5)
  let stakingProvider
  let authorizer
  let beneficiary
  let delegatee

  let otherStaker
  let auxiliaryAccount

  beforeEach(async () => {
    ;[
      deployer,
      panicButton,
      staker,
      stakingProvider,
      authorizer,
      beneficiary,
      otherStaker,
      auxiliaryAccount,
      delegatee,
    ] = await ethers.getSigners()

    const T = await ethers.getContractFactory("T")
    tToken = await T.deploy()
    await tToken.deployed()

    await tToken.mint(deployer.address, tAllocation)
    await tToken
      .connect(deployer)
      .transfer(staker.address, initialStakerBalance)
    await tToken
      .connect(deployer)
      .transfer(otherStaker.address, initialStakerBalance)

    const VendingMachine = await ethers.getContractFactory("VendingMachineMock")
    keepVendingMachine = await VendingMachine.deploy(
      maxKeepWrappedTokens,
      tAllocation
    )
    await keepVendingMachine.deployed()
    nucypherVendingMachine = await VendingMachine.deploy(
      maxNuWrappedTokens,
      tAllocation
    )
    await nucypherVendingMachine.deployed()

    const KeepTokenStakingMock = await ethers.getContractFactory(
      "KeepTokenStakingMock"
    )
    keepStakingMock = await KeepTokenStakingMock.deploy()
    await keepStakingMock.deployed()
    const KeepStake = await ethers.getContractFactory("KeepStake")
    keepStake = await KeepStake.deploy(keepStakingMock.address)
    await keepStake.deployed()
    const NuCypherTokenStakingMock = await ethers.getContractFactory(
      "NuCypherTokenStakingMock"
    )
    nucypherStakingMock = await NuCypherTokenStakingMock.deploy()
    await nucypherStakingMock.deployed()

    const TokenStaking = await ethers.getContractFactory("TokenStaking")
    const tokenStakingInitializerArgs = []
    tokenStaking = await upgrades.deployProxy(
      TokenStaking,
      tokenStakingInitializerArgs,
      {
        constructorArgs: [
          tToken.address,
          keepStakingMock.address,
          nucypherStakingMock.address,
          keepVendingMachine.address,
          nucypherVendingMachine.address,
          keepStake.address,
        ],
      }
    )
    await tokenStaking.deployed()

    const ApplicationMock = await ethers.getContractFactory("ApplicationMock")
    application1Mock = await ApplicationMock.deploy(tokenStaking.address)
    await application1Mock.deployed()
    application2Mock = await ApplicationMock.deploy(tokenStaking.address)
    await application2Mock.deployed()
  })

  describe("setMinimumStakeAmount", () => {
    const amount = 1

    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(staker).setMinimumStakeAmount(amount)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when caller is the governance", () => {
      let tx

      beforeEach(async () => {
        tx = await tokenStaking.connect(deployer).setMinimumStakeAmount(amount)
      })

      it("should set minimum amount", async () => {
        expect(await tokenStaking.minTStakeAmount()).to.equal(amount)
      })

      it("should emit MinimumStakeAmountSet event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "MinimumStakeAmountSet")
          .withArgs(amount)
      })
    })
  })

  describe("stake", () => {
    context("when caller did not provide staking provider", () => {
      it("should revert", async () => {
        amount = 0
        await expect(
          tokenStaking
            .connect(staker)
            .stake(AddressZero, beneficiary.address, authorizer.address, amount)
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when caller did not provide beneficiary", () => {
      it("should revert", async () => {
        amount = 0
        await expect(
          tokenStaking
            .connect(staker)
            .stake(
              stakingProvider.address,
              AddressZero,
              authorizer.address,
              amount
            )
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when caller did not provide authorizer", () => {
      it("should revert", async () => {
        amount = 0
        await expect(
          tokenStaking
            .connect(staker)
            .stake(
              stakingProvider.address,
              beneficiary.address,
              AddressZero,
              amount
            )
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when staking provider is in use", () => {
      context(
        "when other stake delegated to the specified staking provider",
        () => {
          it("should revert", async () => {
            const amount = initialStakerBalance
            await tToken
              .connect(otherStaker)
              .approve(tokenStaking.address, amount)
            await tokenStaking
              .connect(otherStaker)
              .stake(
                stakingProvider.address,
                beneficiary.address,
                authorizer.address,
                amount
              )
            await tToken.connect(staker).approve(tokenStaking.address, amount)
            await expect(
              tokenStaking
                .connect(staker)
                .stake(
                  stakingProvider.address,
                  beneficiary.address,
                  authorizer.address,
                  amount
                )
            ).to.be.revertedWith("Provider is already in use")
          })
        }
      )

      context(
        "when staking provider is in use in Keep staking contract",
        () => {
          it("should revert", async () => {
            const createdAt = 1
            await keepStakingMock.setOperator(
              stakingProvider.address,
              otherStaker.address,
              AddressZero,
              AddressZero,
              createdAt,
              0,
              0
            )
            const amount = 0
            await expect(
              tokenStaking
                .connect(staker)
                .stake(
                  stakingProvider.address,
                  beneficiary.address,
                  authorizer.address,
                  amount
                )
            ).to.be.revertedWith("Provider is already in use")
          })
        }
      )
    })

    context("when staker delegates too small amount", () => {
      context("when amount is zero and minimum amount was not set", () => {
        it("should revert", async () => {
          amount = 0
          await expect(
            tokenStaking
              .connect(staker)
              .stake(
                stakingProvider.address,
                beneficiary.address,
                authorizer.address,
                amount
              )
          ).to.be.revertedWith("Amount is less than minimum")
        })
      })

      context("when amount is less than minimum", () => {
        it("should revert", async () => {
          amount = initialStakerBalance
          await tokenStaking
            .connect(deployer)
            .setMinimumStakeAmount(amount.add(1))
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          await expect(
            tokenStaking
              .connect(staker)
              .stake(
                stakingProvider.address,
                beneficiary.address,
                authorizer.address,
                amount
              )
          ).to.be.revertedWith("Amount is less than minimum")
        })
      })
    })

    context(
      "when stake delegates enough tokens to free staking provider",
      () => {
        const amount = initialStakerBalance
        let tx
        let blockTimestamp

        beforeEach(async () => {
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          tx = await tokenStaking
            .connect(staker)
            .stake(
              stakingProvider.address,
              beneficiary.address,
              authorizer.address,
              amount
            )
          blockTimestamp = await lastBlockTime()
        })

        it("should set roles equal to the provided values", async () => {
          expect(
            await tokenStaking.rolesOf(stakingProvider.address)
          ).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
          ])
        })

        it("should set value of stakes", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([amount, Zero, Zero])
          expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
            0
          )
        })

        it("should start staking timestamp", async () => {
          expect(
            await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
          ).to.equal(blockTimestamp)
        })

        it("should transfer tokens to the staking contract", async () => {
          expect(await tToken.balanceOf(tokenStaking.address)).to.equal(amount)
        })

        it("should increase available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(amount)
        })

        it("should emit Staked event", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "Staked")
            .withArgs(
              StakeTypes.T,
              staker.address,
              stakingProvider.address,
              beneficiary.address,
              authorizer.address,
              amount
            )
        })

        it("should create a new checkpoint for staked total supply", async () => {
          const lastBlock = await mineBlocks(1)
          expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
            amount
          )
        })
        it("shouldn't create a new checkpoint for any stake role", async () => {
          expect(await tokenStaking.getVotes(staker.address)).to.equal(0)
          expect(await tokenStaking.getVotes(stakingProvider.address)).to.equal(
            0
          )
          expect(await tokenStaking.getVotes(beneficiary.address)).to.equal(0)
          expect(await tokenStaking.getVotes(authorizer.address)).to.equal(0)
        })

        context("after vote delegation", () => {
          beforeEach(async () => {
            tx = await tokenStaking
              .connect(staker)
              .delegateVoting(stakingProvider.address, delegatee.address)
          })

          it("checkpoint for staked total supply should remain constant", async () => {
            const lastBlock = await mineBlocks(1)
            expect(
              await tokenStaking.getPastTotalSupply(lastBlock - 1)
            ).to.equal(amount)
          })

          it("should create a new checkpoint for staker's delegatee", async () => {
            expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
              amount
            )
          })

          it("shouldn't create a new checkpoint for any stake role", async () => {
            expect(await tokenStaking.getVotes(staker.address)).to.equal(0)
            expect(
              await tokenStaking.getVotes(stakingProvider.address)
            ).to.equal(0)
            expect(await tokenStaking.getVotes(beneficiary.address)).to.equal(0)
            expect(await tokenStaking.getVotes(authorizer.address)).to.equal(0)
          })
        })
      }
    )
  })

  describe("stakeKeep", () => {
    context("when caller did not provide staking provider", () => {
      it("should revert", async () => {
        await expect(tokenStaking.stakeKeep(AddressZero)).to.be.revertedWith(
          "Parameters must be specified"
        )
      })
    })

    context("when staking provider is in use", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tToken.connect(otherStaker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(otherStaker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        await expect(
          tokenStaking.stakeKeep(stakingProvider.address)
        ).to.be.revertedWith("Provider is already in use")
      })
    })

    context(
      "when specified address never was a staking provider in Keep",
      () => {
        it("should revert", async () => {
          await expect(
            tokenStaking.stakeKeep(stakingProvider.address)
          ).to.be.revertedWith("Nothing to sync")
        })
      }
    )

    context("when staking provider exists in Keep staking contract", () => {
      let tx

      context("when stake was canceled/withdrawn or not eligible", () => {
        it("should revert", async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            stakingProvider.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            0
          )
          await expect(
            tokenStaking.stakeKeep(stakingProvider.address)
          ).to.be.revertedWith("Nothing to sync")
        })
      })

      context("when stake is eligible", () => {
        const keepAmount = initialStakerBalance
        const tAmount = convertToT(keepAmount, keepRatio).result
        let blockTimestamp

        beforeEach(async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            stakingProvider.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepAmount
          )
          await keepStakingMock.setEligibility(
            stakingProvider.address,
            tokenStaking.address,
            true
          )
          tx = await tokenStaking.stakeKeep(stakingProvider.address)
          blockTimestamp = await lastBlockTime()
        })

        it("should set roles equal to the Keep values", async () => {
          expect(
            await tokenStaking.rolesOf(stakingProvider.address)
          ).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
          ])
        })

        it("should set value of stakes", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, tAmount, Zero])
          expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
            0
          )
        })

        it("should start staking timestamp", async () => {
          expect(
            await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
          ).to.equal(blockTimestamp)
        })

        it("should increase available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(tAmount)
        })

        it("should not increase min staked amount", async () => {
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.T
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.NU
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.KEEP
            )
          ).to.equal(0)
        })

        it("should emit Staked event", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "Staked")
            .withArgs(
              StakeTypes.KEEP,
              staker.address,
              stakingProvider.address,
              beneficiary.address,
              authorizer.address,
              tAmount
            )
        })

        it("should create a new checkpoint for staked total supply", async () => {
          const lastBlock = await mineBlocks(1)
          expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
            tAmount
          )
        })
        it("shouldn't create a new checkpoint for stake owner", async () => {
          expect(await tokenStaking.getVotes(staker.address)).to.equal(0)
        })

        context("after vote delegation", () => {
          beforeEach(async () => {
            tx = await tokenStaking
              .connect(staker)
              .delegateVoting(stakingProvider.address, delegatee.address)
          })

          it("should create a new checkpoint for staker's delegatee", async () => {
            expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
              tAmount
            )
          })

          it("checkpoint for staked total supply should remain constant", async () => {
            const lastBlock = await mineBlocks(1)
            expect(
              await tokenStaking.getPastTotalSupply(lastBlock - 1)
            ).to.equal(tAmount)
          })

          it("shouldn't create new checkpoint for any staker role", async () => {
            expect(
              await tokenStaking.getVotes(stakingProvider.address)
            ).to.equal(0)
            expect(await tokenStaking.getVotes(beneficiary.address)).to.equal(0)
            expect(await tokenStaking.getVotes(authorizer.address)).to.equal(0)
          })
        })
      })
    })
  })

  describe("stakeNu", () => {
    context("when caller did not provide staking provider", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .stakeNu(AddressZero, beneficiary.address, authorizer.address)
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when caller did not provide beneficiary", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .stakeNu(stakingProvider.address, AddressZero, authorizer.address)
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when caller did not provide authorizer", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .stakeNu(stakingProvider.address, beneficiary.address, AddressZero)
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when staking provider is in use", () => {
      context(
        "when other stake delegated to the specified staking provider",
        () => {
          it("should revert", async () => {
            const amount = initialStakerBalance
            await tToken
              .connect(otherStaker)
              .approve(tokenStaking.address, amount)
            await tokenStaking
              .connect(otherStaker)
              .stake(
                stakingProvider.address,
                beneficiary.address,
                authorizer.address,
                amount
              )
            await expect(
              tokenStaking
                .connect(staker)
                .stakeNu(
                  stakingProvider.address,
                  beneficiary.address,
                  authorizer.address
                )
            ).to.be.revertedWith("Provider is already in use")
          })
        }
      )

      context(
        "when staking provider is in use in Keep staking contract",
        () => {
          it("should revert", async () => {
            const createdAt = 1
            await keepStakingMock.setOperator(
              stakingProvider.address,
              otherStaker.address,
              AddressZero,
              AddressZero,
              createdAt,
              0,
              0
            )
            await expect(
              tokenStaking
                .connect(staker)
                .stakeNu(
                  stakingProvider.address,
                  beneficiary.address,
                  authorizer.address
                )
            ).to.be.revertedWith("Provider is already in use")
          })
        }
      )
    })

    context("when caller has no stake in NuCypher staking contract", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .stakeNu(
              stakingProvider.address,
              beneficiary.address,
              authorizer.address
            )
        ).to.be.revertedWith("Nothing to sync")
      })
    })

    context("when caller has stake in NuCypher staking contract", () => {
      const nuAmount = initialStakerBalance.add(1)
      const conversion = convertToT(nuAmount, nuRatio)
      const tAmount = conversion.result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount)

        tx = await tokenStaking
          .connect(staker)
          .stakeNu(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address
          )
        blockTimestamp = await lastBlockTime()
      })

      it("should set roles equal to the provided values", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
        ])
      })

      it("should set value of stakes", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, Zero, tAmount])
        expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
          nuAmount.sub(conversion.remainder)
        )
      })

      it("should start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should do callback to NuCypher staking contract", async () => {
        expect(await nucypherStakingMock.stakers(staker.address)).to.deep.equal(
          [nuAmount, stakingProvider.address]
        )
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(tAmount)
      })

      it("should emit Staked event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "Staked")
          .withArgs(
            StakeTypes.NU,
            staker.address,
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            tAmount
          )
      })

      it("should create a new checkpoint for staked total supply", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          tAmount
        )
      })
      it("shouldn't create a new checkpoint for stake owner", async () => {
        expect(await tokenStaking.getVotes(staker.address)).to.equal(0)
      })

      context("after vote delegation", () => {
        beforeEach(async () => {
          tx = await tokenStaking
            .connect(staker)
            .delegateVoting(stakingProvider.address, delegatee.address)
        })

        it("should create a new checkpoint for staker's delegatee", async () => {
          expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
            tAmount
          )
        })

        it("checkpoint for staked total supply should remain constant", async () => {
          const lastBlock = await mineBlocks(1)
          expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
            tAmount
          )
        })

        it("shouldn't create new checkpoint for any staker role", async () => {
          expect(await tokenStaking.getVotes(stakingProvider.address)).to.equal(
            0
          )
          expect(await tokenStaking.getVotes(beneficiary.address)).to.equal(0)
          expect(await tokenStaking.getVotes(authorizer.address)).to.equal(0)
        })
      })
    })
  })

  describe("refreshKeepManagedGrantOwner", () => {
    context("when staking provider has no delegated stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .refreshKeepStakeOwner(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when caller is neither old owner nor staking provider", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking
            .connect(authorizer)
            .refreshKeepStakeOwner(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    const contextRefreshKeepStakeOwner = (getCaller) => {
      context("when grantee was not changed", () => {
        let tx

        beforeEach(async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            stakingProvider.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            initialStakerBalance
          )
          await keepStakingMock.setEligibility(
            stakingProvider.address,
            tokenStaking.address,
            true
          )
          await tokenStaking.stakeKeep(stakingProvider.address)

          tx = await tokenStaking
            .connect(getCaller())
            .refreshKeepStakeOwner(stakingProvider.address)
        })

        it("should not update owner", async () => {
          expect(
            await tokenStaking.rolesOf(stakingProvider.address)
          ).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
          ])
        })

        it("should emit OwnerRefreshed", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "OwnerRefreshed")
            .withArgs(stakingProvider.address, staker.address, staker.address)
        })
      })

      context("when grantee was changed", () => {
        let tx

        beforeEach(async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            stakingProvider.address,
            otherStaker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            initialStakerBalance
          )
          await keepStakingMock.setEligibility(
            stakingProvider.address,
            tokenStaking.address,
            true
          )
          await tokenStaking.stakeKeep(stakingProvider.address)

          await keepStakingMock.setOperator(
            stakingProvider.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            initialStakerBalance
          )
          tx = await tokenStaking
            .connect(otherStaker)
            .refreshKeepStakeOwner(stakingProvider.address)
        })

        it("should update owner", async () => {
          expect(
            await tokenStaking.rolesOf(stakingProvider.address)
          ).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
          ])
        })

        it("should emit OwnerRefreshed", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "OwnerRefreshed")
            .withArgs(
              stakingProvider.address,
              otherStaker.address,
              staker.address
            )
        })
      })
    }

    context("when caller is the old owner", () => {
      contextRefreshKeepStakeOwner(() => {
        return staker
      })
    })

    context("when caller is the staking provider", () => {
      contextRefreshKeepStakeOwner(() => {
        return stakingProvider
      })
    })
  })

  describe("approveApplication", () => {
    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(staker).approveApplication(AddressZero)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when caller did not provide application", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(deployer).approveApplication(AddressZero)
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when application has already been approved", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
        ).to.be.revertedWith("Can't approve application")
      })
    })

    context("when application is disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
        ).to.be.revertedWith("Can't approve application")
      })
    })

    context("when approving new application", () => {
      let tx

      beforeEach(async () => {
        tx = await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
      })

      it("should approve application", async () => {
        expect(
          await tokenStaking.applicationInfo(application1Mock.address)
        ).to.deep.equal([ApplicationStatus.APPROVED, AddressZero])
      })

      it("should add application to the list of all applications", async () => {
        expect(await tokenStaking.getApplicationsLength()).to.equal(1)
        expect(await tokenStaking.applications(0)).to.equal(
          application1Mock.address
        )
      })

      it("should emit ApplicationStatusChanged", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ApplicationStatusChanged")
          .withArgs(application1Mock.address, ApplicationStatus.APPROVED)
      })
    })

    context("when approving paused application", () => {
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .setPanicButton(application1Mock.address, panicButton.address)
        await tokenStaking
          .connect(panicButton)
          .pauseApplication(application1Mock.address)
        tx = await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
      })

      it("should enable application", async () => {
        expect(
          await tokenStaking.applicationInfo(application1Mock.address)
        ).to.deep.equal([ApplicationStatus.APPROVED, panicButton.address])
      })

      it("should keep list of all applications unchanged", async () => {
        expect(await tokenStaking.getApplicationsLength()).to.equal(1)
        expect(await tokenStaking.applications(0)).to.equal(
          application1Mock.address
        )
      })

      it("should emit ApplicationStatusChanged", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ApplicationStatusChanged")
          .withArgs(application1Mock.address, ApplicationStatus.APPROVED)
      })
    })
  })

  describe("increaseAuthorization", () => {
    context("when caller is not authorizer", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await expect(
          tokenStaking
            .connect(staker)
            .increaseAuthorization(
              stakingProvider.address,
              application1Mock.address,
              amount
            )
        ).to.be.revertedWith("Not authorizer")
      })
    })

    context(
      "when caller is authorizer of staking provider with T stake",
      () => {
        const amount = initialStakerBalance

        beforeEach(async () => {
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          await tokenStaking
            .connect(staker)
            .stake(
              stakingProvider.address,
              beneficiary.address,
              authorizer.address,
              amount
            )
        })

        context("when application was not approved", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  amount
                )
            ).to.be.revertedWith("Application is not approved")
          })
        })

        context("when application was approved", () => {
          beforeEach(async () => {
            await tokenStaking
              .connect(deployer)
              .approveApplication(application1Mock.address)
          })

          context("when application was paused", () => {
            it("should revert", async () => {
              await tokenStaking
                .connect(deployer)
                .setPanicButton(application1Mock.address, panicButton.address)
              await tokenStaking
                .connect(panicButton)
                .pauseApplication(application1Mock.address)
              await expect(
                tokenStaking
                  .connect(authorizer)
                  .increaseAuthorization(
                    stakingProvider.address,
                    application1Mock.address,
                    amount
                  )
              ).to.be.revertedWith("Application is not approved")
            })
          })

          context("when application is disabled", () => {
            it("should revert", async () => {
              await tokenStaking
                .connect(deployer)
                .disableApplication(application1Mock.address)
              await expect(
                tokenStaking
                  .connect(authorizer)
                  .increaseAuthorization(
                    stakingProvider.address,
                    application1Mock.address,
                    amount
                  )
              ).to.be.revertedWith("Application is not approved")
            })
          })

          context("when already authorized maximum applications", () => {
            it("should revert", async () => {
              await tokenStaking.connect(deployer).setAuthorizationCeiling(1)
              await tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  amount
                )
              await tokenStaking
                .connect(deployer)
                .approveApplication(application2Mock.address)
              await expect(
                tokenStaking
                  .connect(authorizer)
                  .increaseAuthorization(
                    stakingProvider.address,
                    application2Mock.address,
                    amount
                  )
              ).to.be.revertedWith("Too many applications")
            })
          })

          context("when authorize more than staked amount", () => {
            it("should revert", async () => {
              await expect(
                tokenStaking
                  .connect(authorizer)
                  .increaseAuthorization(
                    stakingProvider.address,
                    application1Mock.address,
                    amount.add(1)
                  )
              ).to.be.revertedWith("Not enough stake to authorize")
            })
          })

          context("when authorize staked tokens in one tx", () => {
            let tx
            const authorizedAmount = amount.div(3)

            beforeEach(async () => {
              tx = await tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  authorizedAmount
                )
            })

            it("should increase authorization", async () => {
              expect(
                await tokenStaking.authorizedStake(
                  stakingProvider.address,
                  application1Mock.address
                )
              ).to.equal(authorizedAmount)
            })

            it("should increase min staked amount in T", async () => {
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.T
                )
              ).to.equal(authorizedAmount)
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.NU
                )
              ).to.equal(0)
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.KEEP
                )
              ).to.equal(0)
            })

            it("should decrease available amount to authorize for one application", async () => {
              expect(
                await tokenStaking.getAvailableToAuthorize(
                  stakingProvider.address,
                  application1Mock.address
                )
              ).to.equal(amount.sub(authorizedAmount))
              expect(
                await tokenStaking.getAvailableToAuthorize(
                  stakingProvider.address,
                  application2Mock.address
                )
              ).to.equal(amount)
            })

            it("should inform application", async () => {
              expect(
                await application1Mock.stakingProviders(stakingProvider.address)
              ).to.deep.equal([authorizedAmount, Zero])
            })

            it("should emit AuthorizationIncreased", async () => {
              await expect(tx)
                .to.emit(tokenStaking, "AuthorizationIncreased")
                .withArgs(
                  stakingProvider.address,
                  application1Mock.address,
                  0,
                  authorizedAmount
                )
            })
          })

          context(
            "when authorize more than staked amount in several txs",
            () => {
              it("should revert", async () => {
                await tokenStaking
                  .connect(authorizer)
                  .increaseAuthorization(
                    stakingProvider.address,
                    application1Mock.address,
                    amount.sub(1)
                  )
                await expect(
                  tokenStaking
                    .connect(authorizer)
                    .increaseAuthorization(
                      stakingProvider.address,
                      application1Mock.address,
                      2
                    )
                ).to.be.revertedWith("Not enough stake to authorize")
              })
            }
          )

          context("when authorize staked tokens in several txs", () => {
            let tx1
            let tx2
            const authorizedAmount1 = amount.sub(1)
            const authorizedAmount2 = 1

            beforeEach(async () => {
              tx1 = await tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  authorizedAmount1
                )
              tx2 = await tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  authorizedAmount2
                )
            })

            it("should increase authorization", async () => {
              expect(
                await tokenStaking.authorizedStake(
                  stakingProvider.address,
                  application1Mock.address
                )
              ).to.equal(amount)
            })

            it("should decrease available amount to authorize for one application", async () => {
              expect(
                await tokenStaking.getAvailableToAuthorize(
                  stakingProvider.address,
                  application1Mock.address
                )
              ).to.equal(0)
              expect(
                await tokenStaking.getAvailableToAuthorize(
                  stakingProvider.address,
                  application2Mock.address
                )
              ).to.equal(amount)
            })

            it("should increase min staked amount in T", async () => {
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.T
                )
              ).to.equal(amount)
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.NU
                )
              ).to.equal(0)
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.KEEP
                )
              ).to.equal(0)
            })

            it("should inform application", async () => {
              expect(
                await application1Mock.stakingProviders(stakingProvider.address)
              ).to.deep.equal([amount, Zero])
            })

            it("should emit two AuthorizationIncreased", async () => {
              await expect(tx1)
                .to.emit(tokenStaking, "AuthorizationIncreased")
                .withArgs(
                  stakingProvider.address,
                  application1Mock.address,
                  0,
                  authorizedAmount1
                )
              await expect(tx2)
                .to.emit(tokenStaking, "AuthorizationIncreased")
                .withArgs(
                  stakingProvider.address,
                  application1Mock.address,
                  authorizedAmount1,
                  authorizedAmount1.add(authorizedAmount2)
                )
            })
          })

          context("when authorize after full deauthorization", () => {
            beforeEach(async () => {
              await tokenStaking.connect(deployer).setAuthorizationCeiling(1)
              await tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  amount
                )
              await tokenStaking
                .connect(authorizer)
                ["requestAuthorizationDecrease(address)"](
                  stakingProvider.address
                )
              await application1Mock.approveAuthorizationDecrease(
                stakingProvider.address
              )
              await tokenStaking
                .connect(deployer)
                .approveApplication(application2Mock.address)
              await tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application2Mock.address,
                  amount
                )
            })

            it("should increase authorization", async () => {
              expect(
                await tokenStaking.authorizedStake(
                  stakingProvider.address,
                  application1Mock.address
                )
              ).to.equal(0)
              expect(
                await tokenStaking.authorizedStake(
                  stakingProvider.address,
                  application2Mock.address
                )
              ).to.equal(amount)
            })
          })
        })
      }
    )

    context(
      "when caller is authorizer of staking provider with mixed stake",
      () => {
        const tStake = initialStakerBalance
        const keepStake = initialStakerBalance
        const keepInTStake = convertToT(keepStake, keepRatio).result
        const nuStake = initialStakerBalance
        const nuInTStake = convertToT(nuStake, nuRatio).result
        const tAmount = tStake.add(keepInTStake).add(nuInTStake)

        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)

          const createdAt = 1
          await keepStakingMock.setOperator(
            stakingProvider.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepStake
          )
          await keepStakingMock.setEligibility(
            stakingProvider.address,
            tokenStaking.address,
            true
          )
          tx = await tokenStaking.stakeKeep(stakingProvider.address)

          await nucypherStakingMock.setStaker(staker.address, nuStake)
          await tokenStaking
            .connect(stakingProvider)
            .topUpNu(stakingProvider.address)

          await tToken.connect(staker).approve(tokenStaking.address, tStake)
          await tokenStaking
            .connect(staker)
            .topUp(stakingProvider.address, tStake)
        })

        context("when authorize more than staked amount", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  tAmount.add(1)
                )
            ).to.be.revertedWith("Not enough stake to authorize")
          })
        })

        context("when authorize staked tokens in one tx", () => {
          let tx
          const notAuthorized = keepInTStake.sub(to1e18(1)) // tStake < keepInTStake < nuInTStake
          const authorizedAmount = tAmount.sub(notAuthorized)

          beforeEach(async () => {
            tx = await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                stakingProvider.address,
                application1Mock.address,
                authorizedAmount
              )
          })

          it("should increase authorization", async () => {
            expect(
              await tokenStaking.authorizedStake(
                stakingProvider.address,
                application1Mock.address
              )
            ).to.equal(authorizedAmount)
          })

          it("should increase min staked amount in KEEP and NU", async () => {
            expect(
              await tokenStaking.getMinStaked(
                stakingProvider.address,
                StakeTypes.T
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getMinStaked(
                stakingProvider.address,
                StakeTypes.NU
              )
            ).to.equal(nuInTStake.sub(notAuthorized))
            expect(
              await tokenStaking.getMinStaked(
                stakingProvider.address,
                StakeTypes.KEEP
              )
            ).to.equal(keepInTStake.sub(notAuthorized))
          })

          it("should decrease available amount to authorize for one application", async () => {
            expect(
              await tokenStaking.getAvailableToAuthorize(
                stakingProvider.address,
                application1Mock.address
              )
            ).to.equal(notAuthorized)
            expect(
              await tokenStaking.getAvailableToAuthorize(
                stakingProvider.address,
                application2Mock.address
              )
            ).to.equal(tAmount)
          })

          it("should inform application", async () => {
            expect(
              await application1Mock.stakingProviders(stakingProvider.address)
            ).to.deep.equal([authorizedAmount, Zero])
          })

          it("should emit AuthorizationIncreased", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationIncreased")
              .withArgs(
                stakingProvider.address,
                application1Mock.address,
                0,
                authorizedAmount
              )
          })

          context("when authorize to the second application", () => {
            let tx2

            beforeEach(async () => {
              await tokenStaking
                .connect(deployer)
                .approveApplication(application2Mock.address)

              tx2 = await tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application2Mock.address,
                  tAmount
                )
            })

            it("should increase only one authorization", async () => {
              expect(
                await tokenStaking.authorizedStake(
                  stakingProvider.address,
                  application1Mock.address
                )
              ).to.equal(authorizedAmount)
              expect(
                await tokenStaking.authorizedStake(
                  stakingProvider.address,
                  application2Mock.address
                )
              ).to.equal(tAmount)
            })

            it("should set min staked amount equal to T/NU/KEEP stake", async () => {
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.T
                )
              ).to.equal(tStake)
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.NU
                )
              ).to.equal(nuInTStake)
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.KEEP
                )
              ).to.equal(keepInTStake)
            })

            it("should decrease available amount to authorize for the second application", async () => {
              expect(
                await tokenStaking.getAvailableToAuthorize(
                  stakingProvider.address,
                  application1Mock.address
                )
              ).to.equal(notAuthorized)
              expect(
                await tokenStaking.getAvailableToAuthorize(
                  stakingProvider.address,
                  application2Mock.address
                )
              ).to.equal(0)
            })

            it("should inform second application", async () => {
              expect(
                await application2Mock.stakingProviders(stakingProvider.address)
              ).to.deep.equal([tAmount, Zero])
            })

            it("should emit AuthorizationIncreased", async () => {
              await expect(tx2)
                .to.emit(tokenStaking, "AuthorizationIncreased")
                .withArgs(
                  stakingProvider.address,
                  application2Mock.address,
                  0,
                  tAmount
                )
            })
          })
        })

        context("when authorize more than staked amount in several txs", () => {
          it("should revert", async () => {
            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                stakingProvider.address,
                application1Mock.address,
                tAmount.sub(1)
              )
            await expect(
              tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  2
                )
            ).to.be.revertedWith("Not enough stake to authorize")
          })
        })
      }
    )
  })

  describe("requestAuthorizationDecrease", () => {
    context("when caller is not authorizer", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await expect(
          tokenStaking
            .connect(staker)
            ["requestAuthorizationDecrease(address,address,uint96)"](
              stakingProvider.address,
              application1Mock.address,
              amount
            )
        ).to.be.revertedWith("Not authorizer")
      })
    })

    context(
      "when caller is authorizer of staking provider with T stake",
      () => {
        const amount = initialStakerBalance

        beforeEach(async () => {
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          await tokenStaking
            .connect(staker)
            .stake(
              stakingProvider.address,
              beneficiary.address,
              authorizer.address,
              amount
            )
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              stakingProvider.address,
              application1Mock.address,
              amount
            )
        })

        context("when application was paused", () => {
          it("should revert", async () => {
            const amount = initialStakerBalance
            await tokenStaking
              .connect(deployer)
              .setPanicButton(application1Mock.address, panicButton.address)
            await tokenStaking
              .connect(panicButton)
              .pauseApplication(application1Mock.address)
            await expect(
              tokenStaking
                .connect(authorizer)
                ["requestAuthorizationDecrease(address,address,uint96)"](
                  stakingProvider.address,
                  application1Mock.address,
                  amount
                )
            ).to.be.revertedWith("Application is not approved")
          })
        })

        context("when application is disabled", () => {
          it("should revert", async () => {
            await tokenStaking
              .connect(deployer)
              .disableApplication(application1Mock.address)
            await expect(
              tokenStaking
                .connect(authorizer)
                ["requestAuthorizationDecrease(address)"](
                  stakingProvider.address
                )
            ).to.be.revertedWith("Application is not approved")
          })
        })

        context("when amount to decrease is zero", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking
                .connect(authorizer)
                ["requestAuthorizationDecrease(address,address,uint96)"](
                  stakingProvider.address,
                  application1Mock.address,
                  0
                )
            ).to.be.revertedWith("Parameters must be specified")
          })
        })

        context("when amount to decrease is more than authorized", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking
                .connect(authorizer)
                ["requestAuthorizationDecrease(address,address,uint96)"](
                  stakingProvider.address,
                  application1Mock.address,
                  amount.add(1)
                )
            ).to.be.revertedWith("Amount exceeds authorized")
          })
        })

        context("when amount to decrease is less than authorized", () => {
          const amountToDecrease = amount.div(3)
          const expectedFromAmount = amount
          const expectedToAmount = amount.sub(amountToDecrease)
          let tx

          beforeEach(async () => {
            tx = await tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address,uint96)"](
                stakingProvider.address,
                application1Mock.address,
                amountToDecrease
              )
          })

          it("should keep authorized amount unchanged", async () => {
            expect(
              await tokenStaking.authorizedStake(
                stakingProvider.address,
                application1Mock.address
              )
            ).to.equal(amount)
          })

          it("should send request to application", async () => {
            expect(
              await application1Mock.stakingProviders(stakingProvider.address)
            ).to.deep.equal([amount, expectedToAmount])
          })

          it("should emit AuthorizationDecreaseRequested", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
              .withArgs(
                stakingProvider.address,
                application1Mock.address,
                expectedFromAmount,
                expectedToAmount
              )
          })
        })

        context(
          "when request to decrease all authorized amount for several applications",
          () => {
            let tx

            beforeEach(async () => {
              await tokenStaking
                .connect(deployer)
                .approveApplication(application2Mock.address)
              await tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application2Mock.address,
                  amount
                )
              tx = await tokenStaking
                .connect(authorizer)
                ["requestAuthorizationDecrease(address)"](
                  stakingProvider.address
                )
            })

            it("should keep authorized amount unchanged", async () => {
              expect(
                await tokenStaking.authorizedStake(
                  stakingProvider.address,
                  application1Mock.address
                )
              ).to.equal(amount)
              expect(
                await tokenStaking.authorizedStake(
                  stakingProvider.address,
                  application2Mock.address
                )
              ).to.equal(amount)
            })

            it("should send request to application", async () => {
              expect(
                await application1Mock.stakingProviders(stakingProvider.address)
              ).to.deep.equal([amount, Zero])
              expect(
                await application2Mock.stakingProviders(stakingProvider.address)
              ).to.deep.equal([amount, Zero])
            })

            it("should emit AuthorizationDecreaseRequested", async () => {
              await expect(tx)
                .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
                .withArgs(
                  stakingProvider.address,
                  application1Mock.address,
                  amount,
                  Zero
                )
              await expect(tx)
                .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
                .withArgs(
                  stakingProvider.address,
                  application2Mock.address,
                  amount,
                  Zero
                )
            })
          }
        )

        context("when decrease requested twice", () => {
          const expectedFromAmount = amount
          const amountToDecrease1 = amount.div(3)
          const expectedToAmount1 = amount.sub(amountToDecrease1)
          const amountToDecrease2 = amount.div(5)
          const expectedToAmount2 = amount.sub(amountToDecrease2)
          let tx1
          let tx2

          beforeEach(async () => {
            tx1 = await tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address,uint96)"](
                stakingProvider.address,
                application1Mock.address,
                amountToDecrease1
              )
            tx2 = await tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address,uint96)"](
                stakingProvider.address,
                application1Mock.address,
                amountToDecrease2
              )
          })

          it("should keep authorized amount unchanged", async () => {
            expect(
              await tokenStaking.authorizedStake(
                stakingProvider.address,
                application1Mock.address
              )
            ).to.equal(amount)
          })

          it("should send request to application with last amount", async () => {
            expect(
              await application1Mock.stakingProviders(stakingProvider.address)
            ).to.deep.equal([amount, expectedToAmount2])
          })

          it("should emit AuthorizationDecreaseRequested twice", async () => {
            await expect(tx1)
              .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
              .withArgs(
                stakingProvider.address,
                application1Mock.address,
                expectedFromAmount,
                expectedToAmount1
              )
            await expect(tx2)
              .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
              .withArgs(
                stakingProvider.address,
                application1Mock.address,
                expectedFromAmount,
                expectedToAmount2
              )
          })
        })
      }
    )
  })

  describe("approveAuthorizationDecrease", () => {
    const amount = initialStakerBalance

    beforeEach(async () => {
      await tToken.connect(staker).approve(tokenStaking.address, amount)
      await tokenStaking
        .connect(staker)
        .stake(
          stakingProvider.address,
          beneficiary.address,
          authorizer.address,
          amount
        )
      await tokenStaking
        .connect(deployer)
        .approveApplication(application1Mock.address)
      await tokenStaking
        .connect(authorizer)
        .increaseAuthorization(
          stakingProvider.address,
          application1Mock.address,
          amount
        )
    })

    context("when application was not approved", () => {
      it("should revert", async () => {
        await expect(
          application2Mock.approveAuthorizationDecrease(stakingProvider.address)
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context("when application was paused", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .setPanicButton(application1Mock.address, panicButton.address)
        await tokenStaking
          .connect(panicButton)
          .pauseApplication(application1Mock.address)
        await expect(
          application1Mock.approveAuthorizationDecrease(stakingProvider.address)
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context("when application is disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)
        await expect(
          application1Mock.approveAuthorizationDecrease(stakingProvider.address)
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context("when approve without request", () => {
      it("should revert", async () => {
        await expect(
          application1Mock.approveAuthorizationDecrease(stakingProvider.address)
        ).to.be.revertedWith("No deauthorizing in process")
      })
    })

    context("when approve twice", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount
          )
        await tokenStaking
          .connect(authorizer)
          ["requestAuthorizationDecrease(address)"](stakingProvider.address)
        application1Mock.approveAuthorizationDecrease(stakingProvider.address)
        await expect(
          application1Mock.approveAuthorizationDecrease(stakingProvider.address)
        ).to.be.revertedWith("No deauthorizing in process")
      })
    })

    context("when approve after request of partial deauthorization", () => {
      const amountToDecrease = amount.div(3)
      const expectedFromAmount = amount
      const expectedToAmount = amount.sub(amountToDecrease)
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(authorizer)
          ["requestAuthorizationDecrease(address,address,uint96)"](
            stakingProvider.address,
            application1Mock.address,
            amountToDecrease
          )
        tx = await application1Mock.approveAuthorizationDecrease(
          stakingProvider.address
        )
      })

      it("should decrease authorized amount", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(expectedToAmount)
      })

      it("should decrease min staked amount in T", async () => {
        expect(
          await tokenStaking.getMinStaked(stakingProvider.address, StakeTypes.T)
        ).to.equal(expectedToAmount)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.NU
          )
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.KEEP
          )
        ).to.equal(0)
      })

      it("should emit AuthorizationDecreaseApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application1Mock.address,
            expectedFromAmount,
            expectedToAmount
          )
      })
    })

    context(
      "when approve after request of full deauthorization for one app",
      () => {
        const otherAmount = amount.div(3)
        let tx

        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application2Mock.address)
          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              stakingProvider.address,
              application2Mock.address,
              otherAmount
            )
          await tokenStaking
            .connect(authorizer)
            ["requestAuthorizationDecrease(address,address,uint96)"](
              stakingProvider.address,
              application1Mock.address,
              amount
            )
          tx = await application1Mock.approveAuthorizationDecrease(
            stakingProvider.address
          )
        })

        it("should decrease authorized amount", async () => {
          expect(
            await tokenStaking.authorizedStake(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(0)
          expect(
            await tokenStaking.authorizedStake(
              stakingProvider.address,
              application2Mock.address
            )
          ).to.equal(otherAmount)
        })

        it("should decrease min staked amount in T", async () => {
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.T
            )
          ).to.equal(otherAmount)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.NU
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.KEEP
            )
          ).to.equal(0)
        })

        it("should emit AuthorizationDecreaseApproved", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
            .withArgs(
              stakingProvider.address,
              application1Mock.address,
              amount,
              Zero
            )
        })
      }
    )

    context(
      "when approve after request of full deauthorization for last app",
      () => {
        let tx

        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application2Mock.address)
          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              stakingProvider.address,
              application2Mock.address,
              amount
            )
          await tokenStaking
            .connect(authorizer)
            ["requestAuthorizationDecrease(address)"](stakingProvider.address)
          await application1Mock.approveAuthorizationDecrease(
            stakingProvider.address
          )
          tx = await application2Mock.approveAuthorizationDecrease(
            stakingProvider.address
          )
        })

        it("should decrease authorized amount", async () => {
          expect(
            await tokenStaking.authorizedStake(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(0)
          expect(
            await tokenStaking.authorizedStake(
              stakingProvider.address,
              application2Mock.address
            )
          ).to.equal(0)
        })

        it("should emit AuthorizationDecreaseApproved", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
            .withArgs(
              stakingProvider.address,
              application2Mock.address,
              amount,
              Zero
            )
        })
      }
    )
  })

  describe("forceDecreaseAuthorization", () => {
    context("when application is not approved", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(auxiliaryAccount)
            .forceDecreaseAuthorization(
              stakingProvider.address,
              application1Mock.address
            )
        ).to.be.revertedWith("Application is not disabled")
      })
    })

    context("when application is approved", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(deployer)
            .forceDecreaseAuthorization(
              stakingProvider.address,
              application1Mock.address
            )
        ).to.be.revertedWith("Application is not disabled")
      })
    })

    context("when application is paused", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .setPanicButton(application1Mock.address, panicButton.address)
        await tokenStaking
          .connect(panicButton)
          .pauseApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(staker)
            .forceDecreaseAuthorization(
              stakingProvider.address,
              application1Mock.address
            )
        ).to.be.revertedWith("Application is not disabled")
      })
    })

    context("when application was not authorized and got disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(deployer)
            .forceDecreaseAuthorization(
              stakingProvider.address,
              application1Mock.address
            )
        ).to.be.revertedWith("Application is not authorized")
      })
    })

    context("when application was authorized and got disabled", () => {
      const amount = initialStakerBalance
      let tx

      beforeEach(async () => {
        await tokenStaking.connect(deployer).setAuthorizationCeiling(1)
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )
        await tokenStaking
          .connect(authorizer)
          ["requestAuthorizationDecrease(address)"](stakingProvider.address)

        await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)

        tx = await tokenStaking
          .connect(deployer)
          .forceDecreaseAuthorization(
            stakingProvider.address,
            application1Mock.address
          )
      })

      it("should set authorized amount to 0", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(0)
      })

      it("should allow to authorize more applications", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount
          )
      })

      it("should emit AuthorizationDecreaseApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application1Mock.address,
            amount,
            0
          )
      })
    })
  })

  describe("pauseApplication", () => {
    beforeEach(async () => {
      await tokenStaking
        .connect(deployer)
        .approveApplication(application1Mock.address)
      await tokenStaking
        .connect(deployer)
        .setPanicButton(application1Mock.address, panicButton.address)
    })

    context("when caller is not the panic button address", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(deployer)
            .pauseApplication(application1Mock.address)
        ).to.be.revertedWith("Caller is not the panic button")
      })
    })

    context("when application is disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(panicButton)
            .pauseApplication(application1Mock.address)
        ).to.be.revertedWith("Can't pause application")
      })
    })

    context("when application was paused", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(panicButton)
          .pauseApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(panicButton)
            .pauseApplication(application1Mock.address)
        ).to.be.revertedWith("Can't pause application")
      })
    })

    context("when pause active application", () => {
      let tx

      beforeEach(async () => {
        tx = await tokenStaking
          .connect(panicButton)
          .pauseApplication(application1Mock.address)
      })

      it("should pause application", async () => {
        expect(
          await tokenStaking.applicationInfo(application1Mock.address)
        ).to.deep.equal([ApplicationStatus.PAUSED, panicButton.address])
      })

      it("should keep list of all applications unchanged", async () => {
        expect(await tokenStaking.getApplicationsLength()).to.equal(1)
        expect(await tokenStaking.applications(0)).to.equal(
          application1Mock.address
        )
      })

      it("should emit ApplicationStatusChanged", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ApplicationStatusChanged")
          .withArgs(application1Mock.address, ApplicationStatus.PAUSED)
      })
    })
  })

  describe("disableApplication", () => {
    beforeEach(async () => {
      await tokenStaking
        .connect(deployer)
        .approveApplication(application1Mock.address)
      await tokenStaking
        .connect(deployer)
        .setPanicButton(application1Mock.address, panicButton.address)
    })

    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(panicButton)
            .disableApplication(application1Mock.address)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when application is not approved", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(deployer)
            .disableApplication(application2Mock.address)
        ).to.be.revertedWith("Can't disable application")
      })
    })

    context("when application is disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(deployer)
            .disableApplication(application1Mock.address)
        ).to.be.revertedWith("Can't disable application")
      })
    })

    const contextDisable = (preparation) => {
      let tx

      beforeEach(async () => {
        await preparation()

        tx = await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)
      })

      it("should disable application", async () => {
        expect(
          await tokenStaking.applicationInfo(application1Mock.address)
        ).to.deep.equal([ApplicationStatus.DISABLED, panicButton.address])
      })

      it("should keep list of all applications unchanged", async () => {
        expect(await tokenStaking.getApplicationsLength()).to.equal(1)
        expect(await tokenStaking.applications(0)).to.equal(
          application1Mock.address
        )
      })

      it("should emit ApplicationStatusChanged", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ApplicationStatusChanged")
          .withArgs(application1Mock.address, ApplicationStatus.DISABLED)
      })
    }

    context("when disable approved application", () => {
      contextDisable(() => {})
    })

    context("when disable paused application", () => {
      contextDisable(async () => {
        await tokenStaking
          .connect(panicButton)
          .pauseApplication(application1Mock.address)
      })
    })
  })

  describe("setPanicButton", () => {
    beforeEach(async () => {
      await tokenStaking
        .connect(deployer)
        .approveApplication(application1Mock.address)
    })

    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .setPanicButton(application1Mock.address, panicButton.address)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when application was not approved", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(deployer)
            .setPanicButton(application2Mock.address, panicButton.address)
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context("when application is disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(deployer)
            .setPanicButton(application1Mock.address, panicButton.address)
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context("when set panic button address for approved application", () => {
      let tx

      beforeEach(async () => {
        tx = await tokenStaking
          .connect(deployer)
          .setPanicButton(application1Mock.address, panicButton.address)
      })

      it("should set address of panic button", async () => {
        expect(
          await tokenStaking.applicationInfo(application1Mock.address)
        ).to.deep.equal([ApplicationStatus.APPROVED, panicButton.address])
      })

      it("should emit PanicButtonSet", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "PanicButtonSet")
          .withArgs(application1Mock.address, panicButton.address)
      })
    })
  })

  describe("setAuthorizationCeiling", () => {
    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(staker).setAuthorizationCeiling(1)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when caller is the governance", () => {
      const ceiling = 10
      let tx

      beforeEach(async () => {
        tx = await tokenStaking
          .connect(deployer)
          .setAuthorizationCeiling(ceiling)
      })

      it("should set authorization ceiling", async () => {
        expect(await tokenStaking.authorizationCeiling()).to.equal(ceiling)
      })

      it("should emit AuthorizationCeilingSet", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationCeilingSet")
          .withArgs(ceiling)
      })
    })
  })

  describe("topUp", () => {
    context("when amount is zero", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .topUp(stakingProvider.address, 0)
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when staking provider has no delegated stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .topUp(stakingProvider.address, initialStakerBalance)
        ).to.be.revertedWith("Nothing to top-up")
      })
    })

    context("when staking provider has T stake", () => {
      const amount = initialStakerBalance.div(3)
      const topUpAmount = initialStakerBalance.mul(2)
      const expectedAmount = amount.add(topUpAmount)
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            amount
          )
        blockTimestamp = await lastBlockTime()

        await tokenStaking
          .connect(staker)
          .delegateVoting(stakingProvider.address, delegatee.address)
        await tToken
          .connect(deployer)
          .transfer(stakingProvider.address, topUpAmount)
        await tToken
          .connect(stakingProvider)
          .approve(tokenStaking.address, topUpAmount)
        tx = await tokenStaking
          .connect(stakingProvider)
          .topUp(stakingProvider.address, topUpAmount)
      })

      it("should update T staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([expectedAmount, Zero, Zero])
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([staker.address, staker.address, staker.address])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should transfer tokens to the staking contract", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedAmount
        )
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(expectedAmount)
      })

      it("should not increase min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(stakingProvider.address, StakeTypes.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.NU
          )
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.KEEP
          )
        ).to.equal(0)
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, topUpAmount)
      })

      it("should increase the delegatee voting power", async () => {
        expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
          expectedAmount
        )
      })

      it("should increase the total voting power", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          expectedAmount
        )
      })
    })

    context("when staking provider unstaked T previously", () => {
      const amount = initialStakerBalance
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, amount.mul(2))
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            amount
          )
        blockTimestamp = await lastBlockTime()

        await increaseTime(86400) // +24h

        await tokenStaking.connect(staker).unstakeAll(stakingProvider.address)
        tx = await tokenStaking
          .connect(staker)
          .topUp(stakingProvider.address, amount)
      })

      it("should update T staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([amount, Zero, Zero])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, amount)
      })
    })

    context("when staking provider has Keep stake", () => {
      const keepAmount = initialStakerBalance
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      const topUpAmount = initialStakerBalance.mul(2)
      const expectedAmount = keepInTAmount.add(topUpAmount)
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .setMinimumStakeAmount(topUpAmount.add(1))
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)
        blockTimestamp = await lastBlockTime()

        await tokenStaking
          .connect(staker)
          .delegateVoting(stakingProvider.address, delegatee.address)
        await tToken.connect(deployer).transfer(authorizer.address, topUpAmount)
        await tToken
          .connect(authorizer)
          .approve(tokenStaking.address, topUpAmount)
        tx = await tokenStaking
          .connect(authorizer)
          .topUp(stakingProvider.address, topUpAmount)
      })

      it("should update only T staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([topUpAmount, keepInTAmount, Zero])
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
        ])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(expectedAmount)
      })

      it("should transfer tokens to the staking contract", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          topUpAmount
        )
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, topUpAmount)
      })

      it("should increase the delegatee voting power", async () => {
        expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
          expectedAmount
        )
      })

      it("should increase the total voting power", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          expectedAmount
        )
      })
    })

    context("when staking provider has NuCypher stake", () => {
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const topUpAmount = initialStakerBalance.mul(2)
      const expectedAmount = nuInTAmount.add(topUpAmount)
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount)
        await tokenStaking
          .connect(staker)
          .stakeNu(stakingProvider.address, staker.address, staker.address)
        blockTimestamp = await lastBlockTime()

        await tokenStaking
          .connect(staker)
          .delegateVoting(stakingProvider.address, delegatee.address)
        await tToken
          .connect(deployer)
          .transfer(stakingProvider.address, topUpAmount)
        await tToken
          .connect(stakingProvider)
          .approve(tokenStaking.address, topUpAmount)
        tx = await tokenStaking
          .connect(stakingProvider)
          .topUp(stakingProvider.address, topUpAmount)
      })

      it("should update only T staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([topUpAmount, Zero, nuInTAmount])
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([staker.address, staker.address, staker.address])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(expectedAmount)
      })

      it("should transfer tokens to the staking contract", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          topUpAmount
        )
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, topUpAmount)
      })

      it("should increase the delegatee voting power", async () => {
        expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
          expectedAmount
        )
      })

      it("should increase the total voting power", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          expectedAmount
        )
      })
    })
  })

  describe("topUpKeep", () => {
    context("when staking provider has no delegated stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .topUpKeep(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when caller is not owner or staking provider", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(authorizer).topUpKeep(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context(
      "when specified address never was a staking provider in Keep",
      () => {
        it("should revert", async () => {
          const amount = initialStakerBalance
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          await tokenStaking
            .connect(staker)
            .stake(
              stakingProvider.address,
              beneficiary.address,
              authorizer.address,
              amount
            )
          await expect(
            tokenStaking
              .connect(stakingProvider)
              .topUpKeep(stakingProvider.address)
          ).to.be.revertedWith("Nothing to top-up")
        })
      }
    )

    context("when eligible stake is zero", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialStakerBalance
        )
        await expect(
          tokenStaking.connect(staker).topUpKeep(stakingProvider.address)
        ).to.be.revertedWith("Nothing to top-up")
      })
    })

    context("when eligible stake is less than cached", () => {
      it("should revert", async () => {
        const initialAmount = initialStakerBalance
        const amount = initialAmount.div(2)
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)
        await keepStakingMock.setAmount(stakingProvider.address, amount)
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .topUpKeep(stakingProvider.address)
        ).to.be.revertedWith("Nothing to top-up")
      })
    })

    context("when staking provider has Keep stake", () => {
      const initialKeepAmount = initialStakerBalance
      const initialKeepInTAmount = convertToT(
        initialKeepAmount,
        keepRatio
      ).result
      const newKeepAmount = initialStakerBalance.mul(2)
      const newKeepInTAmount = convertToT(newKeepAmount, keepRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialKeepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)
        blockTimestamp = await lastBlockTime()

        await tokenStaking
          .connect(staker)
          .delegateVoting(stakingProvider.address, delegatee.address)
        await keepStakingMock.setAmount(stakingProvider.address, newKeepAmount)
        tx = await tokenStaking
          .connect(stakingProvider)
          .topUpKeep(stakingProvider.address)
      })

      it("should update only Keep staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, newKeepInTAmount, Zero])
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
        ])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(newKeepInTAmount)
      })

      it("should not increase min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(stakingProvider.address, StakeTypes.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.NU
          )
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.KEEP
          )
        ).to.equal(0)
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(
            stakingProvider.address,
            newKeepInTAmount.sub(initialKeepInTAmount)
          )
      })

      it("should increase the delegatee voting power", async () => {
        expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
          newKeepInTAmount
        )
      })

      it("should increase the total voting power", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          newKeepInTAmount
        )
      })
    })

    context("when staking provider unstaked Keep previously", () => {
      const keepAmount = initialStakerBalance
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)
        blockTimestamp = await lastBlockTime()

        await increaseTime(86400) // +24h

        await tokenStaking.connect(staker).unstakeKeep(stakingProvider.address)
        tx = await tokenStaking
          .connect(staker)
          .topUpKeep(stakingProvider.address)
      })

      it("should update only Keep staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, keepInTAmount, Zero])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, keepInTAmount)
      })
    })

    context("when provider has T stake", () => {
      const tAmount = initialStakerBalance.div(3)
      const keepAmount = initialStakerBalance.mul(2)
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            tAmount
          )
        blockTimestamp = await lastBlockTime()

        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        tx = await tokenStaking
          .connect(staker)
          .topUpKeep(stakingProvider.address)
      })

      it("should update only Keep staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([tAmount, keepInTAmount, Zero])
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([staker.address, staker.address, staker.address])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(tAmount.add(keepInTAmount))
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, keepInTAmount)
      })
    })

    context("when staking provider has NuCypher stake", () => {
      const nuAmount = initialStakerBalance.div(3)
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const keepAmount = initialStakerBalance.mul(2)
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount)
        await tokenStaking
          .connect(staker)
          .stakeNu(stakingProvider.address, staker.address, staker.address)
        blockTimestamp = await lastBlockTime()

        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        tx = await tokenStaking
          .connect(stakingProvider)
          .topUpKeep(stakingProvider.address)
      })

      it("should update only Keep staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, keepInTAmount, nuInTAmount])
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([staker.address, staker.address, staker.address])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(nuInTAmount.add(keepInTAmount))
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, keepInTAmount)
      })
    })
  })

  describe("topUpNu", () => {
    context("when staking provider has no delegated stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(stakingProvider).topUpNu(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when caller is not owner or staking provider", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(authorizer).topUpNu(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when stake in NuCypher contract is zero", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        await expect(
          tokenStaking.connect(stakingProvider).topUpNu(stakingProvider.address)
        ).to.be.revertedWith("Nothing to top-up")
      })
    })

    context("when stake in NuCypher contract is less than cached", () => {
      it("should revert", async () => {
        const initialAmount = initialStakerBalance
        const amount = initialAmount.div(2)
        await nucypherStakingMock.setStaker(staker.address, initialAmount)
        await tokenStaking
          .connect(staker)
          .stakeNu(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address
          )
        await nucypherStakingMock.setStaker(staker.address, amount)
        await expect(
          tokenStaking.connect(staker).topUpNu(stakingProvider.address)
        ).to.be.revertedWith("Nothing to top-up")
      })
    })

    context("when staking provider has NuCypher stake", () => {
      const initialNuAmount = initialStakerBalance
      const initialNuInTAmount = convertToT(initialNuAmount, nuRatio).result
      const newNuAmount = initialStakerBalance.mul(2)
      const newNuInTAmount = convertToT(newNuAmount, nuRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, initialNuAmount)
        await tokenStaking
          .connect(staker)
          .stakeNu(stakingProvider.address, staker.address, staker.address)
        blockTimestamp = await lastBlockTime()

        await tokenStaking
          .connect(staker)
          .delegateVoting(stakingProvider.address, delegatee.address)
        await nucypherStakingMock.setStaker(staker.address, newNuAmount)
        tx = await tokenStaking.connect(staker).topUpNu(stakingProvider.address)
      })

      it("should update only Nu staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, Zero, newNuInTAmount])
        expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
          newNuAmount
        )
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([staker.address, staker.address, staker.address])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(newNuInTAmount)
      })

      it("should not increase min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(stakingProvider.address, StakeTypes.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.NU
          )
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.KEEP
          )
        ).to.equal(0)
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(
            stakingProvider.address,
            newNuInTAmount.sub(initialNuInTAmount)
          )
      })

      it("should increase the delegatee voting power", async () => {
        expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
          newNuInTAmount
        )
      })

      it("should increase the total voting power", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          newNuInTAmount
        )
      })
    })

    context("when staking provider unstaked Nu previously", () => {
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount)
        await tokenStaking
          .connect(staker)
          .stakeNu(stakingProvider.address, staker.address, staker.address)
        blockTimestamp = await lastBlockTime()

        await increaseTime(86400) // +24h
        await tokenStaking
          .connect(staker)
          .unstakeNu(stakingProvider.address, nuInTAmount)
        tx = await tokenStaking
          .connect(stakingProvider)
          .topUpNu(stakingProvider.address)
      })

      it("should update only Nu staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, Zero, nuInTAmount])
        expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
          nuAmount
        )
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, nuInTAmount)
      })
    })

    context("when staking provider has T stake", () => {
      const tAmount = initialStakerBalance.div(3)
      const nuAmount = initialStakerBalance.mul(2)
      const conversion = convertToT(nuAmount, nuRatio)
      const nuInTAmount = conversion.result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount)
        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            tAmount
          )
        blockTimestamp = await lastBlockTime()

        tx = await tokenStaking.connect(staker).topUpNu(stakingProvider.address)
      })

      it("should update only Nu staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([tAmount, Zero, nuInTAmount])
        expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
          nuAmount.sub(conversion.remainder)
        )
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([staker.address, staker.address, staker.address])
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(tAmount.add(nuInTAmount))
      })

      it("should do callback to NuCypher staking contract", async () => {
        expect(await nucypherStakingMock.stakers(staker.address)).to.deep.equal(
          [nuAmount, stakingProvider.address]
        )
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, nuInTAmount)
      })
    })

    context("when staking provider has Keep stake", () => {
      const keepAmount = initialStakerBalance.div(2)
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      const nuAmount = initialStakerBalance.mul(3)
      const conversion = convertToT(nuAmount, nuRatio)
      const nuInTAmount = conversion.result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)
        blockTimestamp = await lastBlockTime()

        await nucypherStakingMock.setStaker(staker.address, nuAmount)
        tx = await tokenStaking
          .connect(stakingProvider)
          .topUpNu(stakingProvider.address)
      })

      it("should update only Nu staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, keepInTAmount, nuInTAmount])
        expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
          nuAmount.sub(conversion.remainder)
        )
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
        ])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(nuInTAmount.add(keepInTAmount))
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(stakingProvider.address, nuInTAmount)
      })
    })
  })

  describe("unstakeT", () => {
    context("when staking provider has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeT(deployer.address, 0)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when caller is not owner or staking provider", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(authorizer).unstakeT(stakingProvider.address, 0)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when amount to unstake is zero", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(staker).unstakeT(stakingProvider.address, 0)
        ).to.be.revertedWith("Too much to unstake")
      })
    })

    context("when stake is only in Keep and Nu", () => {
      it("should revert", async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialStakerBalance
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)

        await nucypherStakingMock.setStaker(
          staker.address,
          initialStakerBalance
        )
        await tokenStaking.connect(staker).topUpNu(stakingProvider.address)

        const amountToUnstake = 1
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .unstakeT(stakingProvider.address, amountToUnstake)
        ).to.be.revertedWith("Too much to unstake")
      })
    })

    context("when amount to unstake is more than not authorized", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        const authorized = amount.div(3)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        const amountToUnstake = amount.sub(authorized).add(1)
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .unstakeT(stakingProvider.address, amountToUnstake)
        ).to.be.revertedWith("Too much to unstake")
      })
    })

    context("when unstake before minimum staking time passes", () => {
      const amount = initialStakerBalance
      const minAmount = initialStakerBalance.div(3)

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        await tokenStaking.connect(deployer).setMinimumStakeAmount(minAmount)
      })

      context("when the stake left would be above the minimum", () => {
        it("should revert", async () => {
          const amountToUnstake = amount.sub(minAmount).sub(1)
          await expect(
            tokenStaking
              .connect(staker)
              .unstakeT(stakingProvider.address, amountToUnstake)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })

      context("when the stake left would be the minimum", () => {
        it("should revert", async () => {
          const amountToUnstake = amount.sub(minAmount)
          await expect(
            tokenStaking
              .connect(staker)
              .unstakeT(stakingProvider.address, amountToUnstake)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })

      context("when the stake left would be below the minimum", () => {
        it("should revert", async () => {
          const amountToUnstake = amount.sub(minAmount).add(1)
          await expect(
            tokenStaking
              .connect(staker)
              .unstakeT(stakingProvider.address, amountToUnstake)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })

      context("when another stake type was topped-up", () => {
        it("should revert", async () => {
          const nuAmount = initialStakerBalance
          await nucypherStakingMock.setStaker(staker.address, nuAmount)
          await tokenStaking.connect(staker).topUpNu(stakingProvider.address)

          const amountToUnstake = amount
          await expect(
            tokenStaking
              .connect(staker)
              .unstakeT(stakingProvider.address, amountToUnstake)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })
    })

    context("when unstake after minimum staking time passes", () => {
      const amount = initialStakerBalance
      const minAmount = initialStakerBalance.div(3)
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await tokenStaking.connect(deployer).setMinimumStakeAmount(minAmount)
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        blockTimestamp = await lastBlockTime()

        await increaseTime(86400) // +24h

        tx = await tokenStaking
          .connect(stakingProvider)
          .unstakeT(stakingProvider.address, amount)
      })

      it("should update T staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, Zero, Zero])
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
        ])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should transfer tokens to the staker address", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(0)
        expect(await tToken.balanceOf(staker.address)).to.equal(amount)
      })

      it("should emit Unstaked", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "Unstaked")
          .withArgs(stakingProvider.address, amount)
      })
    })
  })

  describe("unstakeKeep", () => {
    context("when staking provider has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeKeep(deployer.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when caller is not owner or staking provider", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(authorizer).unstakeKeep(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when stake is only in T and Nu", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )

        await nucypherStakingMock.setStaker(
          staker.address,
          initialStakerBalance
        )
        await tokenStaking.connect(staker).topUpNu(stakingProvider.address)

        await expect(
          tokenStaking
            .connect(stakingProvider)
            .unstakeKeep(stakingProvider.address)
        ).to.be.revertedWith("Nothing to unstake")
      })
    })

    context("when authorized amount is more than non-Keep stake", () => {
      it("should revert", async () => {
        const tAmount = initialStakerBalance
        const keepAmount = initialStakerBalance

        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)

        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)

        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking
          .connect(staker)
          .topUp(stakingProvider.address, tAmount)

        const authorized = tAmount.add(1)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        await expect(
          tokenStaking.connect(staker).unstakeKeep(stakingProvider.address)
        ).to.be.revertedWith("Keep stake still authorized")
      })
    })

    context("when unstake before minimum staking time passes", () => {
      beforeEach(async () => {
        const keepAmount = initialStakerBalance
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)
      })

      context("when Keep was the only stake type", () => {
        it("should revert", async () => {
          await expect(
            tokenStaking.connect(staker).unstakeKeep(stakingProvider.address)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })

      context("when another stake type was topped-up", () => {
        it("should revert", async () => {
          const tAmount = initialStakerBalance
          await tToken.connect(staker).approve(tokenStaking.address, tAmount)
          await tokenStaking
            .connect(staker)
            .topUp(stakingProvider.address, tAmount)

          await expect(
            tokenStaking.connect(staker).unstakeKeep(stakingProvider.address)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })
    })

    context(
      "when authorized amount is less than non-Keep stake and enough time passed",
      () => {
        const tAmount = initialStakerBalance
        const keepAmount = initialStakerBalance
        const keepInTAmount = convertToT(keepAmount, keepRatio).result
        const authorized = tAmount
        let tx
        let blockTimestamp

        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)

          const createdAt = 1
          await keepStakingMock.setOperator(
            stakingProvider.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepAmount
          )
          await keepStakingMock.setEligibility(
            stakingProvider.address,
            tokenStaking.address,
            true
          )
          await tokenStaking.stakeKeep(stakingProvider.address)
          blockTimestamp = await lastBlockTime()

          await tokenStaking
            .connect(staker)
            .delegateVoting(stakingProvider.address, delegatee.address)

          await tToken.connect(staker).approve(tokenStaking.address, tAmount)
          await tokenStaking
            .connect(staker)
            .topUp(stakingProvider.address, tAmount)

          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              stakingProvider.address,
              application1Mock.address,
              authorized
            )

          await increaseTime(86400) // +24h

          tx = await tokenStaking
            .connect(stakingProvider)
            .unstakeKeep(stakingProvider.address)
        })

        it("should set Keep staked amount to zero", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([tAmount, Zero, Zero])
        })

        it("should not update roles", async () => {
          expect(
            await tokenStaking.rolesOf(stakingProvider.address)
          ).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
          ])
        })

        it("should not update start staking timestamp", async () => {
          expect(
            await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
          ).to.equal(blockTimestamp)
        })

        it("should decrease available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(tAmount.sub(authorized))
        })

        it("should update min staked amount", async () => {
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.T
            )
          ).to.equal(tAmount)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.NU
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.KEEP
            )
          ).to.equal(0)
        })

        it("should emit Unstaked", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "Unstaked")
            .withArgs(stakingProvider.address, keepInTAmount)
        })

        it("should decrease the delegatee voting power", async () => {
          expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
            tAmount
          )
        })

        it("should decrease the total voting power", async () => {
          const lastBlock = await mineBlocks(1)
          expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
            tAmount
          )
        })
      }
    )
  })

  describe("unstakeNu", () => {
    context("when staking provider has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeNu(deployer.address, 0)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when caller is not owner or staking provider", () => {
      it("should revert", async () => {
        await nucypherStakingMock.setStaker(
          staker.address,
          initialStakerBalance
        )
        await tokenStaking
          .connect(staker)
          .stakeNu(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address
          )
        await expect(
          tokenStaking.connect(authorizer).unstakeNu(stakingProvider.address, 0)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when unstake before minimum staking time passes", () => {
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const minTAmount = nuInTAmount.div(5)

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount)
        await tokenStaking
          .connect(staker)
          .stakeNu(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address
          )
      })

      context("when the stake left would be above the minimum", () => {
        it("should revert", async () => {
          const amountToUnstake = nuInTAmount.sub(minTAmount).sub(1)
          await expect(
            tokenStaking
              .connect(stakingProvider)
              .unstakeNu(stakingProvider.address, amountToUnstake)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })

      context("when the stake left would be the minimum", () => {
        it("should revert", async () => {
          const amountToUnstake = nuInTAmount.sub(minTAmount)
          await expect(
            tokenStaking
              .connect(stakingProvider)
              .unstakeNu(stakingProvider.address, amountToUnstake)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })

      context("when the stake left would be below the minimum", () => {
        it("should revert", async () => {
          const amountToUnstake = nuInTAmount.sub(minTAmount).add(1)
          await expect(
            tokenStaking
              .connect(stakingProvider)
              .unstakeNu(stakingProvider.address, amountToUnstake)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })

      context("when another stake type was topped-up", () => {
        it("should revert", async () => {
          await tToken.connect(staker).approve(tokenStaking.address, minTAmount)
          await tokenStaking
            .connect(staker)
            .topUp(stakingProvider.address, minTAmount)

          const amountToUnstake = nuInTAmount
          await expect(
            tokenStaking
              .connect(stakingProvider)
              .unstakeNu(stakingProvider.address, amountToUnstake)
          ).to.be.revertedWith("Can't unstake earlier than 24h")
        })
      })
    })

    context("when amount to unstake is zero", () => {
      it("should revert", async () => {
        await nucypherStakingMock.setStaker(
          staker.address,
          initialStakerBalance
        )
        await tokenStaking
          .connect(staker)
          .stakeNu(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address
          )
        await expect(
          tokenStaking.connect(staker).unstakeNu(stakingProvider.address, 0)
        ).to.be.revertedWith("Too much to unstake")
      })
    })

    context("when stake is only in Keep and T", () => {
      it("should revert", async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialStakerBalance
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)

        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .topUp(stakingProvider.address, initialStakerBalance)

        const amountToUnstake = 1
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .unstakeNu(stakingProvider.address, amountToUnstake)
        ).to.be.revertedWith("Too much to unstake")
      })
    })

    context("when amount to unstake is more than not authorized", () => {
      it("should revert", async () => {
        const nuAmount = initialStakerBalance
        const nuInTAmount = convertToT(nuAmount, nuRatio).result
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await nucypherStakingMock.setStaker(staker.address, nuAmount)
        await tokenStaking
          .connect(staker)
          .stakeNu(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address
          )

        const authorized = nuInTAmount.div(3)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        const notAuthorizedInT = nuInTAmount.sub(authorized)
        const notAuthorizedInNu = convertFromT(notAuthorizedInT, nuRatio).result
        const amountToUnstake = convertToT(
          notAuthorizedInNu.add(floatingPointDivisor),
          nuRatio
        ).result
        await expect(
          tokenStaking
            .connect(stakingProvider)
            .unstakeNu(stakingProvider.address, amountToUnstake)
        ).to.be.revertedWith("Too much to unstake")
      })
    })

    context(
      "when amount to unstake is less than not authorized and enough time passed",
      () => {
        const tAmount = initialStakerBalance
        const nuAmount = initialStakerBalance
        const nuInTAmount = convertToT(nuAmount, nuRatio).result
        const authorized = nuInTAmount.div(3).add(tAmount)
        const amountToUnstake = nuInTAmount.div(4).add(1)
        const expectedNuAmount = nuAmount.sub(
          convertFromT(amountToUnstake, nuRatio).result
        )
        const expectedNuInTAmount = convertToT(expectedNuAmount, nuRatio).result
        const expectedUnstaked = nuInTAmount.sub(expectedNuInTAmount)
        let tx
        let blockTimestamp

        beforeEach(async () => {
          await tokenStaking.connect(deployer).setMinimumStakeAmount(1)
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
          await nucypherStakingMock.setStaker(staker.address, nuAmount)
          await tokenStaking
            .connect(staker)
            .stakeNu(
              stakingProvider.address,
              beneficiary.address,
              authorizer.address
            )
          blockTimestamp = await lastBlockTime()

          await tokenStaking
            .connect(staker)
            .delegateVoting(stakingProvider.address, delegatee.address)
          await tToken.connect(staker).approve(tokenStaking.address, tAmount)
          await tokenStaking
            .connect(staker)
            .topUp(stakingProvider.address, tAmount)

          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              stakingProvider.address,
              application1Mock.address,
              authorized
            )

          await increaseTime(86400) // +24h
          tx = await tokenStaking
            .connect(stakingProvider)
            .unstakeNu(stakingProvider.address, amountToUnstake)
        })

        it("should update Nu staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([tAmount, Zero, expectedNuInTAmount])
          expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
            expectedNuAmount
          )
        })

        it("should not update roles", async () => {
          expect(
            await tokenStaking.rolesOf(stakingProvider.address)
          ).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
          ])
        })

        it("should start staking timestamp", async () => {
          expect(
            await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
          ).to.equal(blockTimestamp)
        })

        it("should decrease available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(expectedNuInTAmount.add(tAmount).sub(authorized))
        })

        it("should update min staked amount", async () => {
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.T
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.NU
            )
          ).to.equal(authorized.sub(tAmount))
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.KEEP
            )
          ).to.equal(0)
        })

        it("should emit Unstaked", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "Unstaked")
            .withArgs(stakingProvider.address, expectedUnstaked)
        })

        it("should decrease the delegatee voting power", async () => {
          expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
            expectedNuInTAmount.add(tAmount)
          )
        })

        it("should decrease the total voting power", async () => {
          const lastBlock = await mineBlocks(1)
          expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
            expectedNuInTAmount.add(tAmount)
          )
        })
      }
    )

    context(
      "when amount to unstake is less than not authorized only after rounding and enough time passed",
      () => {
        const nuAmount = initialStakerBalance
        const nuInTAmount = convertToT(nuAmount, nuRatio).result
        const authorized = nuInTAmount.div(3)
        const amountToUnstake = nuInTAmount.sub(authorized).add(1)
        const expectedNuAmount = nuAmount.sub(
          convertFromT(amountToUnstake, nuRatio).result
        )
        const expectedNuInTAmount = convertToT(expectedNuAmount, nuRatio).result
        const expectedUnstaked = nuInTAmount.sub(expectedNuInTAmount)
        let tx

        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
          await nucypherStakingMock.setStaker(staker.address, nuAmount)
          await tokenStaking
            .connect(staker)
            .stakeNu(
              stakingProvider.address,
              beneficiary.address,
              authorizer.address
            )

          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              stakingProvider.address,
              application1Mock.address,
              authorized
            )

          await increaseTime(86400) // +24h

          tx = await tokenStaking
            .connect(stakingProvider)
            .unstakeNu(stakingProvider.address, amountToUnstake)
        })

        it("should update Nu staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, expectedNuInTAmount])
          expect(await tokenStaking.stakedNu(stakingProvider.address)).to.equal(
            expectedNuAmount
          )
        })

        it("should emit Unstaked", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "Unstaked")
            .withArgs(stakingProvider.address, expectedUnstaked)
        })
      }
    )
  })

  describe("unstakeAll", () => {
    context("when staking provider has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeAll(deployer.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when caller is not owner or staking provider", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(authorizer).unstakeAll(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when authorized amount is not zero", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        const authorized = 1
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        await expect(
          tokenStaking
            .connect(stakingProvider)
            .unstakeAll(stakingProvider.address)
        ).to.be.revertedWith("Stake still authorized")
      })
    })

    context("when unstake T before minimum staking time passes", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        const minAmount = 1
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        await tokenStaking.connect(deployer).setMinimumStakeAmount(minAmount)

        await expect(
          tokenStaking.connect(staker).unstakeAll(stakingProvider.address)
        ).to.be.revertedWith("Can't unstake earlier than 24h")
      })
    })

    context("when unstake Nu before minimum staking time passes", () => {
      it("should revert", async () => {
        const nuAmount = initialStakerBalance
        await nucypherStakingMock.setStaker(staker.address, nuAmount)
        await tokenStaking
          .connect(staker)
          .stakeNu(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address
          )

        await expect(
          tokenStaking.connect(staker).unstakeAll(stakingProvider.address)
        ).to.be.revertedWith("Can't unstake earlier than 24h")
      })
    })

    context("when unstake Keep before minimum time passes", () => {
      it("should revert", async () => {
        const keepAmount = initialStakerBalance
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)

        await expect(
          tokenStaking.connect(staker).unstakeAll(stakingProvider.address)
        ).to.be.revertedWith("Can't unstake earlier than 24h")
      })
    })

    const contextUnstakeAll = (preparation, tAmount, nuAmount, keepAmount) => {
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        blockTimestamp = await preparation()

        tx = await tokenStaking
          .connect(stakingProvider)
          .unstakeAll(stakingProvider.address)
      })

      it("should update staked amount", async () => {
        expect(
          await tokenStaking.stakes(stakingProvider.address)
        ).to.deep.equal([Zero, Zero, Zero])
      })

      it("should not update roles", async () => {
        expect(
          await tokenStaking.rolesOf(stakingProvider.address)
        ).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
        ])
      })

      it("should not update start staking timestamp", async () => {
        expect(
          await tokenStaking.getStartStakingTimestamp(stakingProvider.address)
        ).to.equal(blockTimestamp)
      })

      it("should transfer tokens to the staker address", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(0)
        expect(await tToken.balanceOf(staker.address)).to.equal(
          initialStakerBalance
        )
      })

      it("should decrease available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(0)
      })

      it("should update min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(stakingProvider.address, StakeTypes.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.NU
          )
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            stakingProvider.address,
            StakeTypes.KEEP
          )
        ).to.equal(0)
      })

      it("should emit Unstaked", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "Unstaked")
          .withArgs(
            stakingProvider.address,
            nuInTAmount.add(keepInTAmount).add(tAmount)
          )
      })
    }

    context(
      "when unstake after minimum staking time passes for T stake",
      () => {
        // subtracting arbitrary values just to keep them different
        const tAmount = initialStakerBalance.sub(1)
        const nuAmount = initialStakerBalance.sub(2)
        const keepAmount = initialStakerBalance.sub(3)

        contextUnstakeAll(
          async () => {
            await tokenStaking
              .connect(deployer)
              .approveApplication(application1Mock.address)
            await tokenStaking.connect(deployer).setMinimumStakeAmount(1)

            //
            // stake T
            //
            await tToken.connect(staker).approve(tokenStaking.address, tAmount)
            await tokenStaking
              .connect(staker)
              .stake(
                stakingProvider.address,
                beneficiary.address,
                authorizer.address,
                tAmount
              )
            const blockTimestamp = await lastBlockTime()

            //
            // top-up KEEP
            //
            const createdAt = 1
            await keepStakingMock.setOperator(
              stakingProvider.address,
              staker.address,
              beneficiary.address,
              authorizer.address,
              createdAt,
              0,
              keepAmount
            )
            await keepStakingMock.setEligibility(
              stakingProvider.address,
              tokenStaking.address,
              true
            )
            await tokenStaking
              .connect(staker)
              .topUpKeep(stakingProvider.address)

            //
            // top-up NU
            //
            await nucypherStakingMock.setStaker(staker.address, nuAmount)
            await tokenStaking.connect(staker).topUpNu(stakingProvider.address)

            await increaseTime(86400) // +24h
            return blockTimestamp
          },
          tAmount,
          nuAmount,
          keepAmount
        )
      }
    )

    context(
      "when unstake after minimum staking time passes for NU stake",
      () => {
        // subtracting arbitrary values just to keep them different
        const tAmount = initialStakerBalance.sub(3)
        const nuAmount = initialStakerBalance.sub(1)
        const keepAmount = initialStakerBalance.sub(2)

        contextUnstakeAll(
          async () => {
            await tokenStaking
              .connect(deployer)
              .approveApplication(application1Mock.address)
            await tokenStaking.connect(deployer).setMinimumStakeAmount(1)

            //
            // stake NU
            //
            await nucypherStakingMock.setStaker(staker.address, nuAmount)
            await tokenStaking
              .connect(staker)
              .stakeNu(
                stakingProvider.address,
                beneficiary.address,
                authorizer.address
              )
            const blockTimestamp = await lastBlockTime()

            //
            // top-up KEEP
            //
            const createdAt = 1
            await keepStakingMock.setOperator(
              stakingProvider.address,
              staker.address,
              beneficiary.address,
              authorizer.address,
              createdAt,
              0,
              keepAmount
            )
            await keepStakingMock.setEligibility(
              stakingProvider.address,
              tokenStaking.address,
              true
            )
            await tokenStaking
              .connect(staker)
              .topUpKeep(stakingProvider.address)

            //
            // top-up T
            //
            await tToken.connect(staker).approve(tokenStaking.address, tAmount)
            await tokenStaking
              .connect(staker)
              .topUp(stakingProvider.address, tAmount)

            await increaseTime(86400) // +24h
            return blockTimestamp
          },
          tAmount,
          nuAmount,
          keepAmount
        )
      }
    )

    context("when unstake after minimum time passes for KEEP stake", () => {
      // subtracting arbitrary values just to keep them different
      const tAmount = initialStakerBalance.sub(3)
      const nuAmount = initialStakerBalance.sub(2)
      const keepAmount = initialStakerBalance.sub(1)

      contextUnstakeAll(
        async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
          await tokenStaking.connect(deployer).setMinimumStakeAmount(1)

          //
          // stake KEEP
          //
          const createdAt = 1
          await keepStakingMock.setOperator(
            stakingProvider.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepAmount
          )
          await keepStakingMock.setEligibility(
            stakingProvider.address,
            tokenStaking.address,
            true
          )
          await tokenStaking.stakeKeep(stakingProvider.address)
          const blockTimestamp = await lastBlockTime()

          //
          // top-up T
          //
          await tToken.connect(staker).approve(tokenStaking.address, tAmount)
          await tokenStaking
            .connect(staker)
            .topUp(stakingProvider.address, tAmount)

          //
          // top-up NU
          //
          await nucypherStakingMock.setStaker(staker.address, nuAmount)
          await tokenStaking.connect(staker).topUpNu(stakingProvider.address)

          await increaseTime(86400) // +24h
          return blockTimestamp
        },
        tAmount,
        nuAmount,
        keepAmount
      )
    })
  })

  describe("notifyKeepStakeDiscrepancy", () => {
    context("when staking provider has no cached Keep stake", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )

        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialStakerBalance
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )

        await expect(
          tokenStaking.notifyKeepStakeDiscrepancy(stakingProvider.address)
        ).to.be.revertedWith("Nothing to slash")
      })
    })

    context("when no discrepancy between T and Keep staking contracts", () => {
      const keepAmount = initialStakerBalance

      beforeEach(async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)
      })

      context("when stakes are equal in both contracts", () => {
        it("should revert", async () => {
          await expect(
            tokenStaking.notifyKeepStakeDiscrepancy(stakingProvider.address)
          ).to.be.revertedWith("There is no discrepancy")
        })
      })

      context(
        "when stake in Keep contract is greater than in T contract",
        () => {
          it("should revert", async () => {
            await keepStakingMock.setAmount(
              stakingProvider.address,
              keepAmount.mul(2)
            )
            await expect(
              tokenStaking.notifyKeepStakeDiscrepancy(stakingProvider.address)
            ).to.be.revertedWith("There is no discrepancy")
          })
        }
      )
    })

    context("when discrepancy between Keep and T stakes", () => {
      const keepAmount = initialStakerBalance
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      const newKeepAmount = keepAmount.div(3).add(1)
      const newKeepInTAmount = convertToT(newKeepAmount, keepRatio).result
      const createdAt = ethers.BigNumber.from(1)
      const tPenalty = newKeepInTAmount.div(10).add(1)
      const rewardMultiplier = 50
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)

        await keepStakingMock.setOperator(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          stakingProvider.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(stakingProvider.address)
      })

      context("when penalty is not set (no apps)", () => {
        beforeEach(async () => {
          await keepStakingMock.setAmount(
            stakingProvider.address,
            newKeepAmount
          )

          tx = await tokenStaking
            .connect(otherStaker)
            .notifyKeepStakeDiscrepancy(stakingProvider.address)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, newKeepInTAmount, Zero])
        })

        it("should decrease available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(newKeepInTAmount)
        })

        it("should not call seize in Keep contract", async () => {
          expect(
            await keepStakingMock.getDelegationInfo(stakingProvider.address)
          ).to.deep.equal([newKeepAmount, createdAt, Zero])
          expect(
            await keepStakingMock.tattletales(otherStaker.address)
          ).to.equal(0)
        })

        it("should emit TokensSeized", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, 0, true)
        })
      })

      context("when penalty in Keep is zero (no apps)", () => {
        beforeEach(async () => {
          const tPenalty = 1
          await keepStakingMock.setAmount(
            stakingProvider.address,
            newKeepAmount
          )
          await tokenStaking
            .connect(deployer)
            .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)

          tx = await tokenStaking
            .connect(otherStaker)
            .notifyKeepStakeDiscrepancy(stakingProvider.address)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, newKeepInTAmount, Zero])
        })

        it("should not call seize in Keep contract", async () => {
          expect(
            await keepStakingMock.getDelegationInfo(stakingProvider.address)
          ).to.deep.equal([newKeepAmount, createdAt, Zero])
          expect(
            await keepStakingMock.tattletales(otherStaker.address)
          ).to.equal(0)
        })

        it("should emit TokensSeized", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, 0, true)
        })
      })

      context("when staker has no Keep stake anymore (1 app)", () => {
        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
          await keepStakingMock.setAmount(stakingProvider.address, 0)

          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              stakingProvider.address,
              application1Mock.address,
              keepInTAmount
            )

          tx = await tokenStaking
            .connect(otherStaker)
            .notifyKeepStakeDiscrepancy(stakingProvider.address)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, Zero])
        })

        it("should decrease available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(0)
        })

        it("should update min staked amount", async () => {
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.T
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.NU
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.KEEP
            )
          ).to.equal(0)
        })

        it("should not call seize in Keep contract", async () => {
          expect(
            await keepStakingMock.getDelegationInfo(stakingProvider.address)
          ).to.deep.equal([Zero, createdAt, Zero])
          expect(
            await keepStakingMock.tattletales(otherStaker.address)
          ).to.equal(0)
        })

        it("should inform application", async () => {
          expect(
            await application1Mock.stakingProviders(stakingProvider.address)
          ).to.deep.equal([Zero, Zero])
        })

        it("should emit TokensSeized and AuthorizationInvoluntaryDecreased", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, 0, true)
          await expect(tx)
            .to.emit(tokenStaking, "AuthorizationInvoluntaryDecreased")
            .withArgs(
              stakingProvider.address,
              application1Mock.address,
              keepInTAmount,
              Zero,
              true
            )
        })
      })

      context(
        "when penalty is less than Keep stake (2 apps, 2 involuntary calls)",
        () => {
          const authorizedAmount1 = keepInTAmount.sub(1)
          const conversion = convertFromT(tPenalty, keepRatio)
          const keepPenalty = conversion.result
          const expectedKeepAmount = newKeepAmount.sub(keepPenalty)
          const expectedKeepInTAmount = convertToT(
            expectedKeepAmount,
            keepRatio
          ).result
          const expectedReward = rewardFromPenalty(
            keepPenalty,
            rewardMultiplier
          )
          const authorizedAmount2 = expectedKeepInTAmount.sub(1)
          const expectedTPenalty = tPenalty.sub(conversion.remainder)
          const expectedAuthorizedAmount1 = expectedKeepInTAmount
          const expectedAuthorizedAmount2 =
            authorizedAmount2.sub(expectedTPenalty)

          beforeEach(async () => {
            await tokenStaking
              .connect(deployer)
              .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
            await keepStakingMock.setAmount(
              stakingProvider.address,
              newKeepAmount
            )

            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                stakingProvider.address,
                application1Mock.address,
                authorizedAmount1
              )
            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                stakingProvider.address,
                application2Mock.address,
                authorizedAmount2
              )

            tx = await tokenStaking
              .connect(otherStaker)
              .notifyKeepStakeDiscrepancy(stakingProvider.address)
          })

          it("should update staked amount", async () => {
            expect(
              await tokenStaking.stakes(stakingProvider.address)
            ).to.deep.equal([Zero, expectedKeepInTAmount, Zero])
          })

          it("should decrease available amount to authorize", async () => {
            expect(
              await tokenStaking.getAvailableToAuthorize(
                stakingProvider.address,
                application1Mock.address
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getAvailableToAuthorize(
                stakingProvider.address,
                application2Mock.address
              )
            ).to.equal(expectedKeepInTAmount.sub(expectedAuthorizedAmount2))
          })

          it("should decrease authorized amount only for both applications", async () => {
            expect(
              await tokenStaking.authorizedStake(
                stakingProvider.address,
                application1Mock.address
              )
            ).to.equal(expectedAuthorizedAmount1)
            expect(
              await tokenStaking.authorizedStake(
                stakingProvider.address,
                application2Mock.address
              )
            ).to.equal(expectedAuthorizedAmount2)
          })

          it("should update min staked amount", async () => {
            expect(
              await tokenStaking.getMinStaked(
                stakingProvider.address,
                StakeTypes.T
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getMinStaked(
                stakingProvider.address,
                StakeTypes.NU
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getMinStaked(
                stakingProvider.address,
                StakeTypes.KEEP
              )
            ).to.equal(expectedKeepInTAmount)
          })

          it("should call seize in Keep contract", async () => {
            expect(
              await keepStakingMock.getDelegationInfo(stakingProvider.address)
            ).to.deep.equal([expectedKeepAmount, createdAt, Zero])
            expect(
              await keepStakingMock.tattletales(otherStaker.address)
            ).to.equal(expectedReward)
          })

          it("should inform only one application", async () => {
            expect(
              await application1Mock.stakingProviders(stakingProvider.address)
            ).to.deep.equal([expectedAuthorizedAmount1, Zero])
            expect(
              await application2Mock.stakingProviders(stakingProvider.address)
            ).to.deep.equal([expectedAuthorizedAmount2, Zero])
          })

          it("should emit TokensSeized and AuthorizationInvoluntaryDecreased", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "TokensSeized")
              .withArgs(
                stakingProvider.address,
                convertToT(keepPenalty, keepRatio).result,
                true
              )
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationInvoluntaryDecreased")
              .withArgs(
                stakingProvider.address,
                application1Mock.address,
                authorizedAmount1,
                expectedKeepInTAmount,
                true
              )
          })
        }
      )

      context(
        "when penalty is more than Keep stake (1 app with decreasing authorization)",
        () => {
          const keepPenalty = convertFromT(tPenalty, keepRatio)
          const newKeepAmount = keepPenalty.result.sub(1)
          const expectedKeepPenalty = convertToT(newKeepAmount, keepRatio)
          const expectedKeepAmount = expectedKeepPenalty.remainder
          const expectedReward = rewardFromPenalty(
            newKeepAmount.sub(expectedKeepAmount),
            rewardMultiplier
          )
          const tStake = initialStakerBalance
          const authorizedAmount = keepInTAmount.sub(1).add(tStake)
          const authorizationDeacrease = keepInTAmount.div(2).add(tStake)

          beforeEach(async () => {
            await tokenStaking
              .connect(deployer)
              .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
            await keepStakingMock.setAmount(
              stakingProvider.address,
              newKeepAmount
            )

            await tToken.connect(staker).approve(tokenStaking.address, tStake)
            await tokenStaking
              .connect(staker)
              .topUp(stakingProvider.address, tStake)

            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                stakingProvider.address,
                application1Mock.address,
                authorizedAmount
              )
            await tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address,uint96)"](
                stakingProvider.address,
                application1Mock.address,
                authorizationDeacrease
              )

            tx = await tokenStaking
              .connect(otherStaker)
              .notifyKeepStakeDiscrepancy(stakingProvider.address)
          })

          it("should update staked amount", async () => {
            expect(
              await tokenStaking.stakes(stakingProvider.address)
            ).to.deep.equal([tStake, Zero, Zero])
          })

          it("should decrease available amount to authorize", async () => {
            expect(
              await tokenStaking.getAvailableToAuthorize(
                stakingProvider.address,
                application1Mock.address
              )
            ).to.equal(0)
          })

          it("should decrease authorized amount", async () => {
            expect(
              await tokenStaking.authorizedStake(
                stakingProvider.address,
                application1Mock.address
              )
            ).to.equal(tStake)
          })

          it("should call seize in Keep contract", async () => {
            expect(
              await keepStakingMock.getDelegationInfo(stakingProvider.address)
            ).to.deep.equal([expectedKeepAmount, createdAt, Zero])
            expect(
              await keepStakingMock.tattletales(otherStaker.address)
            ).to.equal(expectedReward)
          })

          it("should inform application", async () => {
            expect(
              await application1Mock.stakingProviders(stakingProvider.address)
            ).to.deep.equal([tStake, Zero])
            await application1Mock.approveAuthorizationDecrease(
              stakingProvider.address
            )
            expect(
              await application1Mock.stakingProviders(stakingProvider.address)
            ).to.deep.equal([Zero, Zero])
          })

          it("should emit TokensSeized and AuthorizationInvoluntaryDecreased", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "TokensSeized")
              .withArgs(
                stakingProvider.address,
                expectedKeepPenalty.result,
                true
              )
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationInvoluntaryDecreased")
              .withArgs(
                stakingProvider.address,
                application1Mock.address,
                authorizedAmount,
                tStake,
                true
              )
          })
        }
      )

      context(
        "when started undelegating before unstake (2 broken apps)",
        () => {
          const authorizedAmount = keepInTAmount.sub(1)
          const keepPenalty = convertFromT(tPenalty, keepRatio).result
          const expectedKeepAmount = keepAmount.sub(keepPenalty)
          const expectedReward = rewardFromPenalty(
            keepPenalty,
            rewardMultiplier
          )
          const undelegatedAt = ethers.BigNumber.from(2)
          let brokenApplicationMock
          let expensiveApplicationMock

          beforeEach(async () => {
            const BrokenApplicationMock = await ethers.getContractFactory(
              "BrokenApplicationMock"
            )
            brokenApplicationMock = await BrokenApplicationMock.deploy(
              tokenStaking.address
            )
            await brokenApplicationMock.deployed()
            const ExpensiveApplicationMock = await ethers.getContractFactory(
              "ExpensiveApplicationMock"
            )
            expensiveApplicationMock = await ExpensiveApplicationMock.deploy(
              tokenStaking.address
            )
            await expensiveApplicationMock.deployed()

            await tokenStaking
              .connect(deployer)
              .approveApplication(brokenApplicationMock.address)
            await tokenStaking
              .connect(deployer)
              .approveApplication(expensiveApplicationMock.address)

            await tokenStaking
              .connect(deployer)
              .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
            await keepStakingMock.setUndelegatedAt(
              stakingProvider.address,
              undelegatedAt
            )

            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                stakingProvider.address,
                brokenApplicationMock.address,
                authorizedAmount
              )
            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                stakingProvider.address,
                expensiveApplicationMock.address,
                authorizedAmount
              )
            await tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address,uint96)"](
                stakingProvider.address,
                brokenApplicationMock.address,
                authorizedAmount
              )

            tx = await tokenStaking
              .connect(otherStaker)
              .notifyKeepStakeDiscrepancy(stakingProvider.address)
          })

          it("should update staked amount", async () => {
            expect(
              await tokenStaking.stakes(stakingProvider.address)
            ).to.deep.equal([Zero, Zero, Zero])
          })

          it("should decrease authorized amount for both applications", async () => {
            expect(
              await tokenStaking.authorizedStake(
                stakingProvider.address,
                brokenApplicationMock.address
              )
            ).to.equal(0)
            expect(
              await tokenStaking.authorizedStake(
                stakingProvider.address,
                expensiveApplicationMock.address
              )
            ).to.equal(0)
          })

          it("should call seize in Keep contract", async () => {
            expect(
              await keepStakingMock.getDelegationInfo(stakingProvider.address)
            ).to.deep.equal([expectedKeepAmount, createdAt, undelegatedAt])
            expect(
              await keepStakingMock.tattletales(otherStaker.address)
            ).to.equal(expectedReward)
          })

          it("should catch exceptions during application calls", async () => {
            expect(
              await brokenApplicationMock.stakingProviders(
                stakingProvider.address
              )
            ).to.deep.equal([authorizedAmount, Zero])
            expect(
              await expensiveApplicationMock.stakingProviders(
                stakingProvider.address
              )
            ).to.deep.equal([authorizedAmount, Zero])
            await expect(
              brokenApplicationMock.approveAuthorizationDecrease(
                stakingProvider.address
              )
            ).to.be.revertedWith("No deauthorizing in process")
          })

          it("should emit TokensSeized and AuthorizationInvoluntaryDecreased", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "TokensSeized")
              .withArgs(
                stakingProvider.address,
                convertToT(keepPenalty, keepRatio).result,
                true
              )
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationInvoluntaryDecreased")
              .withArgs(
                stakingProvider.address,
                brokenApplicationMock.address,
                authorizedAmount,
                Zero,
                false
              )
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationInvoluntaryDecreased")
              .withArgs(
                stakingProvider.address,
                expensiveApplicationMock.address,
                authorizedAmount,
                Zero,
                false
              )
          })
        }
      )
    })
  })

  describe("notifyNuStakeDiscrepancy", () => {
    const nuAmount = initialStakerBalance

    beforeEach(async () => {
      await nucypherStakingMock.setStaker(staker.address, nuAmount)
    })

    context("when staking provider has no cached Nu stake", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )

        await expect(
          tokenStaking.notifyNuStakeDiscrepancy(stakingProvider.address)
        ).to.be.revertedWith("Nothing to slash")
      })
    })

    context(
      "when no discrepancy between T and NuCypher staking contracts",
      () => {
        beforeEach(async () => {
          await tokenStaking
            .connect(staker)
            .stakeNu(
              stakingProvider.address,
              beneficiary.address,
              authorizer.address
            )
        })

        context("when stakes are equal in both contracts", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking.notifyNuStakeDiscrepancy(stakingProvider.address)
            ).to.be.revertedWith("There is no discrepancy")
          })
        })

        context(
          "when stake in NuCypher contract is greater than in T contract",
          () => {
            it("should revert", async () => {
              await nucypherStakingMock.setStaker(
                staker.address,
                nuAmount.mul(2)
              )
              await expect(
                tokenStaking.notifyNuStakeDiscrepancy(stakingProvider.address)
              ).to.be.revertedWith("There is no discrepancy")
            })
          }
        )
      }
    )

    context("when discrepancy between Nu and T stakes", () => {
      const newNuAmount = nuAmount.div(3).add(1)
      const newNuInTAmount = convertToT(newNuAmount, nuRatio).result
      const tPenalty = newNuInTAmount.div(10).add(1)
      const rewardMultiplier = 70
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(staker)
          .stakeNu(
            stakingProvider.address,
            beneficiary.address,
            authorizer.address
          )

        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
      })

      context("when penalty is not set (no apps)", () => {
        beforeEach(async () => {
          await nucypherStakingMock.setStaker(staker.address, newNuAmount)

          tx = await tokenStaking
            .connect(otherStaker)
            .notifyNuStakeDiscrepancy(stakingProvider.address)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, newNuInTAmount])
        })

        it("should decrease available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(newNuInTAmount)
        })

        it("should not call seize in NuCypher contract", async () => {
          expect(
            await nucypherStakingMock.stakers(staker.address)
          ).to.deep.equal([newNuAmount, stakingProvider.address])
          expect(
            await nucypherStakingMock.investigators(otherStaker.address)
          ).to.equal(0)
        })

        it("should emit TokensSeized", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, 0, true)
        })
      })

      context("when penalty in Nu is zero (no apps)", () => {
        beforeEach(async () => {
          const tPenalty = 1
          await tokenStaking
            .connect(deployer)
            .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)

          await nucypherStakingMock.setStaker(staker.address, newNuAmount)

          tx = await tokenStaking
            .connect(otherStaker)
            .notifyNuStakeDiscrepancy(stakingProvider.address)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, newNuInTAmount])
        })

        it("should not call seize in NuCypher contract", async () => {
          expect(
            await nucypherStakingMock.stakers(staker.address)
          ).to.deep.equal([newNuAmount, stakingProvider.address])
          expect(
            await nucypherStakingMock.investigators(otherStaker.address)
          ).to.equal(0)
        })

        it("should emit TokensSeized", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, 0, true)
        })
      })

      context("when staker has no Nu stake anymore (1 app)", () => {
        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
          await nucypherStakingMock.setStaker(staker.address, 0)

          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              stakingProvider.address,
              application1Mock.address,
              newNuInTAmount
            )

          tx = await tokenStaking
            .connect(otherStaker)
            .notifyNuStakeDiscrepancy(stakingProvider.address)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, Zero])
        })

        it("should decrease available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(0)
        })

        it("should update min staked amount", async () => {
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.T
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.NU
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              stakingProvider.address,
              StakeTypes.KEEP
            )
          ).to.equal(0)
        })

        it("should not call seize in NuCypher contract", async () => {
          expect(
            await nucypherStakingMock.stakers(staker.address)
          ).to.deep.equal([Zero, stakingProvider.address])
          expect(
            await nucypherStakingMock.investigators(otherStaker.address)
          ).to.equal(0)
        })

        it("should inform application", async () => {
          expect(
            await application1Mock.stakingProviders(stakingProvider.address)
          ).to.deep.equal([Zero, Zero])
        })

        it("should emit TokensSeized and AuthorizationInvoluntaryDecreased", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, 0, true)
          await expect(tx)
            .to.emit(tokenStaking, "AuthorizationInvoluntaryDecreased")
            .withArgs(
              stakingProvider.address,
              application1Mock.address,
              newNuInTAmount,
              Zero,
              true
            )
        })
      })

      context("when penalty is less than Nu stake (no apps)", () => {
        const nuPenalty = convertFromT(tPenalty, nuRatio).result
        const expectedNuAmount = newNuAmount.sub(nuPenalty)
        const expectedNuInTAmount = convertToT(expectedNuAmount, nuRatio).result
        const expectedReward = rewardFromPenalty(nuPenalty, rewardMultiplier)

        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
          await nucypherStakingMock.setStaker(staker.address, newNuAmount)

          tx = await tokenStaking
            .connect(otherStaker)
            .notifyNuStakeDiscrepancy(stakingProvider.address)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, expectedNuInTAmount])
        })

        it("should call seize in NuCypher contract", async () => {
          expect(
            await nucypherStakingMock.stakers(staker.address)
          ).to.deep.equal([expectedNuAmount, stakingProvider.address])
          expect(
            await nucypherStakingMock.investigators(otherStaker.address)
          ).to.equal(expectedReward)
        })

        it("should emit TokensSeized", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(
              stakingProvider.address,
              convertToT(nuPenalty, nuRatio).result,
              true
            )
        })
      })

      context("when penalty is more than Nu stake (no apps)", () => {
        const nuPenalty = convertFromT(tPenalty, nuRatio)
        const newNuAmount = nuPenalty.result.sub(1)
        const expectedNuPenalty = convertToT(newNuAmount, nuRatio)
        const expectedNuAmount = expectedNuPenalty.remainder
        const expectedReward = rewardFromPenalty(
          newNuAmount.sub(expectedNuAmount),
          rewardMultiplier
        )

        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
          await nucypherStakingMock.setStaker(staker.address, newNuAmount)

          tx = await tokenStaking
            .connect(otherStaker)
            .notifyNuStakeDiscrepancy(stakingProvider.address)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, Zero])
        })

        it("should call seize in NuCypher contract", async () => {
          expect(
            await nucypherStakingMock.stakers(staker.address)
          ).to.deep.equal([expectedNuAmount, stakingProvider.address])
          expect(
            await nucypherStakingMock.investigators(otherStaker.address)
          ).to.equal(expectedReward)
        })

        it("should emit TokensSeized", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, expectedNuPenalty.result, true)
        })
      })
    })
  })

  describe("setStakeDiscrepancyPenalty", () => {
    const tPenalty = initialStakerBalance
    const rewardMultiplier = 100

    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when caller is the governance", () => {
      let tx

      beforeEach(async () => {
        tx = await tokenStaking
          .connect(deployer)
          .setStakeDiscrepancyPenalty(tPenalty, rewardMultiplier)
      })

      it("should set values", async () => {
        expect(await tokenStaking.stakeDiscrepancyPenalty()).to.equal(tPenalty)
        expect(await tokenStaking.stakeDiscrepancyRewardMultiplier()).to.equal(
          rewardMultiplier
        )
      })

      it("should emit StakeDiscrepancyPenaltySet event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "StakeDiscrepancyPenaltySet")
          .withArgs(tPenalty, rewardMultiplier)
      })
    })
  })

  describe("setNotificationReward", () => {
    const amount = initialStakerBalance

    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(staker).setNotificationReward(amount)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when caller is the governance", () => {
      let tx

      beforeEach(async () => {
        tx = await tokenStaking.connect(deployer).setNotificationReward(amount)
      })

      it("should set values", async () => {
        expect(await tokenStaking.notificationReward()).to.equal(amount)
      })

      it("should emit NotificationRewardSet event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "NotificationRewardSet")
          .withArgs(amount)
      })
    })
  })

  describe("pushNotificationReward", () => {
    context("when reward is zero", () => {
      it("should revert", async () => {
        await expect(tokenStaking.pushNotificationReward(0)).to.be.revertedWith(
          "Parameters must be specified"
        )
      })
    })

    context("when reward is not zero", () => {
      const reward = initialStakerBalance
      let tx

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, reward)
        tx = await tokenStaking.connect(staker).pushNotificationReward(reward)
      })

      it("should increase treasury amount", async () => {
        expect(await tokenStaking.notifiersTreasury()).to.equal(reward)
      })

      it("should transfer tokens to the staking contract", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(reward)
      })

      it("should emit NotificationRewardPushed event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "NotificationRewardPushed")
          .withArgs(reward)
      })
    })
  })

  describe("withdrawNotificationReward", () => {
    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .withdrawNotificationReward(deployer.address, 1)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when amount is more than in treasury", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(deployer)
            .withdrawNotificationReward(deployer.address, 1)
        ).to.be.revertedWith("Not enough tokens")
      })
    })

    context("when amount is less than in treasury", () => {
      const reward = initialStakerBalance
      const amount = reward.div(3)
      const expectedReward = reward.sub(amount)
      let tx

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, reward)
        await tokenStaking.connect(staker).pushNotificationReward(reward)
        tx = await tokenStaking
          .connect(deployer)
          .withdrawNotificationReward(auxiliaryAccount.address, amount)
      })

      it("should decrease treasury amount", async () => {
        expect(await tokenStaking.notifiersTreasury()).to.equal(expectedReward)
      })

      it("should transfer tokens to the recipient", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedReward
        )
        expect(await tToken.balanceOf(auxiliaryAccount.address)).to.equal(
          amount
        )
      })

      it("should emit NotificationRewardWithdrawn event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "NotificationRewardWithdrawn")
          .withArgs(auxiliaryAccount.address, amount)
      })
    })
  })

  describe("slash", () => {
    context("when amount is zero", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.slash(0, [stakingProvider.address])
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when staking providers were not provided", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.slash(initialStakerBalance, [])
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when application was not approved", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.slash(initialStakerBalance, [stakingProvider.address])
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context("when application was paused", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .setPanicButton(application1Mock.address, panicButton.address)
        await tokenStaking
          .connect(panicButton)
          .pauseApplication(application1Mock.address)
        await expect(
          application1Mock.slash(initialStakerBalance, [
            stakingProvider.address,
          ])
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context("when application is disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .disableApplication(application1Mock.address)
        await expect(
          application1Mock.slash(initialStakerBalance, [
            stakingProvider.address,
          ])
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context(
      "when application was not authorized by one staking provider",
      () => {
        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
          await application1Mock.slash(initialStakerBalance, [
            stakingProvider.address,
          ])
        })

        it("should skip this event", async () => {
          expect(await tokenStaking.getSlashingQueueLength()).to.equal(0)
        })
      }
    )

    context("when authorized amount is less than amount to slash", () => {
      const amount = initialStakerBalance
      const amountToSlash = convertToT(initialStakerBalance, nuRatio).result // amountToSlash > amount

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)

        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            amount
          )
        await tokenStaking
          .connect(staker)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )

        await nucypherStakingMock.setStaker(
          otherStaker.address,
          initialStakerBalance
        )
        await tokenStaking
          .connect(otherStaker)
          .stakeNu(
            otherStaker.address,
            otherStaker.address,
            otherStaker.address
          )
        await tokenStaking
          .connect(otherStaker)
          .increaseAuthorization(
            otherStaker.address,
            application1Mock.address,
            amountToSlash
          )

        await application1Mock.slash(amountToSlash, [
          stakingProvider.address,
          otherStaker.address,
        ])
      })

      it("should add two slashing events", async () => {
        expect(await tokenStaking.slashingQueue(0)).to.deep.equal([
          stakingProvider.address,
          amount,
        ])
        expect(await tokenStaking.slashingQueue(1)).to.deep.equal([
          otherStaker.address,
          amountToSlash,
        ])
        expect(await tokenStaking.getSlashingQueueLength()).to.equal(2)
      })
    })

    context("when authorized amount is more than amount to slash", () => {
      const amount = initialStakerBalance.div(2)
      const authorized = amount.div(2)
      const amountToSlash = authorized.div(2)

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)

        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            amount
          )
        await tokenStaking
          .connect(staker)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        await tokenStaking
          .connect(staker)
          .stake(
            otherStaker.address,
            otherStaker.address,
            otherStaker.address,
            amount
          )
        await tokenStaking
          .connect(otherStaker)
          .increaseAuthorization(
            otherStaker.address,
            application1Mock.address,
            amount
          )

        await application1Mock.slash(amountToSlash, [
          stakingProvider.address,
          otherStaker.address,
        ])
      })

      it("should add two slashing events", async () => {
        expect(await tokenStaking.slashingQueue(0)).to.deep.equal([
          stakingProvider.address,
          amountToSlash,
        ])
        expect(await tokenStaking.slashingQueue(1)).to.deep.equal([
          otherStaker.address,
          amountToSlash,
        ])
        expect(await tokenStaking.getSlashingQueueLength()).to.equal(2)
      })

      it("should keep index of queue unchanged", async () => {
        expect(await tokenStaking.slashingQueueIndex()).to.equal(0)
      })
    })
  })

  describe("seize", () => {
    const amount = initialStakerBalance.div(2)
    const authorized = amount.div(2)
    const amountToSlash = authorized.div(2)
    const rewardMultiplier = 75
    const rewardPerProvider = amount.div(10)
    const reward = rewardPerProvider.mul(10)
    let tx
    let notifier

    beforeEach(async () => {
      notifier = await ethers.Wallet.createRandom()
      await tokenStaking
        .connect(deployer)
        .approveApplication(application1Mock.address)

      await tToken
        .connect(staker)
        .approve(tokenStaking.address, initialStakerBalance)
      await tokenStaking
        .connect(staker)
        .stake(stakingProvider.address, staker.address, staker.address, amount)
      await tokenStaking
        .connect(staker)
        .increaseAuthorization(
          stakingProvider.address,
          application1Mock.address,
          authorized
        )

      await tokenStaking
        .connect(staker)
        .stake(
          otherStaker.address,
          otherStaker.address,
          otherStaker.address,
          amount
        )
      await tokenStaking
        .connect(otherStaker)
        .increaseAuthorization(
          otherStaker.address,
          application1Mock.address,
          amount
        )
    })

    context("when notifier was not specified", () => {
      beforeEach(async () => {
        await tToken.connect(deployer).approve(tokenStaking.address, reward)
        await tokenStaking.connect(deployer).pushNotificationReward(reward)
        await tokenStaking
          .connect(deployer)
          .setNotificationReward(rewardPerProvider)

        tx = await application1Mock.seize(
          amountToSlash,
          rewardMultiplier,
          AddressZero,
          [otherStaker.address, stakingProvider.address]
        )
      })

      it("should add two slashing events", async () => {
        expect(await tokenStaking.slashingQueue(0)).to.deep.equal([
          otherStaker.address,
          amountToSlash,
        ])
        expect(await tokenStaking.slashingQueue(1)).to.deep.equal([
          stakingProvider.address,
          amountToSlash,
        ])
        expect(await tokenStaking.getSlashingQueueLength()).to.equal(2)
      })

      it("should keep index of queue unchanged", async () => {
        expect(await tokenStaking.slashingQueueIndex()).to.equal(0)
      })

      it("should not transfer any tokens", async () => {
        expect(await tokenStaking.notifiersTreasury()).to.equal(reward)
        const expectedBalance = reward.add(amount.mul(2))
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedBalance
        )
        expect(await tToken.balanceOf(notifier.address)).to.equal(0)
      })
    })

    context("when reward per staking provider was not set", () => {
      beforeEach(async () => {
        await tToken.connect(deployer).approve(tokenStaking.address, reward)
        await tokenStaking.connect(deployer).pushNotificationReward(reward)

        tx = await application1Mock.seize(
          amountToSlash,
          rewardMultiplier,
          notifier.address,
          [stakingProvider.address]
        )
      })

      it("should add one slashing event", async () => {
        expect(await tokenStaking.slashingQueue(0)).to.deep.equal([
          stakingProvider.address,
          amountToSlash,
        ])
        expect(await tokenStaking.getSlashingQueueLength()).to.equal(1)
      })

      it("should keep index of queue unchanged", async () => {
        expect(await tokenStaking.slashingQueueIndex()).to.equal(0)
      })

      it("should not transfer any tokens", async () => {
        expect(await tokenStaking.notifiersTreasury()).to.equal(reward)
        const expectedBalance = reward.add(amount.mul(2))
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedBalance
        )
        expect(await tToken.balanceOf(notifier.address)).to.equal(0)
      })

      it("should emit NotifierRewarded event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "NotifierRewarded")
          .withArgs(notifier.address, 0)
      })
    })

    context("when no more reward for notifier", () => {
      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .setNotificationReward(rewardPerProvider)

        tx = await application1Mock.seize(
          amountToSlash,
          rewardMultiplier,
          notifier.address,
          [otherStaker.address]
        )
      })

      it("should add one slashing event", async () => {
        expect(await tokenStaking.slashingQueue(0)).to.deep.equal([
          otherStaker.address,
          amountToSlash,
        ])
      })

      it("should keep index of queue unchanged", async () => {
        expect(await tokenStaking.slashingQueueIndex()).to.equal(0)
      })

      it("should not transfer any tokens", async () => {
        expect(await tokenStaking.notifiersTreasury()).to.equal(0)
        const expectedBalance = amount.mul(2)
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedBalance
        )
        expect(await tToken.balanceOf(notifier.address)).to.equal(0)
      })

      it("should emit NotifierRewarded event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "NotifierRewarded")
          .withArgs(notifier.address, 0)
      })
    })

    context("when reward multiplier is zero", () => {
      beforeEach(async () => {
        await tToken.connect(deployer).approve(tokenStaking.address, reward)
        await tokenStaking.connect(deployer).pushNotificationReward(reward)
        await tokenStaking
          .connect(deployer)
          .setNotificationReward(rewardPerProvider)

        tx = await application1Mock.seize(amountToSlash, 0, notifier.address, [
          stakingProvider.address,
        ])
      })

      it("should not transfer any tokens", async () => {
        expect(await tokenStaking.notifiersTreasury()).to.equal(reward)
        const expectedBalance = reward.add(amount.mul(2))
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedBalance
        )
        expect(await tToken.balanceOf(notifier.address)).to.equal(0)
      })

      it("should emit NotifierRewarded event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "NotifierRewarded")
          .withArgs(notifier.address, 0)
      })
    })

    context("when reward is less than amount of tokens in treasury", () => {
      beforeEach(async () => {
        await tToken.connect(deployer).approve(tokenStaking.address, reward)
        await tokenStaking.connect(deployer).pushNotificationReward(reward)
        await tokenStaking
          .connect(deployer)
          .setNotificationReward(reward.sub(1))

        tx = await application1Mock.seize(
          amountToSlash,
          rewardMultiplier,
          notifier.address,
          [stakingProvider.address, otherStaker.address]
        )
      })

      it("should transfer all tokens", async () => {
        expect(await tokenStaking.notifiersTreasury()).to.equal(0)
        const expectedBalance = amount.mul(2)
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedBalance
        )
        expect(await tToken.balanceOf(notifier.address)).to.equal(reward)
      })

      it("should emit NotifierRewarded event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "NotifierRewarded")
          .withArgs(notifier.address, reward)
      })
    })

    context("when reward is greater than amount of tokens in treasury", () => {
      // 2 providers
      const expectedReward = rewardPerProvider
        .mul(2)
        .mul(rewardMultiplier)
        .div(100)

      beforeEach(async () => {
        await tToken.connect(deployer).approve(tokenStaking.address, reward)
        await tokenStaking.connect(deployer).pushNotificationReward(reward)
        await tokenStaking
          .connect(deployer)
          .setNotificationReward(rewardPerProvider)

        tx = await application1Mock.seize(
          amountToSlash,
          rewardMultiplier,
          notifier.address,
          [stakingProvider.address, otherStaker.address, authorizer.address]
        )
      })

      it("should transfer all tokens", async () => {
        const expectedTreasuryBalance = reward.sub(expectedReward)
        expect(await tokenStaking.notifiersTreasury()).to.equal(
          expectedTreasuryBalance
        )
        const expectedBalance = expectedTreasuryBalance.add(amount.mul(2))
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedBalance
        )
        expect(await tToken.balanceOf(notifier.address)).to.equal(
          expectedReward
        )
      })

      it("should emit NotifierRewarded event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "NotifierRewarded")
          .withArgs(notifier.address, expectedReward)
      })
    })
  })

  describe("processSlashing", () => {
    context("when queue is empty", () => {
      it("should revert", async () => {
        await expect(tokenStaking.processSlashing(1)).to.be.revertedWith(
          "Nothing to process"
        )
      })
    })

    context("when queue is not empty", () => {
      const keepAmount = initialStakerBalance
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const tAmount = initialStakerBalance.div(2)
      const tStake2 = keepInTAmount.add(nuInTAmount).add(tAmount)

      const provider1Authorized1 = tAmount.div(2)
      const amountToSlash = provider1Authorized1.div(2)
      const provider1Authorized2 = provider1Authorized1
      const provider2Authorized1 = tStake2
      const provider2Authorized2 = tAmount.div(100)

      const expectedTReward1 = rewardFromPenalty(amountToSlash, 100)
      const expectedTReward2 = rewardFromPenalty(tAmount, 100)

      const createdAt = ethers.BigNumber.from(1)
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)

        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            tAmount
          )
        await tokenStaking
          .connect(staker)
          .delegateVoting(stakingProvider.address, delegatee.address)
        await tokenStaking
          .connect(staker)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            provider1Authorized1
          )
        await tokenStaking
          .connect(staker)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            provider1Authorized2
          )

        await keepStakingMock.setOperator(
          otherStaker.address,
          otherStaker.address,
          otherStaker.address,
          otherStaker.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          otherStaker.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(otherStaker.address)
        await nucypherStakingMock.setStaker(otherStaker.address, nuAmount)
        await tokenStaking.connect(otherStaker).topUpNu(otherStaker.address)

        await tToken.connect(deployer).transfer(otherStaker.address, tAmount)
        await tToken.connect(otherStaker).approve(tokenStaking.address, tAmount)
        await tokenStaking
          .connect(otherStaker)
          .topUp(otherStaker.address, tAmount)

        await tokenStaking
          .connect(otherStaker)
          .increaseAuthorization(
            otherStaker.address,
            application1Mock.address,
            provider2Authorized1
          )
        await tokenStaking
          .connect(otherStaker)
          .increaseAuthorization(
            otherStaker.address,
            application2Mock.address,
            provider2Authorized2
          )

        await application1Mock.slash(amountToSlash, [
          stakingProvider.address,
          otherStaker.address,
        ])
        await application1Mock.slash(tStake2, [otherStaker.address])
      })

      context("when provided number is zero", () => {
        it("should revert", async () => {
          await expect(tokenStaking.processSlashing(0)).to.be.revertedWith(
            "Nothing to process"
          )
        })
      })

      context("when slash only one staking provider with T stake", () => {
        const expectedAmount = tAmount.sub(amountToSlash)

        beforeEach(async () => {
          tx = await tokenStaking.connect(auxiliaryAccount).processSlashing(1)
        })

        it("should update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([expectedAmount, Zero, Zero])
        })

        it("should decrease the delegatee voting power", async () => {
          expect(await tokenStaking.getVotes(delegatee.address)).to.equal(
            expectedAmount
          )
        })

        it("should update index of queue", async () => {
          expect(await tokenStaking.slashingQueueIndex()).to.equal(1)
          expect(await tokenStaking.getSlashingQueueLength()).to.equal(3)
        })

        it("should transfer reward to processor", async () => {
          const expectedBalance = tAmount.mul(2).sub(expectedTReward1)
          expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
            expectedBalance
          )
          expect(await tToken.balanceOf(auxiliaryAccount.address)).to.equal(
            expectedTReward1
          )
        })

        it("should increase amount in notifiers treasury ", async () => {
          const expectedTreasuryBalance = amountToSlash.sub(expectedTReward1)
          expect(await tokenStaking.notifiersTreasury()).to.equal(
            expectedTreasuryBalance
          )
        })

        it("should not call seize in Keep contract", async () => {
          expect(
            await keepStakingMock.getDelegationInfo(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, Zero])
          expect(
            await keepStakingMock.getDelegationInfo(otherStaker.address)
          ).to.deep.equal([keepAmount, createdAt, Zero])
          expect(
            await keepStakingMock.tattletales(auxiliaryAccount.address)
          ).to.equal(0)
        })

        it("should not call seize in NuCypher contract", async () => {
          expect(
            await nucypherStakingMock.stakers(staker.address)
          ).to.deep.equal([Zero, AddressZero])
          expect(
            await nucypherStakingMock.stakers(otherStaker.address)
          ).to.deep.equal([nuAmount, otherStaker.address])
          expect(
            await nucypherStakingMock.investigators(auxiliaryAccount.address)
          ).to.equal(0)
        })

        it("should decrease authorized amounts only for one provider", async () => {
          expect(
            await tokenStaking.authorizedStake(
              stakingProvider.address,
              application1Mock.address
            )
          ).to.equal(provider1Authorized1.sub(amountToSlash))
          expect(
            await tokenStaking.authorizedStake(
              stakingProvider.address,
              application2Mock.address
            )
          ).to.equal(provider1Authorized2.sub(amountToSlash))
          expect(
            await tokenStaking.authorizedStake(
              otherStaker.address,
              application1Mock.address
            )
          ).to.equal(provider2Authorized1)
          expect(
            await tokenStaking.authorizedStake(
              otherStaker.address,
              application2Mock.address
            )
          ).to.equal(provider2Authorized2)
        })

        it("should not allow to authorize more applications", async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(auxiliaryAccount.address)
          await tokenStaking.connect(deployer).setAuthorizationCeiling(2)

          await expect(
            tokenStaking
              .connect(staker)
              .increaseAuthorization(
                stakingProvider.address,
                auxiliaryAccount.address,
                1
              )
          ).to.be.revertedWith("Too many applications")
        })

        it("should inform all applications", async () => {
          expect(
            await application1Mock.stakingProviders(stakingProvider.address)
          ).to.deep.equal([provider1Authorized1.sub(amountToSlash), Zero])
          expect(
            await application2Mock.stakingProviders(stakingProvider.address)
          ).to.deep.equal([provider1Authorized2.sub(amountToSlash), Zero])
          expect(
            await application1Mock.stakingProviders(otherStaker.address)
          ).to.deep.equal([provider2Authorized1, Zero])
          expect(
            await application2Mock.stakingProviders(otherStaker.address)
          ).to.deep.equal([provider2Authorized2, Zero])
        })

        it("should emit TokensSeized and SlashingProcessed events", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, amountToSlash, false)
          await expect(tx)
            .to.emit(tokenStaking, "SlashingProcessed")
            .withArgs(auxiliaryAccount.address, 1, expectedTReward1)
        })
      })

      context("when process everything in the queue", () => {
        const expectedReward = expectedTReward1.add(expectedTReward2)

        beforeEach(async () => {
          await tokenStaking.connect(auxiliaryAccount).processSlashing(1)
          await keepStakingMock.setAmount(
            otherStaker.address,
            keepAmount.div(2)
          )
          tx = await tokenStaking.connect(auxiliaryAccount).processSlashing(10)
        })

        it("should update staked amount", async () => {
          expect(await tokenStaking.stakes(otherStaker.address)).to.deep.equal([
            Zero,
            Zero,
            Zero,
          ])
        })

        it("should update index of queue", async () => {
          expect(await tokenStaking.slashingQueueIndex()).to.equal(3)
          expect(await tokenStaking.getSlashingQueueLength()).to.equal(3)
        })

        it("should transfer reward to processor", async () => {
          const expectedBalance = tAmount.mul(2).sub(expectedReward)
          expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
            expectedBalance
          )
          expect(await tToken.balanceOf(auxiliaryAccount.address)).to.equal(
            expectedReward
          )
        })

        it("should increase amount in notifiers treasury ", async () => {
          const expectedTreasuryBalance = amountToSlash
            .add(tAmount)
            .sub(expectedReward)
          expect(await tokenStaking.notifiersTreasury()).to.equal(
            expectedTreasuryBalance
          )
        })

        it("should call seize in Keep contract", async () => {
          const expectedKeepReward = rewardFromPenalty(keepAmount.div(2), 100)
          expect(
            await keepStakingMock.getDelegationInfo(otherStaker.address)
          ).to.deep.equal([Zero, createdAt, Zero])
          expect(
            await keepStakingMock.tattletales(auxiliaryAccount.address)
          ).to.equal(expectedKeepReward)
        })

        it("should call seize in NuCypher contract", async () => {
          const expectedNuReward = rewardFromPenalty(nuAmount, 100)
          expect(
            await nucypherStakingMock.stakers(otherStaker.address)
          ).to.deep.equal([Zero, otherStaker.address])
          expect(
            await nucypherStakingMock.investigators(auxiliaryAccount.address)
          ).to.equal(expectedNuReward)
        })

        it("should decrease authorized amount and inform applications", async () => {
          expect(
            await tokenStaking.authorizedStake(
              otherStaker.address,
              application1Mock.address
            )
          ).to.equal(0)
          expect(
            await tokenStaking.authorizedStake(
              otherStaker.address,
              application2Mock.address
            )
          ).to.equal(0)
          expect(
            await application1Mock.stakingProviders(otherStaker.address)
          ).to.deep.equal([Zero, Zero])
          expect(
            await application2Mock.stakingProviders(otherStaker.address)
          ).to.deep.equal([Zero, Zero])
        })

        it("should allow to authorize more applications", async () => {
          await tokenStaking.connect(deployer).setAuthorizationCeiling(2)
          await tToken.connect(deployer).transfer(otherStaker.address, tAmount)
          await tToken
            .connect(otherStaker)
            .approve(tokenStaking.address, tAmount)
          await tokenStaking
            .connect(otherStaker)
            .topUp(otherStaker.address, tAmount)

          await tokenStaking
            .connect(otherStaker)
            .increaseAuthorization(
              otherStaker.address,
              application1Mock.address,
              tAmount
            )
          await tokenStaking
            .connect(otherStaker)
            .increaseAuthorization(
              otherStaker.address,
              application2Mock.address,
              tAmount
            )
        })

        it("should emit TokensSeized, SlashingProcessed and AuthorizationInvoluntaryDecreased", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(otherStaker.address, amountToSlash, false)
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(
              otherStaker.address,
              tStake2.sub(amountToSlash).sub(keepInTAmount.div(2)),
              false
            )
          await expect(tx)
            .to.emit(tokenStaking, "SlashingProcessed")
            .withArgs(auxiliaryAccount.address, 2, expectedTReward2)
          await expect(tx)
            .to.emit(tokenStaking, "AuthorizationInvoluntaryDecreased")
            .withArgs(
              otherStaker.address,
              application1Mock.address,
              provider2Authorized1,
              provider2Authorized1.sub(amountToSlash),
              true
            )
          await expect(tx)
            .to.emit(tokenStaking, "AuthorizationInvoluntaryDecreased")
            .withArgs(
              otherStaker.address,
              application1Mock.address,
              provider2Authorized1.sub(amountToSlash),
              Zero,
              true
            )
        })
      })

      context("when staking provider has no stake anymore", () => {
        beforeEach(async () => {
          await tokenStaking
            .connect(staker)
            ["requestAuthorizationDecrease(address)"](stakingProvider.address)
          await application1Mock.approveAuthorizationDecrease(
            stakingProvider.address
          )
          await application2Mock.approveAuthorizationDecrease(
            stakingProvider.address
          )
          await increaseTime(86400) // +24h
          await tokenStaking
            .connect(stakingProvider)
            .unstakeAll(stakingProvider.address)
          tx = await tokenStaking.connect(auxiliaryAccount).processSlashing(1)
        })

        it("should not update staked amount", async () => {
          expect(
            await tokenStaking.stakes(stakingProvider.address)
          ).to.deep.equal([Zero, Zero, Zero])
        })

        it("should update index of queue", async () => {
          expect(await tokenStaking.slashingQueueIndex()).to.equal(1)
          expect(await tokenStaking.getSlashingQueueLength()).to.equal(3)
        })

        it("should not transfer reward to processor", async () => {
          const expectedBalance = tAmount
          expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
            expectedBalance
          )
          expect(await tToken.balanceOf(auxiliaryAccount.address)).to.equal(0)
        })

        it("should not increase amount in notifiers treasury ", async () => {
          expect(await tokenStaking.notifiersTreasury()).to.equal(0)
        })

        it("should emit TokensSeized and SlashingProcessed events", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TokensSeized")
            .withArgs(stakingProvider.address, 0, false)
          await expect(tx)
            .to.emit(tokenStaking, "SlashingProcessed")
            .withArgs(auxiliaryAccount.address, 1, 0)
        })
      })
    })

    context("when decrease authorized amount to zero", () => {
      const tAmount = initialStakerBalance

      const amountToSlash = tAmount.div(3)
      const authorized = amountToSlash

      beforeEach(async () => {
        await tokenStaking.connect(deployer).setAuthorizationCeiling(2)
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)

        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking
          .connect(staker)
          .stake(
            stakingProvider.address,
            staker.address,
            staker.address,
            tAmount
          )
        await tokenStaking
          .connect(staker)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            authorized
          )
        await tokenStaking
          .connect(staker)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        await application1Mock.slash(amountToSlash, [stakingProvider.address])

        await tokenStaking.processSlashing(1)
      })

      it("should decrease authorized amount", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(0)
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application2Mock.address
          )
        ).to.equal(0)
      })

      it("should allow to authorize one more application", async () => {
        await tokenStaking
          .connect(staker)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        await tokenStaking
          .connect(staker)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            authorized
          )

        await tokenStaking
          .connect(deployer)
          .approveApplication(auxiliaryAccount.address)
        await expect(
          tokenStaking
            .connect(staker)
            .increaseAuthorization(
              stakingProvider.address,
              auxiliaryAccount.address,
              authorized
            )
        ).to.be.revertedWith("Too many applications")
      })
    })
  })

  describe("cleanAuthorizedApplications", () => {
    const amount = initialStakerBalance
    let extendedTokenStaking

    beforeEach(async () => {
      const ExtendedTokenStaking = await ethers.getContractFactory(
        "ExtendedTokenStaking"
      )
      extendedTokenStaking = await ExtendedTokenStaking.deploy(
        tToken.address,
        keepStakingMock.address,
        nucypherStakingMock.address,
        keepVendingMachine.address,
        nucypherVendingMachine.address,
        keepStake.address
      )
      await extendedTokenStaking.deployed()
    })

    context("when all authorized applications with 0 authorization", () => {
      beforeEach(async () => {
        await extendedTokenStaking.setAuthorizedApplications(
          stakingProvider.address,
          [application1Mock.address, application2Mock.address]
        )
        await extendedTokenStaking.cleanAuthorizedApplications(
          stakingProvider.address,
          2
        )
      })

      it("should remove all applications", async () => {
        expect(
          await extendedTokenStaking.getAuthorizedApplications(
            stakingProvider.address
          )
        ).to.deep.equal([])
      })
    })

    context(
      "when one application in the end of the array with non-zero authorization",
      () => {
        beforeEach(async () => {
          await extendedTokenStaking.setAuthorizedApplications(
            stakingProvider.address,
            [application1Mock.address, application2Mock.address]
          )
          await extendedTokenStaking.setAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount
          )
          await extendedTokenStaking.cleanAuthorizedApplications(
            stakingProvider.address,
            1
          )
        })

        it("should remove only first application", async () => {
          expect(
            await extendedTokenStaking.getAuthorizedApplications(
              stakingProvider.address
            )
          ).to.deep.equal([application2Mock.address])
        })
      }
    )

    context(
      "when one application in the beggining of the array with non-zero authorization",
      () => {
        beforeEach(async () => {
          await extendedTokenStaking.setAuthorizedApplications(
            stakingProvider.address,
            [application1Mock.address, application2Mock.address]
          )
          await extendedTokenStaking.setAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )
          await extendedTokenStaking.cleanAuthorizedApplications(
            stakingProvider.address,
            1
          )
        })

        it("should remove only first application", async () => {
          expect(
            await extendedTokenStaking.getAuthorizedApplications(
              stakingProvider.address
            )
          ).to.deep.equal([application1Mock.address])
        })
      }
    )

    context(
      "when one application in the middle of the array with non-zero authorization",
      () => {
        beforeEach(async () => {
          await extendedTokenStaking.setAuthorizedApplications(
            stakingProvider.address,
            [
              application1Mock.address,
              application2Mock.address,
              auxiliaryAccount.address,
            ]
          )
          await extendedTokenStaking.setAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount
          )
          await extendedTokenStaking.cleanAuthorizedApplications(
            stakingProvider.address,
            2
          )
        })

        it("should remove first and last applications", async () => {
          expect(
            await extendedTokenStaking.getAuthorizedApplications(
              stakingProvider.address
            )
          ).to.deep.equal([application2Mock.address])
        })
      }
    )
  })
})

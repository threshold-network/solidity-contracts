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
  let nucypherVendingMachine
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
    nucypherVendingMachine = await VendingMachine.deploy(
      maxNuWrappedTokens,
      tAllocation
    )
    await nucypherVendingMachine.deployed()

    const TokenStaking = await ethers.getContractFactory("LegacyTokenStaking")
    const tokenStakingInitializerArgs = []
    tokenStaking = await upgrades.deployProxy(
      TokenStaking,
      tokenStakingInitializerArgs,
      {
        constructorArgs: [tToken.address, nucypherVendingMachine.address],
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
          await tokenStaking
            .connect(deployer)
            .setMinimumStakeAmount(initialStakerBalance)
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
          await assertStakes(stakingProvider.address, amount, Zero, Zero)
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
              await assertApplicationStakingProviders(
                application1Mock,
                stakingProvider.address,
                authorizedAmount,
                Zero
              )
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
              await assertApplicationStakingProviders(
                application1Mock,
                stakingProvider.address,
                amount,
                Zero
              )
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

        beforeEach(async () => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)

          await tokenStaking.setLegacyStakingProvider(
            stakingProvider.address,
            staker.address,
            beneficiary.address,
            authorizer.address
          )
          await tokenStaking.addLegacyStake(
            stakingProvider.address,
            keepInTStake,
            nuInTStake
          )

          await tToken.connect(staker).approve(tokenStaking.address, tStake)
          await tokenStaking
            .connect(staker)
            .topUp(stakingProvider.address, tStake)
        })

        context("when authorize more than not legacy staked amount", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  stakingProvider.address,
                  application1Mock.address,
                  tStake.add(1)
                )
            ).to.be.revertedWith("Not enough stake to authorize")
          })
        })

        context("when authorize staked tokens in one tx", () => {
          let tx
          const notAuthorized = tStake.sub(to1e18(1))
          const authorizedAmount = tStake.sub(notAuthorized)

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

          it("should increase min staked amount in T only", async () => {
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
            ).to.equal(notAuthorized)
            expect(
              await tokenStaking.getAvailableToAuthorize(
                stakingProvider.address,
                application2Mock.address
              )
            ).to.equal(tStake)
          })

          it("should inform application", async () => {
            await assertApplicationStakingProviders(
              application1Mock,
              stakingProvider.address,
              authorizedAmount,
              Zero
            )
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
                  tStake
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
              ).to.equal(tStake)
            })

            it("should set min staked amount equal to T stake", async () => {
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
              ).to.equal(0)
              expect(
                await tokenStaking.getMinStaked(
                  stakingProvider.address,
                  StakeTypes.KEEP
                )
              ).to.equal(0)
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
              await assertApplicationStakingProviders(
                application2Mock,
                stakingProvider.address,
                tStake,
                Zero
              )
            })

            it("should emit AuthorizationIncreased", async () => {
              await expect(tx2)
                .to.emit(tokenStaking, "AuthorizationIncreased")
                .withArgs(
                  stakingProvider.address,
                  application2Mock.address,
                  0,
                  tStake
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
                tStake.sub(1)
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
            await assertApplicationStakingProviders(
              application1Mock,
              stakingProvider.address,
              amount,
              expectedToAmount
            )
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
              await assertApplicationStakingProviders(
                application1Mock,
                stakingProvider.address,
                amount,
                Zero
              )
              await assertApplicationStakingProviders(
                application2Mock,
                stakingProvider.address,
                amount,
                Zero
              )
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
            await assertApplicationStakingProviders(
              application1Mock,
              stakingProvider.address,
              amount,
              expectedToAmount2
            )
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
        await assertStakes(stakingProvider.address, expectedAmount, Zero, Zero)
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
        await assertStakes(stakingProvider.address, amount, Zero, Zero)
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

        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          keepInTAmount,
          0
        )
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
        await assertStakes(
          stakingProvider.address,
          topUpAmount,
          keepInTAmount,
          Zero
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
        ).to.equal(topUpAmount)
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
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          staker.address,
          staker.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          0,
          nuInTAmount
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

      it("should update only T staked amount", async () => {
        await assertStakes(
          stakingProvider.address,
          topUpAmount,
          Zero,
          nuInTAmount
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
        ).to.equal(topUpAmount)
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
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          initialStakerBalance,
          initialStakerBalance
        )

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
          await tokenStaking.addLegacyStake(
            stakingProvider.address,
            0,
            nuAmount
          )

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
        await assertStakes(stakingProvider.address, Zero, Zero, Zero)
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

        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          0,
          initialStakerBalance
        )

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
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          keepAmount,
          0
        )

        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking
          .connect(staker)
          .topUp(stakingProvider.address, tAmount)

        const authorized = tAmount.add(1)
        await tokenStaking
          .connect(authorizer)
          .forceIncreaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        await expect(
          tokenStaking.connect(staker).unstakeKeep(stakingProvider.address)
        ).to.be.revertedWith("Keep stake still authorized")
      })
    })

    context("when authorized amount is less than non-Keep stake", () => {
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

        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          keepInTAmount,
          0
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

        tx = await tokenStaking
          .connect(stakingProvider)
          .unstakeKeep(stakingProvider.address)
      })

      it("should set Keep staked amount to zero", async () => {
        await assertStakes(stakingProvider.address, tAmount, Zero, Zero)
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
          await tokenStaking.getMinStaked(stakingProvider.address, StakeTypes.T)
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
        expect(await tokenStaking.getVotes(delegatee.address)).to.equal(tAmount)
      })

      it("should decrease the total voting power", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          tAmount
        )
      })
    })
  })

  describe("unstakeNu", () => {
    context("when staking provider has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeNu(deployer.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when caller is not owner or staking provider", () => {
      it("should revert", async () => {
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          0,
          initialStakerBalance
        )
        await expect(
          tokenStaking.connect(authorizer).unstakeNu(stakingProvider.address)
        ).to.be.revertedWith("Not owner or provider")
      })
    })

    context("when stake is only in Keep and T", () => {
      it("should revert", async () => {
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          initialStakerBalance,
          0
        )

        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .topUp(stakingProvider.address, initialStakerBalance)

        await expect(
          tokenStaking
            .connect(stakingProvider)
            .unstakeNu(stakingProvider.address)
        ).to.be.revertedWith("Nothing to unstake")
      })
    })

    context("when amount to unstake is more than not authorized", () => {
      it("should revert", async () => {
        const nuAmount = initialStakerBalance
        const nuInTAmount = convertToT(nuAmount, nuRatio).result
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          0,
          nuInTAmount
        )

        const authorized = nuInTAmount.div(3)
        await tokenStaking
          .connect(authorizer)
          .forceIncreaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            authorized
          )

        await expect(
          tokenStaking
            .connect(stakingProvider)
            .unstakeNu(stakingProvider.address)
        ).to.be.revertedWith("NU stake still authorized")
      })
    })

    context("when amount to unstake is less than not authorized", () => {
      const tAmount = initialStakerBalance
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const authorized = tAmount
      const expectedNuAmount = 0
      const expectedNuInTAmount = 0
      const expectedUnstaked = nuInTAmount
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await tokenStaking.connect(deployer).setMinimumStakeAmount(1)
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          0,
          nuInTAmount
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
          .unstakeNu(stakingProvider.address)
      })

      it("should update Nu staked amount", async () => {
        await assertStakes(
          stakingProvider.address,
          tAmount,
          Zero,
          expectedNuInTAmount
        )
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
        ).to.equal(0)
      })

      it("should update min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(stakingProvider.address, StakeTypes.T)
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
          .withArgs(stakingProvider.address, expectedUnstaked)
      })

      it("should decrease the delegatee voting power", async () => {
        expect(await tokenStaking.getVotes(delegatee.address)).to.equal(tAmount)
      })

      it("should decrease the total voting power", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          tAmount
        )
      })
    })
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
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(stakingProvider.address, 0, nuAmount)

        await expect(
          tokenStaking.connect(staker).unstakeAll(stakingProvider.address)
        ).to.be.revertedWith("Can't unstake earlier than 24h")
      })
    })

    context("when unstake Keep before minimum time passes", () => {
      it("should revert", async () => {
        const keepAmount = initialStakerBalance
        await tokenStaking.setLegacyStakingProvider(
          stakingProvider.address,
          staker.address,
          beneficiary.address,
          authorizer.address
        )
        await tokenStaking.addLegacyStake(
          stakingProvider.address,
          keepAmount,
          0
        )

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
        await assertStakes(stakingProvider.address, Zero, Zero, Zero)
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
        const nuInTAmount = convertToT(nuAmount, nuRatio).result
        const keepInTAmount = convertToT(keepAmount, keepRatio).result

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

            await tokenStaking.addLegacyStake(
              stakingProvider.address,
              keepInTAmount,
              nuInTAmount
            )

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
      "when unstake after minimum staking time passes for NU and KEEP stake",
      () => {
        // subtracting arbitrary values just to keep them different
        const tAmount = initialStakerBalance.sub(3)
        const nuAmount = initialStakerBalance.sub(1)
        const keepAmount = initialStakerBalance.sub(2)
        const nuInTAmount = convertToT(nuAmount, nuRatio).result
        const keepInTAmount = convertToT(keepAmount, keepRatio).result

        contextUnstakeAll(
          async () => {
            await tokenStaking
              .connect(deployer)
              .approveApplication(application1Mock.address)
            await tokenStaking.connect(deployer).setMinimumStakeAmount(1)

            //
            // legacy stake NU and KEEP
            //
            await tokenStaking.setLegacyStakingProvider(
              stakingProvider.address,
              staker.address,
              beneficiary.address,
              authorizer.address
            )
            await tokenStaking.addLegacyStake(
              stakingProvider.address,
              keepInTAmount,
              nuInTAmount
            )
            const blockTimestamp = await lastBlockTime()

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
      const amount = initialStakerBalance.div(2)
      const amountToSlash = initialStakerBalance // amountToSlash > amount

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

        await tToken
          .connect(otherStaker)
          .approve(tokenStaking.address, amountToSlash)
        await tokenStaking
          .connect(otherStaker)
          .stake(
            otherStaker.address,
            otherStaker.address,
            otherStaker.address,
            amountToSlash
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
        await assertSlashingQueue(0, stakingProvider.address, amount)
        await assertSlashingQueue(1, otherStaker.address, amountToSlash)
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
        await assertSlashingQueue(0, stakingProvider.address, amountToSlash)
        await assertSlashingQueue(1, otherStaker.address, amountToSlash)
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
        await assertSlashingQueue(0, otherStaker.address, amountToSlash)
        await assertSlashingQueue(1, stakingProvider.address, amountToSlash)
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
        await assertSlashingQueue(0, stakingProvider.address, amountToSlash)
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
        await assertSlashingQueue(0, otherStaker.address, amountToSlash)
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
      const tAmount = initialStakerBalance.div(2)
      const tStake2 = tAmount.mul(2)

      const provider1Authorized1 = tAmount.div(2)
      const amountToSlash = provider1Authorized1.div(2)
      const provider1Authorized2 = provider1Authorized1
      const provider2Authorized1 = tStake2
      const provider2Authorized2 = tAmount.div(100)

      const expectedTReward1 = rewardFromPenalty(amountToSlash, 100)
      const expectedTReward2 = rewardFromPenalty(tStake2, 100)

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

        await tToken.connect(deployer).transfer(otherStaker.address, tStake2)
        await tToken.connect(otherStaker).approve(tokenStaking.address, tStake2)
        await tokenStaking
          .connect(otherStaker)
          .stake(
            otherStaker.address,
            otherStaker.address,
            otherStaker.address,
            tStake2
          )

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
          await assertStakes(
            stakingProvider.address,
            expectedAmount,
            Zero,
            Zero
          )
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
          const expectedBalance = tAmount.add(tStake2).sub(expectedTReward1)
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
          await assertApplicationStakingProviders(
            application1Mock,
            stakingProvider.address,
            provider1Authorized1.sub(amountToSlash),
            Zero
          )
          await assertApplicationStakingProviders(
            application2Mock,
            stakingProvider.address,
            provider1Authorized2.sub(amountToSlash),
            Zero
          )
          await assertApplicationStakingProviders(
            application1Mock,
            otherStaker.address,
            provider2Authorized1,
            Zero
          )
          await assertApplicationStakingProviders(
            application2Mock,
            otherStaker.address,
            provider2Authorized2,
            Zero
          )
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
          tx = await tokenStaking.connect(auxiliaryAccount).processSlashing(10)
        })

        it("should update staked amount", async () => {
          await assertStakes(otherStaker.address, Zero, Zero, Zero)
        })

        it("should update index of queue", async () => {
          expect(await tokenStaking.slashingQueueIndex()).to.equal(3)
          expect(await tokenStaking.getSlashingQueueLength()).to.equal(3)
        })

        it("should transfer reward to processor", async () => {
          const expectedBalance = tAmount.add(tStake2).sub(expectedReward)
          expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
            expectedBalance
          )
          expect(await tToken.balanceOf(auxiliaryAccount.address)).to.equal(
            expectedReward
          )
        })

        it("should increase amount in notifiers treasury ", async () => {
          const expectedTreasuryBalance = amountToSlash
            .add(tStake2)
            .sub(expectedReward)
          expect(await tokenStaking.notifiersTreasury()).to.equal(
            expectedTreasuryBalance
          )
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
          await assertApplicationStakingProviders(
            application1Mock,
            otherStaker.address,
            Zero,
            Zero
          )
          await assertApplicationStakingProviders(
            application2Mock,
            otherStaker.address,
            Zero,
            Zero
          )
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
            .withArgs(otherStaker.address, tStake2.sub(amountToSlash), false)
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
          await assertStakes(stakingProvider.address, Zero, Zero, Zero)
        })

        it("should update index of queue", async () => {
          expect(await tokenStaking.slashingQueueIndex()).to.equal(1)
          expect(await tokenStaking.getSlashingQueueLength()).to.equal(3)
        })

        it("should not transfer reward to processor", async () => {
          const expectedBalance = tStake2
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
        nucypherVendingMachine.address
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

  async function assertStakes(
    address,
    expectedTStake,
    expectedKeepInTStake,
    expectedNuInTStake
  ) {
    expect(
      (await tokenStaking.stakes(address)).tStake,
      "invalid tStake"
    ).to.equal(expectedTStake)
    expect(
      (await tokenStaking.stakes(address)).keepInTStake,
      "invalid keepInTStake"
    ).to.equal(expectedKeepInTStake)
    expect(
      (await tokenStaking.stakes(address)).nuInTStake,
      "invalid nuInTStake"
    ).to.equal(expectedNuInTStake)
  }

  async function assertApplicationStakingProviders(
    applicationMock,
    stakingProviderAddress,
    expectedAuthorized,
    expectedDeauthorizingTo
  ) {
    expect(
      (await applicationMock.stakingProviders(stakingProviderAddress))
        .authorized,
      "invalid authorized"
    ).to.equal(expectedAuthorized)

    expect(
      (await applicationMock.stakingProviders(stakingProviderAddress))
        .deauthorizingTo,
      "invalid deauthorizingTo"
    ).to.equal(expectedDeauthorizingTo)
  }

  async function assertSlashingQueue(
    index,
    expectedStakingProviderAddress,
    expectedAmount
  ) {
    expect(
      (await tokenStaking.slashingQueue(index)).stakingProvider,
      "invalid stakingProvider"
    ).to.equal(expectedStakingProviderAddress)
    expect(
      (await tokenStaking.slashingQueue(index)).amount,
      "invalid amount"
    ).to.equal(expectedAmount)
  }
})

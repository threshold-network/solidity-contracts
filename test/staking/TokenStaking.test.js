const { expect } = require("chai")

const { helpers } = require("hardhat")
const { lastBlockTime, mineBlocks, increaseTime } = helpers.time
const { to1e18 } = helpers.number

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
  let application1Mock
  let application2Mock

  const tAllocation = to1e18("4500000000") // 4.5 Billion

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

    const ExtendedTokenStaking = await ethers.getContractFactory("ExtendedTokenStaking")
    const tokenStakingInitializerArgs = []
    tokenStaking = await upgrades.deployProxy(
      ExtendedTokenStaking,
      tokenStakingInitializerArgs,
      {
        constructorArgs: [tToken.address],
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
        expect(
          await tokenStaking.getMaxAuthorization(stakingProvider.address)
        ).to.equal(expectedToAmount)
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
          expect(
            await tokenStaking.getMaxAuthorization(stakingProvider.address)
          ).to.equal(otherAmount)
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
        await assertStake(stakingProvider.address, Zero)
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

  describe("cleanAuthorizedApplications", () => {
    const amount = initialStakerBalance

    context("when all authorized applications with 0 authorization", () => {
      beforeEach(async () => {
        await tokenStaking.setAuthorizedApplications(
          stakingProvider.address,
          [application1Mock.address, application2Mock.address]
        )
        await tokenStaking.cleanAuthorizedApplications(
          stakingProvider.address,
          2
        )
      })

      it("should remove all applications", async () => {
        expect(
          await tokenStaking.getAuthorizedApplications(
            stakingProvider.address
          )
        ).to.deep.equal([])
      })
    })

    context(
      "when one application in the end of the array with non-zero authorization",
      () => {
        beforeEach(async () => {
          await tokenStaking.setAuthorizedApplications(
            stakingProvider.address,
            [application1Mock.address, application2Mock.address]
          )
          await tokenStaking.setAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount
          )
          await tokenStaking.cleanAuthorizedApplications(
            stakingProvider.address,
            1
          )
        })

        it("should remove only first application", async () => {
          expect(
            await tokenStaking.getAuthorizedApplications(
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
          await tokenStaking.setAuthorizedApplications(
            stakingProvider.address,
            [application1Mock.address, application2Mock.address]
          )
          await tokenStaking.setAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )
          await tokenStaking.cleanAuthorizedApplications(
            stakingProvider.address,
            1
          )
        })

        it("should remove only first application", async () => {
          expect(
            await tokenStaking.getAuthorizedApplications(
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
          await tokenStaking.setAuthorizedApplications(
            stakingProvider.address,
            [
              application1Mock.address,
              application2Mock.address,
              auxiliaryAccount.address,
            ]
          )
          await tokenStaking.setAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount
          )
          await tokenStaking.cleanAuthorizedApplications(
            stakingProvider.address,
            2
          )
        })

        it("should remove first and last applications", async () => {
          expect(
            await tokenStaking.getAuthorizedApplications(
              stakingProvider.address
            )
          ).to.deep.equal([application2Mock.address])
        })
      }
    )
  })

  async function assertStake(address, expectedTStake) {
    expect(await tokenStaking.stakeAmount(address), "invalid tStake").to.equal(
      expectedTStake
    )
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
})

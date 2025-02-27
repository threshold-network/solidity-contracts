const { expect } = require("chai")

const { helpers } = require("hardhat")
const { lastBlockTime, mineBlocks, increaseTime } = helpers.time
const { to1e18 } = helpers.number

const { Zero } = ethers.constants

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

    const ExtendedTokenStaking = await ethers.getContractFactory(
      "ExtendedTokenStaking"
    )
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
          ["legacyRequestAuthorizationDecrease(address)"](
            stakingProvider.address
          )
        await application1Mock.approveAuthorizationDecrease(
          stakingProvider.address
        )
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
          ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
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
            ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
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
            ["legacyRequestAuthorizationDecrease(address)"](
              stakingProvider.address
            )
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
          ["legacyRequestAuthorizationDecrease(address)"](
            stakingProvider.address
          )

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

  describe("forceAuthorizationCap", () => {
    const maxStake = to1e18("15000000") // 15m
    const amount = maxStake.mul(2)

    beforeEach(async () => {
      await tToken.connect(deployer).transfer(staker.address, amount)

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
    })

    context("when stake is less than 15m", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            maxStake
          )
        await expect(
          tokenStaking
            .connect(authorizer)
            ["forceAuthorizationCap(address)"](stakingProvider.address)
        ).to.be.revertedWith("Nothing to deauthorize")
      })
    })

    context("when authorization is more than 15m for one application", () => {
      let tx
      const amount2 = maxStake.div(3)

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount2
          )

        tx = await tokenStaking
          .connect(deployer)
          ["forceAuthorizationCap(address)"](stakingProvider.address)
      })

      it("should set authorized amount to max", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(maxStake)
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application2Mock.address
          )
        ).to.equal(amount2)
      })

      it("should emit AuthorizationDecreaseApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application1Mock.address,
            amount,
            maxStake
          )
      })
    })

    context("when previous deauthorization is in process", () => {
      let tx
      const amountToDecrease = amount.div(20)
      const amountToDecrease2 = maxStake.add(amountToDecrease)

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount
          )

        await tokenStaking
          .connect(authorizer)
          ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
            stakingProvider.address,
            application1Mock.address,
            amountToDecrease
          )
        await tokenStaking
          .connect(authorizer)
          ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
            stakingProvider.address,
            application2Mock.address,
            amountToDecrease2
          )

        tx = await tokenStaking
          .connect(deployer)
          ["forceAuthorizationCap(address)"](stakingProvider.address)
      })

      it("should set authorized amount to max", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(maxStake)
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application2Mock.address
          )
        ).to.equal(maxStake)
      })

      it("should send request to application with last amount", async () => {
        expect(
          await tokenStaking.getDeauthorizingAmount(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(0)
        expect(
          await tokenStaking.getDeauthorizingAmount(
            stakingProvider.address,
            application2Mock.address
          )
        ).to.equal(amountToDecrease)
      })

      it("should emit AuthorizationDecreaseApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application1Mock.address,
            amount,
            maxStake
          )
      })
    })

    context("when sending transaction for multiple staking providers", () => {
      let tx

      beforeEach(async () => {
        await tToken.connect(deployer).transfer(otherStaker.address, amount)

        await tToken.connect(otherStaker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(otherStaker)
          .stake(
            otherStaker.address,
            otherStaker.address,
            otherStaker.address,
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
          .connect(otherStaker)
          .increaseAuthorization(
            otherStaker.address,
            application1Mock.address,
            amount
          )

        tx = await tokenStaking
          .connect(deployer)
          ["forceAuthorizationCap(address[])"]([
            stakingProvider.address,
            otherStaker.address,
          ])
      })

      it("should set authorized amount to max", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(maxStake)
        expect(
          await tokenStaking.authorizedStake(
            otherStaker.address,
            application1Mock.address
          )
        ).to.equal(maxStake)
      })

      it("should emit AuthorizationDecreaseApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application1Mock.address,
            amount,
            maxStake
          )
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            otherStaker.address,
            application1Mock.address,
            amount,
            maxStake
          )
      })
    })
  })

  describe("optOutDecreaseAuthorization", () => {
    const maxStake = to1e18("15000000") // 15m
    const amount = maxStake.mul(2)

    beforeEach(async () => {
      await tToken.connect(deployer).transfer(staker.address, amount)

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
    })

    context("when staking provider has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.optOutDecreaseAuthorization(stakingProvider.address, 0)
        ).to.be.revertedWith("Not authorizer")
      })
    })

    context("when amount to decrease is zero", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(authorizer)
            .optOutDecreaseAuthorization(stakingProvider.address, 0)
        ).to.be.revertedWith("Parameters must be specified")
      })
    })

    context("when request too big amount for opt-out", () => {
      const amount2 = maxStake.div(2)
      const amountToOptOut = amount2.div(2)

      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(authorizer)
            .optOutDecreaseAuthorization(stakingProvider.address, 1)
        ).to.be.revertedWith("Opt-out amount too high")

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount2
          )
        await expect(
          tokenStaking
            .connect(authorizer)
            .optOutDecreaseAuthorization(
              stakingProvider.address,
              amountToOptOut.add(1)
            )
        ).to.be.revertedWith("Opt-out amount too high")

        await tokenStaking
          .connect(authorizer)
          .optOutDecreaseAuthorization(stakingProvider.address, amountToOptOut)
        await expect(
          tokenStaking
            .connect(authorizer)
            .optOutDecreaseAuthorization(stakingProvider.address, 1)
        ).to.be.revertedWith("Opt-out amount too high")
      })
    })

    context("when authorization is more than 15m for one application", () => {
      let tx
      const amount2 = maxStake.sub(1)
      const amountToOptOut = maxStake.div(4)
      const expectedAmount = maxStake.sub(amountToOptOut)

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount2
          )

        tx = await tokenStaking
          .connect(authorizer)
          .optOutDecreaseAuthorization(stakingProvider.address, amountToOptOut)
      })

      it("should update authorized amount", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(expectedAmount)
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application2Mock.address
          )
        ).to.equal(expectedAmount)
      })

      it("should update available opt-out amount", async () => {
        expect(
          await tokenStaking.getAvailableOptOutAmount(stakingProvider.address)
        ).to.equal(maxStake.div(2).sub(amountToOptOut))
      })

      it("should emit AuthorizationDecreaseApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application1Mock.address,
            amount,
            maxStake
          )
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application1Mock.address,
            maxStake,
            expectedAmount
          )
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application2Mock.address,
            amount2,
            expectedAmount
          )
      })

      context("when use all opt-out amount and decrease after", () => {
        beforeEach(async () => {
          await tokenStaking
            .connect(authorizer)
            .optOutDecreaseAuthorization(
              stakingProvider.address,
              maxStake.div(2).sub(amountToOptOut)
            )

          await tokenStaking
            .connect(authorizer)
            ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
              stakingProvider.address,
              application1Mock.address,
              maxStake.div(4)
            )
          await tokenStaking
            .connect(authorizer)
            ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
              stakingProvider.address,
              application2Mock.address,
              maxStake.div(4)
            )
          await application1Mock.approveAuthorizationDecrease(
            stakingProvider.address
          )
          await application2Mock.approveAuthorizationDecrease(
            stakingProvider.address
          )
        })

        it("should update available opt-out amount", async () => {
          expect(
            await tokenStaking.getAvailableOptOutAmount(stakingProvider.address)
          ).to.equal(0)
        })

        it("should revert when calling for more opt-out", async () => {
          await expect(
            tokenStaking
              .connect(authorizer)
              .optOutDecreaseAuthorization(stakingProvider.address, 1)
          ).to.be.revertedWith("Opt-out amount too high")
        })
      })
    })

    context("when calling transaction multiple times", () => {
      let tx
      const amountToDecrease = amount.div(20)
      const amountToOptOut1 = maxStake.div(3)
      const amountToOptOut2 = maxStake.div(6)
      const expectedAmount = maxStake.sub(amountToOptOut1).sub(amountToOptOut2)

      beforeEach(async () => {
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )

        await tokenStaking
          .connect(authorizer)
          ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
            stakingProvider.address,
            application1Mock.address,
            amountToDecrease
          )

        await tokenStaking
          .connect(deployer)
          ["forceAuthorizationCap(address)"](stakingProvider.address)

        await tokenStaking
          .connect(authorizer)
          .optOutDecreaseAuthorization(stakingProvider.address, amountToOptOut1)
        tx = await tokenStaking
          .connect(authorizer)
          .optOutDecreaseAuthorization(stakingProvider.address, amountToOptOut2)
      })

      it("should update authorized amount", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(expectedAmount)
      })

      it("should update available opt-out amount", async () => {
        expect(
          await tokenStaking.getAvailableOptOutAmount(stakingProvider.address)
        ).to.equal(maxStake.div(2).sub(amountToOptOut1).sub(amountToOptOut2))
      })

      it("should cancel deauthorization amount", async () => {
        expect(
          await tokenStaking.getDeauthorizingAmount(
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
            application1Mock.address,
            maxStake.sub(amountToOptOut1),
            maxStake.sub(amountToOptOut1).sub(amountToOptOut2)
          )
      })
    })
  })

  describe("forceBetaStakerDecreaseAuthorization", () => {
    const amount = initialStakerBalance

    beforeEach(async () => {
      await tToken.connect(deployer).transfer(staker.address, amount.mul(10))

      await tokenStaking
        .connect(deployer)
        .approveApplication(application1Mock.address)
      await tToken.connect(staker).approve(tokenStaking.address, amount.mul(10))
      await tokenStaking
        .connect(staker)
        .stake(
          stakingProvider.address,
          beneficiary.address,
          authorizer.address,
          amount
        )
    })

    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(stakingProvider)
            ["forceBetaStakerDecreaseAuthorization(address)"](
              stakingProvider.address
            )
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when nothing was authorized", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(deployer)
            ["forceBetaStakerDecreaseAuthorization(address)"](
              stakingProvider.address
            )
        ).to.be.revertedWith("Nothing was authorized")
      })
    })

    context("when deauthorizing one beta staker", () => {
      let tx
      const amount2 = amount.div(3)

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount2
          )

        tx = await tokenStaking
          .connect(deployer)
          ["forceBetaStakerDecreaseAuthorization(address)"](
            stakingProvider.address
          )
      })

      it("should set authorized amount to 0", async () => {
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

      it("should not send request to the applications", async () => {
        await assertApplicationStakingProviders(
          application1Mock,
          stakingProvider.address,
          amount,
          0
        )
        await assertApplicationStakingProviders(
          application2Mock,
          stakingProvider.address,
          amount2,
          0
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
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application2Mock.address,
            amount2,
            0
          )
      })
    })

    context("when previous deauthorization is in process", () => {
      let tx
      const amountToDecrease = amount.div(20)
      const amountToDecrease2 = amountToDecrease.mul(2)

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application1Mock.address,
            amount
          )

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            stakingProvider.address,
            application2Mock.address,
            amount
          )

        await tokenStaking
          .connect(authorizer)
          ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
            stakingProvider.address,
            application1Mock.address,
            amountToDecrease
          )
        await tokenStaking
          .connect(authorizer)
          ["legacyRequestAuthorizationDecrease(address,address,uint96)"](
            stakingProvider.address,
            application2Mock.address,
            amountToDecrease2
          )

        tx = await tokenStaking
          .connect(deployer)
          ["forceBetaStakerDecreaseAuthorization(address)"](
            stakingProvider.address
          )
      })

      it("should set authorized amount to 0", async () => {
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

      it("should not send request to the applications", async () => {
        await assertApplicationStakingProviders(
          application1Mock,
          stakingProvider.address,
          amount,
          amount.sub(amountToDecrease)
        )
        await assertApplicationStakingProviders(
          application2Mock,
          stakingProvider.address,
          amount,
          amount.sub(amountToDecrease2)
        )
      })

      it("should set deauthorizing amount to 0", async () => {
        expect(
          await tokenStaking.getDeauthorizingAmount(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(0)
        expect(
          await tokenStaking.getDeauthorizingAmount(
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
            application1Mock.address,
            amount,
            0
          )
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            stakingProvider.address,
            application2Mock.address,
            amount,
            0
          )
      })
    })

    context("when sending transaction for multiple staking providers", () => {
      let tx

      beforeEach(async () => {
        await tToken.connect(deployer).transfer(otherStaker.address, amount)

        await tToken.connect(otherStaker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(otherStaker)
          .stake(
            otherStaker.address,
            otherStaker.address,
            otherStaker.address,
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
          .connect(otherStaker)
          .increaseAuthorization(
            otherStaker.address,
            application1Mock.address,
            amount
          )

        tx = await tokenStaking
          .connect(deployer)
          ["forceBetaStakerDecreaseAuthorization(address[])"]([
            stakingProvider.address,
            otherStaker.address,
          ])
      })

      it("should set authorized amount to 0", async () => {
        expect(
          await tokenStaking.authorizedStake(
            stakingProvider.address,
            application1Mock.address
          )
        ).to.equal(0)
        expect(
          await tokenStaking.authorizedStake(
            otherStaker.address,
            application1Mock.address
          )
        ).to.equal(0)
      })

      it("should not send request to the application", async () => {
        await assertApplicationStakingProviders(
          application1Mock,
          stakingProvider.address,
          amount,
          0
        )
        await assertApplicationStakingProviders(
          application1Mock,
          otherStaker.address,
          amount,
          0
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
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(otherStaker.address, application1Mock.address, amount, 0)
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
        await tokenStaking.setAuthorizedApplications(stakingProvider.address, [
          application1Mock.address,
          application2Mock.address,
        ])
        await tokenStaking.cleanAuthorizedApplications(
          stakingProvider.address,
          2
        )
      })

      it("should remove all applications", async () => {
        expect(
          await tokenStaking.getAuthorizedApplications(stakingProvider.address)
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

  describe("delegateVoting", () => {
    const amount = initialStakerBalance

    context("after vote delegation", () => {
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

        tx = await tokenStaking
          .connect(staker)
          .delegateVoting(stakingProvider.address, delegatee.address)
      })

      it("checkpoint for staked total supply should remain constant", async () => {
        const lastBlock = await mineBlocks(1)
        expect(await tokenStaking.getPastTotalSupply(lastBlock - 1)).to.equal(
          amount
        )
      })

      it("should create a new checkpoint for staker's delegatee", async () => {
        expect(await tokenStaking.getVotes(delegatee.address)).to.equal(amount)
      })

      it("shouldn't create a new checkpoint for any stake role", async () => {
        expect(await tokenStaking.getVotes(staker.address)).to.equal(0)
        expect(await tokenStaking.getVotes(stakingProvider.address)).to.equal(0)
        expect(await tokenStaking.getVotes(beneficiary.address)).to.equal(0)
        expect(await tokenStaking.getVotes(authorizer.address)).to.equal(0)
      })
    })
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

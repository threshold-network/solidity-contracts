const { expect } = require("chai")
const {
  ZERO_ADDRESS,
  lastBlockTime,
  to1e18,
  to1ePrecision,
} = require("../helpers/contract-test-helpers")
const zeroBigNumber = ethers.BigNumber.from(0)
const StakingProviders = {
  NU: 0,
  KEEP: 1,
  T: 2,
}

describe("TokenStaking", () => {
  let tToken
  let keepVendingMachine
  let nucypherVendingMachine
  let keepStakingMock
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

  let tokenStaking

  let deployer
  let panicButton
  // Token staker has 5 (T/NU/KEEP) tokens
  let staker
  const initialStakerBalance = to1e18(5)
  let operator
  let authorizer
  let beneficiary

  let otherStaker

  beforeEach(async () => {
    ;[
      deployer,
      panicButton,
      staker,
      operator,
      authorizer,
      beneficiary,
      keepTokenStaker,
      nuTokenStaker,
      otherStaker,
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
    const NuCypherTokenStakingMock = await ethers.getContractFactory(
      "NuCypherTokenStakingMock"
    )
    nucypherStakingMock = await NuCypherTokenStakingMock.deploy()
    await nucypherStakingMock.deployed()

    const TokenStaking = await ethers.getContractFactory("TokenStaking")
    tokenStaking = await TokenStaking.deploy(
      tToken.address,
      keepStakingMock.address,
      nucypherStakingMock.address,
      keepVendingMachine.address,
      nucypherVendingMachine.address
    )
    await tokenStaking.deployed()

    const ApplicationMock = await ethers.getContractFactory("ApplicationMock")
    application1Mock = await ApplicationMock.deploy(tokenStaking.address)
    await application1Mock.deployed()
    application2Mock = await ApplicationMock.deploy(tokenStaking.address)
    await application2Mock.deployed()
  })

  describe("setup", () => {
    context("once deployed", () => {
      it("should set contracts addresses correctly", async () => {
        expect(await tokenStaking.token()).to.equal(tToken.address)
        expect(await tokenStaking.keepStakingContract()).to.equal(
          keepStakingMock.address
        )
        expect(await tokenStaking.nucypherStakingContract()).to.equal(
          nucypherStakingMock.address
        )
      })
      it("should set conversion ratios correctly", async () => {
        expect(await tokenStaking.keepFloatingPointDivisor()).to.equal(
          floatingPointDivisor
        )
        expect(await tokenStaking.keepRatio()).to.equal(keepRatio)
        expect(await tokenStaking.nucypherRatio()).to.equal(nuRatio)
      })
    })
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
    context("when caller did not provide operator", () => {
      it("should revert", async () => {
        amount = 0
        await expect(
          tokenStaking
            .connect(staker)
            .stake(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, amount)
        ).to.be.revertedWith("Operator must be specified")
      })
    })

    context("when operator is in use", () => {
      context("when other stake delegated to the specified operator", () => {
        it("should revert", async () => {
          const amount = initialStakerBalance
          await tToken
            .connect(otherStaker)
            .approve(tokenStaking.address, amount)
          await tokenStaking
            .connect(otherStaker)
            .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          await expect(
            tokenStaking
              .connect(staker)
              .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          ).to.be.revertedWith("Operator is already in use")
        })
      })

      context("when operator is in use in Keep staking contract", () => {
        it("should revert", async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            otherStaker.address,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            createdAt,
            0,
            0
          )
          const amount = 0
          await expect(
            tokenStaking
              .connect(staker)
              .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          ).to.be.revertedWith("Operator is already in use")
        })
      })
    })

    context("when staker delegates too small amount", () => {
      context("when amount is zero and minimum amount was not set", () => {
        it("should revert", async () => {
          amount = 0
          await expect(
            tokenStaking
              .connect(staker)
              .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          ).to.be.revertedWith("Amount to stake must be greater than minimum")
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
              .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          ).to.be.revertedWith("Amount to stake must be greater than minimum")
        })
      })
    })

    context("when stake delegates enough tokens to free operator", () => {
      const amount = initialStakerBalance
      let tx
      let blockTimestamp

      context("when authorizer and beneficiary were not provided", () => {
        beforeEach(async () => {
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          tx = await tokenStaking
            .connect(staker)
            .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          blockTimestamp = await lastBlockTime()
        })

        it("should set roles equal to the caller address", async () => {
          expect(await tokenStaking.operators(operator.address)).to.deep.equal([
            staker.address,
            staker.address,
            staker.address,
            zeroBigNumber,
            zeroBigNumber,
            amount,
            ethers.BigNumber.from(blockTimestamp),
          ])
        })

        it("should transfer tokens to the staking contract", async () => {
          expect(await tToken.balanceOf(tokenStaking.address)).to.equal(amount)
        })

        it("should increase available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              operator.address,
              application1Mock.address
            )
          ).to.equal(amount)
        })

        it("should not increase min staked amount", async () => {
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.T
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.NU
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.KEEP
            )
          ).to.equal(0)
        })

        it("should emit TStaked and OperatorStaked events", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TStaked")
            .withArgs(staker.address, operator.address)

          await expect(tx)
            .to.emit(tokenStaking, "OperatorStaked")
            .withArgs(operator.address, staker.address, staker.address, amount)
        })
      })

      context("when authorizer and beneficiary were provided", () => {
        beforeEach(async () => {
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          tx = await tokenStaking
            .connect(staker)
            .stake(
              operator.address,
              beneficiary.address,
              authorizer.address,
              amount
            )
          blockTimestamp = await lastBlockTime()
        })

        it("should set roles equal to the provided values", async () => {
          expect(await tokenStaking.operators(operator.address)).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
            zeroBigNumber,
            zeroBigNumber,
            amount,
            ethers.BigNumber.from(blockTimestamp),
          ])
        })

        it("should transfer tokens to the staking contract", async () => {
          expect(await tToken.balanceOf(tokenStaking.address)).to.equal(amount)
        })

        it("should increase available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              operator.address,
              application1Mock.address
            )
          ).to.equal(amount)
        })

        it("should emit TStaked and OperatorStaked events", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "TStaked")
            .withArgs(staker.address, operator.address)

          await expect(tx)
            .to.emit(tokenStaking, "OperatorStaked")
            .withArgs(
              operator.address,
              beneficiary.address,
              authorizer.address,
              amount
            )
        })
      })
    })
  })

  describe("stakeKeep", () => {
    context("when caller did not provide operator", () => {
      it("should revert", async () => {
        await expect(tokenStaking.stakeKeep(ZERO_ADDRESS)).to.be.revertedWith(
          "Operator must be specified"
        )
      })
    })

    context("when operator is in use", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tToken.connect(otherStaker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(otherStaker)
          .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
        await expect(
          tokenStaking.stakeKeep(operator.address)
        ).to.be.revertedWith("Can't stake KEEP for this operator")
      })
    })

    context("when specified address never was an operator in Keep", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.stakeKeep(operator.address)
        ).to.be.revertedWith("Nothing to sync")
      })
    })

    context("when operator exists in Keep staking contract", () => {
      let tx

      context("when stake was canceled/withdrawn or not eligible", () => {
        beforeEach(async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            0
          )
          tx = await tokenStaking.stakeKeep(operator.address)
        })

        it("should set roles equal to the Keep values", async () => {
          expect(await tokenStaking.operators(operator.address)).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
            zeroBigNumber,
            zeroBigNumber,
            zeroBigNumber,
            zeroBigNumber,
          ])
        })

        it("should not increase available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              operator.address,
              application1Mock.address
            )
          ).to.equal(0)
        })

        it("should emit KeepStaked and OperatorStaked events", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "KeepStaked")
            .withArgs(staker.address, operator.address)

          await expect(tx)
            .to.emit(tokenStaking, "OperatorStaked")
            .withArgs(
              operator.address,
              beneficiary.address,
              authorizer.address,
              zeroBigNumber
            )
        })
      })

      context("when stake is eligible", () => {
        const keepAmount = initialStakerBalance
        const tAmount = convertToT(keepAmount, keepRatio).result

        beforeEach(async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepAmount
          )
          await keepStakingMock.setEligibility(
            operator.address,
            tokenStaking.address,
            true
          )
          tx = await tokenStaking.stakeKeep(operator.address)
        })

        it("should set roles equal to the Keep values", async () => {
          expect(await tokenStaking.operators(operator.address)).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
            zeroBigNumber,
            tAmount,
            zeroBigNumber,
            zeroBigNumber,
          ])
        })

        it("should increase available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              operator.address,
              application1Mock.address
            )
          ).to.equal(tAmount)
        })

        it("should not increase min staked amount", async () => {
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.T
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.NU
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.KEEP
            )
          ).to.equal(0)
        })

        it("should emit KeepStaked and OperatorStaked events", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "KeepStaked")
            .withArgs(staker.address, operator.address)

          await expect(tx)
            .to.emit(tokenStaking, "OperatorStaked")
            .withArgs(
              operator.address,
              beneficiary.address,
              authorizer.address,
              tAmount
            )
        })
      })
    })
  })

  describe("stakeNu", () => {
    context("when caller did not provide operator", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .stakeNu(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS)
        ).to.be.revertedWith("Operator must be specified")
      })
    })

    context("when operator is in use", () => {
      context("when other stake delegated to the specified operator", () => {
        it("should revert", async () => {
          const amount = initialStakerBalance
          await tToken
            .connect(otherStaker)
            .approve(tokenStaking.address, amount)
          await tokenStaking
            .connect(otherStaker)
            .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          await expect(
            tokenStaking
              .connect(staker)
              .stakeNu(operator.address, ZERO_ADDRESS, ZERO_ADDRESS)
          ).to.be.revertedWith("Operator is already in use")
        })
      })

      context("when operator is in use in Keep staking contract", () => {
        it("should revert", async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            otherStaker.address,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            createdAt,
            0,
            0
          )
          await expect(
            tokenStaking
              .connect(staker)
              .stakeNu(operator.address, ZERO_ADDRESS, ZERO_ADDRESS)
          ).to.be.revertedWith("Operator is already in use")
        })
      })
    })

    context("when specified operator is free", () => {
      context("when caller has no stake in NuCypher staking contract", () => {
        it("should revert", async () => {
          await expect(
            tokenStaking
              .connect(staker)
              .stakeNu(operator.address, ZERO_ADDRESS, ZERO_ADDRESS)
          ).to.be.revertedWith("Nothing to sync")
        })
      })

      context("when caller has stake in NuCypher staking contract", () => {
        const nuAmount = initialStakerBalance
        const tAmount = convertToT(nuAmount, nuRatio).result
        let tx

        beforeEach(async () => {
          await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
        })

        context("when authorizer and beneficiary were not provided", () => {
          beforeEach(async () => {
            tx = await tokenStaking
              .connect(staker)
              .stakeNu(operator.address, ZERO_ADDRESS, ZERO_ADDRESS)
          })

          it("should set roles equal to the caller address", async () => {
            expect(
              await tokenStaking.operators(operator.address)
            ).to.deep.equal([
              staker.address,
              staker.address,
              staker.address,
              tAmount,
              zeroBigNumber,
              zeroBigNumber,
              zeroBigNumber,
            ])
          })

          it("should do callback to NuCypher staking contract", async () => {
            expect(
              await nucypherStakingMock.stakers(staker.address)
            ).to.deep.equal([nuAmount, true])
          })

          it("should increase available amount to authorize", async () => {
            expect(
              await tokenStaking.getAvailableToAuthorize(
                operator.address,
                application1Mock.address
              )
            ).to.equal(tAmount)
          })

          it("should not increase min staked amount", async () => {
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.T
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.NU
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.KEEP
              )
            ).to.equal(0)
          })

          it("should emit NuStaked and OperatorStaked events", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "NuStaked")
              .withArgs(staker.address, operator.address)

            await expect(tx)
              .to.emit(tokenStaking, "OperatorStaked")
              .withArgs(
                operator.address,
                staker.address,
                staker.address,
                tAmount
              )
          })
        })

        context("when authorizer and beneficiary were provided", () => {
          beforeEach(async () => {
            tx = await tokenStaking
              .connect(staker)
              .stakeNu(
                operator.address,
                beneficiary.address,
                authorizer.address
              )
          })

          it("should set roles equal to the provided values", async () => {
            expect(
              await tokenStaking.operators(operator.address)
            ).to.deep.equal([
              staker.address,
              beneficiary.address,
              authorizer.address,
              tAmount,
              zeroBigNumber,
              zeroBigNumber,
              zeroBigNumber,
            ])
          })

          it("should do callback to NuCypher staking contract", async () => {
            expect(
              await nucypherStakingMock.stakers(staker.address)
            ).to.deep.equal([nuAmount, true])
          })

          it("should increase available amount to authorize", async () => {
            expect(
              await tokenStaking.getAvailableToAuthorize(
                operator.address,
                application1Mock.address
              )
            ).to.equal(tAmount)
          })

          it("should emit NuStaked and OperatorStaked events", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "NuStaked")
              .withArgs(staker.address, operator.address)

            await expect(tx)
              .to.emit(tokenStaking, "OperatorStaked")
              .withArgs(
                operator.address,
                beneficiary.address,
                authorizer.address,
                tAmount
              )
          })
        })
      })
    })
  })

  describe("approveApplication", () => {
    context("when caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(staker).approveApplication(ZERO_ADDRESS)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("when caller did not provide application", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(deployer).approveApplication(ZERO_ADDRESS)
        ).to.be.revertedWith("Application must be specified")
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
        ).to.be.revertedWith("Application has already been approved")
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
        ).to.deep.equal([true, false, ZERO_ADDRESS])
      })

      it("should add application to the list of all applications", async () => {
        expect(await tokenStaking.getApplicationsLength()).to.equal(1)
        expect(await tokenStaking.applications(0)).to.equal(
          application1Mock.address
        )
      })

      it("should emit ApplicationApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ApplicationApproved")
          .withArgs(application1Mock.address)
      })
    })

    context("when approving disabled application", () => {
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
          .disableApplication(application1Mock.address)
        tx = await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
      })

      it("should enable application", async () => {
        expect(
          await tokenStaking.applicationInfo(application1Mock.address)
        ).to.deep.equal([true, false, panicButton.address])
      })

      it("should keep list of all applications unchanged", async () => {
        expect(await tokenStaking.getApplicationsLength()).to.equal(1)
        expect(await tokenStaking.applications(0)).to.equal(
          application1Mock.address
        )
      })

      it("should emit ApplicationApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ApplicationApproved")
          .withArgs(application1Mock.address)
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
              operator.address,
              application1Mock.address,
              amount
            )
        ).to.be.revertedWith("Not operator authorizer")
      })
    })

    context("when caller is authorizer of operator with T stake", () => {
      const amount = initialStakerBalance

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            operator.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
      })

      context("when application was not approved", () => {
        it("should revert", async () => {
          const amount = initialStakerBalance
          await expect(
            tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
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

        context("when application was disabled", () => {
          it("should revert", async () => {
            await tokenStaking
              .connect(deployer)
              .setPanicButton(application1Mock.address, panicButton.address)
            await tokenStaking
              .connect(panicButton)
              .disableApplication(application1Mock.address)
            await expect(
              tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  operator.address,
                  application1Mock.address,
                  amount
                )
            ).to.be.revertedWith("Application is disabled")
          })
        })

        context("when already authorized maximum applications", () => {
          it("should revert", async () => {
            await tokenStaking.connect(deployer).setAuthorizationCeiling(1)
            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
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
                  operator.address,
                  application2Mock.address,
                  amount
                )
            ).to.be.revertedWith("Can't authorize more applications")
          })
        })

        context("when authorize more than staked amount", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  operator.address,
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
                operator.address,
                application1Mock.address,
                authorizedAmount
              )
          })

          it("should increase authorization", async () => {
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application1Mock.address
              )
            ).to.equal(authorizedAmount)
          })

          it("should increase min staked amount in T", async () => {
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.T
              )
            ).to.equal(authorizedAmount)
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.NU
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.KEEP
              )
            ).to.equal(0)
          })

          it("should decrease available amount to authorize for one application", async () => {
            expect(
              await tokenStaking.getAvailableToAuthorize(
                operator.address,
                application1Mock.address
              )
            ).to.equal(amount.sub(authorizedAmount))
            expect(
              await tokenStaking.getAvailableToAuthorize(
                operator.address,
                application2Mock.address
              )
            ).to.equal(amount)
          })

          it("should inform application", async () => {
            expect(
              await application1Mock.operators(operator.address)
            ).to.deep.equal([authorizedAmount, zeroBigNumber])
          })

          it("should emit AuthorizationIncreased", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationIncreased")
              .withArgs(
                operator.address,
                application1Mock.address,
                authorizedAmount
              )
          })
        })

        context("when authorize more than staked amount in several txs", () => {
          it("should revert", async () => {
            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
                application1Mock.address,
                amount.sub(1)
              )
            await expect(
              tokenStaking
                .connect(authorizer)
                .increaseAuthorization(
                  operator.address,
                  application1Mock.address,
                  2
                )
            ).to.be.revertedWith("Not enough stake to authorize")
          })
        })

        context("when authorize staked tokens in several txs", () => {
          let tx1
          let tx2
          const authorizedAmount1 = amount.sub(1)
          const authorizedAmount2 = 1

          beforeEach(async () => {
            tx1 = await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
                application1Mock.address,
                authorizedAmount1
              )
            tx2 = await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
                application1Mock.address,
                authorizedAmount2
              )
          })

          it("should increase authorization", async () => {
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application1Mock.address
              )
            ).to.equal(amount)
          })

          it("should decrease available amount to authorize for one application", async () => {
            expect(
              await tokenStaking.getAvailableToAuthorize(
                operator.address,
                application1Mock.address
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getAvailableToAuthorize(
                operator.address,
                application2Mock.address
              )
            ).to.equal(amount)
          })

          it("should increase min staked amount in T", async () => {
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.T
              )
            ).to.equal(amount)
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.NU
              )
            ).to.equal(0)
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.KEEP
              )
            ).to.equal(0)
          })

          it("should inform application", async () => {
            expect(
              await application1Mock.operators(operator.address)
            ).to.deep.equal([amount, zeroBigNumber])
          })

          it("should emit two AuthorizationIncreased", async () => {
            await expect(tx1)
              .to.emit(tokenStaking, "AuthorizationIncreased")
              .withArgs(
                operator.address,
                application1Mock.address,
                authorizedAmount1
              )
            await expect(tx2)
              .to.emit(tokenStaking, "AuthorizationIncreased")
              .withArgs(
                operator.address,
                application1Mock.address,
                authorizedAmount2
              )
          })
        })

        context("when authorize after full deauthorization", () => {
          let tx

          beforeEach(async () => {
            await tokenStaking.connect(deployer).setAuthorizationCeiling(1)
            await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
                application1Mock.address,
                amount
              )
            await tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address)"](operator.address)
            await application1Mock.approveAuthorizationDecrease(
              operator.address
            )
            await tokenStaking
              .connect(deployer)
              .approveApplication(application2Mock.address)
            tx = await tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
                application2Mock.address,
                amount
              )
          })

          it("should increase authorization", async () => {
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application1Mock.address
              )
            ).to.equal(0)
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application2Mock.address
              )
            ).to.equal(amount)
          })
        })
      })
    })

    context("when caller is authorizer of operator with mixed stake", () => {
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
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepStake
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        tx = await tokenStaking.stakeKeep(operator.address)

        await nucypherStakingMock.setStaker(staker.address, nuStake, false)
        await tokenStaking.topUpNu(operator.address)

        await tToken.connect(staker).approve(tokenStaking.address, tStake)
        await tokenStaking.connect(staker).topUp(operator.address, tStake)
      })

      context("when authorize more than staked amount", () => {
        it("should revert", async () => {
          await expect(
            tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
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
              operator.address,
              application1Mock.address,
              authorizedAmount
            )
        })

        it("should increase authorization", async () => {
          expect(
            await tokenStaking.authorizedStake(
              operator.address,
              application1Mock.address
            )
          ).to.equal(authorizedAmount)
        })

        it("should increase min staked amount in KEEP and NU", async () => {
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.T
            )
          ).to.equal(0)
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.NU
            )
          ).to.equal(nuInTStake.sub(notAuthorized))
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.KEEP
            )
          ).to.equal(keepInTStake.sub(notAuthorized))
        })

        it("should decrease available amount to authorize for one application", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              operator.address,
              application1Mock.address
            )
          ).to.equal(notAuthorized)
          expect(
            await tokenStaking.getAvailableToAuthorize(
              operator.address,
              application2Mock.address
            )
          ).to.equal(tAmount)
        })

        it("should inform application", async () => {
          expect(
            await application1Mock.operators(operator.address)
          ).to.deep.equal([authorizedAmount, zeroBigNumber])
        })

        it("should emit AuthorizationIncreased", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "AuthorizationIncreased")
            .withArgs(
              operator.address,
              application1Mock.address,
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
                operator.address,
                application2Mock.address,
                tAmount
              )
          })

          it("should increase only one authorization", async () => {
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application1Mock.address
              )
            ).to.equal(authorizedAmount)
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application2Mock.address
              )
            ).to.equal(tAmount)
          })

          it("should set min staked amount equal to T/NU/KEEP stake", async () => {
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.T
              )
            ).to.equal(tStake)
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.NU
              )
            ).to.equal(nuInTStake)
            expect(
              await tokenStaking.getMinStaked(
                operator.address,
                StakingProviders.KEEP
              )
            ).to.equal(keepInTStake)
          })

          it("should decrease available amount to authorize for the second application", async () => {
            expect(
              await tokenStaking.getAvailableToAuthorize(
                operator.address,
                application1Mock.address
              )
            ).to.equal(notAuthorized)
            expect(
              await tokenStaking.getAvailableToAuthorize(
                operator.address,
                application2Mock.address
              )
            ).to.equal(0)
          })

          it("should inform second application", async () => {
            expect(
              await application2Mock.operators(operator.address)
            ).to.deep.equal([tAmount, zeroBigNumber])
          })

          it("should emit AuthorizationIncreased", async () => {
            await expect(tx2)
              .to.emit(tokenStaking, "AuthorizationIncreased")
              .withArgs(operator.address, application2Mock.address, tAmount)
          })
        })
      })

      context("when authorize more than staked amount in several txs", () => {
        it("should revert", async () => {
          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              operator.address,
              application1Mock.address,
              tAmount.sub(1)
            )
          await expect(
            tokenStaking
              .connect(authorizer)
              .increaseAuthorization(
                operator.address,
                application1Mock.address,
                2
              )
          ).to.be.revertedWith("Not enough stake to authorize")
        })
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
              operator.address,
              application1Mock.address,
              amount
            )
        ).to.be.revertedWith("Not operator authorizer")
      })
    })

    context("when caller is authorizer of operator with T stake", () => {
      const amount = initialStakerBalance

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            operator.address,
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
            operator.address,
            application1Mock.address,
            amount
          )
      })

      context("when application was disabled", () => {
        it("should revert", async () => {
          const amount = initialStakerBalance
          await tokenStaking
            .connect(deployer)
            .setPanicButton(application1Mock.address, panicButton.address)
          await tokenStaking
            .connect(panicButton)
            .disableApplication(application1Mock.address)
          await expect(
            tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address,uint96)"](
                operator.address,
                application1Mock.address,
                amount
              )
          ).to.be.revertedWith("Application is disabled")
        })
      })

      context("when amount to decrease is zero", () => {
        it("should revert", async () => {
          await expect(
            tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address,uint96)"](
                operator.address,
                application1Mock.address,
                0
              )
          ).to.be.revertedWith(
            "Amount to decrease authorization must greater than 0"
          )
        })
      })

      context("when amount to decrease is more than authorized", () => {
        it("should revert", async () => {
          await expect(
            tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address,uint96)"](
                operator.address,
                application1Mock.address,
                amount.add(1)
              )
          ).to.be.revertedWith(
            "Amount to decrease authorization must be less than authorized"
          )
        })
      })

      context("when amount to decrease is less than authorized", () => {
        const amountToDecrease = amount.div(3)
        let tx

        beforeEach(async () => {
          tx = await tokenStaking
            .connect(authorizer)
            ["requestAuthorizationDecrease(address,address,uint96)"](
              operator.address,
              application1Mock.address,
              amountToDecrease
            )
        })

        it("should keep authorized amount unchanged", async () => {
          expect(
            await tokenStaking.authorizedStake(
              operator.address,
              application1Mock.address
            )
          ).to.equal(amount)
        })

        it("should send request to application", async () => {
          expect(
            await application1Mock.operators(operator.address)
          ).to.deep.equal([amount, amountToDecrease])
        })

        it("should emit AuthorizationDecreaseRequested", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
            .withArgs(
              operator.address,
              application1Mock.address,
              amountToDecrease
            )
        })
      })

      context(
        "when request to decrease all authorized amount for one application",
        () => {
          let tx

          beforeEach(async () => {
            tx = await tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address,address)"](
                operator.address,
                application1Mock.address
              )
          })

          it("should keep authorized amount unchanged", async () => {
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application1Mock.address
              )
            ).to.equal(amount)
          })

          it("should send request to application", async () => {
            expect(
              await application1Mock.operators(operator.address)
            ).to.deep.equal([amount, amount])
          })

          it("should emit AuthorizationDecreaseRequested", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
              .withArgs(operator.address, application1Mock.address, amount)
          })
        }
      )

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
                operator.address,
                application2Mock.address,
                amount
              )
            tx = await tokenStaking
              .connect(authorizer)
              ["requestAuthorizationDecrease(address)"](operator.address)
          })

          it("should keep authorized amount unchanged", async () => {
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application1Mock.address
              )
            ).to.equal(amount)
            expect(
              await tokenStaking.authorizedStake(
                operator.address,
                application2Mock.address
              )
            ).to.equal(amount)
          })

          it("should send request to application", async () => {
            expect(
              await application1Mock.operators(operator.address)
            ).to.deep.equal([amount, amount])
            expect(
              await application2Mock.operators(operator.address)
            ).to.deep.equal([amount, amount])
          })

          it("should emit AuthorizationDecreaseRequested", async () => {
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
              .withArgs(operator.address, application1Mock.address, amount)
            await expect(tx)
              .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
              .withArgs(operator.address, application2Mock.address, amount)
          })
        }
      )

      context("when decrease requested twice", () => {
        const amountToDecrease1 = amount.div(3)
        const amountToDecrease2 = amount.div(2)
        let tx1
        let tx2

        beforeEach(async () => {
          tx1 = await tokenStaking
            .connect(authorizer)
            ["requestAuthorizationDecrease(address,address,uint96)"](
              operator.address,
              application1Mock.address,
              amountToDecrease1
            )
          tx2 = await tokenStaking
            .connect(authorizer)
            ["requestAuthorizationDecrease(address,address,uint96)"](
              operator.address,
              application1Mock.address,
              amountToDecrease2
            )
        })

        it("should keep authorized amount unchanged", async () => {
          expect(
            await tokenStaking.authorizedStake(
              operator.address,
              application1Mock.address
            )
          ).to.equal(amount)
        })

        it("should send request to application with last amount", async () => {
          expect(
            await application1Mock.operators(operator.address)
          ).to.deep.equal([amount, amountToDecrease2])
        })

        it("should emit AuthorizationDecreaseRequested twice", async () => {
          await expect(tx1)
            .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
            .withArgs(
              operator.address,
              application1Mock.address,
              amountToDecrease1
            )
          await expect(tx2)
            .to.emit(tokenStaking, "AuthorizationDecreaseRequested")
            .withArgs(
              operator.address,
              application1Mock.address,
              amountToDecrease2
            )
        })
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
          operator.address,
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
          operator.address,
          application1Mock.address,
          amount
        )
    })

    context("when application was disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(deployer)
          .setPanicButton(application1Mock.address, panicButton.address)
        await tokenStaking
          .connect(panicButton)
          .disableApplication(application1Mock.address)
        await expect(
          application1Mock.approveAuthorizationDecrease(operator.address)
        ).to.be.revertedWith("Application is disabled")
      })
    })

    context("when approve without request", () => {
      it("should revert", async () => {
        await expect(
          application1Mock.approveAuthorizationDecrease(operator.address)
        ).to.be.revertedWith("There is no deauthorizing in process")
      })
    })

    context("when approve after request of partial deauthorization", () => {
      const amountToDecrease = amount.div(3)
      const expectedAmount = amount.sub(amountToDecrease)
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(authorizer)
          ["requestAuthorizationDecrease(address,address,uint96)"](
            operator.address,
            application1Mock.address,
            amountToDecrease
          )
        tx = await application1Mock.approveAuthorizationDecrease(
          operator.address
        )
      })

      it("should decrease authorized amount", async () => {
        expect(
          await tokenStaking.authorizedStake(
            operator.address,
            application1Mock.address
          )
        ).to.equal(expectedAmount)
      })

      it("should decrease min staked amount in T", async () => {
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.T)
        ).to.equal(expectedAmount)
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.NU)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            operator.address,
            StakingProviders.KEEP
          )
        ).to.equal(0)
      })

      it("should emit AuthorizationDecreaseApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(
            operator.address,
            application1Mock.address,
            amountToDecrease
          )
      })
    })

    context("when approve after request of full deauthorization", () => {
      const otherAmount = amount.div(3)
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application2Mock.address)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            operator.address,
            application2Mock.address,
            otherAmount
          )
        await tokenStaking
          .connect(authorizer)
          ["requestAuthorizationDecrease(address,address)"](
            operator.address,
            application1Mock.address
          )
        tx = await application1Mock.approveAuthorizationDecrease(
          operator.address
        )
      })

      it("should decrease authorized amount", async () => {
        expect(
          await tokenStaking.authorizedStake(
            operator.address,
            application1Mock.address
          )
        ).to.equal(0)
        expect(
          await tokenStaking.authorizedStake(
            operator.address,
            application2Mock.address
          )
        ).to.equal(otherAmount)
      })

      it("should decrease min staked amount in T", async () => {
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.T)
        ).to.equal(otherAmount)
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.NU)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            operator.address,
            StakingProviders.KEEP
          )
        ).to.equal(0)
      })

      it("should emit AuthorizationDecreaseApproved", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "AuthorizationDecreaseApproved")
          .withArgs(operator.address, application1Mock.address, amount)
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

    context("when caller is not the panic button address", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(deployer)
            .disableApplication(application1Mock.address)
        ).to.be.revertedWith("Caller is not the address of panic button")
      })
    })

    context("when application was disabled", () => {
      it("should revert", async () => {
        await tokenStaking
          .connect(panicButton)
          .disableApplication(application1Mock.address)
        await expect(
          tokenStaking
            .connect(panicButton)
            .disableApplication(application1Mock.address)
        ).to.be.revertedWith("Application has already been disabled")
      })
    })

    context("when disable active application", () => {
      let tx

      beforeEach(async () => {
        tx = await tokenStaking
          .connect(panicButton)
          .disableApplication(application1Mock.address)
      })

      it("should disable application", async () => {
        expect(
          await tokenStaking.applicationInfo(application1Mock.address)
        ).to.deep.equal([true, true, panicButton.address])
      })

      it("should keep list of all applications unchanged", async () => {
        expect(await tokenStaking.getApplicationsLength()).to.equal(1)
        expect(await tokenStaking.applications(0)).to.equal(
          application1Mock.address
        )
      })

      it("should emit ApplicationDisabled", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ApplicationDisabled")
          .withArgs(application1Mock.address)
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
        ).to.deep.equal([true, false, panicButton.address])
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
        await expect(
          tokenStaking.connect(staker).topUp(operator.address, 0)
        ).to.be.revertedWith("Amount to top-up must be greater than 0")
      })
    })

    context("when operator has no delegated stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking
            .connect(staker)
            .topUp(operator.address, initialStakerBalance)
        ).to.be.revertedWith("Operator has no stake")
      })
    })

    context("when operator has T stake", () => {
      const amount = initialStakerBalance.div(3)
      const topUpAmount = initialStakerBalance.mul(2)
      const expectedAmount = amount.add(topUpAmount)
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
        blockTimestamp = await lastBlockTime()
        await tToken
          .connect(deployer)
          .approve(tokenStaking.address, topUpAmount)
        tx = await tokenStaking
          .connect(deployer)
          .topUp(operator.address, topUpAmount)
      })

      it("should update T staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          staker.address,
          staker.address,
          zeroBigNumber,
          zeroBigNumber,
          expectedAmount,
          ethers.BigNumber.from(blockTimestamp),
        ])
      })

      it("should transfer tokens to the staking contract", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
          expectedAmount
        )
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(expectedAmount)
      })

      it("should not increase min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.NU)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            operator.address,
            StakingProviders.KEEP
          )
        ).to.equal(0)
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(operator.address, topUpAmount)
      })
    })

    context("when operator has Keep stake", () => {
      const keepAmount = initialStakerBalance
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      const topUpAmount = initialStakerBalance.mul(2)
      const expectedAmount = keepInTAmount.add(topUpAmount)
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .setMinimumStakeAmount(topUpAmount.add(1))
        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(operator.address)
        await tToken
          .connect(deployer)
          .approve(tokenStaking.address, topUpAmount)
        tx = await tokenStaking
          .connect(deployer)
          .topUp(operator.address, topUpAmount)
      })

      it("should update only T staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
          zeroBigNumber,
          keepInTAmount,
          topUpAmount,
          zeroBigNumber,
        ])
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
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
          .withArgs(operator.address, topUpAmount)
      })
    })

    context("when operator has NuCypher stake", () => {
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const topUpAmount = initialStakerBalance.mul(2)
      const expectedAmount = nuInTAmount.add(topUpAmount)
      let tx

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
        await await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, ZERO_ADDRESS, ZERO_ADDRESS)
        await tToken
          .connect(deployer)
          .approve(tokenStaking.address, topUpAmount)
        tx = await tokenStaking
          .connect(deployer)
          .topUp(operator.address, topUpAmount)
      })

      it("should update only T staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          staker.address,
          staker.address,
          nuInTAmount,
          zeroBigNumber,
          topUpAmount,
          zeroBigNumber,
        ])
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
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
          .withArgs(operator.address, topUpAmount)
      })
    })
  })

  describe("topUpKeep", () => {
    context("when operator has no delegated stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.topUpKeep(operator.address)
        ).to.be.revertedWith("Operator has no stake")
      })
    })

    context("when specified address never was an operator in Keep", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
        await expect(
          tokenStaking.topUpKeep(operator.address)
        ).to.be.revertedWith("Nothing to sync")
      })
    })

    context("when eligible stake is zero", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialStakerBalance
        )
        await expect(
          tokenStaking.topUpKeep(operator.address)
        ).to.be.revertedWith(
          "Amount in Keep contract is equal to or less than the stored amount"
        )
      })
    })

    context("when eligible stake is less than cached", () => {
      it("should revert", async () => {
        const initialAmount = initialStakerBalance
        const amount = initialAmount.div(2)
        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialAmount
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(operator.address)
        await keepStakingMock.setAmount(operator.address, amount)
        await expect(
          tokenStaking.topUpKeep(operator.address)
        ).to.be.revertedWith(
          "Amount in Keep contract is equal to or less than the stored amount"
        )
      })
    })

    context("when operator has Keep stake", () => {
      const initialKeepAmount = initialStakerBalance
      const initialKeepInTAmount = convertToT(
        initialKeepAmount,
        keepRatio
      ).result
      const newKeepAmount = initialStakerBalance.mul(2)
      const newKeepInTAmount = convertToT(newKeepAmount, keepRatio).result
      let tx

      beforeEach(async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialKeepAmount
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(operator.address)
        await keepStakingMock.setAmount(operator.address, newKeepAmount)
        tx = await tokenStaking.topUpKeep(operator.address)
      })

      it("should update only Keep staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
          zeroBigNumber,
          newKeepInTAmount,
          zeroBigNumber,
          zeroBigNumber,
        ])
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(newKeepInTAmount)
      })

      it("should not increase min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.NU)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            operator.address,
            StakingProviders.KEEP
          )
        ).to.equal(0)
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(
            operator.address,
            newKeepInTAmount.sub(initialKeepInTAmount)
          )
      })
    })

    context("when operator has T stake", () => {
      const tAmount = initialStakerBalance.div(3)
      const keepAmount = initialStakerBalance.mul(2)
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking
          .connect(staker)
          .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, tAmount)
        blockTimestamp = await lastBlockTime()

        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        tx = await tokenStaking.topUpKeep(operator.address)
      })

      it("should update only Keep staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          staker.address,
          staker.address,
          zeroBigNumber,
          keepInTAmount,
          tAmount,
          ethers.BigNumber.from(blockTimestamp),
        ])
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(tAmount.add(keepInTAmount))
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(operator.address, keepInTAmount)
      })
    })

    context("when operator has NuCypher stake", () => {
      const nuAmount = initialStakerBalance.div(3)
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const keepAmount = initialStakerBalance.mul(2)
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      let tx

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
        await await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, ZERO_ADDRESS, ZERO_ADDRESS)

        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        tx = await tokenStaking.topUpKeep(operator.address)
      })

      it("should update only Keep staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          staker.address,
          staker.address,
          nuInTAmount,
          keepInTAmount,
          zeroBigNumber,
          zeroBigNumber,
        ])
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(nuInTAmount.add(keepInTAmount))
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(operator.address, keepInTAmount)
      })
    })
  })

  describe("topUpNu", () => {
    context("when operator has no delegated stake", () => {
      it("should revert", async () => {
        await expect(tokenStaking.topUpNu(operator.address)).to.be.revertedWith(
          "Operator has no stake"
        )
      })
    })

    context("when stake in NuCypher contract is zero", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
        await expect(tokenStaking.topUpNu(operator.address)).to.be.revertedWith(
          "Amount in NuCypher contract is equal to or less than the stored amount"
        )
      })
    })

    context("when stake in NuCypher contract is less than cached", () => {
      it("should revert", async () => {
        const initialAmount = initialStakerBalance
        const amount = initialAmount.div(2)
        await nucypherStakingMock.setStaker(
          staker.address,
          initialAmount,
          false
        )
        await await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, ZERO_ADDRESS, ZERO_ADDRESS)
        await nucypherStakingMock.setStaker(staker.address, amount, false)
        await expect(tokenStaking.topUpNu(operator.address)).to.be.revertedWith(
          "Amount in NuCypher contract is equal to or less than the stored amount"
        )
      })
    })

    context("when operator has NuCypher stake", () => {
      const initialNuAmount = initialStakerBalance
      const initialNuInTAmount = convertToT(initialNuAmount, nuRatio).result
      const newNuAmount = initialStakerBalance.mul(2)
      const newNuInTAmount = convertToT(newNuAmount, nuRatio).result
      let tx

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(
          staker.address,
          initialNuAmount,
          false
        )
        await await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, ZERO_ADDRESS, ZERO_ADDRESS)
        await nucypherStakingMock.setStaker(staker.address, newNuAmount, false)
        tx = await tokenStaking.topUpNu(operator.address)
      })

      it("should update only Nu staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          staker.address,
          staker.address,
          newNuInTAmount,
          zeroBigNumber,
          zeroBigNumber,
          zeroBigNumber,
        ])
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(newNuInTAmount)
      })

      it("should not increase min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.NU)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            operator.address,
            StakingProviders.KEEP
          )
        ).to.equal(0)
      })

      it("should do callback to NuCypher staking contract", async () => {
        expect(await nucypherStakingMock.stakers(staker.address)).to.deep.equal(
          [newNuAmount, true]
        )
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(operator.address, newNuInTAmount.sub(initialNuInTAmount))
      })
    })

    context("when operator has T stake", () => {
      const tAmount = initialStakerBalance.div(3)
      const nuAmount = initialStakerBalance.mul(2)
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking
          .connect(staker)
          .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, tAmount)
        blockTimestamp = await lastBlockTime()

        tx = await tokenStaking.topUpNu(operator.address)
      })

      it("should update only Nu staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          staker.address,
          staker.address,
          nuInTAmount,
          zeroBigNumber,
          tAmount,
          ethers.BigNumber.from(blockTimestamp),
        ])
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(tAmount.add(nuInTAmount))
      })

      it("should do callback to NuCypher staking contract", async () => {
        expect(await nucypherStakingMock.stakers(staker.address)).to.deep.equal(
          [nuAmount, true]
        )
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(operator.address, nuInTAmount)
      })
    })

    context("when operator has Keep stake", () => {
      const keepAmount = initialStakerBalance.div(2)
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      const nuAmount = initialStakerBalance.mul(3)
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      let tx

      beforeEach(async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(operator.address)

        await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
        tx = await tokenStaking.topUpNu(operator.address)
      })

      it("should update only Nu staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
          nuInTAmount,
          keepInTAmount,
          zeroBigNumber,
          zeroBigNumber,
        ])
      })

      it("should increase available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(nuInTAmount.add(keepInTAmount))
      })

      it("should emit ToppedUp event", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "ToppedUp")
          .withArgs(operator.address, nuInTAmount)
      })
    })
  })

  describe("unstakeT", () => {
    context("when operator has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeT(deployer.address, 0)
        ).to.be.revertedWith("Operator has no stake")
      })
    })

    context("when caller is not owner or operator", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            operator.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(authorizer).unstakeT(operator.address, 0)
        ).to.be.revertedWith("Only owner and operator can unstake tokens")
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
            operator.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(staker).unstakeT(operator.address, 0)
        ).to.be.revertedWith("Can't unstake specified amount of tokens")
      })
    })

    context("when stake is only in Keep and Nu", () => {
      it("should revert", async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialStakerBalance
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(operator.address)

        await nucypherStakingMock.setStaker(
          staker.address,
          initialStakerBalance,
          false
        )
        await tokenStaking.topUpNu(operator.address)

        const amountToUnstake = 1
        await expect(
          tokenStaking
            .connect(operator)
            .unstakeT(operator.address, amountToUnstake)
        ).to.be.revertedWith("Can't unstake specified amount of tokens")
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
            operator.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        const authorized = amount.div(3)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            operator.address,
            application1Mock.address,
            authorized
          )

        const amountToUnstake = amount.sub(authorized).add(1)
        await expect(
          tokenStaking
            .connect(operator)
            .unstakeT(operator.address, amountToUnstake)
        ).to.be.revertedWith("Can't unstake specified amount of tokens")
      })
    })

    context("when unstake too much before minimum staking time passes", () => {
      it("should revert", async () => {
        const amount = initialStakerBalance
        const minAmount = initialStakerBalance.div(3)
        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking
          .connect(staker)
          .stake(
            operator.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        await tokenStaking.connect(deployer).setMinimumStakeAmount(minAmount)

        const amountToUnstake = amount.sub(minAmount).add(1)
        await expect(
          tokenStaking
            .connect(staker)
            .unstakeT(operator.address, amountToUnstake)
        ).to.be.revertedWith("Unstaking is possible only after 24 hours")
      })
    })

    context(
      "when unstake small amount before minimum staking time passes",
      () => {
        const nuAmount = initialStakerBalance
        const nuInTAmount = convertToT(nuAmount, nuRatio).result
        const amount = initialStakerBalance
        const minAmount = amount.div(3)
        const authorized = minAmount.div(2).add(nuInTAmount)
        const amountToUnstake = amount.sub(minAmount)
        let tx
        let blockTimestamp

        beforeEach(async () => {
          await tokenStaking.connect(deployer).setMinimumStakeAmount(minAmount)
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
          await tToken.connect(staker).approve(tokenStaking.address, amount)
          await tokenStaking
            .connect(staker)
            .stake(
              operator.address,
              beneficiary.address,
              authorizer.address,
              amount
            )
          blockTimestamp = await lastBlockTime()
          await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
          await tokenStaking.topUpNu(operator.address)
          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              operator.address,
              application1Mock.address,
              authorized
            )

          tx = await tokenStaking
            .connect(staker)
            .unstakeT(operator.address, amountToUnstake)
        })

        it("should update T staked amount", async () => {
          expect(await tokenStaking.operators(operator.address)).to.deep.equal([
            staker.address,
            beneficiary.address,
            authorizer.address,
            nuInTAmount,
            zeroBigNumber,
            minAmount,
            ethers.BigNumber.from(blockTimestamp),
          ])
        })

        it("should transfer tokens to the staker address", async () => {
          expect(await tToken.balanceOf(tokenStaking.address)).to.equal(
            minAmount
          )
          expect(await tToken.balanceOf(staker.address)).to.equal(
            amountToUnstake
          )
        })

        it("should decrease available amount to authorize", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              operator.address,
              application1Mock.address
            )
          ).to.equal(minAmount.add(nuInTAmount).sub(authorized))
        })

        it("should update min staked amount", async () => {
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.T
            )
          ).to.equal(authorized.sub(nuInTAmount))
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.NU
            )
          ).to.equal(authorized.sub(minAmount))
          expect(
            await tokenStaking.getMinStaked(
              operator.address,
              StakingProviders.KEEP
            )
          ).to.equal(0)
        })

        it("should emit Unstaked", async () => {
          await expect(tx)
            .to.emit(tokenStaking, "Unstaked")
            .withArgs(operator.address, amountToUnstake)
        })
      }
    )

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
            operator.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        blockTimestamp = await lastBlockTime()
        const oneDay = 86400
        await ethers.provider.send("evm_increaseTime", [oneDay])

        tx = await tokenStaking
          .connect(operator)
          .unstakeT(operator.address, amount)
      })

      it("should update T staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
          zeroBigNumber,
          zeroBigNumber,
          zeroBigNumber,
          ethers.BigNumber.from(blockTimestamp),
        ])
      })

      it("should transfer tokens to the staker address", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(0)
        expect(await tToken.balanceOf(staker.address)).to.equal(amount)
      })

      it("should emit Unstaked", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "Unstaked")
          .withArgs(operator.address, amount)
      })
    })

    context("when initially T was topped-up", () => {
      const amount = initialStakerBalance
      const minAmount = initialStakerBalance.div(3)
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      let tx

      beforeEach(async () => {
        await tokenStaking.connect(deployer).setMinimumStakeAmount(minAmount)
        await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
        await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, beneficiary.address, authorizer.address)

        await tToken.connect(staker).approve(tokenStaking.address, amount)
        await tokenStaking.connect(staker).topUp(operator.address, amount)

        tx = await tokenStaking
          .connect(operator)
          .unstakeT(operator.address, amount)
      })

      it("should update T staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
          nuInTAmount,
          zeroBigNumber,
          zeroBigNumber,
          zeroBigNumber,
        ])
      })

      it("should transfer tokens to the staker address", async () => {
        expect(await tToken.balanceOf(tokenStaking.address)).to.equal(0)
        expect(await tToken.balanceOf(staker.address)).to.equal(amount)
      })

      it("should emit Unstaked", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "Unstaked")
          .withArgs(operator.address, amount)
      })
    })
  })

  describe("unstakeKeep", () => {
    context("when operator has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeKeep(deployer.address)
        ).to.be.revertedWith("Operator has no stake")
      })
    })

    context("when caller is not owner or operator", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            operator.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(authorizer).unstakeKeep(operator.address)
        ).to.be.revertedWith("Only owner and operator can unstake tokens")
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
            operator.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )

        await nucypherStakingMock.setStaker(
          staker.address,
          initialStakerBalance,
          false
        )
        await tokenStaking.topUpNu(operator.address)

        await expect(
          tokenStaking.connect(operator).unstakeKeep(operator.address)
        ).to.be.revertedWith("Nothing to unstake")
      })
    })

    context("when authorized amount more than non-Keep stake", () => {
      it("should revert", async () => {
        const tAmount = initialStakerBalance
        const keepAmount = initialStakerBalance

        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)

        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(operator.address)

        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking.connect(staker).topUp(operator.address, tAmount)

        const authorized = tAmount.add(1)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            operator.address,
            application1Mock.address,
            authorized
          )

        await expect(
          tokenStaking.connect(staker).unstakeKeep(operator.address)
        ).to.be.revertedWith("At least one application prevents from unstaking")
      })
    })

    context("when authorized amount less than non-Keep stake", () => {
      const tAmount = initialStakerBalance
      const keepAmount = initialStakerBalance
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      const authorized = tAmount
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)

        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          keepAmount
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(operator.address)

        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking.connect(staker).topUp(operator.address, tAmount)

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            operator.address,
            application1Mock.address,
            authorized
          )

        tx = await tokenStaking.connect(operator).unstakeKeep(operator.address)
      })

      it("should set Keep staked amount to zero", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
          zeroBigNumber,
          zeroBigNumber,
          tAmount,
          zeroBigNumber,
        ])
      })

      it("should decrease available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(tAmount.sub(authorized))
      })

      it("should update min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.T)
        ).to.equal(tAmount)
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.NU)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            operator.address,
            StakingProviders.KEEP
          )
        ).to.equal(0)
      })

      it("should emit Unstaked", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "Unstaked")
          .withArgs(operator.address, keepInTAmount)
      })
    })
  })

  describe("unstakeNu", () => {
    context("when operator has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeNu(deployer.address, 0)
        ).to.be.revertedWith("Operator has no stake")
      })
    })

    context("when caller is not owner or operator", () => {
      it("should revert", async () => {
        await nucypherStakingMock.setStaker(
          staker.address,
          initialStakerBalance,
          false
        )
        await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, beneficiary.address, authorizer.address)
        await expect(
          tokenStaking.connect(authorizer).unstakeNu(operator.address, 0)
        ).to.be.revertedWith("Only owner and operator can unstake tokens")
      })
    })

    context("when amount to unstake is zero", () => {
      it("should revert", async () => {
        await nucypherStakingMock.setStaker(
          staker.address,
          initialStakerBalance,
          false
        )
        await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, beneficiary.address, authorizer.address)
        await expect(
          tokenStaking.connect(staker).unstakeNu(operator.address, 0)
        ).to.be.revertedWith("Can't unstake specified amount of tokens")
      })
    })

    context("when stake is only in Keep and T", () => {
      it("should revert", async () => {
        const createdAt = 1
        await keepStakingMock.setOperator(
          operator.address,
          staker.address,
          beneficiary.address,
          authorizer.address,
          createdAt,
          0,
          initialStakerBalance
        )
        await keepStakingMock.setEligibility(
          operator.address,
          tokenStaking.address,
          true
        )
        await tokenStaking.stakeKeep(operator.address)

        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .topUp(operator.address, initialStakerBalance)

        const amountToUnstake = 1
        await expect(
          tokenStaking
            .connect(operator)
            .unstakeNu(operator.address, amountToUnstake)
        ).to.be.revertedWith("Can't unstake specified amount of tokens")
      })
    })

    context("when amount to unstake is more than not authorized", () => {
      it("should revert", async () => {
        const nuAmount = initialStakerBalance
        const nuInTAmount = convertToT(nuAmount, nuRatio).result
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
        await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, beneficiary.address, authorizer.address)

        const authorized = nuInTAmount.div(3)
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            operator.address,
            application1Mock.address,
            authorized
          )

        const amountToUnstake = nuInTAmount.sub(authorized).add(1)
        await expect(
          tokenStaking
            .connect(operator)
            .unstakeNu(operator.address, amountToUnstake)
        ).to.be.revertedWith("Can't unstake specified amount of tokens")
      })
    })

    context("when amount to unstake is less than not authorized", () => {
      const tAmount = initialStakerBalance
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const authorized = nuInTAmount.div(3).add(tAmount)
      const amountToUnstake = nuInTAmount.div(4)
      const expectedNuInTAmount = nuInTAmount.sub(amountToUnstake)
      let tx

      beforeEach(async () => {
        await tokenStaking
          .connect(deployer)
          .approveApplication(application1Mock.address)
        await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
        await tokenStaking
          .connect(staker)
          .stakeNu(operator.address, beneficiary.address, authorizer.address)

        await tToken.connect(staker).approve(tokenStaking.address, tAmount)
        await tokenStaking.connect(staker).topUp(operator.address, tAmount)

        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            operator.address,
            application1Mock.address,
            authorized
          )

        tx = await tokenStaking
          .connect(operator)
          .unstakeNu(operator.address, amountToUnstake)
      })

      it("should ypdate Nu staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
          expectedNuInTAmount,
          zeroBigNumber,
          tAmount,
          zeroBigNumber,
        ])
      })

      it("should decrease available amount to authorize", async () => {
        expect(
          await tokenStaking.getAvailableToAuthorize(
            operator.address,
            application1Mock.address
          )
        ).to.equal(expectedNuInTAmount.add(tAmount).sub(authorized))
      })

      it("should update min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.NU)
        ).to.equal(authorized.sub(tAmount))
        expect(
          await tokenStaking.getMinStaked(
            operator.address,
            StakingProviders.KEEP
          )
        ).to.equal(0)
      })

      it("should emit Unstaked", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "Unstaked")
          .withArgs(operator.address, amountToUnstake)
      })
    })
  })

  describe("unstakeAll", () => {
    context("when operator has no stake", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.unstakeAll(deployer.address)
        ).to.be.revertedWith("Operator has no stake")
      })
    })

    context("when caller is not owner or operator", () => {
      it("should revert", async () => {
        await tToken
          .connect(staker)
          .approve(tokenStaking.address, initialStakerBalance)
        await tokenStaking
          .connect(staker)
          .stake(
            operator.address,
            beneficiary.address,
            authorizer.address,
            initialStakerBalance
          )
        await expect(
          tokenStaking.connect(authorizer).unstakeAll(operator.address)
        ).to.be.revertedWith("Only owner and operator can unstake tokens")
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
            operator.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        const authorized = 1
        await tokenStaking
          .connect(authorizer)
          .increaseAuthorization(
            operator.address,
            application1Mock.address,
            authorized
          )

        await expect(
          tokenStaking.connect(operator).unstakeAll(operator.address)
        ).to.be.revertedWith("At least one application is still authorized")
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
            operator.address,
            beneficiary.address,
            authorizer.address,
            amount
          )
        await tokenStaking.connect(deployer).setMinimumStakeAmount(minAmount)

        await expect(
          tokenStaking.connect(staker).unstakeAll(operator.address)
        ).to.be.revertedWith("Unstaking is possible only after 24 hours")
      })
    })

    const contextUnstakeAll = (preparation, tAmount, isCallerStaker) => {
      const nuAmount = initialStakerBalance
      const nuInTAmount = convertToT(nuAmount, nuRatio).result
      const keepAmount = initialStakerBalance
      const keepInTAmount = convertToT(keepAmount, keepRatio).result
      let tx
      let blockTimestamp

      beforeEach(async () => {
        blockTimestamp = await preparation(nuAmount, keepAmount)

        tx = await tokenStaking
          .connect(isCallerStaker ? staker : operator)
          .unstakeAll(operator.address)
      })

      it("should update staked amount", async () => {
        expect(await tokenStaking.operators(operator.address)).to.deep.equal([
          staker.address,
          beneficiary.address,
          authorizer.address,
          zeroBigNumber,
          zeroBigNumber,
          zeroBigNumber,
          ethers.BigNumber.from(blockTimestamp),
        ])
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
            operator.address,
            application1Mock.address
          )
        ).to.equal(0)
      })

      it("should update min staked amount", async () => {
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.T)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(operator.address, StakingProviders.NU)
        ).to.equal(0)
        expect(
          await tokenStaking.getMinStaked(
            operator.address,
            StakingProviders.KEEP
          )
        ).to.equal(0)
      })

      it("should emit Unstaked", async () => {
        await expect(tx)
          .to.emit(tokenStaking, "Unstaked")
          .withArgs(
            operator.address,
            nuInTAmount.add(keepInTAmount).add(tAmount)
          )
      })
    }

    context("when stake is only in Keep and Nu", () => {
      contextUnstakeAll(
        async (nuAmount, keepAmount) => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepAmount
          )
          await keepStakingMock.setEligibility(
            operator.address,
            tokenStaking.address,
            true
          )
          await tokenStaking.stakeKeep(operator.address)

          await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
          await tokenStaking.topUpNu(operator.address)
          return 0
        },
        0,
        true
      )
    })

    context("when no minimum for T stake", () => {
      const tAmount = initialStakerBalance

      contextUnstakeAll(
        async (nuAmount, keepAmount) => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)

          await tToken.connect(staker).approve(tokenStaking.address, tAmount)
          await tokenStaking
            .connect(staker)
            .stake(
              operator.address,
              beneficiary.address,
              authorizer.address,
              tAmount
            )
          let blockTimestamp = await lastBlockTime()

          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepAmount
          )
          await keepStakingMock.setEligibility(
            operator.address,
            tokenStaking.address,
            true
          )
          await tokenStaking.topUpKeep(operator.address)

          await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
          await tokenStaking.topUpNu(operator.address)

          const authorized = tAmount
          await tokenStaking
            .connect(authorizer)
            .increaseAuthorization(
              operator.address,
              application1Mock.address,
              authorized
            )
          await tokenStaking
            .connect(authorizer)
            ["requestAuthorizationDecrease(address)"](operator.address)
          await application1Mock.approveAuthorizationDecrease(operator.address)

          return blockTimestamp
        },
        tAmount,
        true
      )
    })

    context("when initially T was topped-up", () => {
      const tAmount = initialStakerBalance

      contextUnstakeAll(
        async (nuAmount, keepAmount) => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
          await tokenStaking.connect(deployer).setMinimumStakeAmount(1)

          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepAmount
          )
          await keepStakingMock.setEligibility(
            operator.address,
            tokenStaking.address,
            true
          )
          await tokenStaking.stakeKeep(operator.address)

          await tToken.connect(staker).approve(tokenStaking.address, tAmount)
          await tokenStaking.connect(staker).topUp(operator.address, tAmount)
          blockTimestamp = await lastBlockTime()

          await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
          await tokenStaking.topUpNu(operator.address)

          return 0
        },
        tAmount,
        false
      )
    })

    context("when unstake after minimum staking time passes", () => {
      const tAmount = initialStakerBalance

      contextUnstakeAll(
        async (nuAmount, keepAmount) => {
          await tokenStaking
            .connect(deployer)
            .approveApplication(application1Mock.address)
          await tokenStaking.connect(deployer).setMinimumStakeAmount(1)

          await tToken.connect(staker).approve(tokenStaking.address, tAmount)
          await tokenStaking
            .connect(staker)
            .stake(
              operator.address,
              beneficiary.address,
              authorizer.address,
              tAmount
            )
          let blockTimestamp = await lastBlockTime()

          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            staker.address,
            beneficiary.address,
            authorizer.address,
            createdAt,
            0,
            keepAmount
          )
          await keepStakingMock.setEligibility(
            operator.address,
            tokenStaking.address,
            true
          )
          await tokenStaking.topUpKeep(operator.address)

          await nucypherStakingMock.setStaker(staker.address, nuAmount, false)
          await tokenStaking.topUpNu(operator.address)

          const oneDay = 86400
          await ethers.provider.send("evm_increaseTime", [oneDay])

          return blockTimestamp
        },
        tAmount,
        false
      )
    })
  })
})

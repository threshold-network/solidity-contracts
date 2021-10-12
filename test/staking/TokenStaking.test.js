const { expect } = require("chai")
const {
  ZERO_ADDRESS,
  lastBlockTime,
  to1e18,
  to1ePrecision,
} = require("../helpers/contract-test-helpers")
const zeroBigNumber = ethers.BigNumber.from(0)

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

          it("should deacrease available amount to authorize for one application", async () => {
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

        context("when authorize all staked tokens in several txs", () => {
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

          it("should deacrease available amount to authorize for one application", async () => {
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
      })
    })

    context("when caller is authorizer of operator with mixed stake", () => {
      const tStake = initialStakerBalance
      const keepStake = initialStakerBalance
      const nuStake = initialStakerBalance
      const tAmount = tStake
        .add(convertToT(keepStake, keepRatio).result)
        .add(convertToT(nuStake, nuRatio).result)

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
        const authorizedAmount = tAmount.sub(1)

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

        it("should deacrease available amount to authorize for one application", async () => {
          expect(
            await tokenStaking.getAvailableToAuthorize(
              operator.address,
              application1Mock.address
            )
          ).to.equal(tAmount.sub(authorizedAmount))
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
})

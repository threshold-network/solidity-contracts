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

  describe("setting minimum stake amount", () => {
    const amount = 1

    context("caller is not the governance", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(staker).setMinimumStakeAmount(amount)
        ).to.be.revertedWith("Caller is not the governance")
      })
    })

    context("caller is the governance", () => {
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

  describe("stake T", () => {
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

  describe("stake Keep", () => {
    context("when caller did not provide operator", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(staker).stakeKeep(ZERO_ADDRESS)
        ).to.be.revertedWith("Operator must be specified")
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
          tokenStaking.connect(staker).stakeKeep(operator.address)
        ).to.be.revertedWith("Can't stake KEEP for this operator")
      })
    })

    context("when specified address never was an operator in Keep", () => {
      it("should revert", async () => {
        await expect(
          tokenStaking.connect(staker).stakeKeep(operator.address)
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
          tx = await tokenStaking.connect(staker).stakeKeep(operator.address)
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
          tx = await tokenStaking.connect(staker).stakeKeep(operator.address)
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

  describe("stake Nu", () => {
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
          const amount = 0
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
})

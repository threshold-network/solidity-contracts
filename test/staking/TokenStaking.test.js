const { expect } = require("chai")
const {
  ZERO_ADDRESS,
  lastBlockTime,
  to1e18,
  to1ePrecision,
} = require("../helpers/contract-test-helpers")

describe("TokenStaking", () => {
  let tToken
  let keepVendingMachine
  let nucypherVendingMachine
  let keepStakingMock
  let nucypherStakingMock

  const tAllocation = to1e18("4500000000") // 4.5 Billion
  const maxKeepWrappedTokens = to1e18("1100000000") // 1.1 Billion
  const maxNuWrappedTokens = to1e18("900000000") // 0.9 Billion

  let tokenStaking

  let deployer
  // Token staker has 5 T tokens
  let tStaker
  const initialStakerBalance = to1e18(5)
  let operator
  let authorizer
  let beneficiary

  let keepTokenStaker
  let nuTokenStaker
  let otherStaker

  beforeEach(async () => {
    ;[
      deployer,
      tStaker,
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
      .transfer(tStaker.address, initialStakerBalance)
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
      it("contracts addresses should be correct", async () => {
        expect(await tokenStaking.token()).to.equal(tToken.address)
        expect(await tokenStaking.keepStakingContract()).to.equal(
          keepStakingMock.address
        )
        expect(await tokenStaking.nucypherStakingContract()).to.equal(
          nucypherStakingMock.address
        )
      })
      it("conversion ratios were copied correctly", async () => {
        expect(await tokenStaking.keepFloatingPointDivisor()).to.equal(
          await keepVendingMachine.FLOATING_POINT_DIVISOR()
        )
        expect(await tokenStaking.keepRatio()).to.equal(
          await keepVendingMachine.ratio()
        )
        expect(await tokenStaking.nucypherRatio()).to.equal(
          await nucypherVendingMachine.ratio()
        )
      })
    })
  })

  describe("stake T", () => {
    context("when caller did not provide operator", () => {
      it("should revert", async () => {
        amount = 0
        await expect(
          tokenStaking
            .connect(tStaker)
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
          await tToken.connect(tStaker).approve(tokenStaking.address, amount)
          await expect(
            tokenStaking
              .connect(tStaker)
              .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          ).to.be.revertedWith("Operator is already in use")
        })
      })

      context("when operator is in use in Keep staking contract", () => {
        it("should revert", async () => {
          const createdAt = 1
          await keepStakingMock.setOperator(
            operator.address,
            keepTokenStaker.address,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            createdAt,
            0,
            0
          )
          const amount = 0
          await expect(
            tokenStaking
              .connect(tStaker)
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
              .connect(tStaker)
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
          await tToken.connect(tStaker).approve(tokenStaking.address, amount)
          await expect(
            tokenStaking
              .connect(tStaker)
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
          await tToken.connect(tStaker).approve(tokenStaking.address, amount)
          tx = await tokenStaking
            .connect(tStaker)
            .stake(operator.address, ZERO_ADDRESS, ZERO_ADDRESS, amount)
          blockTimestamp = await lastBlockTime()
        })

        it("should set roles equal to the caller address", async () => {
          expect(await tokenStaking.operators(operator.address)).to.deep.equal([
            tStaker.address,
            tStaker.address,
            tStaker.address,
            ethers.BigNumber.from(0),
            ethers.BigNumber.from(0),
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
            .withArgs(tStaker.address, operator.address)

          await expect(tx)
            .to.emit(tokenStaking, "OperatorStaked")
            .withArgs(
              operator.address,
              tStaker.address,
              tStaker.address,
              amount
            )
        })
      })

      context("when authorizer and beneficiary were provided", () => {
        beforeEach(async () => {
          await tToken.connect(tStaker).approve(tokenStaking.address, amount)
          tx = await tokenStaking
            .connect(tStaker)
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
            tStaker.address,
            beneficiary.address,
            authorizer.address,
            ethers.BigNumber.from(0),
            ethers.BigNumber.from(0),
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
            .withArgs(tStaker.address, operator.address)

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
})

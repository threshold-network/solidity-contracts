const { expect } = require("chai")
const {
  resetFork,
  impersonateAccount,
  to1e18,
} = require("../helpers/contract-test-helpers")
const { initContracts } = require("./init-contracts")
const {
  keepGrantStake,
  keepLiquidTokenStake,
  keepManagedGrantStake,
  keepTokenGrantAddress,
} = require("./constants")

const describeFn =
  process.env.NODE_ENV === "system-test" ? describe : describe.skip

describeFn("SystemTests: TokenStaking", () => {
  const startingBlock = 13619810

  let purse

  // Contracts
  let keepToken
  let keepTokenStaking
  let tokenStaking

  beforeEach(async () => {
    await resetFork(startingBlock)

    purse = await ethers.getSigner(0)

    const contracts = await initContracts()
    keepToken = contracts.keepToken
    keepTokenStaking = contracts.keepTokenStaking
    tokenStaking = contracts.tokenStaking
  })

  const describeStake = (
    ownerAddress,
    operatorAddress,
    authorizerAddress,
    expectedStake
  ) => {
    let owner
    let operator
    let authorizer

    beforeEach(async () => {
      // impersonate and drop 1 ETH for each account
      owner = await impersonateAccount(ownerAddress, purse, "1")
      operator = await impersonateAccount(operatorAddress, purse, "1")
      authorizer = await impersonateAccount(authorizerAddress, purse, "1")
    })

    context("when I have authorized T staking contract", () => {
      beforeEach(async () => {
        await keepTokenStaking
          .connect(authorizer)
          .authorizeOperatorContract(operatorAddress, tokenStaking.address)
      })

      context("when I have not undelegated my legacy stake", () => {
        describe("stakeKeep", () => {
          beforeEach(async () => {
            await tokenStaking.stakeKeep(operator.address)
          })

          it("should copy my stake to T staking contract", async () => {
            const stakes = await tokenStaking.stakes(operatorAddress)
            expect(stakes[0]).to.be.equal(0) // [T]
            expect(stakes[1]).to.be.equal(expectedStake) // [KEEP]
            expect(stakes[2]).to.be.equal(0) // [NU]
          })
        })
      })

      context("when I have undelegated my legacy stake", () => {
        beforeEach(async () => {
          await keepTokenStaking.connect(owner).undelegate(operator.address)
        })

        describe("stakeKeep", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking.stakeKeep(operator.address)
            ).to.be.revertedWith("Nothing to sync")
          })
        })
      })
    })
  }

  const describeTopUp = (
    ownerAddress,
    operatorAddress,
    authorizerAddress,
    beneficiaryAddress,
    topUpLegacyStakeFn,
    expectedStake
  ) => {
    let owner
    let operator
    let authorizer
    let beneficiary

    beforeEach(async () => {
      // impersonate and drop 1 ETH for each account
      owner = await impersonateAccount(ownerAddress, purse, "1")
      operator = await impersonateAccount(operatorAddress, purse, "1")
      authorizer = await impersonateAccount(authorizerAddress, purse, "1")
      beneficiary = await impersonateAccount(beneficiaryAddress, purse, "1")
    })

    context("when I copied my stake to T staking contract", () => {
      beforeEach(async () => {
        await keepTokenStaking
          .connect(authorizer)
          .authorizeOperatorContract(operatorAddress, tokenStaking.address)
        await tokenStaking.stakeKeep(operator.address)
      })

      context("when I executed top-up of my legacy stake", () => {
        beforeEach(async () => {
          await topUpLegacyStakeFn(owner, operator, authorizer, beneficiary)
        })

        describe("topUpKeep", () => {
          beforeEach(async () => {
            await tokenStaking.connect(owner).topUpKeep(operatorAddress)
          })

          it("should top-up my stake in T staking contract", async () => {
            const stakes = await tokenStaking.stakes(operatorAddress)
            expect(stakes[0]).to.be.equal(0) // [T]
            expect(stakes[1]).to.be.equal(expectedStake) // [KEEP]
            expect(stakes[2]).to.be.equal(0) // [NU]
          })
        })
      })
    })
  }

  context("Given I am KEEP network liquid token staker", () => {
    const ownerAddress = keepLiquidTokenStake.owner
    const operatorAddress = keepLiquidTokenStake.operator
    const authorizerAddress = keepLiquidTokenStake.authorizer
    const beneficiaryAddress = keepLiquidTokenStake.beneficiary

    const expectedInitialStake = to1e18("1500000") // [T]

    describeStake(
      ownerAddress,
      operatorAddress,
      authorizerAddress,
      expectedInitialStake
    )

    const topUpAmountKeep = to1e18("1000") // [KEEP]
    const expectedStakeAfterTopUp = to1e18("1500500") // [T]

    const topUpLegacyStakeFn = async (
      owner,
      operator,
      authorizer,
      beneficiary
    ) => {
      // Send KEEP from the beneficiary account since the owner has 0 KEEP.
      await keepToken
        .connect(beneficiary)
        .transfer(owner.address, topUpAmountKeep)

      const data = ethers.utils.solidityPack(
        ["address", "address", "address"],
        [beneficiary.address, operator.address, authorizer.address]
      )
      await keepToken
        .connect(owner)
        .approveAndCall(keepTokenStaking.address, topUpAmountKeep, data)

      // Jump beyond the stake initialization period.
      // Required to commit the top-up.
      await helpers.time.increaseTime(43200)

      await keepTokenStaking.connect(owner).commitTopUp(operator.address)
    }

    describeTopUp(
      ownerAddress,
      operatorAddress,
      authorizerAddress,
      beneficiaryAddress,
      topUpLegacyStakeFn,
      expectedStakeAfterTopUp
    )
  })

  context("Given I am KEEP network managed grant staker", () => {
    const ownerAddress = keepManagedGrantStake.grantee
    const operatorAddress = keepManagedGrantStake.operator
    const authorizerAddress = keepManagedGrantStake.authorizer
    const beneficiaryAddress = keepManagedGrantStake.beneficiary
    const managedGrantAddress = keepManagedGrantStake.managedGrant

    const expectedInitialStake = to1e18("598000")

    describeStake(
      ownerAddress,
      operatorAddress,
      authorizerAddress,
      expectedInitialStake
    )

    const topUpAmountKeep = to1e18("100") // [KEEP]
    const expectedStakeAfterTopUp = to1e18("598050") // [T]

    const topUpLegacyStakeFn = async (
      owner,
      operator,
      authorizer,
      beneficiary
    ) => {
      const managedGrant = await ethers.getContractAt(
        "IKeepManagedGrant",
        managedGrantAddress
      )

      const data = ethers.utils.solidityPack(
        ["address", "address", "address"],
        [beneficiary.address, operator.address, authorizer.address]
      )
      await managedGrant
        .connect(owner)
        .stake(keepTokenStaking.address, topUpAmountKeep, data)

      // Jump beyond the stake initialization period.
      // Required to commit the top-up.
      await helpers.time.increaseTime(43200)

      await keepTokenStaking.connect(owner).commitTopUp(operator.address)
    }

    describeTopUp(
      ownerAddress,
      operatorAddress,
      authorizerAddress,
      beneficiaryAddress,
      topUpLegacyStakeFn,
      expectedStakeAfterTopUp
    )
  })

  context("Given I am KEEP network non-managed grant staker", () => {
    const ownerAddress = keepGrantStake.grantee
    const operatorAddress = keepGrantStake.operator
    const authorizerAddress = keepGrantStake.authorizer
    const beneficiaryAddress = keepGrantStake.beneficiary
    const grantID = keepGrantStake.grantID

    const expectedInitialStake = "416266500000000000000000"

    describeStake(
      ownerAddress,
      operatorAddress,
      authorizerAddress,
      expectedInitialStake
    )

    const topUpAmountKeep = "100000000000000000" // [KEEP]
    const expectedStakeAfterTopUp = "416266550000000000000000" // [T]

    const topUpLegacyStakeFn = async (
      owner,
      operator,
      authorizer,
      beneficiary
    ) => {
      const tokenGrant = await ethers.getContractAt(
        "IKeepTokenGrant",
        keepTokenGrantAddress
      )

      const data = ethers.utils.solidityPack(
        ["address", "address", "address"],
        [beneficiary.address, operator.address, authorizer.address]
      )
      await tokenGrant
        .connect(owner)
        .stake(grantID, keepTokenStaking.address, topUpAmountKeep, data)

      // Jump beyond the stake initialization period.
      // Required to commit the top-up.
      await helpers.time.increaseTime(43200)

      await keepTokenStaking.connect(owner).commitTopUp(operator.address)
    }

    describeTopUp(
      ownerAddress,
      operatorAddress,
      authorizerAddress,
      beneficiaryAddress,
      topUpLegacyStakeFn,
      expectedStakeAfterTopUp
    )
  })
})

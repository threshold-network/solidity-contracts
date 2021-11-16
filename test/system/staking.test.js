const { expect } = require("chai")
const {
  resetFork,
  impersonateAccount,
} = require("../helpers/contract-test-helpers")
const { initContracts } = require("./init-contracts")
const {
  keepGrantStake,
  keepLiquidTokenStake,
  keepManagedGrantStake,
} = require("./constants")

const describeFn =
  process.env.NODE_ENV === "system-test" ? describe : describe.skip

describeFn("SystemTests: TokenStaking", () => {
  const startingBlock = 13619810

  let purse

  // Contracts
  let keepTokenStaking
  let tokenStaking

  before(async () => {
    await resetFork(startingBlock)

    purse = await ethers.getSigner(0)

    const contracts = await initContracts()
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

    before(async () => {
      // impersonate and drop 1 ETH for each account
      owner = await impersonateAccount(ownerAddress, purse, "1")
      operator = await impersonateAccount(operatorAddress, purse, "1")
      authorizer = await impersonateAccount(authorizerAddress, purse, "1")
    })

    context("I have authorized T staking contract", () => {
      before(async () => {
        await keepTokenStaking
          .connect(authorizer)
          .authorizeOperatorContract(operatorAddress, tokenStaking.address)
      })

      context("I have not undelegated my legacy stake", () => {
        describe("stakeKeep", () => {
          before(async () => {
            await tokenStaking.stakeKeep(operator.address)
          })

          it("should copy my stake to T staking contract", async () => {
            const stakes = await tokenStaking.stakes(operatorAddress)
            expect(stakes[0]).to.be.equal(0) // T
            expect(stakes[1]).to.be.equal(expectedStake) // KEEP
            expect(stakes[2]).to.be.equal(0) // NU
          })
        })
      })

      context("I have undelegated my legacy stake", () => {
        before(async () => {
          await keepTokenStaking.connect(owner).undelegate(operator.address)
        })

        describe("stakeKeep", () => {
          it("should revert", async () => {
            await expect(
              tokenStaking.stakeKeep(operator.address)
            ).to.be.revertedWith("Operator is already in use")
          })
        })
      })
    })
  }

  context("Given I am KEEP network managed grant staker", () => {
    describeStake(
      keepManagedGrantStake.grantee,
      keepManagedGrantStake.operator,
      keepManagedGrantStake.authorizer,
      "598000000000000000000000"
    )
  })

  context("Given I am KEEP network non-managed grant staker", () => {
    describeStake(
      keepGrantStake.grantee,
      keepGrantStake.operator,
      keepGrantStake.authorizer,
      "416266500000000000000000"
    )
  })

  context("Given I am KEEP network liquid token staker", () => {
    describeStake(
      keepLiquidTokenStake.owner,
      keepLiquidTokenStake.operator,
      keepLiquidTokenStake.authorizer,
      "1500000000000000000000000"
    )
  })
})

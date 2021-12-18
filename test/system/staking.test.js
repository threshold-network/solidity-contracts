const { expect } = require("chai")

const { helpers } = require("hardhat")
const { impersonateAccount } = helpers.account
const { to1e18 } = helpers.number
const { resetFork } = helpers.forking

const { initContracts } = require("./init-contracts")
const { keepManagedGrantAddress } = require("./constants")

const describeFn =
  process.env.NODE_ENV === "system-test" ? describe : describe.skip

describeFn("System -- staking", () => {
  const startingBlock = 13619810

  // Roles.
  // eslint-disable-next-line no-unused-vars
  let governance
  let beneficiary
  let operator
  let authorizer
  let purse

  // Contracts
  let keepTokenStaking
  let tokenStaking

  before(async () => {
    await resetFork(startingBlock)

    governance = await ethers.getSigner(0)
    beneficiary = await ethers.getSigner(1)
    operator = await ethers.getSigner(2)
    authorizer = await ethers.getSigner(3)
    purse = await ethers.getSigner(4)

    const contracts = await initContracts()
    keepTokenStaking = contracts.keepTokenStaking
    tokenStaking = contracts.tokenStaking

    await delegateStake()
  })

  describe("test initial state", () => {
    describe("legacy KEEP staking contract", () => {
      it("should contain stake for operator", async () => {
        expect(
          await keepTokenStaking.eligibleStake(
            operator.address,
            tokenStaking.address
          )
        ).to.be.equal(to1e18(100000))
      })
    })

    describe("T staking contract", () => {
      it("should not contain any stakes for operator", async () => {
        const stakes = await tokenStaking.stakes(operator.address)

        expect(stakes[0]).to.be.equal(0) // tStake
        expect(stakes[1]).to.be.equal(0) // keepInTStake
        expect(stakes[2]).to.be.equal(0) // nuInTStake
      })
    })
  })

  describe("when operator stakes tokens from legacy KEEP staking contract", () => {
    let tx

    before(async () => {
      tx = await tokenStaking.stakeKeep(operator.address)
    })

    it("should copy delegation from the legacy KEEP staking contract to T staking contract", async () => {
      const stakes = await tokenStaking.stakes(operator.address)

      // KEEP -> T ratio is 0.5 (see init-contracts.js) and the operator has
      // a stake equal to 100k KEEP. After `stakeKeep` it should have 50k of T.
      expect(stakes[0]).to.be.equal(to1e18(0)) // tStake
      expect(stakes[1]).to.be.equal(to1e18(50000)) // keepInTStake
      expect(stakes[2]).to.be.equal(0) // nuInTStake
    })

    it("should emit OperatorStaked event", async () => {
      // TODO: Assert event params are correct.
      await expect(tx).to.emit(tokenStaking, "OperatorStaked")
    })
  })

  async function delegateStake() {
    const managedGrant = await ethers.getContractAt(
      "ITestManagedGrant",
      keepManagedGrantAddress
    )
    const granteeAddress = await managedGrant.grantee()
    const grantee = await impersonateAccount(granteeAddress, {
      from: purse,
      value: "5",
    })

    const stakeDelegationData = ethers.utils.solidityPack(
      ["address", "address", "address"],
      [beneficiary.address, operator.address, authorizer.address]
    )

    await managedGrant
      .connect(grantee)
      .stake(keepTokenStaking.address, to1e18(100000), stakeDelegationData)

    await keepTokenStaking
      .connect(authorizer)
      .authorizeOperatorContract(operator.address, tokenStaking.address)

    // Jump beyond the stake initialization period.
    await helpers.time.increaseTime(43200)
  }
})

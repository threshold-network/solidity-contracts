const { expect } = require("chai")

const { helpers } = require("hardhat")
const { impersonateAccount } = helpers.account
const { resetFork } = helpers.forking

const { initContracts } = require("./init-contracts")
const { daoAgentAddress } = require("./constants")

const describeFn =
  process.env.NODE_ENV === "stakingescrow-test" ? describe : describe.skip

describeFn("StakingEscrow", () => {
  const startingBlock = 13979631

  let nuCypherStakingEscrow
  let stakingEscrowImplementation

  beforeEach(async () => {
    await resetFork(startingBlock)

    const contracts = await initContracts()
    nuCypherStakingEscrow = contracts.nuCypherStakingEscrow
    stakingEscrowImplementation = contracts.stakingEscrowImplementation

    const purse = await ethers.getSigner(1)

    daoAgent = await impersonateAccount(daoAgentAddress, {from: purse, value: "20",})

    console.log("=== the new target should be: ", stakingEscrowImplementation.address)
    console.log("=== target before ", await nuCypherStakingEscrow.target())
    console.log(await nuCypherStakingEscrow.connect(daoAgent).upgrade(stakingEscrowImplementation.address))
    console.log("new target: ", await nuCypherStakingEscrow.target())

  })

  describe("foo", () => {
    context("bar", () => {
      it("foobar", () => {
        let value = true
        expect(value).to.be.equal(true)
      })
    })
  })
})

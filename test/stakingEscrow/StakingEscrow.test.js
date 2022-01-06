const { expect } = require("chai")

const { helpers } = require("hardhat")
const { resetFork } = helpers.forking

const { initContracts } = require ("./init-contracts")

const describeFn =
  process.env.NODE_ENV === "stakingescrow-test" ? describe : describe.skip

describeFn("StakingEcrow", () => {
  const startingBlock = 13946254

  let tToken

  beforeEach(async () => {
    await resetFork(startingBlock)

    const contracts = await initContracts()
    tToken = contracts.tToken
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
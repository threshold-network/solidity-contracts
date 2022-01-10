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

    const deployer = await ethers.getSigner(0)
    const test = await ethers.getSigner(10)

    daoAgent = await impersonateAccount(daoAgentAddress, {from: deployer, value: "2",})

    // WIP: check if I can send Ether from impersonated address
    console.log(await daoAgent.getBalance())
    console.log(await test.getBalance())

    await daoAgent.sendTransaction({
      to: test.address,
      value: ethers.utils.parseEther("1.0"), // Sends exactly 1.0 ether
    });

    console.log(await daoAgent.getBalance())
    console.log(await test.getBalance())

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

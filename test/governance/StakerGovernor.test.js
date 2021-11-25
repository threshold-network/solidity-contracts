const { expect } = require("chai")
const { defaultAbiCoder } = require("@ethersproject/abi")
const {
  mineBlock,
  to1e18,
  ZERO_ADDRESS,
} = require("../helpers/contract-test-helpers")

const ProposalStates = {
  Pending: 0,
  Active: 1,
  Canceled: 2,
}

describe("StakerGovernor", () => {
  let tToken
  let staker
  let whale
  let vetoer

  // Initial scenario is 2 stakers, whose total amount is 30,000 tokens.
  const initialStakerBalance = to1e18(75)
  const whaleBalance = to1e18(30000 - 75)

  // Proposal threshold is 0.25%, so first stake (5 tokens) is below the
  // threshold. After the top-up, it should be over it.
  const firstStake = to1e18(5)
  const topUpAmount = to1e18(70)

  beforeEach(async () => {
    const T = await ethers.getContractFactory("T")
    tToken = await T.deploy()
    await tToken.deployed()

    const TestStaking = await ethers.getContractFactory(
      "TestStakingCheckpoints"
    )
    tStaking = await TestStaking.deploy(tToken.address)
    await tStaking.deployed()
    ;[staker, whale, vetoer] = await ethers.getSigners()
    await tToken.mint(staker.address, initialStakerBalance)
    await tToken.mint(whale.address, whaleBalance)

    const TestGovernor = await ethers.getContractFactory("TestStakerGovernor")
    tGov = await TestGovernor.deploy(tStaking.address, vetoer.address)
    await tGov.deployed()
  })

  describe("static parameters", () => {
    it("quorum denominator is 10000", async () => {
      expect(await tGov.FRACTION_DENOMINATOR()).to.equal(10000)
    })

    it("quorum numerator is 150", async () => {
      expect(await tGov.quorumNumerator()).to.equal(150)
    })

    it("proposal threshold numerator is 25", async () => {
      expect(await tGov.proposalThresholdNumerator()).to.equal(25)
    })

    // TODO: delays
  })

  describe("when stakers deposit tokens", () => {
    const expectedTotalStake = whaleBalance.add(firstStake)
    const expectedThreshold = expectedTotalStake.mul(25).div(10000)
    const mockDescription = "Mock Proposal"
    const mockProposal = [[ZERO_ADDRESS], [42], [0xfabada]]
    const mockProposalWithDescription = [...mockProposal, mockDescription]

    beforeEach(async () => {
      await tToken.connect(whale).approve(tStaking.address, whaleBalance)
      await tStaking.connect(whale).deposit(whaleBalance)

      await tToken.connect(staker).approve(tStaking.address, firstStake)
      await tStaking.connect(staker).deposit(firstStake)

      lastBlock = (await mineBlock()) - 1
    })

    context("only whale has enough stake to propose", () => {
      it("proposal threshold is as expected", async () => {
        expect(await tGov.proposalThreshold()).to.equal(expectedThreshold)
      })

      it("whale can make a proposal", async () => {
        await tGov.connect(whale).propose(...mockProposalWithDescription)
      })

      it("staker can't make a proposal", async () => {
        await expect(
          tGov.connect(staker).propose(...mockProposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
      })
    })

    context("after top-up, staker has enough tokens to propose", () => {
      const newTotalStake = expectedTotalStake.add(topUpAmount)
      const newExpectedThreshold = newTotalStake.mul(25).div(10000)

      beforeEach(async () => {
        await tToken.connect(staker).approve(tStaking.address, topUpAmount)
        await tStaking.connect(staker).deposit(topUpAmount)
        lastBlock = (await mineBlock()) - 1
      })

      it("proposal threshold is as expected", async () => {
        expect(await tGov.proposalThreshold()).to.equal(newExpectedThreshold)
      })

      it("whale still can make a proposal", async () => {
        await tGov.connect(whale).propose(...mockProposalWithDescription)
      })

      it("staker can make a proposal too", async () => {
        await tGov.connect(staker).propose(...mockProposalWithDescription)
      })
    })

    context("when there's a proposal", () => {
      const descriptionHash = ethers.utils.id(mockDescription)
      const mockProposalWithHash = [...mockProposal, descriptionHash]
      const proposalID = ethers.utils.keccak256(
        defaultAbiCoder.encode(
          ["address[]", "uint256[]", "bytes[]", "bytes32"],
          mockProposalWithHash
        )
      )

      beforeEach(async () => {
        await tGov.connect(whale).propose(...mockProposalWithDescription)
      })

      it("proposal state is 'pending' initially", async () => {
        expect(await tGov.state(proposalID)).to.equal(ProposalStates.Pending)
      })

      it("stakers can't cancel the proposal", async () => {
        await expect(tGov.connect(whale).cancel(...mockProposalWithHash)).to.be
          .reverted
        await expect(tGov.connect(staker).cancel(...mockProposalWithHash)).to.be
          .reverted
      })

      it("vetoer can cancel the proposal", async () => {
        await tGov.connect(vetoer).cancel(...mockProposalWithHash)
        expect(await tGov.state(proposalID)).to.equal(ProposalStates.Canceled)
      })
    })
  })
})

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

describe("TokenholderGovernor", () => {
  let tToken
  let staker
  let stakerWhale
  let holder
  let holderWhale
  let vetoer

  // Initial scenario has a total of 100,000 tokens
  // - 2 stakers, whose total amount is 60,000 tokens and it's initially liquid
  // - 2 holders, whose total amount of 40,000 tokens
  const expectedTotal = to1e18(100000)
  const stakerBalance = to1e18(200)
  const stakerWhaleBalance = to1e18(60000 - 200)
  const holderBalance = to1e18(100)
  const holderWhaleBalance = to1e18(40000 - 100)

  // Proposal threshold is 0.25%, so the small stake (200 tokens) is below the
  // threshold (currently, 250 tokens).
  const expectedThreshold = expectedTotal.mul(25).div(10000)

  // ... but a whale will give our small staker some extra liquid tokens later,
  // which will put them over the proposal threshold
  const extraTokens = to1e18(1000)

  // Mock proposal
  const mockDescription = "Mock Proposal"
  const mockProposal = [[ZERO_ADDRESS], [42], [0xbebecafe]]
  const mockProposalWithDescription = [...mockProposal, mockDescription]
  const descriptionHash = ethers.utils.id(mockDescription)
  const mockProposalWithHash = [...mockProposal, descriptionHash]
  const proposalID = ethers.utils.keccak256(
    defaultAbiCoder.encode(
      ["address[]", "uint256[]", "bytes[]", "bytes32"],
      mockProposalWithHash
    )
  )

  beforeEach(async () => {
    const T = await ethers.getContractFactory("T")
    tToken = await T.deploy()
    await tToken.deployed()

    const TestStaking = await ethers.getContractFactory(
      "TestStakingCheckpoints"
    )
    tStaking = await TestStaking.deploy(tToken.address)
    await tStaking.deployed()
    ;[staker, stakerWhale, holder, holderWhale, vetoer] =
      await ethers.getSigners()
    await tToken.mint(staker.address, stakerBalance)
    await tToken.mint(stakerWhale.address, stakerWhaleBalance)
    await tToken.mint(holder.address, holderBalance)
    await tToken.mint(holderWhale.address, holderWhaleBalance)

    const TestGovernor = await ethers.getContractFactory(
      "TestTokenholderGovernor"
    )
    tGov = await TestGovernor.deploy(
      tToken.address,
      tStaking.address,
      vetoer.address
    )
    await tGov.deployed()

    lastBlock = (await mineBlock()) - 1
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

    // TODO: delays and proposal numerator
  })

  describe("when all tokens are liquid", () => {
    context("...but nobody delegated their vote...", () => {
      it("proposal threshold is as expected", async () => {
        expect(await tGov.proposalThreshold()).to.equal(expectedThreshold)
      })
      it("nobody can make a proposal", async () => {
        await expect(
          tGov.connect(staker).propose(...mockProposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
        await expect(
          tGov.connect(stakerWhale).propose(...mockProposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
        await expect(
          tGov.connect(holder).propose(...mockProposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
        await expect(
          tGov.connect(holderWhale).propose(...mockProposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
      })
    })

    describe("when people delegated their vote", () => {
      beforeEach(async () => {
        // For simplicity, let's assume they delegate to themselves
        await tToken.connect(staker).delegate(staker.address)
        await tToken.connect(stakerWhale).delegate(stakerWhale.address)
        await tToken.connect(holder).delegate(holder.address)
        await tToken.connect(holderWhale).delegate(holderWhale.address)
      })

      context("some of them can create proposals", () => {
        it("proposal threshold remains as expected", async () => {
          expect(await tGov.proposalThreshold()).to.equal(expectedThreshold)
        })
        it("small fish can't make a proposal", async () => {
          await expect(
            tGov.connect(staker).propose(...mockProposalWithDescription)
          ).to.be.revertedWith("Proposal below threshold")
          await expect(
            tGov.connect(holder).propose(...mockProposalWithDescription)
          ).to.be.revertedWith("Proposal below threshold")
        })

        it("but whales can (1/2)", async () => {
          await tGov
            .connect(stakerWhale)
            .propose(...mockProposalWithDescription)
        })
        it("but whales can (2/2)", async () => {
          await tGov
            .connect(holderWhale)
            .propose(...mockProposalWithDescription)
        })
      })
    })
  })

  describe("when stakers deposit tokens", () => {
    beforeEach(async () => {
      await tToken
        .connect(stakerWhale)
        .approve(tStaking.address, stakerWhaleBalance)
      await tStaking.connect(stakerWhale).deposit(stakerWhaleBalance)

      await tToken.connect(staker).approve(tStaking.address, stakerBalance)
      await tStaking.connect(staker).deposit(stakerBalance)

      lastBlock = (await mineBlock()) - 1
    })

    context("only stakerWhale has enough stake to propose", () => {
      it("proposal threshold is as expected", async () => {
        expect(await tGov.proposalThreshold()).to.equal(expectedThreshold)
      })

      it("stakerWhale can make a proposal", async () => {
        await tGov.connect(stakerWhale).propose(...mockProposalWithDescription)
      })

      it("staker can't make a proposal", async () => {
        await expect(
          tGov.connect(staker).propose(...mockProposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
      })
    })

    context(
      "after getting some extra liquid tokens, staker can propose",
      () => {
        beforeEach(async () => {
          await tToken.connect(staker).delegate(staker.address)
          await tToken
            .connect(holderWhale)
            .transfer(staker.address, extraTokens)
          lastBlock = (await mineBlock()) - 1
        })

        it("proposal threshold remains as expected", async () => {
          expect(await tGov.proposalThreshold()).to.equal(expectedThreshold)
        })

        it("stakerWhale still can make a proposal", async () => {
          await tGov
            .connect(stakerWhale)
            .propose(...mockProposalWithDescription)
        })

        it("staker can now make a proposal too", async () => {
          await tGov.connect(staker).propose(...mockProposalWithDescription)
        })
      }
    )

    context("when there's a proposal", () => {
      beforeEach(async () => {
        await tGov.connect(stakerWhale).propose(...mockProposalWithDescription)
      })

      it("proposal state is 'pending' initially", async () => {
        expect(await tGov.state(proposalID)).to.equal(ProposalStates.Pending)
      })

      it("stakers can't cancel the proposal", async () => {
        await expect(tGov.connect(stakerWhale).cancel(...mockProposalWithHash))
          .to.be.reverted
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

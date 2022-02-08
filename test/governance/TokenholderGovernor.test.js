const { expect } = require("chai")
const { defaultAbiCoder } = require("@ethersproject/abi")
const { mineBlocks } = helpers.time
const { to1e18 } = helpers.number
const { AddressZero } = ethers.constants

const ProposalStates = {
  Pending: 0,
  Active: 1,
  Canceled: 2,
  Defeated: 3,
  Succeeded: 4,
  Queued: 5,
  Expired: 6,
  Executed: 7,
}

const Vote = {
  Nay: 0,
  Yea: 1,
}

describe("TokenholderGovernor", () => {
  let deployer
  let tToken
  let staker
  let stakerWhale
  let holder
  let holderWhale
  let vetoer
  let timelock

  let proposalThresholdFunction

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
  let description = "Mock Proposal"
  let proposal = [[AddressZero], [42], [0xbebecafe]]
  let proposalWithDescription = [...proposal, description]
  let descriptionHash = ethers.utils.id(description)
  let proposalWithHash = [...proposal, descriptionHash]
  let proposalID = ethers.utils.keccak256(
    defaultAbiCoder.encode(
      ["address[]", "uint256[]", "bytes[]", "bytes32"],
      proposalWithHash
    )
  )

  beforeEach(async () => {
    ;[deployer, staker, stakerWhale, holder, holderWhale, vetoer] =
      await ethers.getSigners()

    const T = await ethers.getContractFactory("T")
    tToken = await T.deploy()
    await tToken.deployed()

    const TestStaking = await ethers.getContractFactory(
      "TestStakingCheckpoints"
    )
    tStaking = await TestStaking.deploy(tToken.address)
    await tStaking.deployed()

    await tToken.mint(staker.address, stakerBalance)
    await tToken.mint(stakerWhale.address, stakerWhaleBalance)
    await tToken.mint(holder.address, holderBalance)
    await tToken.mint(holderWhale.address, holderWhaleBalance)

    const Timelock = await ethers.getContractFactory("TimelockController")
    const minDelay = 1
    const proposers = []
    const executors = []
    timelock = await Timelock.deploy(minDelay, proposers, executors)
    await timelock.deployed()

    const TestGovernor = await ethers.getContractFactory(
      "TestTokenholderGovernor"
    )
    tGov = await TestGovernor.deploy(
      tToken.address,
      tStaking.address,
      timelock.address,
      vetoer.address
    )
    await tGov.deployed()

    TIMELOCK_ADMIN_ROLE = await timelock.TIMELOCK_ADMIN_ROLE()
    PROPOSER_ROLE = await timelock.PROPOSER_ROLE()

    await timelock.grantRole(PROPOSER_ROLE, tGov.address)
    await timelock.renounceRole(TIMELOCK_ADMIN_ROLE, deployer.address)

    await tToken.mint(timelock.address, 1)

    lastBlock = (await mineBlocks(1)) - 1

    // ethers.js can't resolve overloaded functions so we need to specify the
    // fully qualified signature of the function to call it. This is the case of
    // the `proposalThreshold()` function, as there's also a
    // `proposalThreshold(uint256)`.
    // See https://github.com/ethers-io/ethers.js/issues/1160
    proposalThresholdFunction = tGov["proposalThreshold()"]
  })

  describe("default parameters", () => {
    it("quorum denominator is 10000", async () => {
      expect(await tGov.FRACTION_DENOMINATOR()).to.equal(10000)
    })

    it("quorum numerator is 150", async () => {
      expect(await tGov.quorumNumerator()).to.equal(150)
    })

    it("proposal threshold numerator is 25", async () => {
      expect(await tGov.proposalThresholdNumerator()).to.equal(25)
    })

    it("voting delay is 2 blocks", async () => {
      expect(await tGov.votingDelay()).to.equal(2)
    })

    it("voting period is 8 blocks", async () => {
      expect(await tGov.votingPeriod()).to.equal(8)
    })
  })

  describe("when all tokens are liquid", () => {
    context("...but nobody delegated their vote...", () => {
      it("proposal threshold is as expected", async () => {
        expect(await proposalThresholdFunction()).to.equal(expectedThreshold)
      })
      it("nobody can make a proposal", async () => {
        await expect(
          tGov.connect(staker).propose(...proposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
        await expect(
          tGov.connect(stakerWhale).propose(...proposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
        await expect(
          tGov.connect(holder).propose(...proposalWithDescription)
        ).to.be.revertedWith("Proposal below threshold")
        await expect(
          tGov.connect(holderWhale).propose(...proposalWithDescription)
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
          expect(await proposalThresholdFunction()).to.equal(expectedThreshold)
        })
        it("small fish can't make a proposal", async () => {
          await expect(
            tGov.connect(staker).propose(...proposalWithDescription)
          ).to.be.revertedWith("Proposal below threshold")
          await expect(
            tGov.connect(holder).propose(...proposalWithDescription)
          ).to.be.revertedWith("Proposal below threshold")
        })

        it("but whales can (1/2)", async () => {
          await tGov.connect(stakerWhale).propose(...proposalWithDescription)
        })
        it("but whales can (2/2)", async () => {
          await tGov.connect(holderWhale).propose(...proposalWithDescription)
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

      lastBlock = (await mineBlocks(1)) - 1
    })

    context("only stakerWhale has enough stake to propose", () => {
      it("proposal threshold is as expected", async () => {
        expect(await proposalThresholdFunction()).to.equal(expectedThreshold)
      })

      it("stakerWhale can make a proposal", async () => {
        await tGov.connect(stakerWhale).propose(...proposalWithDescription)
      })

      it("staker can't make a proposal", async () => {
        await expect(
          tGov.connect(staker).propose(...proposalWithDescription)
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
          lastBlock = (await mineBlocks(1)) - 1
        })

        it("proposal threshold remains as expected", async () => {
          expect(await proposalThresholdFunction()).to.equal(expectedThreshold)
        })

        it("stakerWhale still can make a proposal", async () => {
          await tGov.connect(stakerWhale).propose(...proposalWithDescription)
        })

        it("staker can now make a proposal too", async () => {
          await tGov.connect(staker).propose(...proposalWithDescription)
        })
      }
    )

    context("when there's a proposal", () => {
      beforeEach(async () => {
        description = "Proposal to transfer some T"

        // Proposal to transfer 1 T unit to the deployer
        transferTx = await tToken.populateTransaction.transfer(
          deployer.address,
          1
        )

        proposal = [[tToken.address], [0], [transferTx.data]]
        proposalWithDescription = [...proposal, description]
        descriptionHash = ethers.utils.id(description)
        proposalWithHash = [...proposal, descriptionHash]
        proposalID = ethers.utils.keccak256(
          defaultAbiCoder.encode(
            ["address[]", "uint256[]", "bytes[]", "bytes32"],
            proposalWithHash
          )
        )

        await tGov.connect(stakerWhale).propose(...proposalWithDescription)
      })

      it("proposal state is 'pending' initially", async () => {
        expect(await tGov.state(proposalID)).to.equal(ProposalStates.Pending)
      })

      it("stakers can't cancel the proposal", async () => {
        await expect(tGov.connect(stakerWhale).cancel(...proposalWithHash)).to
          .be.reverted
        await expect(tGov.connect(staker).cancel(...proposalWithHash)).to.be
          .reverted
      })

      it("vetoer can cancel the proposal", async () => {
        await tGov.connect(vetoer).cancel(...proposalWithHash)
        expect(await tGov.state(proposalID)).to.equal(ProposalStates.Canceled)
      })

      it("participants can't vote while proposal is 'pending'", async () => {
        await expect(
          tGov.connect(holderWhale).castVote(proposalID, Vote.Yea)
        ).to.be.revertedWith("Governor: vote not currently active")
      })

      context("when voting delay has passed", () => {
        beforeEach(async () => {
          await mineBlocks(3)
        })

        it("proposal state becomes 'active'", async () => {
          expect(await tGov.state(proposalID)).to.equal(ProposalStates.Active)
        })

        it("stakers can't cancel the proposal", async () => {
          await expect(tGov.connect(stakerWhale).cancel(...proposalWithHash)).to
            .be.reverted
          await expect(tGov.connect(staker).cancel(...proposalWithHash)).to.be
            .reverted
        })

        it("vetoer can cancel the proposal", async () => {
          await tGov.connect(vetoer).cancel(...proposalWithHash)
          expect(await tGov.state(proposalID)).to.equal(ProposalStates.Canceled)
        })

        it("participants can vote", async () => {
          await tGov.connect(holderWhale).castVote(proposalID, Vote.Yea)
        })

        context("when quorum is reached and voting period ends", () => {
          beforeEach(async () => {
            await tGov.connect(holderWhale).castVote(proposalID, Vote.Yea)
            await tGov.connect(stakerWhale).castVote(proposalID, Vote.Yea)
            await mineBlocks(8)
          })

          it("proposal state becomes 'succeeded'", async () => {
            expect(await tGov.state(proposalID)).to.equal(
              ProposalStates.Succeeded
            )
          })

          it("stakers can't cancel the proposal", async () => {
            await expect(tGov.connect(stakerWhale).cancel(...proposalWithHash))
              .to.be.reverted
            await expect(tGov.connect(staker).cancel(...proposalWithHash)).to.be
              .reverted
          })

          it("vetoer still can cancel the proposal", async () => {
            await tGov.connect(vetoer).cancel(...proposalWithHash)
            expect(await tGov.state(proposalID)).to.equal(
              ProposalStates.Canceled
            )
          })

          it("participants can't vote anymore", async () => {
            await tGov.connect(staker).castVote(proposalID, Vote.Yea)
          })
        })
      })
    })
  })
})

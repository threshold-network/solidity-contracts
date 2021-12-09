const { expect } = require("chai")

describe("ParametersGovernor", () => {
  let executor
  let other

  beforeEach(async () => {
    ;[executor, other] = await ethers.getSigners()

    const TestGovernorParameters = await ethers.getContractFactory(
      "TestGovernorParameters"
    )
    tGov = await TestGovernorParameters.deploy(executor.address)
    await tGov.deployed()
  })

  describe("initial parameters", () => {
    it("quorum denominator is 10000", async () => {
      expect(await tGov.FRACTION_DENOMINATOR()).to.equal(10000)
    })

    it("quorum numerator is 10", async () => {
      expect(await tGov.quorumNumerator()).to.equal(10)
    })

    it("proposal threshold numerator is 20", async () => {
      expect(await tGov.proposalThresholdNumerator()).to.equal(20)
    })

    it("voting delay is 30", async () => {
      expect(await tGov.votingDelay()).to.equal(30)
    })

    it("voting period is 40", async () => {
      expect(await tGov.votingPeriod()).to.equal(40)
    })
  })

  describe("parameters are updated", () => {
    let tx1
    let tx2
    let tx3
    let tx4
    beforeEach(async () => {
      tx1 = await tGov.connect(executor).updateQuorumNumerator(100)
      tx2 = await tGov.connect(executor).updateProposalThresholdNumerator(200)
      tx3 = await tGov.connect(executor).setVotingDelay(300)
      tx4 = await tGov.connect(executor).setVotingPeriod(400)
    })

    it("quorum numerator is now 100", async () => {
      expect(await tGov.quorumNumerator()).to.equal(100)
    })

    it("should emit QuorumNumeratorUpdated event", async () => {
      await expect(tx1)
        .to.emit(tGov, "QuorumNumeratorUpdated")
        .withArgs(10, 100)
    })

    it("proposal threshold numerator is now 200", async () => {
      expect(await tGov.proposalThresholdNumerator()).to.equal(200)
    })

    it("should emit ProposalThresholdNumeratorUpdated event", async () => {
      await expect(tx2)
        .to.emit(tGov, "ProposalThresholdNumeratorUpdated")
        .withArgs(20, 200)
    })

    it("voting delay is now 300", async () => {
      expect(await tGov.votingDelay()).to.equal(300)
    })

    it("should emit VotingDelaySet event", async () => {
      await expect(tx3).to.emit(tGov, "VotingDelaySet").withArgs(30, 300)
    })

    it("voting period is now 400", async () => {
      expect(await tGov.votingPeriod()).to.equal(400)
    })

    it("should emit VotingPeriodSet event", async () => {
      await expect(tx4).to.emit(tGov, "VotingPeriodSet").withArgs(40, 400)
    })
  })

  describe("when trying to update parameters by non-executor", () => {
    it("should revert", async () => {
      await expect(
        tGov.connect(other).updateQuorumNumerator(1234)
      ).to.be.revertedWith("Governor: onlyGovernance")
      await expect(
        tGov.connect(other).updateProposalThresholdNumerator(1234)
      ).to.be.revertedWith("Governor: onlyGovernance")
      await expect(tGov.connect(other).setVotingDelay(1234)).to.be.revertedWith(
        "Governor: onlyGovernance"
      )
      await expect(
        tGov.connect(other).setVotingPeriod(1234)
      ).to.be.revertedWith("Governor: onlyGovernance")
    })
  })
})

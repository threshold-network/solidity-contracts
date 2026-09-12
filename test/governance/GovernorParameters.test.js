const { expect } = require("chai")
const { mineBlocks } = helpers.time

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

  describe("quorum history", () => {
    it("preserves the initial quorum before deployment", async () => {
      const { blockNumber } = await tGov.deployTransaction.wait()
      expect(await tGov.quorum(blockNumber - 1)).to.equal(10)

      await tGov.connect(executor).updateQuorumNumerator(100)
      expect(await tGov.quorum(blockNumber - 1)).to.equal(10)
      expect(await tGov.quorum(blockNumber)).to.equal(10)
    })

    it("uses the numerator at each historical block, including zero", async () => {
      const updates = []
      for (const numerator of [100, 0, 10000, 20]) {
        const tx = await tGov.connect(executor).updateQuorumNumerator(numerator)
        const { blockNumber } = await tx.wait()
        updates.push({ blockNumber, numerator })
        await mineBlocks(2)
      }

      expect(await tGov.quorum(updates[0].blockNumber - 1)).to.equal(10)
      for (const { blockNumber, numerator } of updates) {
        expect(await tGov.quorum(blockNumber)).to.equal(numerator)
        expect(await tGov.quorum(blockNumber + 1)).to.equal(numerator)
      }
      expect(await tGov.quorumNumerator()).to.equal(20)
    })

    it("uses the final numerator when governance updates twice in one block", async () => {
      const nonce = await executor.getTransactionCount()
      let first
      let second
      await ethers.provider.send("evm_setAutomine", [false])
      try {
        first = await tGov.connect(executor).updateQuorumNumerator(100, {
          nonce,
          gasLimit: 300000,
        })
        second = await tGov.connect(executor).updateQuorumNumerator(0, {
          nonce: nonce + 1,
          gasLimit: 300000,
        })
        await ethers.provider.send("evm_mine", [])
      } finally {
        await ethers.provider.send("evm_setAutomine", [true])
      }
      const firstReceipt = await first.wait()
      const secondReceipt = await second.wait()
      expect(secondReceipt.blockNumber).to.equal(firstReceipt.blockNumber)
      await mineBlocks(1)

      expect(await tGov.quorum(firstReceipt.blockNumber - 1)).to.equal(10)
      expect(await tGov.quorum(firstReceipt.blockNumber)).to.equal(0)
      expect(await tGov.quorumNumerator()).to.equal(0)
      await expect(second)
        .to.emit(tGov, "QuorumNumeratorUpdated")
        .withArgs(100, 0)
    })

    it("rejects an excessive numerator without changing quorum history", async () => {
      const tx = await tGov.connect(executor).updateQuorumNumerator(10000)
      const { blockNumber } = await tx.wait()
      await expect(
        tGov.connect(executor).updateQuorumNumerator(10001)
      ).to.be.revertedWith("quorumNumerator > Denominator")
      await mineBlocks(1)

      expect(await tGov.quorumNumerator()).to.equal(10000)
      expect(await tGov.quorum(blockNumber)).to.equal(10000)
      expect(await tGov.quorum(blockNumber - 1)).to.equal(10)
    })

    it("preserves the supply provider's rejection of current and future blocks", async () => {
      const blockNumber = await ethers.provider.getBlockNumber()
      await expect(tGov.quorum(blockNumber)).to.be.revertedWith(
        "Block not yet determined"
      )
      await expect(tGov.quorum(blockNumber + 1)).to.be.revertedWith(
        "Block not yet determined"
      )
    })
  })
})

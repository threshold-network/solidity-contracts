const { expect } = require("chai")
const { defaultAbiCoder } = require("@ethersproject/abi")
const { mineBlocks, increaseTime, lastBlockTime } = helpers.time
const { to1e18 } = helpers.number
const { AddressZero, HashZero } = ethers.constants

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
  Meh: 2,
}

function missingRoleMessage(account, role) {
  return `AccessControl: account ${account.toLowerCase()} is missing role ${role}`
}

describe("TokenholderGovernor", () => {
  let deployer
  let tToken
  let staker
  let stakerWhale
  let holder
  let holderWhale
  let vetoer
  let bystander
  let recipient
  let timelock

  let proposalThresholdFunction
  const minDelay = 1000

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
  let timelockProposalID

  let VETO_POWER

  beforeEach(async () => {
    ;[
      deployer,
      staker,
      stakerWhale,
      holder,
      holderWhale,
      vetoer,
      bystander,
      recipient,
    ] = await ethers.getSigners()

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
    const proposers = []
    // With the zero address as executor, anyone can execute proposals in the Timelock
    const executors = [AddressZero]
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

    VETO_POWER = await tGov.VETO_POWER()
    TIMELOCK_ADMIN_ROLE = await timelock.TIMELOCK_ADMIN_ROLE()
    PROPOSER_ROLE = await timelock.PROPOSER_ROLE()

    // TokenholderGovernor must be the only authorized to propose to the Timelock
    await timelock.grantRole(PROPOSER_ROLE, tGov.address)
    // The deployer renounces to admin roles in the Timelock
    await timelock.renounceRole(TIMELOCK_ADMIN_ROLE, deployer.address)

    // Let's mint 1 T Unit to the timelock so we can test later that it can transfer
    await tToken.mint(timelock.address, 1)

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

        // Proposal to transfer 1 T unit to some recipient
        transferTx = await tToken.populateTransaction.transfer(
          recipient.address,
          1
        )

        proposal = [[tToken.address], [0], [transferTx.data]]
        proposalWithDescription = [...proposal, description]
        descriptionHash = ethers.utils.id(description)
        proposalWithHash = [...proposal, descriptionHash]
        proposalForTimelock = [...proposal, HashZero, descriptionHash]
        proposalID = ethers.utils.keccak256(
          defaultAbiCoder.encode(
            ["address[]", "uint256[]", "bytes[]", "bytes32"],
            proposalWithHash
          )
        )
        timelockProposalID = ethers.utils.keccak256(
          defaultAbiCoder.encode(
            ["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"],
            proposalForTimelock
          )
        )

        await tToken.connect(holder).delegate(holder.address)
        await tToken.connect(holderWhale).delegate(holderWhale.address)

        await tGov.connect(stakerWhale).propose(...proposalWithDescription)
      })

      it("proposal state is 'pending' initially", async () => {
        expect(await tGov.state(proposalID)).to.equal(ProposalStates.Pending)
      })

      it("stakers can't cancel the proposal", async () => {
        await expect(
          tGov.connect(stakerWhale).cancel(...proposalWithHash)
        ).to.be.revertedWith(
          missingRoleMessage(stakerWhale.address, VETO_POWER)
        )
        await expect(
          tGov.connect(staker).cancel(...proposalWithHash)
        ).to.be.revertedWith(missingRoleMessage(staker.address, VETO_POWER))
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

      it("proposal can't be executed yet", async () => {
        await expect(
          tGov.connect(bystander).execute(...proposalWithHash)
        ).to.be.revertedWith("Governor: proposal not successful")
      })

      context("when voting delay has passed", () => {
        beforeEach(async () => {
          await mineBlocks(3)
        })

        it("proposal state becomes 'active'", async () => {
          expect(await tGov.state(proposalID)).to.equal(ProposalStates.Active)
        })

        it("proposal voting counters are on zero", async () => {
          votes = await tGov.proposalVotes(proposalID)
          againstVotes = votes[0]
          forVotes = votes[1]
          abstainVotes = votes[2]

          expect(againstVotes).to.equal(0)
          expect(forVotes).to.equal(0)
          expect(abstainVotes).to.equal(0)
        })

        it("stakers can't cancel the proposal", async () => {
          await expect(
            tGov.connect(stakerWhale).cancel(...proposalWithHash)
          ).to.be.revertedWith(
            missingRoleMessage(stakerWhale.address, VETO_POWER)
          )
          await expect(
            tGov.connect(staker).cancel(...proposalWithHash)
          ).to.be.revertedWith(missingRoleMessage(staker.address, VETO_POWER))
        })

        it("vetoer can cancel the proposal", async () => {
          await tGov.connect(vetoer).cancel(...proposalWithHash)
          expect(await tGov.state(proposalID)).to.equal(ProposalStates.Canceled)
        })

        it("proposal can't be executed yet", async () => {
          await expect(
            tGov.connect(bystander).execute(...proposalWithHash)
          ).to.be.revertedWith("Governor: proposal not successful")
        })

        context("participants can vote", () => {
          let againstVotes
          let forVotes
          let abstainVotes

          beforeEach(async () => {
            await tGov.connect(holderWhale).castVote(proposalID, Vote.Yea)
            await tGov.connect(stakerWhale).castVote(proposalID, Vote.Nay)
            await tGov.connect(holder).castVote(proposalID, Vote.Yea)
            await tGov.connect(staker).castVote(proposalID, Vote.Meh)

            votes = await tGov.proposalVotes(proposalID)
            againstVotes = votes[0]
            forVotes = votes[1]
            abstainVotes = votes[2]
          })

          it("for votes count is as expected", async () => {
            expect(forVotes).to.equal(holderWhaleBalance.add(holderBalance))
          })

          it("against votes count is as expected", async () => {
            expect(againstVotes).to.equal(stakerWhaleBalance)
          })

          it("abstain votes count is as expected", async () => {
            expect(abstainVotes).to.equal(stakerBalance)
          })
        })

        context("when quorum is reached and voting period ends", () => {
          beforeEach(async () => {
            await tGov.connect(holderWhale).castVote(proposalID, Vote.Yea)
            await mineBlocks(8)
          })

          it("proposal voting counters are as expected", async () => {
            votes = await tGov.proposalVotes(proposalID)
            againstVotes = votes[0]
            forVotes = votes[1]
            abstainVotes = votes[2]

            expect(againstVotes).to.equal(0)
            expect(forVotes).to.equal(holderWhaleBalance)
            expect(abstainVotes).to.equal(0)
          })

          it("proposal state becomes 'succeeded'", async () => {
            expect(await tGov.state(proposalID)).to.equal(
              ProposalStates.Succeeded
            )
          })

          it("stakers can't cancel the proposal", async () => {
            await expect(
              tGov.connect(stakerWhale).cancel(...proposalWithHash)
            ).to.be.revertedWith(
              missingRoleMessage(stakerWhale.address, VETO_POWER)
            )
            await expect(
              tGov.connect(staker).cancel(...proposalWithHash)
            ).to.be.revertedWith(missingRoleMessage(staker.address, VETO_POWER))
          })

          it("vetoer still can cancel the proposal", async () => {
            await tGov.connect(vetoer).cancel(...proposalWithHash)
            expect(await tGov.state(proposalID)).to.equal(
              ProposalStates.Canceled
            )
          })

          it("participants can't vote anymore", async () => {
            await expect(
              tGov.connect(staker).castVote(proposalID, Vote.Yea)
            ).to.be.revertedWith("Governor: vote not currently active")
          })

          it("anyone can queue the proposal to the Timelock", async () => {
            await tGov.connect(bystander).queue(...proposalWithHash)
            expect(await tGov.state(proposalID)).to.equal(ProposalStates.Queued)
          })

          it("proposal can't be executed yet", async () => {
            await expect(
              tGov.connect(bystander).execute(...proposalWithHash)
            ).to.be.revertedWith("TimelockController: operation is not ready")
          })

          context("when proposal is queued", () => {
            let tx
            let queueTimestamp
            beforeEach(async () => {
              tx = await tGov.connect(bystander).queue(...proposalWithHash)
              queueTimestamp = await lastBlockTime()
            })

            it("proposal state becomes 'Queued'", async () => {
              expect(await tGov.state(proposalID)).to.equal(
                ProposalStates.Queued
              )
            })

            it("stakers can't cancel the proposal", async () => {
              await expect(
                tGov.connect(stakerWhale).cancel(...proposalWithHash)
              ).to.be.revertedWith(
                missingRoleMessage(stakerWhale.address, VETO_POWER)
              )
              await expect(
                tGov.connect(staker).cancel(...proposalWithHash)
              ).to.be.revertedWith(
                missingRoleMessage(staker.address, VETO_POWER)
              )
            })

            it("vetoer still can cancel the proposal", async () => {
              await tGov.connect(vetoer).cancel(...proposalWithHash)
              expect(await tGov.state(proposalID)).to.equal(
                ProposalStates.Canceled
              )
            })

            it("participants can't vote anymore", async () => {
              await expect(
                tGov.connect(staker).castVote(proposalID, Vote.Yea)
              ).to.be.revertedWith("Governor: vote not currently active")
            })

            it("Timelock is aware of the proposal", async () => {
              expect(await timelock.isOperation(timelockProposalID)).to.be.true
            })

            it("Proposal state in Timelock is pending; not ready nor done", async () => {
              expect(await timelock.isOperationPending(timelockProposalID)).to
                .be.true
              expect(await timelock.isOperationReady(timelockProposalID)).to.be
                .false
              expect(await timelock.isOperationDone(timelockProposalID)).to.be
                .false
            })

            it("Proposal activation timestamp in Timelock is as expected", async () => {
              expect(
                await timelock.getTimestamp(timelockProposalID)
              ).to.be.equal(queueTimestamp + minDelay)
            })

            it("Timelock emits a CallScheduled event", async () => {
              // CallScheduled(id, i, targets[i], values[i], datas[i], predecessor, delay);
              await expect(tx)
                .to.emit(timelock, "CallScheduled")
                .withArgs(
                  timelockProposalID,
                  0,
                  proposal[0][0],
                  proposal[1][0],
                  proposal[2][0],
                  HashZero,
                  minDelay
                )
            })

            it("proposal can't be executed yet", async () => {
              await expect(
                tGov.connect(bystander).execute(...proposalWithHash)
              ).to.be.revertedWith("TimelockController: operation is not ready")
            })

            it("but with enough time, anyone can execute it", async () => {
              await increaseTime(minDelay + 1)
              expect(await timelock.isOperationReady(timelockProposalID)).to.be
                .true
              await tGov.connect(bystander).execute(...proposalWithHash)
              expect(await timelock.isOperationDone(timelockProposalID)).to.be
                .true
            })

            it("...it should be possible to execute from the Timelock directly too", async () => {
              await increaseTime(minDelay + 1)
              expect(await timelock.isOperationReady(timelockProposalID)).to.be
                .true
              await timelock
                .connect(bystander)
                .executeBatch(...proposalForTimelock)
              expect(await timelock.isOperationDone(timelockProposalID)).to.be
                .true
            })

            context("after Timelock duration", () => {
              let recipientBalance
              let tx

              beforeEach(async () => {
                await increaseTime(minDelay + 1)
                recipientBalance = await tToken.balanceOf(recipient.address)
                tx = await tGov.connect(bystander).execute(...proposalWithHash)
              })

              it("proposal state becomes 'Executed'", async () => {
                expect(await tGov.state(proposalID)).to.equal(
                  ProposalStates.Executed
                )
              })

              it("proposal to send 1 T unit executes successfully", async () => {
                expect(await tToken.balanceOf(recipient.address)).to.equal(
                  recipientBalance.add(1)
                )
              })

              it("TokenholderGovernor emits a ProposalExecuted event", async () => {
                // ProposalExecuted(id);
                await expect(tx)
                  .to.emit(tGov, "ProposalExecuted")
                  .withArgs(proposalID)
              })

              it("Timelock emits a CallExecuted event", async () => {
                // CallExecuted(id, index, target, value, data);
                await expect(tx)
                  .to.emit(timelock, "CallExecuted")
                  .withArgs(
                    timelockProposalID,
                    0,
                    proposal[0][0],
                    proposal[1][0],
                    proposal[2][0]
                  )
              })

              it("T emits a Transfer event", async () => {
                // Transfer(from, to, amount);
                await expect(tx)
                  .to.emit(tToken, "Transfer")
                  .withArgs(timelock.address, recipient.address, 1)
              })
            })
          })
        })
      })
    })
  })

  describe("when migrating TokenholderGovernor", () => {
    let grantRoleTx
    let revokeRoleTx

    beforeEach(async () => {
      const TestGovernor = await ethers.getContractFactory(
        "TestTokenholderGovernor"
      )

      tGovDest = await TestGovernor.deploy(
        tToken.address,
        tStaking.address,
        timelock.address,
        vetoer.address
      )
      await tGovDest.deployed()

      const description = "Proposal to migrate to new Tokenholder Governor"
      grantRoleTx = await timelock.populateTransaction.grantRole(
        PROPOSER_ROLE,
        tGovDest.address
      )
      revokeRoleTx = await timelock.populateTransaction.revokeRole(
        PROPOSER_ROLE,
        tGov.address
      )

      const proposal = [
        [timelock.address, timelock.address],
        [0, 0],
        [grantRoleTx.data, revokeRoleTx.data],
      ]
      const proposalWithDescription = [...proposal, description]
      const descriptionHash = ethers.utils.id(description)
      proposalWithHash = [...proposal, descriptionHash]
      proposalID = ethers.utils.keccak256(
        defaultAbiCoder.encode(
          ["address[]", "uint256[]", "bytes[]", "bytes32"],
          proposalWithHash
        )
      )
      proposalForTimelock = [...proposal, HashZero, descriptionHash]
      timelockProposalID = ethers.utils.keccak256(
        defaultAbiCoder.encode(
          ["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"],
          proposalForTimelock
        )
      )

      await tToken.connect(holderWhale).delegate(holderWhale.address)
      await tGov.connect(holderWhale).propose(...proposalWithDescription)
    })

    it("Timelock only answers to the original Governor, for now)", async () => {
      expect(await timelock.hasRole(PROPOSER_ROLE, tGov.address)).to.be.true
    })

    it("Timelock doesn't care for the new Governor, yet", async () => {
      expect(await timelock.hasRole(PROPOSER_ROLE, tGovDest.address)).to.be
        .false
    })

    context("once the migration proposal is executed", () => {
      let tx

      beforeEach(async () => {
        // Skip vote delay
        await mineBlocks(3)
        // Vote!
        await tGov.connect(holderWhale).castVote(proposalID, Vote.Yea)
        // Skip voting period
        await mineBlocks(8)
        // Queue the proposal in Timelock
        await tGov.connect(bystander).queue(...proposalWithHash)
        // Skip Timelock delay
        await increaseTime(minDelay + 1)
        // Execute
        tx = await tGov.connect(bystander).execute(...proposalWithHash)
      })

      it("Timelock now only allows proposals from new Governor", async () => {
        expect(await timelock.hasRole(PROPOSER_ROLE, tGovDest.address)).to.be
          .true
      })

      it("Timelock doesn't listen to the old Governor anymore", async () => {
        expect(await timelock.hasRole(PROPOSER_ROLE, tGov.address)).to.be.false
      })

      it("Timelock emited a CallExecuted event for the grant role step", async () => {
        // CallExecuted(id, index, target, value, data);
        await expect(tx)
          .to.emit(timelock, "CallExecuted")
          .withArgs(
            timelockProposalID,
            0,
            timelock.address,
            0,
            grantRoleTx.data
          )
      })

      it("Timelock emited a CallExecuted event for the revoke role step", async () => {
        // CallExecuted(id, index, target, value, data);
        await expect(tx)
          .to.emit(timelock, "CallExecuted")
          .withArgs(
            timelockProposalID,
            1,
            timelock.address,
            0,
            revokeRoleTx.data
          )
      })

      it("Timelock emits a RoleGranted event for the grant role step", async () => {
        // RoleGranted(bytes32 role, address account, address sender);
        await expect(tx)
          .to.emit(timelock, "RoleGranted")
          .withArgs(PROPOSER_ROLE, tGovDest.address, timelock.address)
      })

      it("Timelock emits a RoleRevoked event for the revoke role step", async () => {
        // RoleRevoked(bytes32 role, address account, address sender);
        await expect(tx)
          .to.emit(timelock, "RoleRevoked")
          .withArgs(PROPOSER_ROLE, tGov.address, timelock.address)
      })

      context("when using the new Governor", () => {
        beforeEach(async () => {
          // Proposal to transfer 1 T unit to some recipient
          transferTx = await tToken.populateTransaction.transfer(
            recipient.address,
            1
          )

          description = "Proposal for new Governor"
          proposal = [[tToken.address], [0], [transferTx.data]]
          proposalWithDescription = [...proposal, description]
          descriptionHash = ethers.utils.id(description)
          proposalWithHash = [...proposal, descriptionHash]
          proposalForTimelock = [...proposal, HashZero, descriptionHash]
          proposalID = ethers.utils.keccak256(
            defaultAbiCoder.encode(
              ["address[]", "uint256[]", "bytes[]", "bytes32"],
              proposalWithHash
            )
          )
          timelockProposalID = ethers.utils.keccak256(
            defaultAbiCoder.encode(
              ["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"],
              proposalForTimelock
            )
          )
        })

        it("Old governor can't queue proposals in the timelock anymore", async () => {
          await tGov.connect(holderWhale).propose(...proposalWithDescription)

          // Skip vote delay
          await mineBlocks(3)
          // Vote!
          await tGov.connect(holderWhale).castVote(proposalID, Vote.Yea)
          // Skip voting period
          await mineBlocks(8)
          await expect(
            tGov.connect(bystander).queue(...proposalWithHash)
          ).to.be.revertedWith(missingRoleMessage(tGov.address, PROPOSER_ROLE))
        })

        it("New governor can queue and execute proposals in the timelock", async () => {
          await tGovDest
            .connect(holderWhale)
            .propose(...proposalWithDescription)

          // Skip vote delay
          await mineBlocks(3)
          // Vote!
          await tGovDest.connect(holderWhale).castVote(proposalID, Vote.Yea)
          // Skip voting period
          await mineBlocks(8)
          await tGovDest.connect(bystander).queue(...proposalWithHash)

          // Skip Timelock delay
          await increaseTime(minDelay + 1)
          // Execute
          tx = await tGovDest.connect(bystander).execute(...proposalWithHash)

          expect(await tGovDest.state(proposalID)).to.equal(
            ProposalStates.Executed
          )

          // ProposalExecuted(id);
          await expect(tx)
            .to.emit(tGovDest, "ProposalExecuted")
            .withArgs(proposalID)

          // CallExecuted(id, index, target, value, data);
          await expect(tx)
            .to.emit(timelock, "CallExecuted")
            .withArgs(
              timelockProposalID,
              0,
              proposal[0][0],
              proposal[1][0],
              proposal[2][0]
            )
        })
      })
    })
  })

  describe("when someone accidentally sends assets to the Governor contract", () => {
    beforeEach(async () => {
      // Someone sends tokens to the Governor contract by mistake:
      await tToken.connect(holder).transfer(tGov.address, 1)

      await tToken.connect(holderWhale).delegate(holderWhale.address)
    })

    it("Governor contract now has a token balance of 1", async () => {
      expect(await tToken.balanceOf(tGov.address)).to.be.equal(1)
    })

    it("Holder has 1 token less", async () => {
      expect(await tToken.balanceOf(holder.address)).to.be.equal(
        holderBalance.sub(1)
      )
    })

    describe("The DAO can pass a proposal to send back the tokens", () => {
      beforeEach(async () => {
        // Let's prepare the token transfer calldata
        transferTx = await tToken.populateTransaction.transfer(
          holder.address,
          1
        )

        // We need use the Governor.relay() method to relay the token transfer
        relayTx = await tGov.populateTransaction.relay(
          transferTx.to,
          0,
          transferTx.data
        )

        description = "Send 1 token back to holder"
        const proposal = [[relayTx.to], [0], [relayTx.data]]
        const proposalWithDescription = [...proposal, description]
        const descriptionHash = ethers.utils.id(description)
        proposalWithHash = [...proposal, descriptionHash]
        proposalID = ethers.utils.keccak256(
          defaultAbiCoder.encode(
            ["address[]", "uint256[]", "bytes[]", "bytes32"],
            proposalWithHash
          )
        )
        proposalForTimelock = [...proposal, HashZero, descriptionHash]
        timelockProposalID = ethers.utils.keccak256(
          defaultAbiCoder.encode(
            ["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"],
            proposalForTimelock
          )
        )

        await tGov.connect(holderWhale).propose(...proposalWithDescription)

        // Skip vote delay
        await mineBlocks(3)
        // Vote!
        await tGov.connect(holderWhale).castVote(proposalID, Vote.Yea)
        // Skip voting period
        await mineBlocks(8)
        // Queue the proposal in Timelock
        await tGov.connect(bystander).queue(...proposalWithHash)
        // Skip Timelock delay
        await increaseTime(minDelay + 1)
        // Execute
        tx = await tGov.connect(bystander).execute(...proposalWithHash)
      })

      it("Governor contract now has a token balance of 0", async () => {
        expect(await tToken.balanceOf(tGov.address)).to.be.equal(0)
      })

      it("Holder has their original balance", async () => {
        expect(await tToken.balanceOf(holder.address)).to.be.equal(
          holderBalance
        )
      })
    })
  })
})

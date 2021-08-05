const { expect } = require("chai")

const {
  to1e18,
  lastBlockNumber,
  ZERO_ADDRESS,
} = require("../helpers/contract-test-helpers")

describe("T token", () => {
  const initialBalance = to1e18(1000000)

  beforeEach(async () => {
    ;[
      deployer,
      tokenHolder,
      tokenRecipient,
      delegatee,
      delegatee2,
      thirdParty,
    ] = await ethers.getSigners()

    const T = await ethers.getContractFactory("T")
    t = await T.deploy()
    await t.deployed()

    await t.connect(deployer).mint(tokenHolder.address, initialBalance)
  })

  const previousBlockNumber = async () => {
    return (await lastBlockNumber()) - 1
  }

  describe("getCurrentVotes", () => {
    context("when no delegation was done", () => {
      it("should return zero votes", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
      })
    })
  })

  describe("getPriorVotes", () => {
    context("when executed for the last block", () => {
      it("should revert", async () => {
        await expect(
          t.getPriorVotes(tokenHolder.address, await lastBlockNumber())
        ).to.be.revertedWith("Not yet determined")
      })
    })
  })

  describe("delegate", () => {
    context("when delegated to someone else", () => {
      let tx

      beforeEach(async () => {
        tx = await t.connect(tokenHolder).delegate(delegatee.address)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
        expect(await t.getCurrentVotes(delegatee.address)).to.equal(
          initialBalance
        )
      })

      it("should update delegatee address", async () => {
        expect(await t.delegates(tokenHolder.address)).to.equal(
          delegatee.address
        )
      })

      it("should emit DelegateChanged event", async () => {
        await expect(tx)
          .to.emit(t, "DelegateChanged")
          .withArgs(tokenHolder.address, ZERO_ADDRESS, delegatee.address)
      })

      it("should emit DelegateVotesChanged", async () => {
        await expect(tx)
          .to.emit(t, "DelegateVotesChanged")
          .withArgs(delegatee.address, 0, initialBalance)
      })
    })

    context("when self-delegated", () => {
      let tx

      beforeEach(async () => {
        tx = await t.connect(tokenHolder).delegate(tokenHolder.address)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(
          initialBalance
        )
      })

      it("should update delegatee address", async () => {
        expect(await t.delegates(tokenHolder.address)).to.equal(
          tokenHolder.address
        )
      })

      it("should emit DelegateChanged event", async () => {
        await expect(tx)
          .to.emit(t, "DelegateChanged")
          .withArgs(tokenHolder.address, ZERO_ADDRESS, tokenHolder.address)
      })

      it("should emit DelegateVotesChanged", async () => {
        await expect(tx)
          .to.emit(t, "DelegateVotesChanged")
          .withArgs(tokenHolder.address, 0, initialBalance)
      })
    })

    context("when delegated multiple times", () => {
      let block1
      let block2
      let block3
      let block4

      beforeEach(async () => {
        await t.connect(tokenHolder).delegate(delegatee.address)
        block1 = await lastBlockNumber()
        await t.connect(tokenHolder).delegate(delegatee2.address)
        block2 = await lastBlockNumber()
        await t.connect(tokenHolder).delegate(delegatee.address)
        block3 = await lastBlockNumber()
        await t.connect(tokenHolder).delegate(tokenHolder.address)
        block4 = await lastBlockNumber()
        await t.connect(tokenHolder).delegate(delegatee2.address)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
        expect(await t.getCurrentVotes(delegatee.address)).to.equal(0)
        expect(await t.getCurrentVotes(delegatee2.address)).to.equal(
          initialBalance
        )
      })

      it("should keep track of prior votes", async () => {
        expect(await t.getPriorVotes(tokenHolder.address, block1)).to.equal(0)
        expect(await t.getPriorVotes(delegatee.address, block1)).to.equal(
          initialBalance
        )
        expect(await t.getPriorVotes(delegatee2.address, block1)).to.equal(0)

        expect(await t.getPriorVotes(tokenHolder.address, block2)).to.equal(0)
        expect(await t.getPriorVotes(delegatee.address, block2)).to.equal(0)
        expect(await t.getPriorVotes(delegatee2.address, block2)).to.equal(
          initialBalance
        )

        expect(await t.getPriorVotes(tokenHolder.address, block3)).to.equal(0)
        expect(await t.getPriorVotes(delegatee.address, block3)).to.equal(
          initialBalance
        )
        expect(await t.getPriorVotes(delegatee2.address, block3)).to.equal(0)

        expect(await t.getPriorVotes(tokenHolder.address, block4)).to.equal(
          initialBalance
        )
        expect(await t.getPriorVotes(delegatee.address, block4)).to.equal(0)
        expect(await t.getPriorVotes(delegatee2.address, block4)).to.equal(0)
      })
    })
  })

  const describeTransfer = (doTransfer) => {
    context("when no vote delegation was done for sender and recipient", () => {
      beforeEach(async () => {
        await doTransfer(to1e18(100))
      })

      it("should keep current votes at zero", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
        expect(await t.getCurrentVotes(tokenRecipient.address)).to.equal(0)
      })

      it("should keep prior votes at zero", async () => {
        expect(
          await t.getPriorVotes(
            tokenHolder.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
        expect(
          await t.getPriorVotes(
            tokenRecipient.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
      })
    })

    context(
      "when both sender and receiver delegated votes to someone else",
      () => {
        const amount = to1e18(100)

        beforeEach(async () => {
          await t.connect(tokenHolder).delegate(delegatee.address)
          await t.connect(tokenRecipient).delegate(delegatee2.address)
          await doTransfer(amount)
        })

        it("should update current votes", async () => {
          expect(await t.getCurrentVotes(delegatee.address)).to.equal(
            initialBalance.sub(amount)
          )
          expect(await t.getCurrentVotes(delegatee2.address)).to.equal(amount)
          expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
          expect(await t.getCurrentVotes(tokenRecipient.address)).to.equal(0)
        })

        it("should keep track of prior votes", async () => {
          expect(
            await t.getPriorVotes(
              delegatee.address,
              await previousBlockNumber()
            )
          ).to.equal(initialBalance)
          expect(
            await t.getPriorVotes(
              delegatee2.address,
              await previousBlockNumber()
            )
          ).to.equal(0)
          expect(
            await t.getPriorVotes(
              tokenHolder.address,
              await previousBlockNumber()
            )
          ).to.equal(0)
          expect(
            await t.getPriorVotes(
              tokenRecipient.address,
              await previousBlockNumber()
            )
          ).to.equal(0)
        })
      }
    )

    context("when both sender and recipient self-delegated votes", () => {
      const amount = to1e18(120)

      beforeEach(async () => {
        await t.connect(tokenHolder).delegate(tokenHolder.address)
        await t.connect(tokenRecipient).delegate(tokenRecipient.address)
        await doTransfer(amount)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(
          initialBalance.sub(amount)
        )
        expect(await t.getCurrentVotes(tokenRecipient.address)).to.equal(amount)
      })

      it("should keep track of prior votes", async () => {
        expect(
          await t.getPriorVotes(
            tokenHolder.address,
            await previousBlockNumber()
          )
        ).to.equal(initialBalance)

        expect(
          await t.getPriorVotes(
            tokenRecipient.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
      })
    })

    context("when sender delegated votes to someone else", () => {
      const amount = to1e18(70)

      beforeEach(async () => {
        await t.connect(tokenHolder).delegate(delegatee.address)
        await doTransfer(amount)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(delegatee.address)).to.equal(
          initialBalance.sub(amount)
        )
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
        expect(await t.getCurrentVotes(tokenRecipient.address)).to.equal(0)
      })

      it("should keep track of prior votes", async () => {
        expect(
          await t.getPriorVotes(delegatee.address, await previousBlockNumber())
        ).to.equal(initialBalance)
        expect(
          await t.getPriorVotes(
            tokenHolder.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
        expect(
          await t.getPriorVotes(
            tokenRecipient.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
      })
    })

    context("when sender self-delegated votes", () => {
      const amount = to1e18(991)

      beforeEach(async () => {
        await t.connect(tokenHolder).delegate(tokenHolder.address)
        await doTransfer(amount)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(
          initialBalance.sub(amount)
        )
        expect(await t.getCurrentVotes(tokenRecipient.address)).to.equal(0)
      })

      it("should keep track of prior votes", async () => {
        expect(
          await t.getPriorVotes(
            tokenHolder.address,
            await previousBlockNumber()
          )
        ).to.equal(initialBalance)
        expect(
          await t.getPriorVotes(
            tokenRecipient.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
      })
    })

    context("when recipient delegated votes to someone else", () => {
      const amount = to1e18(214)

      beforeEach(async () => {
        await t.connect(tokenRecipient).delegate(delegatee2.address)
        await doTransfer(amount)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(delegatee2.address)).to.equal(amount)
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
        expect(await t.getCurrentVotes(tokenRecipient.address)).to.equal(0)
      })

      it("should keep track of prior votes", async () => {
        expect(
          await t.getPriorVotes(delegatee2.address, await previousBlockNumber())
        ).to.equal(0)
        expect(
          await t.getPriorVotes(
            tokenHolder.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
        expect(
          await t.getPriorVotes(
            tokenRecipient.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
      })
    })

    context("when recipient self-delegated votes", () => {
      const amount = to1e18(124)

      beforeEach(async () => {
        await t.connect(tokenRecipient).delegate(tokenRecipient.address)
        await doTransfer(amount)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
        expect(await t.getCurrentVotes(tokenRecipient.address)).to.equal(amount)
      })

      it("should keep track of prior votes", async () => {
        expect(
          await t.getPriorVotes(
            tokenHolder.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
        expect(
          await t.getPriorVotes(
            tokenRecipient.address,
            await previousBlockNumber()
          )
        ).to.equal(0)
      })
    })

    context("when transferred multiple times", () => {
      let block1
      let block2
      let block3

      beforeEach(async () => {
        await t.connect(tokenHolder).delegate(delegatee.address)
        await t.connect(tokenRecipient).delegate(delegatee2.address)

        await t.connect(tokenHolder).transfer(tokenRecipient.address, to1e18(1))
        block1 = await lastBlockNumber()
        await t.connect(tokenHolder).transfer(tokenRecipient.address, to1e18(2))
        block2 = await lastBlockNumber()
        await t.connect(tokenHolder).transfer(tokenRecipient.address, to1e18(3))
        block3 = await lastBlockNumber()
        await t.connect(tokenHolder).transfer(tokenRecipient.address, to1e18(4))
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(tokenHolder.address)).to.equal(0)
        expect(await t.getCurrentVotes(tokenRecipient.address)).to.equal(0)
        expect(await t.getCurrentVotes(delegatee.address)).to.equal(
          initialBalance.sub(to1e18(10))
        )
        expect(await t.getCurrentVotes(delegatee2.address)).to.equal(to1e18(10))
      })

      it("should keep track of prior votes", async () => {
        expect(await t.getPriorVotes(tokenHolder.address, block1)).to.equal(0)
        expect(await t.getPriorVotes(tokenRecipient.address, block1)).to.equal(
          0
        )
        expect(await t.getPriorVotes(delegatee.address, block1)).to.equal(
          initialBalance.sub(to1e18(1))
        )
        expect(await t.getPriorVotes(delegatee2.address, block1)).to.equal(
          to1e18(1)
        )

        expect(await t.getPriorVotes(tokenHolder.address, block2)).to.equal(0)
        expect(await t.getPriorVotes(tokenRecipient.address, block2)).to.equal(
          0
        )
        expect(await t.getPriorVotes(delegatee.address, block2)).to.equal(
          initialBalance.sub(to1e18(3))
        )
        expect(await t.getPriorVotes(delegatee2.address, block2)).to.equal(
          to1e18(3)
        )

        expect(await t.getPriorVotes(tokenHolder.address, block3)).to.equal(0)
        expect(await t.getPriorVotes(tokenRecipient.address, block3)).to.equal(
          0
        )
        expect(await t.getPriorVotes(delegatee.address, block3)).to.equal(
          initialBalance.sub(to1e18(6))
        )
        expect(await t.getPriorVotes(delegatee2.address, block3)).to.equal(
          to1e18(6)
        )
      })
    })
  }

  describe("transfer", () => {
    describeTransfer(async (amount) => {
      await t.connect(tokenHolder).transfer(tokenRecipient.address, amount)
    })
  })

  describe("transferFrom", () => {
    describeTransfer(async (amount) => {
      await t.connect(tokenHolder).approve(thirdParty.address, amount)
      await t
        .connect(thirdParty)
        .transferFrom(tokenHolder.address, tokenRecipient.address, amount)
    })
  })
})

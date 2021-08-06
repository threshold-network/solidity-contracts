const { expect } = require("chai")

const {
  to1e18,
  lastBlockNumber,
  lastBlockTime,
  ZERO_ADDRESS,
} = require("../helpers/contract-test-helpers")

describe("T token", () => {
  const initialBalance = to1e18(1000000)
  let deployer
  let tokenHolder
  let tokenRecipient
  let delegatee
  let delegatee2
  let thirdParty

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

  const describeDelegate = (getDelegator, doDelegate) => {
    context("when delegated to someone else", () => {
      let delegator
      let tx

      beforeEach(async () => {
        delegator = getDelegator()
        tx = await doDelegate(delegatee.address)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(delegator.address)).to.equal(0)
        expect(await t.getCurrentVotes(delegatee.address)).to.equal(
          initialBalance
        )
      })

      it("should update delegatee address", async () => {
        expect(await t.delegates(delegator.address)).to.equal(delegatee.address)
      })

      it("should emit DelegateChanged event", async () => {
        await expect(tx)
          .to.emit(t, "DelegateChanged")
          .withArgs(delegator.address, ZERO_ADDRESS, delegatee.address)
      })

      it("should emit DelegateVotesChanged", async () => {
        await expect(tx)
          .to.emit(t, "DelegateVotesChanged")
          .withArgs(delegatee.address, 0, initialBalance)
      })
    })

    context("when self-delegated", () => {
      let delegator
      let tx

      beforeEach(async () => {
        delegator = getDelegator()
        tx = await doDelegate(delegator.address)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(delegator.address)).to.equal(
          initialBalance
        )
      })

      it("should update delegatee address", async () => {
        expect(await t.delegates(delegator.address)).to.equal(delegator.address)
      })

      it("should emit DelegateChanged event", async () => {
        await expect(tx)
          .to.emit(t, "DelegateChanged")
          .withArgs(delegator.address, ZERO_ADDRESS, delegator.address)
      })

      it("should emit DelegateVotesChanged", async () => {
        await expect(tx)
          .to.emit(t, "DelegateVotesChanged")
          .withArgs(delegator.address, 0, initialBalance)
      })
    })

    context("when delegated multiple times", () => {
      let delegator
      let block1
      let block2
      let block3
      let block4

      beforeEach(async () => {
        delegator = getDelegator()
        await doDelegate(delegatee.address)
        block1 = await lastBlockNumber()
        await doDelegate(delegatee2.address)
        block2 = await lastBlockNumber()
        await doDelegate(delegatee.address)
        block3 = await lastBlockNumber()
        await doDelegate(delegator.address)
        block4 = await lastBlockNumber()
        await doDelegate(delegatee2.address)
      })

      it("should update current votes", async () => {
        expect(await t.getCurrentVotes(delegator.address)).to.equal(0)
        expect(await t.getCurrentVotes(delegatee.address)).to.equal(0)
        expect(await t.getCurrentVotes(delegatee2.address)).to.equal(
          initialBalance
        )
      })

      it("should keep track of prior votes", async () => {
        expect(await t.getPriorVotes(delegator.address, block1)).to.equal(0)
        expect(await t.getPriorVotes(delegatee.address, block1)).to.equal(
          initialBalance
        )
        expect(await t.getPriorVotes(delegatee2.address, block1)).to.equal(0)

        expect(await t.getPriorVotes(delegator.address, block2)).to.equal(0)
        expect(await t.getPriorVotes(delegatee.address, block2)).to.equal(0)
        expect(await t.getPriorVotes(delegatee2.address, block2)).to.equal(
          initialBalance
        )

        expect(await t.getPriorVotes(delegator.address, block3)).to.equal(0)
        expect(await t.getPriorVotes(delegatee.address, block3)).to.equal(
          initialBalance
        )
        expect(await t.getPriorVotes(delegatee2.address, block3)).to.equal(0)

        expect(await t.getPriorVotes(delegator.address, block4)).to.equal(
          initialBalance
        )
        expect(await t.getPriorVotes(delegatee.address, block4)).to.equal(0)
        expect(await t.getPriorVotes(delegatee2.address, block4)).to.equal(0)
      })
    })
  }

  describe("delegate", () => {
    describeDelegate(
      () => {
        return tokenHolder
      },
      async (delegatee) => {
        return await t.connect(tokenHolder).delegate(delegatee)
      }
    )
  })

  describe("delegateBySig", async () => {
    let yesterday
    let tomorrow

    let delegator

    beforeEach(async () => {
      const lastBlockTimestamp = await lastBlockTime()
      yesterday = lastBlockTimestamp - 86400 // -1 day
      tomorrow = lastBlockTimestamp + 86400 // +1 day

      // Hardhat creates SignerWithAddress instance that does not give access
      // to private key. We need an access to private key so that we can construct
      // ethers.utils.SigningKey as explained later.
      delegator = await ethers.Wallet.createRandom()
      await t.connect(deployer).mint(delegator.address, initialBalance)
    })

    describeDelegate(
      () => {
        return delegator
      },
      async (delegatee) => {
        const signature = await getDelegation(delegatee, tomorrow)
        return await t.delegateBySig(
          delegator.address,
          delegatee,
          tomorrow,
          signature.v,
          signature.r,
          signature.s
        )
      }
    )

    context("when delegation order expired", () => {
      it("should revert", async () => {
        const signature = await getDelegation(delegatee.address, yesterday)

        await expect(
          t.delegateBySig(
            delegator.address,
            delegatee.address,
            yesterday,
            signature.v,
            signature.r,
            signature.s
          )
        ).to.be.revertedWith("Delegation expired")
      })
    })

    context("when delegation order has an invalid signature", () => {
      it("should revert", async () => {
        const signature = await getDelegation(delegatee.address, tomorrow)

        await expect(
          t.delegateBySig(
            delegator.address,
            delegatee.address,
            tomorrow,
            signature.v,
            signature.s, // not r but s
            signature.s
          )
        ).to.be.revertedWith("Invalid signature")
      })
    })

    const getDelegation = async (delegatee, deadline) => {
      // We use ethers.utils.SigningKey for a Wallet instead of
      // Signer.signMessage to do not add '\x19Ethereum Signed Message:\n'
      // prefix to the signed message. The '\x19` protection (see EIP191 for
      // more details on '\x19' rationale and format) is already included in
      // Delegation signed message and '\x19Ethereum Signed Message:\n'
      // should not be used there.
      const signingKey = new ethers.utils.SigningKey(delegator.privateKey)

      const domainSeparator = await t.DOMAIN_SEPARATOR()
      const delegationTypehash = await t.DELEGATION_TYPEHASH()
      const nonce = await t.nonces(delegator.address)

      const delegationDigest = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["bytes1", "bytes1", "bytes32", "bytes32"],
          [
            "0x19",
            "0x01",
            domainSeparator,
            ethers.utils.keccak256(
              ethers.utils.defaultAbiCoder.encode(
                ["bytes32", "address", "uint256", "uint256"],
                [delegationTypehash, delegatee, nonce, deadline]
              )
            ),
          ]
        )
      )

      return ethers.utils.splitSignature(
        await signingKey.signDigest(delegationDigest)
      )
    }
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

const { expect } = require("chai")
const {
  ZERO_ADDRESS,
  to1e18,
  lastBlockTime,
  increaseTime,
  pastEvents,
} = require("../helpers/contract-test-helpers")

describe("TokenGrant", () => {
  let token
  let grantee

  beforeEach(async () => {
    ;[deployer, thirdParty, grantee] = await ethers.getSigners()

    const T = await ethers.getContractFactory("T")
    token = await T.deploy()
    await token.deployed()
  })

  describe("unlockedAmount", () => {
    const assertionPrecision = to1e18(1) // +- 1 token

    const amount = to1e18(100000) // 100k tokens
    const duration = 15552000 // 180 days

    let now

    beforeEach(async () => {
      now = await lastBlockTime()
    })

    context("before the schedule start", () => {
      it("should return no tokens unlocked", async () => {
        const start = now + 60
        const cliff = now + 60
        const grant = await createGrant(false, amount, duration, start, cliff)
        expect(await grant.unlockedAmount()).to.equal(0)
      })
    })

    context("before the cliff ended", () => {
      it("should return no tokens unlocked", async () => {
        const start = now - 60
        const cliff = now + 60
        const grant = await createGrant(false, amount, duration, start, cliff)
        expect(await grant.unlockedAmount()).to.equal(0)
      })
    })

    context("after the cliff ended", () => {
      it("should return token amount unlocked from the start", async () => {
        const start = now - duration / 2
        const cliff = now - 1
        const grant = await createGrant(false, amount, duration, start, cliff)
        expect(await grant.unlockedAmount()).is.closeTo(
          to1e18(50000),
          assertionPrecision
        )
      })
    })

    context("with no cliff", () => {
      it("should return token amount unlocked so far", async () => {
        const start = now - duration / 4
        const cliff = now - duration / 4
        const grant = await createGrant(false, amount, duration, start, cliff)
        expect(await grant.unlockedAmount()).is.closeTo(
          to1e18(25000),
          assertionPrecision
        )
      })
    })

    context("when unlocking period finished", () => {
      it("should return all tokens", async () => {
        const start = now - duration - 1
        const cliff = now - duration - 1
        const grant = await createGrant(false, amount, duration, start, cliff)
        expect(await grant.unlockedAmount()).is.closeTo(
          to1e18(100000),
          assertionPrecision
        )
      })
    })

    context("when in the middle of unlocking period", () => {
      it("should return token amount unlocked from the start", async () => {
        const start = now - duration / 2
        const cliff = now - duration / 2
        const grant = await createGrant(false, amount, duration, start, cliff)
        expect(await grant.unlockedAmount()).is.closeTo(
          to1e18(50000),
          assertionPrecision
        )
      })
    })

    context("when the unlocking period just started", () => {
      it("should return token amount unlocked so far", async () => {
        const start = now - 3600 // one hour earlier
        const cliff = now - 3600
        const grant = await createGrant(false, amount, duration, start, cliff)
        expect(await grant.unlockedAmount()).is.closeTo(
          to1e18(23), // 3600 / 15552000 * 100k = ~23 tokens
          assertionPrecision
        )
      })
    })

    context("when some tokens are staked", () => {
      it("should return token amount unlocked so far", async () => {
        const start = now - 3600 // one hour earlier
        const cliff = now - 3600
        const grant = await createGrant(false, amount, duration, start, cliff)
        await grant.connect(grantee).withdraw()
        expect(await grant.unlockedAmount()).is.closeTo(
          to1e18(23), // 3600 / 15552000 * 100k = ~23 tokens
          assertionPrecision
        )
      })
    })

    context("when some tokens were withdrawn", () => {
      it("should return token amount unlocked so far", async () => {
        const start = now - 3600 // one hour earlier
        const cliff = now - 3600
        const grant = await createGrant(false, amount, duration, start, cliff)
        await grant.connect(grantee).stake(to1e18(20))
        expect(await grant.unlockedAmount()).is.closeTo(
          to1e18(23), // 3600 / 15552000 * 100k = ~23 tokens
          assertionPrecision
        )
      })
    })
  })

  describe("withdrawableAmount", () => {
    const assertionPrecision = to1e18(1) // +- 1 token

    const amount = to1e18(100000) // 100k tokens
    const duration = 15552000 // 180 days

    let grant

    beforeEach(async () => {
      const now = await lastBlockTime()
      const start = now - 7200 // two hours earlier
      const cliff = now - 7200
      grant = await createGrant(false, amount, duration, start, cliff)
    })

    context("when no tokens were staked or withdrawn", () => {
      it("should return tokens unlocked so far", async () => {
        expect(await grant.withdrawableAmount()).is.closeTo(
          to1e18(46), // 7200 / 15552000 * 100k = ~46 tokens
          assertionPrecision
        )
      })
    })

    context("when some tokens were staked", () => {
      it("should return tokens unlocked so far minus staked tokens", async () => {
        await grant.connect(grantee).stake(to1e18(5))
        expect(await grant.withdrawableAmount()).is.closeTo(
          to1e18(41), // 7200 / 15552000 * 100k - 5 = ~41 tokens
          assertionPrecision
        )
      })
    })

    context("when some tokens were withdrawn", () => {
      it("should return tokens unlocked so far minus withdrawn tokens", async () => {
        await grant.connect(grantee).withdraw()
        await increaseTime(3600)
        expect(await grant.withdrawableAmount()).is.closeTo(
          to1e18(23), // 3600 / 15552000 * 100k = ~23 tokens
          assertionPrecision
        )
      })
    })

    context("when tokens were withdrawn multiple times", () => {
      it("should return tokens unlocked so far minus withdrawn tokens", async () => {
        await grant.connect(grantee).withdraw()
        await increaseTime(7200)
        await grant.connect(grantee).withdraw()
        await increaseTime(7200)

        expect(await grant.withdrawableAmount()).is.closeTo(
          to1e18(46), // 7200 / 15552000 * 100k = ~46 tokens
          assertionPrecision
        )
      })
    })

    context("when tokens were staked and withdrawn", () => {
      it("should return tokens unlocked so far minus withdrawn and staked tokens", async () => {
        await grant.connect(grantee).withdraw()
        await increaseTime(7200)
        await grant.connect(grantee).stake(to1e18(20))
        expect(await grant.withdrawableAmount()).is.closeTo(
          to1e18(26), // 7200 / 15552000 * 100k - 20 = ~26 tokens
          assertionPrecision
        )
      })
    })

    context("when tokens were staked and withdrawn multiple times", () => {
      it("should return tokens unlocked so far minus withdrawn and staked tokens", async () => {
        await grant.connect(grantee).withdraw()
        await increaseTime(7200)
        await grant.connect(grantee).withdraw()
        await grant.connect(grantee).stake(to1e18(10))
        await increaseTime(7200)
        expect(await grant.withdrawableAmount()).is.closeTo(
          to1e18(36), // 7200 / 15552000 * 100k - 10 = ~36 tokens
          assertionPrecision
        )
      })
    })
  })

  describe("withdraw", () => {
    const assertionPrecision = to1e18(1) // +- 1 token

    const amount = to1e18(200000) // 200k tokens
    const duration = 7776000 // 90 days

    let grant

    beforeEach(async () => {
      const now = await lastBlockTime()
      const start = now - 3888000 // 45 days earlier
      const cliff = now - 3888000
      grant = await createGrant(false, amount, duration, start, cliff)
    })

    context("when called by a third party", () => {
      it("should revert", async () => {
        await expect(grant.connect(thirdParty).withdraw()).to.be.revertedWith(
          "Not authorized"
        )
      })
    })

    context("when called by a grant creator", () => {
      it("should revert", async () => {
        await expect(grant.connect(deployer).withdraw()).to.be.revertedWith(
          "Not authorized"
        )
      })
    })

    context("when called by grantee", () => {
      context("when there are no withdrawable tokens", () => {
        it("should revert", async () => {
          await grant.connect(grantee).stake(amount)
          await expect(grant.connect(grantee).withdraw()).to.be.revertedWith(
            "There is nothing to withdraw"
          )
        })
      })

      context("when there are withdrawable tokens", () => {
        let tx

        beforeEach(async () => {
          // 3888000/7776000 * 200k = 100k
          tx = await grant.connect(grantee).withdraw()
        })

        it("should increase withdrawn amount", async () => {
          expect(await grant.withdrawn()).to.be.closeTo(
            to1e18(100000),
            assertionPrecision
          )
        })

        it("should transfer tokens to grantee", async () => {
          expect(await token.balanceOf(grantee.address)).to.be.closeTo(
            to1e18(100000),
            assertionPrecision
          )
          expect(await token.balanceOf(grant.address)).to.be.closeTo(
            to1e18(100000),
            assertionPrecision
          )
        })

        it("should emit Withdrawn event", async () => {
          const events = pastEvents(await tx.wait(), grant, "Withdrawn")
          expect(events.length).to.equal(1)
          expect(events[0].args["amount"]).to.be.closeTo(
            to1e18(100000),
            assertionPrecision
          )
        })
      })
    })
  })

  async function createGrant(revocable, amount, duration, start, cliff) {
    const TokenGrant = await ethers.getContractFactory("TokenGrant")
    const tokenGrant = await TokenGrant.deploy()
    await tokenGrant.deployed()

    await token.connect(deployer).mint(deployer.address, amount)
    await token.connect(deployer).approve(tokenGrant.address, amount)

    await tokenGrant
      .connect(deployer)
      .initialize(
        token.address,
        grantee.address,
        revocable,
        amount,
        duration,
        start,
        cliff,
        ZERO_ADDRESS
      )

    return tokenGrant
  }
})

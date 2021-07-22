const { expect } = require("chai")
const {
  ZERO_ADDRESS,
  to1e18,
  lastBlockTime,
} = require("../helpers/contract-test-helpers")

describe("TokenGrant", () => {
  let grantee

  beforeEach(async () => {
    ;[grantee] = await ethers.getSigners()
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
        const cliff = now
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
  })

  async function createGrant(revocable, amount, duration, start, cliff) {
    const TokenGrant = await ethers.getContractFactory("TokenGrant")
    const tokenGrant = await TokenGrant.deploy()
    await tokenGrant.deployed()

    await tokenGrant.initialize(
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

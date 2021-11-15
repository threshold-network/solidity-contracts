const { expect } = require("chai")

describe("KeepStake", () => {
  let deployer
  let governance
  let thirdParty

  let keepStake

  let keepTokenStakingMock
  let managedGrantMock

  beforeEach(async () => {
    ;[deployer, governance, thirdParty] = await ethers.getSigners()

    const KeepTokenStakingMock = await ethers.getContractFactory(
      "KeepTokenStakingMock"
    )
    keepTokenStakingMock = await KeepTokenStakingMock.deploy()
    await keepTokenStakingMock.deployed()

    const KeepStake = await ethers.getContractFactory("KeepStake")
    keepStake = await KeepStake.deploy(keepTokenStakingMock.address)
    await keepStake.deployed()

    keepStake.connect(deployer).transferOwnership(governance.address)

    const ManagedGrantMock = await ethers.getContractFactory("ManagedGrantMock")
    managedGrantMock = await ManagedGrantMock.deploy()
    await managedGrantMock.deployed()
  })

  describe("resolveOwner", () => {
    context("for snapshotted operator", () => {
      it("should return grantee address", async () => {
        const grantee1 = await keepStake.resolveOwner(
          "0x1147ccFB4AEFc6e587a23b78724Ef20Ec6e474D4"
        )
        const grantee2 = await keepStake.resolveOwner(
          "0x526c013f8382B050d32d86e7090Ac84De22EdA4D"
        )

        expect(grantee1).to.equal("0x3FB49dA4375Ef9019f17990D04c6d5daD482D80a")
        expect(grantee2).to.equal("0x61C6E5DDacded540CD08066C08cbc096d22D91f4")
      })
    })

    context("for managed grant set by governance", () => {
      const operator = "0xbDe54bDf60a7a5f748dA3e15fF029d2D7C4E078f"
      const grantee = "0x0068B9e3cdCccBb3f101FA90beC864890789d444"

      beforeEach(async () => {
        await managedGrantMock.setGrantee(grantee)
        await keepStake
          .connect(governance)
          .setManagedGrant(operator, managedGrantMock.address)
      })

      it("should return grantee address", async () => {
        expect(await keepStake.resolveOwner(operator)).to.equal(grantee)
      })
    })

    context("for grantee set by governance", () => {
      const operator = "0xbDe54bDf60a7a5f748dA3e15fF029d2D7C4E078f"
      const grantee = "0x3EaCc4EcF687A999b72cC4bd72b2Ff969681034A"

      beforeEach(async () => {
        await keepStake.connect(governance).setGrantee(operator, grantee)
      })

      it("should return grantee address", async () => {
        expect(await keepStake.resolveOwner(operator)).to.equal(grantee)
      })
    })

    context("for liquid token operator", () => {
      const operator = "0xbDe54bDf60a7a5f748dA3e15fF029d2D7C4E078f"
      const owner = "0x3f78eC9999Bbf47b4eefBf1058BDE4CeDA3eaa8A"
      const beneficiary = "0x3A654A853eC8BAfc1b147B21342C1118d2DF6ffe"
      const authorizer = "0xbC04D5301C0Cd565f8Fe1cDbA7def6e5de4EB2c4"

      beforeEach(async () => {
        await keepTokenStakingMock.setOperator(
          operator,
          owner,
          beneficiary,
          authorizer,
          1,
          0,
          1
        )
      })

      it("should fallback to Keep staking contract", async () => {
        expect(await keepStake.resolveOwner(operator)).to.equal(owner)
      })

      it("should revert if Keep staking does not know the operator", async () => {
        await expect(keepStake.resolveOwner(authorizer)).to.be.revertedWith(
          "Could not resolve the owner"
        )
      })
    })
  })

  describe("setManagedGrant", () => {
    const operator = "0xbDe54bDf60a7a5f748dA3e15fF029d2D7C4E078f"
    const managedGrant = "0xCc83cae99c1e6a16dFB2D2Aba9cA25082AeB9537"

    context("when called by governance", () => {
      it("should set managed grant", async () => {
        await keepStake
          .connect(governance)
          .setManagedGrant(operator, managedGrant)

        expect(await keepStake.operatorToManagedGrant(operator)).to.equal(
          managedGrant
        )
      })
    })

    context("when called by a third party", () => {
      it("should revert", async () => {
        await expect(
          keepStake.connect(thirdParty).setManagedGrant(operator, managedGrant)
        ).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })
  })

  describe("setGrantee", () => {
    const operator = "0xbDe54bDf60a7a5f748dA3e15fF029d2D7C4E078f"
    const grantee = "0x12e298bDd84A19968980efDc1dEC91Af357824c7"

    context("when called by governance", () => {
      it("should set grantee", async () => {
        await keepStake.connect(governance).setGrantee(operator, grantee)

        expect(await keepStake.operatorToGrantee(operator)).to.equal(grantee)
      })
    })

    context("when called by a third party", () => {
      it("should revert", async () => {
        await expect(
          keepStake.connect(thirdParty).setGrantee(operator, grantee)
        ).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })
  })
})

const { expect } = require("chai")

const { helpers } = require("hardhat")
const { lastBlockTime, increaseTime } = helpers.time
const { to1e18 } = helpers.number

const { AddressZero, Zero } = ethers.constants

const ApplicationStatus = {
  NOT_APPROVED: 0,
  APPROVED: 1,
  PAUSED: 2,
  DISABLED: 3,
}

describe("StableYield", () => {
  let tToken
  let rewardReceiverMock

  const tAllocation = to1e18("4500000000") // 4.5 Billion

  let tokenStaking
  let stableYield
  let stableYieldBase // 100%

  let deployer
  let distributor

  beforeEach(async () => {
    ;[
      deployer,
      distributor,
      caller,
      application1Mock,
      application2Mock,
      application3Mock,
    ] = await ethers.getSigners()

    const T = await ethers.getContractFactory("T")
    tToken = await T.deploy()
    await tToken.deployed()

    await tToken.mint(deployer.address, tAllocation)

    const TokenStakingMock = await ethers.getContractFactory("TokenStakingMock")
    tokenStaking = await TokenStakingMock.deploy()
    await tokenStaking.deployed()

    const RewardReceiverMock = await ethers.getContractFactory(
      "RewardReceiverMock"
    )
    rewardReceiverMock = await RewardReceiverMock.deploy(tToken.address)
    await rewardReceiverMock.deployed()

    const StableYield = await ethers.getContractFactory("StableYield")
    stableYield = await StableYield.deploy(tToken.address, tokenStaking.address)
    await stableYield.deployed()

    stableYieldBase = await stableYield.STABLE_YIELD_BASE()
    tToken.connect(deployer).transferOwnership(stableYield.address)
  })

  describe("setApplicationParameters", () => {
    const stableYieldApp1 = ethers.BigNumber.from(100)
    const duration = ethers.BigNumber.from(60 * 60 * 24)
    const receiveRewardMethodEmpty = ""

    context("when caller is not the owner", () => {
      it("should revert", async () => {
        await expect(
          stableYield
            .connect(distributor)
            .setApplicationParameters(
              application1Mock.address,
              stableYieldApp1,
              duration,
              distributor.address,
              receiveRewardMethodEmpty
            )
        ).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })

    context("when duration is not set", () => {
      it("should revert", async () => {
        await expect(
          stableYield
            .connect(deployer)
            .setApplicationParameters(
              application1Mock.address,
              stableYieldApp1,
              0,
              distributor.address,
              receiveRewardMethodEmpty
            )
        ).to.be.revertedWith("Wrong input parameters")
      })
    })

    context("when stable yield is bigger 100%", () => {
      it("should revert", async () => {
        await expect(
          stableYield
            .connect(deployer)
            .setApplicationParameters(
              application1Mock.address,
              stableYieldBase.add(1),
              duration,
              distributor.address,
              receiveRewardMethodEmpty
            )
        ).to.be.revertedWith("Wrong input parameters")
      })
    })

    context("when distributor is not set", () => {
      it("should revert", async () => {
        await expect(
          stableYield
            .connect(deployer)
            .setApplicationParameters(
              application1Mock.address,
              stableYieldApp1,
              duration,
              AddressZero,
              receiveRewardMethodEmpty
            )
        ).to.be.revertedWith("Wrong input parameters")
      })
    })

    context("when parameters set for the first time", () => {
      let tx

      beforeEach(async () => {
        tx = await stableYield
          .connect(deployer)
          .setApplicationParameters(
            application1Mock.address,
            stableYieldApp1,
            duration,
            distributor.address,
            receiveRewardMethodEmpty
          )
      })

      it("should set parameters", async () => {
        const info = await stableYield.applicationInfo(application1Mock.address)
        expect(info.stableYield).to.equal(stableYieldApp1)
        expect(info.duration).to.equal(duration)
        expect(info.distributor).to.equal(distributor.address)
        expect(info.receiveRewardMethod).to.equal(receiveRewardMethodEmpty)
      })

      it("should emit ParametersSet event", async () => {
        await expect(tx)
          .to.emit(stableYield, "ParametersSet")
          .withArgs(
            application1Mock.address,
            stableYieldApp1,
            duration,
            distributor.address,
            receiveRewardMethodEmpty
          )
      })
    })

    context("when reward disabled after minting", () => {
      let tx
      let lastMint
      const receiveRewardMethod = "receiveReward(uint96)"

      beforeEach(async () => {
        await tokenStaking.setApplicationInfo(
          rewardReceiverMock.address,
          ApplicationStatus.APPROVED,
          tAllocation.div(2)
        )
        await stableYield
          .connect(deployer)
          .setApplicationParameters(
            rewardReceiverMock.address,
            stableYieldApp1,
            duration,
            distributor.address,
            receiveRewardMethod
          )
        await stableYield.mintAndPushReward(rewardReceiverMock.address)
        const info = await stableYield.applicationInfo(
          rewardReceiverMock.address
        )
        lastMint = info.lastMint
        tx = await stableYield
          .connect(deployer)
          .setApplicationParameters(
            rewardReceiverMock.address,
            Zero,
            duration,
            distributor.address,
            receiveRewardMethod
          )
      })

      it("should update parameters", async () => {
        const info = await stableYield.applicationInfo(
          rewardReceiverMock.address
        )
        expect(info.stableYield).to.equal(Zero)
        expect(info.duration).to.equal(duration)
        expect(info.distributor).to.equal(distributor.address)
        expect(info.receiveRewardMethod).to.equal(receiveRewardMethod)
        expect(info.lastMint).to.equal(lastMint)
      })

      it("should emit ParametersSet event", async () => {
        await expect(tx)
          .to.emit(stableYield, "ParametersSet")
          .withArgs(
            rewardReceiverMock.address,
            Zero,
            duration,
            distributor.address,
            receiveRewardMethod
          )
      })
    })
  })

  describe("mintAndPushReward", () => {
    const stableYieldApp1 = ethers.BigNumber.from(100)
    const stableYieldApp2 = ethers.BigNumber.from(250)
    const duration = ethers.BigNumber.from(60 * 60 * 24)
    const receiveRewardMethodEmpty = ""
    const receiveRewardMethod = "receiveReward(uint96)"
    const authorization1 = tAllocation.div(4)
    const authorization2 = tAllocation.div(3)

    beforeEach(async () => {
      await stableYield
        .connect(deployer)
        .setApplicationParameters(
          application1Mock.address,
          stableYieldApp1,
          duration,
          distributor.address,
          receiveRewardMethodEmpty
        )
      await stableYield
        .connect(deployer)
        .setApplicationParameters(
          rewardReceiverMock.address,
          stableYieldApp2,
          duration,
          rewardReceiverMock.address,
          receiveRewardMethod
        )
      await tokenStaking.setApplicationInfo(
        application1Mock.address,
        ApplicationStatus.APPROVED,
        authorization1
      )
      await tokenStaking.setApplicationInfo(
        rewardReceiverMock.address,
        ApplicationStatus.APPROVED,
        authorization2
      )
    })

    context("when stable yield is not set for the application", () => {
      it("should revert", async () => {
        await expect(
          stableYield
            .connect(caller)
            .mintAndPushReward(application2Mock.address)
        ).to.be.revertedWith(
          "Reward parameters are not set for the application"
        )
      })
    })

    context("when stable yield is reset to zero", () => {
      it("should revert", async () => {
        await stableYield
          .connect(deployer)
          .setApplicationParameters(
            application1Mock.address,
            Zero,
            duration,
            distributor.address,
            receiveRewardMethodEmpty
          )
        await expect(
          stableYield
            .connect(caller)
            .mintAndPushReward(application1Mock.address)
        ).to.be.revertedWith(
          "Reward parameters are not set for the application"
        )
      })
    })

    context("when not enough time passed since last mint", () => {
      it("should revert", async () => {
        await stableYield
          .connect(caller)
          .mintAndPushReward(application1Mock.address)
        await expect(
          stableYield
            .connect(caller)
            .mintAndPushReward(application1Mock.address)
        ).to.be.revertedWith("New portion of reward is not ready")
      })
    })

    context("when application is not approved", () => {
      it("should revert", async () => {
        await tokenStaking.setApplicationInfo(
          application1Mock.address,
          ApplicationStatus.NOT_APPROVED,
          Zero
        )
        await expect(
          stableYield
            .connect(caller)
            .mintAndPushReward(application1Mock.address)
        ).to.be.revertedWith("Application is not approved")
        await tokenStaking.setApplicationInfo(
          rewardReceiverMock.address,
          ApplicationStatus.PAUSED,
          Zero
        )
        await expect(
          stableYield
            .connect(caller)
            .mintAndPushReward(rewardReceiverMock.address)
        ).to.be.revertedWith("Application is not approved")
        await tokenStaking.setApplicationInfo(
          application1Mock.address,
          ApplicationStatus.DISABLED,
          Zero
        )
        await expect(
          stableYield
            .connect(caller)
            .mintAndPushReward(application1Mock.address)
        ).to.be.revertedWith("Application is not approved")
      })
    })

    context("when reward minted directly for distributor", () => {
      let tx
      let blockTimestamp
      let expectedReward

      beforeEach(async () => {
        expectedReward = authorization1
          .mul(authorization1)
          .mul(stableYieldApp1)
          .div(tAllocation)
          .div(stableYieldBase)
        tx = await stableYield
          .connect(caller)
          .mintAndPushReward(application1Mock.address)
        blockTimestamp = await lastBlockTime()
      })

      it("should update lastMint parameter", async () => {
        const info = await stableYield.applicationInfo(application1Mock.address)
        expect(info.lastMint).to.equal(blockTimestamp)
      })

      it("should mint reward for distributor", async () => {
        expect(await tToken.balanceOf(distributor.address)).to.equal(
          expectedReward
        )
        await expect(tx)
          .to.emit(tToken, "Transfer")
          .withArgs(AddressZero, distributor.address, expectedReward)
      })

      it("should emit MintedReward event", async () => {
        await expect(tx)
          .to.emit(stableYield, "MintedReward")
          .withArgs(application1Mock.address, expectedReward)
      })
    })

    context("when reward pushed through receiver method", () => {
      let tx
      let blockTimestamp
      let expectedReward1
      let expectedReward2

      beforeEach(async () => {
        expectedReward1 = authorization2
          .mul(authorization2)
          .mul(stableYieldApp2)
          .div(tAllocation)
          .div(stableYieldBase)
        await stableYield
          .connect(caller)
          .mintAndPushReward(rewardReceiverMock.address)
        const totalSupply = await tToken.totalSupply()
        increaseTime(duration)
        expectedReward2 = authorization2
          .mul(authorization2)
          .mul(stableYieldApp2)
          .div(totalSupply)
          .div(stableYieldBase)
        tx = await stableYield
          .connect(caller)
          .mintAndPushReward(rewardReceiverMock.address)
        blockTimestamp = (await lastBlockTime()) - 1
      })

      it("should update lastMint parameter", async () => {
        const info = await stableYield.applicationInfo(
          rewardReceiverMock.address
        )
        expect(info.lastMint).to.equal(blockTimestamp)
      })

      it("should push reward to receiver", async () => {
        expect(await tToken.balanceOf(rewardReceiverMock.address)).to.equal(
          expectedReward1.add(expectedReward2)
        )
        await expect(tx)
          .to.emit(tToken, "Transfer")
          .withArgs(
            stableYield.address,
            rewardReceiverMock.address,
            expectedReward2
          )
      })

      it("should emit MintedReward event", async () => {
        await expect(tx)
          .to.emit(stableYield, "MintedReward")
          .withArgs(rewardReceiverMock.address, expectedReward2)
      })
    })
  })
})

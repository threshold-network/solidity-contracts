const { expect } = require("chai")

const { upgrades } = require("hardhat")
const { Manifest }  = require("@openzeppelin/upgrades-core")

describe("ProxyAdminWithDeputy", () => {
  let deployer
  let deputy
  let timelock
  let other

  beforeEach(async () => {
    ;[deployer, deputy, timelock, other] = await ethers.getSigners()

    const SimpleStorage = await ethers.getContractFactory(
      "SimpleStorage"
    )
    const initializerArgs = [42]
    storage = await upgrades.deployProxy(
      SimpleStorage,
      initializerArgs,
      {kind: "transparent"}
    )
    await storage.deployed()

    const GovernorStub = await ethers.getContractFactory(
      "TestTokenholderGovernorStubV2"
    )
    tGov = await GovernorStub.deploy(timelock.address)
    await tGov.deployed()

    const ProxyAdminWithDeputy = await ethers.getContractFactory(
      "ProxyAdminWithDeputy"
    )
    admin = await ProxyAdminWithDeputy.deploy(tGov.address, deputy.address)
    await admin.deployed()
  })

  describe("Plain Upgrades deployment - No ProxyAdminWithDeputy", () => {
    it("ProxyAdmin is the admin for the UpgradeableProxy", async () => {
      const adminInstance = await upgrades.admin.getInstance();
      const adminAddress = await adminInstance.getProxyAdmin(storage.address);
      expect(adminInstance.address).to.equal(adminAddress);
    })
  })

})

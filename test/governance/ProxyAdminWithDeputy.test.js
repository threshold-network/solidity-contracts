const { expect } = require("chai")

const { upgrades } = require("hardhat")
const { Manifest } = require("@openzeppelin/upgrades-core")

describe("ProxyAdminWithDeputy", () => {
  let deployer
  let deputy
  let timelock
  let originalAdmin

  let SimpleStorage
  const initialState = 42

  beforeEach(async () => {
    ;[deployer, deputy, timelock] = await ethers.getSigners()
    SimpleStorage = await ethers.getContractFactory("SimpleStorage")
    const initializerArgs = [initialState] // stored value in proxy state
    storage = await upgrades.deployProxy(SimpleStorage, initializerArgs, {
      kind: "transparent",
      constructorArgs: [1], // implementation version 1
    })
    await storage.deployed()

    const GovernorStub = await ethers.getContractFactory(
      "TestTokenholderGovernorStubV2"
    )
    tGov = await GovernorStub.deploy(timelock.address)
    await tGov.deployed()

    const ProxyAdminWithDeputy = await ethers.getContractFactory(
      "ProxyAdminWithDeputy"
    )
    adminWithDeputy = await ProxyAdminWithDeputy.deploy(
      tGov.address,
      deputy.address
    )
    await adminWithDeputy.deployed()
  })

  describe("Plain Upgrades deployment - No ProxyAdminWithDeputy", () => {
    let newImplementationAddress
    let adminInstance

    beforeEach(async () => {
      newImplementationAddress = await upgrades.prepareUpgrade(
        storage.address,
        SimpleStorage,
        {
          constructorArgs: [2],
        }
      )
      adminInstance = await upgrades.admin.getInstance()
    })

    it("ProxyAdmin is the admin for the UpgradeableProxy", async () => {
      const adminInstance = await upgrades.admin.getInstance()
      const adminAddress = await adminInstance.getProxyAdmin(storage.address)
      expect(adminInstance.address).to.equal(adminAddress)
    })

    it("before upgrade, implementation version is 1", async () => {
      expect(await storage.implementationVersion()).to.equal(1)
    })

    it("before upgrade, state is as expected", async () => {
      expect(await storage.storedValue()).to.equal(initialState)
    })

    it("ProxyAdmin can upgrade, version is now 2 and state is correct", async () => {
      await adminInstance
        .connect(deployer)
        .upgrade(storage.address, newImplementationAddress)
      expect(await storage.storedValue()).to.equal(initialState)
      expect(await storage.implementationVersion()).to.equal(2)
    })

    it("Deputy can't upgrade", async () => {
      await expect(
        adminInstance
          .connect(deputy)
          .upgrade(storage.address, newImplementationAddress)
      ).to.be.revertedWith("Ownable: caller is not the owner")
    })
  })

  describe("Patched Upgrades deployment - Using our ProxyAdminWithDeputy", () => {
    beforeEach(async () => {
      // Change admin of TransparentUpgradeableProxy to the
      // ProxyAdminWithDeputy contract
      await upgrades.admin.changeProxyAdmin(
        storage.address,
        adminWithDeputy.address
      )

      // We patch the Network Manifest to use our ProxyAdminWithDeputy.
      // This will facilitate reuse of the Upgrade plugin with our proxy admin.
      const manifest = new Manifest(31337) // await Manifest.forNetwork(provider);
      manifestData = await manifest.read()
      originalAdmin = manifestData.admin.address
      manifestData.admin.address = adminWithDeputy.address
      await manifest.lockedRun(async () => {
        await manifest.write(manifestData)
      })
    })

    afterEach(async () => {
      // We restore the Network Manifest
      const manifest = new Manifest(31337) // await Manifest.forNetwork(provider);
      manifestData = await manifest.read()
      manifestData.admin.address = originalAdmin
      await manifest.lockedRun(async () => {
        await manifest.write(manifestData)
      })
    })

    it("ProxyAdminWithDeputy is the admin for the UpgradeableProxy", async () => {
      const adminInstance = await upgrades.admin.getInstance()
      const adminAddress = await adminInstance.getProxyAdmin(storage.address)
      expect(adminInstance.address).to.equal(adminAddress)
    })

    describe("Upgrades procedure with ProxyAdminWithDeputy", () => {
      let newImplementationAddress

      beforeEach(async () => {
        newImplementationAddress = await upgrades.prepareUpgrade(
          storage.address,
          SimpleStorage,
          {
            constructorArgs: [2],
          }
        )
      })

      it("before upgrade, implementation version is 1", async () => {
        expect(await storage.implementationVersion()).to.equal(1)
      })

      it("before upgrade, state is as expected", async () => {
        expect(await storage.storedValue()).to.equal(initialState)
      })

      it("Deputy can upgrade, version is now 2 and state is correct", async () => {
        const adminInstance = await upgrades.admin.getInstance()
        await adminInstance
          .connect(deputy)
          .upgrade(storage.address, newImplementationAddress)
        expect(await storage.storedValue()).to.equal(initialState)
        expect(await storage.implementationVersion()).to.equal(2)
      })

      it("ProxyAdminWithDeputy's owner (the Timelock) can upgrade, version is now 2 and state is correct", async () => {
        const adminInstance = await upgrades.admin.getInstance()
        await adminInstance
          .connect(timelock)
          .upgrade(storage.address, newImplementationAddress)
        expect(await storage.storedValue()).to.equal(42)
        expect(await storage.implementationVersion()).to.equal(2)
      })
    })
  })
})

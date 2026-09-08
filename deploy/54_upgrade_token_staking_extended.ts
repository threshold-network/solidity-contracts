import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

/**
 * Upgrade the existing Sepolia proxy to the dedicated operator staking contract.
 * Run: yarn deploy --network sepolia --tags UpgradeTokenStaking
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (hre.network.name !== "sepolia") {
    throw new Error(
      "TokenStaking operator upgrade is only supported on Sepolia"
    )
  }

  const { deployments, ethers, upgrades, artifacts, getNamedAccounts } = hre
  const existing = await deployments.getOrNull("TokenStaking")
  if (!existing) {
    throw new Error("Deploy TokenStaking before upgrading it")
  }

  const T = await deployments.get("T")
  const { deployer } = await getNamedAccounts()
  const factory = await ethers.getContractFactory(
    "SepoliaTokenStaking",
    await ethers.getSigner(deployer)
  )
  const upgraded = await upgrades.upgradeProxy(existing.address, factory, {
    constructorArgs: [T.address],
    kind: "transparent",
  })
  await upgraded.deployed()

  // Save through the registry so later scripts and --export see the same ABI.
  await deployments.save("TokenStaking", {
    ...existing,
    abi: (await artifacts.readArtifact("SepoliaTokenStaking")).abi,
    implementation: await upgrades.erc1967.getImplementationAddress(
      existing.address
    ),
  })
  deployments.log(
    `Upgraded TokenStaking at ${existing.address} to SepoliaTokenStaking`
  )
}

export default func

func.tags = ["TokenStakingUpgrade", "UpgradeTokenStaking"]
func.dependencies = ["T"]
func.skip = async (hre: HardhatRuntimeEnvironment) =>
  hre.network.name !== "sepolia"

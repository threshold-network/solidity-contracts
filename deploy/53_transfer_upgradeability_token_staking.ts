import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, ethers, upgrades } = hre
  const { deployer, thresholdCouncil } = await getNamedAccounts()

  const TokenStaking = await deployments.get("TokenStaking")
  const admin = await ethers.getContractAt(
    [
      "function owner() view returns (address)",
      "function transferOwnership(address)",
    ],
    await upgrades.erc1967.getAdminAddress(TokenStaking.address),
    await ethers.getSigner(deployer)
  )
  if ((await admin.owner()).toLowerCase() !== thresholdCouncil.toLowerCase()) {
    await (await admin.transferOwnership(thresholdCouncil)).wait()
  }
}

export default func

func.tags = ["TransferUpgradeabilityTokenStaking"]
func.runAtTheEnd = true
func.dependencies = ["TokenStaking"]
func.skip = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  return hre.network.name !== "mainnet"
}

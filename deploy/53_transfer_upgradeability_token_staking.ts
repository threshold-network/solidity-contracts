import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { upgrades } from "hardhat"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts } = hre
  const { thresholdCouncil } = await getNamedAccounts()

  await upgrades.admin.transferProxyAdminOwnership(thresholdCouncil)
}

export default func

func.tags = ["TransferUpgradeabilityTokenStaking"]
func.runAtTheEnd = true
func.dependencies = ["TokenStaking"]
func.skip = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  return hre.network.name !== "mainnet"
}

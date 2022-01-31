import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer, thresholdCouncil } = await getNamedAccounts()
  const { execute } = deployments

  await execute(
    "TokenStaking",
    { from: deployer },
    "transferGovernance",
    thresholdCouncil
  )
}

export default func

func.tags = ["TransferOwnershipTokenStaking"]
func.runAtTheEnd = true
func.dependencies = ["TokenStaking"]
func.skip = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  return hre.network.name !== "mainnet"
}

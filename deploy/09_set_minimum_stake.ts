import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { execute } = deployments
  const { log } = deployments

  const { deployer } = await getNamedAccounts()

  const minStakeAmount = "39999999999999999999999"
  await execute(
    "TokenStaking",
    { from: deployer },
    "setMinimumStakeAmount",
    minStakeAmount
  )

  log(`Set minimum stake amount to ${minStakeAmount}`)
}

export default func

func.tags = ["setMinStakeAmount"]
func.dependencies = ["TokenStaking"]
func.skip = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  return hre.network.name !== "goerli"
}

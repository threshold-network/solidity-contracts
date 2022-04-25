import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { keepRegistryKeeper, deployer } = await getNamedAccounts()
  const { execute, log } = deployments

  const TokenStaking = await deployments.get("TokenStaking")

  await execute(
    "KeepRegistry",
    { from: keepRegistryKeeper || deployer },
    "approveOperatorContract",
    TokenStaking.address
  )

  log(
    `Approved T TokenStaking operator contract [${TokenStaking.address}] in KeepRegistry`
  )
}

export default func

func.tags = ["ConfigureKeepRegistry"]
func.dependencies = ["TokenStaking", "KeepRegistry"]
func.skip = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  return hre.network.name === "mainnet"
}

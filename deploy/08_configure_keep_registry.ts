import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute, log } = deployments

  const TokenStaking = await deployments.get("TokenStaking")

  await execute(
    "KeepRegistry",
    // TODO: We should execute this transaction from Keep deployer account. The
    // Keep deployer account and T deployer account are 2 different accounts.
    { from: deployer },
    "approveOperatorContract",
    TokenStaking.address
  )

  log(
    `Approved T TokenStaking operator contract [${TokenStaking.address}] in Keep registry`
  )
}

export default func

func.tags = ["ConfigureKeepRegistry"]
func.dependencies = ["TokenStaking", "KeepRegistry"]

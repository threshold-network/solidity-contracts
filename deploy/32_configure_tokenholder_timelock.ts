import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute, read, log } = deployments

  const TokenholderGovernor = await deployments.get("TokenholderGovernor")

  const PROPOSER_ROLE = await read("TokenholderTimelock", "PROPOSER_ROLE")
  const TIMELOCK_ADMIN_ROLE = await read(
    "TokenholderTimelock",
    "TIMELOCK_ADMIN_ROLE"
  )

  if (
    !(await read(
      "TokenholderTimelock",
      "hasRole",
      PROPOSER_ROLE,
      TokenholderGovernor.address
    ))
  ) {
    await execute(
      "TokenholderTimelock",
      { from: deployer },
      "grantRole",
      PROPOSER_ROLE,
      TokenholderGovernor.address
    )
    log(`Granted PROPOSER_ROLE to ${TokenholderGovernor.address}`)
  }

  if (
    await read("TokenholderTimelock", "hasRole", TIMELOCK_ADMIN_ROLE, deployer)
  ) {
    await execute(
      "TokenholderTimelock",
      { from: deployer },
      "renounceRole",
      TIMELOCK_ADMIN_ROLE,
      deployer
    )
    log(`Address ${deployer} renounced TIMELOCK_ADMIN_ROLE`)
  }
}

export default func

func.tags = ["ConfigTokenholderTimelock"]
func.dependencies = ["TokenholderGovernor"]

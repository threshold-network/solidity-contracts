import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { from1e18, to1e18 } from "../test/helpers/contract-test-helpers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute, read, log } = deployments

  const T = await deployments.get("T")

  // We're minting 10B T, which is the value of the T supply on the production
  // environment.
  const T_SUPPLY = to1e18("10000000000") // 10B T

  await execute("T", { from: deployer }, "mint", deployer, T_SUPPLY)

  log(`minted ${from1e18(await read("T", "totalSupply"))} KEEP`)
}

export default func

func.tags = ["MintT"]
func.dependencies = ["T"]

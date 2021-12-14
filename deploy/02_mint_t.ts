import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import type { BigNumber } from "@ethersproject/bignumber"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { execute, read, log } = deployments
  const { to1e18, from1e18 } = helpers.number

  const T = await deployments.get("T")

  const totalSupply: BigNumber = await read("T", "totalSupply")

  if (!totalSupply.isZero()) {
    log(
      `T tokens were already minted, T total supply: ${from1e18(totalSupply)}`
    )
  } else {
    // We're minting 10B T, which is the value of the T supply on the production
    // environment.
    const T_SUPPLY = to1e18("10000000000") // 10B T

    await execute("T", { from: deployer }, "mint", deployer, T_SUPPLY)

    log(`minted ${from1e18(await read("T", "totalSupply"))} T`)
  }
}

export default func

func.tags = ["MintT"]
func.dependencies = ["T"]

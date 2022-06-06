import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()

  log(`deploying SimplePREApplication stub`)

  await deployments.deploy("SimplePREApplication", {
    contract: "SimplePREApplicationStub",
    from: deployer,
    log: true,
  })
}

export default func

func.tags = ["NuCypherSimplePREApplication"]
func.skip = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  return hre.network.name !== "development"
}

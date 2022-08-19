import { HardhatRuntimeEnvironment, HardhatNetworkConfig } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()

  const KeepRegistry = await deployments.getOrNull("KeepRegistry")

  if (KeepRegistry && helpers.address.isValid(KeepRegistry.address)) {
    log(`using existing KeepRegistry contract at ${KeepRegistry.address}`)
  } else if (
    !hre.network.tags.allowStubs ||
    (hre.network.config as HardhatNetworkConfig)?.forking?.enabled
  ) {
    throw new Error("deployed KeepRegistry contract not found")
  } else {
    log(`deploying KeepRegistry stub`)

    await deployments.deploy("KeepRegistry", {
      contract: "KeepRegistryStub",
      from: deployer,
      log: true,
    })
  }
}

export default func

func.tags = ["KeepRegistry"]

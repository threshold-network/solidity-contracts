import { HardhatRuntimeEnvironment, HardhatNetworkConfig } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()

  const KeepTokenStaking = await deployments.getOrNull("KeepTokenStaking")

  if (KeepTokenStaking && helpers.address.isValid(KeepTokenStaking.address)) {
    log(`using existing KeepTokenStaking at ${KeepTokenStaking.address}`)
  } else if (
    !hre.network.tags.allowStubs ||
    (hre.network.config as HardhatNetworkConfig)?.forking?.enabled
  ) {
    throw new Error("deployed KeepTokenStaking contract not found")
  } else {
    log(`deploying KeepTokenStaking stub`)

    await deployments.deploy("KeepTokenStaking", {
      contract: "KeepTokenStakingMock",
      from: deployer,
      log: true,
    })
  }
}

export default func

func.tags = ["KeepTokenStaking"]

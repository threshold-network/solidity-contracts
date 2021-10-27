import { HardhatRuntimeEnvironment, HardhatNetworkConfig } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { BigNumber } from "ethers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()
  const { execute } = deployments

  const KeepToken = await deployments.getOrNull("KeepToken")

  if (KeepToken && helpers.address.isValid(KeepToken.address)) {
    log(`using external KeepToken at ${KeepToken.address}`)
  } else if (
    hre.network.name !== "hardhat" ||
    (hre.network.config as HardhatNetworkConfig).forking.enabled
  ) {
    throw new Error("deployed KeepToken contract not found")
  } else {
    log(`deploying KeepToken stub`)

    await deployments.deploy("KeepToken", {
      contract: "TestToken",
      from: deployer,
      log: true,
    })

    await execute(
      "KeepToken",
      { from: deployer },
      "mint",
      deployer,
      BigNumber.from(10).pow(27)
    )
  }
}

export default func

func.tags = ["KeepToken"]

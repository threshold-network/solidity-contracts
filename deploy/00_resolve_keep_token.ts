import { HardhatRuntimeEnvironment, HardhatNetworkConfig } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { BigNumber } from "ethers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()
  const { execute, read } = deployments

  const KeepToken = await deployments.getOrNull("KeepToken")

  if (KeepToken && helpers.address.isValid(KeepToken.address)) {
    log(`using external KeepToken at ${KeepToken.address}`)
  } else if (
    hre.network.name !== "hardhat" ||
    (hre.network.config as HardhatNetworkConfig).forking.enabled
  ) {
    throw new Error("deployed KeepToken contract not found")
  } else {
    // For deployments on hardhat network we don't have the KeepToken deployed,
    // so wee're deloying a stub contact and minting the KEEP in the amount
    // close to the KEEP supply on the production environment (~1B KEEP).
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

    const keepTotalSupply = await read("KeepToken", "totalSupply")

    log("minted", keepTotalSupply.toString(), "KEEP")
  }
}

export default func

func.tags = ["KeepToken"]

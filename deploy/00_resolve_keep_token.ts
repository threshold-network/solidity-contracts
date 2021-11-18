import { HardhatRuntimeEnvironment, HardhatNetworkConfig } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { from1e18, to1e18 } from "../test/helpers/contract-test-helpers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()
  const { execute, read } = deployments

  const KeepToken = await deployments.getOrNull("KeepToken")

  const KEEP_SUPPLY = to1e18("1000000000") // 1B KEEP

  if (KeepToken && helpers.address.isValid(KeepToken.address)) {
    log(`using external KeepToken at ${KeepToken.address}`)
  } else if (
    hre.network.name !== "hardhat" ||
    (hre.network.config as HardhatNetworkConfig).forking.enabled
  ) {
    throw new Error("deployed KeepToken contract not found")
  } else {
    // For deployments on hardhat network we don't have the KeepToken deployed,
    // so we're deploying a stub contact and minting the KEEP in the amount
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
      KEEP_SUPPLY
    )

    const keepTotalSupply = await read("KeepToken", "totalSupply")

    log(`minted ${from1e18(keepTotalSupply)} KEEP`)
  }
}

export default func

func.tags = ["KeepToken"]

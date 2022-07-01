import { HardhatRuntimeEnvironment, HardhatNetworkConfig } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()
  const { execute, read } = deployments
  const { to1e18, from1e18 } = helpers.number

  const KeepToken = await deployments.getOrNull("KeepToken")

  if (KeepToken && helpers.address.isValid(KeepToken.address)) {
    log(`using existing KeepToken at ${KeepToken.address}`)

    // Save deployment artifact of external contract to include it in the package.
    await deployments.save("KeepToken", KeepToken)
  } else if (
    !hre.network.tags.allowStubs ||
    (hre.network.config as HardhatNetworkConfig)?.forking?.enabled
  ) {
    throw new Error("deployed KeepToken contract not found")
  } else {
    log(`deploying KeepToken stub`)

    // For deployments on hardhat network we don't have the KeepToken deployed,
    // so we're deploying a stub contact and minting the KEEP in the amount
    // close to the KEEP supply on the production environment (~1B KEEP).
    const KEEP_SUPPLY = to1e18("1000000000") // 1B KEEP

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

    log(`minted ${from1e18(await read("KeepToken", "totalSupply"))} KEEP`)
  }
}

export default func

func.tags = ["KeepToken"]

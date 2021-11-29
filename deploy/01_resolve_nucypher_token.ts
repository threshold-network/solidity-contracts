import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { from1e18, to1e18 } from "../test/helpers/contract-test-helpers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()
  const { execute, read } = deployments

  const NuCypherToken = await deployments.getOrNull("NuCypherToken")

  if (
    hre.network.name === "mainnet" &&
    NuCypherToken &&
    helpers.address.isValid(NuCypherToken.address)
  ) {
    log(`using external NuCypherToken at ${NuCypherToken.address}`)
    await deployments.save("NuCypherToken", NuCypherToken)
  } else {
    log(`deploying NuCypherToken stub`)

    const NU_SUPPLY = to1e18("1000000000") // 1B NU
    await deployments.deploy("NuCypherToken", {
      contract: "TestToken",
      from: deployer,
      log: true,
    })

    await execute(
      "NuCypherToken",
      { from: deployer },
      "mint",
      deployer,
      NU_SUPPLY
    )

    log(`minted ${from1e18(await read("NuCypherToken", "totalSupply"))} NU`)
  }
}

export default func

func.tags = ["NuCypherToken"]

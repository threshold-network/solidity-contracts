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

    // To make a testnet deployment that is closer to the real setting we want
    // to mint 1.34B NU tokens. The NuCyppher team deployed the token with a
    // 3.8B supply, but most of it is on escrow in the `StakingEscrow` contract.
    // The actual issued supply to date is around 1.34B, and it will still be
    // around that number when the merge happens.
    const NU_SUPPLY = to1e18("1340000000") // 1.34B NU
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

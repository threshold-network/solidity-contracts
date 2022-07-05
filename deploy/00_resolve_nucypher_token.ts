import type {
  HardhatRuntimeEnvironment,
  HardhatNetworkConfig,
} from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()
  const { execute, read } = deployments
  const { to1e18, from1e18 } = helpers.number

  const NuCypherToken = await deployments.getOrNull("NuCypherToken")

  if (NuCypherToken && helpers.address.isValid(NuCypherToken.address)) {
    log(`using existing NuCypherToken at ${NuCypherToken.address}`)

    // Save deployment artifact of external contract to include it in the package.
    await deployments.save("NuCypherToken", NuCypherToken)
  } else if (
    // TODO: For testnets currently we deploy a stub contract. We should consider
    // switching to an actual contract.
    hre.network.name !== "ropsten" &&
    hre.network.name !== "goerli" &&
    (!hre.network.tags.allowStubs ||
      (hre.network.config as HardhatNetworkConfig)?.forking?.enabled)
  ) {
    throw new Error("deployed NuCypherToken contract not found")
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

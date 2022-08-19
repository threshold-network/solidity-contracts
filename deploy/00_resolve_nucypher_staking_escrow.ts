import type {
  HardhatNetworkConfig,
  HardhatRuntimeEnvironment,
} from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()

  const NuCypherStakingEscrow = await deployments.getOrNull(
    "NuCypherStakingEscrow"
  )

  if (
    NuCypherStakingEscrow &&
    helpers.address.isValid(NuCypherStakingEscrow.address)
  ) {
    log(
      `using existing NuCypherStakingEscrow at ${NuCypherStakingEscrow.address}`
    )

    // Save deployment artifact of external contract to include it in the package.
    await deployments.save("NuCypherStakingEscrow", NuCypherStakingEscrow)
  } else if (
    // TODO: For testnets currently we deploy a stub contract. We should consider
    // switching to an actual contract.
    hre.network.name !== "ropsten" &&
    hre.network.name !== "goerli" &&
    (!hre.network.tags.allowStubs ||
      (hre.network.config as HardhatNetworkConfig)?.forking?.enabled)
  ) {
    throw new Error("deployed NuCypherStakingEscrow contract not found")
  } else {
    log(`deploying NuCypherStakingEscrow stub`)

    await deployments.deploy("NuCypherStakingEscrow", {
      contract: "NuCypherTokenStakingMock",
      from: deployer,
      log: true,
    })
  }
}

export default func

func.tags = ["NuCypherStakingEscrow"]

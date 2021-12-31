import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { to1e18 } = helpers.number

  const NuCypherToken = await deployments.get("NuCypherToken")
  const T = await deployments.get("T")

  const NU_TOKEN_ALLOCATION = "1380688920644254727736959922"

  const T_ALLOCATION_NU = to1e18("4500000000")

  const vendingMachine = await deployments.deploy("VendingMachineNuCypher", {
    contract: "VendingMachine",
    from: deployer,
    args: [
      NuCypherToken.address,
      T.address,
      NU_TOKEN_ALLOCATION,
      T_ALLOCATION_NU,
    ],
    log: true,
  })

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "VendingMachineNuCypher",
      address: vendingMachine.address,
    })
  }
}

export default func

func.tags = ["VendingMachineNuCypher"]
func.dependencies = ["T", "NuCypherToken", "NuCypherStakingEscrow"]

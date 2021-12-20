import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { from1e18, to1e18 } from "../test/helpers/contract-test-helpers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute, read } = deployments

  const VendingMachineKeep = await deployments.get("VendingMachineKeep")
  const VendingMachineNuCypher = await deployments.get("VendingMachineNuCypher")

  const vendinMachines = [
    { tokenSymbol: "KEEP", vendingMachineAddress: VendingMachineKeep.address },
    {
      tokenSymbol: "NU",
      vendingMachineAddress: VendingMachineNuCypher.address,
    },
  ]

  // There will be 10B T minted on the production environment. The 45% of this
  // amount will go to the KEEP holders, 45% will go to NU holders and 10% will
  // be sent to the DAO treasury.
  const T_TO_TRANSFER = to1e18("4500000000") // 4.5B T

  for (const { tokenSymbol, vendingMachineAddress } of vendinMachines) {
    await execute(
      "T",
      { from: deployer },
      "transfer",
      vendingMachineAddress,
      T_TO_TRANSFER
    )

    console.log(
      `transferred ${from1e18(
        T_TO_TRANSFER
      )} T to the VendingMachine for ${tokenSymbol}`
    )
  }
}

export default func

func.tags = ["TransferT"]
func.dependencies = ["VendingMachine"]

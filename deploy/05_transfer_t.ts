import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { execute, read, log } = deployments
  const { from1e18 } = helpers.number

  const VendingMachineNuCypher = await deployments.get("VendingMachineNuCypher")

  const vendingMachines = [
    {
      tokenSymbol: "NU",
      vendingMachineAddress: VendingMachineNuCypher.address,
    },
  ]

  // There will be 10B T minted on the production environment. The 45% of this
  // amount will go to the KEEP holders, 45% will go to NU holders and 10% will
  // be sent to the DAO treasury.
  const T_TO_TRANSFER = BigInt("4500000000000000000000000000") // 4.5B T

  for (const { tokenSymbol, vendingMachineAddress } of vendingMachines) {
    const balance = BigInt(
      (await read("T", "balanceOf", vendingMachineAddress)).toString()
    )
    if (balance >= T_TO_TRANSFER) {
      log(
        `Vending machine for ${tokenSymbol} is already funded; skipping transfer`
      )
      continue
    }

    const needed = T_TO_TRANSFER - balance
    const deployerBalance = BigInt(
      (await read("T", "balanceOf", deployer)).toString()
    )
    if (deployerBalance < needed) {
      throw new Error(
        `Vending machine for ${tokenSymbol} needs ${needed.toString()} T units, but deployer only has ${deployerBalance.toString()}`
      )
    }

    await execute(
      "T",
      { from: deployer },
      "transfer",
      vendingMachineAddress,
      needed.toString()
    )

    console.log(
      `transferred ${from1e18(
        needed.toString()
      )} T to the VendingMachine for ${tokenSymbol}`
    )
  }
}

export default func

func.tags = ["TransferT"]
func.dependencies = ["MintT", "VendingMachineNuCypher"]

import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { from1e18, to1e18 } from "../test/helpers/contract-test-helpers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute, read } = deployments

  const VendingMachine = await deployments.get("VendingMachine")

  // There will be 10B T minted on the production environment. The 45% of this
  // amount will go to the KEEP holders, 45% will go to NU holders and 10% will
  // be sent to the DAO treasury. In this script we're simulating the part
  // related to distribution of T to the VendingMachine for KEEP holders.
  // In the future we'll also have a separate instance of the VendingMachine
  // (for NU holders), to which we'll send the other 45% of T (4.5B T).

  const T_TO_TRANSFER = to1e18("4500000000") // 4.5B T

  await execute(
    "T",
    { from: deployer },
    "transfer",
    VendingMachine.address,
    T_TO_TRANSFER
  )

  console.log(`transfered ${from1e18(T_TO_TRANSFER)} T to the VendingMachine`)

  // TODO: distribute 4.5B T to the VendingMachine for NU holders.
}

export default func

func.tags = ["TransferT"]
func.dependencies = ["VendingMachine"]

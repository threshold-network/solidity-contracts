import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()
  const { to1e18 } = helpers.number

  const KeepToken = await deployments.get("KeepToken")
  const T = await deployments.get("T")

  const KEEP_TOKEN_ALLOCATION = "940795010800000000000000000"

  // We're wrapping 100% of the minted KEEP and will be allocating 45% of the
  // minted T tokens. The remaining T tokens will be in the future distributed
  // between another instance of the VendingMachine (which will be wrapping NU
  // token) and a DAO treasury.
  const T_ALLOCATION_KEEP = to1e18("4500000000")

  const vendingMachine = await deployments.deploy("VendingMachineKeep", {
    contract: "VendingMachine",
    from: deployer,
    args: [
      KeepToken.address,
      T.address,
      KEEP_TOKEN_ALLOCATION,
      T_ALLOCATION_KEEP,
    ],
    log: true,
  })

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "VendingMachineKeep",
      address: vendingMachine.address,
    })
  }
}

export default func

func.tags = ["VendingMachineKeep"]
func.dependencies = ["T", "KeepToken"]

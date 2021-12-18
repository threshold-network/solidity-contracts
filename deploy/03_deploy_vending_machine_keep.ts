import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { read } = deployments

  const KeepToken = await deployments.get("KeepToken")
  const T = await deployments.get("T")

  const keepTotalSupply = await read("KeepToken", "totalSupply")
  const tTotalSupply = await read("T", "totalSupply")

  // We're wrapping 100% of the minted KEEP and will be allocating 45% of the
  // minted T tokens. The remaining T tokens will be in the future distributed
  // between another instance of the VendingMachine (which will be wrapping NU
  // token) and a DAO treasury.
  const T_ALLOCATION_KEEP = tTotalSupply.mul(45).div(100)

  const vendingMachine = await deployments.deploy("VendingMachineKeep", {
    contract: "VendingMachine",
    from: deployer,
    args: [KeepToken.address, T.address, keepTotalSupply, T_ALLOCATION_KEEP],
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

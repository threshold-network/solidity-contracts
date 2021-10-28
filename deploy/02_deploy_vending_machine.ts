import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute } = deployments

  const KeepToken = await deployments.get("KeepToken")
  const T = await deployments.get("T")

  const vendingMachine = await deployments.deploy("VendingMachine", {
    from: deployer,
    args: [KeepToken.address, T.address, 1000000000, 10000000000],
    log: true,
  })

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "VendingMachine",
      address: vendingMachine.address,
    })
  }
}

export default func

func.tags = ["VendingMachine"]
func.dependencies = ["T", "KeepToken"]

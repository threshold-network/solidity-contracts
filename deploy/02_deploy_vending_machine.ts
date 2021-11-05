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

  const vendingMachine = await deployments.deploy("VendingMachine", {
    from: deployer,
    // We're wrapping 100% of the minted KEEP and will be allocating 45% of the
    // minted T tokens. The remaining T tokens will be in the future distributed
    // between another instance of the VendingMachine (which will be wrapping NU
    // token) and a DAO treasury.
    args: [
      KeepToken.address,
      T.address,
      keepTotalSupply,
      tTotalSupply.mul(45).div(100),
    ],
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

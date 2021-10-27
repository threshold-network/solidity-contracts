import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { BigNumber } from "ethers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute } = deployments

  const VendingMachine = await deployments.get("VendingMachine")

  await execute(
    "T",
    { from: deployer },
    "transfer",
    VendingMachine.address,
    BigNumber.from("4500000000000000000000000000")
  )
}

export default func

func.tags = ["TransferT"]
func.dependencies = [
  "VendingMachine",
]

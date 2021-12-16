import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { read } = deployments

  const NuCypherToken = await deployments.get("NuCypherToken")
  const T = await deployments.get("T")

  const tTotalSupply = await read("T", "totalSupply")
  const T_ALLOCATION_NU = tTotalSupply.mul(45).div(100)

  let wrappedTokenAmount = 0
  if (hre.network.name === "mainnet") {
    wrappedTokenAmount = await read(
      "NuCypherStakingEscrow",
      "currentPeriodSupply"
    )
  } else {
    wrappedTokenAmount = await read("NuCypherToken", "totalSupply")
  }

  const vendingMachine = await deployments.deploy("VendingMachineNuCypher", {
    contract: "VendingMachine",
    from: deployer,
    args: [
      NuCypherToken.address,
      T.address,
      wrappedTokenAmount,
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

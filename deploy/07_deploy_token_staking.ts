import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()

  const T = await deployments.get("T")
  const KeepTokenStaking = await deployments.get("KeepTokenStaking")
  const NuCypherStakingEscrow = await deployments.get("NuCypherStakingEscrow")
  const VendingMachineKeep = await deployments.get("VendingMachineKeep")
  const VendingMachineNuCypher = await deployments.get("VendingMachineNuCypher")
  const KeepStake = await deployments.get("KeepStake")

  const TokenStaking = await deployments.deploy("TokenStaking", {
    from: deployer,
    args: [
      T.address,
      KeepTokenStaking.address,
      NuCypherStakingEscrow.address,
      VendingMachineKeep.address,
      VendingMachineNuCypher.address,
      KeepStake.address,
    ],
    log: true,
  })

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "TokenStaking",
      address: TokenStaking.address,
    })
  }
}

export default func

func.tags = ["TokenStaking"]
func.dependencies = [
  "T",
  "KeepTokenStaking",
  "NuCypherStakingEscrow",
  "VendingMachineKeep",
  "VendingMachineNuCypher",
  "KeepStake",
]

import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()

  const KeepTokenStaking = await deployments.get("KeepTokenStaking")

  const KeepStake = await deployments.deploy("KeepStake", {
    from: deployer,
    args: [KeepTokenStaking.address],
    log: true,
  })

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "KeepStake",
      address: KeepStake.address,
    })
  }
}

export default func

func.tags = ["KeepStake"]
func.dependencies = ["KeepTokenStaking"]

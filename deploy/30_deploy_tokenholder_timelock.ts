import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, ethers } = hre
  const { deployer } = await getNamedAccounts()

  const proposers = []
  const executors = [ethers.constants.AddressZero]
  const minDelay = 172800 // 2 days in seconds (2 * 24 * 60 * 60)

  const timelock = await deployments.deploy("TokenholderTimelock", {
    contract: "TimelockController",
    from: deployer,
    args: [minDelay, proposers, executors],
    log: true,
  })

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "TokenholderTimelock",
      address: timelock.address,
    })
  }
}

export default func

func.tags = ["TokenholderTimelock"]

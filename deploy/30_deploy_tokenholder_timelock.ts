import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

// FIXME: As a workaround for a bug in hardhat-gas-reporter #86 we import
// ethers here instead of using the one defined in `hre`.
// #86: https://github.com/cgewecke/hardhat-gas-reporter/issues/86
import { ethers } from "ethers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
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

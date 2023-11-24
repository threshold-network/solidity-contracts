// See deploy/TokenStaking_upgrade_instructions.md

import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

import { ethers, upgrades } from "hardhat"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre
  const { log } = deployments

  const T = await deployments.get("T")
  const VendingMachineNuCypher = await deployments.get("VendingMachineNuCypher")
  const TokenStakingDeployment = await deployments.get("TokenStaking")

  const tokenStakingConstructorArgs = [
    T.address,
    VendingMachineNuCypher.address,
  ]

  if (hre.network.name == "mainnet") {
    const TokenStaking = await ethers.getContractFactory("TokenStaking")

    // @ts-ignore:
    await upgrades.validateUpgrade(
      TokenStakingDeployment.address,
      TokenStaking,
      {
        constructorArgs: tokenStakingConstructorArgs,
      }
    )

    log(`Current TokenStaking implementation is compatible with existing deployment at ${TokenStakingDeployment.address}`)
  }
}

export default func

func.tags = ["ValidateUpgradeTokenStaking"]

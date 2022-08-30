import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

import { ethers, upgrades } from "hardhat"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre
  const { log } = deployments

  const T = await deployments.get("T")
  const KeepTokenStaking = await deployments.get("KeepTokenStaking")
  const NuCypherStakingEscrow = await deployments.get("NuCypherStakingEscrow")
  const VendingMachineKeep = await deployments.get("VendingMachineKeep")
  const VendingMachineNuCypher = await deployments.get("VendingMachineNuCypher")
  const KeepStake = await deployments.get("KeepStake")
  const TokenStakingProxy = await deployments.get("TokenStaking")

  const tokenStakingConstructorArgs = [
    T.address,
    KeepTokenStaking.address,
    NuCypherStakingEscrow.address,
    VendingMachineKeep.address,
    VendingMachineNuCypher.address,
    KeepStake.address,
  ]

  if (hre.network.name == "mainnet") {
    const TokenStaking = await ethers.getContractFactory("TokenStaking")

    const implAddress = await upgrades.prepareUpgrade(
      TokenStakingProxy.address,
      TokenStaking,
      {
        constructorArgs: tokenStakingConstructorArgs,
      }
    )

    log(`Deployed new TokenStaking implementation contract at ${implAddress}`)
    log(`Constructor arguments: ${tokenStakingConstructorArgs}`)

    const implementationInterface = TokenStaking.interface
    let jsonAbi = implementationInterface.format(ethers.utils.FormatTypes.json)

    const tokenStakingDeployment = {
      address: implAddress,
      abi: JSON.parse(jsonAbi as string),
    }
    const fs = require("fs")
    fs.writeFileSync(
      `TokenStaking_implementation_${implAddress}.json`,
      JSON.stringify(tokenStakingDeployment, null, 2),
      "utf8",
      function (err) {
        if (err) {
          console.log(err)
        }
      }
    )

  }
}

export default func

func.tags = ["PrepareUpgradeTokenStaking"]

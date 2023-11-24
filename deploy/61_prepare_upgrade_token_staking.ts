import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

import { ethers, upgrades } from "hardhat"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { log, execute } = deployments

  const T = await deployments.get("T")
  const VendingMachineNuCypher = await deployments.get("VendingMachineNuCypher")
  const TokenStakingProxy = await deployments.get("TokenStaking")

  const tokenStakingConstructorArgs = [
    T.address,
    VendingMachineNuCypher.address,
  ]

  if (hre.network.name == "mainnet") {
    const TokenStaking = await ethers.getContractFactory("TokenStaking")
    const proxyAddress = TokenStakingProxy.address

    const implAddress = await upgrades.prepareUpgrade(
      proxyAddress,
      TokenStaking,
      {
        constructorArgs: tokenStakingConstructorArgs,
        kind: 'transparent',
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

    // initialize implementation
    const { deployer } = await getNamedAccounts()
    await execute(
      "TokenStaking",
      { from: deployer, to: implAddress },
      "initialize"
    )
  }
}

export default func

func.tags = ["PrepareUpgradeTokenStaking"]
func.dependencies = ["ValidateUpgradeTokenStaking"]

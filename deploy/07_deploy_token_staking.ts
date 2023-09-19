import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

import { ethers, upgrades } from "hardhat"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { execute, log } = deployments
  const { deployer } = await getNamedAccounts()

  const T = await deployments.get("T")
  const VendingMachineNuCypher = await deployments.get("VendingMachineNuCypher")

  const tokenStakingConstructorArgs = [
    T.address,
    VendingMachineNuCypher.address,
  ]
  const tokenStakingInitializerArgs = []

  // TODO: Consider upgradable deployment also for goerli/sepolia.
  let tokenStakingAddress
  if (hre.network.name == "mainnet") {
    const TokenStaking = await ethers.getContractFactory("TokenStaking")

    const tokenStaking = await upgrades.deployProxy(
      TokenStaking,
      tokenStakingInitializerArgs,
      {
        constructorArgs: tokenStakingConstructorArgs,
      }
    )
    tokenStakingAddress = tokenStaking.address
    log(`Deployed TokenStaking with TransparentProxy at ${tokenStakingAddress}`)

    const implementationInterface = tokenStaking.interface
    let jsonAbi = implementationInterface.format(ethers.utils.FormatTypes.json)

    const tokenStakingDeployment = {
      address: tokenStakingAddress,
      abi: JSON.parse(jsonAbi as string),
    }
    const fs = require("fs")
    fs.writeFileSync(
      "TokenStaking.json",
      JSON.stringify(tokenStakingDeployment, null, 2),
      "utf8",
      function (err) {
        if (err) {
          console.log(err)
        }
      }
    )
    log(`Saved TokenStaking address and ABI in TokenStaking.json`)
  } else {
    const TokenStaking = await deployments.deploy("TokenStaking", {
      from: deployer,
      args: tokenStakingConstructorArgs,
      log: true,
    })
    tokenStakingAddress = TokenStaking.address

    await execute("TokenStaking", { from: deployer }, "initialize")
    log("Initialized TokenStaking.")
  }

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "TokenStaking",
      address: tokenStakingAddress,
    })
  }
}

export default func

func.tags = ["TokenStaking"]
func.dependencies = ["T", "VendingMachineNuCypher", "MintT"]

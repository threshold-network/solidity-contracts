import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import * as fs from "fs"

import { ethers, upgrades } from "hardhat"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { execute, log } = deployments
  const { deployer } = await getNamedAccounts()

  const T = await deployments.get("T")

  const tokenStakingConstructorArgs = [T.address]
  const tokenStakingInitializerArgs = []

  // TODO: Consider upgradable deployment also for sepolia.
  let tokenStakingAddress
  if (hre.network.name === "mainnet" || hre.network.name === "sepolia") {
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
    const jsonAbi = implementationInterface.format(ethers.utils.FormatTypes.json)

    let parsedAbi: unknown[]
    try {
      parsedAbi = JSON.parse(jsonAbi as string) as unknown[]
    } catch (e) {
      throw new Error(`Failed to parse ABI from contract interface: ${e}`)
    }

    const tokenStakingDeployment = {
      address: tokenStakingAddress,
      abi: parsedAbi,
    }
    const deploymentsDir = `deployments/${hre.network.name}`
    await fs.promises.mkdir(deploymentsDir, { recursive: true })

    await deployments.save("TokenStaking", tokenStakingDeployment)

    await fs.promises.writeFile(
      `${deploymentsDir}/TokenStaking.json`,
      JSON.stringify(tokenStakingDeployment, null, 2),
      "utf8"
    )
    log(`Saved TokenStaking address and ABI in ${deploymentsDir}/TokenStaking.json`)
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

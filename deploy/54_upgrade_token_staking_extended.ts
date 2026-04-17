import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

import { ethers, upgrades } from "hardhat"

/**
 * Upgrades TokenStaking proxy to ExtendedTokenStaking implementation.
 * ExtendedTokenStaking adds the stake() function required for native T staking.
 * The base TokenStaking does not have stake() - it only supports legacy KEEP/NU
 * migrations. Run this on sepolia (or other testnets) where operators need to
 * stake T directly.
 *
 * From `solidity-contracts/` repo root:
 *   npx hardhat deploy --network sepolia --tags UpgradeTokenStaking
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { log } = deployments
  const { deployer } = await getNamedAccounts()

  if (hre.network.name !== "sepolia") {
    log("Skipping TokenStaking upgrade (only for sepolia)")
    return
  }

  let proxyAddress: string
  const existing = await deployments.getOrNull("TokenStaking")
  if (existing) {
    proxyAddress = existing.address
  } else {
    // 07_deploy_token_staking saves to TokenStaking.json in deployments dir
    const fs = require("fs")
    const deploymentPath = `deployments/${hre.network.name}/TokenStaking.json`
    if (!fs.existsSync(deploymentPath)) {
      log("TokenStaking not deployed, skipping upgrade")
      return
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"))
    proxyAddress = deployment.address
  }

  log(`Upgrading TokenStaking at ${proxyAddress} to ExtendedTokenStaking`)

  const T = await deployments.get("T")

  const ExtendedTokenStaking = await ethers.getContractFactory(
    "ExtendedTokenStaking"
  )

  const upgraded = await upgrades.upgradeProxy(
    proxyAddress,
    ExtendedTokenStaking,
    {
      constructorArgs: [T.address],
      kind: "transparent",
    }
  )
  await upgraded.deployed()

  log(`Upgraded TokenStaking to ExtendedTokenStaking at ${upgraded.address}`)

  // Update deployment JSON with new ABI (includes stake)
  const implementationInterface = upgraded.interface
  const jsonAbi = implementationInterface.format(ethers.utils.FormatTypes.json)
  const tokenStakingDeployment = {
    address: upgraded.address,
    abi: JSON.parse(jsonAbi as string),
  }
  const fs = require("fs")
  const deploymentsDir = `deployments/${hre.network.name}`
  fs.writeFileSync(
    `${deploymentsDir}/TokenStaking.json`,
    JSON.stringify(tokenStakingDeployment, null, 2),
    "utf8"
  )
  log(`Updated ${deploymentsDir}/TokenStaking.json with ExtendedTokenStaking ABI`)
}

export default func

func.tags = ["TokenStakingUpgrade", "UpgradeTokenStaking"]
func.dependencies = ["T"]

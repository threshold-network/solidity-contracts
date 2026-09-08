import * as fs from "fs"

import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, ethers, upgrades, artifacts } = hre
  const { execute, read, log } = deployments
  const { deployer } = await getNamedAccounts()

  const T = await deployments.get("T")
  const constructorArgs = [T.address]
  let tokenStaking = await deployments.getOrNull("TokenStaking")

  if (!tokenStaking) {
    // TODO: Consider upgradeable deployment also for sepolia.
    if (hre.network.name === "mainnet") {
      const factory = await ethers.getContractFactory(
        "TokenStaking",
        await ethers.getSigner(deployer)
      )
      const proxy = await upgrades.deployProxy(factory, [], { constructorArgs })
      // getAddress is v6; v5 contracts expose address instead. Everything after
      // this boundary uses a hardhat-deploy Deployment, not an ethers contract.
      const address =
        typeof proxy.getAddress === "function"
          ? await proxy.getAddress()
          : proxy.address
      const transaction =
        typeof proxy.deploymentTransaction === "function"
          ? proxy.deploymentTransaction()
          : proxy.deployTransaction
      await transaction.wait()
      tokenStaking = {
        address,
        abi: (await artifacts.readArtifact("TokenStaking")).abi,
        implementation: await upgrades.erc1967.getImplementationAddress(
          address
        ),
      }
      await deployments.save("TokenStaking", tokenStaking)
      // Preserve the standalone mainnet export used by deployment operators.
      fs.writeFileSync(
        "TokenStaking.json",
        JSON.stringify(tokenStaking, null, 2)
      )
      log(`Deployed TokenStaking with TransparentProxy at ${address}`)
    } else {
      tokenStaking = await deployments.deploy("TokenStaking", {
        from: deployer,
        args: constructorArgs,
        log: true,
      })
    }
  }

  // initialize() sets governance. Checking that state also resumes an interrupted
  // direct deployment whose record was saved before initialization completed.
  if (
    (await read("TokenStaking", "governance")) ===
    "0x0000000000000000000000000000000000000000"
  ) {
    await execute("TokenStaking", { from: deployer }, "initialize")
    log("Initialized TokenStaking.")
  } else {
    log("TokenStaking is already initialized; skipping initialize")
  }

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "TokenStaking",
      address: tokenStaking.address,
    })
  }
}

export default func

func.tags = ["TokenStaking"]
func.dependencies = ["T", "VendingMachineNuCypher", "MintT"]

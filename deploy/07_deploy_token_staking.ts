import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, ethers, upgrades, artifacts } = hre
  const { execute, read, log } = deployments
  const { deployer } = await getNamedAccounts()
  const T = await deployments.get("T")
  const useProxy =
    hre.network.name === "mainnet" || hre.network.name === "sepolia"
  let tokenStaking = await deployments.getOrNull("TokenStaking")

  if (useProxy && tokenStaking) {
    if ((await ethers.provider.getCode(tokenStaking.address)) === "0x") {
      throw new Error(
        "Recorded TokenStaking has no code; reconcile the deployment before continuing"
      )
    }
    log(`Reusing TokenStaking at ${tokenStaking.address}`)
  } else if (useProxy) {
    const factory = await ethers.getContractFactory(
      "TokenStaking",
      await ethers.getSigner(deployer)
    )
    const proxy = await upgrades.deployProxy(factory, [], {
      constructorArgs: [T.address],
      kind: "transparent",
    })
    await proxy.deployed()
    tokenStaking = {
      address: proxy.address,
      abi: (await artifacts.readArtifact("TokenStaking")).abi,
      implementation: await upgrades.erc1967.getImplementationAddress(
        proxy.address
      ),
    }
    await deployments.save("TokenStaking", tokenStaking)
    log(
      `Deployed TokenStaking with TransparentProxy at ${tokenStaking.address}`
    )
  } else {
    tokenStaking = await deployments.deploy("TokenStaking", {
      from: deployer,
      args: [T.address],
      log: true,
    })
  }

  // Preserve existing initialized proxies and recover interrupted direct deployments.
  if (
    (await read("TokenStaking", "governance")) === ethers.constants.AddressZero
  ) {
    await execute("TokenStaking", { from: deployer }, "initialize")
    log("Initialized TokenStaking.")
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

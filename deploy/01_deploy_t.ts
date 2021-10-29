import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { BigNumber } from "ethers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute, read, log } = deployments

  const T = await deployments.deploy("T", {
    from: deployer,
    log: true,
  })

  // We're minting 10B T, which is the value of the T supply on the production
  // environment.

  await execute(
    "T",
    { from: deployer },
    "mint",
    deployer,
    BigNumber.from(10).pow(28)
  )

  const tTotalSupply = await read("T", "totalSupply")

  log("minted", tTotalSupply.toString(), "T")

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "T",
      address: T.address,
    })
  }
}

export default func

func.tags = ["T"]

import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { BigNumber } from "ethers"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { execute } = deployments

  const T = await deployments.deploy("T", {
    from: deployer,
    log: true,
  })

  await execute(
    "T",
    { from: deployer },
    "mint",
    deployer,
    BigNumber.from("10000000000000000000000000000")
  )

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "T",
      address: T.address,
    })
  }
}

export default func

func.tags = ["T"]

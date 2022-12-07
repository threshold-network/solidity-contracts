import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer } = await getNamedAccounts()

  const T = await deployments.deploy("T", {
    from: deployer,
    log: true,
  })

  if (hre.network.tags.etherscan) {
    await hre.ethers.provider.waitForTransaction(T.transactionHash, 5, 300000)
    await helpers.etherscan.verify(T)
  }

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "T",
      address: T.address,
    })
  }
}

export default func

func.tags = ["T"]

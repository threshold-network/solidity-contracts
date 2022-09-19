import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, helpers } = hre
  const { deployer, thresholdCouncil } = await getNamedAccounts()

  // TODO: fail if thresholdCouncil is undefined on mainnet
  let vetoer = thresholdCouncil ?? deployer

  const T = await deployments.get("T")
  const TokenStaking = await deployments.get("TokenStaking")
  const TokenholderTimelock = await deployments.get("TokenholderTimelock")

  const timelock = await deployments.deploy("TokenholderGovernor", {
    from: deployer,
    args: [
      T.address,
      TokenStaking.address,
      TokenholderTimelock.address,
      vetoer,
    ],
    log: true,
  })

  if (hre.network.tags.etherscan) {
    await helpers.etherscan.verify(
      timelock,
      "contracts/governance/TokenholderGovernor.sol:TokenholderGovernor"
    )
  }

  if (hre.network.tags.tenderly) {
    await hre.tenderly.verify({
      name: "TokenholderGovernor",
      address: timelock.address,
    })
  }
}

export default func

func.tags = ["TokenholderGovernor"]
func.dependencies = ["TokenStaking"]

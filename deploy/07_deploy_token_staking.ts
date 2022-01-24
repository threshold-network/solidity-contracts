import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"



import { //run, 
  ethers
} from "hardhat"

const { upgrades } = require("hardhat");

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments} = hre
  const { deployer } = await getNamedAccounts()

  const T = await deployments.get("T")
  const KeepTokenStaking = await deployments.get("KeepTokenStaking")
  const NuCypherStakingEscrow = await deployments.get("NuCypherStakingEscrow")
  const VendingMachineKeep = await deployments.get("VendingMachineKeep")
  const VendingMachineNuCypher = await deployments.get("VendingMachineNuCypher")
  const KeepStake = await deployments.get("KeepStake")

  const tokenStakingConstructorArgs = [
    T.address,
    KeepTokenStaking.address,
    NuCypherStakingEscrow.address,
    VendingMachineKeep.address,
    VendingMachineNuCypher.address,
    KeepStake.address,
  ]
  const tokenStakingInitializerArgs = []

  // const TokenStaking = await deployments.deploy("TokenStaking", {
  //   from: deployer,
  //   args: [
  //     T.address,
  //     KeepTokenStaking.address,
  //     NuCypherStakingEscrow.address,
  //     VendingMachineKeep.address,
  //     VendingMachineNuCypher.address,
  //     KeepStake.address,
  //   ],
  //   log: true,
  // })

  const TokenStaking = await ethers.getContractFactory("TokenStaking")

  const tokenStaking = await upgrades.deployProxy(
    TokenStaking,
    tokenStakingInitializerArgs,
    {
      constructorArgs: tokenStakingConstructorArgs,
    }
  )

  // if (hre.network.tags.tenderly) {
  //   await hre.tenderly.verify({
  //     name: "TokenStaking",
  //     address: TokenStaking.address,
  //   })
  // }
}

export default func

func.tags = ["TokenStaking"]
func.dependencies = [
  "T",
  "KeepTokenStaking",
  "NuCypherStakingEscrow",
  "VendingMachineKeep",
  "VendingMachineNuCypher",
  "KeepStake",
  "MintT",
]

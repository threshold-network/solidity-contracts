import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

interface VendingMachineDeploymentOptions {
  tokenArtifactName: string
  vendingMachineArtifactName: string
}

type VendingMachineTypes = "KEEP" | "NU"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deployer } = await getNamedAccounts()
  const { read } = deployments

  const T = await deployments.get("T")
  const tTotalSupply = await read("T", "totalSupply")

  // We're wrapping 100% of the minted KEEP and will be allocating 45% of the
  // minted T tokens. The remaining T tokens will be in the future distributed
  // between another instance of the VendingMachine (which will be wrapping NU
  // token) and a DAO treasury.
  const T_VENDING_MACHINE_ALLOCATION = tTotalSupply.mul(45).div(100)

  const VENDING_MACHINE_OPTIONS: Record<
    VendingMachineTypes,
    VendingMachineDeploymentOptions
  > = {
    KEEP: {
      tokenArtifactName: "KeepToken",
      vendingMachineArtifactName: "VendingMachineKeep",
    },
    NU: {
      tokenArtifactName: "NuCypherToken",
      vendingMachineArtifactName: "VendingMachineNuCypher",
    },
  }

  const deployVendingMachine = async function (
    options: VendingMachineDeploymentOptions
  ) {
    const { tokenArtifactName, vendingMachineArtifactName } = options
    const Token = await deployments.get(tokenArtifactName)
    const totalSupply = await read(tokenArtifactName, "totalSupply")
    const vendingMachine = await deployments.deploy(
      vendingMachineArtifactName,
      {
        contract: "VendingMachine",
        from: deployer,
        args: [
          Token.address,
          T.address,
          totalSupply,
          T_VENDING_MACHINE_ALLOCATION,
        ],
        log: true,
      }
    )

    if (hre.network.tags.tenderly) {
      await hre.tenderly.verify({
        name: vendingMachineArtifactName,
        address: vendingMachine.address,
      })
    }
  }

  await deployVendingMachine(VENDING_MACHINE_OPTIONS.KEEP)
  await deployVendingMachine(VENDING_MACHINE_OPTIONS.NU)
}

export default func

func.tags = ["VendingMachine"]
func.dependencies = ["T", "KeepToken", "NuCypherToken"]

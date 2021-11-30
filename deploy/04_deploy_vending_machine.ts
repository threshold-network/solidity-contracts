import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"

abstract class TVendingMachineDeployer {
  protected hre: HardhatRuntimeEnvironment
  protected wrappedTokenArtifactName: string
  protected vendingMachineArtifactName: string

  constructor(
    _hre: HardhatRuntimeEnvironment,
    _wrappedTokenArtifactName: string,
    _vendingMachineArtifactName: string
  ) {
    this.hre = _hre
    this.wrappedTokenArtifactName = _wrappedTokenArtifactName
    this.vendingMachineArtifactName = _vendingMachineArtifactName
  }

  abstract getWrappedTokenAllocation(): Promise<string>

  async getWrappedTokenAddress(): Promise<string> {
    const { deployments } = this.hre
    const Token = await deployments.get(this.wrappedTokenArtifactName)
    return Token.address
  }

  async getTTokenAddress(): Promise<string> {
    const { deployments } = this.hre
    const T = await deployments.get("T")
    return T.address
  }

  async getTTokenAllocation(): Promise<string> {
    const {
      deployments: { read },
    } = this.hre

    const tTotalSupply = await read("T", "totalSupply")
    return tTotalSupply.mul(45).div(100).toString()
  }

  async deploy(): Promise<void> {
    const { deployments, getNamedAccounts } = this.hre
    const { deployer } = await getNamedAccounts()

    const vendingMachine = await deployments.deploy(
      this.vendingMachineArtifactName,
      {
        contract: "VendingMachine",
        from: deployer,
        args: [
          await this.getWrappedTokenAddress(),
          await this.getTTokenAddress(),
          await this.getWrappedTokenAllocation(),
          await this.getTTokenAllocation(),
        ],
        log: true,
      }
    )

    if (this.hre.network.tags.tenderly) {
      await this.hre.tenderly.verify({
        name: this.vendingMachineArtifactName,
        address: vendingMachine.address,
      })
    }
  }
}

class TVendingMachineDeployerKEEP extends TVendingMachineDeployer {
  constructor(hre: HardhatRuntimeEnvironment) {
    super(hre, "KeepToken", "VendingMachineKeep")
  }

  async getWrappedTokenAllocation(): Promise<string> {
    const {
      deployments: { read },
    } = this.hre
    const totalSupply = await read(this.wrappedTokenArtifactName, "totalSupply")
    return totalSupply.toString()
  }
}

class TVendingMachineDeployerNU extends TVendingMachineDeployer {
  constructor(hre: HardhatRuntimeEnvironment) {
    super(hre, "NuCypherToken", "VendingMachineNuCypher")
  }

  async getWrappedTokenAllocation(): Promise<string> {
    const { deployments } = this.hre
    const { read } = deployments
    if (this.hre.network.name === "mainnet") {
      const currentPeriodSupply = await read(
        "NuCypherStakingEscrow",
        "currentPeriodSupply"
      )
      return currentPeriodSupply.toString()
    }

    const totalSupply = await read(this.wrappedTokenArtifactName, "totalSupply")
    return totalSupply.toString()
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const vendingMachineDeployers: TVendingMachineDeployer[] = [
    new TVendingMachineDeployerKEEP(hre),
    new TVendingMachineDeployerNU(hre),
  ]

  for (const vendingMachineDeployer of vendingMachineDeployers) {
    await vendingMachineDeployer.deploy()
  }
}

export default func

func.tags = ["VendingMachine"]
func.dependencies = ["T", "KeepToken", "NuCypherToken"]

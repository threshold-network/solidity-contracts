import { expect } from "chai"
import hre from "hardhat"
import { verificationContracts } from "../tasks/verify-deployments"
import { Etherscan } from "@nomicfoundation/hardhat-verify/etherscan"
import type { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types"
import type { Deployment } from "hardhat-deploy/types"
import tDeployment from "../deployments/mainnet/T.json"
import vendingDeployment from "../deployments/mainnet/VendingMachineNuCypher.json"
import timelockDeployment from "../deployments/mainnet/TokenholderTimelock.json"
import governorDeployment from "../deployments/mainnet/TokenholderGovernor.json"

type VerificationDeployment = Pick<
  Deployment,
  "address" | "abi" | "args" | "libraries"
>

type VerificationContext = {
  network: { name: string }
  deployments: { get: (name: string) => Promise<VerificationDeployment> }
  run: (task: string, args: TaskArguments) => Promise<unknown>
}

const successfulResponse = (
  message: string
): Awaited<ReturnType<Etherscan["verify"]>> => ({
  status: 1,
  message,
  isPending: () => false,
  isFailure: () => false,
  isSuccess: () => true,
  isBytecodeMissingInNetworkError: () => false,
  isAlreadyVerified: () => false,
  isOk: () => true,
})

describe("deployment verification", () => {
  // The fixture supplies only the HRE members consumed by this task. Keep the
  // framework-boundary assertion here; fixture state below remains typed.
  const action = (args: { names: string[] }, context: VerificationContext) =>
    hre.tasks["verify-deployments"].action(
      args,
      context as HardhatRuntimeEnvironment,
      Object.assign(async () => undefined, { isDefined: false })
    )
  const names = Object.keys(verificationContracts)
  let requests: { task: string; args: TaskArguments }[]
  let records: Record<string, VerificationDeployment>
  let context: VerificationContext

  beforeEach(() => {
    requests = []
    // Committed records exercise the real aliases, nested constructor arrays,
    // large allocation amounts, and legacy governance constructor arguments.
    records = {
      T: tDeployment,
      VendingMachineNuCypher: vendingDeployment,
      TokenholderTimelock: timelockDeployment,
      TokenholderGovernor: governorDeployment,
    }
    context = {
      network: { name: "sepolia" },
      deployments: {
        get: async (name) => {
          if (!records[name])
            throw new Error(`No deployment found for: ${name}`)
          return records[name]
        },
      },
      run: async (task, args) => requests.push({ task, args }),
    }
  })

  it("verifies maintained records with their exact constructor arguments", async () => {
    await action({ names }, context)
    expect(requests).to.have.length(4)
    for (const [index, name] of names.entries()) {
      expect(requests[index]).to.deep.equal({
        task: "verify:verify",
        args: {
          address: records[name].address,
          constructorArguments: records[name].args,
          libraries: records[name].libraries || {},
          contract: verificationContracts[name],
        },
      })
      await hre.artifacts.readArtifact(verificationContracts[name])
    }
  })

  it("supports selecting one deployment and preserves linked libraries", async () => {
    context.network.name = "mainnet"
    records.T = Object.assign({}, records.T, {
      libraries: { Library: records.T.address },
    })
    await action({ names: ["T"] }, context)
    expect(requests).to.have.length(1)
    expect(requests[0].args.libraries).to.deep.equal(records.T.libraries)
  })

  it("does not verify retired staking, its proxy, or external contracts", async () => {
    for (const name of ["TokenStaking", "TokenStakingProxy", "NuCypherToken"]) {
      await expect(action({ names: ["T", name] }, context)).to.be.rejectedWith(
        `Unsupported verification deployment: ${name}`
      )
    }
    expect(requests).to.have.length(0)
  })

  it("fails before submitting anything if a requested deployment is missing", async () => {
    delete records.TokenholderGovernor
    await expect(action({ names }, context)).to.be.rejectedWith(
      "No deployment found for: TokenholderGovernor"
    )
    expect(requests).to.have.length(0)
  })

  it("rejects missing constructor metadata instead of guessing empty arguments", async () => {
    records.TokenholderTimelock = Object.assign(
      {},
      records.TokenholderTimelock,
      {
        args: undefined,
      }
    )
    await expect(action({ names }, context)).to.be.rejectedWith(
      "Missing constructor arguments for TokenholderTimelock"
    )
    expect(requests).to.have.length(0)
  })

  it("propagates explorer failures to CI", async () => {
    context.run = async () => {
      throw new Error("Explorer rejected the source")
    }
    await expect(action({ names: ["T"] }, context)).to.be.rejectedWith(
      "Explorer rejected the source"
    )
  })

  it("rejects local networks", async () => {
    context.network.name = "hardhat"
    await expect(action({ names }, context)).to.be.rejectedWith(
      "Verification is supported on mainnet and sepolia"
    )
    expect(requests).to.have.length(0)
  })

  it("matches fresh deployments through the real plugin and skips verified replays", async () => {
    await hre.deployments.fixture()
    const [deployer] = await hre.ethers.getSigners()
    const nonce = await deployer.getTransactionCount()
    const originalConfig = hre.config.etherscan
    const originalMethods = {
      isVerified: Etherscan.prototype.isVerified,
      verify: Etherscan.prototype.verify,
      getVerificationStatus: Etherscan.prototype.getVerificationStatus,
    }
    const submissions: Parameters<Etherscan["verify"]>[] = []
    const verified = new Set<string>()
    try {
      hre.config.etherscan = Object.assign({}, originalConfig, {
        apiKey: "local-test-key",
        customChains: [
          {
            network: "hardhat",
            chainId: 31337,
            urls: {
              apiURL: "https://api.etherscan.io/v2/api",
              browserURL: "https://sepolia.etherscan.io",
            },
          },
        ],
      })
      // Stub only the explorer boundary. Bytecode matching, source selection,
      // constructor encoding, and task dispatch use the installed plugin.
      Etherscan.prototype.isVerified = async (address) => verified.has(address)
      Etherscan.prototype.verify = async function (...args) {
        expect(this.apiUrl).to.equal("https://api.etherscan.io/v2/api")
        submissions.push(args)
        return successfulResponse(args[0])
      }
      Etherscan.prototype.getVerificationStatus = async (address) => {
        verified.add(address)
        return successfulResponse(address)
      }
      context.deployments = hre.deployments
      context.run = hre.run
      await action({ names }, context)
      expect(submissions).to.have.length(4)
      for (const [index, name] of names.entries()) {
        const deployment = await hre.deployments.get(name)
        const [address, source, contract, compiler, args] = submissions[index]
        expect(address).to.equal(deployment.address)
        expect(contract).to.equal(verificationContracts[name])
        expect(compiler).to.equal("v0.8.9+commit.e5eed63a")
        expect(JSON.parse(source).language).to.equal("Solidity")
        expect(args).to.equal(
          new hre.ethers.utils.Interface(deployment.abi)
            .encodeDeploy(deployment.args)
            .slice(2)
        )
      }
      await action({ names }, context)
      expect(submissions).to.have.length(4)
      expect(await deployer.getTransactionCount()).to.equal(nonce)
    } finally {
      hre.config.etherscan = originalConfig
      Object.assign(Etherscan.prototype, originalMethods)
    }
  })
})

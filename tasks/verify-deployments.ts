import { task } from "hardhat/config"

// Contracts still deployed by this repository. TokenStaking and its proxy are
// retired on mainnet; external NU contracts and local stubs are not ours to verify.
export const verificationContracts: Record<string, string> = {
  T: "contracts/token/T.sol:T",
  VendingMachineNuCypher: "contracts/vending/VendingMachine.sol:VendingMachine",
  TokenholderTimelock:
    "@openzeppelin/contracts/governance/TimelockController.sol:TimelockController",
  TokenholderGovernor:
    "contracts/governance/TokenholderGovernor.sol:TokenholderGovernor",
}

task("verify-deployments", "Verify maintained deployments on Etherscan")
  .addOptionalVariadicPositionalParam(
    "names",
    "Deployment names to verify (defaults to all maintained contracts)",
    Object.keys(verificationContracts)
  )
  .setAction(async ({ names }: { names: string[] }, hre) => {
    if (!["mainnet", "sepolia"].includes(hre.network.name)) {
      throw new Error("Verification is supported on mainnet and sepolia")
    }

    // Resolve the entire request first, before making any explorer submissions.
    const requests = await Promise.all(
      names.map(async (name) => {
        if (
          !Object.prototype.hasOwnProperty.call(verificationContracts, name)
        ) {
          throw new Error(`Unsupported verification deployment: ${name}`)
        }
        const deployment = await hre.deployments.get(name)
        if (!Array.isArray(deployment.args)) {
          throw new Error(`Missing constructor arguments for ${name}`)
        }
        return {
          name,
          address: deployment.address,
          constructorArguments: deployment.args,
          libraries: deployment.libraries || {},
          contract: verificationContracts[name],
        }
      })
    )

    for (const { name, ...request } of requests) {
      console.log(`Verifying ${name} at ${request.address}`)
      // The supported plugin handles already-verified contracts. Other failures
      // propagate to the CLI/CI; never turn a rejected submission into success.
      await hre.run("verify:verify", request)
    }
  })

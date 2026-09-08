import { promises as fs } from "fs"
import { createRequire } from "module"
import * as path from "path"
import { isDeepStrictEqual } from "util"
import type {
  Artifact,
  BuildInfo,
  HardhatRuntimeEnvironment,
} from "hardhat/types"

function matchesArtifact(buildInfo: BuildInfo, artifact: Artifact): boolean {
  const compiled =
    buildInfo.output.contracts[artifact.sourceName]?.[artifact.contractName]
  const normalize = (bytecode: string) =>
    bytecode.replace(/^0x/, "").toLowerCase()
  return (
    compiled !== undefined &&
    normalize(compiled.evm.bytecode.object) === normalize(artifact.bytecode) &&
    isDeepStrictEqual(compiled.abi, artifact.abi)
  )
}

async function stakingBuildInfo(
  hre: HardhatRuntimeEnvironment,
  artifact: Artifact
): Promise<BuildInfo> {
  const name = `${artifact.sourceName}:${artifact.contractName}`
  const local = await hre.artifacts.getBuildInfo(name)
  if (local && matchesArtifact(local, artifact)) return local

  // The helper is published as both scripts/*.ts and export/scripts/*.js.
  for (const directory of [
    path.resolve(__dirname, "../staking-build-info"),
    path.resolve(__dirname, "../export/staking-build-info"),
  ]) {
    let filenames: string[]
    try {
      filenames = await fs.readdir(directory)
    } catch (error) {
      if (error.code === "ENOENT") continue
      throw error
    }
    for (const filename of filenames.filter((file) => file.endsWith(".json"))) {
      const buildInfo: BuildInfo = JSON.parse(
        await fs.readFile(path.join(directory, filename), "utf8")
      )
      if (matchesArtifact(buildInfo, artifact)) return buildInfo
    }
  }
  throw new Error(
    `Missing matching compiler build info for ${name}; run prepack and retain export/staking-build-info with the package`
  )
}

export async function stakingContractFactory(
  hre: HardhatRuntimeEnvironment,
  name: "TokenStaking" | "SepoliaTokenStaking",
  deployer: string
) {
  // hardhat-deploy selects the package's artifacts while running external deploys.
  const artifact = await hre.deployments.getArtifact(name)
  const buildInfo = await stakingBuildInfo(hre, artifact)

  // Regenerate using the consuming project's plugin. Its validation cache format
  // can differ from the version used to compile and publish this package.
  const loadPlugin = createRequire(
    require.resolve("@openzeppelin/hardhat-upgrades", {
      paths: [hre.config.paths.root],
    })
  )
  const core = loadPlugin("@openzeppelin/upgrades-core")
  const { writeValidations } = loadPlugin("./utils/validations")
  const validations = core.validate(
    buildInfo.output,
    core.solcInputOutputDecoder(buildInfo.input, buildInfo.output),
    buildInfo.solcVersion,
    buildInfo.input
  )
  await writeValidations(hre, validations)
  const factory = await hre.ethers.getContractFactory(
    artifact.abi,
    artifact.bytecode,
    await hre.ethers.getSigner(deployer)
  )
  return { artifact, factory }
}

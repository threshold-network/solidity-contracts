const { artifacts } = require("hardhat")
const fs = require("fs")
const path = require("path")

async function main() {
  const builds = new Map()
  for (const name of ["TokenStaking", "SepoliaTokenStaking"]) {
    const artifact = await artifacts.readArtifact(name)
    const build = await artifacts.getBuildInfo(
      `${artifact.sourceName}:${artifact.contractName}`
    )
    if (!build) throw new Error(`Missing compiler build info for ${name}`)
    builds.set(build.id, build)
  }
  const destination = path.resolve(__dirname, "../export/staking-build-info")
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  for (const [id, build] of builds) {
    fs.writeFileSync(
      path.join(destination, `${id}.json`),
      JSON.stringify(build)
    )
  }
  console.log(
    `Exported ${builds.size} staking compiler build(s) for upgrade validation`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

/**
 * Upgrades the TokenStaking proxy to ExtendedTokenStaking (adds stake()).
 * Run: npx hardhat run scripts/upgrade-token-staking.ts --network sepolia
 *
 * Requires:
 * - TokenStaking already deployed (proxy exists)
 * - .env with CHAIN_API_URL and CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY (or ACCOUNTS_PRIVATE_KEYS)
 */
import { ethers, upgrades } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const network = process.env.HARDHAT_NETWORK || "sepolia"
  const deploymentsPath = path.join(
    __dirname,
    "..",
    "deployments",
    network
  )
  const tokenStakingPath = path.join(
    deploymentsPath,
    "TokenStaking.json"
  )

  let proxyAddress: string
  let tAddress: string
  if (fs.existsSync(tokenStakingPath)) {
    const deployment = JSON.parse(
      fs.readFileSync(tokenStakingPath, "utf8")
    )
    proxyAddress = deployment.address
    console.log(`Using TokenStaking proxy from deployments: ${proxyAddress}`)
  } else {
    throw new Error(
      `TokenStaking.json not found at ${tokenStakingPath}. Deploy TokenStaking first.`
    )
  }

  const tPath = path.join(deploymentsPath, "T.json")
  if (fs.existsSync(tPath)) {
    const tDeployment = JSON.parse(fs.readFileSync(tPath, "utf8"))
    tAddress = tDeployment.address
    console.log(`Using T from deployments: ${tAddress}`)
  } else {
    throw new Error(
      `T.json not found at ${tPath}. Deploy T first.`
    )
  }

  const ExtendedTokenStaking = await ethers.getContractFactory(
    "ExtendedTokenStaking"
  )
  const upgraded = await upgrades.upgradeProxy(
    proxyAddress,
    ExtendedTokenStaking,
    {
      constructorArgs: [tAddress],
      kind: "transparent",
    }
  )
  await upgraded.deployed()
  console.log(`TokenStaking upgraded to ExtendedTokenStaking at ${upgraded.address}`)

  // Update deployment JSON with new ABI (implementation has new methods)
  const implementationInterface = upgraded.interface
  const jsonAbi = implementationInterface.format(
    ethers.utils.FormatTypes.json
  )
  const tokenStakingDeployment = {
    address: upgraded.address,
    abi: JSON.parse(jsonAbi as string),
  }
  fs.writeFileSync(
    tokenStakingPath,
    JSON.stringify(tokenStakingDeployment, null, 2),
    "utf8"
  )
  console.log(`Updated ${tokenStakingPath} with new ABI`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

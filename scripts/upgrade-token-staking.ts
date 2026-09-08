/**
 * Upgrade the existing Sepolia TokenStaking proxy and refresh its deployment ABI.
 * Run: yarn upgrade:token-staking --network sepolia
 */
import * as hre from "hardhat"
import upgradeTokenStaking from "../deploy/54_upgrade_token_staking_extended"

upgradeTokenStaking(hre).catch((error) => {
  console.error(error)
  process.exitCode = 1
})

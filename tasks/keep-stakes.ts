import { task } from "hardhat/config"
import { HardhatRuntimeEnvironment } from "hardhat/types"

const KEEP_STAKE_TYPE = 1
const TOKEN_STAKING_DEPLOYMENT_BLOCK = 14113768
const TOKEN_STAKING_MAINNET_ADDRESS =
  "0x01b67b1194c75264d06f808a921228a95c765dd7"

task(
  "keep-stakes",
  "Returns all legacy KEEP stakes in Threshold network."
).setAction(async (args, hre: HardhatRuntimeEnvironment) => {
  const { ethers } = hre

  const TokenStaking = await ethers.getContractFactory("TokenStaking")

  const tokenStakingContract = await TokenStaking.attach(
    TOKEN_STAKING_MAINNET_ADDRESS
  )

  const filter = tokenStakingContract.filters.Staked(KEEP_STAKE_TYPE)

  const stakedEvents = await tokenStakingContract.queryFilter(
    filter,
    TOKEN_STAKING_DEPLOYMENT_BLOCK
  )

  const stakingProviders = stakedEvents.map(
    (event) => event.args.stakingProvider
  ) as string[]

  const keepStakes: {
    stakingProvider: string
    authorizer: string
    owner: string
    beneficiary: string
    keepInTStake: string
    totaStakeInT: string
  }[] = []

  for (const stakingProvider of stakingProviders) {
    const stakes = await tokenStakingContract.stakes(stakingProvider)
    const rolesOf = (await tokenStakingContract.rolesOf(stakingProvider)) as {
      authorizer: string
      owner: string
      beneficiary: string
    }

    keepStakes.push({
      stakingProvider,
      ...rolesOf,
      keepInTStake: stakes.keepInTStake.toString(),
      totaStakeInT: stakes.keepInTStake
        .add(stakes.tStake)
        .add(stakes.nuInTStake)
        .toString(),
    })
  }

  console.log(`Total: ${keepStakes.length}`)
  console.table(keepStakes, [
    "stakingProvider",
    "owner",
    "keepInTStake",
    "totaStakeInT",
  ])
})

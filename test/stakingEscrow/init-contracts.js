const {
  tTokenAddress,
  nuCypherTokenAddress,
  keepTokenStakingAddress,
  nuCypherStakingEscrowAddress,
  nuCypherWorkLockAddress,
  keepVendingMachineAddress,
  nuCypherVendingMachineAddress
} = require ("./constants")

async function initContracts() {
  const tToken = await resolveTToken()
  const nuCypherToken = await resolveNuCypherToken()
  const keepTokenStaking = await resolveKeepTokenStaking()
  const nuCypherStakingEscrow = await resolveNuCypherStakingEscrow()
  const nuCypherWorkLock = await resolveNuCypherWorkLock()
  const keepVendingMachine = await resolveKeepVendingMachine()
  const nuCypherVendingMachine = await resolveNuCypherVendingMachine()

  const keepStake = await deployKeepStake(keepTokenStaking)

  const tokenStaking = await deployTokenStaking(
    tToken,
    keepTokenStaking,
    nuCypherStakingEscrow,
    keepVendingMachine,
    nuCypherVendingMachine,
    keepStake
  )

  const stakingEscrowImplementation = await deployStakingEscrowImplementation(
    nuCypherToken,
    nuCypherWorkLock,
    tokenStaking
  )

  return {
    nuCypherStakingEscrow: nuCypherStakingEscrow,
    stakingEscrowImplementation: stakingEscrowImplementation,
  }
}

async function resolveTToken() {
  return await ethers.getContractAt("T", tTokenAddress)
}

async function resolveNuCypherToken() {
  return await ethers.getContractAt("NuCypherToken", nuCypherTokenAddress)
}

async function resolveKeepTokenStaking() {
  return await ethers.getContractAt(
    "ITestKeepTokenStaking",
    keepTokenStakingAddress
  )
}

async function resolveNuCypherStakingEscrow() {
  return await ethers.getContractAt(
    "INuCypherStakingEscrow",
    nuCypherStakingEscrowAddress
  )
}

async function resolveNuCypherWorkLock() {
  return await ethers.getContractAt(
    "WorkLock",
    nuCypherWorkLockAddress
  )
}

async function resolveKeepVendingMachine() {
  return await ethers.getContractAt(
    "VendingMachine",
    keepVendingMachineAddress
  )
}

async function resolveNuCypherVendingMachine() {
  return await ethers.getContractAt(
    "VendingMachine",
    nuCypherVendingMachineAddress
  )
}

async function deployKeepStake(keepTokenStaking) {
  const KeepStake = await ethers.getContractFactory("KeepStake")
  const keepStake = await KeepStake.deploy(keepTokenStaking.address)

  await keepStake.deployed()

  return keepStake
}

async function deployTokenStaking(
  tToken,
  keepTokenStaking,
  nuCypherStakingEscrow,
  keepVendingMachine,
  nuCypherVendingMachine,
  keepStake
) {
  const TokenStaking = await ethers.getContractFactory("TokenStaking")
  const tokenStaking = await TokenStaking.deploy(
    tToken.address,
    keepTokenStaking.address,
    nuCypherStakingEscrow.address,
    keepVendingMachine.address,
    nuCypherVendingMachine.address,
    keepStake.address
  )

  await tokenStaking.deployed()

  return tokenStaking
}

async function deployStakingEscrowImplementation(
  nuToken,
  nuCypherWorkLock,
  tokenStaking
) {
  const StakingEscrow = await ethers.getContractFactory("StakingEscrow")
  const stakingEscrow = await StakingEscrow.deploy(
    nuToken.address,
    nuCypherWorkLock.address,
    tokenStaking.address
  )

  await stakingEscrow.deployed()

  return stakingEscrow
}

module.exports.initContracts = initContracts

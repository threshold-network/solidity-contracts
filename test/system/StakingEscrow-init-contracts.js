const {
  tTokenAddress,
  nuCypherTokenAddress,
  keepTokenStakingAddress,
  nuCypherStakingEscrowAddress,
  workLockAddress,
  keepVendingMachineAddress,
  nuCypherVendingMachineAddress,
} = require("./constants.js")

async function initContracts() {
  const tToken = await resolveTToken()
  const nuCypherToken = await resolveNuCypherToken()
  const keepTokenStaking = await resolveKeepTokenStaking()
  const stakingEscrow = await resolveStakingEscrow()
  const stakingEscrowDispatcher = await resolveStakingEscrowDispatcher()
  const workLock = await resolveWorkLock()
  const keepVendingMachine = await resolveKeepVendingMachine()
  const nuCypherVendingMachine = await resolveNuCypherVendingMachine()

  const keepStake = await deployKeepStake(keepTokenStaking)

  const tokenStaking = await deployTokenStaking(
    tToken,
    keepTokenStaking,
    stakingEscrow,
    keepVendingMachine,
    nuCypherVendingMachine,
    keepStake
  )

  const stakingEscrowImplementation = await deployStakingEscrowImplementation(
    nuCypherToken,
    workLock,
    tokenStaking
  )

  return {
    nuCypherToken: nuCypherToken,
    tokenStaking: tokenStaking,
    stakingEscrow: stakingEscrow,
    stakingEscrowDispatcher: stakingEscrowDispatcher,
    stakingEscrowImplementation: stakingEscrowImplementation,
    nuCypherVendingMachine: nuCypherVendingMachine,
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

// resolveNuCypherStakingEscrow() and resolveNuCypherStakingEscrowDispatcher()
// both functions resolve the same proxy contract deployed on mainnet, but due to
// ether.js limitation, it's necessary to have two instances: the former to call
// the implementation methods, and the latter to call the proxy ones
async function resolveStakingEscrow() {
  return await ethers.getContractAt(
    "StakingEscrow",
    nuCypherStakingEscrowAddress
  )
}

async function resolveStakingEscrowDispatcher() {
  return await ethers.getContractAt("Dispatcher", nuCypherStakingEscrowAddress)
}

async function resolveWorkLock() {
  return await ethers.getContractAt("WorkLock", workLockAddress)
}

async function resolveKeepVendingMachine() {
  return await ethers.getContractAt("VendingMachine", keepVendingMachineAddress)
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

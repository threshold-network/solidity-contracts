const {
  tTokenAddress,
  keepTokenStakingAddress,
  nuCypherStakingEscrowAddress,
  keepVendingMachineAddress,
  nuCypherVendingMachineAddress,
} = require ("./constants")

async function initContracts() {
  const tToken = await resolveTToken()
  const keepTokenStaking = await resolveKeepTokenStaking()
  const nuCypherStakingEscrow = await resolveNuCypherStakingEscrow()
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

  return {
    tToken: tToken
  }
}

async function resolveTToken() {
  return await ethers.getContractAt("T", tTokenAddress)
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

module.exports.initContracts = initContracts
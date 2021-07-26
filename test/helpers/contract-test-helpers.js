function to1e18(n) {
  const decimalMultiplier = ethers.BigNumber.from(10).pow(18)
  return ethers.BigNumber.from(n).mul(decimalMultiplier)
}

function to1ePrecision(n, precision) {
  const decimalMultiplier = ethers.BigNumber.from(10).pow(precision)
  return ethers.BigNumber.from(n).mul(decimalMultiplier)
}

async function getBlockTime(blockNumber) {
  return (await ethers.provider.getBlock(blockNumber)).timestamp
}

async function lastBlockTime() {
  return (await ethers.provider.getBlock("latest")).timestamp
}

async function increaseTime(time) {
  const now = await lastBlockTime()
  await ethers.provider.send("evm_setNextBlockTimestamp", [now + time])
  await ethers.provider.send("evm_mine")
}

// FIXME Retrieves past events. This is a workaround for a known issue described
// FIXME here: https://github.com/nomiclabs/hardhat/pull/1163
// FIXME The preferred way of getting events would be using listners:
// FIXME https://docs.ethers.io/v5/api/contract/contract/#Contract--events
function pastEvents(receipt, contract, eventName) {
  const events = []

  for (const log of receipt.logs) {
    if (log.address === contract.address) {
      const parsedLog = contract.interface.parseLog(log)
      if (parsedLog.name === eventName) {
        events.push(parsedLog)
      }
    }
  }

  return events
}

module.exports.to1e18 = to1e18
module.exports.to1ePrecision = to1ePrecision
module.exports.pastEvents = pastEvents
module.exports.getBlockTime = getBlockTime
module.exports.lastBlockTime = lastBlockTime
module.exports.increaseTime = increaseTime

module.exports.ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

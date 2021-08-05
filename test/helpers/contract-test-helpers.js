function to1e18(n) {
  const decimalMultiplier = ethers.BigNumber.from(10).pow(18)
  return ethers.BigNumber.from(n).mul(decimalMultiplier)
}

async function lastBlockNumber() {
  return (await ethers.provider.getBlock("latest")).number
}

module.exports.to1e18 = to1e18
module.exports.lastBlockNumber = lastBlockNumber

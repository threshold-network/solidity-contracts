const { helpers } = require("hardhat")
const { to1e18 } = helpers.number

module.exports.keepTokenAddress = "0x85Eee30c52B0b379b046Fb0F85F4f3Dc3009aFEC"
module.exports.keepTokenGrantAddress =
  "0x175989c71fd023d580c65f5dc214002687ff88b7"
module.exports.nuCypherTokenAddress =
  "0x4fE83213D56308330EC302a8BD641f1d0113A4Cc"
module.exports.keepTokenStakingAddress =
  "0x1293a54e160D1cd7075487898d65266081A15458"
module.exports.nuCypherStakingEscrowAddress =
  "0xbbD3C0C794F40c4f993B03F65343aCC6fcfCb2e2"
module.exports.keepRegistryAddress =
  "0x1a9589F56c969d6b0D3787ea02322476eAd3fB05"

// liquid token owner with 3,000,000 staked
module.exports.keepLiquidTokenStake = {
  owner: "0x4A0A927043B01a7fB175BCa4F4837e3b817C5e6b",
  operator: "0x64A8856cBD255765D16B901a0B899daefC78FB13",
  authorizer: "0x5481188e698a5752c5cab6e2494fc2cfbb644f2d",
  beneficiary: "0xa49f1b845a8086ac0b820ce6fa8ce92d223765d2",
  keepStaked: to1e18("3000000"),
}

// managed grantee with 1,196,000 KEEP staked
module.exports.keepManagedGrantStake = {
  grantee: "0x011074cA9EEff0836a68b170E46c4d20F8CAc727",
  operator: "0xc6349eEC31048787676b6297ba71721376A8DdcF",
  authorizer: "0x011074cA9EEff0836a68b170E46c4d20F8CAc727",
  beneficiary: "0x011074cA9EEff0836a68b170E46c4d20F8CAc727",
  managedGrant: "0xac1a985E75C6a0b475b9c807Ad0705a988Be2D99",
  keepStaked: to1e18("1196000"),
}

// standard grant delegation with 832,533 staked
module.exports.keepGrantStake = {
  grantee: "0xf6f372DfAeCC1431186598c304e91B79Ce115766",
  operator: "0x8Bd660A764Ca14155F3411a4526a028b6316CB3E",
  authorizer: "0x826b18a8c61e976156a962613e2c189b3ee5f2cb",
  beneficiary: "0xf6f372DfAeCC1431186598c304e91B79Ce115766",
  keepStaked: to1e18("832533"),
  grantID: 37,
}

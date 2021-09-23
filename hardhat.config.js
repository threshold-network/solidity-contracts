require("@nomiclabs/hardhat-waffle")
require("hardhat-gas-reporter")

module.exports = {
  solidity: {
    version: "0.8.4",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
}

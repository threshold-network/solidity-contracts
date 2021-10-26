import { HardhatUserConfig } from "hardhat/config"

import "@nomiclabs/hardhat-waffle"
import "hardhat-gas-reporter"

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.4",
  },
}

export default config

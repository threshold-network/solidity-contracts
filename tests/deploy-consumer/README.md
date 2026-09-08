# Published deployment consumer test

The fixture packs the output of `prepack`, installs it into an isolated Hardhat
project, and executes the unmodified `export/deploy` directory on ethers 5 and 6.
The producer stays on its existing ethers 5 toolchain. The v5 consumer uses
hardhat-deploy 0.11.45; the v6 consumer uses hardhat-deploy 1.0.4, hardhat-ethers 3
and upgrades 2.5.1, matching the downstream stack.

Build using the producer lockfile's supported Node 18 version:

```sh
yarn install --frozen-lockfile
yarn build
yarn prepack
```

Then use Node 22 for the consumer fixtures:

```sh
node tests/deploy-consumer/prepare.js 5
node tests/deploy-consumer/prepare.js 6
```

An optional second argument selects the temporary consumer directory. No npm
publication or live-chain transactions occur. Each lane runs both a direct
TokenStaking deployment and a mainnet-style proxy deployment, using separate
local deployer and council accounts. The proxy scenario only changes the HRE's
network name; its provider remains the fresh in-memory Hardhat chain.

Assertions cover vending-machine funding, timelock role membership, initialization,
proxy admin/governance ownership, saved deployment ABI/address, and unchanged
addresses and account nonces on replay. Additional checks exercise partial funding,
overfunding, insufficient funds, and recovery after deployment was interrupted
before initialization. The consumer compiles the packaged TokenStaking source
for OpenZeppelin validation; other deployments use the package's exported artifacts.

# Instructions to upgrade TokenStaking

Tested with:

- hardhat: 2.19.1
- @openzeppelin/hardhat-upgrades: 1.28.0
- @nomicfoundation/hardhat-verify: 2.0.1

## Summary

### Setup

git remote update
git checkout <branch>

export CHAIN_API_URL=<...>
export CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY=<...>
export KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY=<...>
export ETHERSCAN_API_KEY=<...>

### Validate and deploy implementation contract

yarn hardhat deploy --tags ValidateUpgradeTokenStaking --network mainnet
yarn hardhat deploy --tags PrepareUpgradeTokenStaking --network mainnet

This will modify this OZ manifest file:
.openzeppelin/mainnet.json

### Post-deployment stuff

unset CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
unset KEEP_CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY

cp TokenStaking_implementation_0x<IMPLEMENTATION_ADDRESS>.json deployments/mainnet/TokenStaking.json

Edit deployments/mainnet/TokenStaking.json to keep proxy address instead of new implementation address

### Contract verification

Verify implementation contract using @nomicfoundation/hardhat-verify:

yarn hardhat verify --network mainnet <CONTRACT_ADDRESS> <CONSTRUCTOR_PARAM_1> <CONSTRUCTOR_PARAM_2> ...

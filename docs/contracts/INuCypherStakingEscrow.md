# Solidity API

## INuCypherStakingEscrow

Interface for NuCypher StakingEscrow contract

### slashStaker

```solidity
function slashStaker(address staker, uint256 penalty, address investigator, uint256 reward) external
```

Slash the staker's stake and reward the investigator

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| staker | address | Staker's address |
| penalty | uint256 | Penalty |
| investigator | address | Investigator |
| reward | uint256 | Reward for the investigator |

### requestMerge

```solidity
function requestMerge(address staker, address stakingProvider) external returns (uint256)
```

Request merge between NuCypher staking contract and T staking contract.
        Returns amount of staked tokens

### getAllTokens

```solidity
function getAllTokens(address staker) external view returns (uint256)
```

Get all tokens belonging to the staker


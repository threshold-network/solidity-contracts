# Solidity API

## StakerGovernorVotes

Staker DAO voting power extraction from staked T positions,

### staking

```solidity
contract IVotesHistory staking
```

### getVotes

```solidity
function getVotes(address account, uint256 blockNumber) public view virtual returns (uint256)
```

Read the voting weight from the snapshot mechanism in the T
        staking contracts. Note that this also tracks legacy stakes
        (NU/KEEP).

_See {IGovernor-getVotes}_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| account | address | Delegate account with T staking voting power |
| blockNumber | uint256 | The block number to get the vote balance at |


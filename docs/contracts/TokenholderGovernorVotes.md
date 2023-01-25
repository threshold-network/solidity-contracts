# Solidity API

## TokenholderGovernorVotes

Tokenholder DAO voting power extraction from both liquid and staked
        T token positions, including legacy stakes (NU/KEEP).

### token

```solidity
contract IVotesHistory token
```

### staking

```solidity
contract IVotesHistory staking
```

### getVotes

```solidity
function getVotes(address account, uint256 blockNumber) public view virtual returns (uint256)
```

Read the voting weight from the snapshot mechanism in the token
        and staking contracts. For Tokenholder DAO, there are currently
        two voting power sources:
         - Liquid T, tracked by the T token contract
         - Stakes in the T network, tracked  by the T staking contract.
           Note that this also tracks legacy stakes (NU/KEEP); legacy
           stakes count for tokenholders' voting power, but not for the
           total voting power of the Tokenholder DAO
           (see {_getPastTotalSupply}).

_See {IGovernor-getVotes}_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| account | address | Tokenholder account in the T network |
| blockNumber | uint256 | The block number to get the vote balance at |


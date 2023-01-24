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

### constructor

```solidity
constructor(contract IVotesHistory tokenAddress, contract IVotesHistory tStakingAddress) internal
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

### _getPastTotalSupply

```solidity
function _getPastTotalSupply(uint256 blockNumber) internal view virtual returns (uint256)
```

Compute the total voting power for Tokenholder DAO. Note how it
        only uses the token total supply as source, as native T tokens
        that are staked continue existing, but as deposits in the
        staking contract. However, legacy stakes can't contribute to the
        total voting power as they're already implicitly counted as part
        of Vending Machines' liquid balance; hence, we only need to read
        total voting power from the token.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| blockNumber | uint256 | The block number to get the vote power at |


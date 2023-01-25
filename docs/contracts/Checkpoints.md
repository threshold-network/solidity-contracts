# Solidity API

## Checkpoints

_Abstract contract to support checkpoints for Compound-like voting and
     delegation. This implementation supports token supply up to 2^96 - 1.
     This contract keeps a history (checkpoints) of each account's vote
     power. Vote power can be delegated either by calling the {delegate}
     function directly, or by providing a signature to be used with
     {delegateBySig}. Voting power can be publicly queried through
     {getVotes} and {getPastVotes}.
     NOTE: Extracted from OpenZeppelin ERCVotes.sol.
This contract is upgrade-safe._

### Checkpoint

```solidity
struct Checkpoint {
  uint32 fromBlock;
  uint96 votes;
}
```

### DelegateChanged

```solidity
event DelegateChanged(address delegator, address fromDelegate, address toDelegate)
```

Emitted when an account changes their delegate.

### DelegateVotesChanged

```solidity
event DelegateVotesChanged(address delegate, uint256 previousBalance, uint256 newBalance)
```

Emitted when a balance or delegate change results in changes
        to an account's voting power.

### checkpoints

```solidity
function checkpoints(address account, uint32 pos) public view virtual returns (struct Checkpoints.Checkpoint checkpoint)
```

### numCheckpoints

```solidity
function numCheckpoints(address account) public view virtual returns (uint32)
```

Get number of checkpoints for `account`.

### delegates

```solidity
function delegates(address account) public view virtual returns (address)
```

Get the address `account` is currently delegating to.

### getVotes

```solidity
function getVotes(address account) public view returns (uint96)
```

Gets the current votes balance for `account`.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| account | address | The address to get votes balance |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint96 | The number of current votes for `account` |

### getPastVotes

```solidity
function getPastVotes(address account, uint256 blockNumber) public view returns (uint96)
```

Determine the prior number of votes for an account as of
        a block number.

_Block number must be a finalized block or else this function will
     revert to prevent misinformation._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| account | address | The address of the account to check |
| blockNumber | uint256 | The block number to get the vote balance at |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint96 | The number of votes the account had as of the given block |

### getPastTotalSupply

```solidity
function getPastTotalSupply(uint256 blockNumber) public view returns (uint96)
```

Retrieve the `totalSupply` at the end of `blockNumber`.
        Note, this value is the sum of all balances, but it is NOT the
        sum of all the delegated votes!

_`blockNumber` must have been already mined_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| blockNumber | uint256 | The block number to get the total supply at |


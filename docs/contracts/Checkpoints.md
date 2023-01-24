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

### _delegates

```solidity
mapping(address => address) _delegates
```

### _checkpoints

```solidity
mapping(address => uint128[]) _checkpoints
```

### _totalSupplyCheckpoints

```solidity
uint128[] _totalSupplyCheckpoints
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

### delegate

```solidity
function delegate(address delegator, address delegatee) internal virtual
```

Change delegation for `delegator` to `delegatee`.

### moveVotingPower

```solidity
function moveVotingPower(address src, address dst, uint256 amount) internal
```

Moves voting power from one delegate to another

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| src | address | Address of old delegate |
| dst | address | Address of new delegate |
| amount | uint256 | Voting power amount to transfer between delegates |

### writeCheckpoint

```solidity
function writeCheckpoint(uint128[] ckpts, function (uint256,uint256) view returns (uint256) op, uint256 delta) internal returns (uint256 oldWeight, uint256 newWeight)
```

Writes a new checkpoint based on operating last stored value
        with a `delta`. Usually, said operation is the `add` or
        `subtract` functions from this contract, but more complex
        functions can be passed as parameters.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| ckpts | uint128[] | The checkpoints array to use |
| op | function (uint256,uint256) view returns (uint256) | The function to apply over the last value and the `delta` |
| delta | uint256 | Variation with respect to last stored value to be used              for new checkpoint |

### lookupCheckpoint

```solidity
function lookupCheckpoint(uint128[] ckpts, uint256 blockNumber) internal view returns (uint96)
```

Lookup a value in a list of (sorted) checkpoints.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| ckpts | uint128[] | The checkpoints array to use |
| blockNumber | uint256 | Block number when we want to get the checkpoint at |

### maxSupply

```solidity
function maxSupply() internal view virtual returns (uint96)
```

Maximum token supply. Defaults to `type(uint96).max` (2^96 - 1)

### encodeCheckpoint

```solidity
function encodeCheckpoint(uint32 blockNumber, uint96 value) internal pure returns (uint128)
```

Encodes a `blockNumber` and `value` into a single `uint128`
        checkpoint.

_`blockNumber` is stored in the first 32 bits, while `value` in the
     remaining 96 bits._

### decodeBlockNumber

```solidity
function decodeBlockNumber(uint128 checkpoint) internal pure returns (uint32)
```

Decodes a block number from a `uint128` `checkpoint`.

### decodeValue

```solidity
function decodeValue(uint128 checkpoint) internal pure returns (uint96)
```

Decodes a voting value from a `uint128` `checkpoint`.

### decodeCheckpoint

```solidity
function decodeCheckpoint(uint128 checkpoint) internal pure returns (uint32 blockNumber, uint96 value)
```

Decodes a block number and voting value from a `uint128`
        `checkpoint`.

### add

```solidity
function add(uint256 a, uint256 b) internal pure returns (uint256)
```

### subtract

```solidity
function subtract(uint256 a, uint256 b) internal pure returns (uint256)
```


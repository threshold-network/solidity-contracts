# Solidity API

## GovernorParameters

Abstract contract to handle governance parameters

_Based on `GovernorVotesQuorumFraction`, but without being opinionated
     on what's the source of voting power, and extended to handle proposal
     thresholds too. See OpenZeppelin's GovernorVotesQuorumFraction,
     GovernorVotes and GovernorSettings for reference._

### FRACTION_DENOMINATOR

```solidity
uint256 FRACTION_DENOMINATOR
```

### AVERAGE_BLOCK_TIME_IN_SECONDS

```solidity
uint64 AVERAGE_BLOCK_TIME_IN_SECONDS
```

### quorumNumerator

```solidity
uint256 quorumNumerator
```

### proposalThresholdNumerator

```solidity
uint256 proposalThresholdNumerator
```

### QuorumNumeratorUpdated

```solidity
event QuorumNumeratorUpdated(uint256 oldQuorumNumerator, uint256 newQuorumNumerator)
```

### ProposalThresholdNumeratorUpdated

```solidity
event ProposalThresholdNumeratorUpdated(uint256 oldThresholdNumerator, uint256 newThresholdNumerator)
```

### VotingDelaySet

```solidity
event VotingDelaySet(uint256 oldVotingDelay, uint256 newVotingDelay)
```

### VotingPeriodSet

```solidity
event VotingPeriodSet(uint256 oldVotingPeriod, uint256 newVotingPeriod)
```

### constructor

```solidity
constructor(uint256 quorumNumeratorValue, uint256 proposalNumeratorValue, uint256 initialVotingDelay, uint256 initialVotingPeriod) internal
```

### updateQuorumNumerator

```solidity
function updateQuorumNumerator(uint256 newQuorumNumerator) external virtual
```

### updateProposalThresholdNumerator

```solidity
function updateProposalThresholdNumerator(uint256 newNumerator) external virtual
```

### setVotingDelay

```solidity
function setVotingDelay(uint256 newVotingDelay) external virtual
```

Update the voting delay. This operation can only be performed
        through a governance proposal. Emits a `VotingDelaySet` event.

### setVotingPeriod

```solidity
function setVotingPeriod(uint256 newVotingPeriod) external virtual
```

Update the voting period. This operation can only be performed
        through a governance proposal. Emits a `VotingPeriodSet` event.

### quorum

```solidity
function quorum(uint256 blockNumber) public view virtual returns (uint256)
```

Compute the required amount of voting power to reach quorum

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| blockNumber | uint256 | The block number to get the quorum at |

### proposalThreshold

```solidity
function proposalThreshold() public view virtual returns (uint256)
```

Compute the required amount of voting power to create a proposal
        at the last block height

_This function is implemented to comply with Governor API but we
     we will actually use `proposalThreshold(uint256 blockNumber)`,
     as in our DAOs the threshold amount changes according to supply._

### proposalThreshold

```solidity
function proposalThreshold(uint256 blockNumber) public view returns (uint256)
```

Compute the required amount of voting power to create a proposal

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| blockNumber | uint256 | The block number to get the proposal threshold at |

### votingDelay

```solidity
function votingDelay() public view virtual returns (uint256)
```

module:user-config

_Delay, in number of block, between the proposal is created and the vote starts. This can be increassed to
leave time for users to buy voting power, of delegate it, before the voting of a proposal starts._

### votingPeriod

```solidity
function votingPeriod() public view virtual returns (uint256)
```

module:user-config

_Delay, in number of blocks, between the vote start and vote ends.

NOTE: The {votingDelay} can delay the start of the vote. This must be considered when setting the voting
duration compared to the voting delay._

### _updateQuorumNumerator

```solidity
function _updateQuorumNumerator(uint256 newQuorumNumerator) internal virtual
```

### _updateProposalThresholdNumerator

```solidity
function _updateProposalThresholdNumerator(uint256 proposalNumerator) internal virtual
```

### _setVotingDelay

```solidity
function _setVotingDelay(uint256 newVotingDelay) internal virtual
```

### _setVotingPeriod

```solidity
function _setVotingPeriod(uint256 newVotingPeriod) internal virtual
```

### _getPastTotalSupply

```solidity
function _getPastTotalSupply(uint256 blockNumber) internal view virtual returns (uint256)
```

Compute the past total voting power at a particular block

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| blockNumber | uint256 | The block number to get the vote power at |


# Solidity API

## BaseTokenholderGovernor

### VETO_POWER

```solidity
bytes32 VETO_POWER
```

### constructor

```solidity
constructor(contract T _token, contract IVotesHistory _staking, contract TimelockController _timelock, address _vetoer, uint256 _quorumNumerator, uint256 _proposalThresholdNumerator, uint256 votingDelay, uint256 votingPeriod, uint64 votingExtension) public
```

### cancel

```solidity
function cancel(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) external returns (uint256)
```

### propose

```solidity
function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) public returns (uint256)
```

### quorum

```solidity
function quorum(uint256 blockNumber) public view returns (uint256)
```

### proposalThreshold

```solidity
function proposalThreshold() public view returns (uint256)
```

### getVotes

```solidity
function getVotes(address account, uint256 blockNumber) public view returns (uint256)
```

### state

```solidity
function state(uint256 proposalId) public view returns (enum IGovernor.ProposalState)
```

### supportsInterface

```solidity
function supportsInterface(bytes4 interfaceId) public view returns (bool)
```

### _execute

```solidity
function _execute(uint256 proposalId, address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) internal
```

### _cancel

```solidity
function _cancel(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) internal returns (uint256)
```

### _executor

```solidity
function _executor() internal view returns (address)
```

### proposalDeadline

```solidity
function proposalDeadline(uint256 proposalId) public view virtual returns (uint256)
```

### _castVote

```solidity
function _castVote(uint256 proposalId, address account, uint8 support, string reason) internal virtual returns (uint256)
```


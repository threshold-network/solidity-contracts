# Solidity API

## StakerGovernor

### VETO_POWER

```solidity
bytes32 VETO_POWER
```

### constructor

```solidity
constructor(contract IVotesHistory _staking, contract TimelockController _timelock, contract TokenholderGovernor tokenholderGovernor, address vetoer) public
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


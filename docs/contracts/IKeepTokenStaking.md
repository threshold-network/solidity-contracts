# Solidity API

## IKeepTokenStaking

Interface for Keep TokenStaking contract

### seize

```solidity
function seize(uint256 amountToSeize, uint256 rewardMultiplier, address tattletale, address[] misbehavedOperators) external
```

Seize provided token amount from every member in the misbehaved
operators array. The tattletale is rewarded with 5% of the total seized
amount scaled by the reward adjustment parameter and the rest 95% is burned.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amountToSeize | uint256 | Token amount to seize from every misbehaved operator. |
| rewardMultiplier | uint256 | Reward adjustment in percentage. Min 1% and 100% max. |
| tattletale | address | Address to receive the 5% reward. |
| misbehavedOperators | address[] | Array of addresses to seize the tokens from. |

### getDelegationInfo

```solidity
function getDelegationInfo(address operator) external view returns (uint256 amount, uint256 createdAt, uint256 undelegatedAt)
```

Gets stake delegation info for the given operator.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| operator | address | Operator address. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | The amount of tokens the given operator delegated. |
| createdAt | uint256 | The time when the stake has been delegated. |
| undelegatedAt | uint256 | The time when undelegation has been requested. If undelegation has not been requested, 0 is returned. |

### ownerOf

```solidity
function ownerOf(address operator) external view returns (address)
```

Gets the stake owner for the specified operator address.

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | address | Stake owner address. |

### beneficiaryOf

```solidity
function beneficiaryOf(address operator) external view returns (address payable)
```

Gets the beneficiary for the specified operator address.

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | address payable | Beneficiary address. |

### authorizerOf

```solidity
function authorizerOf(address operator) external view returns (address)
```

Gets the authorizer for the specified operator address.

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | address | Authorizer address. |

### eligibleStake

```solidity
function eligibleStake(address operator, address operatorContract) external view returns (uint256 balance)
```

Gets the eligible stake balance of the specified address.
An eligible stake is a stake that passed the initialization period
and is not currently undelegating. Also, the operator had to approve
the specified operator contract.

Operator with a minimum required amount of eligible stake can join the
network and participate in new work selection.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| operator | address | address of stake operator. |
| operatorContract | address | address of operator contract. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| balance | uint256 | an uint256 representing the eligible stake balance. |


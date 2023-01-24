# Solidity API

## T

Threshold Network T token

_By default, token balance does not account for voting power.
     This makes transfers cheaper. The downside is that it requires users
     to delegate to themselves to activate checkpoints and have their
     voting power tracked._

### DELEGATION_TYPEHASH

```solidity
bytes32 DELEGATION_TYPEHASH
```

The EIP-712 typehash for the delegation struct used by
        `delegateBySig`.

### constructor

```solidity
constructor() public
```

### delegateBySig

```solidity
function delegateBySig(address signatory, address delegatee, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external
```

Delegates votes from signatory to `delegatee`

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| signatory | address |  |
| delegatee | address | The address to delegate votes to |
| deadline | uint256 | The time at which to expire the signature |
| v | uint8 | The recovery byte of the signature |
| r | bytes32 | Half of the ECDSA signature pair |
| s | bytes32 | Half of the ECDSA signature pair |

### delegate

```solidity
function delegate(address delegatee) public virtual
```

Delegate votes from `msg.sender` to `delegatee`.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| delegatee | address | The address to delegate votes to |

### beforeTokenTransfer

```solidity
function beforeTokenTransfer(address from, address to, uint256 amount) internal
```

_Hook that is called before any transfer of tokens. This includes
     minting and burning.

Calling conditions:
- when `from` and `to` are both non-zero, `amount` of `from`'s tokens
  will be to transferred to `to`.
- when `from` is zero, `amount` tokens will be minted for `to`.
- when `to` is zero, `amount` of ``from``'s tokens will be burned.
- `from` and `to` are never both zero._

### delegate

```solidity
function delegate(address delegator, address delegatee) internal virtual
```

Change delegation for `delegator` to `delegatee`.


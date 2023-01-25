# Solidity API

## VendingMachine

Contract implements a special update protocol to enable KEEP/NU
        token holders to wrap their tokens and obtain T tokens according
        to a fixed ratio. This will go on indefinitely and enable NU and
        KEEP token holders to join T network without needing to buy or
        sell any assets. Logistically, anyone holding NU or KEEP can wrap
        those assets in order to upgrade to T. They can also unwrap T in
        order to downgrade back to the underlying asset. There is a separate
        instance of this contract deployed for KEEP holders and a separate
        instance of this contract deployed for NU holders.

### WRAPPED_TOKEN_CONVERSION_PRECISION

```solidity
uint256 WRAPPED_TOKEN_CONVERSION_PRECISION
```

Number of decimal places of precision in conversion to/from
        wrapped tokens (assuming typical ERC20 token with 18 decimals).
        This implies that amounts of wrapped tokens below this precision
        won't take part in the conversion. E.g., for a value of 3, then
        for a conversion of 1.123456789 wrapped tokens, only 1.123 is
        convertible (i.e., 3 decimal places), and 0.000456789 is left.

### FLOATING_POINT_DIVISOR

```solidity
uint256 FLOATING_POINT_DIVISOR
```

Divisor for precision purposes, used to represent fractions.

### wrappedToken

```solidity
contract IERC20 wrappedToken
```

The token being wrapped to T (KEEP/NU).

### tToken

```solidity
contract T tToken
```

T token contract.

### ratio

```solidity
uint256 ratio
```

The ratio with which T token is converted based on the provided
        token being wrapped (KEEP/NU), expressed in 1e18 precision.

        When wrapping:
          x [T] = amount [KEEP/NU] * ratio / FLOATING_POINT_DIVISOR

        When unwrapping:
          x [KEEP/NU] = amount [T] * FLOATING_POINT_DIVISOR / ratio

### wrappedBalance

```solidity
mapping(address => uint256) wrappedBalance
```

The total balance of wrapped tokens for the given holder
        account. Only holders that have previously wrapped KEEP/NU to T
        can unwrap, up to the amount previously wrapped.

### Wrapped

```solidity
event Wrapped(address recipient, uint256 wrappedTokenAmount, uint256 tTokenAmount)
```

### Unwrapped

```solidity
event Unwrapped(address recipient, uint256 tTokenAmount, uint256 wrappedTokenAmount)
```

### constructor

```solidity
constructor(contract IERC20 _wrappedToken, contract T _tToken, uint96 _wrappedTokenAllocation, uint96 _tTokenAllocation) public
```

Sets the reference to `wrappedToken` and `tToken`. Initializes
        conversion `ratio` between wrapped token and T based on the
        provided `_tTokenAllocation` and `_wrappedTokenAllocation`.

_Multiplications in this contract can't overflow uint256 as we
    restrict `_wrappedTokenAllocation` and `_tTokenAllocation` to
    96 bits and FLOATING_POINT_DIVISOR fits in less than 60 bits._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _wrappedToken | contract IERC20 | Address to ERC20 token that will be wrapped to T |
| _tToken | contract T | Address of T token |
| _wrappedTokenAllocation | uint96 | The total supply of the token that will be       wrapped to T |
| _tTokenAllocation | uint96 | The allocation of T this instance of Vending        Machine will receive |

### wrap

```solidity
function wrap(uint256 amount) external
```

Wraps up to the the given `amount` of the token (KEEP/NU) and
        releases T token proportionally to the amount being wrapped with
        respect to the wrap ratio. The token holder needs to have at
        least the given amount of the wrapped token (KEEP/NU) approved
        to transfer to the Vending Machine before calling this function.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | The amount of KEEP/NU to be wrapped |

### receiveApproval

```solidity
function receiveApproval(address from, uint256 amount, address token, bytes) external
```

Wraps up to the given amount of the token (KEEP/NU) and releases
        T token proportionally to the amount being wrapped with respect
        to the wrap ratio. This is a shortcut to `wrap` function that
        avoids a separate approval transaction. Only KEEP/NU token
        is allowed as a caller, so please call this function via
        token's `approveAndCall`.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| from | address | Caller's address, must be the same as `wrappedToken` field |
| amount | uint256 | The amount of KEEP/NU to be wrapped |
| token | address | Token's address, must be the same as `wrappedToken` field |
|  | bytes |  |

### unwrap

```solidity
function unwrap(uint256 amount) external
```

Unwraps up to the given `amount` of T back to the legacy token
        (KEEP/NU) according to the wrap ratio. It can only be called by
        a token holder who previously wrapped their tokens in this
        vending machine contract. The token holder can't unwrap more
        tokens than they originally wrapped. The token holder needs to
        have at least the given amount of T tokens approved to transfer
        to the Vending Machine before calling this function.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | The amount of T to unwrap back to the collateral (KEEP/NU) |

### conversionToT

```solidity
function conversionToT(uint256 amount) public view returns (uint256 tAmount, uint256 wrappedRemainder)
```

Returns the T token amount that's obtained from `amount` wrapped
        tokens (KEEP/NU), and the remainder that can't be upgraded.

### conversionFromT

```solidity
function conversionFromT(uint256 amount) public view returns (uint256 wrappedAmount, uint256 tRemainder)
```

The amount of wrapped tokens (KEEP/NU) that's obtained from
        `amount` T tokens, and the remainder that can't be downgraded.


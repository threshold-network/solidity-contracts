# Solidity API

## IApplication

Generic interface for an application. Application is an external
        smart contract or a set of smart contracts utilizing functionalities
        offered by Threshold Network. Applications authorized for the given
        staking provider are eligible to slash the stake delegated to that
        staking provider.

### RewardsWithdrawn

```solidity
event RewardsWithdrawn(address stakingProvider, uint96 amount)
```

_Event emitted by `withdrawRewards` function._

### withdrawRewards

```solidity
function withdrawRewards(address stakingProvider) external
```

Withdraws application rewards for the given staking provider.
        Rewards are withdrawn to the staking provider's beneficiary
        address set in the staking contract.

_Emits `RewardsWithdrawn` event._

### authorizationIncreased

```solidity
function authorizationIncreased(address stakingProvider, uint96 fromAmount, uint96 toAmount) external
```

Used by T staking contract to inform the application that the
        authorized amount for the given staking provider increased.
        The application may do any necessary housekeeping. The
        application must revert the transaction in case the
        authorization is below the minimum required.

### authorizationDecreaseRequested

```solidity
function authorizationDecreaseRequested(address stakingProvider, uint96 fromAmount, uint96 toAmount) external
```

Used by T staking contract to inform the application that the
        authorization decrease for the given staking provider has been
        requested. The application should mark the authorization as
        pending decrease and respond to the staking contract with
        `approveAuthorizationDecrease` at its discretion. It may
        happen right away but it also may happen several months later.
        If there is already a pending authorization decrease request
        for the application, and the application does not agree for
        overwriting it, the function should revert.

### involuntaryAuthorizationDecrease

```solidity
function involuntaryAuthorizationDecrease(address stakingProvider, uint96 fromAmount, uint96 toAmount) external
```

Used by T staking contract to inform the application the
        authorization has been decreased for the given staking provider
        involuntarily, as a result of slashing. Lets the application to
        do any housekeeping neccessary. Called with 250k gas limit and
        does not revert the transaction if
        `involuntaryAuthorizationDecrease` call failed.

### availableRewards

```solidity
function availableRewards(address stakingProvider) external view returns (uint96)
```

Returns the amount of application rewards available for
        withdrawal for the given staking provider.

### minimumAuthorization

```solidity
function minimumAuthorization() external view returns (uint96)
```

The minimum authorization amount required for the staking
        provider so that they can participate in the application.


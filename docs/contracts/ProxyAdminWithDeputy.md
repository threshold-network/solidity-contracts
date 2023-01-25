# Solidity API

## ProxyAdminWithDeputy

Based on `ProxyAdmin`, an auxiliary contract in OpenZeppelin's
        upgradeability approach meant to act as the admin of a
        `TransparentUpgradeableProxy`. This variant allows an additional
        actor, the "deputy", to perform upgrades, which originally can only
        be performed by the ProxyAdmin's owner. See OpenZeppelin's
        documentation for `TransparentUpgradeableProxy` for more details on
        why a ProxyAdmin is recommended.

### deputy

```solidity
address deputy
```

### DeputyUpdated

```solidity
event DeputyUpdated(address previousDeputy, address newDeputy)
```

### onlyOwnerOrDeputy

```solidity
modifier onlyOwnerOrDeputy()
```

### constructor

```solidity
constructor(contract StakerGovernor dao, address _deputy) public
```

### setDeputy

```solidity
function setDeputy(address newDeputy) external
```

### upgrade

```solidity
function upgrade(contract TransparentUpgradeableProxy proxy, address implementation) public virtual
```

Upgrades `proxy` to `implementation`. This contract must be the
        admin of `proxy`, and the caller must be this contract's owner
        or the deputy.

### upgradeAndCall

```solidity
function upgradeAndCall(contract TransparentUpgradeableProxy proxy, address implementation, bytes data) public payable virtual
```

Upgrades `proxy` to `implementation` and calls a function on the
        new implementation. This contract must be the admin of `proxy`,
        and the caller must be this contract's owner or the deputy.


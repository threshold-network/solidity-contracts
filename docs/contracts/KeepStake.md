# Solidity API

## KeepStake

T network staking contract supports existing KEEP stakes by allowing
        KEEP stakers to use their stakes in T network and weights them based
        on KEEP<>T token ratio. KEEP stake owner is cached in T staking
        contract and used to restrict access to all functions only owner or
        operator should call. To cache KEEP stake owner in T staking
        contract, T staking contract first needs to resolve the owner.

        Resolving liquid KEEP stake owner is easy. Resolving token grant
        stake owner is complicated and not possible to do on-chain from
        a contract external to KEEP TokenStaking contract. Keep TokenStaking
        knows the grant ID but does not expose it externally.

        KeepStake contract addresses this problem by exposing
        operator-owner mappings snapshotted off-chain based on events and
        information publicly available from KEEP TokenStaking contract and
        KEEP TokenGrant contract. Additionally, it gives the Governance
        ability to add new mappings in case they are ever needed; in
        practice, this will be needed only if someone decides to stake their
        KEEP token grant in KEEP network after 2021-11-11 when the snapshot
        was taken.

        Operator-owner pairs were snapshotted 2021-11-11 in the following
        way:
        1. Fetch all TokenStaking events from KEEP staking contract.
        2. Filter out undelegated operators.
        3. Filter out canceled delegations.
        4. Fetch grant stake information from KEEP TokenGrant for that
           operator to determine if we are dealing with grant delegation.
        5. Fetch grantee address from KEEP TokenGrant contract.
        6. Check if we are dealing with ManagedGrant by looking for all
           created ManagedGrants and comparing their address against grantee
           address fetched from TokenGrant contract.

### keepTokenStaking

```solidity
contract IKeepTokenStaking keepTokenStaking
```

### operatorToManagedGrant

```solidity
mapping(address => address) operatorToManagedGrant
```

### operatorToGrantee

```solidity
mapping(address => address) operatorToGrantee
```

### constructor

```solidity
constructor(contract IKeepTokenStaking _keepTokenStaking) public
```

### setManagedGrant

```solidity
function setManagedGrant(address operator, address managedGrant) external
```

Allows the Governance to set new operator-managed grant pair.
        This function should only be called for managed grants if
        the snapshot does include this pair.

### setGrantee

```solidity
function setGrantee(address operator, address grantee) external
```

Allows the Governance to set new operator-grantee pair.
        This function should only be called for non-managed grants if
        the snapshot does include this pair.

### resolveOwner

```solidity
function resolveOwner(address operator) external view returns (address)
```

Resolves KEEP stake owner for the provided operator address.
        Reverts if could not resolve the owner.

### resolveSnapshottedManagedGrantees

```solidity
function resolveSnapshottedManagedGrantees(address operator) internal view returns (address)
```

### resolveSnapshottedGrantees

```solidity
function resolveSnapshottedGrantees(address operator) internal pure returns (address)
```


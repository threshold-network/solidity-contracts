// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "./TokenStaking.sol";

/// @notice Native T staking for Sepolia operator setup.
/// @dev Keeps authorization backing for every approved testnet application.
///      Mainnet's retired staking and migration behavior remains in TokenStaking.
contract SepoliaTokenStaking is TokenStaking {
    using SafeTUpgradeable for T;

    // Reserve the slot used by the previously selected test fixture. Its values
    // are intentionally unused; test-only setters must not affect eligibility.
    // slither-disable-next-line unused-state
    mapping(address => bool) private skipList;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(T _token) TokenStaking(_token) {}

    /// @notice Stakes the caller's T for a new provider, beneficiary and authorizer.
    function stake(
        address stakingProvider,
        address payable beneficiary,
        address authorizer,
        uint96 amount
    ) external {
        require(
            stakingProvider != address(0) &&
                beneficiary != address(0) &&
                authorizer != address(0),
            "Parameters must be specified"
        );
        StakingProviderInfo storage provider = stakingProviders[
            stakingProvider
        ];
        require(provider.owner == address(0), "Provider is already in use");
        require(
            amount > 0 && amount >= minTStakeAmount,
            "Amount is less than minimum"
        );
        provider.owner = msg.sender;
        provider.authorizer = authorizer;
        provider.beneficiary = beneficiary;
        provider.tStake = amount;
        /* solhint-disable-next-line not-rely-on-time */
        provider.startStakingTimestamp = block.timestamp;
        newStakeCheckpoint(stakingProvider, amount, true);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Approves the caller application's pending authorization decrease.
    /// @dev Tokens stay staked until unstakeT checks every application's backing.
    function approveAuthorizationDecrease(address stakingProvider)
        external
        override
        returns (uint96)
    {
        require(
            applicationInfo[msg.sender].status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );
        StakingProviderInfo storage provider = stakingProviders[
            stakingProvider
        ];
        AppAuthorization storage authorization = provider.authorizations[
            msg.sender
        ];
        require(authorization.deauthorizing > 0, "No deauthorizing in process");
        uint96 fromAmount = authorization.authorized;
        authorization.authorized -= authorization.deauthorizing;
        authorization.deauthorizing = 0;
        if (authorization.authorized == 0) {
            cleanAuthorizedApplications(provider, 1);
        }
        emit AuthorizationDecreaseApproved(
            stakingProvider,
            msg.sender,
            fromAmount,
            authorization.authorized
        );
        return authorization.authorized;
    }

    /// @notice The legacy TACo migration is not available to testnet applications.
    function migrateAndRelease(address, uint96)
        external
        pure
        override
        returns (bool)
    {
        revert("Migration is not supported on Sepolia");
    }

    // Governance approval, status and authorizer checks still apply to writes.
    // Used by inherited staking methods; the test fixture overrides it again.
    // slither-disable-next-line dead-code
    function skipApplication(address)
        internal
        pure
        virtual
        override
        returns (bool)
    {
        return false;
    }
}

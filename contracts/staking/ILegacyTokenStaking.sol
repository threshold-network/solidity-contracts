// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

/// @title IKeepTokenStaking
/// @notice Interface for Keep TokenStaking contract
interface IKeepTokenStaking {
    /// @notice Seize provided token amount from every member in the misbehaved
    /// operators array. The tattletale is rewarded with 5% of the total seized
    /// amount scaled by the reward adjustment parameter and the rest 95% is burned.
    /// @param amountToSeize Token amount to seize from every misbehaved operator.
    /// @param rewardMultiplier Reward adjustment in percentage. Min 1% and 100% max.
    /// @param tattletale Address to receive the 5% reward.
    /// @param misbehavedOperators Array of addresses to seize the tokens from.
    function seize(
        uint256 amountToSeize,
        uint256 rewardMultiplier,
        address tattletale,
        address[] memory misbehavedOperators
    ) external;

    /// @notice Gets stake delegation info for the given operator.
    /// @param _operator Operator address.
    /// @return amount The amount of tokens the given operator delegated.
    /// @return createdAt The time when the stake has been delegated.
    /// @return undelegatedAt The time when undelegation has been requested.
    /// If undelegation has not been requested, 0 is returned.
    function getDelegationInfo(address _operator)
        external
        view
        returns (
            uint256 amount,
            uint256 createdAt,
            uint256 undelegatedAt
        );

    /// @notice Gets the stake owner for the specified operator address.
    /// @return Stake owner address.
    function ownerOf(address _operator) external view returns (address);

    /// @notice Gets the beneficiary for the specified operator address.
    /// @return Beneficiary address.
    function beneficiaryOf(address _operator)
        external
        view
        returns (address payable);

    /// @notice Gets the authorizer for the specified operator address.
    /// @return Authorizer address.
    function authorizerOf(address _operator) external view returns (address);

    /// @notice Gets the eligible stake balance of the specified address.
    /// An eligible stake is a stake that passed the initialization period
    /// and is not currently undelegating. Also, the operator had to approve
    /// the specified operator contract.
    ///
    /// Operator with a minimum required amount of eligible stake can join the
    /// network and participate in new work selection.
    ///
    /// @param _operator address of stake operator.
    /// @param _operatorContract address of operator contract.
    /// @return balance an uint256 representing the eligible stake balance.
    function eligibleStake(address _operator, address _operatorContract)
        external
        view
        returns (uint256 balance);
}

/// @title INuCypherStakingEscrow
/// @notice Interface for NuCypher StakingEscrow contract
interface INuCypherStakingEscrow {
    /// @notice Slash the staker's stake and reward the investigator
    /// @param _staker Staker's address
    /// @param _penalty Penalty
    /// @param _investigator Investigator
    /// @param _reward Reward for the investigator
    function slashStaker(
        address _staker,
        uint256 _penalty,
        address _investigator,
        uint256 _reward
    ) external;

    /// @notice Request merge between NuCypher staking contract and T staking contract.
    ///         Returns amount of staked tokens
    function requestMerge(address staker, address operator)
        external
        returns (uint256);

    /// @notice Get all tokens belonging to the staker
    function getAllTokens(address _staker) external view returns (uint256);
}

/// @title IKeepTokenGrant
/// @notice Interface for Keep TokenGrant contract
interface IKeepTokenGrant {
    /// @notice Gets grant by ID. Returns only basic grant data.
    /// @param _id ID of the token grant.
    /// @return amount The amount of tokens the grant provides.
    /// @return withdrawn The amount of tokens that have already been withdrawn
    ///                   from the grant.
    /// @return staked The amount of tokens that have been staked from the grant.
    /// @return revokedAmount The number of tokens revoked from the grantee.
    /// @return revokedAt Timestamp at which grant was revoked by the grant manager.
    /// @return grantee The grantee of grant.
    function getGrant(uint256 _id)
        external
        view
        returns (
            uint256 amount,
            uint256 withdrawn,
            uint256 staked,
            uint256 revokedAmount,
            uint256 revokedAt,
            address grantee
        );

    /// @notice Gets grant stake details of the given operator.
    /// @param operator The operator address.
    /// @return grantId ID of the token grant.
    /// @return amount The amount of tokens the given operator delegated.
    /// @return stakingContract The address of staking contract.
    function getGrantStakeDetails(address operator)
        external
        view
        returns (
            uint256 grantId,
            uint256 amount,
            address stakingContract
        );
}

/// @title IKeepManagedGrant
/// @notice Interface for Keep ManagedGrant contract
interface IKeepManagedGrant {
    /// @notice Returns address of grantee
    function grantee() external view returns (address);
}

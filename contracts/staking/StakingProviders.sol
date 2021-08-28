// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

/**
 * @title IKeepTokenStaking
 * @notice Interface for Keep TokenStaking contract
 */
interface IKeepTokenStaking {
    // TODO add slash and seize endpoints

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
}

/**
 * @title INuCypherStakingEscrow
 * @notice Interface for NuCypher StakingEscrow contract
 */
interface INuCypherStakingEscrow {
    // TODO add slash and seize endpoints

    /**
     * @notice Get all tokens belonging to the staker
     */
    function getAllTokens(address staker) external view returns (uint256);
}

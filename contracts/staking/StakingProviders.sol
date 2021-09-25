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

    /// @notice Checks if operator contract has access to the staked token balance of
    /// the provided operator.
    /// @param _operator address of stake operator.
    /// @param _operatorContract address of operator contract.
    function isAuthorizedForOperator(
        address _operator,
        address _operatorContract
    ) external view returns (bool);
}

/**
 * @title INuCypherStakingEscrow
 * @notice Interface for NuCypher StakingEscrow contract
 */
interface INuCypherStakingEscrow {
    // TODO add slash and seize endpoints

    /// @notice Request merge between NuCypher staking contract and T staking contract.
    ///         Returns amount of staked tokens
    function requestMerge(address staker) external view returns (uint256);
}

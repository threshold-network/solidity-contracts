// SPDX-License-Identifier: GPL-3.0-or-later

// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌

pragma solidity ^0.8.9;

import "./IApplication.sol";

/// @title  Interface for Threshold Network applications with operator role
interface IApplicationWithOperator is IApplication {
    /// @notice Returns operator registered for the given staking provider.
    function stakingProviderToOperator(address stakingProvider)
        external
        view
        returns (address);

    /// @notice Returns staking provider of the given operator.
    function operatorToStakingProvider(address operator)
        external
        view
        returns (address);

    /// @notice Used by staking provider to set operator address that will
    ///         operate a node. The operator address must be unique.
    ///         Reverts if the operator is already set for the staking provider
    ///         or if the operator address is already in use.
    /// @dev    Depending on application the given staking provider can set operator
    ///         address only once or multiple times. Besides that, application can decide
    ///         if function reverts if there is a pending authorization decrease for
    ///         the staking provider.
    function registerOperator(address operator) external;
}

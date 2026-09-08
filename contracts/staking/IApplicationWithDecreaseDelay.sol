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

/// @title  Interface for Threshold Network applications with delay after decrease request
interface IApplicationWithDecreaseDelay is IApplication {
    /// @notice Approves the previously registered authorization decrease
    ///         request. Reverts if authorization decrease delay has not passed
    ///         yet or if the authorization decrease was not requested for the
    ///         given staking provider.
    function approveAuthorizationDecrease(address stakingProvider) external;

    /// @notice Returns authorization-related parameters of the application.
    /// @dev The minimum authorization is also returned by `minimumAuthorization()`
    ///      function, as a requirement of `IApplication` interface.
    /// @return _minimumAuthorization The minimum authorization amount required
    ///         so that operator can participate in the application.
    /// @return authorizationDecreaseDelay Delay in seconds that needs to pass
    ///         between the time authorization decrease is requested and the
    ///         time that request gets approved. Protects against participants
    ///         earning rewards and not being active in the network.
    /// @return authorizationDecreaseChangePeriod Authorization decrease change
    ///        period in seconds. It is the time window, before authorization decrease
    ///        delay ends, during which the pending authorization decrease
    ///        request can be overwritten.
    ///        If set to 0, pending authorization decrease request can not be
    ///        overwritten until the entire `authorizationDecreaseDelay` ends.
    ///        If set to a value equal to `authorizationDecreaseDelay`, request can
    ///        always be overwritten.
    function authorizationParameters()
        external
        view
        returns (
            uint96 _minimumAuthorization,
            uint64 authorizationDecreaseDelay,
            uint64 authorizationDecreaseChangePeriod
        );

    /// @notice Returns the amount of stake that is pending authorization
    ///         decrease for the given staking provider. If no authorization
    ///         decrease has been requested, returns zero.
    function pendingAuthorizationDecrease(address _stakingProvider)
        external
        view
        returns (uint96);

    /// @notice Returns the remaining time in seconds that needs to pass before
    ///         the requested authorization decrease can be approved.
    function remainingAuthorizationDecreaseDelay(address stakingProvider)
        external
        view
        returns (uint64);
}

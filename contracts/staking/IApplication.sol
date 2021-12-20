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

pragma solidity 0.8.9;

/// @title  Application interface for Threshold Network applications
/// @notice Generic interface for an application. Application is an external
///         smart contract or a set of smart contracts utilizing functionalities
///         offered by Threshold Network. Applications authorized for the given
///         operator are eligible to slash the stake delegated to that operator.
interface IApplication {
    /// @notice Used by T staking contract to inform the application that the
    ///         authorized amount for the given operator increased.
    ///         The application may do any necessary housekeeping.
    function authorizationIncreased(
        address operator,
        uint96 fromAmount,
        uint96 toAmount
    ) external;

    /// @notice Used by T staking contract to inform the application that the
    ///         given operator requested to decrease the authorization amount.
    ///         The application should mark the authorization as pending
    ///         decrease and respond to the staking contract with
    ///         `approveAuthorizationDecrease` at its discretion. It may
    ///         happen right away but it also may happen several months later.
    function authorizationDecreaseRequested(
        address operator,
        uint96 fromAmount,
        uint96 toAmount
    ) external;

    /// @notice Used by T staking contract to inform the application the
    ///         authorization has been decreased for the given operator
    ///         involuntarily, as a result of slashing. Lets the application to
    ///         do any housekeeping neccessary. Called with 250k gas limit and
    ///         does not revert the transaction if
    ///         `involuntaryAuthorizationDecrease` call failed.
    function involuntaryAuthorizationDecrease(
        address operator,
        uint96 fromAmount,
        uint96 toAmount
    ) external;
}

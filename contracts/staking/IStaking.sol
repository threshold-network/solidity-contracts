// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

/// @title Interface of Threshold Network staking contract
/// @notice The staking contract enables T owners to have their wallets offline
///         and their stake operated by operators on their behalf. All off-chain
///         client software should be able to run without exposing operator’s
///         private key and should not require any owner’s keys at all.
///         The stake delegation optimizes the network throughput without
///         compromising the security of the owners’ stake.
interface IStaking {
    //
    //
    // Delegating a stake
    //
    //

    /// @notice Creates a delegation with `msg.sender` owner with the given
    ///         operator, beneficiary, and authorizer. Transfers the given
    ///         amount of T to the staking contract.
    /// @dev The owner of the delegation needs to have the amount approved to
    ///      transfer to the staking contract.
    function stake(
        address operator,
        address payable beneficiary,
        address authorizer,
        uint256 amount
    ) external;

    /// @notice Copies delegation from the legacy KEEP staking contract to T
    ///         staking contract. No tokens are transferred. Caches the active
    ///         stake amount from KEEP staking contract. Can be called by
    ///         anyone.
    function stakeKeep(address operator) external;

    /// @notice Copies delegation from the legacy NU staking contract to T
    ///         staking contract, additionally appointing beneficiary and
    ///         authorizer roles. Caches the amount staked in NU staking
    ///         contract. Can be called only by the original delegation owner.
    function stakeNu(
        address operator,
        address payable beneficiary,
        address authorizer
    ) external;

    /// @notice Allows the Governance to set the minimum required stake amount.
    ///         This amount is required to protect against griefing the staking
    ///         contract and individual applications are allowed to require
    ///         higher minimum stakes if necessary.
    function setMinimumStakeAmount(uint256 amount) external;

    //
    //
    // Authorizing an application
    //
    //

    /// @notice Allows the Governance to approve the particular application
    ///         before individual stake authorizers are able to authorize it.
    function approveApplication(address application) external;

    /// @notice Increases the authorization of the given operator for the given
    ///         application by the given amount. Can only be called by the given
    ///         operator’s authorizer.
    /// @dev Calls `authorizationIncreased(address operator, uint256 amount)`
    ///      on the given application to notify the application about
    ///      authorization change. See `IApplication`.
    function increaseAuthorization(
        address operator,
        address application,
        uint256 amount
    ) external;

    /// @notice Requests decrease of the authorization for the given operator on
    ///         the given application by the provided amount.
    ///         It may not change the authorized amount immediatelly. When
    ///         it happens depends on the application. Can only be called by the
    ///         given operator’s authorizer. Overwrites pending authorization
    ///         decrease for the given operator and application.
    /// @dev Calls `authorizationDecreaseRequested(address operator, uint256 amount)`
    ///      on the given application. See `IApplication`.
    function requestAuthorizationDecrease(
        address operator,
        address application,
        uint256 amount
    ) external;

    /// @notice Called by the application at its discretion to approve the
    ///         previously requested authorization decrease request. Can only be
    ///         called by the application that was previously requested to
    ///         decrease the authorization for that operator.
    function approveAuthorizationDecrease(address operator) external;

    /// @notice Disables the given application’s eligibility to slash stakes.
    ///         Can be called only by the Panic Button of the particular
    ///         application. The disabled application can not slash stakes until
    ///         it is approved again by the Governance using `approveApplication`
    ///         function. Should be used only in case of an emergency.
    function disableApplication(address application) external;

    /// @notice Sets the Panic Button role for the given application to the
    ///         provided address. Can only be called by the Governance. If the
    ///         Panic Button for the given application should be disabled, the
    ///         role address should can set to 0x0 address.
    function setPanicButton(address application, address panicButton) external;

    /// @notice Sets the maximum number of applications one operator can
    ///         authorize. Used to protect against DoSing slashing queue.
    ///         Can only be called by the Governance.
    function setAuthorizationCeiling(uint256 ceiling) external;

    //
    //
    // Stake top-up
    //
    //

    /// @notice Increases the amount of the stake for the given operator.
    ///         Can be called by anyone.
    /// @dev The sender of this transaction needs to have the amount approved to
    ///      transfer to the staking contract.
    function topUp(address operator, uint256 amount) external;

    /// @notice Propagates information about stake top-up from the legacy KEEP
    ///         staking contract to T staking contract. Can be called by anyone.
    function topUpKeep(address operator) external;

    /// @notice Propagates information about stake top-up from the legacy NU
    ///         staking contract to T staking contract. Can be called by anyone.
    function topUpNu(address operator) external;

    //
    //
    // Undelegating a stake (unstaking)
    //
    //

    /// @notice Reduces the liquid T stake amount by the provided amount and
    ///         withdraws T to the owner. Reverts if there is at least one
    ///         authorization higher than the sum of the legacy stake and
    ///         remaining liquid T stake or if the unstake amount is higher than
    ///         the liquid T stake amount. Can be called only by the owner or
    ///         operator.
    function unstakeT(address operator, uint256 amount) external;

    /// @notice Sets the legacy KEEP staking contract active stake amount cached
    ///         in T staking contract to 0. Reverts if the amount of liquid T
    ///         staked in T staking contract is lower than the highest
    ///         application authorization. This function allows to unstake from
    ///         KEEP staking contract and sill being able to operate in T
    ///         network and earning rewards based on the liquid T staked. Can be
    ///         called only by the delegation owner and operator.
    function unstakeKeep(address operator) external;

    /// @notice Reduces cached legacy NU stake amount by the provided amount.
    ///         Reverts if there is at least one authorization higher than the
    ///         sum of remaining legacy NU stake and liquid T stake for that
    ///         operator or if the untaked amount is higher than the cached
    ///         legacy stake amount. If succeeded, the legacy NU stake can be
    ///         partially or fully undelegated on the legacy staking contract.
    ///         This function allows to unstake from NU staking contract and
    ///         still being able to operate in T network and earning rewards
    ///         based on the liquid T staked. Can be called only by the
    ///         delegation owner and operator.
    function unstakeNu(address operator, uint256 amount) external;

    /// @notice Sets cached legacy stake amount to 0, sets the liquid T stake
    ///         amount to 0 and withdraws all liquid T from the stake to the
    ///         owner. Reverts if there is at least one non-zero authorization.
    ///         Can be called only by the delegation owner and operator.
    function unstakeAll(address operator) external;

    //
    //
    // Keeping information in sync
    //
    //

    /// @notice Notifies about the discrepancy between legacy KEEP active stake
    ///         and the amount cached in T staking contract. Slashes the operator
    ///         in case the amount cached is higher than the actual active stake
    ///         amount in KEEP staking contract. Needs to update authorizations
    ///         of all affected applications and execute an involuntary
    ///         allocation decrease on all affected applications. Can be called
    ///         by anyone, notifier receives a reward.
    function notifyKeepStakeDiscrepancy(address operator) external;

    /// @notice Notifies about the discrepancy between legacy NU active stake
    ///         and the amount cached in T staking contract. Slashes the
    ///         operator in case the amount cached is higher than the actual
    ///         active stake amount in NU staking contract. Needs to update
    ///         authorizations of all affected applications and execute an
    ///         involuntary allocation decrease on all affected applications.
    ///         Can be called by anyone, notifier receives a reward.
    function notifyNuStakeDiscrepancy(address operator) external;

    /// @notice Sets the penalty amount for stake discrepancy and reward
    ///         multiplier for reporting it. The penalty is seized from the
    ///         operator account, and 5% of the penalty, scaled by the
    ///         multiplier, is given to the notifier. The rest of the tokens are
    ///         burned. Can only be called by the Governance. See `seize` function.
    function setStakeDiscrepancyPenalty(
        uint256 penalty,
        uint256 rewardMultiplier
    ) external;

    /// @notice Adds operators to the slashing queue along with the amount that
    ///         should be slashed from each one of them. Can only be called by
    ///         application authorized for all operators in the array.
    function slash(uint256 amount, address[] memory operators) external;

    /// @notice Adds operators to the slashing queue along with the amount,
    ///         reward multiplier and notifier address. The notifier will
    ///         receive 1% of the slashed amount scaled by the reward adjustment
    ///         parameter once the seize order will be processed. Can only be
    ///         called by application authorized for all operators in the array.
    function seize(
        uint256 amount,
        uint256 rewardMultipier,
        address notifier,
        address[] memory operators
    ) external;

    /// @notice Takes the given number of queued slashing operations and
    ///         processes them. Receives 5% of the slashed amount if the
    ///         slashing request was created by the application with a slash
    ///         call and 4% of the slashed amount if the slashing request was
    ///         created by the application with seize call.
    ///         Executes `involuntaryAllocationDecrease` function on each
    ///         affected application.
    function processSlashing(uint256 count) external;

    //
    //
    // Auxiliary functions
    //
    //

    /// @notice Returns the authorized stake amount of the operator for the
    ///         application.
    function authorizedStake(address operator, address application)
        external
        view
        returns (uint256);

    /// @notice Checks if the specified operator has a stake delegated and if it
    ///         has been authorized for at least one application. If this
    ///         function returns true, off-chain client of the given operator is
    ///         eligible to join the network.
    function hasStakeDelegated(address operator) external view returns (bool);
}

// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.8.4;


/**
* @title IStakingProvider
* @notice Generic interface for old Staking Contracts
*/
interface IStakingProvider {  // TODO:  Inherit from IERC165

    // TODO: Events

    /**
     * @dev Returns the locked stake amount and undelegation duration for `staker`
     */
    function getStakeInfo(address staker) external view returns(uint256 stakeAmount, uint256 undelegationDuration);

    /**
     * @dev Penalizes staker `_staker`; the penalty details are encoded in `_penaltyData`
     */
    function slashStaker(address staker, bytes calldata penaltyData) external;
}
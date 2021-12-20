// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../staking/KeepStake.sol";

interface IKeepManagedGrant is IManagedGrant {
    function stake(
        address stakingContract,
        uint256 amount,
        bytes memory extraData
    ) external;
}

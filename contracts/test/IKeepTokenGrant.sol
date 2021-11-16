// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../staking/ILegacyTokenStaking.sol";

interface IKeepTokenGrant {
    function stake(
        uint256 id,
        address stakingContract,
        uint256 amount,
        bytes memory extraData
    ) external;
}

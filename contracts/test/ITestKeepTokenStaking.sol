// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../staking/ILegacyTokenStaking.sol";

interface ITestKeepTokenStaking is IKeepTokenStaking {
    function authorizeOperatorContract(
        address operator,
        address operatorContract
    ) external;

    function commitTopUp(address _operator) external;

    function undelegate(address _operator) external;
}

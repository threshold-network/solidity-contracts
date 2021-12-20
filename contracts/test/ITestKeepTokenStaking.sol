// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../staking/ILegacyTokenStaking.sol";

interface ITestKeepTokenStaking is IKeepTokenStaking {
    function authorizeOperatorContract(
        address operator,
        address operatorContract
    ) external;

    function commitTopUp(address operator) external;

    function undelegate(address operator) external;

    function getLocks(address operator)
        external
        view
        returns (address[] memory creators, uint256[] memory expirations);
}

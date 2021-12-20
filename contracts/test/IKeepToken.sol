// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IKeepToken is IERC20 {
    function approveAndCall(
        address spender,
        uint256 value,
        bytes memory extraData
    ) external returns (bool success);
}

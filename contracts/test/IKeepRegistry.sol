// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IKeepRegistry {
    function registryKeeper() external view returns (address);

    function approveOperatorContract(address operatorContract) external;
}

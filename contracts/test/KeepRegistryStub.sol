// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "./IKeepRegistry.sol";

contract KeepRegistryStub is IKeepRegistry {
    event OperatorContractApproved(address operatorContract);

    address public registryKeeper;

    constructor() public {
        registryKeeper = msg.sender;
    }

    function approveOperatorContract(address operatorContract) external {
        emit OperatorContractApproved(operatorContract);
    }
}

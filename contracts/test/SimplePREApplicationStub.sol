// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.0;

contract SimplePREApplicationStub {
    event OperatorConfirmed(
        address indexed stakingProvider,
        address indexed operator
    );

    function confirmOperatorAddress(address stakingProvider) external {
        emit OperatorConfirmed(stakingProvider, msg.sender);
    }
}

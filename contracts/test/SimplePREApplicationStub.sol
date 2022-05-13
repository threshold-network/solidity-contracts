// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.0;

contract SimplePREApplicationStub {
    event OperatorConfirmed(
        address indexed stakingProvider,
        address indexed operator
    );

    struct StakingProviderInfo {
        address operator;
        bool operatorConfirmed;
        uint256 operatorStartTimestamp;
    }

    mapping (address => StakingProviderInfo) public stakingProviderInfo;

    function confirmOperatorAddress(address stakingProvider) external {
        StakingProviderInfo storage info = stakingProviderInfo[stakingProvider];
        require(!info.operatorConfirmed, "Operator address is already confirmed");
        info.operator = msg.sender;
        info.operatorStartTimestamp = block.timestamp;
        info.operatorConfirmed = true;
        emit OperatorConfirmed(stakingProvider, msg.sender);
    }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.0;

contract SimplePREApplicationStub {
    event OperatorBonded(
        address indexed stakingProvider,
        address indexed operator,
        uint256 startTimestamp
    );

    event OperatorConfirmed(
        address indexed stakingProvider,
        address indexed operator
    );

    struct StakingProviderInfo {
        address operator;
        bool operatorConfirmed;
        uint256 operatorStartTimestamp;
    }

    mapping(address => StakingProviderInfo) public stakingProviderInfo;

    function bondOperator(address _stakingProvider, address _operator)
        external
    {
        StakingProviderInfo storage info = stakingProviderInfo[
            _stakingProvider
        ];
        require(
            _operator != info.operator,
            "Specified operator is already bonded with this provider"
        );
        // Bond new operator (or unbond if _operator == address(0))
        info.operator = _operator;
        /* solhint-disable-next-line not-rely-on-time */
        info.operatorStartTimestamp = block.timestamp;
        info.operatorConfirmed = false;
        /* solhint-disable-next-line not-rely-on-time */
        emit OperatorBonded(_stakingProvider, _operator, block.timestamp);
    }

    function confirmOperatorAddress(address stakingProvider) external {
        StakingProviderInfo storage info = stakingProviderInfo[stakingProvider];
        require(
            !info.operatorConfirmed,
            "Operator address is already confirmed"
        );
        info.operatorConfirmed = true;
        emit OperatorConfirmed(stakingProvider, msg.sender);
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

import "../staking/ILegacyTokenStaking.sol";

contract KeepTokenStakingMock {
    struct OperatorStruct {
        address owner;
        address payable beneficiary;
        address authorizer;
        uint256 createdAt;
        uint256 undelegatedAt;
        uint256 amount;
        mapping(address => bool) eligibility;
    }

    mapping(address => OperatorStruct) internal operators;

    function setOperator(
        address operator,
        address owner,
        address payable beneficiary,
        address authorizer,
        uint256 createdAt,
        uint256 undelegatedAt,
        uint256 amount
    ) external {
        OperatorStruct storage operatorStrut = operators[operator];
        operatorStrut.owner = owner;
        operatorStrut.beneficiary = beneficiary;
        operatorStrut.authorizer = authorizer;
        operatorStrut.createdAt = createdAt;
        operatorStrut.undelegatedAt = undelegatedAt;
        operatorStrut.amount = amount;
    }

    function ownerOf(address _operator) external view returns (address) {
        return operators[_operator].owner;
    }
}

contract ManagedGrantMock {
    address public grantee;

    function setGrantee(address _grantee) external {
        grantee = _grantee;
    }
}

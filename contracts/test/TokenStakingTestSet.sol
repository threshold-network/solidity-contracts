// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

import "../staking/StakingProviders.sol";
import "../staking/IApplication.sol";

contract KeepTokenStakingMock is IKeepTokenStaking {
    struct OperatorStruct {
        address owner;
        address payable beneficiary;
        address authorizer;
        uint256 createdAt;
        uint256 undelegatedAt;
        uint256 amount;
        mapping(address => bool) eligibility;
    }

    mapping(address => OperatorStruct) operators;

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

    function setEligibility(
        address operator,
        address application,
        bool isEligible
    ) external {
        operators[operator].eligibility[application] = isEligible;
    }

    function seize(
        uint256 amountToSeize,
        uint256 rewardMultiplier,
        address tattletale,
        address[] memory misbehavedOperators
    ) external override {}

    function getDelegationInfo(address _operator)
        external
        view
        override
        returns (
            uint256 amount,
            uint256 createdAt,
            uint256 undelegatedAt
        )
    {
        amount = operators[_operator].amount;
        createdAt = operators[_operator].createdAt;
        undelegatedAt = operators[_operator].undelegatedAt;
    }

    function ownerOf(address _operator)
        external
        view
        override
        returns (address)
    {
        return operators[_operator].owner;
    }

    function beneficiaryOf(address _operator)
        external
        view
        override
        returns (address payable)
    {
        return operators[_operator].beneficiary;
    }

    function authorizerOf(address _operator)
        external
        view
        override
        returns (address)
    {
        return operators[_operator].authorizer;
    }

    function eligibleStake(address _operator, address _operatorContract)
        external
        view
        override
        returns (uint256 balance)
    {
        OperatorStruct storage operatorStrut = operators[_operator];
        if (operatorStrut.eligibility[_operatorContract]) {
            return operatorStrut.amount;
        }
        return 0;
    }
}

contract NuCypherTokenStakingMock is INuCypherStakingEscrow {
    function slashStaker(
        address _staker,
        uint256 _penalty,
        address _investigator,
        uint256 _reward
    ) external override {}

    function requestMerge(address staker)
        external
        view
        override
        returns (uint256)
    {}

    function getAllTokens(address _staker)
        external
        view
        override
        returns (uint256)
    {}
}

contract VendingMachineMock {
    uint256 public constant FLOATING_POINT_DIVISOR = 10**15;

    uint256 public immutable ratio;

    constructor(uint96 _wrappedTokenAllocation, uint96 _tTokenAllocation) {
        ratio =
            (FLOATING_POINT_DIVISOR * _tTokenAllocation) /
            _wrappedTokenAllocation;
    }
}

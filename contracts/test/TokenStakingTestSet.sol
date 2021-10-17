// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

import "../staking/StakingProviders.sol";
import "../staking/IApplication.sol";
import "../staking/TokenStaking.sol";

contract KeepTokenStakingMock is IKeepTokenStaking {
    using PercentUtils for uint256;

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
    mapping(address => uint256) public tattletales;

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

    function setAmount(address operator, uint256 amount) external {
        operators[operator].amount = amount;
    }

    function setUndelegatedAt(address operator, uint256 undelegatedAt)
        external
    {
        operators[operator].undelegatedAt = undelegatedAt;
    }

    function seize(
        uint256 amountToSeize,
        uint256 rewardMultiplier,
        address tattletale,
        address[] memory misbehavedOperators
    ) external override {
        require(amountToSeize > 0);
        // assumed only one will be slashed (per call)
        require(misbehavedOperators.length == 1);
        address operator = misbehavedOperators[0];
        operators[operator].amount -= amountToSeize;
        tattletales[tattletale] += amountToSeize.percent(5).percent(
            rewardMultiplier
        );
    }

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
    struct StakerStruct {
        uint256 value;
        address operator;
    }

    mapping(address => StakerStruct) public stakers;
    mapping(address => uint256) public investigators;

    function setStaker(address staker, uint256 value) external {
        stakers[staker].value = value;
    }

    function slashStaker(
        address _staker,
        uint256 _penalty,
        address _investigator,
        uint256 _reward
    ) external override {
        require(_penalty > 0);
        stakers[_staker].value -= _penalty;
        investigators[_investigator] += _reward;
    }

    function requestMerge(address staker, address operator)
        external
        override
        returns (uint256)
    {
        StakerStruct storage stakerStruct = stakers[staker];
        require(
            stakerStruct.operator == address(0) ||
                stakerStruct.operator == operator
        );
        if (stakerStruct.operator == address(0)) {
            stakerStruct.operator = operator;
        }
        return stakers[staker].value;
    }

    function getAllTokens(address staker)
        external
        view
        override
        returns (uint256)
    {
        return stakers[staker].value;
    }
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

contract ApplicationMock is IApplication {
    struct OperatorStruct {
        uint96 authorized;
        uint96 deauthorizing;
    }

    TokenStaking immutable tokenStaking;
    mapping(address => OperatorStruct) public operators;

    constructor(TokenStaking _tokenStaking) {
        tokenStaking = _tokenStaking;
    }

    function authorizationIncreased(address operator, uint96 amount)
        external
        override
    {
        operators[operator].authorized += amount;
    }

    function authorizationDecreaseRequested(address operator, uint96 amount)
        external
        override
    {
        operators[operator].deauthorizing = amount;
    }

    function involuntaryAuthorizationDecrease(address operator, uint96 amount)
        public
        virtual
        override
    {
        require(amount != 0);
        OperatorStruct storage operatorStruct = operators[operator];
        operatorStruct.authorized -= amount;
        if (operatorStruct.deauthorizing > operatorStruct.authorized) {
            operatorStruct.deauthorizing = operatorStruct.authorized;
        }
    }

    function approveAuthorizationDecrease(address operator) external {
        OperatorStruct storage operatorStruct = operators[operator];
        operatorStruct.authorized -= operatorStruct.deauthorizing;
        operatorStruct.deauthorizing = 0;
        tokenStaking.approveAuthorizationDecrease(operator);
    }
}

contract BrokenApplicationMock is ApplicationMock {
    constructor(TokenStaking _tokenStaking) ApplicationMock(_tokenStaking) {}

    function involuntaryAuthorizationDecrease(address, uint96)
        public
        pure
        override
    {
        revert();
    }
}

contract ExpensiveApplicationMock is ApplicationMock {
    uint256[] dummy;

    constructor(TokenStaking _tokenStaking) ApplicationMock(_tokenStaking) {}

    function involuntaryAuthorizationDecrease(address operator, uint96 amount)
        public
        override
    {
        super.involuntaryAuthorizationDecrease(operator, amount);
        for (uint256 i = 0; i < 12; i++) {
            dummy.push(i);
        }
    }
}

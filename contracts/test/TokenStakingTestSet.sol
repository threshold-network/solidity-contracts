// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../staking/ILegacyTokenStaking.sol";
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

    mapping(address => OperatorStruct) internal operators;
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
        require(amountToSeize > 0, "Amount to slash must be greater than zero");
        // assumed only one will be slashed (per call)
        require(
            misbehavedOperators.length == 1,
            "Only one operator per call in tests"
        );
        address operator = misbehavedOperators[0];
        operators[operator].amount -= amountToSeize;
        tattletales[tattletale] += amountToSeize.percent(5).percent(
            rewardMultiplier
        );
    }

    function getDelegationInfo(address operator)
        external
        view
        override
        returns (
            uint256 amount,
            uint256 createdAt,
            uint256 undelegatedAt
        )
    {
        amount = operators[operator].amount;
        createdAt = operators[operator].createdAt;
        undelegatedAt = operators[operator].undelegatedAt;
    }

    function ownerOf(address operator)
        external
        view
        override
        returns (address)
    {
        return operators[operator].owner;
    }

    function beneficiaryOf(address operator)
        external
        view
        override
        returns (address payable)
    {
        return operators[operator].beneficiary;
    }

    function authorizerOf(address operator)
        external
        view
        override
        returns (address)
    {
        return operators[operator].authorizer;
    }

    function eligibleStake(address operator, address operatorContract)
        external
        view
        override
        returns (uint256 balance)
    {
        OperatorStruct storage operatorStrut = operators[operator];
        if (operatorStrut.eligibility[operatorContract]) {
            return operatorStrut.amount;
        }
        return 0;
    }
}

contract NuCypherTokenStakingMock is INuCypherStakingEscrow {
    struct StakerStruct {
        uint256 value;
        address stakingProvider;
    }

    mapping(address => StakerStruct) public stakers;
    mapping(address => uint256) public investigators;

    function setStaker(address staker, uint256 value) external {
        stakers[staker].value = value;
    }

    function slashStaker(
        address staker,
        uint256 penalty,
        address investigator,
        uint256 reward
    ) external override {
        require(penalty > 0, "Amount to slash must be greater than zero");
        stakers[staker].value -= penalty;
        investigators[investigator] += reward;
    }

    function requestMerge(address staker, address stakingProvider)
        external
        override
        returns (uint256)
    {
        StakerStruct storage stakerStruct = stakers[staker];
        require(
            stakerStruct.stakingProvider == address(0) ||
                stakerStruct.stakingProvider == stakingProvider,
            "Another provider was already set for this staker"
        );
        if (stakerStruct.stakingProvider == address(0)) {
            stakerStruct.stakingProvider = stakingProvider;
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
    struct StakingProviderStruct {
        uint96 authorized;
        uint96 deauthorizingTo;
    }

    TokenStaking internal immutable tokenStaking;
    mapping(address => StakingProviderStruct) public stakingProviders;

    constructor(TokenStaking _tokenStaking) {
        tokenStaking = _tokenStaking;
    }

    function authorizationIncreased(
        address stakingProvider,
        uint96,
        uint96 toAmount
    ) external override {
        stakingProviders[stakingProvider].authorized = toAmount;
    }

    function authorizationDecreaseRequested(
        address stakingProvider,
        uint96,
        uint96 toAmount
    ) external override {
        stakingProviders[stakingProvider].deauthorizingTo = toAmount;
    }

    function approveAuthorizationDecrease(address stakingProvider) external {
        StakingProviderStruct storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        stakingProviderStruct.authorized = tokenStaking
            .approveAuthorizationDecrease(stakingProvider);
    }

    function slash(uint96 amount, address[] memory _stakingProviders) external {
        tokenStaking.slash(amount, _stakingProviders);
    }

    function seize(
        uint96 amount,
        uint256 rewardMultiplier,
        address notifier,
        address[] memory _stakingProviders
    ) external {
        tokenStaking.seize(
            amount,
            rewardMultiplier,
            notifier,
            _stakingProviders
        );
    }

    function involuntaryAuthorizationDecrease(
        address stakingProvider,
        uint96,
        uint96 toAmount
    ) public virtual override {
        StakingProviderStruct storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        require(
            toAmount != stakingProviderStruct.authorized,
            "Nothing to decrease"
        );
        uint96 decrease = stakingProviderStruct.authorized - toAmount;
        if (stakingProviderStruct.deauthorizingTo > decrease) {
            stakingProviderStruct.deauthorizingTo -= decrease;
        } else {
            stakingProviderStruct.deauthorizingTo = 0;
        }
        stakingProviderStruct.authorized = toAmount;
    }

    function minimumAuthorization() external view returns (uint96) {
        return 0;
    }
}

contract BrokenApplicationMock is ApplicationMock {
    constructor(TokenStaking _tokenStaking) ApplicationMock(_tokenStaking) {}

    function involuntaryAuthorizationDecrease(
        address,
        uint96,
        uint96
    ) public pure override {
        revert("Broken application");
    }
}

contract ExpensiveApplicationMock is ApplicationMock {
    uint256[] private dummy;

    constructor(TokenStaking _tokenStaking) ApplicationMock(_tokenStaking) {}

    function involuntaryAuthorizationDecrease(
        address stakingProvider,
        uint96 fromAmount,
        uint96 toAmount
    ) public override {
        super.involuntaryAuthorizationDecrease(
            stakingProvider,
            fromAmount,
            toAmount
        );
        for (uint256 i = 0; i < 12; i++) {
            dummy.push(i);
        }
    }
}

contract ManagedGrantMock {
    address public grantee;

    //slither-disable-next-line missing-zero-check
    function setGrantee(address _grantee) external {
        grantee = _grantee;
    }
}

contract ExtendedTokenStaking is TokenStaking {
    constructor(
        T _token,
        IKeepTokenStaking _keepStakingContract,
        INuCypherStakingEscrow _nucypherStakingContract,
        VendingMachine _keepVendingMachine,
        VendingMachine _nucypherVendingMachine,
        KeepStake _keepStake
    )
        TokenStaking(
            _token,
            _keepStakingContract,
            _nucypherStakingContract,
            _keepVendingMachine,
            _nucypherVendingMachine,
            _keepStake
        )
    {}

    function cleanAuthorizedApplications(
        address stakingProvider,
        uint256 numberToDelete
    ) external {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        cleanAuthorizedApplications(stakingProviderStruct, numberToDelete);
    }

    function setAuthorization(
        address stakingProvider,
        address application,
        uint96 amount
    ) external {
        stakingProviders[stakingProvider]
            .authorizations[application]
            .authorized = amount;
    }

    function setAuthorizedApplications(
        address stakingProvider,
        address[] memory _applications
    ) external {
        stakingProviders[stakingProvider]
            .authorizedApplications = _applications;
    }

    // to decrease size of test contract
    function processSlashing(uint256 count) external override {}

    function getAuthorizedApplications(address stakingProvider)
        external
        view
        returns (address[] memory)
    {
        return stakingProviders[stakingProvider].authorizedApplications;
    }
}

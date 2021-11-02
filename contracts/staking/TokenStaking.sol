// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "./IStaking.sol";
import "./IStakingProviders.sol";
import "./IApplication.sol";
import "../token/T.sol";
import "../vending/VendingMachine.sol";
import "../utils/PercentUtils.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice TokenStaking is the main staking contract of the Threshold Network.
///         Apart from the basic usage of enabling T stakes, it also acts as a
///         sort of "meta-staking" contract, accepting existing legacy NU/KEEP
///         stakes. Additionally, it serves as application manager for the apps
///         that run on the Threshold Network. Note that legacy NU/KEEP staking
///         contracts see TokenStaking as an application (e.g., slashing is
///         requested by TokenStaking and performed by the legacy contracts).
contract TokenStaking is Ownable, IStaking {
    using SafeERC20 for T;
    using PercentUtils for uint256;
    using SafeCast for uint256;

    enum StakingProvider {
        NU,
        KEEP,
        T
    }

    struct OperatorInfo {
        uint96 nuInTStake;
        address owner;
        uint96 keepInTStake;
        address payable beneficiary;
        uint96 tStake;
        address authorizer;
        mapping(address => AppAuthorization) authorizations;
        address[] authorizedApplications;
        uint256 startTStakingTimestamp;
    }

    struct AppAuthorization {
        uint96 authorized;
        uint96 deauthorizing;
    }

    struct ApplicationInfo {
        bool approved;
        bool disabled;
        address panicButton;
    }

    struct SlashingEvent {
        address operator;
        uint96 amount;
    }

    uint256 public constant SLASHING_REWARD_PERCENT = 5;
    uint256 public constant MIN_STAKE_TIME = 24 hours;
    uint256 public constant GAS_LIMIT_AUTHORIZATION_DECREASE = 250000;

    T public immutable token;
    IKeepTokenStaking public immutable keepStakingContract;
    INuCypherStakingEscrow public immutable nucypherStakingContract;

    uint256 public immutable keepFloatingPointDivisor;
    uint256 public immutable keepRatio;
    uint256 public immutable nucypherFloatingPointDivisor;
    uint256 public immutable nucypherRatio;

    uint96 public minTStakeAmount;
    uint256 public authorizationCeiling;
    uint96 public stakeDiscrepancyPenalty;
    uint256 public stakeDiscrepancyRewardMultiplier;

    uint256 public notifiersTreasury;
    uint256 public notificationReward;

    mapping(address => OperatorInfo) public operators;
    mapping(address => ApplicationInfo) public applicationInfo;
    address[] public applications;

    SlashingEvent[] public slashingQueue;
    uint256 public slashingQueueIndex = 0;

    event TStaked(address indexed owner, address indexed operator);
    event KeepStaked(address indexed owner, address indexed operator);
    event NuStaked(address indexed owner, address indexed operator);
    event OperatorStaked(
        address indexed operator,
        address indexed beneficiary,
        address indexed authorizer,
        uint96 amount
    );
    event MinimumStakeAmountSet(uint96 amount);
    event ApplicationApproved(address indexed application);
    event AuthorizationIncreased(
        address indexed operator,
        address indexed application,
        uint96 amount
    );
    event AuthorizationDecreaseRequested(
        address indexed operator,
        address indexed application,
        uint96 amount
    );
    event AuthorizationDecreaseApproved(
        address indexed operator,
        address indexed application,
        uint96 amount
    );
    event AuthorizationInvoluntaryDecreased(
        address indexed operator,
        address indexed application,
        uint96 amount,
        bool indexed successfulCall
    );
    event ApplicationDisabled(address indexed application);
    event PanicButtonSet(
        address indexed application,
        address indexed panicButton
    );
    event AuthorizationCeilingSet(uint256 ceiling);
    event ToppedUp(address indexed operator, uint96 amount);
    event Unstaked(address indexed operator, uint96 amount);
    event TokensSeized(address indexed operator, uint96 amount);
    event StakeDiscrepancyPenaltySet(uint96 penalty, uint256 rewardMultiplier);
    event NotificationRewardSet(uint96 reward);
    event NotificationRewardPushed(uint96 reward);
    event NotifierRewarded(address indexed notifier, uint256 amount);
    event SlashingProcessed(
        address indexed caller,
        uint256 count,
        uint256 tAmount
    );

    modifier onlyGovernance() {
        require(owner() == msg.sender, "Caller is not the governance");
        _;
    }

    modifier onlyPanicButtonOf(address application) {
        require(
            applicationInfo[application].panicButton == msg.sender,
            "Caller is not the address of panic button"
        );
        _;
    }

    modifier onlyAuthorizerOf(address operator) {
        //slither-disable-next-line incorrect-equality
        require(
            operators[operator].authorizer == msg.sender,
            "Not operator authorizer"
        );
        _;
    }

    modifier onlyOwnerOrOperator(address operator) {
        //slither-disable-next-line incorrect-equality
        require(
            operator == msg.sender || operators[operator].owner == msg.sender,
            "Only owner and operator can execute this method"
        );
        _;
    }

    /// @param _token Address of T token contract
    /// @param _keepStakingContract Address of Keep staking contract
    /// @param _nucypherStakingContract Address of NuCypher staking contract
    /// @param _keepVendingMachine Address of Keep vending machine
    /// @param _nucypherVendingMachine Address of NuCypher vending machine
    constructor(
        T _token,
        IKeepTokenStaking _keepStakingContract,
        INuCypherStakingEscrow _nucypherStakingContract,
        VendingMachine _keepVendingMachine,
        VendingMachine _nucypherVendingMachine
    ) {
        require(
            _token.totalSupply() > 0 &&
                _keepStakingContract.ownerOf(address(0)) == address(0) &&
                _nucypherStakingContract.getAllTokens(address(0)) == 0,
            "Wrong input parameters"
        );
        token = _token;
        keepStakingContract = _keepStakingContract;
        nucypherStakingContract = _nucypherStakingContract;

        keepFloatingPointDivisor = _keepVendingMachine.FLOATING_POINT_DIVISOR();
        keepRatio = _keepVendingMachine.ratio();
        nucypherFloatingPointDivisor = _nucypherVendingMachine
            .FLOATING_POINT_DIVISOR();
        nucypherRatio = _nucypherVendingMachine.ratio();
    }

    //
    //
    // Delegating a stake
    //
    //

    /// @notice Creates a delegation with `msg.sender` owner with the given
    ///         operator, beneficiary, and authorizer. Transfers the given
    ///         amount of T to the staking contract.
    /// @dev The owner of the delegation needs to have the amount approved to
    ///      transfer to the staking contract.
    function stake(
        address _operator,
        address payable _beneficiary,
        address _authorizer,
        uint96 _amount
    ) external override {
        require(_operator != address(0), "Operator must be specified");
        require(_beneficiary != address(0), "Beneficiary must be specified");
        require(_authorizer != address(0), "Authorizer must be specified");
        OperatorInfo storage operator = operators[_operator];
        (, uint256 createdAt, ) = keepStakingContract.getDelegationInfo(
            _operator
        );
        require(
            createdAt == 0 && operator.owner == address(0),
            "Operator is already in use"
        );
        require(
            _amount > minTStakeAmount,
            "Amount to stake must be greater than minimum"
        );
        operator.owner = msg.sender;
        operator.authorizer = _authorizer;
        operator.beneficiary = _beneficiary;

        operator.tStake = _amount;
        /* solhint-disable-next-line not-rely-on-time */
        operator.startTStakingTimestamp = block.timestamp;

        emit TStaked(msg.sender, _operator);
        emit OperatorStaked(
            _operator,
            operator.beneficiary,
            operator.authorizer,
            _amount
        );
        token.safeTransferFrom(msg.sender, address(this), _amount);
    }

    /// @notice Copies delegation from the legacy KEEP staking contract to T
    ///         staking contract. No tokens are transferred. Caches the active
    ///         stake amount from KEEP staking contract. Can be called by
    ///         anyone.
    function stakeKeep(address _operator) external override {
        require(_operator != address(0), "Operator must be specified");
        OperatorInfo storage operator = operators[_operator];

        require(
            operator.owner == address(0),
            "Can't stake KEEP for this operator"
        );

        uint96 tAmount = getKeepAmountInT(_operator);

        operator.keepInTStake = tAmount;
        operator.owner = keepStakingContract.ownerOf(_operator);
        operator.authorizer = keepStakingContract.authorizerOf(_operator);
        operator.beneficiary = keepStakingContract.beneficiaryOf(_operator);
        emit KeepStaked(operator.owner, _operator);
        emit OperatorStaked(
            _operator,
            operator.beneficiary,
            operator.authorizer,
            tAmount
        );
    }

    /// @notice Copies delegation from the legacy NU staking contract to T
    ///         staking contract, additionally appointing beneficiary and
    ///         authorizer roles. Caches the amount staked in NU staking
    ///         contract. Can be called only by the original delegation owner.
    function stakeNu(
        address _operator,
        address payable _beneficiary,
        address _authorizer
    ) external override {
        require(_operator != address(0), "Operator must be specified");
        require(_beneficiary != address(0), "Beneficiary must be specified");
        require(_authorizer != address(0), "Authorizer must be specified");
        OperatorInfo storage operator = operators[_operator];
        (, uint256 createdAt, ) = keepStakingContract.getDelegationInfo(
            _operator
        );
        require(
            createdAt == 0 && operator.owner == address(0),
            "Operator is already in use"
        );

        uint256 nuStakeAmount = nucypherStakingContract.requestMerge(
            msg.sender,
            _operator
        );
        (uint96 tAmount, ) = nuToT(nuStakeAmount);
        require(tAmount > 0, "Nothing to sync");

        operator.nuInTStake = tAmount;
        operator.owner = msg.sender;
        operator.authorizer = _authorizer;
        operator.beneficiary = _beneficiary;

        emit NuStaked(msg.sender, _operator);
        emit OperatorStaked(
            _operator,
            operator.beneficiary,
            operator.authorizer,
            tAmount
        );
    }

    /// @notice Allows the Governance to set the minimum required stake amount.
    ///         This amount is required to protect against griefing the staking
    ///         contract and individual applications are allowed to require
    ///         higher minimum stakes if necessary.
    function setMinimumStakeAmount(uint96 amount)
        external
        override
        onlyGovernance
    {
        minTStakeAmount = amount;
        emit MinimumStakeAmountSet(amount);
    }

    //
    //
    // Authorizing an application
    //
    //

    /// @notice Allows the Governance to approve the particular application
    ///         before individual stake authorizers are able to authorize it.
    function approveApplication(address application)
        external
        override
        onlyGovernance
    {
        require(application != address(0), "Application must be specified");
        ApplicationInfo storage info = applicationInfo[application];
        require(
            !info.approved || info.disabled,
            "Application has already been approved"
        );
        info.approved = true;
        info.disabled = false;

        bool existingApplication = false;
        for (uint256 i = 0; i < applications.length; i++) {
            if (applications[i] == application) {
                existingApplication = true;
                break;
            }
        }
        if (!existingApplication) {
            applications.push(application);
        }
        emit ApplicationApproved(application);
    }

    /// @notice Increases the authorization of the given operator for the given
    ///         application by the given amount. Can only be called by the given
    ///         operator’s authorizer.
    /// @dev Calls `authorizationIncreased(address operator, uint256 amount)`
    ///      on the given application to notify the application about
    ///      authorization change. See `IApplication`.
    function increaseAuthorization(
        address _operator,
        address _application,
        uint96 _amount
    ) external override onlyAuthorizerOf(_operator) {
        ApplicationInfo storage application = applicationInfo[_application];
        require(application.approved, "Application is not approved");
        require(!application.disabled, "Application is disabled");

        OperatorInfo storage operator = operators[_operator];
        AppAuthorization storage authorization = operator.authorizations[
            _application
        ];
        if (authorization.authorized == 0) {
            require(
                authorizationCeiling == 0 ||
                    operator.authorizedApplications.length <
                    authorizationCeiling,
                "Can't authorize more applications"
            );
            operator.authorizedApplications.push(_application);
        }

        uint96 availableTValue = getAvailableToAuthorize(
            _operator,
            _application
        );
        require(availableTValue >= _amount, "Not enough stake to authorize");
        authorization.authorized += _amount;
        emit AuthorizationIncreased(_operator, _application, _amount);
        IApplication(_application).authorizationIncreased(_operator, _amount);
    }

    /// @notice Requests decrease of the authorization for the given operator on
    ///         the given application by all authorized amount.
    ///         It may not change the authorized amount immediatelly. When
    ///         it happens depends on the application. Can only be called by the
    ///         given operator’s authorizer. Overwrites pending authorization
    ///         decrease for the given operator and application.
    /// @dev Calls `authorizationDecreaseRequested(address operator, uint256 amount)`
    ///      on the given application. See `IApplication`.
    function requestAuthorizationDecrease(address operator, address application)
        external
    {
        uint96 authorized = operators[operator]
            .authorizations[application]
            .authorized;
        requestAuthorizationDecrease(operator, application, authorized);
    }

    /// @notice Requests decrease of the all authorizations for the given operator on
    ///         the all applications by all authorized amount.
    ///         It may not change the authorized amount immediatelly. When
    ///         it happens depends on the application. Can only be called by the
    ///         given operator’s authorizer. Overwrites pending authorization
    ///         decrease for the given operator and application.
    /// @dev Calls `authorizationDecreaseRequested(address operator, uint256 amount)`
    ///      for each authorized application. See `IApplication`.
    function requestAuthorizationDecrease(address _operator) external {
        OperatorInfo storage operator = operators[_operator];
        uint96 deauthorizing = 0;
        for (uint256 i = 0; i < operator.authorizedApplications.length; i++) {
            address application = operator.authorizedApplications[i];
            uint96 authorized = operator.authorizations[application].authorized;
            if (authorized > 0) {
                requestAuthorizationDecrease(
                    _operator,
                    application,
                    authorized
                );
                deauthorizing += authorized;
            }
        }

        require(deauthorizing > 0, "Nothing was authorized");
    }

    /// @notice Called by the application at its discretion to approve the
    ///         previously requested authorization decrease request. Can only be
    ///         called by the application that was previously requested to
    ///         decrease the authorization for that operator.
    function approveAuthorizationDecrease(address _operator) external override {
        ApplicationInfo storage application = applicationInfo[msg.sender];
        require(!application.disabled, "Application is disabled");

        OperatorInfo storage operator = operators[_operator];
        AppAuthorization storage authorization = operator.authorizations[
            msg.sender
        ];
        require(
            authorization.deauthorizing > 0,
            "There is no deauthorizing in process"
        );

        emit AuthorizationDecreaseApproved(
            _operator,
            msg.sender,
            authorization.deauthorizing
        );
        authorization.authorized -= authorization.deauthorizing;
        authorization.deauthorizing = 0;

        // remove application from an array
        if (authorization.authorized == 0) {
            uint256 length = operator.authorizedApplications.length;
            for (uint256 index = 0; index < length - 1; index++) {
                if (operator.authorizedApplications[index] == msg.sender) {
                    operator.authorizedApplications[index] = operator
                        .authorizedApplications[length - 1];
                    break;
                }
            }
            operator.authorizedApplications.pop();
        }
    }

    /// @notice Disables the given application’s eligibility to slash stakes.
    ///         Can be called only by the Panic Button of the particular
    ///         application. The disabled application can not slash stakes until
    ///         it is approved again by the Governance using `approveApplication`
    ///         function. Should be used only in case of an emergency.
    function disableApplication(address _application)
        external
        override
        onlyPanicButtonOf(_application)
    {
        ApplicationInfo storage application = applicationInfo[_application];
        require(!application.disabled, "Application has already been disabled");
        application.disabled = true;
        emit ApplicationDisabled(_application);
    }

    /// @notice Sets the Panic Button role for the given application to the
    ///         provided address. Can only be called by the Governance. If the
    ///         Panic Button for the given application should be disabled, the
    ///         role address should can set to 0x0 address.
    function setPanicButton(address _application, address _panicButton)
        external
        override
        onlyGovernance
    {
        ApplicationInfo storage application = applicationInfo[_application];
        require(application.approved, "Application is not approved");
        application.panicButton = _panicButton;
        emit PanicButtonSet(_application, _panicButton);
    }

    /// @notice Sets the maximum number of applications one operator can
    ///         authorize. Used to protect against DoSing slashing queue.
    ///         Can only be called by the Governance.
    function setAuthorizationCeiling(uint256 ceiling)
        external
        override
        onlyGovernance
    {
        authorizationCeiling = ceiling;
        emit AuthorizationCeilingSet(ceiling);
    }

    //
    //
    // Stake top-up
    //
    //

    /// @notice Increases the amount of the stake for the given operator.
    ///         Can be called only by the owner or operator.
    /// @dev The sender of this transaction needs to have the amount approved to
    ///      transfer to the staking contract.
    function topUp(address _operator, uint96 _amount)
        external
        override
        onlyOwnerOrOperator(_operator)
    {
        require(_amount > 0, "Amount to top-up must be greater than 0");
        OperatorInfo storage operator = operators[_operator];
        require(operator.owner != address(0), "Operator has no stake");
        operator.tStake += _amount;
        emit ToppedUp(_operator, _amount);
        token.safeTransferFrom(msg.sender, address(this), _amount);
    }

    /// @notice Propagates information about stake top-up from the legacy KEEP
    ///         staking contract to T staking contract. Can be called only by
    ///         the owner or operator.
    function topUpKeep(address _operator)
        external
        override
        onlyOwnerOrOperator(_operator)
    {
        OperatorInfo storage operator = operators[_operator];
        require(operator.owner != address(0), "Operator has no stake");

        uint96 tAmount = getKeepAmountInT(_operator);
        require(
            tAmount > operator.keepInTStake,
            "Amount in Keep contract is equal to or less than the stored amount"
        );

        emit ToppedUp(_operator, tAmount - operator.keepInTStake);
        operator.keepInTStake = tAmount;
    }

    /// @notice Propagates information about stake top-up from the legacy NU
    ///         staking contract to T staking contract. Can be called only by
    ///         the owner or operator.
    function topUpNu(address _operator)
        external
        override
        onlyOwnerOrOperator(_operator)
    {
        OperatorInfo storage operator = operators[_operator];
        require(operator.owner != address(0), "Operator has no stake");

        uint256 nuStakeAmount = nucypherStakingContract.requestMerge(
            operator.owner,
            _operator
        );
        (uint96 tAmount, ) = nuToT(nuStakeAmount);
        require(
            tAmount > operator.nuInTStake,
            "Amount in NuCypher contract is equal to or less than the stored amount"
        );

        emit ToppedUp(_operator, tAmount - operator.nuInTStake);
        operator.nuInTStake = tAmount;
    }

    //
    //
    // Undelegating a stake (unstaking)
    //
    //

    /// @notice Reduces the liquid T stake amount by the provided amount and
    ///         withdraws T to the owner. Reverts if there is at least one
    ///         authorization higher than the sum of the legacy stake and
    ///         remaining liquid T stake or if the unstake amount is higher than
    ///         the liquid T stake amount. Can be called only by the owner or
    ///         operator.
    function unstakeT(address _operator, uint96 _amount)
        external
        override
        onlyOwnerOrOperator(_operator)
    {
        OperatorInfo storage operator = operators[_operator];
        require(operator.owner != address(0), "Operator has no stake");
        require(
            _amount > 0 &&
                _amount + getMinStaked(_operator, StakingProvider.T) <=
                operator.tStake,
            "Can't unstake specified amount of tokens"
        );
        operator.tStake -= _amount;
        require(
            operator.tStake >= minTStakeAmount ||
                operator.startTStakingTimestamp + MIN_STAKE_TIME <=
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp,
            "Unstaking is possible only after 24 hours"
        );
        emit Unstaked(_operator, _amount);
        token.safeTransfer(operator.owner, _amount);
    }

    /// @notice Sets the legacy KEEP staking contract active stake amount cached
    ///         in T staking contract to 0. Reverts if the amount of liquid T
    ///         staked in T staking contract is lower than the highest
    ///         application authorization. This function allows to unstake from
    ///         KEEP staking contract and still being able to operate in T
    ///         network and earning rewards based on the liquid T staked. Can be
    ///         called only by the delegation owner and operator.
    function unstakeKeep(address _operator)
        external
        override
        onlyOwnerOrOperator(_operator)
    {
        OperatorInfo storage operator = operators[_operator];
        require(operator.owner != address(0), "Operator has no stake");
        require(operator.keepInTStake != 0, "Nothing to unstake");
        require(
            getMinStaked(_operator, StakingProvider.KEEP) == 0,
            "At least one application prevents from unstaking"
        );
        emit Unstaked(_operator, operator.keepInTStake);
        operator.keepInTStake = 0;
    }

    /// @notice Reduces cached legacy NU stake amount by the provided amount.
    ///         Reverts if there is at least one authorization higher than the
    ///         sum of remaining legacy NU stake and liquid T stake for that
    ///         operator or if the untaked amount is higher than the cached
    ///         legacy stake amount. If succeeded, the legacy NU stake can be
    ///         partially or fully undelegated on the legacy staking contract.
    ///         This function allows to unstake from NU staking contract and
    ///         still being able to operate in T network and earning rewards
    ///         based on the liquid T staked. Can be called only by the
    ///         delegation owner and operator.
    function unstakeNu(address _operator, uint96 _amount)
        external
        override
        onlyOwnerOrOperator(_operator)
    {
        OperatorInfo storage operator = operators[_operator];
        require(operator.owner != address(0), "Operator has no stake");
        (, uint96 tRemainder) = tToNu(_amount);
        _amount -= tRemainder;
        require(
            _amount > 0 &&
                _amount + getMinStaked(_operator, StakingProvider.NU) <=
                operator.nuInTStake,
            "Can't unstake specified amount of tokens"
        );
        operator.nuInTStake -= _amount;

        emit Unstaked(_operator, _amount);
    }

    /// @notice Sets cached legacy stake amount to 0, sets the liquid T stake
    ///         amount to 0 and withdraws all liquid T from the stake to the
    ///         owner. Reverts if there is at least one non-zero authorization.
    ///         Can be called only by the delegation owner and operator.
    function unstakeAll(address _operator)
        external
        override
        onlyOwnerOrOperator(_operator)
    {
        OperatorInfo storage operator = operators[_operator];
        require(operator.owner != address(0), "Operator has no stake");
        require(
            operator.authorizedApplications.length == 0,
            "At least one application is still authorized"
        );
        require(
            operator.tStake == 0 ||
                minTStakeAmount == 0 ||
                operator.startTStakingTimestamp + MIN_STAKE_TIME <=
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp,
            "Unstaking is possible only after 24 hours"
        );

        emit Unstaked(
            _operator,
            operator.tStake + operator.keepInTStake + operator.nuInTStake
        );
        uint96 amount = operator.tStake;
        operator.tStake = 0;
        operator.keepInTStake = 0;
        operator.nuInTStake = 0;
        if (amount > 0) {
            token.safeTransfer(operator.owner, amount);
        }
    }

    //
    //
    // Keeping information in sync
    //
    //

    /// @notice Notifies about the discrepancy between legacy KEEP active stake
    ///         and the amount cached in T staking contract. Slashes the operator
    ///         in case the amount cached is higher than the actual active stake
    ///         amount in KEEP staking contract. Needs to update authorizations
    ///         of all affected applications and execute an involuntary
    ///         authorization decrease on all affected applications. Can be called
    ///         by anyone, notifier receives a reward.
    function notifyKeepStakeDiscrepancy(address _operator) external override {
        OperatorInfo storage operator = operators[_operator];
        require(operator.keepInTStake > 0, "Nothing to slash");

        (uint256 keepStakeAmount, , uint256 undelegatedAt) = keepStakingContract
            .getDelegationInfo(_operator);
        (uint96 tAmount, ) = keepToT(keepStakeAmount);

        require(
            operator.keepInTStake > tAmount || undelegatedAt != 0,
            "There is no discrepancy"
        );
        operator.keepInTStake = tAmount;
        seizeKeep(
            operator,
            _operator,
            stakeDiscrepancyPenalty,
            stakeDiscrepancyRewardMultiplier
        );

        emit TokensSeized(_operator, tAmount - operator.keepInTStake);
        if (undelegatedAt != 0) {
            operator.keepInTStake = 0;
        }

        authorizationDecrease(_operator, operator);
    }

    /// @notice Notifies about the discrepancy between legacy NU active stake
    ///         and the amount cached in T staking contract. Slashes the
    ///         operator in case the amount cached is higher than the actual
    ///         active stake amount in NU staking contract. Needs to update
    ///         authorizations of all affected applications and execute an
    ///         involuntary authorization decrease on all affected applications.
    ///         Can be called by anyone, notifier receives a reward.
    /// @dev    Real discrepancy between T and Nu is impossible.
    ///         This method is a safeguard in case of bugs in NuCypher staking
    ///         contract
    function notifyNuStakeDiscrepancy(address _operator) external override {
        OperatorInfo storage operator = operators[_operator];
        require(operator.nuInTStake > 0, "Nothing to slash");

        uint256 nuStakeAmount = nucypherStakingContract.getAllTokens(
            operator.owner
        );
        (uint96 tAmount, ) = nuToT(nuStakeAmount);

        require(operator.nuInTStake > tAmount, "There is no discrepancy");
        operator.nuInTStake = tAmount;
        seizeNu(
            operator,
            stakeDiscrepancyPenalty,
            stakeDiscrepancyRewardMultiplier
        );

        emit TokensSeized(_operator, tAmount - operator.nuInTStake);
        authorizationDecrease(_operator, operator);
    }

    /// @notice Sets the penalty amount for stake discrepancy and reward
    ///         multiplier for reporting it. The penalty is seized from the
    ///         operator account, and 5% of the penalty, scaled by the
    ///         multiplier, is given to the notifier. The rest of the tokens are
    ///         burned. Can only be called by the Governance. See `seize` function.
    function setStakeDiscrepancyPenalty(
        uint96 penalty,
        uint256 rewardMultiplier
    ) external override onlyGovernance {
        // TODO optimization: can save NU and KEEP equivalents to exclude conversion during slashing
        stakeDiscrepancyPenalty = penalty;
        stakeDiscrepancyRewardMultiplier = rewardMultiplier;
        emit StakeDiscrepancyPenaltySet(penalty, rewardMultiplier);
    }

    /// @notice Sets reward in T tokens for notification of misbehaviour
    ///         of one operator
    function setNotificationReward(uint96 reward) external onlyGovernance {
        notificationReward = reward;
        emit NotificationRewardSet(reward);
    }

    /// @notice Transfer some amount of T tokens as reward for notifications
    ///         of misbehaviour
    function pushNotificationReward(uint96 reward) external {
        require(reward > 0, "Reward must be specified");
        notifiersTreasury += reward;
        emit NotificationRewardPushed(reward);
        token.safeTransferFrom(msg.sender, address(this), reward);
    }

    /// @notice Adds operators to the slashing queue along with the amount that
    ///         should be slashed from each one of them. Can only be called by
    ///         application authorized for all operators in the array.
    function slash(uint96 _amount, address[] memory _operators)
        external
        override
    {
        notify(_amount, 0, address(0), _operators);
    }

    /// @notice Adds operators to the slashing queue along with the amount.
    ///         The notifier will receive reward per each operator from
    ///         notifiers treasury. Can only be called by application
    ///         authorized for all operators in the array.
    function seize(
        uint96 _amount,
        uint256 _rewardMultiplier,
        address _notifier,
        address[] memory _operators
    ) external override {
        notify(_amount, _rewardMultiplier, _notifier, _operators);
    }

    /// @notice Takes the given number of queued slashing operations and
    ///         processes them. Receives 5% of the slashed amount.
    ///         Executes `involuntaryAuthorizationDecrease` function on each
    ///         affected application.
    function processSlashing(uint256 count) external override {
        require(
            slashingQueueIndex < slashingQueue.length && count > 0,
            "Nothing to process"
        );

        uint256 maxIndex = slashingQueueIndex + count;
        maxIndex = Math.min(maxIndex, slashingQueue.length);
        count = maxIndex - slashingQueueIndex;
        uint96 tAmountToBurn = 0;

        uint256 index = slashingQueueIndex;
        for (; index < maxIndex; index++) {
            SlashingEvent storage slashing = slashingQueue[index];
            tAmountToBurn += processSlashing(slashing);
        }
        slashingQueueIndex = index;

        uint256 tProcessorReward = uint256(tAmountToBurn).percent(
            SLASHING_REWARD_PERCENT
        );
        notifiersTreasury += tAmountToBurn - tProcessorReward.toUint96();
        emit SlashingProcessed(msg.sender, count, tProcessorReward);
        if (tProcessorReward > 0) {
            token.safeTransfer(msg.sender, tProcessorReward);
        }
    }

    //
    //
    // Auxiliary functions
    //
    //

    /// @notice Returns the authorized stake amount of the operator for the
    ///         application.
    function authorizedStake(address operator, address application)
        external
        view
        override
        returns (uint96)
    {
        return operators[operator].authorizations[application].authorized;
    }

    /// @notice Returns staked amount of T, Keep and Nu for the specified
    ///         operator.
    /// @dev    All values are in T denomination
    function stakes(address _operator)
        external
        view
        returns (
            uint96 tStake,
            uint96 keepInTStake,
            uint96 nuInTStake
        )
    {
        OperatorInfo storage operator = operators[_operator];
        tStake = operator.tStake;
        keepInTStake = operator.keepInTStake;
        nuInTStake = operator.nuInTStake;
    }

    /// @notice Returns start staking timestamp for T stake.
    /// @dev    This value is set at most once, and only when a stake is created
    ///         with T tokens. If a stake is created from a legacy stake,
    ///         this value will remain as zero
    function getStartTStakingTimestamp(address operator)
        external
        view
        returns (uint256)
    {
        return operators[operator].startTStakingTimestamp;
    }

    /// @notice Returns staked amount of NU for the specified operator
    function stakedNu(address operator)
        external
        view
        returns (uint256 nuAmount)
    {
        (nuAmount, ) = tToNu(operators[operator].nuInTStake);
    }

    /// @notice Gets the stake owner for the specified operator address.
    /// @return Stake owner address.
    function ownerOf(address operator) external view returns (address) {
        return operators[operator].owner;
    }

    /// @notice Gets the beneficiary for the specified operator address.
    /// @return Beneficiary address.
    function beneficiaryOf(address operator)
        external
        view
        returns (address payable)
    {
        return operators[operator].beneficiary;
    }

    /// @notice Gets the authorizer for the specified operator address.
    /// @return Authorizer address.
    function authorizerOf(address operator) external view returns (address) {
        return operators[operator].authorizer;
    }

    /// @notice Checks if the specified operator has a stake delegated and if it
    ///         has been authorized for at least one application. If this
    ///         function returns true, off-chain client of the given operator is
    ///         eligible to join the network.
    function hasStakeDelegated(address operator)
        external
        view
        override
        returns (bool)
    {
        return operators[operator].authorizedApplications.length > 0;
    }

    /// @notice Returns length of application array
    function getApplicationsLength() external view returns (uint256) {
        return applications.length;
    }

    /// @notice Returns length of slashing queue
    function getSlashingQueueLength() external view returns (uint256) {
        return slashingQueue.length;
    }

    /// @notice Requests decrease of the authorization for the given operator on
    ///         the given application by the provided amount.
    ///         It may not change the authorized amount immediatelly. When
    ///         it happens depends on the application. Can only be called by the
    ///         given operator’s authorizer. Overwrites pending authorization
    ///         decrease for the given operator and application.
    /// @dev Calls `authorizationDecreaseRequested(address operator, uint256 amount)`
    ///      on the given application. See `IApplication`.
    function requestAuthorizationDecrease(
        address _operator,
        address _application,
        uint96 _amount
    ) public override onlyAuthorizerOf(_operator) {
        ApplicationInfo storage application = applicationInfo[_application];
        require(!application.disabled, "Application is disabled");

        require(
            _amount > 0,
            "Amount to decrease authorization must greater than 0"
        );

        AppAuthorization storage authorization = operators[_operator]
            .authorizations[_application];
        require(
            authorization.authorized >= _amount,
            "Amount to decrease authorization must be less than authorized"
        );

        authorization.deauthorizing = _amount;
        emit AuthorizationDecreaseRequested(_operator, _application, _amount);
        IApplication(_application).authorizationDecreaseRequested(
            _operator,
            _amount
        );
    }

    /// @notice Returns minimum possible stake for T, KEEP or NU in T denomination
    function getMinStaked(address _operator, StakingProvider stakingProviders)
        public
        view
        returns (uint96)
    {
        OperatorInfo storage operator = operators[_operator];
        uint256 maxAuthorization = 0;
        for (uint256 i = 0; i < operator.authorizedApplications.length; i++) {
            address application = operator.authorizedApplications[i];
            maxAuthorization = Math.max(
                maxAuthorization,
                operator.authorizations[application].authorized
            );
        }

        if (maxAuthorization == 0) {
            return 0;
        }
        if (stakingProviders != StakingProvider.T) {
            maxAuthorization -= Math.min(maxAuthorization, operator.tStake);
        }
        if (stakingProviders != StakingProvider.NU) {
            maxAuthorization -= Math.min(maxAuthorization, operator.nuInTStake);
        }
        if (stakingProviders != StakingProvider.KEEP) {
            maxAuthorization -= Math.min(
                maxAuthorization,
                operator.keepInTStake
            );
        }
        return maxAuthorization.toUint96();
    }

    /// @notice Returns available amount to authorize for the specified application
    function getAvailableToAuthorize(address _operator, address _application)
        public
        view
        returns (uint96 availableTValue)
    {
        OperatorInfo storage operator = operators[_operator];
        availableTValue =
            operator.tStake +
            operator.keepInTStake +
            operator.nuInTStake;
        availableTValue -= operator.authorizations[_application].authorized;
    }

    /// @notice Adds operators to the slashing queue along with the amount.
    ///         The notifier will receive reward per each operator from
    ///         notifiers treasury. Can only be called by application
    ///         authorized for all operators in the array.
    function notify(
        uint96 _amount,
        uint256 _rewardMultiplier,
        address _notifier,
        address[] memory _operators
    ) internal {
        require(
            _amount > 0 && _operators.length > 0,
            "Specify amount and operators to slash"
        );

        ApplicationInfo storage application = applicationInfo[msg.sender];
        require(application.approved, "Application is not approved");
        require(!application.disabled, "Application is disabled");

        for (uint256 i = 0; i < _operators.length; i++) {
            address operator = _operators[i];
            require(
                operators[operator].authorizations[msg.sender].authorized >=
                    _amount,
                "Operator didn't authorize sufficient amount to application"
            );
            slashingQueue.push(SlashingEvent(operator, _amount));
        }

        if (_notifier != address(0)) {
            uint256 reward = (_operators.length * notificationReward).percent(
                _rewardMultiplier
            );
            reward = Math.min(reward, notifiersTreasury);
            emit NotifierRewarded(_notifier, reward);
            if (reward != 0) {
                notifiersTreasury -= reward;
                token.safeTransfer(_notifier, reward);
            }
        }
    }

    /// @notice Processes one specified slashing event.
    ///         Executes `involuntaryAuthorizationDecrease` function on each
    ///         affected application.
    function processSlashing(SlashingEvent storage slashing)
        internal
        returns (uint96 tAmountToBurn)
    {
        OperatorInfo storage operator = operators[slashing.operator];
        uint96 tAmountToSlash = slashing.amount;

        // slash T
        if (operator.tStake > 0) {
            if (tAmountToSlash <= operator.tStake) {
                tAmountToBurn = tAmountToSlash;
            } else {
                tAmountToBurn = operator.tStake;
            }
            operator.tStake -= tAmountToBurn;
            tAmountToSlash -= tAmountToBurn;
        }

        // slash KEEP
        if (tAmountToSlash > 0 && operator.keepInTStake > 0) {
            (uint256 keepStakeAmount, , ) = keepStakingContract
                .getDelegationInfo(slashing.operator);
            (uint96 tAmount, ) = keepToT(keepStakeAmount);
            operator.keepInTStake = tAmount;

            tAmountToSlash = seizeKeep(
                operator,
                slashing.operator,
                tAmountToSlash,
                100
            );
        }

        // slash NU
        if (tAmountToSlash > 0 && operator.nuInTStake > 0) {
            // synchronization skipped due to impossibility of real discrepancy
            tAmountToSlash = seizeNu(operator, tAmountToSlash, 100);
        }

        emit TokensSeized(slashing.operator, slashing.amount - tAmountToSlash);
        authorizationDecrease(slashing.operator, operator);
    }

    /// @notice Synchronize authorizations (if needed) after slashing stake
    function authorizationDecrease(
        address operatorAddress,
        OperatorInfo storage operator
    ) internal {
        uint96 totalStake = operator.tStake +
            operator.nuInTStake +
            operator.keepInTStake;
        for (uint256 i = 0; i < operator.authorizedApplications.length; i++) {
            address application = operator.authorizedApplications[i];
            AppAuthorization storage authorization = operator.authorizations[
                application
            ];
            if (authorization.authorized <= totalStake) {
                continue;
            }

            bool successful = true;
            uint96 amount = authorization.authorized - totalStake;

            //slither-disable-next-line calls-loop
            try
                IApplication(application).involuntaryAuthorizationDecrease{
                    gas: GAS_LIMIT_AUTHORIZATION_DECREASE
                }(operatorAddress, amount)
            {} catch {
                successful = false;
            }
            authorization.authorized = totalStake;
            if (authorization.deauthorizing > totalStake) {
                authorization.deauthorizing = totalStake;
            }
            emit AuthorizationInvoluntaryDecreased(
                operatorAddress,
                application,
                amount,
                successful
            );
        }
    }

    /// @notice Convert amount from T to Keep and call `seize` in Keep staking contract.
    ///         Returns remainder of slashing amount in T
    function seizeKeep(
        OperatorInfo storage operator,
        address operatorAddress,
        uint96 tAmountToSlash,
        uint256 rewardMultiplier
    ) internal returns (uint96) {
        if (operator.keepInTStake == 0) {
            return tAmountToSlash;
        }

        uint96 tPenalty;
        if (tAmountToSlash <= operator.keepInTStake) {
            tPenalty = tAmountToSlash;
        } else {
            tPenalty = operator.keepInTStake;
        }

        (uint256 keepPenalty, uint96 tRemainder) = tToKeep(tPenalty);
        if (keepPenalty == 0) {
            return tAmountToSlash;
        }
        tPenalty -= tRemainder;
        operator.keepInTStake -= tPenalty;
        tAmountToSlash -= tPenalty;

        address[] memory operatorWrapper = new address[](1);
        operatorWrapper[0] = operatorAddress;
        keepStakingContract.seize(
            keepPenalty,
            rewardMultiplier,
            msg.sender,
            operatorWrapper
        );
        return tAmountToSlash;
    }

    /// @notice Convert amount from T to NU and call `slashStaker` in NuCypher staking contract.
    ///         Returns remainder of slashing amount in T
    function seizeNu(
        OperatorInfo storage operator,
        uint96 tAmountToSlash,
        uint256 rewardMultiplier
    ) internal returns (uint96) {
        if (operator.nuInTStake == 0) {
            return tAmountToSlash;
        }

        uint96 tPenalty;
        if (tAmountToSlash <= operator.nuInTStake) {
            tPenalty = tAmountToSlash;
        } else {
            tPenalty = operator.nuInTStake;
        }

        (uint256 nuPenalty, uint96 tRemainder) = tToNu(tPenalty);
        if (nuPenalty == 0) {
            return tAmountToSlash;
        }
        tPenalty -= tRemainder;
        operator.nuInTStake -= tPenalty;
        tAmountToSlash -= tPenalty;

        uint256 nuReward = nuPenalty.percent(SLASHING_REWARD_PERCENT).percent(
            rewardMultiplier
        );
        nucypherStakingContract.slashStaker(
            operator.owner,
            nuPenalty,
            msg.sender,
            nuReward
        );
        return tAmountToSlash;
    }

    /// @notice Returns amount of Keep stake in the Keep staking contract for the specified operator.
    ///         Resulting value in T denomination
    function getKeepAmountInT(address operator) internal view returns (uint96) {
        (, uint256 createdAt, ) = keepStakingContract.getDelegationInfo(
            operator
        );
        require(createdAt != 0, "Nothing to sync");

        uint256 keepStakeAmount = keepStakingContract.eligibleStake(
            operator,
            address(this)
        );
        uint96 tAmount = 0;
        if (keepStakeAmount > 0) {
            (tAmount, ) = keepToT(keepStakeAmount);
        }
        return tAmount;
    }

    /// @notice Returns the T token amount that's obtained from `amount` wrapped
    ///         tokens (KEEP), and the remainder that can't be converted.
    function keepToT(uint256 keepAmount)
        internal
        view
        returns (uint96 tAmount, uint256 keepRemainder)
    {
        keepRemainder = keepAmount % keepFloatingPointDivisor;
        uint256 convertibleAmount = keepAmount - keepRemainder;
        tAmount = ((convertibleAmount * keepRatio) / keepFloatingPointDivisor)
            .toUint96();
    }

    /// @notice The amount of wrapped tokens (KEEP) that's obtained from
    ///         `amount` T tokens, and the remainder that can't be converted.
    function tToKeep(uint96 tAmount)
        internal
        view
        returns (uint256 keepAmount, uint96 tRemainder)
    {
        tRemainder = (tAmount % keepRatio).toUint96();
        uint256 convertibleAmount = tAmount - tRemainder;
        keepAmount = (convertibleAmount * keepFloatingPointDivisor) / keepRatio;
    }

    /// @notice Returns the T token amount that's obtained from `amount` wrapped
    ///         tokens (NU), and the remainder that can't be converted.
    function nuToT(uint256 nuAmount)
        internal
        view
        returns (uint96 tAmount, uint256 nuRemainder)
    {
        nuRemainder = nuAmount % nucypherFloatingPointDivisor;
        uint256 convertibleAmount = nuAmount - nuRemainder;
        tAmount = ((convertibleAmount * nucypherRatio) /
            nucypherFloatingPointDivisor).toUint96();
    }

    /// @notice The amount of wrapped tokens (NU) that's obtained from
    ///         `amount` T tokens, and the remainder that can't be converted.
    function tToNu(uint96 tAmount)
        internal
        view
        returns (uint256 nuAmount, uint96 tRemainder)
    {
        //slither-disable-next-line weak-prng
        tRemainder = (tAmount % nucypherRatio).toUint96();
        uint256 convertibleAmount = tAmount - tRemainder;
        nuAmount =
            (convertibleAmount * nucypherFloatingPointDivisor) /
            nucypherRatio;
    }
}

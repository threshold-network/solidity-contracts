// SPDX-License-Identifier: GPL-3.0-or-later

// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌

pragma solidity 0.8.9;

import "./IApplication.sol";
import "./IStaking.sol";
import "./ILegacyTokenStaking.sol";
import "./IApplication.sol";
import "./KeepStake.sol";
import "../governance/Checkpoints.sol";
import "../token/T.sol";
import "../utils/PercentUtils.sol";
import "../vending/VendingMachine.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/// @notice TokenStaking is the main staking contract of the Threshold Network.
///         Apart from the basic usage of enabling T stakes, it also acts as a
///         sort of "meta-staking" contract, accepting existing legacy NU/KEEP
///         stakes. Additionally, it serves as application manager for the apps
///         that run on the Threshold Network. Note that legacy NU/KEEP staking
///         contracts see TokenStaking as an application (e.g., slashing is
///         requested by TokenStaking and performed by the legacy contracts).
contract TokenStaking is Ownable, IStaking, Checkpoints {
    using SafeERC20 for T;
    using PercentUtils for uint256;
    using SafeCast for uint256;

    enum ApplicationStatus {
        NOT_APPROVED,
        APPROVED,
        PAUSED,
        DISABLED
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
        ApplicationStatus status;
        address panicButton;
    }

    struct SlashingEvent {
        address operator;
        uint96 amount;
        address application;
    }

    uint256 internal constant SLASHING_REWARD_PERCENT = 5;
    uint256 internal constant MIN_STAKE_TIME = 24 hours;
    uint256 internal constant GAS_LIMIT_AUTHORIZATION_DECREASE = 250000;

    T internal immutable token;
    IKeepTokenStaking internal immutable keepStakingContract;
    KeepStake internal immutable keepStake;
    INuCypherStakingEscrow internal immutable nucypherStakingContract;

    uint256 internal immutable keepFloatingPointDivisor;
    uint256 internal immutable keepRatio;
    uint256 internal immutable nucypherFloatingPointDivisor;
    uint256 internal immutable nucypherRatio;

    uint96 public minTStakeAmount;
    uint256 public authorizationCeiling;
    uint96 public stakeDiscrepancyPenalty;
    uint256 public stakeDiscrepancyRewardMultiplier;

    uint256 public notifiersTreasury;
    uint256 public notificationReward;

    mapping(address => OperatorInfo) internal operators;
    mapping(address => ApplicationInfo) public applicationInfo;
    address[] public applications;

    SlashingEvent[] public slashingQueue;
    uint256 public slashingQueueIndex = 0;

    event OperatorStaked(
        StakeType indexed stakeType,
        address indexed owner,
        address indexed operator,
        address beneficiary,
        address authorizer,
        uint96 amount
    );
    event MinimumStakeAmountSet(uint96 amount);
    event ApplicationStatusChanged(
        address indexed application,
        ApplicationStatus indexed newStatus
    );
    event AuthorizationIncreased(
        address indexed operator,
        address indexed application,
        uint96 fromAmount,
        uint96 toAmount
    );
    event AuthorizationDecreaseRequested(
        address indexed operator,
        address indexed application,
        uint96 fromAmount,
        uint96 toAmount
    );
    event AuthorizationDecreaseApproved(
        address indexed operator,
        address indexed application,
        uint96 fromAmount,
        uint96 toAmount
    );
    event AuthorizationInvoluntaryDecreased(
        address indexed operator,
        address indexed application,
        uint96 fromAmount,
        uint96 toAmount,
        bool indexed successfulCall
    );
    event PanicButtonSet(
        address indexed application,
        address indexed panicButton
    );
    event AuthorizationCeilingSet(uint256 ceiling);
    event ToppedUp(address indexed operator, uint96 amount);
    event Unstaked(address indexed operator, uint96 amount);
    event TokensSeized(
        address indexed operator,
        uint96 amount,
        bool indexed discrepancy
    );
    event StakeDiscrepancyPenaltySet(uint96 penalty, uint256 rewardMultiplier);
    event NotificationRewardSet(uint96 reward);
    event NotificationRewardPushed(uint96 reward);
    event NotificationRewardWithdrawn(address recipient, uint96 amount);
    event NotifierRewarded(address indexed notifier, uint256 amount);
    event SlashingProcessed(
        address indexed caller,
        uint256 count,
        uint256 tAmount
    );
    event OwnerRefreshed(
        address indexed operator,
        address indexed oldOwner,
        address indexed newOwner
    );

    modifier onlyGovernance() {
        require(owner() == msg.sender, "Caller is not the governance");
        _;
    }

    modifier onlyPanicButtonOf(address application) {
        require(
            applicationInfo[application].panicButton == msg.sender,
            "Caller is not the panic button"
        );
        _;
    }

    modifier onlyAuthorizerOf(address operator) {
        //slither-disable-next-line incorrect-equality
        require(operators[operator].authorizer == msg.sender, "Not authorizer");
        _;
    }

    modifier onlyOwnerOrOperator(address operator) {
        //slither-disable-next-line incorrect-equality
        require(
            operators[operator].owner != address(0) &&
                (operator == msg.sender ||
                    operators[operator].owner == msg.sender),
            "Not owner or operator"
        );
        _;
    }

    /// @param _token Address of T token contract
    /// @param _keepStakingContract Address of Keep staking contract
    /// @param _nucypherStakingContract Address of NuCypher staking contract
    /// @param _keepVendingMachine Address of Keep vending machine
    /// @param _nucypherVendingMachine Address of NuCypher vending machine
    /// @param _keepStake Address of Keep contract with grant owners
    constructor(
        T _token,
        IKeepTokenStaking _keepStakingContract,
        INuCypherStakingEscrow _nucypherStakingContract,
        VendingMachine _keepVendingMachine,
        VendingMachine _nucypherVendingMachine,
        KeepStake _keepStake
    ) {
        // calls to check contracts are working
        require(
            _token.totalSupply() > 0 &&
                _keepStakingContract.ownerOf(address(0)) == address(0) &&
                _nucypherStakingContract.getAllTokens(address(0)) == 0 &&
                Address.isContract(address(_keepStake)),
            "Wrong input parameters"
        );
        token = _token;
        keepStakingContract = _keepStakingContract;
        keepStake = _keepStake;
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
        address operator,
        address payable beneficiary,
        address authorizer,
        uint96 amount
    ) external override {
        require(
            operator != address(0) &&
                beneficiary != address(0) &&
                authorizer != address(0),
            "Parameters must be specified"
        );
        OperatorInfo storage operatorStruct = operators[operator];
        (, uint256 createdAt, ) = keepStakingContract.getDelegationInfo(
            operator
        );
        require(
            createdAt == 0 && operatorStruct.owner == address(0),
            "Operator is already in use"
        );
        require(amount > minTStakeAmount, "Amount is less than minimum");
        operatorStruct.owner = msg.sender;
        operatorStruct.authorizer = authorizer;
        operatorStruct.beneficiary = beneficiary;

        operatorStruct.tStake = amount;
        /* solhint-disable-next-line not-rely-on-time */
        operatorStruct.startTStakingTimestamp = block.timestamp;

        increaseStakeCheckpoint(operator, amount);

        emit OperatorStaked(
            StakeType.T,
            msg.sender,
            operator,
            beneficiary,
            authorizer,
            amount
        );
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Copies delegation from the legacy KEEP staking contract to T
    ///         staking contract. No tokens are transferred. Caches the active
    ///         stake amount from KEEP staking contract. Can be called by
    ///         anyone.
    function stakeKeep(address operator) external override {
        require(operator != address(0), "Parameters must be specified");
        OperatorInfo storage operatorStruct = operators[operator];

        require(
            operatorStruct.owner == address(0),
            "Operator is already in use"
        );

        uint96 tAmount = getKeepAmountInT(operator);
        require(tAmount != 0, "Nothing to sync");

        operatorStruct.keepInTStake = tAmount;
        operatorStruct.owner = keepStake.resolveOwner(operator);
        operatorStruct.authorizer = keepStakingContract.authorizerOf(operator);
        operatorStruct.beneficiary = keepStakingContract.beneficiaryOf(
            operator
        );

        increaseStakeCheckpoint(operator, tAmount);

        emit OperatorStaked(
            StakeType.KEEP,
            operatorStruct.owner,
            operator,
            operatorStruct.beneficiary,
            operatorStruct.authorizer,
            tAmount
        );
    }

    /// @notice Copies delegation from the legacy NU staking contract to T
    ///         staking contract, additionally appointing beneficiary and
    ///         authorizer roles. Caches the amount staked in NU staking
    ///         contract. Can be called only by the original delegation owner.
    function stakeNu(
        address operator,
        address payable beneficiary,
        address authorizer
    ) external override {
        require(
            operator != address(0) &&
                beneficiary != address(0) &&
                authorizer != address(0),
            "Parameters must be specified"
        );
        OperatorInfo storage operatorStruct = operators[operator];
        (, uint256 createdAt, ) = keepStakingContract.getDelegationInfo(
            operator
        );
        require(
            createdAt == 0 && operatorStruct.owner == address(0),
            "Operator is already in use"
        );

        uint96 tAmount = getNuAmountInT(msg.sender, operator);
        require(tAmount > 0, "Nothing to sync");

        operatorStruct.nuInTStake = tAmount;
        operatorStruct.owner = msg.sender;
        operatorStruct.authorizer = authorizer;
        operatorStruct.beneficiary = beneficiary;

        increaseStakeCheckpoint(operator, tAmount);

        emit OperatorStaked(
            StakeType.NU,
            msg.sender,
            operator,
            beneficiary,
            authorizer,
            tAmount
        );
    }

    /// @notice Refresh Keep stake owner. Can be called only by the old owner.
    function refreshKeepStakeOwner(address operator) external override {
        OperatorInfo storage operatorStruct = operators[operator];
        require(operatorStruct.owner == msg.sender, "Caller is not owner");
        address newOwner = keepStake.resolveOwner(operator);

        emit OwnerRefreshed(operator, operatorStruct.owner, newOwner);
        operatorStruct.owner = newOwner;
    }

    /// @notice Allows the Governance to set the minimum required stake amount.
    ///         This amount is required to protect against griefing the staking
    ///         contract and individual applications are allowed to require
    ///         higher minimum stakes if necessary.
    /// @dev Operators are not required to maintain a minimum T stake all
    ///      the time. 24 hours after the delegation, T stake can be reduced
    ///      below the minimum stake. The minimum stake is just to protect
    ///      against griefing stake operation.
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
        require(application != address(0), "Parameters must be specified");
        ApplicationInfo storage info = applicationInfo[application];
        require(
            info.status == ApplicationStatus.NOT_APPROVED ||
                info.status == ApplicationStatus.PAUSED,
            "Can't approve application"
        );

        if (info.status == ApplicationStatus.NOT_APPROVED) {
            applications.push(application);
        }
        info.status = ApplicationStatus.APPROVED;
        emit ApplicationStatusChanged(application, ApplicationStatus.APPROVED);
    }

    /// @notice Increases the authorization of the given operator for the given
    ///         application by the given amount. Can only be called by the given
    ///         operator’s authorizer.
    /// @dev Calls `authorizationIncreased` callback on the given application to
    ///      notify the application about authorization change.
    ///      See `IApplication`.
    function increaseAuthorization(
        address operator,
        address application,
        uint96 amount
    ) external override onlyAuthorizerOf(operator) {
        ApplicationInfo storage applicationStruct = applicationInfo[
            application
        ];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );

        OperatorInfo storage operatorStruct = operators[operator];
        AppAuthorization storage authorization = operatorStruct.authorizations[
            application
        ];
        uint96 fromAmount = authorization.authorized;
        if (fromAmount == 0) {
            require(
                authorizationCeiling == 0 ||
                    operatorStruct.authorizedApplications.length <
                    authorizationCeiling,
                "Too many applications"
            );
            operatorStruct.authorizedApplications.push(application);
        }

        uint96 availableTValue = getAvailableToAuthorize(operator, application);
        require(availableTValue >= amount, "Not enough stake to authorize");
        authorization.authorized += amount;
        emit AuthorizationIncreased(
            operator,
            application,
            fromAmount,
            authorization.authorized
        );
        IApplication(application).authorizationIncreased(
            operator,
            fromAmount,
            authorization.authorized
        );
    }

    /// @notice Requests decrease of all authorizations for the given operator on
    ///         all applications by all authorized amount.
    ///         It may not change the authorized amount immediatelly. When
    ///         it happens depends on the application. Can only be called by the
    ///         given operator’s authorizer. Overwrites pending authorization
    ///         decrease for the given operator and application.
    /// @dev Calls `authorizationDecreaseRequested` callback
    ///      for each authorized application. See `IApplication`.
    function requestAuthorizationDecrease(address operator) external {
        OperatorInfo storage operatorStruct = operators[operator];
        uint96 deauthorizing = 0;
        for (
            uint256 i = 0;
            i < operatorStruct.authorizedApplications.length;
            i++
        ) {
            address application = operatorStruct.authorizedApplications[i];
            uint96 authorized = operatorStruct
                .authorizations[application]
                .authorized;
            if (authorized > 0) {
                requestAuthorizationDecrease(operator, application, authorized);
                deauthorizing += authorized;
            }
        }

        require(deauthorizing > 0, "Nothing was authorized");
    }

    /// @notice Called by the application at its discretion to approve the
    ///         previously requested authorization decrease request. Can only be
    ///         called by the application that was previously requested to
    ///         decrease the authorization for that operator.
    ///         Returns resulting authorized amount for the application.
    function approveAuthorizationDecrease(address operator)
        external
        override
        returns (uint96)
    {
        ApplicationInfo storage applicationStruct = applicationInfo[msg.sender];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );

        OperatorInfo storage operatorStruct = operators[operator];
        AppAuthorization storage authorization = operatorStruct.authorizations[
            msg.sender
        ];
        require(authorization.deauthorizing > 0, "No deauthorizing in process");

        uint96 fromAmount = authorization.authorized;
        authorization.authorized -= authorization.deauthorizing;
        authorization.deauthorizing = 0;
        emit AuthorizationDecreaseApproved(
            operator,
            msg.sender,
            fromAmount,
            authorization.authorized
        );

        // remove application from an array
        if (authorization.authorized == 0) {
            cleanAuthorizedApplications(operatorStruct, 1);
        }

        return authorization.authorized;
    }

    /// @notice Decreases the authorization for the given `operator` on
    ///         the given disabled `application`, for all authorized amount.
    ///         Can be called by anyone.
    function forceDecreaseAuthorization(address operator, address application)
        external
        override
    {
        require(
            applicationInfo[application].status == ApplicationStatus.DISABLED,
            "Application is not disabled"
        );

        OperatorInfo storage operatorStruct = operators[operator];
        AppAuthorization storage authorization = operatorStruct.authorizations[
            application
        ];
        uint96 fromAmount = authorization.authorized;
        require(fromAmount > 0, "Application is not authorized");
        authorization.authorized = 0;
        authorization.deauthorizing = 0;

        emit AuthorizationDecreaseApproved(
            operator,
            application,
            fromAmount,
            0
        );
        cleanAuthorizedApplications(operatorStruct, 1);
    }

    /// @notice Pauses the given application’s eligibility to slash stakes.
    ///         Besides that stakers can't change authorization to the application.
    ///         Can be called only by the Panic Button of the particular
    ///         application. The paused application can not slash stakes until
    ///         it is approved again by the Governance using `approveApplication`
    ///         function. Should be used only in case of an emergency.
    function pauseApplication(address application)
        external
        override
        onlyPanicButtonOf(application)
    {
        ApplicationInfo storage applicationStruct = applicationInfo[
            application
        ];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Can't pause application"
        );
        applicationStruct.status = ApplicationStatus.PAUSED;
        emit ApplicationStatusChanged(application, ApplicationStatus.PAUSED);
    }

    /// @notice Disables the given application. The disabled application can't
    ///         slash stakers. Also stakers can't increase authorization to that
    ///         application but can decrease without waiting by calling
    ///         `forceDecreaseAuthorization` at any moment. Can be called only
    ///         by the governance. The disabled application can't be approved
    ///         again. Should be used only in case of an emergency.
    function disableApplication(address application)
        external
        override
        onlyGovernance
    {
        ApplicationInfo storage applicationStruct = applicationInfo[
            application
        ];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED ||
                applicationStruct.status == ApplicationStatus.PAUSED,
            "Can't disable application"
        );
        applicationStruct.status = ApplicationStatus.DISABLED;
        emit ApplicationStatusChanged(application, ApplicationStatus.DISABLED);
    }

    /// @notice Sets the Panic Button role for the given application to the
    ///         provided address. Can only be called by the Governance. If the
    ///         Panic Button for the given application should be disabled, the
    ///         role address should be set to 0x0 address.
    function setPanicButton(address application, address panicButton)
        external
        override
        onlyGovernance
    {
        ApplicationInfo storage applicationStruct = applicationInfo[
            application
        ];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );
        applicationStruct.panicButton = panicButton;
        emit PanicButtonSet(application, panicButton);
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
    function topUp(address operator, uint96 amount)
        external
        override
        onlyOwnerOrOperator(operator)
    {
        require(amount > 0, "Parameters must be specified");
        OperatorInfo storage operatorStruct = operators[operator];
        operatorStruct.tStake += amount;
        emit ToppedUp(operator, amount);
        increaseStakeCheckpoint(operator, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Propagates information about stake top-up from the legacy KEEP
    ///         staking contract to T staking contract. Can be called only by
    ///         the owner or operator.
    function topUpKeep(address operator)
        external
        override
        onlyOwnerOrOperator(operator)
    {
        OperatorInfo storage operatorStruct = operators[operator];
        uint96 tAmount = getKeepAmountInT(operator);
        require(tAmount > operatorStruct.keepInTStake, "Nothing to top-up");

        uint96 toppedUp = tAmount - operatorStruct.keepInTStake;
        emit ToppedUp(operator, toppedUp);
        operatorStruct.keepInTStake = tAmount;
        increaseStakeCheckpoint(operator, toppedUp);
    }

    /// @notice Propagates information about stake top-up from the legacy NU
    ///         staking contract to T staking contract. Can be called only by
    ///         the owner or operator.
    function topUpNu(address operator)
        external
        override
        onlyOwnerOrOperator(operator)
    {
        OperatorInfo storage operatorStruct = operators[operator];
        uint96 tAmount = getNuAmountInT(operatorStruct.owner, operator);
        require(tAmount > operatorStruct.nuInTStake, "Nothing to top-up");

        uint96 toppedUp = tAmount - operatorStruct.nuInTStake;
        emit ToppedUp(operator, toppedUp);
        operatorStruct.nuInTStake = tAmount;
        increaseStakeCheckpoint(operator, toppedUp);
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
    function unstakeT(address operator, uint96 amount)
        external
        override
        onlyOwnerOrOperator(operator)
    {
        OperatorInfo storage operatorStruct = operators[operator];
        require(
            amount > 0 &&
                amount + getMinStaked(operator, StakeType.T) <=
                operatorStruct.tStake,
            "Too much to unstake"
        );
        operatorStruct.tStake -= amount;
        require(
            operatorStruct.tStake >= minTStakeAmount ||
                operatorStruct.startTStakingTimestamp + MIN_STAKE_TIME <=
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp,
            "Can't unstake earlier than 24h"
        );
        decreaseStakeCheckpoint(operator, amount);
        emit Unstaked(operator, amount);
        token.safeTransfer(operatorStruct.owner, amount);
    }

    /// @notice Sets the legacy KEEP staking contract active stake amount cached
    ///         in T staking contract to 0. Reverts if the amount of liquid T
    ///         staked in T staking contract is lower than the highest
    ///         application authorization. This function allows to unstake from
    ///         KEEP staking contract and still being able to operate in T
    ///         network and earning rewards based on the liquid T staked. Can be
    ///         called only by the delegation owner and operator.
    /// @dev    This function (or `unstakeAll`) must be called before
    ///         `undelegate`/`undelegateAt` in Keep staking contract. Otherwise
    ///         operator can be slashed by `notifyKeepStakeDiscrepancy` method.
    function unstakeKeep(address operator)
        external
        override
        onlyOwnerOrOperator(operator)
    {
        OperatorInfo storage operatorStruct = operators[operator];
        uint96 keepInTStake = operatorStruct.keepInTStake;
        require(keepInTStake != 0, "Nothing to unstake");
        require(
            getMinStaked(operator, StakeType.KEEP) == 0,
            "Keep stake still authorized"
        );
        emit Unstaked(operator, keepInTStake);
        operatorStruct.keepInTStake = 0;
        decreaseStakeCheckpoint(operator, keepInTStake);
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
    /// @dev    This function (or `unstakeAll`) must be called before `withdraw`
    ///         in NuCypher staking contract. Otherwise NU tokens can't be
    ///         unlocked.
    /// @param operator Operator address.
    /// @param amount Amount of NU to unstake in T denomination.
    function unstakeNu(address operator, uint96 amount)
        external
        override
        onlyOwnerOrOperator(operator)
    {
        OperatorInfo storage operatorStruct = operators[operator];
        // rounding amount to guarantee exact T<>NU conversion in both ways,
        // so there's no remainder after unstaking
        (, uint96 tRemainder) = tToNu(amount);
        amount -= tRemainder;
        require(
            amount > 0 &&
                amount + getMinStaked(operator, StakeType.NU) <=
                operatorStruct.nuInTStake,
            "Too much to unstake"
        );
        operatorStruct.nuInTStake -= amount;
        decreaseStakeCheckpoint(operator, amount);
        emit Unstaked(operator, amount);
    }

    /// @notice Sets cached legacy stake amount to 0, sets the liquid T stake
    ///         amount to 0 and withdraws all liquid T from the stake to the
    ///         owner. Reverts if there is at least one non-zero authorization.
    ///         Can be called only by the delegation owner and operator.
    function unstakeAll(address operator)
        external
        override
        onlyOwnerOrOperator(operator)
    {
        OperatorInfo storage operatorStruct = operators[operator];
        require(
            operatorStruct.authorizedApplications.length == 0,
            "Stake still authorized"
        );
        require(
            operatorStruct.tStake == 0 ||
                minTStakeAmount == 0 ||
                operatorStruct.startTStakingTimestamp + MIN_STAKE_TIME <=
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp,
            "Can't unstake earlier than 24h"
        );

        uint96 unstaked = operatorStruct.tStake +
            operatorStruct.keepInTStake +
            operatorStruct.nuInTStake;
        emit Unstaked(operator, unstaked);
        uint96 amount = operatorStruct.tStake;
        operatorStruct.tStake = 0;
        operatorStruct.keepInTStake = 0;
        operatorStruct.nuInTStake = 0;
        decreaseStakeCheckpoint(operator, unstaked);

        if (amount > 0) {
            token.safeTransfer(operatorStruct.owner, amount);
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
    function notifyKeepStakeDiscrepancy(address operator) external override {
        OperatorInfo storage operatorStruct = operators[operator];
        require(operatorStruct.keepInTStake > 0, "Nothing to slash");

        (uint256 keepStakeAmount, , uint256 undelegatedAt) = keepStakingContract
            .getDelegationInfo(operator);

        (uint96 realKeepInTStake, ) = keepToT(keepStakeAmount);
        uint96 oldKeepInTStake = operatorStruct.keepInTStake;

        require(
            oldKeepInTStake > realKeepInTStake || undelegatedAt != 0,
            "There is no discrepancy"
        );
        operatorStruct.keepInTStake = realKeepInTStake;
        seizeKeep(
            operatorStruct,
            operator,
            stakeDiscrepancyPenalty,
            stakeDiscrepancyRewardMultiplier
        );

        uint96 slashedAmount = realKeepInTStake - operatorStruct.keepInTStake;
        emit TokensSeized(operator, slashedAmount, true);
        if (undelegatedAt != 0) {
            operatorStruct.keepInTStake = 0;
        }

        decreaseStakeCheckpoint(
            operator,
            oldKeepInTStake - operatorStruct.keepInTStake
        );

        authorizationDecrease(
            operator,
            operatorStruct,
            slashedAmount,
            address(0)
        );
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
    function notifyNuStakeDiscrepancy(address operator) external override {
        OperatorInfo storage operatorStruct = operators[operator];
        require(operatorStruct.nuInTStake > 0, "Nothing to slash");

        uint256 nuStakeAmount = nucypherStakingContract.getAllTokens(
            operatorStruct.owner
        );
        (uint96 realNuInTStake, ) = nuToT(nuStakeAmount);
        uint96 oldNuInTStake = operatorStruct.nuInTStake;
        require(oldNuInTStake > realNuInTStake, "There is no discrepancy");

        operatorStruct.nuInTStake = realNuInTStake;
        seizeNu(
            operatorStruct,
            stakeDiscrepancyPenalty,
            stakeDiscrepancyRewardMultiplier
        );

        uint96 slashedAmount = realNuInTStake - operatorStruct.nuInTStake;
        emit TokensSeized(operator, slashedAmount, true);
        authorizationDecrease(
            operator,
            operatorStruct,
            slashedAmount,
            address(0)
        );
        decreaseStakeCheckpoint(
            operator,
            oldNuInTStake - operatorStruct.nuInTStake
        );
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
        stakeDiscrepancyPenalty = penalty;
        stakeDiscrepancyRewardMultiplier = rewardMultiplier;
        emit StakeDiscrepancyPenaltySet(penalty, rewardMultiplier);
    }

    /// @notice Sets reward in T tokens for notification of misbehaviour
    ///         of one operator. Can only be called by the governance.
    function setNotificationReward(uint96 reward)
        external
        override
        onlyGovernance
    {
        notificationReward = reward;
        emit NotificationRewardSet(reward);
    }

    /// @notice Transfer some amount of T tokens as reward for notifications
    ///         of misbehaviour
    function pushNotificationReward(uint96 reward) external override {
        require(reward > 0, "Parameters must be specified");
        notifiersTreasury += reward;
        emit NotificationRewardPushed(reward);
        token.safeTransferFrom(msg.sender, address(this), reward);
    }

    /// @notice Withdraw some amount of T tokens from notifiers treasury.
    ///         Can only be called by the governance.
    function withdrawNotificationReward(address recipient, uint96 amount)
        external
        override
        onlyGovernance
    {
        require(amount <= notifiersTreasury, "Not enough tokens");
        notifiersTreasury -= amount;
        emit NotificationRewardWithdrawn(recipient, amount);
        token.safeTransfer(recipient, amount);
    }

    /// @notice Adds operators to the slashing queue along with the amount that
    ///         should be slashed from each one of them. Can only be called by
    ///         application authorized for all operators in the array.
    /// @dev    This method doesn't emit events for operators that are added to
    ///         the queue. If necessary  events can be added to the application
    ///         level.
    function slash(uint96 amount, address[] memory _operators)
        external
        override
    {
        notify(amount, 0, address(0), _operators);
    }

    /// @notice Adds operators to the slashing queue along with the amount.
    ///         The notifier will receive reward per each operator from
    ///         notifiers treasury. Can only be called by application
    ///         authorized for all operators in the array.
    /// @dev    This method doesn't emit events for operators that are added to
    ///         the queue. If necessary  events can be added to the application
    ///         level.
    function seize(
        uint96 amount,
        uint256 rewardMultiplier,
        address notifier,
        address[] memory _operators
    ) external override {
        notify(amount, rewardMultiplier, notifier, _operators);
    }

    /// @notice Takes the given number of queued slashing operations and
    ///         processes them. Receives 5% of the slashed amount.
    ///         Executes `involuntaryAuthorizationDecrease` function on each
    ///         affected application.
    function processSlashing(uint256 count) external virtual override {
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

    /// @notice Delegate voting power from the stake associated to the
    ///         `operator` to a `delegatee` address. Caller must be the owner
    ///         of this stake.
    function delegateVoting(address operator, address delegatee) external {
        delegate(operator, delegatee);
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
    function stakes(address operator)
        external
        view
        override
        returns (
            uint96 tStake,
            uint96 keepInTStake,
            uint96 nuInTStake
        )
    {
        OperatorInfo storage operatorStruct = operators[operator];
        tStake = operatorStruct.tStake;
        keepInTStake = operatorStruct.keepInTStake;
        nuInTStake = operatorStruct.nuInTStake;
    }

    /// @notice Returns start staking timestamp for T stake.
    /// @dev    This value is set at most once, and only when a stake is created
    ///         with T tokens. If a stake is created from a legacy stake,
    ///         this value will remain as zero
    function getStartTStakingTimestamp(address operator)
        external
        view
        override
        returns (uint256)
    {
        return operators[operator].startTStakingTimestamp;
    }

    /// @notice Returns staked amount of NU for the specified operator
    function stakedNu(address operator)
        external
        view
        override
        returns (uint256 nuAmount)
    {
        (nuAmount, ) = tToNu(operators[operator].nuInTStake);
    }

    /// @notice Gets the stake owner, the beneficiary and the authorizer
    ///         for the specified operator address.
    /// @return owner Stake owner address.
    /// @return beneficiary Beneficiary address.
    /// @return authorizer Authorizer address.
    function rolesOf(address operator)
        external
        view
        override
        returns (
            address owner,
            address payable beneficiary,
            address authorizer
        )
    {
        OperatorInfo storage operatorStruct = operators[operator];
        owner = operatorStruct.owner;
        beneficiary = operatorStruct.beneficiary;
        authorizer = operatorStruct.authorizer;
    }

    /// @notice Returns length of application array
    function getApplicationsLength() external view override returns (uint256) {
        return applications.length;
    }

    /// @notice Returns length of slashing queue
    function getSlashingQueueLength() external view override returns (uint256) {
        return slashingQueue.length;
    }

    /// @notice Requests decrease of the authorization for the given operator on
    ///         the given application by the provided amount.
    ///         It may not change the authorized amount immediatelly. When
    ///         it happens depends on the application. Can only be called by the
    ///         given operator’s authorizer. Overwrites pending authorization
    ///         decrease for the given operator and application.
    /// @dev Calls `authorizationDecreaseRequested` callback on the given
    ///      application. See `IApplication`.
    function requestAuthorizationDecrease(
        address operator,
        address application,
        uint96 amount
    ) public override onlyAuthorizerOf(operator) {
        ApplicationInfo storage applicationStruct = applicationInfo[
            application
        ];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );

        require(amount > 0, "Parameters must be specified");

        AppAuthorization storage authorization = operators[operator]
            .authorizations[application];
        require(
            authorization.authorized >= amount,
            "Amount exceeds authorized"
        );

        authorization.deauthorizing = amount;
        uint96 deauthorizingTo = authorization.authorized - amount;
        emit AuthorizationDecreaseRequested(
            operator,
            application,
            authorization.authorized,
            deauthorizingTo
        );
        IApplication(application).authorizationDecreaseRequested(
            operator,
            authorization.authorized,
            deauthorizingTo
        );
    }

    /// @notice Returns minimum possible stake for T, KEEP or NU in T denomination
    /// @dev For example, suppose the given operator has 10 T, 20 T worth
    ///      of KEEP, and 30 T worth of NU all staked, and the maximum
    ///      application authorization is 40 T, then `getMinStaked` for
    ///      that operator returns:
    ///          * 0 T if KEEP stake type specified i.e.
    ///            min = 40 T max - (10 T + 30 T worth of NU) = 0 T
    ///          * 10 T if NU stake type specified i.e.
    ///            min = 40 T max - (10 T + 20 T worth of KEEP) = 10 T
    ///          * 0 T if T stake type specified i.e.
    ///            min = 40 T max - (20 T worth of KEEP + 30 T worth of NU) < 0 T
    ///      In other words, the minimum stake amount for the specified
    ///      stake type is the minimum amount of stake of the given type
    ///      needed to satisfy the maximum application authorization given
    ///      the staked amounts of the other stake types for that operator.
    function getMinStaked(address operator, StakeType stakeTypes)
        public
        view
        override
        returns (uint96)
    {
        OperatorInfo storage operatorStruct = operators[operator];
        uint256 maxAuthorization = 0;
        for (
            uint256 i = 0;
            i < operatorStruct.authorizedApplications.length;
            i++
        ) {
            address application = operatorStruct.authorizedApplications[i];
            maxAuthorization = Math.max(
                maxAuthorization,
                operatorStruct.authorizations[application].authorized
            );
        }

        if (maxAuthorization == 0) {
            return 0;
        }
        if (stakeTypes != StakeType.T) {
            maxAuthorization -= Math.min(
                maxAuthorization,
                operatorStruct.tStake
            );
        }
        if (stakeTypes != StakeType.NU) {
            maxAuthorization -= Math.min(
                maxAuthorization,
                operatorStruct.nuInTStake
            );
        }
        if (stakeTypes != StakeType.KEEP) {
            maxAuthorization -= Math.min(
                maxAuthorization,
                operatorStruct.keepInTStake
            );
        }
        return maxAuthorization.toUint96();
    }

    /// @notice Returns available amount to authorize for the specified application
    function getAvailableToAuthorize(address operator, address application)
        public
        view
        override
        returns (uint96 availableTValue)
    {
        OperatorInfo storage operatorStruct = operators[operator];
        availableTValue =
            operatorStruct.tStake +
            operatorStruct.keepInTStake +
            operatorStruct.nuInTStake;
        availableTValue -= operatorStruct
            .authorizations[application]
            .authorized;
    }

    /// @notice Delegate voting power from the stake associated to the
    ///         `operator` to a `delegatee` address. Caller must be the owner
    ///         of this stake.
    /// @dev Original abstract function defined in Checkpoints contract had two
    ///      parameters, `delegator` and `delegatee`. Here we override it and
    ///      comply with the same signature but the semantics of the first
    ///      parameter changes to the `operator` address.
    function delegate(address operator, address delegatee)
        internal
        virtual
        override
    {
        OperatorInfo storage operatorStruct = operators[operator];
        require(operatorStruct.owner == msg.sender, "Caller is not owner");
        uint96 operatorBalance = operatorStruct.tStake +
            operatorStruct.keepInTStake +
            operatorStruct.nuInTStake;
        address oldDelegatee = delegates(operator);
        _delegates[operator] = delegatee;
        emit DelegateChanged(operator, oldDelegatee, delegatee);
        moveVotingPower(oldDelegatee, delegatee, operatorBalance);
    }

    /// @notice Adds operators to the slashing queue along with the amount.
    ///         The notifier will receive reward per each operator from
    ///         notifiers treasury. Can only be called by application
    ///         authorized for all operators in the array.
    function notify(
        uint96 amount,
        uint256 rewardMultiplier,
        address notifier,
        address[] memory _operators
    ) internal {
        require(
            amount > 0 && _operators.length > 0,
            "Parameters must be specified"
        );

        ApplicationInfo storage applicationStruct = applicationInfo[msg.sender];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );

        uint256 queueLength = slashingQueue.length;
        for (uint256 i = 0; i < _operators.length; i++) {
            address operator = _operators[i];
            uint256 amountToSlash = Math.min(
                operators[operator].authorizations[msg.sender].authorized,
                amount
            );
            if (
                //slither-disable-next-line incorrect-equality
                amountToSlash == 0
            ) {
                continue;
            }
            slashingQueue.push(
                SlashingEvent(operator, amountToSlash.toUint96(), msg.sender)
            );
        }

        if (notifier != address(0)) {
            uint256 reward = ((slashingQueue.length - queueLength) *
                notificationReward).percent(rewardMultiplier);
            reward = Math.min(reward, notifiersTreasury);
            emit NotifierRewarded(notifier, reward);
            if (reward != 0) {
                notifiersTreasury -= reward;
                token.safeTransfer(notifier, reward);
            }
        }
    }

    /// @notice Processes one specified slashing event.
    ///         Executes `involuntaryAuthorizationDecrease` function on each
    ///         affected application.
    //slither-disable-next-line dead-code
    function processSlashing(SlashingEvent storage slashing)
        internal
        returns (uint96 tAmountToBurn)
    {
        OperatorInfo storage operatorStruct = operators[slashing.operator];
        uint96 tAmountToSlash = slashing.amount;
        uint96 oldStake = operatorStruct.tStake +
            operatorStruct.keepInTStake +
            operatorStruct.nuInTStake;
        // slash T
        if (operatorStruct.tStake > 0) {
            if (tAmountToSlash <= operatorStruct.tStake) {
                tAmountToBurn = tAmountToSlash;
            } else {
                tAmountToBurn = operatorStruct.tStake;
            }
            operatorStruct.tStake -= tAmountToBurn;
            tAmountToSlash -= tAmountToBurn;
        }

        // slash KEEP
        if (tAmountToSlash > 0 && operatorStruct.keepInTStake > 0) {
            (uint256 keepStakeAmount, , ) = keepStakingContract
                .getDelegationInfo(slashing.operator);
            (uint96 tAmount, ) = keepToT(keepStakeAmount);
            operatorStruct.keepInTStake = tAmount;

            tAmountToSlash = seizeKeep(
                operatorStruct,
                slashing.operator,
                tAmountToSlash,
                100
            );
        }

        // slash NU
        if (tAmountToSlash > 0 && operatorStruct.nuInTStake > 0) {
            // synchronization skipped due to impossibility of real discrepancy
            tAmountToSlash = seizeNu(operatorStruct, tAmountToSlash, 100);
        }

        uint96 slashedAmount = slashing.amount - tAmountToSlash;
        emit TokensSeized(slashing.operator, slashedAmount, false);
        authorizationDecrease(
            slashing.operator,
            operatorStruct,
            slashedAmount,
            slashing.application
        );
        uint96 newStake = operatorStruct.tStake +
            operatorStruct.keepInTStake +
            operatorStruct.nuInTStake;
        decreaseStakeCheckpoint(slashing.operator, oldStake - newStake);
    }

    /// @notice Synchronize authorizations (if needed) after slashing stake
    function authorizationDecrease(
        address operator,
        OperatorInfo storage operatorStruct,
        uint96 slashedAmount,
        address application
    ) internal {
        uint96 totalStake = operatorStruct.tStake +
            operatorStruct.nuInTStake +
            operatorStruct.keepInTStake;
        uint256 applicationsToDelete = 0;
        for (
            uint256 i = 0;
            i < operatorStruct.authorizedApplications.length;
            i++
        ) {
            address authorizedApplication = operatorStruct
                .authorizedApplications[i];
            AppAuthorization storage authorization = operatorStruct
                .authorizations[authorizedApplication];
            uint96 fromAmount = authorization.authorized;
            if (
                application == address(0) ||
                authorizedApplication == application
            ) {
                authorization.authorized -= Math
                    .min(fromAmount, slashedAmount)
                    .toUint96();
            } else if (fromAmount <= totalStake) {
                continue;
            }
            if (authorization.authorized > totalStake) {
                authorization.authorized = totalStake;
            }

            bool successful = true;
            //slither-disable-next-line calls-loop
            try
                IApplication(authorizedApplication)
                    .involuntaryAuthorizationDecrease{
                    gas: GAS_LIMIT_AUTHORIZATION_DECREASE
                }(operator, fromAmount, authorization.authorized)
            {} catch {
                successful = false;
            }
            if (authorization.deauthorizing > authorization.authorized) {
                authorization.deauthorizing = authorization.authorized;
            }
            emit AuthorizationInvoluntaryDecreased(
                operator,
                authorizedApplication,
                fromAmount,
                authorization.authorized,
                successful
            );
            if (authorization.authorized == 0) {
                applicationsToDelete++;
            }
        }
        if (applicationsToDelete > 0) {
            cleanAuthorizedApplications(operatorStruct, applicationsToDelete);
        }
    }

    /// @notice Convert amount from T to Keep and call `seize` in Keep staking contract.
    ///         Returns remainder of slashing amount in T
    /// @dev Note this internal function doesn't update stake checkpoints
    function seizeKeep(
        OperatorInfo storage operatorStruct,
        address operator,
        uint96 tAmountToSlash,
        uint256 rewardMultiplier
    ) internal returns (uint96) {
        if (operatorStruct.keepInTStake == 0) {
            return tAmountToSlash;
        }

        uint96 tPenalty;
        if (tAmountToSlash <= operatorStruct.keepInTStake) {
            tPenalty = tAmountToSlash;
        } else {
            tPenalty = operatorStruct.keepInTStake;
        }

        (uint256 keepPenalty, uint96 tRemainder) = tToKeep(tPenalty);
        if (keepPenalty == 0) {
            return tAmountToSlash;
        }
        tPenalty -= tRemainder;
        operatorStruct.keepInTStake -= tPenalty;
        tAmountToSlash -= tPenalty;

        address[] memory operatorWrapper = new address[](1);
        operatorWrapper[0] = operator;
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
    /// @dev Note this internal function doesn't update the stake checkpoints
    function seizeNu(
        OperatorInfo storage operatorStruct,
        uint96 tAmountToSlash,
        uint256 rewardMultiplier
    ) internal returns (uint96) {
        if (operatorStruct.nuInTStake == 0) {
            return tAmountToSlash;
        }

        uint96 tPenalty;
        if (tAmountToSlash <= operatorStruct.nuInTStake) {
            tPenalty = tAmountToSlash;
        } else {
            tPenalty = operatorStruct.nuInTStake;
        }

        (uint256 nuPenalty, uint96 tRemainder) = tToNu(tPenalty);
        if (nuPenalty == 0) {
            return tAmountToSlash;
        }
        tPenalty -= tRemainder;
        operatorStruct.nuInTStake -= tPenalty;
        tAmountToSlash -= tPenalty;

        uint256 nuReward = nuPenalty.percent(SLASHING_REWARD_PERCENT).percent(
            rewardMultiplier
        );
        nucypherStakingContract.slashStaker(
            operatorStruct.owner,
            nuPenalty,
            msg.sender,
            nuReward
        );
        return tAmountToSlash;
    }

    /// @notice Removes application with zero authorization from authorized
    ///         applications array
    function cleanAuthorizedApplications(
        OperatorInfo storage operatorStruct,
        uint256 numberToDelete
    ) internal {
        uint256 length = operatorStruct.authorizedApplications.length;
        if (numberToDelete == length) {
            delete operatorStruct.authorizedApplications;
            return;
        }

        uint256 deleted = 0;
        uint256 index = 0;
        uint256 newLength = length - numberToDelete;
        while (index < newLength && deleted < numberToDelete) {
            address application = operatorStruct.authorizedApplications[index];
            if (operatorStruct.authorizations[application].authorized == 0) {
                operatorStruct.authorizedApplications[index] = operatorStruct
                    .authorizedApplications[length - deleted - 1];
                deleted++;
            } else {
                index++;
            }
        }

        for (index = newLength; index < length; index++) {
            operatorStruct.authorizedApplications.pop();
        }
    }

    /// @notice Creates new checkpoints due to a change of stake amount
    /// @param _delegator Address of the stake operator acting as delegator
    /// @param _amount Amount of T to increment
    /// @param increase True if the change is an increase, false if a decrease
    function newStakeCheckpoint(
        address _delegator,
        uint96 _amount,
        bool increase
    ) internal {
        if (_amount == 0) {
            return;
        }
        writeCheckpoint(
            _totalSupplyCheckpoints,
            increase ? add : subtract,
            _amount
        );
        address delegatee = delegates(_delegator);
        if (delegatee != address(0)) {
            (uint256 oldWeight, uint256 newWeight) = writeCheckpoint(
                _checkpoints[delegatee],
                increase ? add : subtract,
                _amount
            );
            emit DelegateVotesChanged(delegatee, oldWeight, newWeight);
        }
    }

    /// @notice Creates new checkpoints due to an increment of a stakers' stake
    /// @param _delegator Address of the stake operator acting as delegator
    /// @param _amount Amount of T to increment
    function increaseStakeCheckpoint(address _delegator, uint96 _amount)
        internal
    {
        newStakeCheckpoint(_delegator, _amount, true);
    }

    /// @notice Creates new checkpoints due to a decrease of a stakers' stake
    /// @param _delegator Address of the stake owner acting as delegator
    /// @param _amount Amount of T to decrease
    function decreaseStakeCheckpoint(address _delegator, uint96 _amount)
        internal
    {
        newStakeCheckpoint(_delegator, _amount, false);
    }

    /// @notice Returns amount of Nu stake in the NuCypher staking contract for the specified operator.
    ///         Resulting value in T denomination
    function getNuAmountInT(address owner, address operator)
        internal
        returns (uint96)
    {
        uint256 nuStakeAmount = nucypherStakingContract.requestMerge(
            owner,
            operator
        );
        (uint96 tAmount, ) = nuToT(nuStakeAmount);
        return tAmount;
    }

    /// @notice Returns amount of Keep stake in the Keep staking contract for the specified operator.
    ///         Resulting value in T denomination
    function getKeepAmountInT(address operator) internal view returns (uint96) {
        uint256 keepStakeAmount = keepStakingContract.eligibleStake(
            operator,
            address(this)
        );
        (uint96 tAmount, ) = keepToT(keepStakeAmount);
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

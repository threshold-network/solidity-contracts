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
import "../governance/Checkpoints.sol";
import "../token/T.sol";
import "../utils/PercentUtils.sol";
import "../utils/SafeTUpgradeable.sol";
import "../vending/VendingMachine.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

/// @notice TokenStaking is the main staking contract of the Threshold Network.
///         It serves as application manager for the apps that run on
///         the Threshold Network.
/// @dev TokenStaking is upgradeable, using OpenZeppelin's Upgradeability
///      framework. As such, it is required to satisfy OZ's guidelines, like
///      restrictions on constructors, immutable variables, base contracts and
///      libraries. See https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
contract TokenStaking is Initializable, IStaking, Checkpoints {
    using SafeTUpgradeable for T;
    using PercentUtils for uint256;
    using SafeCastUpgradeable for uint256;

    // enum is used for Staked event to have backward compatibility
    enum StakeType {
        NU,
        KEEP,
        T
    }

    enum ApplicationStatus {
        NOT_APPROVED,
        APPROVED,
        PAUSED,
        DISABLED
    }

    struct StakingProviderInfo {
        uint96 nuInTStake;
        address owner;
        uint96 keepInTStake;
        address payable beneficiary;
        uint96 tStake;
        address authorizer;
        mapping(address => AppAuthorization) authorizations;
        address[] authorizedApplications;
        uint256 startStakingTimestamp;
        bool autoIncrease;
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
        address stakingProvider;
        uint96 amount;
    }

    uint256 internal constant SLASHING_REWARD_PERCENT = 5;
    uint256 internal constant MIN_STAKE_TIME = 120;
    uint256 internal constant GAS_LIMIT_AUTHORIZATION_DECREASE = 250000;
    uint256 internal constant CONVERSION_DIVISOR = 10**(18 - 3);

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    T internal immutable token;

    address public governance;
    uint96 public minTStakeAmount;
    uint256 public authorizationCeiling;
    // slither-disable-next-line constable-states
    uint96 private legacyStakeDiscrepancyPenalty;
    // slither-disable-next-line constable-states
    uint256 private legacyStakeDiscrepancyRewardMultiplier;

    uint256 public notifiersTreasury;
    uint256 public notificationReward;

    mapping(address => StakingProviderInfo) internal stakingProviders;
    mapping(address => ApplicationInfo) public applicationInfo;
    address[] public applications;

    SlashingEvent[] public slashingQueue;
    uint256 public slashingQueueIndex;

    event Staked(
        StakeType indexed stakeType,
        address indexed owner,
        address indexed stakingProvider,
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
        address indexed stakingProvider,
        address indexed application,
        uint96 fromAmount,
        uint96 toAmount
    );
    event AuthorizationDecreaseRequested(
        address indexed stakingProvider,
        address indexed application,
        uint96 fromAmount,
        uint96 toAmount
    );
    event AuthorizationDecreaseApproved(
        address indexed stakingProvider,
        address indexed application,
        uint96 fromAmount,
        uint96 toAmount
    );
    event AuthorizationInvoluntaryDecreased(
        address indexed stakingProvider,
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
    event ToppedUp(address indexed stakingProvider, uint96 amount);
    event AutoIncreaseToggled(
        address indexed stakingProvider,
        bool autoIncrease
    );
    event Unstaked(address indexed stakingProvider, uint96 amount);
    event TokensSeized(
        address indexed stakingProvider,
        uint96 amount,
        bool indexed discrepancy
    );
    event NotificationRewardSet(uint96 reward);
    event NotificationRewardPushed(uint96 reward);
    event NotificationRewardWithdrawn(address recipient, uint96 amount);
    event NotifierRewarded(address indexed notifier, uint256 amount);
    event SlashingProcessed(
        address indexed caller,
        uint256 count,
        uint256 tAmount
    );
    event GovernanceTransferred(address oldGovernance, address newGovernance);

    modifier onlyGovernance() {
        require(governance == msg.sender, "Caller is not the governance");
        _;
    }

    modifier onlyPanicButtonOf(address application) {
        require(
            applicationInfo[application].panicButton == msg.sender,
            "Caller is not the panic button"
        );
        _;
    }

    modifier onlyAuthorizerOf(address stakingProvider) {
        //slither-disable-next-line incorrect-equality
        require(
            stakingProviders[stakingProvider].authorizer == msg.sender,
            "Not authorizer"
        );
        _;
    }

    modifier onlyOwnerOrStakingProvider(address stakingProvider) {
        //slither-disable-next-line incorrect-equality
        require(
            stakingProviders[stakingProvider].owner != address(0) &&
                (stakingProvider == msg.sender ||
                    stakingProviders[stakingProvider].owner == msg.sender),
            "Not owner or provider"
        );
        _;
    }

    modifier onlyOwnerOf(address stakingProvider) {
        // slither-disable-next-line incorrect-equality
        require(
            stakingProviders[stakingProvider].owner == msg.sender,
            "Caller is not owner"
        );
        _;
    }

    /// @param _token Address of T token contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(T _token) {
        // calls to check contracts are working
        require(_token.totalSupply() > 0, "Wrong input parameters");
        token = _token;
    }

    function initialize() external initializer {
        _transferGovernance(msg.sender);
    }

    //
    //
    // Delegating a stake
    //
    //

    /// @notice Creates a delegation with `msg.sender` owner with the given
    ///         staking provider, beneficiary, and authorizer. Transfers the
    ///         given amount of T to the staking contract.
    /// @dev The owner of the delegation needs to have the amount approved to
    ///      transfer to the staking contract.
    function stake(
        address stakingProvider,
        address payable beneficiary,
        address authorizer,
        uint96 amount
    ) external override {
        require(
            stakingProvider != address(0) &&
                beneficiary != address(0) &&
                authorizer != address(0),
            "Parameters must be specified"
        );
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        require(
            stakingProviderStruct.owner == address(0),
            "Provider is already in use"
        );
        require(
            amount > 0 && amount >= minTStakeAmount,
            "Amount is less than minimum"
        );
        stakingProviderStruct.owner = msg.sender;
        stakingProviderStruct.authorizer = authorizer;
        stakingProviderStruct.beneficiary = beneficiary;

        stakingProviderStruct.tStake = amount;
        /* solhint-disable-next-line not-rely-on-time */
        stakingProviderStruct.startStakingTimestamp = block.timestamp;

        increaseStakeCheckpoint(stakingProvider, amount);

        emit Staked(
            StakeType.T,
            msg.sender,
            stakingProvider,
            beneficiary,
            authorizer,
            amount
        );
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Allows the Governance to set the minimum required stake amount.
    ///         This amount is required to protect against griefing the staking
    ///         contract and individual applications are allowed to require
    ///         higher minimum stakes if necessary.
    /// @dev Staking providers are not required to maintain a minimum T stake
    ///      all the time. 24 hours after the delegation, T stake can be reduced
    ///      below the minimum stake. The minimum stake in the staking contract
    ///      is just to protect against griefing stake operation. Please note
    ///      that each application may have its own minimum authorization though
    ///      and the authorization can not be higher than the stake.
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

    /// @notice Increases the authorization of the given staking provider for
    ///         the given application by the given amount. Can only be called by
    ///         the given staking provider’s authorizer.
    /// @dev Calls `authorizationIncreased` callback on the given application to
    ///      notify the application about authorization change.
    ///      See `IApplication`.
    function increaseAuthorization(
        address stakingProvider,
        address application,
        uint96 amount
    ) external override onlyAuthorizerOf(stakingProvider) {
        require(amount > 0, "Parameters must be specified");
        ApplicationInfo storage applicationStruct = applicationInfo[
            application
        ];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );

        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        AppAuthorization storage authorization = stakingProviderStruct
            .authorizations[application];
        uint96 fromAmount = authorization.authorized;
        if (fromAmount == 0) {
            require(
                authorizationCeiling == 0 ||
                    stakingProviderStruct.authorizedApplications.length <
                    authorizationCeiling,
                "Too many applications"
            );
            stakingProviderStruct.authorizedApplications.push(application);
        }

        uint96 availableTValue = getAvailableToAuthorize(
            stakingProvider,
            application
        );
        require(availableTValue >= amount, "Not enough stake to authorize");
        authorization.authorized += amount;
        emit AuthorizationIncreased(
            stakingProvider,
            application,
            fromAmount,
            authorization.authorized
        );
        IApplication(application).authorizationIncreased(
            stakingProvider,
            fromAmount,
            authorization.authorized
        );
    }

    /// @notice Requests decrease of all authorizations for the given staking
    ///         provider on all applications by all authorized amount.
    ///         It may not change the authorized amount immediatelly. When
    ///         it happens depends on the application. Can only be called by the
    ///         given staking provider’s authorizer. Overwrites pending
    ///         authorization decrease for the given staking provider and
    ///         application.
    /// @dev Calls `authorizationDecreaseRequested` callback
    ///      for each authorized application. See `IApplication`.
    function requestAuthorizationDecrease(address stakingProvider) external {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        uint96 deauthorizing = 0;
        for (
            uint256 i = 0;
            i < stakingProviderStruct.authorizedApplications.length;
            i++
        ) {
            address application = stakingProviderStruct.authorizedApplications[
                i
            ];
            uint96 authorized = stakingProviderStruct
                .authorizations[application]
                .authorized;
            if (authorized > 0) {
                requestAuthorizationDecrease(
                    stakingProvider,
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
    ///         decrease the authorization for that staking provider.
    ///         Returns resulting authorized amount for the application.
    function approveAuthorizationDecrease(address stakingProvider)
        external
        override
        returns (uint96)
    {
        ApplicationInfo storage applicationStruct = applicationInfo[msg.sender];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );

        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        AppAuthorization storage authorization = stakingProviderStruct
            .authorizations[msg.sender];
        require(authorization.deauthorizing > 0, "No deauthorizing in process");

        uint96 fromAmount = authorization.authorized;
        authorization.authorized -= authorization.deauthorizing;
        authorization.deauthorizing = 0;
        emit AuthorizationDecreaseApproved(
            stakingProvider,
            msg.sender,
            fromAmount,
            authorization.authorized
        );

        // remove application from an array
        if (authorization.authorized == 0) {
            cleanAuthorizedApplications(stakingProviderStruct, 1);
        }

        return authorization.authorized;
    }

    /// @notice Decreases the authorization for the given `stakingProvider` on
    ///         the given disabled `application`, for all authorized amount.
    ///         Can be called by anyone.
    function forceDecreaseAuthorization(
        address stakingProvider,
        address application
    ) external override {
        require(
            applicationInfo[application].status == ApplicationStatus.DISABLED,
            "Application is not disabled"
        );

        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        AppAuthorization storage authorization = stakingProviderStruct
            .authorizations[application];
        uint96 fromAmount = authorization.authorized;
        require(fromAmount > 0, "Application is not authorized");
        authorization.authorized = 0;
        authorization.deauthorizing = 0;

        emit AuthorizationDecreaseApproved(
            stakingProvider,
            application,
            fromAmount,
            0
        );
        cleanAuthorizedApplications(stakingProviderStruct, 1);
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

    /// @notice Sets the maximum number of applications one staking provider can
    ///         have authorized. Used to protect against DoSing slashing queue.
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

    /// @notice Increases the amount of the stake for the given staking provider.
    ///         If `autoIncrease` flag is true then the amount will be added for
    ///         all authorized applications.
    /// @dev The sender of this transaction needs to have the amount approved to
    ///      transfer to the staking contract.
    function topUp(address stakingProvider, uint96 amount) external override {
        require(
            stakingProviders[stakingProvider].owner != address(0),
            "Nothing to top-up"
        );
        require(amount > 0, "Parameters must be specified");
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        stakingProviderStruct.tStake += amount;
        emit ToppedUp(stakingProvider, amount);
        increaseStakeCheckpoint(stakingProvider, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);

        if (!stakingProviderStruct.autoIncrease) {
            return;
        }

        // increase authorization for all authorized app
        for (
            uint256 i = 0;
            i < stakingProviderStruct.authorizedApplications.length;
            i++
        ) {
            address application = stakingProviderStruct.authorizedApplications[
                i
            ];
            AppAuthorization storage authorization = stakingProviderStruct
                .authorizations[application];
            uint96 fromAmount = authorization.authorized;
            authorization.authorized += amount;
            emit AuthorizationIncreased(
                stakingProvider,
                application,
                fromAmount,
                authorization.authorized
            );
            IApplication(application).authorizationIncreased(
                stakingProvider,
                fromAmount,
                authorization.authorized
            );
        }
    }

    /// @notice Toggle `autoIncrease` flag. If true then the complete amount
    ///         in top-up will be added to already authorized applications.
    function toggleAutoAuthorizationIncrease(address stakingProvider)
        external
        override
        onlyAuthorizerOf(stakingProvider)
    {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        stakingProviderStruct.autoIncrease = !stakingProviderStruct
            .autoIncrease;
        emit AutoIncreaseToggled(
            stakingProvider,
            stakingProviderStruct.autoIncrease
        );
    }

    //
    //
    // Undelegating a stake (unstaking)
    //
    //

    /// @notice Reduces the T stake amount by the provided amount and
    ///         withdraws T to the owner. Reverts if there is at least one
    ///         authorization higher than the remaining T stake or
    ///         if the unstake amount is higher than the T stake amount.
    ///         Can be called only by the delegation owner or the staking
    ///         provider.
    function unstakeT(address stakingProvider, uint96 amount)
        external
        override
        onlyOwnerOrStakingProvider(stakingProvider)
    {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        require(
            amount > 0 &&
                amount + getMaxAuthorization(stakingProvider) <=
                stakingProviderStruct.tStake,
            "Too much to unstake"
        );
        require(
            stakingProviderStruct.startStakingTimestamp + MIN_STAKE_TIME <=
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp,
            "Can't unstake earlier than 24h"
        );

        stakingProviderStruct.tStake -= amount;
        decreaseStakeCheckpoint(stakingProvider, amount);
        emit Unstaked(stakingProvider, amount);
        token.safeTransfer(stakingProviderStruct.owner, amount);
    }

    //
    //
    // Keeping information in sync
    //
    //

    /// @notice Sets reward in T tokens for notification of misbehaviour
    ///         of one staking provider. Can only be called by the governance.
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

    /// @notice Adds staking providers to the slashing queue along with the
    ///         amount that should be slashed from each one of them. Can only be
    ///         called by application authorized for all staking providers in
    ///         the array.
    /// @dev    This method doesn't emit events for providers that are added to
    ///         the queue. If necessary  events can be added to the application
    ///         level.
    function slash(uint96 amount, address[] memory _stakingProviders)
        external
        override
    {
        notify(amount, 0, address(0), _stakingProviders);
    }

    /// @notice Adds staking providers to the slashing queue along with the
    ///         amount. The notifier will receive reward per each provider from
    ///         notifiers treasury. Can only be called by application
    ///         authorized for all staking providers in the array.
    /// @dev    This method doesn't emit events for staking providers that are
    ///         added to the queue. If necessary  events can be added to the
    ///         application level.
    function seize(
        uint96 amount,
        uint256 rewardMultiplier,
        address notifier,
        address[] memory _stakingProviders
    ) external override {
        notify(amount, rewardMultiplier, notifier, _stakingProviders);
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
        maxIndex = MathUpgradeable.min(maxIndex, slashingQueue.length);
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
    ///         `stakingProvider` to a `delegatee` address. Caller must be the
    ///         owner of this stake.
    function delegateVoting(address stakingProvider, address delegatee)
        external
    {
        delegate(stakingProvider, delegatee);
    }

    /// @notice Transfers ownership of the contract to `newGuvnor`.
    function transferGovernance(address newGuvnor)
        external
        virtual
        onlyGovernance
    {
        _transferGovernance(newGuvnor);
    }

    //
    //
    // Auxiliary functions
    //
    //

    /// @notice Returns the authorized stake amount of the staking provider for
    ///         the application.
    function authorizedStake(address stakingProvider, address application)
        external
        view
        override
        returns (uint96)
    {
        return
            stakingProviders[stakingProvider]
                .authorizations[application]
                .authorized;
    }

    /// @notice Returns staked amount of T for the specified staking provider.
    /// @dev    Method is deprecated. Use `stakeAmount` instead
    function stakes(address stakingProvider)
        external
        view
        returns (
            uint96 tStake,
            uint96 keepInTStake,
            uint96 nuInTStake
        )
    {
        tStake = stakingProviders[stakingProvider].tStake;
        keepInTStake = 0;
        nuInTStake = 0;
    }

    /// @notice Returns staked amount of T for the specified staking provider.
    function stakeAmount(address stakingProvider)
        external
        view
        override
        returns (uint96)
    {
        return stakingProviders[stakingProvider].tStake;
    }

    /// @notice Returns start staking timestamp.
    /// @dev    This value is set at most once.
    function getStartStakingTimestamp(address stakingProvider)
        external
        view
        override
        returns (uint256)
    {
        return stakingProviders[stakingProvider].startStakingTimestamp;
    }

    /// @notice Returns auto-increase flag.
    function getAutoIncreaseFlag(address stakingProvider)
        external
        view
        override
        returns (bool)
    {
        return stakingProviders[stakingProvider].autoIncrease;
    }

    /// @notice Gets the stake owner, the beneficiary and the authorizer
    ///         for the specified staking provider address.
    /// @return owner Stake owner address.
    /// @return beneficiary Beneficiary address.
    /// @return authorizer Authorizer address.
    function rolesOf(address stakingProvider)
        external
        view
        override
        returns (
            address owner,
            address payable beneficiary,
            address authorizer
        )
    {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        owner = stakingProviderStruct.owner;
        beneficiary = stakingProviderStruct.beneficiary;
        authorizer = stakingProviderStruct.authorizer;
    }

    /// @notice Returns length of application array
    function getApplicationsLength() external view override returns (uint256) {
        return applications.length;
    }

    /// @notice Returns length of slashing queue
    function getSlashingQueueLength() external view override returns (uint256) {
        return slashingQueue.length;
    }

    /// @notice Requests decrease of the authorization for the given staking
    ///         provider on the given application by the provided amount.
    ///         It may not change the authorized amount immediatelly. When
    ///         it happens depends on the application. Can only be called by the
    ///         given staking provider’s authorizer. Overwrites pending
    ///         authorization decrease for the given staking provider and
    ///         application if the application agrees for that. If the
    ///         application does not agree for overwriting, the function
    ///         reverts.
    /// @dev Calls `authorizationDecreaseRequested` callback on the given
    ///      application. See `IApplication`.
    function requestAuthorizationDecrease(
        address stakingProvider,
        address application,
        uint96 amount
    ) public override onlyAuthorizerOf(stakingProvider) {
        ApplicationInfo storage applicationStruct = applicationInfo[
            application
        ];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );

        require(amount > 0, "Parameters must be specified");

        AppAuthorization storage authorization = stakingProviders[
            stakingProvider
        ].authorizations[application];
        require(
            authorization.authorized >= amount,
            "Amount exceeds authorized"
        );

        authorization.deauthorizing = amount;
        uint96 deauthorizingTo = authorization.authorized - amount;
        emit AuthorizationDecreaseRequested(
            stakingProvider,
            application,
            authorization.authorized,
            deauthorizingTo
        );
        IApplication(application).authorizationDecreaseRequested(
            stakingProvider,
            authorization.authorized,
            deauthorizingTo
        );
    }

    /// @notice Returns the maximum application authorization
    function getMaxAuthorization(address stakingProvider)
        public
        view
        override
        returns (uint96)
    {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        uint256 maxAuthorization = 0;
        for (
            uint256 i = 0;
            i < stakingProviderStruct.authorizedApplications.length;
            i++
        ) {
            address application = stakingProviderStruct.authorizedApplications[
                i
            ];
            maxAuthorization = MathUpgradeable.max(
                maxAuthorization,
                stakingProviderStruct.authorizations[application].authorized
            );
        }
        return maxAuthorization.toUint96();
    }

    /// @notice Returns available amount to authorize for the specified
    ///         application.
    function getAvailableToAuthorize(
        address stakingProvider,
        address application
    ) public view override returns (uint96 availableTValue) {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        availableTValue = stakingProviderStruct.tStake;
        uint96 authorized = stakingProviderStruct
            .authorizations[application]
            .authorized;
        if (authorized <= availableTValue) {
            availableTValue -= authorized;
        } else {
            availableTValue = 0;
        }
    }

    /// @notice Delegate voting power from the stake associated to the
    ///         `stakingProvider` to a `delegatee` address. Caller must be the owner
    ///         of this stake.
    /// @dev Original abstract function defined in Checkpoints contract had two
    ///      parameters, `delegator` and `delegatee`. Here we override it and
    ///      comply with the same signature but the semantics of the first
    ///      parameter changes to the `stakingProvider` address.
    function delegate(address stakingProvider, address delegatee)
        internal
        virtual
        override
        onlyOwnerOf(stakingProvider)
    {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        uint96 stakingProviderBalance = stakingProviderStruct.tStake;
        address oldDelegatee = delegates(stakingProvider);
        _delegates[stakingProvider] = delegatee;
        emit DelegateChanged(stakingProvider, oldDelegatee, delegatee);
        moveVotingPower(oldDelegatee, delegatee, stakingProviderBalance);
    }

    /// @notice Adds staking providers to the slashing queue along with the
    ///         amount. The notifier will receive reward per each staking
    ///         provider from notifiers treasury. Can only be called by
    ///         application authorized for all staking providers in the array.
    function notify(
        uint96 amount,
        uint256 rewardMultiplier,
        address notifier,
        address[] memory _stakingProviders
    ) internal {
        require(
            amount > 0 && _stakingProviders.length > 0,
            "Parameters must be specified"
        );

        ApplicationInfo storage applicationStruct = applicationInfo[msg.sender];
        require(
            applicationStruct.status == ApplicationStatus.APPROVED,
            "Application is not approved"
        );

        uint256 queueLength = slashingQueue.length;
        for (uint256 i = 0; i < _stakingProviders.length; i++) {
            address stakingProvider = _stakingProviders[i];
            uint256 amountToSlash = MathUpgradeable.min(
                stakingProviders[stakingProvider]
                    .authorizations[msg.sender]
                    .authorized,
                amount
            );
            if (
                //slither-disable-next-line incorrect-equality
                amountToSlash == 0
            ) {
                continue;
            }
            slashingQueue.push(
                SlashingEvent(stakingProvider, amountToSlash.toUint96())
            );
        }

        if (notifier != address(0)) {
            uint256 reward = ((slashingQueue.length - queueLength) *
                notificationReward).percent(rewardMultiplier);
            reward = MathUpgradeable.min(reward, notifiersTreasury);
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
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            slashing.stakingProvider
        ];
        uint96 tAmountToSlash = slashing.amount;
        uint96 oldStake = stakingProviderStruct.tStake;
        // slash T
        tAmountToBurn = MathUpgradeable
            .min(tAmountToSlash, stakingProviderStruct.tStake)
            .toUint96();
        stakingProviderStruct.tStake -= tAmountToBurn;
        tAmountToSlash -= tAmountToBurn;

        uint96 slashedAmount = slashing.amount - tAmountToSlash;
        emit TokensSeized(slashing.stakingProvider, slashedAmount, false);
        authorizationDecrease(
            slashing.stakingProvider,
            stakingProviderStruct,
            slashedAmount
        );
        uint96 newStake = stakingProviderStruct.tStake;
        decreaseStakeCheckpoint(slashing.stakingProvider, oldStake - newStake);
    }

    /// @notice Synchronize authorizations (if needed) after slashing stake
    //slither-disable-next-line dead-code
    function authorizationDecrease(
        address stakingProvider,
        StakingProviderInfo storage stakingProviderStruct,
        uint96 slashedAmount
    ) internal {
        uint96 totalStake = stakingProviderStruct.tStake;
        uint256 applicationsToDelete = 0;
        for (
            uint256 i = 0;
            i < stakingProviderStruct.authorizedApplications.length;
            i++
        ) {
            address authorizedApplication = stakingProviderStruct
                .authorizedApplications[i];
            AppAuthorization storage authorization = stakingProviderStruct
                .authorizations[authorizedApplication];
            uint96 fromAmount = authorization.authorized;

            authorization.authorized -= MathUpgradeable
                .min(fromAmount, slashedAmount)
                .toUint96();

            if (authorization.authorized > totalStake) {
                authorization.authorized = totalStake;
            }

            bool successful = true;
            //slither-disable-next-line calls-loop
            try
                IApplication(authorizedApplication)
                    .involuntaryAuthorizationDecrease{
                    gas: GAS_LIMIT_AUTHORIZATION_DECREASE
                }(stakingProvider, fromAmount, authorization.authorized)
            {} catch {
                successful = false;
            }
            if (authorization.deauthorizing > authorization.authorized) {
                authorization.deauthorizing = authorization.authorized;
            }
            emit AuthorizationInvoluntaryDecreased(
                stakingProvider,
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
            cleanAuthorizedApplications(
                stakingProviderStruct,
                applicationsToDelete
            );
        }
    }

    /// @notice Removes application with zero authorization from authorized
    ///         applications array
    function cleanAuthorizedApplications(
        StakingProviderInfo storage stakingProviderStruct,
        uint256 numberToDelete
    ) internal {
        uint256 length = stakingProviderStruct.authorizedApplications.length;
        if (numberToDelete == length) {
            delete stakingProviderStruct.authorizedApplications;
            return;
        }

        uint256 deleted = 0;
        uint256 index = 0;
        uint256 newLength = length - numberToDelete;
        while (index < newLength && deleted < numberToDelete) {
            address application = stakingProviderStruct.authorizedApplications[
                index
            ];
            if (
                stakingProviderStruct.authorizations[application].authorized ==
                0
            ) {
                stakingProviderStruct.authorizedApplications[
                        index
                    ] = stakingProviderStruct.authorizedApplications[
                    length - deleted - 1
                ];
                deleted++;
            } else {
                index++;
            }
        }

        for (index = newLength; index < length; index++) {
            stakingProviderStruct.authorizedApplications.pop();
        }
    }

    /// @notice Creates new checkpoints due to a change of stake amount
    /// @param _delegator Address of the staking provider acting as delegator
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
    /// @param _delegator Address of the staking provider acting as delegator
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

    function _transferGovernance(address newGuvnor) internal virtual {
        address oldGuvnor = governance;
        governance = newGuvnor;
        emit GovernanceTransferred(oldGuvnor, newGuvnor);
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../staking/IApplication.sol";
import "../staking/TokenStaking.sol";

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

    function withdrawRewards(address) external {
        // does nothing
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

    function availableRewards(address) external pure returns (uint96) {
        return 0;
    }

    function minimumAuthorization() external pure returns (uint96) {
        return 0;
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
        stakingProviderStruct.authorized = toAmount;
        if (stakingProviderStruct.deauthorizingTo > toAmount) {
            stakingProviderStruct.deauthorizingTo = toAmount;
        }
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
    using SafeTUpgradeable for T;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(T _token) TokenStaking(_token) {}

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
    ) external {
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

        token.safeTransferFrom(msg.sender, address(this), amount);
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
    ) external onlyAuthorizerOf(stakingProvider) {
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
        IApplication(application).authorizationIncreased(
            stakingProvider,
            fromAmount,
            authorization.authorized
        );
    }

    /// @notice Transfer some amount of T tokens as reward for notifications
    ///         of misbehaviour
    function pushNotificationReward(uint96 reward) external {
        require(reward > 0, "Parameters must be specified");
        notifiersTreasury += reward;
        token.safeTransferFrom(msg.sender, address(this), reward);
    }

    function getAuthorizedApplications(address stakingProvider)
        external
        view
        returns (address[] memory)
    {
        return stakingProviders[stakingProvider].authorizedApplications;
    }

    function getDeauthorizingAmount(
        address stakingProvider,
        address application
    ) external view returns (uint96) {
        return
            stakingProviders[stakingProvider]
                .authorizations[application]
                .deauthorizing;
    }

    /// @notice Creates new checkpoints due to an increment of a stakers' stake
    /// @param _delegator Address of the staking provider acting as delegator
    /// @param _amount Amount of T to increment
    function increaseStakeCheckpoint(address _delegator, uint96 _amount)
        internal
    {
        newStakeCheckpoint(_delegator, _amount, true);
    }

    function skipApplication(address) internal pure override returns (bool) {
        return false;
    }
}

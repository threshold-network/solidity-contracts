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

    function availableRewards(address) external pure returns (uint96) {
        return 0;
    }

    function minimumAuthorization() external pure returns (uint96) {
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
        VendingMachine _nucypherVendingMachine
    )
        TokenStaking(
            _token,
            _nucypherVendingMachine
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

contract LegacyTokenStaking is TokenStaking {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        T _token,
        VendingMachine _nucypherVendingMachine
    )
        TokenStaking(
            _token,
            _nucypherVendingMachine
        )
    {}

    function setLegacyStakingProviderDefault(address stakingProvider) external {
        setLegacyStakingProvider(stakingProvider, stakingProvider, payable(stakingProvider), stakingProvider);
    }

    function setLegacyStakingProvider(address stakingProvider, address owner, address payable beneficiary, address authorizer) public {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        stakingProviderStruct.owner = owner;
        stakingProviderStruct.authorizer = authorizer;
        stakingProviderStruct.beneficiary = beneficiary;
    }

    function addLegacyStake(address stakingProvider, uint96 keepInTStake, uint96 nuInTStake) external {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        stakingProviderStruct.keepInTStake += keepInTStake;
        stakingProviderStruct.nuInTStake += nuInTStake;
        if (stakingProviderStruct.startStakingTimestamp == 0) {
            /* solhint-disable-next-line not-rely-on-time */
            stakingProviderStruct.startStakingTimestamp = block.timestamp;
        }
        increaseStakeCheckpoint(stakingProvider, keepInTStake + nuInTStake);
    }

    function forceIncreaseAuthorization(address stakingProvider, address application, uint96 amount) external {
        StakingProviderInfo storage stakingProviderStruct = stakingProviders[
            stakingProvider
        ];
        AppAuthorization storage authorization = stakingProviderStruct
            .authorizations[application];
        stakingProviderStruct.authorizedApplications.push(application);
        authorization.authorized += amount;
    }

}
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

pragma solidity ^0.8.9;

import "../token/T.sol";
import "../staking/IStaking.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

/// @title  StableYield contract
/// @notice Contract that mints and distributes stable yield reward for participating in Threshold Network.
///         Periodically mints reward for each application based on authorization rate and destributes this rewards based on type of application.
contract StableYield is OwnableUpgradeable {
    using AddressUpgradeable for address;

    struct ApplicationInfo {
        uint256 stableYield;
        uint256 duration;
        address distributor;
        string receiveRewardMethod;
        uint256 lastMint;
    }

    uint256 public constant STABLE_YIELD_BASE = 10000;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    T internal immutable token;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IStaking internal immutable tokenStaking;

    mapping(address => ApplicationInfo) public applicationInfo;

    /// @dev Event emitted by `setApplicationParameters` function.
    event ParametersSet(
        address indexed application,
        uint256 stableYield,
        uint256 duration,
        address distributor,
        string receiveRewardMethod
    );

    /// @dev Event emitted by `mintAndPushReward` function.
    event MintedReward(address indexed application, uint96 reward);

    constructor(T _token, IStaking _tokenStaking) {
        // calls to check contracts are working
        uint256 totalSupply = _token.totalSupply();
        require(
            totalSupply > 0 && _tokenStaking.getApplicationsLength() > 0,
            "Wrong input parameters"
        );
        require(
            (STABLE_YIELD_BASE * totalSupply * totalSupply) /
                totalSupply /
                STABLE_YIELD_BASE ==
                totalSupply,
            "Potential overflow"
        );
        token = _token;
        tokenStaking = _tokenStaking;
        _transferOwnership(_msgSender());
    }

    /// @notice Sets or updates application parameter for minting reward.
    ///         Can be called only by the governance.
    function setApplicationParameters(
        address application,
        uint256 stableYield,
        uint256 duration,
        address distributor,
        string memory receiveRewardMethod
    ) external onlyOwner {
        // if stable yield is zero then reward will be no longer minted
        require(
            (stableYield == 0 ||
                (stableYield < STABLE_YIELD_BASE && duration > 0)) &&
                distributor != address(0),
            "Wrong input parameters"
        );
        ApplicationInfo storage info = applicationInfo[application];
        info.stableYield = stableYield;
        info.duration = duration;
        info.distributor = distributor;
        info.receiveRewardMethod = receiveRewardMethod;
        emit ParametersSet(
            application,
            stableYield,
            duration,
            distributor,
            receiveRewardMethod
        );
    }

    /// @notice Mints reward and then pushes it to particular application or distributor.
    /// @dev Application must be in `APPROVED` state
    function mintAndPushReward(address application) external {
        ApplicationInfo storage info = applicationInfo[application];
        require(
            info.stableYield != 0,
            "Reward parameters are not set for the application"
        );
        require(
            /* solhint-disable-next-line not-rely-on-time */
            block.timestamp >= info.lastMint + info.duration,
            "New portion of reward is not ready"
        );
        IStaking.ApplicationStatus status = tokenStaking.getApplicationStatus(
            application
        );
        require(
            status == IStaking.ApplicationStatus.APPROVED,
            "Application is not approved"
        );
        uint96 reward = calculateReward(application, info.stableYield);
        /* solhint-disable-next-line not-rely-on-time */
        info.lastMint = block.timestamp;
        //slither-disable-next-line incorrect-equality
        if (bytes(info.receiveRewardMethod).length == 0) {
            sendToDistributor(info.distributor, reward);
        } else {
            executeReceiveReward(application, info.receiveRewardMethod, reward);
        }
        emit MintedReward(application, reward);
    }

    function sendToDistributor(address distributor, uint96 reward) internal {
        token.mint(distributor, reward);
    }

    function executeReceiveReward(
        address distributor,
        string storage receiveRewardMethod,
        uint96 reward
    ) internal {
        token.mint(address(this), reward);
        //slither-disable-next-line unused-return
        token.approve(distributor, reward);
        bytes memory data = abi.encodeWithSignature(
            receiveRewardMethod,
            reward
        );
        //slither-disable-next-line unused-return
        distributor.functionCall(data);
    }

    function calculateReward(address application, uint256 stableYield)
        internal
        view
        returns (uint96 reward)
    {
        uint96 authorizedOverall = tokenStaking.getAuthorizedOverall(
            application
        );
        uint256 totalSupply = token.totalSupply();
        // stableYieldPercent * authorizationRate * authorizedOverall =
        // (stableYield / STABLE_YIELD_BASE) * (authorizedOverall  / totalSupply) * authorizedOverall
        reward = uint96(
            (stableYield * authorizedOverall * authorizedOverall) /
                totalSupply /
                STABLE_YIELD_BASE
        );
    }
}

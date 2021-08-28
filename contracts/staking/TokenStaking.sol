// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

import "./StakingProviders.sol";
import "./IApplication.sol";
import "../token/T.sol";
import "../vending/VendingMachine.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Meta staking contract. 3 roles: app, meta staking, app manager
contract TokenStaking is Ownable {
    using SafeERC20 for T;

    // TODO events

    enum StakingProvider {
        NU,
        KEEP,
        T
    }

    struct AppAllocation {
        uint256 allocated;
        uint256 endDeallocation;
        uint256 deallocated;
    }

    struct ApplicationInfo {
        mapping(StakingProvider => bool) availability;
        uint256 allocatedOverall;
        uint256 deallocationDuration;
        uint256 minAllocationSize;
    }

    T public immutable token;
    IKeepTokenStaking public immutable keepStakingContract;
    INuCypherStakingEscrow public immutable nucypherStakingContract;
    VendingMachine public immutable keepVendingMachine;
    VendingMachine public immutable nucypherVendingMachine;

    mapping(address => uint256) public tStakers;

    mapping(address => mapping(StakingProvider => mapping(address => AppAllocation)))
        public allocationsPerStaker;
    // TODO public getter for availability
    mapping(address => ApplicationInfo) public appInfo;
    address[] public apps;

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
        // TODO check contracts and input variables
        token = _token;
        keepStakingContract = _keepStakingContract;
        nucypherStakingContract = _nucypherStakingContract;
        keepVendingMachine = _keepVendingMachine;
        nucypherVendingMachine = _nucypherVendingMachine;
    }

    /// @notice Penalizes staker `staker`; the penalty details are encoded in `penaltyData`
    function slashStaker(address staker, bytes calldata penaltyData) external {
        // TODO check slashing event (from app)
        // TODO choose stake (and check allocation)
        // TODO prepare caldata
        // TODO send slashing call
    }

    /// @notice Enable/disable application for the specified staking providers and reset deallocation duration
    function setupApplication(
        address app,
        StakingProvider[] calldata stakingProviders,
        bool availability
    ) external onlyOwner {
        ApplicationInfo storage info = appInfo[app];
        for (uint256 i = 0; i < stakingProviders.length; i++) {
            StakingProvider stakingProvider = stakingProviders[i];
            info.availability[stakingProvider] = availability;
        }
        info.deallocationDuration = IApplication(app).deallocationDuration();
        info.minAllocationSize = IApplication(app).minAllocationSize();

        bool existingApp = false;
        for (uint256 i = 0; i < apps.length; i++) {
            if (apps[i] == app) {
                existingApp = true;
                break;
            }
        }
        if (!existingApp) {
            apps.push(app);
        }
    }

    /// @notice Depost and stake T tokens
    function stake(uint256 value) external {
        require(value > 0, "Value to stake must be greater than 0");
        tStakers[msg.sender] += value;
        token.safeTransferFrom(msg.sender, address(this), value);
    }

    /// @notice Withdraw tokens after unstaking period is finished
    function withdraw(uint256 value) external {
        require(
            value > 0 &&
                getAvailableToWithdraw(msg.sender, StakingProvider.T) >= value,
            "Not enough tokens to withdraw"
        );
        tStakers[msg.sender] -= value;
        token.safeTransfer(msg.sender, value);
    }

    /// @notice Allocate part of stake for the specified application
    function allocate(
        address app,
        uint256 amount,
        StakingProvider stakingProvider
    ) external {
        AppAllocation storage appAllocation = allocationsPerStaker[msg.sender][
            stakingProvider
        ][app];
        require(
            /* solhint-disable-next-line not-rely-on-time */
            appAllocation.endDeallocation <= block.timestamp,
            "Dealocation in progress"
        );

        ApplicationInfo storage info = appInfo[app];
        require(
            appAllocation.allocated + amount >= info.minAllocationSize,
            "Allocation is too small"
        );

        uint256 availableTValue = getAvailableToAllocate(
            msg.sender,
            app,
            stakingProvider
        );
        require(availableTValue >= amount, "Not enough stake to allocate");
        appAllocation.allocated += amount;
        info.allocatedOverall += amount;
        sendAllocationUpdate(msg.sender, app);
    }

    /// @notice Start deallocation process
    function deallocate() external returns (uint256 deallocated) {
        deallocated = 0;
        for (uint256 i = 0; i < apps.length; i++) {
            address app = apps[i];
            deallocated += _deallocate(app);
        }

        require(deallocated > 0, "Nothing was allocated");
    }

    /// @notice Cancel all allocations of stake for the specified application
    function deallocate(address app) external returns (uint256 deallocated) {
        deallocated = _deallocate(app);

        require(deallocated > 0, "Nothing was allocated");
    }

    /// @notice Cancel allocation of stake for the specified application
    function deallocate(address app, StakingProvider stakingProvider)
        external
        returns (uint256 deallocated)
    {
        deallocated = _deallocate(app, stakingProvider);

        require(deallocated > 0, "Nothing was allocated");

        sendAllocationUpdate(msg.sender, app);
    }

    /// @notice Cancel allocation of stake for the specified application
    function deallocate(
        address app,
        uint256 amount,
        StakingProvider stakingProvider
    ) external {
        require(amount > 0, "Value to deallocation must be greater than 0");

        _deallocate(app, amount, stakingProvider);
        sendAllocationUpdate(msg.sender, app);
    }

    /// @notice Returns available amount to allocate to the specified application
    function getAvailableToAllocate(address staker, address app)
        external
        view
        returns (uint256 tValue)
    {
        tValue += getAvailableToAllocate(staker, app, StakingProvider.KEEP);
        tValue += getAvailableToAllocate(staker, app, StakingProvider.NU);
        tValue += getAvailableToAllocate(staker, app, StakingProvider.T);
    }

    /// @notice Returns allocated amount to the specified application per staker
    function getAllocated(address[] memory stakersSet, address app)
        external
        view
        returns (uint256[] memory allocated)
    {
        allocated = new uint256[](stakersSet.length);
        for (uint256 i = 0; i < stakersSet.length; i++) {
            address staker = stakersSet[i];
            (allocated[i], ) = getAllocated(staker, app);
        }
    }

    /// @notice Returns available amount of stake to withdraw (not applicable for Keep)
    function getAvailableToWithdraw(
        address staker,
        StakingProvider stakingProvider
    ) public view returns (uint256 tValue) {
        if (apps.length == 0) {
            return tStakers[staker];
        }
        tValue = getAvailableToWithdraw(staker, apps[0], stakingProvider);
        for (uint256 i = 1; i < apps.length; i++) {
            address app = apps[i];
            tValue = Math.min(
                tValue,
                getAvailableToWithdraw(staker, app, stakingProvider)
            );
        }
    }

    /// @notice Returns available amount from staking provider to allocate to the specified application
    function getAvailableToAllocate(
        address staker,
        address app,
        StakingProvider stakingProvider
    ) public view returns (uint256 availableTValue) {
        if (!appInfo[app].availability[stakingProvider]) {
            return 0;
        }

        AppAllocation storage appAllocation = allocationsPerStaker[msg.sender][
            stakingProvider
        ][app];
        /* solhint-disable-next-line not-rely-on-time */
        if (appAllocation.endDeallocation > block.timestamp) {
            return 0;
        }

        uint256 tValue = getStakeAmount(staker, stakingProvider);
        availableTValue = appAllocation.allocated <= tValue
            ? tValue - appAllocation.allocated
            : 0;
    }

    /// @notice Returns staked amount from the staking provider
    function getStakeAmount(
        address staker,
        StakingProvider stakingProvider // TODO internal?
    ) public view returns (uint256 tValue) {
        uint256 stakeAmount;
        if (stakingProvider == StakingProvider.KEEP) {
            uint256 undelegatedAt;
            (stakeAmount, , undelegatedAt) = keepStakingContract
                .getDelegationInfo(staker);
            (tValue, ) = undelegatedAt == 0
                ? keepVendingMachine.conversionToT(stakeAmount)
                : (0, 0);
        } else if (stakingProvider == StakingProvider.NU) {
            stakeAmount = nucypherStakingContract.getAllTokens(staker);
            (tValue, ) = nucypherVendingMachine.conversionToT(stakeAmount);
        } else {
            tValue = tStakers[staker];
        }
    }

    /// @notice Returns allocated amount to the specified application from staking provider
    function getAllocated(
        address staker,
        address app,
        StakingProvider stakingProvider
    ) public view returns (uint256 allocated, uint256 deallocated) {
        AppAllocation storage allocation = allocationsPerStaker[staker][
            stakingProvider
        ][app];
        allocated = allocation.allocated;
        /* solhint-disable-next-line not-rely-on-time */
        deallocated = allocation.endDeallocation > block.timestamp
            ? allocation.deallocated
            : 0;
    }

    /// @notice Returns allocated amount to the specified application
    function getAllocated(address staker, address app)
        public
        view
        returns (uint256 allocated, uint256 deallocated)
    {
        (allocated, deallocated) = getAllocated(staker, app, StakingProvider.T);
        (uint256 allocatedInKeep, uint256 deallocatedInKeep) = getAllocated(
            staker,
            app,
            StakingProvider.KEEP
        );
        allocated += allocatedInKeep;
        deallocated += deallocatedInKeep;
        (uint256 allocatedInNU, uint256 deallocatedInNU) = getAllocated(
            staker,
            app,
            StakingProvider.NU
        );
        allocated += allocatedInNU;
        deallocated += deallocatedInNU;
    }

    /// @notice Send changes in allocation to the specified application
    function sendAllocationUpdate(address staker, address app) internal {
        (uint256 allocated, uint256 deallocated) = getAllocated(staker, app);
        IApplication(app).receiveAllocation(
            staker,
            allocated,
            deallocated,
            appInfo[app].allocatedOverall
        );
    }

    /// @notice Cancel all allocations of stake for the specified application
    function _deallocate(address app) internal returns (uint256 deallocated) {
        deallocated = _deallocate(app, StakingProvider.KEEP);
        deallocated += _deallocate(app, StakingProvider.NU);
        deallocated += _deallocate(app, StakingProvider.T);

        if (deallocated > 0) {
            sendAllocationUpdate(msg.sender, app);
        }
    }

    /// @notice Cancel allocation of stake for the specified application
    function _deallocate(address app, StakingProvider stakingProvider)
        internal
        returns (uint256)
    {
        uint256 allocated = allocationsPerStaker[msg.sender][stakingProvider][
            app
        ].allocated;
        _deallocate(app, allocated, stakingProvider);
        return allocated;
    }

    /// @notice Cancel allocation of stake for the specified application
    function _deallocate(
        address app,
        uint256 amount,
        StakingProvider stakingProvider
    ) internal {
        if (amount == 0) {
            return;
        }

        AppAllocation storage appAllocation = allocationsPerStaker[msg.sender][
            stakingProvider
        ][app];
        require(
            /* solhint-disable-next-line not-rely-on-time */
            appAllocation.endDeallocation <= block.timestamp,
            "Deallocation in progress"
        );
        require(
            amount <= appAllocation.allocated,
            "Allocated less than requested"
        );

        ApplicationInfo storage info = appInfo[app];
        appAllocation.allocated -= amount;
        require(
            appAllocation.allocated == 0 ||
                appAllocation.allocated >= info.minAllocationSize,
            "Resulting allocation less than minimum allowed"
        );

        appAllocation.deallocated = amount;
        appAllocation.endDeallocation =
            /* solhint-disable-next-line not-rely-on-time */
            block.timestamp +
            info.deallocationDuration;
        info.allocatedOverall -= amount;
    }

    /// @notice Returns available amount of T stake to withdraw
    function getAvailableToWithdraw(
        address staker,
        address app,
        StakingProvider stakingProvider
    ) internal view returns (uint256 availableTValue) {
        uint256 tValue = getStakeAmount(staker, stakingProvider);
        AppAllocation storage appAllocation = allocationsPerStaker[msg.sender][
            stakingProvider
        ][app];
        uint256 unavailable = appAllocation.allocated;
        /* solhint-disable-next-line not-rely-on-time */
        unavailable += appAllocation.endDeallocation > block.timestamp
            ? appAllocation.deallocated
            : 0;
        availableTValue = unavailable <= tValue ? tValue - unavailable : 0;
    }
}

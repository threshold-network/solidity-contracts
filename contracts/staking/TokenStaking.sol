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

    struct OperatorInfo {
        mapping(StakingProvider => mapping(address => AppAllocation)) allocations;
        address owner;
        address beneficiary;
        address authorizer;
        uint256 tStake;
    }

    struct AppAllocation {
        uint256 allocated;
        uint256 endDeallocation;
        uint256 deallocating;
    }

    struct ApplicationInfo {
        mapping(StakingProvider => bool) availability;
        uint256 allocatedOverall;
        uint256 deallocationDuration;
        uint256 minAllocationSize;
        bool suspended;
    }

    T public immutable token;
    IKeepTokenStaking public immutable keepStakingContract;
    INuCypherStakingEscrow public immutable nucypherStakingContract;
    VendingMachine public immutable keepVendingMachine;
    VendingMachine public immutable nucypherVendingMachine;

    // TODO public getters for inner mappings
    mapping(address => OperatorInfo) public operators;
    mapping(address => ApplicationInfo) public appInfo;
    address[] public apps;

    modifier onlyOperatorsOwner(address operator) {
        require(
            operators[operator].owner == msg.sender,
            "Only owner can call this function"
        );
        _;
    }

    /// @notice Check if application was suspended
    modifier applicationSuspensionCheck(address app) {
        require(appInfo[app].suspended, "Application was suspended");
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
        // TODO check contracts and input variables
        token = _token;
        keepStakingContract = _keepStakingContract;
        nucypherStakingContract = _nucypherStakingContract;
        keepVendingMachine = _keepVendingMachine;
        nucypherVendingMachine = _nucypherVendingMachine;
    }

    /// @notice Penalizes operator `operator`; the penalty details are encoded in `penaltyData`
    function slash(address operator, bytes calldata penaltyData) external {
        // TODO check suspended flag
        // TODO check slashing event (from app)
        // TODO choose stake (and check allocation)
        // TODO prepare caldata
        // TODO send slashing call
    }

    /// @notice Enable application for the specified staking providers and reset app parmaters
    function setupApplication(
        address app,
        StakingProvider[] calldata stakingProviders
    ) external onlyOwner {
        ApplicationInfo storage info = appInfo[app];
        for (uint256 i = 0; i < stakingProviders.length; i++) {
            StakingProvider stakingProvider = stakingProviders[i];
            require(
                !info.availability[stakingProvider],
                "Availability was already set"
            );
            info.availability[stakingProvider] = true;
        }

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

        info.deallocationDuration = IApplication(app).deallocationDuration();
        // slither-disable-next-line reentrancy-no-eth
        info.minAllocationSize = IApplication(app).minAllocationSize();
    }

    /// @notice Suspend/coninue allocation for the specified app
    function suspendApplication(address app) external onlyOwner {
        ApplicationInfo storage info = appInfo[app];
        info.suspended = !info.suspended;
    }

    /// @notice Deposit and stake T tokens
    /// @dev Applicable only for the first deposit
    function stake(
        uint256 value,
        address operator,
        address authorizer,
        address beneficiary
    ) external {
        require(operator != address(0), "Operator must be specified");
        require(
            operators[operator].owner == address(0),
            "Applicable only for the first deposit"
        );
        _stake(value, operator, authorizer, beneficiary);
    }

    /// @notice Deposit and stake T tokens
    function topUp(uint256 value, address operator)
        external
        onlyOperatorsOwner(operator)
    {
        _stake(value, operator, address(0), address(0));
    }

    /// @notice Set or change authorizer role
    function setAuthorizer(address operator, address authorizer)
        external
        onlyOperatorsOwner(operator)
    {
        operators[operator].authorizer = authorizer != address(0)
            ? authorizer
            : msg.sender;
    }

    /// @notice Set or change beneficiary role
    function setBeneficiary(address operator, address beneficiary)
        external
        onlyOperatorsOwner(operator)
    {
        operators[operator].beneficiary = beneficiary != address(0)
            ? beneficiary
            : msg.sender;
    }

    /// @notice Withdraw tokens after unstaking period is finished
    function withdraw(address operator, uint256 value) external {
        OperatorInfo storage operatorInfo = operators[operator];
        require(
            operatorInfo.owner == msg.sender,
            "Only owner can withdraw tokens"
        );
        require(
            value > 0 &&
                getAvailableToWithdraw(operator, StakingProvider.T) >= value,
            "Not enough tokens to withdraw"
        );
        operatorInfo.tStake -= value;
        token.safeTransfer(msg.sender, value);
    }

    /// @notice Allocate part of stake for the specified application
    function allocate(
        address operator,
        address app,
        uint256 amount,
        StakingProvider stakingProvider
    ) external {
        ApplicationInfo storage application = appInfo[app];
        require(
            application.availability[stakingProvider] && !application.suspended,
            "Application is unavailable for specified provider or suspended"
        );

        OperatorInfo storage operatorInfo = operators[operator];
        require(
            operatorInfo.authorizer == msg.sender,
            "Not operator authorizer"
        );

        AppAllocation storage appAllocation = operatorInfo.allocations[
            stakingProvider
        ][app];
        require(
            /* solhint-disable-next-line not-rely-on-time */
            appAllocation.endDeallocation <= block.timestamp,
            "Dealocation in progress"
        );

        require(
            appAllocation.allocated + amount >= application.minAllocationSize,
            "Allocation is too small"
        );

        uint256 availableTValue = getAvailableToAllocate(
            operator,
            app,
            stakingProvider
        );
        require(availableTValue >= amount, "Not enough stake to allocate");
        appAllocation.allocated += amount;
        application.allocatedOverall += amount;
        sendAllocationUpdate(operator, app);
    }

    /// @notice Start deallocation process
    function deallocate(address operator)
        external
        returns (uint256 deallocating)
    {
        deallocating = 0;
        for (uint256 i = 0; i < apps.length; i++) {
            address app = apps[i];
            deallocating += _deallocate(operator, app);
        }

        require(deallocating > 0, "Nothing was allocated");
    }

    /// @notice Cancel all allocations of stake for the specified application
    function deallocate(address operator, address app)
        external
        returns (uint256 deallocating)
    {
        deallocating = _deallocate(operator, app);

        require(deallocating > 0, "Nothing was allocated");
    }

    /// @notice Cancel allocation of stake for the specified application
    function deallocate(
        address operator,
        address app,
        StakingProvider stakingProvider
    ) external applicationSuspensionCheck(app) returns (uint256 deallocating) {
        deallocating = _deallocate(operator, app, stakingProvider);

        require(deallocating > 0, "Nothing was allocated");

        sendAllocationUpdate(operator, app);
    }

    /// @notice Cancel allocation of stake for the specified application
    function deallocate(
        address operator,
        address app,
        uint256 amount,
        StakingProvider stakingProvider
    ) external applicationSuspensionCheck(app) {
        require(amount > 0, "Value to deallocation must be greater than 0");

        _deallocate(operator, app, amount, stakingProvider);
        sendAllocationUpdate(operator, app);
    }

    /// @notice Returns available amount to allocate to the specified application
    function getAvailableToAllocate(address operator, address app)
        external
        view
        returns (uint256 tValue)
    {
        tValue += getAvailableToAllocate(operator, app, StakingProvider.KEEP);
        tValue += getAvailableToAllocate(operator, app, StakingProvider.NU);
        tValue += getAvailableToAllocate(operator, app, StakingProvider.T);
    }

    /// @notice Returns allocated amount to the specified application per operator
    function getAllocated(address[] memory operatorsSet, address app)
        external
        view
        returns (uint256[] memory allocated)
    {
        allocated = new uint256[](operatorsSet.length);
        for (uint256 i = 0; i < operatorsSet.length; i++) {
            address operator = operatorsSet[i];
            (allocated[i], ) = getAllocated(operator, app);
        }
    }

    /// @notice Returns available amount of stake to withdraw (not applicable for Keep)
    /// @dev Resulting value is in original token denomination
    function getAvailableToWithdraw(
        address operator,
        StakingProvider stakingProvider
    ) public view returns (uint256 value) {
        uint256 tStake = getStakeAmount(operator, stakingProvider);

        uint256 tValue = tStake;
        for (uint256 i = 0; i < apps.length; i++) {
            address app = apps[i];
            tValue = Math.min(
                tValue,
                getAvailableToWithdraw(operator, app, stakingProvider, tStake)
            );
        }
        if (stakingProvider == StakingProvider.T) {
            value = tValue;
        } else if (stakingProvider == StakingProvider.NU) {
            (value, ) = nucypherVendingMachine.conversionFromT(tValue);
        } else {
            (value, ) = keepVendingMachine.conversionFromT(tValue);
        }
    }

    /// @notice Returns available amount from staking provider to allocate to the specified application
    function getAvailableToAllocate(
        address operator,
        address app,
        StakingProvider stakingProvider
    ) public view returns (uint256 availableTValue) {
        if (!appInfo[app].availability[stakingProvider]) {
            return 0;
        }

        AppAllocation storage appAllocation = operators[operator].allocations[
            stakingProvider
        ][app];
        /* solhint-disable-next-line not-rely-on-time */
        if (appAllocation.endDeallocation > block.timestamp) {
            return 0;
        }

        uint256 tValue = getStakeAmount(operator, stakingProvider);
        availableTValue = appAllocation.allocated <= tValue
            ? tValue - appAllocation.allocated
            : 0;
    }

    /// @notice Returns staked amount from the staking provider
    function getStakeAmount(address operator, StakingProvider stakingProvider)
        public
        view
        returns (
            // TODO internal?
            uint256 tValue
        )
    {
        uint256 stakeAmount;
        if (stakingProvider == StakingProvider.KEEP) {
            uint256 undelegatedAt;
            (stakeAmount, , undelegatedAt) = keepStakingContract
                .getDelegationInfo(operator);
            if (undelegatedAt == 0) {
                (tValue, ) = keepVendingMachine.conversionToT(stakeAmount);
            }
        } else if (stakingProvider == StakingProvider.NU) {
            stakeAmount = nucypherStakingContract.getAllTokens(operator);
            (tValue, ) = nucypherVendingMachine.conversionToT(stakeAmount);
        } else {
            tValue = operators[operator].tStake;
        }
    }

    /// @notice Returns allocated amount to the specified application from staking provider
    function getAllocated(
        address operator,
        address app,
        StakingProvider stakingProvider
    ) public view returns (uint256 allocated, uint256 deallocating) {
        AppAllocation storage allocation = operators[operator].allocations[
            stakingProvider
        ][app];
        allocated = allocation.allocated;
        /* solhint-disable-next-line not-rely-on-time */
        deallocating = allocation.endDeallocation > block.timestamp
            ? allocation.deallocating
            : 0;
    }

    /// @notice Returns allocated amount to the specified application
    function getAllocated(address operator, address app)
        public
        view
        returns (uint256 allocated, uint256 deallocating)
    {
        (allocated, deallocating) = getAllocated(
            operator,
            app,
            StakingProvider.T
        );
        (uint256 allocatedInKeep, uint256 deallocatingInKeep) = getAllocated(
            operator,
            app,
            StakingProvider.KEEP
        );
        allocated += allocatedInKeep;
        deallocating += deallocatingInKeep;
        (uint256 allocatedInNU, uint256 deallocatingInNU) = getAllocated(
            operator,
            app,
            StakingProvider.NU
        );
        allocated += allocatedInNU;
        deallocating += deallocatingInNU;
    }

    /// @notice Deposit and stake T tokens
    function _stake(
        uint256 value,
        address operator,
        address authorizer,
        address beneficiary
    ) internal {
        require(value > 0, "Value to stake must be greater than 0");
        OperatorInfo storage operatorInfo = operators[operator];
        // first deposit
        if (operatorInfo.owner == address(0)) {
            operatorInfo.owner = msg.sender;
            operatorInfo.authorizer = authorizer != address(0)
                ? authorizer
                : msg.sender;
            operatorInfo.beneficiary = beneficiary != address(0)
                ? beneficiary
                : msg.sender;
        }
        operatorInfo.tStake += value;
        token.safeTransferFrom(msg.sender, address(this), value);
    }

    /// @notice Send changes in allocation to the specified application
    function sendAllocationUpdate(address operator, address app) internal {
        (uint256 allocated, uint256 deallocating) = getAllocated(operator, app);
        IApplication(app).receiveAllocation(
            operator,
            allocated,
            deallocating,
            appInfo[app].allocatedOverall
        );
    }

    /// @notice Cancel all allocations of stake for the specified application
    function _deallocate(address operator, address app)
        internal
        applicationSuspensionCheck(app)
        returns (uint256 deallocating)
    {
        deallocating = _deallocate(operator, app, StakingProvider.KEEP);
        deallocating += _deallocate(operator, app, StakingProvider.NU);
        deallocating += _deallocate(operator, app, StakingProvider.T);

        if (deallocating > 0) {
            sendAllocationUpdate(operator, app);
        }
    }

    /// @notice Cancel allocation of stake for the specified application
    function _deallocate(
        address operator,
        address app,
        StakingProvider stakingProvider
    ) internal returns (uint256) {
        uint256 allocated = operators[operator]
        .allocations[stakingProvider][app].allocated;
        _deallocate(operator, app, allocated, stakingProvider);
        return allocated;
    }

    /// @notice Cancel allocation of stake for the specified application
    function _deallocate(
        address operator,
        address app,
        uint256 amount,
        StakingProvider stakingProvider
    ) internal {
        if (amount == 0) {
            return;
        }
        OperatorInfo storage operatorInfo = operators[operator];
        require(
            operator == msg.sender || operatorInfo.owner == msg.sender,
            "Not authorized"
        );

        AppAllocation storage appAllocation = operatorInfo.allocations[
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

        appAllocation.deallocating = amount;
        appAllocation.endDeallocation =
            /* solhint-disable-next-line not-rely-on-time */
            block.timestamp +
            info.deallocationDuration;
        info.allocatedOverall -= amount;
    }

    /// @notice Returns available amount of T stake to withdraw
    function getAvailableToWithdraw(
        address operator,
        address app,
        StakingProvider stakingProvider,
        uint256 tStake
    ) internal view returns (uint256 availableTValue) {
        AppAllocation storage appAllocation = operators[operator].allocations[
            stakingProvider
        ][app];
        uint256 unavailable = appAllocation.allocated;
        /* solhint-disable-next-line not-rely-on-time */
        unavailable += appAllocation.endDeallocation > block.timestamp
            ? appAllocation.deallocating
            : 0;
        availableTValue = unavailable <= tStake ? tStake - unavailable : 0;
    }
}

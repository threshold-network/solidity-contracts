// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.8.4;


import './IStakingProvider.sol';
import "../token/T.sol";
import "../vending/VendingMachine.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";


/// @notice Meta staking contract. 3 roles: app, meta staking, app manager
contract TokenStaking {
    using SafeERC20 for T;

    // TODO events

    enum StakeStatus{ ELIGIBLE, ACTIVE, INACTIVE }

    enum StakingProvider { NU, KEEP, T }

    struct TStakeInfo {
        uint256 value;
        uint256 startUnstakingTimestamp;
    }

    struct AllocationInfo {
        uint256 allocatedOverall;
        mapping (address => uint256) allocatedPerApp;
    }

    T public immutable token;
    IStakingProvider public immutable keepStakingContract;
    IStakingProvider public immutable nucypherStakingContract;
    VendingMachine public immutable keepVendingMachine;
    VendingMachine public immutable nucypherVendingMachine;
    
    uint256 public immutable minStakeSize;
    uint256 public immutable minUnstakingDuration;
    
    mapping (address => TStakeInfo) public stakers;
    
    mapping (address => mapping (StakingProvider => AllocationInfo)) allocationsPerStaker;
    mapping (address => mapping (StakingProvider => bool)) public appAvailability;

    
    /// @param _token Address of T token contract
    /// @param _keepStakingContract Address of Keep staking contract
    /// @param _nucypherStakingContract Address of NuCypher staking contract
    /// @param _keepVendingMachine Address of Keep vending machine
    /// @param _nucypherVendingMachine Address of NuCypher vending machine
    /// @param _minStakeSize Min amount of T tokens to be eligible for staking
    /// @param _minUnstakingDuration Min unstaking duration (in sec) to be eligible for staking
    constructor(
        T _token,
        IStakingProvider _keepStakingContract, 
        IStakingProvider _nucypherStakingContract,
        VendingMachine _keepVendingMachine,
        VendingMachine _nucypherVendingMachine,
        uint256 _minStakeSize,
        uint256 _minUnstakingDuration
    ) {
        // TODO check contracts and input variables
        token = _token;
        keepStakingContract = _keepStakingContract;
        nucypherStakingContract = _nucypherStakingContract;
        keepVendingMachine = _keepVendingMachine;
        nucypherVendingMachine = _nucypherVendingMachine;
        minStakeSize = _minStakeSize;
        minUnstakingDuration = _minUnstakingDuration;
    }

    /// @notice Penalizes staker `staker`; the penalty details are encoded in `penaltyData`
    function slashStaker(address staker, bytes calldata penaltyData) external {
        // TODO check slashing event (from app)
        // TODO choose stake (and check allocation)
        // TODO prepare caldata
        // TODO send slashing call
    }

    /// @notice Returns stake status for NU or Keep stake
    function getStakeStatus(uint256 stake, uint256 unstakingDuration) internal view returns(StakeStatus) {
        if (stake < minStakeSize || unstakingDuration == 0) {
            return StakeStatus.INACTIVE;
        } 
        if (unstakingDuration < minUnstakingDuration) {
            return StakeStatus.ACTIVE;
        }
        return StakeStatus.ELIGIBLE;
    }

    /// @notice Returns stake info for NU, Keep or T staker
    function getStakeInfo(address staker, StakingProvider _stakingProvider) 
        public view returns(StakeStatus status, uint256 tValue) {

        uint256 stakeAmount;
        uint256 unstakingDuration;
        if (_stakingProvider == StakingProvider.KEEP) {
            (stakeAmount, unstakingDuration) = keepStakingContract.getStakeInfo(staker); 
            tValue = keepVendingMachine.conversionToT(stakeAmount);
        } else if (_stakingProvider == StakingProvider.NU) {
            (stakeAmount, unstakingDuration) = nucypherStakingContract.getStakeInfo(staker); 
            tValue = nucypherVendingMachine.conversionToT(stakeAmount);
        } else {
            (tValue, unstakingDuration) = getTStakeInfo(staker);
        }
        status = getStakeStatus(tValue, unstakingDuration);
    }

    /// @notice Returns the T staked amount and undelegation duration for `staker`
    function getTStakeInfo(address staker) public view returns(uint256 tValue, uint256 unstakingDuration) {
        TStakeInfo storage tStake = stakers[staker];
        tValue = tStake.value;
        if (tStake.startUnstakingTimestamp == 0) {
            unstakingDuration = minUnstakingDuration;
        } else if (block.timestamp >= tStake.startUnstakingTimestamp) {
            unstakingDuration = block.timestamp - tStake.startUnstakingTimestamp;
        } else {
            unstakingDuration = 0;
        }
    }

    /// @notice Depost and stake T tokens
    function deposit(uint256 value) public {
        require(value > 0);
        TStakeInfo storage tStake = stakers[msg.sender];
        require(tStake.startUnstakingTimestamp == 0);
        tStake.value += value;
        token.safeTransferFrom(msg.sender, address(this), value);
    }

    /// @notice Start unstaking process
    function startUnstaking() external {
        TStakeInfo storage tStake = stakers[msg.sender];
        require(tStake.value > 0 && tStake.startUnstakingTimestamp == 0);
        tStake.startUnstakingTimestamp = block.timestamp;  
    }

    /// @notice Withdraw tokens after unstaking period is finished
    function withdraw() external {
        TStakeInfo storage tStake = stakers[msg.sender];
        require(tStake.value > 0 && tStake.startUnstakingTimestamp + minUnstakingDuration >= block.timestamp);
        token.safeTransfer(msg.sender, tStake.value);
        tStake.value = 0;
        tStake.startUnstakingTimestamp = 0;
    }

    /// @notice Stake information for one provider including available amount to allocate 
    function getFullStakeInfo(address staker, StakingProvider stakingProvider) 
        public view returns (StakeStatus status, uint256 tValue, uint256 freeTValue) {
        (status, tValue) = getStakeInfo(staker, stakingProvider);
        AllocationInfo storage allocation = allocationsPerStaker[staker][stakingProvider];
        freeTValue = allocation.allocatedOverall <= tValue ? allocation.allocatedOverall - tValue : 0;
    }

    /// @notice Returns available amount from staking provider to allocate to the specified application
    function getAvailableAmount(address staker, address app, StakingProvider stakingProvider) public view returns (uint256 tValue) {
        if (!appAvailability[app][stakingProvider]) {
            return 0;
        }
        (StakeStatus status,, uint256 freeTValue) = getFullStakeInfo(staker, stakingProvider);
        return status == StakeStatus.ELIGIBLE ? 
                freeTValue : 0;
    }

    /// @notice Returns available amount to allocate to the specified application
    function getAvailableAmount(address staker, address app) public view returns (uint256 tValue) {
        tValue += getAvailableAmount(staker, app, StakingProvider.KEEP);
        tValue += getAvailableAmount(staker, app, StakingProvider.NU);
        tValue += getAvailableAmount(staker, app, StakingProvider.T);
    }
}

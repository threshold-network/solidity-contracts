// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./GrantStakingPolicy.sol";
import "../token/T.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Token Grant
/// @notice Token Grant releases its token balance gradually to the grantee
///         based on the vesting schedule with a cliff and vesting period.
///         Can be revoked by grant creator. Allows to stake granted tokens
///         according to the provided staking policy.
contract TokenGrant {
    // TODO Not implemented yet:
    // TODO   - TokenGrantFactory, master clone factory TokenGrant contract
    // TODO     initialization prevention.
    // TODO   - Staking, including checking the policy, allowed staking
    // TODO     contracts, and calling the staking contract.
    // TODO   - Grant revoke functionality.
    // TODO   - VendingMachine integration and functions allowing to convert
    // TODO     granted KEEP/NU into T and back

    using SafeERC20 for T;

    T public token;

    address public grantee;
    bool public revocable;
    uint256 public amount;
    uint256 public duration;
    uint256 public start;
    uint256 public cliff;

    uint256 public withdrawn;
    uint256 public staked;

    IGrantStakingPolicy public stakingPolicy;

    event Withdrawn(uint256 amount);

    modifier onlyGrantee() {
        require(msg.sender == grantee, "Not authorized");
        _;
    }

    function initialize(
        T _token,
        address _grantee,
        bool _revocable,
        uint256 _amount,
        uint256 _duration,
        uint256 _start,
        uint256 _cliff,
        IGrantStakingPolicy _stakingPolicy
    ) external {
        require(address(_token) != address(0), "Token must not be 0x0");
        require(_grantee != address(0), "Grantee must not be 0x0");
        require(_amount != 0, "Amount must not be 0");
        require(_duration != 0, "Duration must not be 0");
        require(_start != 0, "Start timestamp must not be 0");
        require(_cliff != 0, "Cliff timestamp must not be 0");
        // TODO: validate staking policy is not 0x0

        token = _token;
        grantee = _grantee;
        revocable = _revocable;
        amount = _amount;
        duration = _duration;
        start = _start;
        cliff = _cliff;
        stakingPolicy = _stakingPolicy;

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function stake(uint256 amountToStake) external onlyGrantee {
        staked += amountToStake;

        // TODO: implement
    }

    /// @notice Witthdraws all the amount that is currently withdrawable. Can
    ///         be called only by the grantee.
    function withdraw() external onlyGrantee {
        uint256 withdrawable = withdrawableAmount();
        require(withdrawable > 0, "There is nothing to withdraw");

        emit Withdrawn(withdrawable);
        withdrawn += withdrawable;
        token.safeTransfer(grantee, withdrawable);
    }

    /// @notice Calculates the amount unlocked so far. Includes the amount
    ///         staked and withdrawn. Returns 0 if the vesting schedule has not
    ///         started yet or if the cliff has not yet ended.
    function unlockedAmount() public view returns (uint256) {
        /* solhint-disable-next-line not-rely-on-time */
        if (block.timestamp < start) {
            return 0;
        }

        /* solhint-disable-next-line not-rely-on-time */
        if (block.timestamp < cliff) {
            return 0;
        }

        /* solhint-disable-next-line not-rely-on-time */
        uint256 timeElapsed = block.timestamp - start;

        bool unlockingPeriodFinished = timeElapsed >= duration;
        if (unlockingPeriodFinished) {
            return amount;
        }

        return (amount * timeElapsed) / duration;
    }

    /// @notice Calculates the currently withdrawable amount. The amount
    ///         withdrawable is the amount vested minus the amount staked and
    ///         minus the amount already withdrawn.
    function withdrawableAmount() public view returns (uint256) {
        uint256 unlocked = unlockedAmount();

        if (withdrawn + staked >= unlocked) {
            return 0;
        } else {
            return unlocked - withdrawn - staked;
        }
    }
}

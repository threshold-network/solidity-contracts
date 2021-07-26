// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./GrantStakingPolicy.sol";
import "../token/T.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenGrant {
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
    ) public {
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

    function withdraw() external onlyGrantee {
        uint256 withdrawable = withdrawableAmount();
        require(withdrawable > 0, "There is nothing to withdraw");

        emit Withdrawn(withdrawable);
        withdrawn += withdrawable;
        token.safeTransfer(grantee, withdrawable);
    }

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

    function withdrawableAmount() public view returns (uint256) {
        uint256 unlocked = unlockedAmount();

        if (withdrawn + staked >= unlocked) {
            return 0;
        } else {
            return unlocked - withdrawn - staked;
        }
    }
}

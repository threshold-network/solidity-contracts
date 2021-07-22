// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./GrantStakingPolicy.sol";

contract TokenGrant {

    address public grantee;
    bool public revocable;
    uint256 public amount;
    uint256 public duration;
    uint256 public start;
    uint256 public cliff;
    
    uint256 public withdrawn;
    uint256 public staked;

    uint256 public revokedAt;
    uint256 public revokedAmount;
    uint256 public revokedWithdrawn;

    IGrantStakingPolicy public stakingPolicy;

    function initialize(
        address _grantee,
        bool _revocable,
        uint256 _amount,
        uint256 _duration,
        uint256 _start,
        uint256 _cliff,
        IGrantStakingPolicy _stakingPolicy
    ) public {
        grantee = _grantee;
        revocable = _revocable;
        amount = _amount;
        duration = _duration;
        start = _start;
        cliff = _cliff;
        stakingPolicy = _stakingPolicy;
    }

    function unlockedAmount() public view returns (uint256) {
        if (block.timestamp < start) { // start reached?
            return 0;
        }

        if (block.timestamp < cliff) { // cliff reached?
            return 0; 
        }

        uint256 timeElapsed = block.timestamp - start;

        bool unlockingPeriodFinished = timeElapsed >= duration;
        if (unlockingPeriodFinished) { return amount; }

        return amount * timeElapsed / duration;
    }
}
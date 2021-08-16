// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

interface IGrantStakingPolicy {
    function getStakeableAmount(
        uint256 _now,
        uint256 grantedAmount,
        uint256 duration,
        uint256 start,
        uint256 cliff,
        uint256 withdrawn
    ) external view returns (uint256);
}

// TODO: add more policies

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IVotesHistory {
    function getPastVotes(address account, uint256 blockNumber)
        external
        view
        returns (uint256);

    function getPastTotalSupply(uint256 blockNumber)
        external
        view
        returns (uint256);
}

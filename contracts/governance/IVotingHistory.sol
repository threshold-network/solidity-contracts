// SPDX-License-Identifier: GPL-3.0-or-later

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

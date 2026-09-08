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

pragma solidity 0.8.9;

import "./GovernorParameters.sol";
import "./IVotesHistory.sol";

/// @title TokenholderGovernorVotes
/// @notice Tokenholder DAO voting power extraction from both liquid and staked
///         T token positions.
abstract contract TokenholderGovernorVotes is GovernorParameters {
    IVotesHistory public immutable token;
    IVotesHistory public immutable staking;

    constructor(IVotesHistory tokenAddress, IVotesHistory tStakingAddress) {
        token = tokenAddress;
        staking = tStakingAddress;
    }

    /// @notice Read the voting weight from the snapshot mechanism in the token
    ///         and staking contracts. For Tokenholder DAO, there are currently
    ///         two voting power sources:
    ///          - Liquid T, tracked by the T token contract
    ///          - Stakes in the T network, tracked  by the T staking contract.
    /// @param account Tokenholder account in the T network
    /// @param blockNumber The block number to get the vote balance at
    /// @dev See {IGovernor-getVotes}
    function getVotes(address account, uint256 blockNumber)
        public
        view
        virtual
        override
        returns (uint256)
    {
        uint256 liquidVotes = token.getPastVotes(account, blockNumber);
        uint256 stakedVotes = staking.getPastVotes(account, blockNumber);
        return liquidVotes + stakedVotes;
    }

    /// @notice Compute the total voting power for Tokenholder DAO. Note how it
    ///         only uses the token total supply as source, as native T tokens
    ///         that are staked continue existing, but as deposits in the
    ///         staking contract.
    /// @param blockNumber The block number to get the vote power at
    function _getPastTotalSupply(uint256 blockNumber)
        internal
        view
        virtual
        override
        returns (uint256)
    {
        return token.getPastTotalSupply(blockNumber);
    }
}

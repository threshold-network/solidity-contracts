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

/// @title StakerGovernorVotes
/// @notice Staker DAO voting power extraction from staked T positions,
//          including legacy stakes (NU/KEEP).
abstract contract StakerGovernorVotes is GovernorParameters {
    IVotesHistory public immutable staking;

    constructor(IVotesHistory tStakingAddress) {
        staking = tStakingAddress;
    }

    /// @notice Read the voting weight from the snapshot mechanism in the T
    ///         staking contracts. Note that this also tracks legacy stakes
    ///         (NU/KEEP).
    /// @param account Delegate account with T staking voting power
    /// @param blockNumber The block number to get the vote balance at
    /// @dev See {IGovernor-getVotes}
    function getVotes(address account, uint256 blockNumber)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return staking.getPastVotes(account, blockNumber);
    }

    /// @notice Compute the total voting power for the Staker DAO.
    /// @param blockNumber The block number to get the voting power at
    function _getPastTotalSupply(uint256 blockNumber)
        internal
        view
        virtual
        override
        returns (uint256)
    {
        return staking.getPastTotalSupply(blockNumber);
    }
}

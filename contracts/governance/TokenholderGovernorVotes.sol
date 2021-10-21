// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./IVotingHistory.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";

/**
 * @dev Extension of {GovernorVotesQuorumFraction} for voting weight extraction from both liquid and staked T token positions.
 *      See OpenZeppelin's GovernorVotes and GovernorVotesQuorumFraction for reference.
 */
abstract contract TokenholderGovernorVotes is GovernorVotesQuorumFraction {
    IVotesHistory public immutable staking;

    constructor(IVotesHistory tStakingAddress) {
        staking = tStakingAddress;
    }

    /**
     * Read the voting weight from the token's built in snapshot mechanism (see {IGovernor-getVotes}).
     */
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
        // FIXME: Account for vending machines' balance of T
    }

    function _getPastTotalSupply(uint256 blockNumber)
        internal
        view
        returns (uint256)
    {
        return
            token.getPastTotalSupply(blockNumber) +
            staking.getPastTotalSupply(blockNumber);
        // FIXME: Account for vending machines' balance of T
    }

    /// @notice Compute the required amount of voting power to reach quorum
    /// @param blockNumber The block number to get the quorum at
    function quorum(uint256 blockNumber)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return
            (_getPastTotalSupply(blockNumber) * quorumNumerator()) /
            quorumDenominator();
    }

    function fractionDenominator() public view virtual returns (uint256) {
        return 10000;
    }

    function quorumDenominator() public view virtual override returns (uint256) {
        return fractionDenominator();
    }
}

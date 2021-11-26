// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";

/// @title GovernorParameters
/// @notice Abstract contract to handle governance parameters
/// @dev Based on `GovernorVotesQuorumFraction`, but without being opinionated
///      on what's the source of voting power, and extended to handle proposal
///      thresholds too. See OpenZeppelin's GovernorVotesQuorumFraction and
///      GovernorVotes for reference.
abstract contract GovernorParameters is Governor {
    uint256 public constant FRACTION_DENOMINATOR = 10000;
    uint256 private constant AVERAGE_BLOCK_TIME_IN_SECONDS = 13;

    uint256 public quorumNumerator;
    uint256 public proposalThresholdNumerator;

    event QuorumNumeratorUpdated(
        uint256 oldQuorumNumerator,
        uint256 newQuorumNumerator
    );

    event ProposalThresholdNumeratorUpdated(
        uint256 oldThresholdNumerator,
        uint256 newThresholdNumerator
    );

    constructor(uint256 quorumNumeratorValue, uint256 proposalNumeratorValue) {
        _updateQuorumNumerator(quorumNumeratorValue);
        _updateProposalThresholdNumerator(proposalNumeratorValue);
    }

    function updateQuorumNumerator(uint256 newQuorumNumerator)
        external
        virtual
        onlyGovernance
    {
        _updateQuorumNumerator(newQuorumNumerator);
    }

    function updateProposalThresholdNumerator(uint256 newNumerator)
        external
        virtual
        onlyGovernance
    {
        _updateProposalThresholdNumerator(newNumerator);
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
            (_getPastTotalSupply(blockNumber) * quorumNumerator) /
            FRACTION_DENOMINATOR;
    }

    /// @notice Compute the required amount of voting power to create a proposal
    /// @dev
    function proposalThreshold()
        public
        view
        virtual
        override
        returns (uint256)
    {
        return
            (_getPastTotalSupply(block.number - 1) *
                proposalThresholdNumerator) / FRACTION_DENOMINATOR;
    }

    function votingDelay() public pure override returns (uint256) {
        return (2 days) / AVERAGE_BLOCK_TIME_IN_SECONDS;
    }

    function votingPeriod() public pure override returns (uint256) {
        return (10 days) / AVERAGE_BLOCK_TIME_IN_SECONDS;
    }

    function _updateQuorumNumerator(uint256 newQuorumNumerator)
        internal
        virtual
    {
        require(
            newQuorumNumerator <= FRACTION_DENOMINATOR,
            "quorumNumerator > Denominator"
        );

        uint256 oldQuorumNumerator = quorumNumerator;
        quorumNumerator = newQuorumNumerator;

        emit QuorumNumeratorUpdated(oldQuorumNumerator, newQuorumNumerator);
    }

    function _updateProposalThresholdNumerator(uint256 proposalNumerator)
        internal
        virtual
    {
        require(
            proposalNumerator <= FRACTION_DENOMINATOR,
            "proposalNumerator > Denominator"
        );

        uint256 oldNumerator = proposalThresholdNumerator;
        proposalThresholdNumerator = proposalNumerator;

        emit ProposalThresholdNumeratorUpdated(oldNumerator, proposalNumerator);
    }

    /// @notice Compute the past total voting power at a particular block
    /// @param blockNumber The block number to get the vote power at
    function _getPastTotalSupply(uint256 blockNumber)
        internal
        view
        virtual
        returns (uint256);
}

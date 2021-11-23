// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";

/// @title AbstractGovernorQuorumFraction
/// @notice Abstract contract to handle fraction quorums
/// @dev Based on `GovernorVotesQuorumFraction`, but without being opinionated
///      on what's the source of voting power. See OpenZeppelin's GovernorVotes
///      and GovernorVotesQuorumFraction for reference.
abstract contract AbstractGovernorQuorumFraction is Governor {
    uint256 public constant FRACTION_DENOMINATOR = 10000;
    uint256 private _quorumNumerator;

    event QuorumNumeratorUpdated(
        uint256 oldQuorumNumerator,
        uint256 newQuorumNumerator
    );

    constructor(uint256 quorumNumeratorValue) {
        _updateQuorumNumerator(quorumNumeratorValue);
    }

    function updateQuorumNumerator(uint256 newQuorumNumerator)
        external
        virtual
        onlyGovernance
    {
        _updateQuorumNumerator(newQuorumNumerator);
    }

    function quorumNumerator() public view virtual returns (uint256) {
        return _quorumNumerator;
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
            FRACTION_DENOMINATOR;
    }

    function _updateQuorumNumerator(uint256 newQuorumNumerator) internal {
        require(
            newQuorumNumerator <= FRACTION_DENOMINATOR,
            "quorumNumerator > denominator"
        );

        uint256 oldQuorumNumerator = _quorumNumerator;
        _quorumNumerator = newQuorumNumerator;

        emit QuorumNumeratorUpdated(oldQuorumNumerator, newQuorumNumerator);
    }

    /// @notice Compute the past total voting power at a particular block
    /// @param blockNumber The block number to get the vote power at
    function _getPastTotalSupply(uint256 blockNumber)
        internal
        view
        virtual
        returns (uint256);
}

// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../governance/StakerGovernorVotes.sol";

contract TestStakerGovernorVotes is StakerGovernorVotes {
    constructor(IVotesHistory _tStaking)
        Governor("TestStakerGovernor")
        AbstractGovernorQuorumFraction(125)
        StakerGovernorVotes(_tStaking)
    {}

    function getPastTotalSupply(uint256 blockNumber)
        public
        view
        returns (uint256)
    {
        return _getPastTotalSupply(blockNumber);
    }

    function hasVoted(uint256 proposalId, address account)
        public
        view
        virtual
        override
        returns (bool)
    {}

    function votingDelay() public view virtual override returns (uint256) {}

    function votingPeriod() public view virtual override returns (uint256) {}

    // solhint-disable-next-line func-name-mixedcase
    function COUNTING_MODE()
        public
        pure
        virtual
        override
        returns (string memory)
    {}

    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support,
        uint256 weight
    ) internal virtual override {}

    function _quorumReached(uint256 proposalId)
        internal
        view
        virtual
        override
        returns (bool)
    {}

    function _voteSucceeded(uint256 proposalId)
        internal
        view
        virtual
        override
        returns (bool)
    {}
}

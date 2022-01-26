// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../governance/GovernorParameters.sol";
import "../governance/StakerGovernor.sol";
import "../governance/TokenholderGovernor.sol";
import "../token/T.sol";

contract TestTokenholderGovernorStub {
    string public name = "TokenholderGovernor";
    address public timelock = address(0x42);
}

contract TestTokenholderGovernorStubV2 {
    string public name = "TokenholderGovernor";
    address public timelock;

    constructor(address _timelock) {
        timelock = _timelock;
    }
}

contract TestStakerGovernor is StakerGovernor {
    constructor(
        IVotesHistory tStaking,
        TokenholderGovernor tokenholderGov,
        address vetoer
    )
        StakerGovernor(
            tStaking,
            TimelockController(payable(0)),
            tokenholderGov,
            vetoer
        )
    {}

    function executor() external view returns (address) {
        return _executor();
    }
}

contract TestTokenholderGovernor is BaseTokenholderGovernor {
    uint256 private constant INITIAL_QUORUM_NUMERATOR = 150; // Defined in basis points, i.e., 1.5%
    uint256 private constant INITIAL_PROPOSAL_THRESHOLD_NUMERATOR = 25; // Defined in basis points, i.e., 0.25%
    uint256 private constant INITIAL_VOTING_DELAY = 2;
    uint256 private constant INITIAL_VOTING_PERIOD = 8;

    constructor(
        T _tToken,
        IVotesHistory _tStaking,
        TimelockController _timelock,
        address _vetoer
    )
        BaseTokenholderGovernor(
            _tToken,
            _tStaking,
            _timelock,
            _vetoer,
            INITIAL_QUORUM_NUMERATOR,
            INITIAL_PROPOSAL_THRESHOLD_NUMERATOR,
            INITIAL_VOTING_DELAY,
            INITIAL_VOTING_PERIOD
        )
    {}
}

contract TestGovernorParameters is GovernorParameters {
    address internal executor;

    constructor(address executorAddress)
        Governor("TestGovernorParameters")
        GovernorParameters(10, 20, 30, 40)
    {
        executor = executorAddress;
    }

    function getVotes(address account, uint256 blockNumber)
        public
        view
        virtual
        override
        returns (uint256)
    {}

    function getPastTotalSupply(uint256 blockNumber)
        public
        view
        returns (uint256)
    {}

    function hasVoted(uint256 proposalId, address account)
        public
        view
        virtual
        override
        returns (bool)
    {}

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

    function _getPastTotalSupply(uint256 blockNumber)
        internal
        view
        virtual
        override
        returns (uint256)
    {}

    function _executor() internal view virtual override returns (address) {
        return executor;
    }
}

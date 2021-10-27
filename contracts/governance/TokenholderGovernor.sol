// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./TokenholderGovernorVotes.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/compatibility/GovernorCompatibilityBravo.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

contract TokenholderGovernor is
    AccessControl,
    Governor,
    GovernorCompatibilityBravo,
    TokenholderGovernorVotes,
    GovernorTimelockControl
{
    uint256 private constant AVERAGE_BLOCK_TIME_IN_SECONDS = 13;
    uint256 private constant INITIAL_QUORUM_NUMERATOR = 150; // Defined in basis points, i.e., 1.5%
    uint256 private constant INITIAL_PROPOSAL_THRESHOLD_NUMERATOR = 25; // Defined in basis points, i.e., 0.25%

    bytes32 public constant VETO_POWER =
        keccak256("Power to veto proposals in Threshold's Tokenholder DAO");

    constructor(
        ERC20Votes _token,
        IVotesHistory _staking,
        TimelockController _timelock
    )
        Governor("TokenholderGovernor")
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(INITIAL_QUORUM_NUMERATOR)
        TokenholderGovernorVotes(_staking)
        GovernorTimelockControl(_timelock)
    {}

    function votingDelay() public pure override returns (uint256) {
        return (2 days) / AVERAGE_BLOCK_TIME_IN_SECONDS;
    }

    function votingPeriod() public pure override returns (uint256) {
        return (10 days) / AVERAGE_BLOCK_TIME_IN_SECONDS;
    }

    //TODO: functions to update threshold, events, common logic with quorum
    function proposalThreshold() public view override returns (uint256) {
        return
            (_getPastTotalSupply(block.number - 1) *
                INITIAL_PROPOSAL_THRESHOLD_NUMERATOR) / quorumDenominator();
    }

    // The functions below are overrides required by Solidity.

    function quorum(uint256 blockNumber)
        public
        view
        override(IGovernor, TokenholderGovernorVotes)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function getVotes(address account, uint256 blockNumber)
        public
        view
        override(IGovernor, TokenholderGovernorVotes)
        returns (uint256)
    {
        return super.getVotes(account, blockNumber);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, IGovernor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    )
        public
        override(Governor, GovernorCompatibilityBravo, IGovernor)
        returns (uint256)
    {
        require(
            getVotes(msg.sender, block.number - 1) >= proposalThreshold(),
            "Proposal below threshold"
        );
        return super.propose(targets, values, calldatas, description);
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    function cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public onlyRole(VETO_POWER) returns (uint256) {
        return _cancel(targets, values, calldatas, descriptionHash);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, IERC165, GovernorTimelockControl, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

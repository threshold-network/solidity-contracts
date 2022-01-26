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

import "./TokenholderGovernorVotes.sol";
import "../token/T.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

contract BaseTokenholderGovernor is
    AccessControl,
    GovernorCountingSimple,
    TokenholderGovernorVotes,
    GovernorTimelockControl
{
    bytes32 public constant VETO_POWER =
        keccak256("Power to veto proposals in Threshold's Tokenholder DAO");

    constructor(
        T _token,
        IVotesHistory _staking,
        TimelockController _timelock,
        address vetoer,
        uint256 quorumNumerator,
        uint256 proposalThresholdNumerator,
        uint256 votingDelay,
        uint256 votingPeriod
    )
        Governor("TokenholderGovernor")
        GovernorParameters(
            quorumNumerator,
            proposalThresholdNumerator,
            votingDelay,
            votingPeriod
        )
        TokenholderGovernorVotes(_token, _staking)
        GovernorTimelockControl(_timelock)
    {
        _setupRole(VETO_POWER, vetoer);
        _setupRole(DEFAULT_ADMIN_ROLE, address(_timelock));
    }

    function cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) external onlyRole(VETO_POWER) returns (uint256) {
        return _cancel(targets, values, calldatas, descriptionHash);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor, IGovernor) returns (uint256) {
        uint256 atLastBlock = block.number - 1;
        require(
            getVotes(msg.sender, atLastBlock) >= proposalThreshold(atLastBlock),
            "Proposal below threshold"
        );
        return super.propose(targets, values, calldatas, description);
    }

    function quorum(uint256 blockNumber)
        public
        view
        override(IGovernor, GovernorParameters)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorParameters)
        returns (uint256)
    {
        return super.proposalThreshold();
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
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
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
}

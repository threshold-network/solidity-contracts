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

import "./StakerGovernorVotes.sol";
import "./TokenholderGovernor.sol";
import "../token/T.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

contract StakerGovernor is
    AccessControl,
    GovernorCountingSimple,
    StakerGovernorVotes,
    GovernorTimelockControl
{
    uint256 private constant INITIAL_QUORUM_NUMERATOR = 150; // Defined in basis points, i.e., 1.5%
    uint256 private constant INITIAL_PROPOSAL_THRESHOLD_NUMERATOR = 25; // Defined in basis points, i.e., 0.25%
    uint256 private constant INITIAL_VOTING_DELAY =
        2 days / AVERAGE_BLOCK_TIME_IN_SECONDS;
    uint256 private constant INITIAL_VOTING_PERIOD =
        10 days / AVERAGE_BLOCK_TIME_IN_SECONDS;

    bytes32 public constant VETO_POWER =
        keccak256("Power to veto proposals in Threshold's Staker DAO");

    address internal immutable manager;

    constructor(
        IVotesHistory _staking,
        TimelockController _timelock,
        TokenholderGovernor tokenholderGovernor,
        address vetoer
    )
        Governor("StakerGovernor")
        GovernorParameters(
            INITIAL_QUORUM_NUMERATOR,
            INITIAL_PROPOSAL_THRESHOLD_NUMERATOR,
            INITIAL_VOTING_DELAY,
            INITIAL_VOTING_PERIOD
        )
        StakerGovernorVotes(_staking)
        GovernorTimelockControl(_timelock)
    {
        require(
            keccak256(bytes(tokenholderGovernor.name())) ==
                keccak256(bytes("TokenholderGovernor")),
            "Incorrect TokenholderGovernor"
        );
        manager = tokenholderGovernor.timelock();
        require(manager != address(0), "No timelock founds");
        _setupRole(VETO_POWER, vetoer);
        _setupRole(DEFAULT_ADMIN_ROLE, manager);
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
        override(IGovernor, StakerGovernorVotes)
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

    /// @notice Returns the address of the entity that acts as governance for
    ///         this contract.
    /// @dev By default, Governor assumes this is either the Governor contract
    ///      itself, or a timelock if there's one configured. We override this
    ///      here for the StakerGovernor contract so it's the Tokenholder DAO's
    ///      Timelock, which we obtain at constructor time.
    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return manager;
    }
}

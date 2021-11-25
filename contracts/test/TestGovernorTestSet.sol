// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../governance/StakerGovernor.sol";
import "../governance/TokenholderGovernor.sol";
import "../token/T.sol";

contract TestStakerGovernor is StakerGovernor {
    constructor(IVotesHistory _tStaking, address _vetoer)
        StakerGovernor(_tStaking, TimelockController(payable(0)), _vetoer)
    {}
}

contract TestTokenholderGovernor is TokenholderGovernor {
    constructor(
        T _tToken,
        IVotesHistory _tStaking,
        address _vetoer
    )
        TokenholderGovernor(
            _tToken,
            _tStaking,
            TimelockController(payable(0)),
            _vetoer
        )
    {}
}

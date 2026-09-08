// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../staking/SepoliaTokenStaking.sol";

// Native staking fixture exercising the base contract's TACo eligibility policy.
contract BaseAuthorizationStakingTest is SepoliaTokenStaking {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(T _token) SepoliaTokenStaking(_token) {}

    function skipApplication(address application)
        internal
        pure
        override
        returns (bool)
    {
        return application != TACO_APPLICATION;
    }
}

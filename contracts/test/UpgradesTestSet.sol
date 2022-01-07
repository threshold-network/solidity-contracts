// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

contract SimpleStorage {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    uint256 public immutable implementationVersion;
    uint256 public storedValue;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 _version) {
        implementationVersion = _version;
    }

    function initialize(uint256 _value) external {
        storedValue = _value;
    }

    function setValue(uint256 _value) external {
        storedValue = _value;
    }
}

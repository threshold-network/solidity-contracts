// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

contract SimpleStorage {

    uint public value;

    constructor() {}

    function initialize(uint _value) external {
        value = _value;
    }
}
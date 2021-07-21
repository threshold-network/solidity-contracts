// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@thesis/solidity-contracts/contracts/token/ERC20WithPermit.sol";

contract TestToken is ERC20WithPermit {
    constructor() ERC20WithPermit("Test Token", "TEST") {}
}

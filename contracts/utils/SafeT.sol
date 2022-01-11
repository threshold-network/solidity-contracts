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

import "../token/T.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/// @notice A wrapper around OpenZeppelin's `SafeERC20Upgradeable` but for
///         the T token. Motivation is to prevent upgradeable contracts using T
///         from depending on the `Address` library, which can be problematic
///         since it uses `delegatecall`, which is discouraged by OpenZeppelin.
library SafeT {
    function safeTransfer(
        T token,
        address to,
        uint256 value
    ) internal {
        SafeERC20Upgradeable.safeTransfer(
            IERC20Upgradeable(address(token)),
            to,
            value
        );
    }

    function safeTransferFrom(
        T token,
        address from,
        address to,
        uint256 value
    ) internal {
        SafeERC20Upgradeable.safeTransferFrom(
            IERC20Upgradeable(address(token)),
            from,
            to,
            value
        );
    }
}

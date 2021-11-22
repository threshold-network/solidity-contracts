// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/// @title ProxyAdminWithDeputy
/// @notice Based on `ProxyAdmin`, an auxiliary contract in OpenZeppelin's
///         upgradeability approach meant to be assigned as the admin of a
///         `TransparentUpgradeableProxy`. This variant allows an additional
///         actor, the "deputy", to perform upgrades, which originally can only
///         be performed by the ProxyAdmin owner. See OpenZeppelin's
///         documentation for `TransparentUpgradeableProxy` for more details on
///         why a ProxyAdmin is recommended.
contract ProxyAdminWithDeputy is ProxyAdmin {
    address public deputy;

    function setDeputy(address _deputy) public onlyOwner {
        deputy = _deputy;
    }

    /// @notice Upgrades `proxy` to `implementation`. This contract must be the
    ///         admin of `proxy`, and the caller must be this contract's owner
    ///         or the deputy.
    function upgrade(TransparentUpgradeableProxy proxy, address implementation)
        public
        virtual
        override
    {
        _checkCallerIsAdminOrDeputy();
        proxy.upgradeTo(implementation);
    }

    /// @notice Upgrades `proxy` to `implementation` and calls a function on the
    ///         new implementation. This contract must be the  admin of `proxy`,
    ///         and the caller must be this contract's owner or the deputy.
    function upgradeAndCall(
        TransparentUpgradeableProxy proxy,
        address implementation,
        bytes memory data
    ) public payable virtual override {
        _checkCallerIsAdminOrDeputy();
        proxy.upgradeToAndCall{value: msg.value}(implementation, data);
    }

    function _checkCallerIsAdminOrDeputy() internal view {
        address caller = _msgSender();
        require(
            owner() == caller || deputy == caller,
            "Caller is neither the owner nor the deputy"
        );
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "./StakerGovernor.sol";
import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/// @title ProxyAdminWithDeputy
/// @notice Based on `ProxyAdmin`, an auxiliary contract in OpenZeppelin's
///         upgradeability approach meant to act as the admin of a
///         `TransparentUpgradeableProxy`. This variant allows an additional
///         actor, the "deputy", to perform upgrades, which originally can only
///         be performed by the ProxyAdmin's owner. See OpenZeppelin's
///         documentation for `TransparentUpgradeableProxy` for more details on
///         why a ProxyAdmin is recommended.
contract ProxyAdminWithDeputy is ProxyAdmin {
    address public deputy;
    event DeputyUpdated(
        address indexed previousDeputy,
        address indexed newDeputy
    );

    modifier onlyOwnerOrDeputy() {
        _checkCallerIsOwnerOrDeputy();
        _;
    }

    constructor(StakerGovernor dao, address _deputy) {
        address timelock = dao.timelock();
        require(timelock != address(0), "DAO doesn't have a Timelock");
        _setDeputy(_deputy);
        _transferOwnership(timelock);
    }

    function setDeputy(address newDeputy) external onlyOwner {
        _setDeputy(newDeputy);
    }

    /// @notice Upgrades `proxy` to `implementation`. This contract must be the
    ///         admin of `proxy`, and the caller must be this contract's owner
    ///         or the deputy.
    function upgrade(TransparentUpgradeableProxy proxy, address implementation)
        public
        virtual
        override
        onlyOwnerOrDeputy
    {
        proxy.upgradeTo(implementation);
    }

    /// @notice Upgrades `proxy` to `implementation` and calls a function on the
    ///         new implementation. This contract must be the admin of `proxy`,
    ///         and the caller must be this contract's owner or the deputy.
    function upgradeAndCall(
        TransparentUpgradeableProxy proxy,
        address implementation,
        bytes memory data
    ) public payable virtual override onlyOwnerOrDeputy {
        proxy.upgradeToAndCall{value: msg.value}(implementation, data);
    }

    function _setDeputy(address newDeputy) internal {
        address oldDeputy = deputy;
        deputy = newDeputy;
        emit DeputyUpdated(oldDeputy, newDeputy);
    }

    function _checkCallerIsOwnerOrDeputy() internal view {
        address caller = _msgSender();
        require(
            owner() == caller || deputy == caller,
            "Caller is neither the owner nor the deputy"
        );
    }
}

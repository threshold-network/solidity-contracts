// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

import "../utils/Checkpoints.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestStakingCheckpoints is Checkpoints {
    mapping(address => uint256) public stake;

    /// @notice T token contract.
    IERC20 public immutable tToken;

    constructor(IERC20 _tToken) {
        tToken = _tToken;
    }

    function deposit(uint256 amount) public {
        stake[msg.sender] += amount;
        _writeCheckpoint(_checkpoints[msg.sender], _add, amount);
        _writeCheckpoint(_totalSupplyCheckpoints, _add, amount);

        tToken.transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) public {
        require(stake[msg.sender] >= amount, "Not enough stake to withdraw");
        stake[msg.sender] -= amount;
        _writeCheckpoint(_checkpoints[msg.sender], _subtract, amount);
        _writeCheckpoint(_totalSupplyCheckpoints, _subtract, amount);

        tToken.transfer(msg.sender, amount);
    }
}

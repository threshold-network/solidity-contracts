// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@thesis/solidity-contracts/contracts/token/IReceiveApproval.sol";
import "../token/T.sol";

contract VendingMachine is Ownable, IReceiveApproval {
    using SafeERC20 for IERC20;
    using SafeERC20 for T;

    /// @notice Divisor for precision purposes, used to represent fractions.
    uint256 public constant FLOATING_POINT_DIVISOR = 1e18;

    IERC20 public immutable wrappedToken;
    T public immutable tToken;

    // when wrapping:
    // x [T] = * amount [source token] * ratio / FLOATING_POINT_DIVISOR
    //
    // when unwrapping:
    // x [source token] = amount [T] * FLOATING_POINT_DIVISOR / ratio
    uint256 public ratio;

    mapping(address => uint256) public wrappedBalance;

    event Wrapped(
        address indexed recipient,
        uint256 wrappedTokenAmount,
        uint256 tTokenAmount
    );
    event Unwrapped(
        address indexed recipient,
        uint256 tTokenAmount,
        uint256 wrappedTokenAmount
    );

    constructor(
        IERC20 _wrappedToken,
        T _tToken,
        uint256 _ratio
    ) {
        wrappedToken = _wrappedToken;
        tToken = _tToken;
        ratio = _ratio;
    }

    function wrap(uint256 amount) external {
        _wrap(msg.sender, amount);
    }

    function receiveApproval(
        address from,
        uint256 amount,
        address token,
        bytes calldata
    ) external override {
        require(
            token == address(wrappedToken),
            "Token is not the wrapped token"
        );
        require(
            msg.sender == address(wrappedToken),
            "Only wrapped token caller allowed"
        );
        _wrap(from, amount);
    }

    function unwrap(uint256 amount) external {
        _unwrap(msg.sender, amount);
    }

    function _wrap(address tokenHolder, uint256 wrappedTokenAmount) internal {
        uint256 tTokenAmount = (wrappedTokenAmount * ratio) /
            FLOATING_POINT_DIVISOR;

        emit Wrapped(tokenHolder, wrappedTokenAmount, tTokenAmount);

        wrappedToken.safeTransferFrom(
            tokenHolder,
            address(this),
            wrappedTokenAmount
        );
        tToken.safeTransfer(tokenHolder, tTokenAmount);
        wrappedBalance[tokenHolder] += wrappedTokenAmount;
    }

    function _unwrap(address tokenHolder, uint256 tTokenAmount) internal {
        uint256 wrappedTokenAmount = (tTokenAmount * FLOATING_POINT_DIVISOR) /
            ratio;

        require(
            wrappedBalance[tokenHolder] >= wrappedTokenAmount,
            "Can not unwrap more than previously wrapped"
        );

        emit Unwrapped(tokenHolder, tTokenAmount, wrappedTokenAmount);
        tToken.safeTransferFrom(tokenHolder, address(this), tTokenAmount);
        wrappedToken.safeTransfer(tokenHolder, wrappedTokenAmount);
        wrappedBalance[tokenHolder] -= wrappedTokenAmount;
    }
}

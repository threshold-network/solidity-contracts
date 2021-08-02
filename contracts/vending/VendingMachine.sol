// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@thesis/solidity-contracts/contracts/token/IReceiveApproval.sol";
import "../token/T.sol";

/// @title T token vending machine
/// @notice Contract implements a special update protocol to enable KEEP/NU
///         token holders to wrap their tokens and obtain T tokens according
///         to a fixed ratio. This will go on indefinitely and enable NU and
///         KEEP token holders to join T network without needing to buy or
///         sell any assets. Logistically, anyone holding NU or KEEP can wrap
///         those assets in order to receive T. They can also unwrap T in
///         order to go back to the underlying asset. There is a separate
///         instance of this contract deployed for KEEP holders and a separate
///         instance of this contract deployed for NU holders.
contract VendingMachine is Ownable, IReceiveApproval {
    using SafeERC20 for IERC20;
    using SafeERC20 for T;

    /// @notice Divisor for precision purposes, used to represent fractions.
    uint256 public constant FLOATING_POINT_DIVISOR = 1e18;

    /// @notice The token being wrapped to T (KEEP/NU).
    IERC20 public immutable wrappedToken;

    /// @notice T token contract.
    T public immutable tToken;

    /// @notice The ratio with which T token is converted based on the provided
    ///         token being wrapped (KEEP/NU), expressed in 1e18 precision.
    ///
    ///         When wrapping:
    ///           x [T] = amount [KEEP/NU] * ratio / FLOATING_POINT_DIVISOR
    ///
    ///         When unwrapping:
    ///           x [KEEP/NU] = amount [T] * FLOATING_POINT_DIVISOR / ratio
    uint256 public ratio;

    /// @notice The total balance of wrapped tokens for the given holder
    ///         account. Only holders that have previously wrapped KEEP/NU to T
    ///         can unwrap, up to the amount previously wrapped.
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
        uint256 _maxWrappedTokens,
        uint256 _tTokenAllocation
    ) {
        wrappedToken = _wrappedToken;
        tToken = _tToken;
        ratio =
            (FLOATING_POINT_DIVISOR * _tTokenAllocation) /
            _maxWrappedTokens;
    }

    /// @notice Wraps the given amount of the token (KEEP/NU) and
    ///         releases T token proportionally to the amount being wrapped and
    ///         the wrap ratio. The token holder needs to have at least the
    ///         given amount of the wrapped token (KEEP/NU) approved to transfer
    ///         to the Vending Machine before calling this function.
    /// @param amount The amount of KEEP/NU to be wrapped
    function wrap(uint256 amount) external {
        _wrap(msg.sender, amount);
    }

    /// @notice Wraps the given amount of the token (KEEP/NU) and
    ///         releases T token proportionally to the amount being wrapped and
    ///         the wrap ratio. This is a shortcut to `wrap` function allowing
    ///         to avoid a separate approval transaction. Only KEEP/NU token
    ///         is allowed as a caller, so please call this function via
    ///         token's `approveAndCall`.
    /// @param from Caller's address, must be the same as `wrappedToken` field
    /// @param amount The amount of KEEP/NU to be wrapped
    /// @param token Token's address, must be the same as `wrappedToken` field
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

    /// @notice Unwraps the given amount of T back to the legacy token (KEEP/NU)
    ///         based on the wrap ratio. Can only be called by a token holder
    ///         who previously wrapped their tokens. The token holder can not
    ///         unwrap more tokens than they originally wrapped. The token
    ///         holder needs to have at least the given amount of T tokens
    ///         approved to transfer to the Vending Machine before calling this
    ///         function.
    /// @param amount The amount of T to unwrap back to the collateral (KEEP/NU)
    function unwrap(uint256 amount) external {
        _unwrap(msg.sender, amount);
    }

    /// @notice The T token amount that's obtained from `_amount` wrapped
    ///         tokens (KEEP/NU).
    function conversionToT(uint256 _amount) public view returns (uint256) {
        return (_amount * ratio) / FLOATING_POINT_DIVISOR;
    }

    /// @notice The amount of wrapped tokens (KEEP/NU) than's obtained from
    ///         `_amount` T tokens.
    function conversionFromT(uint256 _amount) public view returns (uint256) {
        return (_amount * FLOATING_POINT_DIVISOR) / ratio;
    }

    function _wrap(address tokenHolder, uint256 wrappedTokenAmount) internal {
        uint256 tTokenAmount = conversionToT(wrappedTokenAmount);
        emit Wrapped(tokenHolder, wrappedTokenAmount, tTokenAmount);

        wrappedBalance[tokenHolder] += wrappedTokenAmount;
        wrappedToken.safeTransferFrom(
            tokenHolder,
            address(this),
            wrappedTokenAmount
        );
        tToken.safeTransfer(tokenHolder, tTokenAmount);
    }

    function _unwrap(address tokenHolder, uint256 tTokenAmount) internal {
        uint256 wrappedTokenAmount = conversionFromT(tTokenAmount);

        require(
            wrappedBalance[tokenHolder] >= wrappedTokenAmount,
            "Can not unwrap more than previously wrapped"
        );

        emit Unwrapped(tokenHolder, tTokenAmount, wrappedTokenAmount);
        wrappedBalance[tokenHolder] -= wrappedTokenAmount;
        tToken.safeTransferFrom(tokenHolder, address(this), tTokenAmount);
        wrappedToken.safeTransfer(tokenHolder, wrappedTokenAmount);
    }
}

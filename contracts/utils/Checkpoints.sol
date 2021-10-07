// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @dev Abstract contract to support checkpoints for Compound-like voting and delegation.
 * This implementation supports token supply up to 2^96^ - 1.
 *
 * This contract keeps a history (checkpoints) of each account's vote power. Vote power can be delegated either
 * by calling the {delegate} function directly, or by providing a signature to be used with {delegateBySig}. Voting
 * power can be queried through the public accessors {getVotes} and {getPastVotes}.
 *
 * By default, token balance does not account for voting power. This makes transfers cheaper. The downside is that it
 * requires users to delegate to themselves in order to activate checkpoints and have their voting power tracked.
 * Enabling self-delegation can easily be done by overriding the {delegates} function. Keep in mind however that this
 * will significantly increase the base gas cost of transfers.
 *
 * NOTE: Extracted from OpenZeppelin ERCVotes.sol. Maybe worth trying to push it upstream there.
 */
abstract contract Checkpoints {
    struct Checkpoint {
        uint32 fromBlock;
        uint96 votes;
    }

    mapping(address => address) internal _delegates;
    mapping(address => uint128[]) internal _checkpoints;
    uint128[] internal _totalSupplyCheckpoints;

    /**
     * @dev Emitted when an account changes their delegate.
     */
    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate
    );

    /**
     * @dev Emitted when a token transfer or delegate change results in changes to an account's voting power.
     */
    event DelegateVotesChanged(
        address indexed delegate,
        uint256 previousBalance,
        uint256 newBalance
    );

    function delegate(address delegator, address delegatee) internal virtual;

    /**
     * @dev Get the `pos`-th checkpoint for `account`.
     */
    function checkpoints(address account, uint32 pos)
        public
        view
        virtual
        returns (Checkpoint memory checkpoint)
    {
        (uint32 fromBlock, uint96 votes) = decodeCheckpoint(
            _checkpoints[account][pos]
        );
        checkpoint = Checkpoint(fromBlock, votes);
    }

    /**
     * @dev Get number of checkpoints for `account`.
     */
    function numCheckpoints(address account)
        public
        view
        virtual
        returns (uint32)
    {
        return SafeCast.toUint32(_checkpoints[account].length);
    }

    /**
     * @dev Get the address `account` is currently delegating to.
     */
    function delegates(address account) public view virtual returns (address) {
        return _delegates[account];
    }

    /// @notice Gets the current votes balance for `account`.
    /// @param account The address to get votes balance
    /// @return The number of current votes for `account`
    function getVotes(address account) public view returns (uint96) {
        uint256 pos = _checkpoints[account].length;
        return pos == 0 ? 0 : decodeValue(_checkpoints[account][pos - 1]);
    }

    /// @notice Determine the prior number of votes for an account as of
    ///         a block number.
    /// @dev Block number must be a finalized block or else this function will
    ///      revert to prevent misinformation.
    /// @param account The address of the account to check
    /// @param blockNumber The block number to get the vote balance at
    /// @return The number of votes the account had as of the given block
    function getPastVotes(address account, uint256 blockNumber)
        public
        view
        returns (uint96)
    {
        return _checkpointsLookup(_checkpoints[account], blockNumber);
    }

    /**
     * @dev Retrieve the `totalSupply` at the end of `blockNumber`. Note, this value is the sum of all balances.
     * It is but NOT the sum of all the delegated votes!
     *
     * Requirements:
     *
     * - `blockNumber` must have been already mined
     */
    function getPastTotalSupply(uint256 blockNumber)
        public
        view
        returns (uint96)
    {
        return _checkpointsLookup(_totalSupplyCheckpoints, blockNumber);
    }

    function encodeCheckpoint(uint32 blockNumber, uint96 value)
        internal
        pure
        returns (uint128)
    {
        return (uint128(blockNumber) << 96) | uint128(value);
    }

    function decodeBlockNumber(uint128 _checkpoint)
        internal
        pure
        returns (uint32)
    {
        return uint32(bytes4(bytes16(_checkpoint)));
    }

    function decodeValue(uint128 _checkpoint) internal pure returns (uint96) {
        return uint96(_checkpoint);
    }

    function decodeCheckpoint(uint128 _checkpoint)
        internal
        pure
        returns (uint32 blockNumber, uint96 value)
    {
        blockNumber = decodeBlockNumber(_checkpoint);
        value = decodeValue(_checkpoint);
    }

    /**
     * @dev Lookup a value in a list of (sorted) checkpoints.
     */
    function _checkpointsLookup(uint128[] storage ckpts, uint256 blockNumber)
        internal
        view
        returns (uint96)
    {
        // We run a binary search to look for the earliest checkpoint taken after `blockNumber`.
        //
        // During the loop, the index of the wanted checkpoint remains in the range [low-1, high).
        // With each iteration, either `low` or `high` is moved towards the middle of the range to maintain the invariant.
        // - If the middle checkpoint is after `blockNumber`, we look in [low, mid)
        // - If the middle checkpoint is before or equal to `blockNumber`, we look in [mid+1, high)
        // Once we reach a single value (when low == high), we've found the right checkpoint at the index high-1, if not
        // out of bounds (in which case we're looking too far in the past and the result is 0).
        // Note that if the latest checkpoint available is exactly for `blockNumber`, we end up with an index that is
        // past the end of the array, so we technically don't find a checkpoint after `blockNumber`, but it works out
        // the same.
        require(blockNumber < block.number, "Block not yet determined");

        uint256 high = ckpts.length;
        uint256 low = 0;
        while (low < high) {
            uint256 mid = Math.average(low, high);
            uint32 midBlock = decodeBlockNumber(ckpts[mid]);
            if (midBlock > blockNumber) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return high == 0 ? 0 : decodeValue(ckpts[high - 1]);
    }

    /**
     * @dev Maximum token supply. Defaults to `type(uint96).max` (2^96^ - 1).
     */
    function _maxSupply() internal view virtual returns (uint96) {
        return type(uint96).max;
    }

    function _moveVotingPower(
        address src,
        address dst,
        uint256 amount
    ) internal {
        if (src != dst && amount > 0) {
            if (src != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(
                    _checkpoints[src],
                    _subtract,
                    amount
                );
                emit DelegateVotesChanged(src, oldWeight, newWeight);
            }

            if (dst != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(
                    _checkpoints[dst],
                    _add,
                    amount
                );
                emit DelegateVotesChanged(dst, oldWeight, newWeight);
            }
        }
    }

    function _writeCheckpoint(
        uint128[] storage ckpts,
        function(uint256, uint256) view returns (uint256) op,
        uint256 delta
    ) internal returns (uint256 oldWeight, uint256 newWeight) {
        uint256 pos = ckpts.length;
        oldWeight = pos == 0 ? 0 : decodeValue(ckpts[pos - 1]);
        newWeight = op(oldWeight, delta);

        if (pos > 0) {
            uint32 fromBlock = decodeBlockNumber(ckpts[pos - 1]);
            if (fromBlock == block.number) {
                ckpts[pos - 1] = encodeCheckpoint(
                    fromBlock,
                    SafeCast.toUint96(newWeight)
                );
                return (oldWeight, newWeight);
            }
        }

        ckpts.push(
            encodeCheckpoint(
                SafeCast.toUint32(block.number),
                SafeCast.toUint96(newWeight)
            )
        );
    }

    // slither-disable-next-line dead-code
    function _add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }

    // slither-disable-next-line dead-code
    function _subtract(uint256 a, uint256 b) internal pure returns (uint256) {
        return a - b;
    }
}

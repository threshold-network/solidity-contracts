// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.9;

import "../token/T.sol";
import "../staking/IStaking.sol";

contract RewardReceiverMock {
    T internal immutable token;

    constructor(T _token) {
        token = _token;
    }

    function receiveReward(uint96 reward) external {
        token.transferFrom(msg.sender, address(this), reward);
    }
}

contract TokenStakingMock {
    struct ApplicationInfo {
        IStaking.ApplicationStatus status;
        uint96 authorizedOverall;
    }

    mapping(address => ApplicationInfo) public applicationInfo;

    function setApplicationInfo(
        address application,
        IStaking.ApplicationStatus status,
        uint96 authorizedOverall
    ) external {
        ApplicationInfo storage info = applicationInfo[application];
        info.status = status;
        info.authorizedOverall = authorizedOverall;
    }

    function getApplicationStatus(address application)
        external
        view
        returns (IStaking.ApplicationStatus)
    {
        return applicationInfo[application].status;
    }

    function getAuthorizedOverall(address application)
        external
        view
        returns (uint96)
    {
        return applicationInfo[application].authorizedOverall;
    }

    function getApplicationsLength() external pure returns (uint256) {
        return 1;
    }
}

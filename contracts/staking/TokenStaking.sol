// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.4;

import "./StakingProviders.sol";
import "./IApplication.sol";
import "../token/T.sol";
import "../vending/VendingMachine.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Meta staking contract. 3 roles: app, meta staking, app manager
contract TokenStaking is Ownable {
    using SafeERC20 for T;

    // TODO events

    enum StakingProvider {
        NU,
        KEEP,
        T
    }

    struct OperatorInfo {
        address owner;
        address beneficiary;
        address authorizer;
        mapping(address => AppAuthorization) authorizations;
        uint256 nuStake;
        uint256 keepStake;
        uint256 tStake;
    }

    struct AppAuthorization {
        uint256 authorized;
        uint256 deauthorizing;
    }

    struct ApplicationInfo {
        mapping(StakingProvider => bool) availability;
        uint256 minAllocationSize;
        bool suspended;
    }

    T public immutable token;
    IKeepTokenStaking public immutable keepStakingContract;
    INuCypherStakingEscrow public immutable nucypherStakingContract;
    VendingMachine public immutable keepVendingMachine;
    VendingMachine public immutable nucypherVendingMachine;

    uint256 public minTStakeAmount;

    // TODO public getters for inner mappings
    mapping(address => OperatorInfo) public operators;
    mapping(address => ApplicationInfo) public applicationInfo;
    address[] public applications;

    modifier onlyOperatorsOwner(address operator) {
        require(
            operators[operator].owner == msg.sender,
            "Only owner can call this function"
        );
        _;
    }

    /// @notice Check if application was suspended
    modifier applicationSuspensionCheck(address application) {
        require(
            !applicationInfo[application].suspended,
            "Application was suspended"
        );
        _;
    }

    modifier onlyAuthorizerOf(address operator) {
        require(
            operators[operator].authorizer == msg.sender,
            "Not operator authorizer"
        );
        _;
    }

    /// @param _token Address of T token contract
    /// @param _keepStakingContract Address of Keep staking contract
    /// @param _nucypherStakingContract Address of NuCypher staking contract
    /// @param _keepVendingMachine Address of Keep vending machine
    /// @param _nucypherVendingMachine Address of NuCypher vending machine
    constructor(
        T _token,
        IKeepTokenStaking _keepStakingContract,
        INuCypherStakingEscrow _nucypherStakingContract,
        VendingMachine _keepVendingMachine,
        VendingMachine _nucypherVendingMachine
    ) {
        // TODO check contracts and input variables
        token = _token;
        keepStakingContract = _keepStakingContract;
        nucypherStakingContract = _nucypherStakingContract;
        keepVendingMachine = _keepVendingMachine;
        nucypherVendingMachine = _nucypherVendingMachine;
    }

    /**
     * @notice Allows the governance to set the minimum required stake amount. This amount is
     * required to protect against griefing the staking contract and individual
     * applications are allowed to require higher minimum stakes if necessary.
     */
    function setMinimumStakeAmount(uint256 amount) external onlyOwner {
        minTStakeAmount = amount;
    }

    /// @notice Penalizes operator `operator`; the penalty details are encoded in `penaltyData`
    function slash(address operator, bytes calldata penaltyData) external {
        // TODO check suspended flag
        // TODO check slashing event (from app)
        // TODO choose stake (and check allocation)
        // TODO prepare caldata
        // TODO send slashing call
    }

    /// @notice Enable application for the specified staking providers and reset app parmaters
    function setupApplication(
        address application,
        StakingProvider[] calldata stakingProviders
    ) external onlyOwner {
        ApplicationInfo storage info = applicationInfo[application];
        for (uint256 i = 0; i < stakingProviders.length; i++) {
            StakingProvider stakingProvider = stakingProviders[i];
            require(
                !info.availability[stakingProvider],
                "Availability was already set"
            );
            info.availability[stakingProvider] = true;
        }

        bool existingApplication = false;
        for (uint256 i = 0; i < applications.length; i++) {
            if (applications[i] == application) {
                existingApplication = true;
                break;
            }
        }
        if (!existingApplication) {
            applications.push(application);
        }

        info.minAllocationSize = IApplication(application).minAllocationSize();
    }

    /// @notice Suspend/coninue allocation for the specified app
    function suspendApplication(address application) external onlyOwner {
        ApplicationInfo storage info = applicationInfo[application];
        info.suspended = !info.suspended;
    }

    /**
     * @notice Creates a delegation with `msg.sender` owner with the given operator,
     * beneficiary, and authorizer. Transfers the given amount of T to the staking
     * contract. The owner of the delegation needs to have the amount approved to
     * transfer to the staking contract.
     */
    function stake(
        address operator,
        address beneficiary,
        address authorizer,
        uint256 amount
    ) external {
        require(operator != address(0), "Operator must be specified");
        OperatorInfo storage operatorInfo = operators[operator];
        require(
            operatorInfo.owner == address(0),
            "This operator is already in use"
        );
        require(amount > 0, "Amount to stake must be greater than 0");
        operatorInfo.owner = msg.sender;
        operatorInfo.authorizer = authorizer != address(0)
            ? authorizer
            : msg.sender;
        operatorInfo.beneficiary = beneficiary != address(0)
            ? beneficiary
            : msg.sender;

        operatorInfo.tStake += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Copies delegation from the legacy KEEP staking contract to T staking contract.
     * No tokens are transferred. Caches the active stake amount from KEEP staking
     * contract. Can be called by anyone.
     */
    function stakeKeep(address operator) external {
        require(operator != address(0), "Operator must be specified");
        OperatorInfo storage operatorInfo = operators[operator];
        require(operatorInfo.keepStake == 0, "KEEP stake is already synced");

        address owner = keepStakingContract.ownerOf(operator);
        // TODO can be used to steal address of operator
        require(
            operatorInfo.owner == address(0) || operatorInfo.owner == owner,
            "Owner of this operator in Keep contract is different"
        );

        address authorizer = keepStakingContract.authorizerOf(operator);
        require(
            operatorInfo.authorizer == address(0) ||
                operatorInfo.authorizer == authorizer,
            "Authorizer of this operator in Keep contract is different"
        );

        address beneficiary = keepStakingContract.beneficiaryOf(operator);
        require(
            operatorInfo.beneficiary == address(0) ||
                operatorInfo.beneficiary == beneficiary,
            "Beneficiary of this operator in Keep contract is different"
        );

        require(
            keepStakingContract.isAuthorizedForOperator(
                operator,
                address(this)
            ),
            "T staking contract is not authorized in Keep contract"
        );

        (uint256 keepStakeAmount, , uint256 undelegatedAt) = keepStakingContract
            .getDelegationInfo(operator);
        uint256 tAmount = 0;
        if (undelegatedAt == 0) {
            (tAmount, ) = keepVendingMachine.conversionToT(keepStakeAmount);
        }
        require(tAmount > 0, "Nothing to sync");

        operatorInfo.keepStake = tAmount;
        if (operatorInfo.owner == address(0)) {
            operatorInfo.owner = owner;
            operatorInfo.authorizer = authorizer;
            operatorInfo.beneficiary = beneficiary;
        }
    }

    /**
     * @notice Copies delegation from the legacy NU staking contract to T staking contract,
     * additionally appointing beneficiary and authorizer roles. Caches the amount
     * staked in NU staking contract. Can be called only by the original delegation
     * owner.
     */
    function stakeNu(
        address operator,
        address beneficiary,
        address authorizer
    ) external {
        require(operator != address(0), "Operator must be specified");
        OperatorInfo storage operatorInfo = operators[operator];
        require(operatorInfo.nuStake == 0, "NU stake is already synced");

        require(
            operatorInfo.owner == address(0) ||
                operatorInfo.owner == msg.sender,
            "Operator has a different owner"
        );
        require(
            operatorInfo.authorizer == address(0) ||
                operatorInfo.authorizer == authorizer,
            "Operator has a different authorizer than specified"
        );
        require(
            operatorInfo.beneficiary == address(0) ||
                operatorInfo.beneficiary == beneficiary,
            "Operator has a different beneficiary than specified"
        );

        uint256 nuStakeAmount = nucypherStakingContract.getAllTokens(
            msg.sender
        );
        (uint256 tAmount, ) = nucypherVendingMachine.conversionToT(
            nuStakeAmount
        );
        require(tAmount > 0, "Nothing to sync");

        operatorInfo.nuStake = tAmount;
        if (operatorInfo.owner == address(0)) {
            operatorInfo.owner = msg.sender;
            operatorInfo.authorizer = authorizer;
            operatorInfo.beneficiary = beneficiary;
        }
    }

    /**
     * @notice Increases the amount of the stake for the given operator. The sender of this
     * transaction needs to have the amount approved to transfer to the staking
     * contract. Can be called by anyone.
     */
    function topUp(address operator, uint256 amount) external {
        require(amount > 0, "Amount to top-up must be greater than 0");
        OperatorInfo storage operatorInfo = operators[operator];
        require(operatorInfo.owner != address(0), "Operator has no stake");
        operatorInfo.tStake += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    // /// @notice Set or change authorizer role
    // function setAuthorizer(address operator, address authorizer)
    //     external
    //     onlyOperatorsOwner(operator)
    // {
    //     operators[operator].authorizer = authorizer != address(0)
    //         ? authorizer
    //         : msg.sender;
    // }

    // /// @notice Set or change beneficiary role
    // function setBeneficiary(address operator, address beneficiary)
    //     external
    //     onlyOperatorsOwner(operator)
    // {
    //     operators[operator].beneficiary = beneficiary != address(0)
    //         ? beneficiary
    //         : msg.sender;
    // }

    /// @notice Withdraw T tokens if possible
    function withdraw(address operator, uint256 value) external {
        OperatorInfo storage operatorInfo = operators[operator];
        require(
            operatorInfo.owner == msg.sender,
            "Only owner can withdraw tokens"
        );
        require(
            value > 0 &&
                getAvailableToWithdraw(operator, StakingProvider.T) >= value,
            "Not enough tokens to withdraw"
        );
        operatorInfo.tStake -= value;
        token.safeTransfer(msg.sender, value);
    }

    /**
     * @notice Increases the authorization of the given operator for the given application by
     * the given amount. Calls `authorizationIncreased(address operator, uint256 amount)`
     * callback on the given application to notify the application. Can only be called
     * by the given operator's authorizer.
     */
    function increaseAuthorization(
        address operator,
        address _application,
        uint256 amount
    ) external onlyAuthorizerOf(operator) {
        // TODO extract or remove?
        ApplicationInfo storage application = applicationInfo[_application];
        require(!application.suspended, "Application is suspended");

        AppAuthorization storage authorization = operators[operator]
            .authorizations[_application];
        require(
            authorization.authorized + amount >= application.minAllocationSize,
            "Authorization is too small for the specified application"
        );

        uint256 availableTValue = getAvailableToAuthorize(
            operator,
            _application
        );
        require(availableTValue >= amount, "Not enough stake to authorize");
        authorization.authorized += amount;
        IApplication(_application).authorizationIncreased(operator, amount);
    }

    /**
     * @notice Called by the application at its discretion to approve the previously requested
     * authorization decrease request. Can only be called by the application that
     * was previously requested to decrease the authorization for that operator.
     */
    function approveAuthorizationDecrease(address operator) external {
        // TODO extract or remove?
        ApplicationInfo storage application = applicationInfo[msg.sender];
        require(!application.suspended, "Application is suspended");

        AppAuthorization storage authorization = operators[operator]
            .authorizations[msg.sender];
        require(
            authorization.deauthorizing > 0,
            "Sender was not authorized as application"
        );
        authorization.authorized -= authorization.deauthorizing;
        authorization.deauthorizing = 0;
    }

    /**
     * @notice Requests decrease of the all authorization for the given operator on the given
     * application. Calls `authorizationDecreaseRequested(address operator, uint256 amount)`
     * on the application. It does not change the authorized amount. Can only be called
     * by the given operator's authorizer. Overwrites pending authorization decrease
     * for the given operator and application.
     */
    function requestAuthorizationDecrease(address operator, address application)
        external
    {
        uint256 authorized = operators[operator]
            .authorizations[application]
            .authorized;
        requestAuthorizationDecrease(operator, application, authorized);
    }

    /**
     * @notice Requests decrease of the all authorization for the given operator on the all
     * applications. Calls `authorizationDecreaseRequested(address operator, uint256 amount)`
     * for each authorized application. It does not change the authorized amount. Can only be called
     * by the given operator's authorizer. Overwrites pending authorization decrease
     * for the given operator.
     */
    function requestAuthorizationDecrease(address operator) external {
        uint256 deauthorizing = 0;
        for (uint256 i = 0; i < applications.length; i++) {
            address application = applications[i];
            uint256 authorized = operators[operator]
                .authorizations[application]
                .authorized;
            if (authorized > 0) {
                requestAuthorizationDecrease(operator, application, authorized);
                deauthorizing += authorized;
            }
        }

        require(deauthorizing > 0, "Nothing was authorized");
    }

    /// @notice Returns the authorized stake amount of the operator for the application.
    function authorizedStake(address operator, address application)
        external
        view
        returns (uint256)
    {
        return operators[operator].authorizations[application].authorized;
    }

    /**
     * @notice Requests decrease of the authorization for the given operator on the given
     * application by the provided amount. Calls `authorizationDecreaseRequested(address operator, uint256 amount)`
     * on the application. It does not change the authorized amount. Can only be called
     * by the given operator's authorizer. Overwrites pending authorization decrease
     * for the given operator and application.
     */
    function requestAuthorizationDecrease(
        address operator,
        address _application,
        uint256 amount
    ) public onlyAuthorizerOf(operator) {
        // TODO extract or remove?
        ApplicationInfo storage application = applicationInfo[_application];
        require(!application.suspended, "Application is suspended");

        require(
            amount > 0,
            "Amount to decrease authorization must greater than 0"
        );

        AppAuthorization storage authorization = operators[operator]
            .authorizations[_application];
        require(
            authorization.authorized >= amount,
            "Amount to decrease must be less than authorized"
        );
        require(
            authorization.authorized - amount == 0 ||
                authorization.authorized - amount >=
                application.minAllocationSize,
            "Resulting authorization is less than the minimum allowed"
        );

        authorization.deauthorizing = amount; // TODO maybe remove?
        IApplication(_application).authorizationDecreaseRequested(
            operator,
            amount
        );
    }

    /// @notice Returns available amount of stake to withdraw (not applicable for Keep)
    /// @dev Resulting value is in original token denomination
    function getAvailableToWithdraw(
        address operator,
        StakingProvider stakingProvider
    ) public view returns (uint256 value) {
        OperatorInfo storage operatorInfo = operators[operator];
        uint256 cumulativeStake = operatorInfo.tStake +
            operatorInfo.nuStake +
            operatorInfo.keepStake;

        uint256 maxAuthorization = 0;
        for (uint256 i = 0; i < applications.length; i++) {
            address application = applications[i];
            maxAuthorization = Math.max(
                maxAuthorization,
                operatorInfo.authorizations[application].authorized
            );
        }

        cumulativeStake -= maxAuthorization;
        if (stakingProvider == StakingProvider.T) {
            value = cumulativeStake;
        } else if (stakingProvider == StakingProvider.NU) {
            (value, ) = nucypherVendingMachine.conversionFromT(cumulativeStake);
        } else {
            (value, ) = keepVendingMachine.conversionFromT(cumulativeStake);
        }
    }

    /// @notice Returns available amount to authorize for the specified application
    function getAvailableToAuthorize(address operator, address application)
        public
        view
        returns (uint256 availableTValue)
    {
        availableTValue = 0;
        OperatorInfo storage operatorInfo = operators[operator];

        if (applicationInfo[application].availability[StakingProvider.T]) {
            availableTValue += operatorInfo.tStake;
        }

        if (applicationInfo[application].availability[StakingProvider.KEEP]) {
            availableTValue += operatorInfo.keepStake;
        }

        if (applicationInfo[application].availability[StakingProvider.NU]) {
            availableTValue += operatorInfo.nuStake;
        }

        availableTValue -= operatorInfo.authorizations[application].authorized;
    }
}

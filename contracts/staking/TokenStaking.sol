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
        address payable beneficiary;
        address authorizer;
        mapping(address => AppAuthorization) authorizations;
        uint256 authorizedApplications;
        uint256 nuStake;
        uint256 keepStake;
        uint256 tStake;
    }

    struct AppAuthorization {
        uint256 authorized;
        uint256 deauthorizing;
    }

    struct ApplicationInfo {
        uint256 minAllocationSize;
        bool disabled;
        address panicButton;
    }

    T public immutable token;
    IKeepTokenStaking public immutable keepStakingContract;
    INuCypherStakingEscrow public immutable nucypherStakingContract;
    VendingMachine public immutable keepVendingMachine;
    VendingMachine public immutable nucypherVendingMachine;

    uint256 public minTStakeAmount;
    uint256 public authorizationCeiling;

    // TODO public getters for inner mappings
    mapping(address => OperatorInfo) public operators;
    mapping(address => ApplicationInfo) public applicationInfo;
    address[] public applications;

    // modifier onlyOperatorsOwner(address operator) {
    //     require(
    //         operators[operator].owner == msg.sender,
    //         "Only owner can call this function"
    //     );
    //     _;
    // }

    modifier onlyGovernance() {
        require(owner() == msg.sender, "Caller is not the governance");
        _;
    }

    modifier onlyPanicButtonOf(address application) {
        require(
            applicationInfo[application].panicButton == msg.sender,
            "Caller is not the address of panic button"
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
    function setMinimumStakeAmount(uint256 amount) external onlyGovernance {
        minTStakeAmount = amount;
    }

    /// @notice Penalizes operator `operator`; the penalty details are encoded in `penaltyData`
    function slash(address operator, bytes calldata penaltyData) external {
        // TODO check panic button flag
        // TODO check slashing event (from app)
        // TODO choose stake (and check authorization)
        // TODO prepare caldata
        // TODO send slashing call
    }

    /**
     * @notice Allows the governance to approve the particular application before individual
     * stake authorizers are able to authorize it.
     */
    function approveApplication(address application) external onlyGovernance {
        ApplicationInfo storage info = applicationInfo[application];
        info.disabled = false;

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

    /**
     * @notice Disables the given application's eligibility to slash stakes. Can be called only
     * by a panic button of the particular application. The disabled application can not
     * slash stakes until it is approved again by the governance using `approveApplication`
     * function. Should be used only in case of an emergency.
     */
    function disableApplication(address application)
        external
        onlyPanicButtonOf(application)
    {
        applicationInfo[application].disabled = true;
    }

    /**
     * @notice Sets the panic button role for the given application to the provided address.
     * Can only be called by the governance. If the panic button for the given
     * application should be disabled, the role address should can set to 0x0 address.
     */
    function setPanicButton(address application, address panicButton)
        external
        onlyGovernance
    {
        applicationInfo[application].panicButton = panicButton;
    }

    /**
     * @notice Sets the maximum number of applications one operator can authorize. Used to
     * protect against DoSing slashing queue. Can only be called by the governance.
     */
    function setAuthorizationCeiling(uint256 ceiling) external onlyGovernance {
        authorizationCeiling = ceiling;
    }

    /**
     * @notice Creates a delegation with `msg.sender` owner with the given operator,
     * beneficiary, and authorizer. Transfers the given amount of T to the staking
     * contract. The owner of the delegation needs to have the amount approved to
     * transfer to the staking contract.
     */
    function stake(
        address _operator,
        address payable beneficiary,
        address authorizer,
        uint256 amount
    ) external {
        require(_operator != address(0), "Operator must be specified");
        OperatorInfo storage operator = operators[_operator];
        require(
            operator.owner == address(0),
            "This operator is already in use"
        );
        require(
            amount > minTStakeAmount,
            "Amount to stake must be greater than 0"
        );
        operator.owner = msg.sender;
        operator.authorizer = authorizer != address(0)
            ? authorizer
            : msg.sender;
        operator.beneficiary = beneficiary != address(0)
            ? beneficiary
            : payable(msg.sender);

        operator.tStake += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Copies delegation from the legacy KEEP staking contract to T staking contract.
     * No tokens are transferred. Caches the active stake amount from KEEP staking
     * contract. Can be called by anyone.
     */
    function stakeKeep(address _operator) external {
        require(_operator != address(0), "Operator must be specified");
        OperatorInfo storage operator = operators[_operator];
        require(operator.keepStake == 0, "KEEP stake is already synced");

        address owner = keepStakingContract.ownerOf(_operator);
        // TODO can be used to steal address of operator
        require(
            operator.owner == address(0) || operator.owner == owner,
            "Owner of this operator in Keep contract is different"
        );

        address authorizer = keepStakingContract.authorizerOf(_operator);
        require(
            operator.authorizer == address(0) ||
                operator.authorizer == authorizer,
            "Authorizer of this operator in Keep contract is different"
        );

        address payable beneficiary = keepStakingContract.beneficiaryOf(
            _operator
        );
        require(
            operator.beneficiary == address(0) ||
                operator.beneficiary == beneficiary,
            "Beneficiary of this operator in Keep contract is different"
        );

        require(
            keepStakingContract.isAuthorizedForOperator(
                _operator,
                address(this)
            ),
            "T staking contract is not authorized in Keep contract"
        );

        (uint256 keepStakeAmount, , uint256 undelegatedAt) = keepStakingContract
            .getDelegationInfo(_operator);
        uint256 tAmount = 0;
        if (undelegatedAt == 0) {
            (tAmount, ) = keepVendingMachine.conversionToT(keepStakeAmount);
        }
        require(tAmount > 0, "Nothing to sync");

        operator.keepStake = tAmount;
        if (operator.owner == address(0)) {
            operator.owner = owner;
            operator.authorizer = authorizer;
            operator.beneficiary = beneficiary;
        }
    }

    /**
     * @notice Copies delegation from the legacy NU staking contract to T staking contract,
     * additionally appointing beneficiary and authorizer roles. Caches the amount
     * staked in NU staking contract. Can be called only by the original delegation
     * owner.
     */
    function stakeNu(
        address _operator,
        address payable beneficiary,
        address authorizer
    ) external {
        // TODO prevent calling twice from the same owner and different operators
        require(_operator != address(0), "Operator must be specified");
        OperatorInfo storage operator = operators[_operator];
        require(operator.nuStake == 0, "NU stake is already synced");

        require(
            operator.owner == address(0) || operator.owner == msg.sender,
            "Operator has a different owner"
        );
        require(
            operator.authorizer == address(0) ||
                operator.authorizer == authorizer,
            "Operator has a different authorizer than specified"
        );
        require(
            operator.beneficiary == address(0) ||
                operator.beneficiary == beneficiary,
            "Operator has a different beneficiary than specified"
        );

        uint256 nuStakeAmount = nucypherStakingContract.getAllTokens(
            msg.sender
        );
        (uint256 tAmount, ) = nucypherVendingMachine.conversionToT(
            nuStakeAmount
        );
        require(tAmount > 0, "Nothing to sync");

        operator.nuStake = tAmount;
        if (operator.owner == address(0)) {
            operator.owner = msg.sender;
            operator.authorizer = authorizer;
            operator.beneficiary = beneficiary;
        }
    }

    /**
     * @notice Increases the amount of the stake for the given operator. The sender of this
     * transaction needs to have the amount approved to transfer to the staking
     * contract. Can be called by anyone.
     */
    function topUp(address _operator, uint256 amount) external {
        require(amount > 0, "Amount to top-up must be greater than 0");
        OperatorInfo storage operator = operators[_operator];
        require(operator.owner != address(0), "Operator has no stake");
        operator.tStake += amount;
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

    /**
     * @notice Reduces the liquid T stake amount by `amount` and withdraws `amount` of T
     * to the owner. Reverts if there is at least one authorization higher than the sum
     * of a legacy stake and remaining liquid T stake or if the `amount` is higher than
     * the liquid T stake amount. Can be called only by the owner or operator.
     */
    function unstakeT(address _operator, uint256 amount) external {
        OperatorInfo storage operator = operators[_operator];
        require(
            operator.owner == msg.sender || _operator == msg.sender,
            "Only owner and operator can unstake tokens"
        );
        require(
            amount > 0 &&
                amount + getMinStaked(_operator, StakingProvider.T) <=
                operator.tStake,
            "Can't unstake specified amount of tokens"
        );
        operator.tStake -= amount;
        token.safeTransfer(operator.owner, amount);
    }

    /**
     * @notice Sets the legacy staking contract active stake amount cached in T staking
     * contract to 0. Reverts if the amount of liquid T staked in T staking contract is
     * lower than the highest application authorization. This function allows to
     * unstake from Keep staking contract and still being able to operate in T network
     * and earning rewards based on the liquid T staked. Can be called only by the
     * delegation owner and operator.
     */
    function unstakeKeep(address _operator) external {
        OperatorInfo storage operator = operators[_operator];
        require(
            operator.owner == msg.sender || _operator == msg.sender,
            "Only owner and operator can unstake tokens"
        );
        require(operator.keepStake != 0, "Nothing to unstake");
        require(
            getMinStaked(_operator, StakingProvider.KEEP) == 0,
            "At least one application prevents from unstaking"
        );
        operator.keepStake = 0;
    }

    /**
     * @notice Reduces cached legacy NU stake amount by `amount`. Reverts if there is at least
     * one authorization higher than the sum of remaining legacy NU stake and liquid T
     * stake for that operator or if amount is higher than the cached legacy stake
     * amount. If succeeded, the legacy NU stake can be partially or fully undelegated
     * on the legacy staking contract. This function allows to unstake from NU staking
     * contract and still being able to operate in T network and earning rewards based
     * on the liquid T staked. Can be called only by the delegation owner and operator.
     */
    function unstakeNu(address _operator, uint256 amount) external {
        OperatorInfo storage operator = operators[_operator];
        require(
            operator.owner == msg.sender || _operator == msg.sender,
            "Only owner and operator can unstake tokens"
        );
        require(
            amount > 0 &&
                amount + getMinStaked(_operator, StakingProvider.NU) <=
                operator.nuStake,
            "Can't unstake specified amount of tokens"
        );
        operator.nuStake -= amount;
    }

    /**
     * @notice Sets cached legacy stake amount to 0, sets the liquid T stake amount to 0 and
     * withdraws all liquid T from the stake to the owner. Reverts if there is at least one
     * non-zero authorization. Can be called only by the delegation owner and operator.
     */
    function unstakeAll(address _operator) external {
        OperatorInfo storage operator = operators[_operator];
        require(
            operator.owner == msg.sender || _operator == msg.sender,
            "Only owner and operator can unstake tokens"
        );
        require(
            operator.authorizedApplications == 0,
            "At least one application is still authorized"
        );

        uint256 amount = operator.tStake;
        operator.tStake = 0;
        operator.keepStake = 0;
        operator.nuStake = 0;
        if (amount > 0) {
            token.safeTransfer(operator.owner, amount);
        }
    }

    /**
     * @notice Increases the authorization of the given operator for the given application by
     * the given amount. Calls `authorizationIncreased(address operator, uint256 amount)`
     * callback on the given application to notify the application. Can only be called
     * by the given operator's authorizer.
     */
    function increaseAuthorization(
        address _operator,
        address _application,
        uint256 amount
    ) external onlyAuthorizerOf(_operator) {
        // TODO extract or remove?
        ApplicationInfo storage application = applicationInfo[_application];
        require(!application.disabled, "Application is disabled");

        OperatorInfo storage operator = operators[_operator];
        AppAuthorization storage authorization = operator.authorizations[
            _application
        ];
        if (authorization.authorized == 0) {
            operator.authorizedApplications += 1;
            require(
                authorizationCeiling == 0 ||
                    operator.authorizedApplications <= authorizationCeiling,
                "Can't authorize more applications"
            );
        }

        require(
            authorization.authorized + amount >= application.minAllocationSize,
            "Authorization is too small for the specified application"
        );

        uint256 availableTValue = getAvailableToAuthorize(
            _operator,
            _application
        );
        require(availableTValue >= amount, "Not enough stake to authorize");
        authorization.authorized += amount;
        IApplication(_application).authorizationIncreased(_operator, amount);
    }

    /**
     * @notice Called by the application at its discretion to approve the previously requested
     * authorization decrease request. Can only be called by the application that
     * was previously requested to decrease the authorization for that operator.
     */
    function approveAuthorizationDecrease(address _operator) external {
        // TODO extract or remove?
        ApplicationInfo storage application = applicationInfo[msg.sender];
        require(!application.disabled, "Application is disabled");

        OperatorInfo storage operator = operators[_operator];
        AppAuthorization storage authorization = operator.authorizations[
            msg.sender
        ];
        require(
            authorization.deauthorizing > 0,
            "Caller must be authorized application"
        );
        authorization.authorized -= authorization.deauthorizing;
        authorization.deauthorizing = 0;
        if (authorization.authorized == 0) {
            operator.authorizedApplications -= 1;
        }
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

    /// @notice Returns staked amount of NU for the specified operator
    function stakedNu(address operator)
        external
        view
        returns (uint256 nuAmount)
    {
        (nuAmount, ) = nucypherVendingMachine.conversionFromT(
            operators[operator].nuStake
        );
    }

    /// @notice Gets the beneficiary for the specified operator address.
    /// @return Beneficiary address.
    function beneficiaryOf(address operator)
        external
        view
        returns (address payable)
    {
        return operators[operator].beneficiary;
    }

    /**
     * @notice Checks if the specified operator has a stake delegated and if it has been
     * authorized for at least one application. If this function returns true,
     * off-chain client of the given operator is eligible to join the network.
     */
    function hasStakeDelegated(address operator) external view returns (bool) {
        return operators[operator].authorizedApplications > 0;
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
        require(!application.disabled, "Application is disabled");

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

        authorization.deauthorizing = amount;
        IApplication(_application).authorizationDecreaseRequested(
            operator,
            amount
        );
    }

    /// @notice Returns minimum possible stake for T, KEEP or NU
    function getMinStaked(address _operator, StakingProvider stakingProviders)
        public
        view
        returns (uint256)
    {
        OperatorInfo storage operator = operators[_operator];
        uint256 maxAuthorization = 0;
        for (uint256 i = 0; i < applications.length; i++) {
            address application = applications[i];
            maxAuthorization = Math.max(
                maxAuthorization,
                operator.authorizations[application].authorized
            );
        }

        if (maxAuthorization == 0) {
            return 0;
        }
        if (stakingProviders != StakingProvider.T) {
            maxAuthorization -= Math.min(maxAuthorization, operator.tStake);
        }
        if (stakingProviders != StakingProvider.NU) {
            maxAuthorization -= Math.min(maxAuthorization, operator.nuStake);
        }
        if (stakingProviders != StakingProvider.KEEP) {
            maxAuthorization -= Math.min(maxAuthorization, operator.keepStake);
        }
        return maxAuthorization;
    }

    /// @notice Returns available amount to authorize for the specified application
    function getAvailableToAuthorize(address _operator, address application)
        public
        view
        returns (uint256 availableTValue)
    {
        OperatorInfo storage operator = operators[_operator];
        availableTValue =
            operator.tStake +
            operator.keepStake +
            operator.nuStake;
        availableTValue -= operator.authorizations[application].authorized;
    }
}

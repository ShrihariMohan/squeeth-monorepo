// SPDX-License-Identifier: GPL-3.0-only

pragma solidity =0.7.6;
pragma abicoder v2;

// interface
import {IController} from "../interfaces/IController.sol";
import {IWPowerPerp} from "../interfaces/IWPowerPerp.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IController} from "../interfaces/IController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IShortPowerPerp} from "../interfaces/IShortPowerPerp.sol";

// contract
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StrategyBase} from "./base/StrategyBase.sol";
import {StrategyFlashSwap} from "./base/StrategyFlashSwap.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/drafts/EIP712.sol";

// lib
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
// StrategyMath licensed under AGPL-3.0-only
import {StrategyMath} from "./base/StrategyMath.sol";
import {Power2Base} from "../libs/Power2Base.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {ECDSA} from "@openzeppelin/contracts/cryptography/ECDSA.sol";

/**
 * @dev CrabStrategyV2 contract
 * @notice Contract for Crab strategy
 * @author Opyn team
 */
contract CrabStrategyV2 is StrategyBase, StrategyFlashSwap, ReentrancyGuard, Ownable, EIP712 {
    using Counters for Counters.Counter;
    using StrategyMath for uint256;
    using Address for address payable;

    /// @dev the cap in ETH for the strategy, above which deposits will be rejected
    uint256 public strategyCap;

    /// @dev the TWAP_PERIOD used in the PowerPerp Controller contract
    uint32 public constant POWER_PERP_PERIOD = 420 seconds;

    /// @dev basic unit used for calculation
    uint256 private constant ONE = 1e18;
    uint256 private constant ONE_ONE = 1e36;

    // @dev OTC price must be within this distance of the uniswap twap price
    uint256 public otcPriceTolerance = 5e16; // 5%

    /// @dev twap period to use for hedge calculations
    uint32 public hedgingTwapPeriod = 420 seconds;
    /// @dev true if CrabV2 was initialized
    bool public isInitialized; 

    /// @dev typehash for signed orders
    bytes32 private constant _CRAB_BALANCE_TYPEHASH =
        keccak256(
            "Order(uint256 bidId,address trader,address traderToken,uint256 traderAmount,address managerToken,uint256 managerAmount,uint256 nonce)"
        );

    /// @dev enum to differentiate between uniswap swap callback function source
    enum FLASH_SOURCE {
        FLASH_DEPOSIT,
        FLASH_WITHDRAW,
        FLASH_HEDGE_SELL,
        FLASH_HEDGE_BUY
    }

    /// @dev ETH:WSqueeth uniswap pool
    address public immutable ethWSqueethPool;
    /// @dev strategy uniswap oracle
    address public immutable oracle;
    address public immutable ethQuoteCurrencyPool;
    address public immutable quoteCurrency;
    address public immutable timelock;

    /// @dev strategy will only allow hedging if collateral to trade is at least a set percentage of the total strategy collateral
    uint256 public deltaHedgeThreshold = 1e15;
    /// @dev time difference to trigger a hedge (seconds)
    uint256 public hedgeTimeThreshold;
    /// @dev price movement to trigger a hedge (0.1*1e18 = 10%)
    uint256 public hedgePriceThreshold;
    /// @dev hedge auction duration (seconds)
    uint256 public auctionTime;
    /// @dev start auction price multiplier for hedge buy auction and reserve price for hedge sell auction (scaled 1e18)
    uint256 public minPriceMultiplier;
    /// @dev start auction price multiplier for hedge sell auction and reserve price for hedge buy auction (scaled 1e18)
    uint256 public maxPriceMultiplier;

    /// @dev timestamp when last hedge executed
    uint256 public timeAtLastHedge;
    /// @dev WSqueeth/Eth price when last hedge executed
    uint256 public priceAtLastHedge;

    /// @dev set to true when redeemShortShutdown has been called
    bool private hasRedeemedInShutdown;

    /// @dev store the current nonce for each address
    mapping(address => Counters.Counter) private _nonces;

    struct FlashDepositData {
        uint256 totalDeposit;
    }

    struct FlashWithdrawData {
        uint256 crabAmount;
    }

    struct FlashHedgeData {
        uint256 wSqueethAmount;
        uint256 ethProceeds;
        uint256 minWSqueeth;
        uint256 minEth;
    }

    struct Order {
        uint256 bidId;
        address trader;
        address traderToken;
        uint256 traderAmount;
        address managerToken;
        uint256 managerAmount;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    event Deposit(address indexed depositor, uint256 wSqueethAmount, uint256 lpAmount);
    event Withdraw(address indexed withdrawer, uint256 crabAmount, uint256 wSqueethAmount, uint256 ethWithdrawn);
    event WithdrawShutdown(address indexed withdrawer, uint256 crabAmount, uint256 ethWithdrawn);
    event FlashDeposit(address indexed depositor, uint256 depositedAmount, uint256 tradedAmountOut);
    event FlashWithdraw(address indexed withdrawer, uint256 crabAmount, uint256 wSqueethAmount);
    event FlashDepositCallback(address indexed depositor, uint256 flashswapDebt, uint256 excess);
    event FlashWithdrawCallback(address indexed withdrawer, uint256 flashswapDebt, uint256 excess);
    event HedgeOTC(address trader, uint256 managerAmount, uint256 traderAmount, uint256 sellerPrice);
    event SetStrategyCap(uint256 newCapAmount);
    event SetDeltaHedgeThreshold(uint256 newDeltaHedgeThreshold);
    event SetHedgingTwapPeriod(uint32 newHedgingTwapPeriod);
    event SetHedgeTimeThreshold(uint256 newHedgeTimeThreshold);
    event SetHedgePriceThreshold(uint256 newHedgePriceThreshold);
    event SetOTCPriceTolerance(uint256 otcPriceTolerance);
    event VaultTransferred(address indexed newStrategy, uint256 vaultId);

    modifier onlyTimelock() {
        require(msg.sender == timelock, "Caller is not timelock");
        _;
    }

    modifier afterInitialization() {
        require(isInitialized, "Contract not yet initialized");
        _;
    }

    /**
     * @notice strategy constructor
     * @dev this will open a vault in the power token contract and store the vault ID
     * @param _wSqueethController power token controller address
     * @param _oracle oracle address
     * @param _weth weth address
     * @param _uniswapFactory uniswap factory address
     * @param _ethWSqueethPool eth:wSqueeth uniswap pool address
     * @param _hedgeTimeThreshold hedge time threshold (seconds)
     * @param _hedgePriceThreshold hedge price threshold (0.1*1e18 = 10%)
     * @param _auctionTime auction duration (seconds)
     * @param _minPriceMultiplier minimum auction price multiplier (0.9*1e18 = min auction price is 90% of twap)
     * @param _maxPriceMultiplier maximum auction price multiplier (1.1*1e18 = max auction price is 110% of twap)
     */
    constructor(
        address _wSqueethController,
        address _oracle,
        address _weth,
        address _uniswapFactory,
        address _ethWSqueethPool,
        address _timelock,
        uint256 _hedgeTimeThreshold,
        uint256 _hedgePriceThreshold,
        uint256 _auctionTime,
        uint256 _minPriceMultiplier,
        uint256 _maxPriceMultiplier
    )
        StrategyBase(_wSqueethController, _weth, "Crab Strategy v2", "Crabv2")
        StrategyFlashSwap(_uniswapFactory)
        EIP712("CrabOTC", "2")
    {
        require(_oracle != address(0), "invalid oracle address");
        require(_timelock != address(0), "invalid timelock address");
        require(_ethWSqueethPool != address(0), "invalid ETH:WSqueeth address");
        require(_hedgeTimeThreshold > 0, "invalid hedge time threshold");
        require(_hedgePriceThreshold > 0, "invalid hedge price threshold");
        require(_auctionTime > 0, "invalid auction time");
        require(_minPriceMultiplier < 1e18, "min price multiplier too high");
        require(_minPriceMultiplier > 0, "invalid min price multiplier");
        require(_maxPriceMultiplier > 1e18, "max price multiplier too low");

        oracle = _oracle;
        ethWSqueethPool = _ethWSqueethPool;
        hedgeTimeThreshold = _hedgeTimeThreshold;
        hedgePriceThreshold = _hedgePriceThreshold;
        auctionTime = _auctionTime;
        minPriceMultiplier = _minPriceMultiplier;
        maxPriceMultiplier = _maxPriceMultiplier;
        ethQuoteCurrencyPool = IController(_wSqueethController).ethQuoteCurrencyPool();
        quoteCurrency = IController(_wSqueethController).quoteCurrency();
        timelock = _timelock;
    }

    /**
     * @notice receive function to allow ETH transfer to this contract
     */
    receive() external payable {
        require(msg.sender == weth || msg.sender == address(powerTokenController), "Cannot receive eth");
    }

    /**
     * @notice initializes the collateral ratio upon the first migration
     */
     function initialize(uint256 wSqueethToMint) external payable { 
        uint256 amount = msg.value;
        uint256 ethFee = 0; // TODO: does this need to change? 

        (uint256 strategyDebt, uint256 strategyCollateral) = _syncStrategyState();
        _checkStrategyCap(amount, strategyCollateral);

        uint256 depositorCrabAmount = _calcSharesToMint(amount.sub(ethFee), strategyCollateral, totalSupply());

        require((strategyDebt == 0 && strategyCollateral == 0), "C5");
        // store hedge data as strategy is delta neutral at this point
        // only execute this upon first deposit
        uint256 wSqueethEthPrice = IOracle(oracle).getTwap(
            ethWSqueethPool,
            wPowerPerp,
            weth,
            hedgingTwapPeriod,
            true
        );
        timeAtLastHedge = block.timestamp;
        priceAtLastHedge = wSqueethEthPrice;

        // mint wSqueeth and send it to msg.sender
        _mintWPowerPerp(msg.sender, wSqueethToMint, amount, false);
        // mint LP to depositor
        _mintStrategyToken(msg.sender, depositorCrabAmount);

         isInitialized = true;
     }

    /**
     * @notice Tranfer vault NFT to new contract
     * @dev strategy cap is set to 0 to avoid future deposits.
     */
    function transferVault(address _newStrategy) external onlyTimelock afterInitialization {
        IShortPowerPerp(powerTokenController.shortPowerPerp()).safeTransferFrom(address(this), _newStrategy, vaultId);
        _setStrategyCap(0);

        emit VaultTransferred(_newStrategy, vaultId);
    }

    /**
     * @notice owner can set the strategy cap in ETH collateral terms
     * @dev deposits are rejected if it would put the strategy above the cap amount
     * @dev strategy collateral can be above the cap amount due to hedging activities
     * @param _capAmount the maximum strategy collateral in ETH, checked on deposits
     */
    function setStrategyCap(uint256 _capAmount) external onlyOwner {
        _setStrategyCap(_capAmount);
    }

    /**
     * @notice set strategy cap amount
     * @dev deposits are rejected if it would put the strategy above the cap amount
     * @dev strategy collateral can be above the cap amount due to hedging activities
     * @param _capAmount the maximum strategy collateral in ETH, checked on deposits
     */
    function _setStrategyCap(uint256 _capAmount) internal {
        strategyCap = _capAmount;
        emit SetStrategyCap(_capAmount);
    }

    /**
     * @notice called to redeem the net value of a vault post shutdown
     * @dev needs to be called 1 time before users can exit the strategy using withdrawShutdown
     */
    function redeemShortShutdown() external afterInitialization {
        hasRedeemedInShutdown = true;
        powerTokenController.redeemShort(vaultId);
    }

    /**
     * @notice flash deposit into strategy, providing ETH, selling wSqueeth and receiving strategy tokens
     * @dev this function will execute a flash swap where it receives ETH, deposits and mints using flash swap proceeds and msg.value, and then repays the flash swap with wSqueeth
     * @dev _ethToDeposit must be less than msg.value plus the proceeds from the flash swap
     * @dev the difference between _ethToDeposit and msg.value provides the minimum that a user can receive for their sold wSqueeth
     * @param _ethToDeposit total ETH that will be deposited in to the strategy which is a combination of msg.value and flash swap proceeds
     */
    function flashDeposit(uint256 _ethToDeposit) external payable afterInitialization nonReentrant {
        (uint256 cachedStrategyDebt, uint256 cachedStrategyCollateral) = _syncStrategyState();
        _checkStrategyCap(_ethToDeposit, cachedStrategyCollateral);

        (uint256 wSqueethToMint, ) = _calcWsqueethToMintAndFee(
            _ethToDeposit,
            cachedStrategyDebt,
            cachedStrategyCollateral
        );

        _exactInFlashSwap(
            wPowerPerp,
            weth,
            IUniswapV3Pool(ethWSqueethPool).fee(),
            wSqueethToMint,
            _ethToDeposit.sub(msg.value),
            uint8(FLASH_SOURCE.FLASH_DEPOSIT),
            abi.encodePacked(_ethToDeposit)
        );

        emit FlashDeposit(msg.sender, _ethToDeposit, wSqueethToMint);
    }

    /**
     * @notice flash withdraw from strategy, providing strategy tokens, buying wSqueeth, burning and receiving ETH
     * @dev this function will execute a flash swap where it receives wSqueeth, burns, withdraws ETH and then repays the flash swap with ETH
     * @param _crabAmount strategy token amount to burn
     * @param _maxEthToPay maximum ETH to pay to buy back the owed wSqueeth debt
     */
    function flashWithdraw(uint256 _crabAmount, uint256 _maxEthToPay) external afterInitialization nonReentrant {
        uint256 exactWSqueethNeeded = _getDebtFromStrategyAmount(_crabAmount);

        _exactOutFlashSwap(
            weth,
            wPowerPerp,
            IUniswapV3Pool(ethWSqueethPool).fee(),
            exactWSqueethNeeded,
            _maxEthToPay,
            uint8(FLASH_SOURCE.FLASH_WITHDRAW),
            abi.encodePacked(_crabAmount)
        );

        emit FlashWithdraw(msg.sender, _crabAmount, exactWSqueethNeeded);
    }

    /**
     * @notice deposit ETH into strategy
     * @dev provide ETH, return wSqueeth and strategy token
     */
    function deposit() external payable afterInitialization nonReentrant {
        uint256 amount = msg.value;

        (uint256 wSqueethToMint, uint256 depositorCrabAmount) = _deposit(msg.sender, amount, false);

        emit Deposit(msg.sender, wSqueethToMint, depositorCrabAmount);
    }

    /**
     * @notice withdraw WETH from strategy
     * @dev provide strategy tokens and wSqueeth, returns eth
     * @param _crabAmount amount of strategy token to burn
     */
    function withdraw(uint256 _crabAmount) external afterInitialization nonReentrant {
        uint256 wSqueethAmount = _getDebtFromStrategyAmount(_crabAmount);
        uint256 ethToWithdraw = _withdraw(msg.sender, _crabAmount, wSqueethAmount, false);

        // send back ETH collateral
        payable(msg.sender).sendValue(ethToWithdraw);

        emit Withdraw(msg.sender, _crabAmount, wSqueethAmount, ethToWithdraw);
    }

    /**
     * @notice called to exit a vault if the Squeeth Power Perp contracts are shutdown
     * @param _crabAmount amount of strategy token to burn
     */
    function withdrawShutdown(uint256 _crabAmount) external afterInitialization nonReentrant {
        require(powerTokenController.isShutDown(), "Squeeth contracts not shut down");
        require(hasRedeemedInShutdown, "Crab must redeemShortShutdown");

        uint256 strategyShare = _calcCrabRatio(_crabAmount, totalSupply());
        uint256 ethToWithdraw = _calcEthToWithdraw(strategyShare, address(this).balance);
        _burn(msg.sender, _crabAmount);

        payable(msg.sender).sendValue(ethToWithdraw);
        emit WithdrawShutdown(msg.sender, _crabAmount, ethToWithdraw);
    }

    /**
     * @notice get wSqueeth debt amount associated with strategy token amount
     * @param _crabAmount strategy token amount
     * @return wSqueeth amount
     */
    function getWsqueethFromCrabAmount(uint256 _crabAmount) external view returns (uint256) {
        return _getDebtFromStrategyAmount(_crabAmount);
    }

    /**
     * @notice owner can set the delta hedge threshold as a percent scaled by 1e18 of ETH collateral
     * @dev the strategy will not allow a hedge if the trade size is below this threshold
     * @param _deltaHedgeThreshold minimum hedge size in a percent of ETH collateral
     */
    function setDeltaHedgeThreshold(uint256 _deltaHedgeThreshold) external onlyOwner {
        deltaHedgeThreshold = _deltaHedgeThreshold;

        emit SetDeltaHedgeThreshold(_deltaHedgeThreshold);
    }

    /**
     * @notice owner can set the twap period in seconds that is used for calculating twaps for hedging
     * @param _hedgingTwapPeriod the twap period, in seconds
     */
    function setHedgingTwapPeriod(uint32 _hedgingTwapPeriod) external onlyOwner {
        require(_hedgingTwapPeriod >= 180, "twap period is too short");

        hedgingTwapPeriod = _hedgingTwapPeriod;

        emit SetHedgingTwapPeriod(_hedgingTwapPeriod);
    }

    /**
     * @notice owner can set the hedge time threshold in seconds that determines how often the strategy can be hedged
     * @param _hedgeTimeThreshold the hedge time threshold, in seconds
     */
    function setHedgeTimeThreshold(uint256 _hedgeTimeThreshold) external onlyOwner {
        require(_hedgeTimeThreshold > 0, "invalid hedge time threshold");

        hedgeTimeThreshold = _hedgeTimeThreshold;

        emit SetHedgeTimeThreshold(_hedgeTimeThreshold);
    }

    /**
     * @notice owner can set the hedge time threshold in percent, scaled by 1e18 that determines the deviation in wPowerPerp price that can trigger a rebalance
     * @param _hedgePriceThreshold the hedge price threshold, in percent, scaled by 1e18
     */
    function setHedgePriceThreshold(uint256 _hedgePriceThreshold) external onlyOwner {
        require(_hedgePriceThreshold > 0, "invalid hedge price threshold");

        hedgePriceThreshold = _hedgePriceThreshold;

        emit SetHedgePriceThreshold(_hedgePriceThreshold);
    }

    /**
     * @notice owner can set a threshold, scaled by 1e18 that determines the maximum discount of a clearing sale price to the current uniswap twap price
     * @param _otcPriceTolerance the OTC price tolerance, in percent, scaled by 1e18
     */
    function setOTCPriceTolerance(uint256 _otcPriceTolerance) external onlyOwner {
        // Tolerance cannot be more than 20%
        require(_otcPriceTolerance <= 2e17, "price tolerance is too high");

        otcPriceTolerance = _otcPriceTolerance;

        emit SetOTCPriceTolerance(_otcPriceTolerance);
    }

    /**
     * @notice check if a user deposit puts the strategy above the cap
     * @dev reverts if a deposit amount puts strategy over the cap
     * @dev it is possible for the strategy to be over the cap from trading/hedging activities, but withdrawals are still allowed
     * @param _depositAmount the user deposit amount in ETH
     * @param _strategyCollateral the updated strategy collateral
     */
    function _checkStrategyCap(uint256 _depositAmount, uint256 _strategyCollateral) internal view {
        require(_strategyCollateral.add(_depositAmount) <= strategyCap, "Deposit exceeds strategy cap");
    }

    /**
     * @notice uniswap flash swap callback function
     * @dev this function will be called by flashswap callback function uniswapV3SwapCallback()
     * @param _caller address of original function caller
     * @param _amountToPay amount to pay back for flashswap
     * @param _callData arbitrary data attached to callback
     * @param _callSource identifier for which function triggered callback
     */
    function _strategyFlash(
        address _caller,
        address, /*_tokenIn*/
        address, /*_tokenOut*/
        uint24, /*_fee*/
        uint256 _amountToPay,
        bytes memory _callData,
        uint8 _callSource
    ) internal override {
        if (FLASH_SOURCE(_callSource) == FLASH_SOURCE.FLASH_DEPOSIT) {
            FlashDepositData memory data = abi.decode(_callData, (FlashDepositData));

            // convert WETH to ETH as Uniswap uses WETH
            IWETH9(weth).withdraw(IWETH9(weth).balanceOf(address(this)));

            //use user msg.value and unwrapped WETH from uniswap flash swap proceeds to deposit into strategy
            //will revert if data.totalDeposit is > eth balance in contract
            _deposit(_caller, data.totalDeposit, true);

            //repay the flash swap
            IWPowerPerp(wPowerPerp).transfer(ethWSqueethPool, _amountToPay);

            emit FlashDepositCallback(_caller, _amountToPay, address(this).balance);

            //return excess eth to the user that was not needed for slippage
            if (address(this).balance > 0) {
                payable(_caller).sendValue(address(this).balance);
            }
        } else if (FLASH_SOURCE(_callSource) == FLASH_SOURCE.FLASH_WITHDRAW) {
            FlashWithdrawData memory data = abi.decode(_callData, (FlashWithdrawData));

            //use flash swap wSqueeth proceeds to withdraw ETH along with user crabAmount
            uint256 ethToWithdraw = _withdraw(
                _caller,
                data.crabAmount,
                IWPowerPerp(wPowerPerp).balanceOf(address(this)),
                true
            );

            //use some amount of withdrawn ETH to repay flash swap
            IWETH9(weth).deposit{value: _amountToPay}();
            IWETH9(weth).transfer(ethWSqueethPool, _amountToPay);

            //excess ETH not used to repay flash swap is transferred to the user
            uint256 proceeds = ethToWithdraw.sub(_amountToPay);

            emit FlashWithdrawCallback(_caller, _amountToPay, proceeds);

            if (proceeds > 0) {
                payable(_caller).sendValue(proceeds);
            }
        }
    }

    /**
     * @notice deposit into strategy
     * @dev if _isFlashDeposit is true, keeps wSqueeth in contract, otherwise sends to user
     * @param _depositor depositor address
     * @param _amount amount of ETH collateral to deposit
     * @param _isFlashDeposit true if called by flashDeposit
     * @return wSqueethToMint minted amount of WSqueeth
     * @return depositorCrabAmount minted CRAB strategy token amount
     */
    function _deposit(
        address _depositor,
        uint256 _amount,
        bool _isFlashDeposit
    ) internal returns (uint256, uint256) {
        (uint256 strategyDebt, uint256 strategyCollateral) = _syncStrategyState();
        _checkStrategyCap(_amount, strategyCollateral);

        (uint256 wSqueethToMint, uint256 ethFee) = _calcWsqueethToMintAndFee(_amount, strategyDebt, strategyCollateral);

        uint256 depositorCrabAmount = _calcSharesToMint(_amount.sub(ethFee), strategyCollateral, totalSupply());

        // mint wSqueeth and send it to msg.sender
        _mintWPowerPerp(_depositor, wSqueethToMint, _amount, _isFlashDeposit);
        // mint LP to depositor
        _mintStrategyToken(_depositor, depositorCrabAmount);

        return (wSqueethToMint, depositorCrabAmount);
    }

    /**
     * @notice withdraw WETH from strategy
     * @dev if _isFlashDeposit is true, keeps wSqueeth in contract, otherwise sends to user
     * @param _crabAmount amount of strategy token to burn
     * @param _wSqueethAmount amount of wSqueeth to burn
     * @param _isFlashWithdraw flag if called by flashWithdraw
     * @return ETH amount to withdraw
     */
    function _withdraw(
        address _from,
        uint256 _crabAmount,
        uint256 _wSqueethAmount,
        bool _isFlashWithdraw
    ) internal returns (uint256) {
        (, uint256 strategyCollateral) = _syncStrategyState();

        uint256 strategyShare = _calcCrabRatio(_crabAmount, totalSupply());
        uint256 ethToWithdraw = _calcEthToWithdraw(strategyShare, strategyCollateral);

        _burnWPowerPerp(_from, _wSqueethAmount, ethToWithdraw, _isFlashWithdraw);
        _burn(_from, _crabAmount);

        return ethToWithdraw;
    }

    /**
     * @dev increment current nonce of the address
     * @param owner address of signer
     * @return current the current nonce of the address
     */
    function _useNonce(address owner) internal returns (uint256 current) {
        Counters.Counter storage nonce = _nonces[owner];
        current = nonce.current();
        nonce.increment();
    }

    /**
     * @dev get current nonce of the address
     * @param owner address of signer
     * @return current the current nonce of the address
     */
    function nonces(address owner) external view returns (uint256) {
        return _nonces[owner].current();
    }

    /**
     * @dev view function to get the domain seperator used in signing
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @dev check the signer and swap tokens in the order
     * @param managerSellAmount quantity the manager wants to sell
     * @param managerBuyPrice the price at which the manager is buying
     * @param _order a signed order to swap tokens
     */
    function _execOrder(
        uint256 managerSellAmount,
        uint256 managerBuyPrice,
        uint256 sellerPrice,
        Order memory _order
    ) internal {
        require(managerBuyPrice >= sellerPrice, "Manager Buy Price should be atleast Seller Price");
        bytes32 structHash = keccak256(
            abi.encode(
                _CRAB_BALANCE_TYPEHASH,
                _order.bidId,
                _order.trader,
                _order.traderToken,
                _order.traderAmount,
                _order.managerToken,
                _order.managerAmount,
                _useNonce(_order.trader)
            )
        );

        bytes32 hash = _hashTypedDataV4(structHash);
        address offerSigner = ECDSA.recover(hash, _order.v, _order.r, _order.s);
        require(offerSigner == _order.trader, "Invalid offer signature");

        //adjust managerAmount and TraderAmount for partial fills
        if (managerSellAmount < _order.managerAmount) {
            _order.managerAmount = managerSellAmount;
        }
        //adjust if manager is giving better price
        _order.traderAmount = _order.managerAmount.mul(1e18).div(managerBuyPrice);

        IERC20(_order.traderToken).transferFrom(_order.trader, address(this), _order.traderAmount);

        // if the trader is selling WETH to us i.e if we are selling oSQTH
        if (_order.traderToken == weth) {
            IWETH9(weth).withdraw(IWETH9(weth).balanceOf(address(this)));
            // if last param is false, transfer happens again
            _mintWPowerPerp(_order.trader, _order.managerAmount, _order.traderAmount, true);
            priceAtLastHedge = _order.traderAmount.mul(1e18).div(_order.managerAmount);
        } else {
            // oSQTH in, WETH out
            _burnWPowerPerp(_order.trader, _order.traderAmount, _order.managerAmount, true);
            //wrap it
            IWETH9(weth).deposit{value: _order.managerAmount}();
            // if last param is false, transfer happens again
            priceAtLastHedge = _order.managerAmount.mul(1e18).div(_order.traderAmount);
        }

        IERC20(_order.managerToken).transfer(_order.trader, _order.managerAmount);

        emit HedgeOTC(
            _order.trader, // market maker
            _order.managerAmount, // token out
            _order.traderAmount, // token in
            sellerPrice
        );
    }

    /**
     * @dev hedge function to reduce delta using an array of signed orders
     * @param managerSellAmount quantity the manager wants to sell
     * @param managerBuyPrice the price at which the manager is buying
     * @param _orders an array of signed order to swap tokens
     */
    function hedgeOTC(
        uint256 managerSellAmount,
        uint256 managerBuyPrice,
        Order[] memory _orders
    ) external onlyOwner {
        require(managerBuyPrice > 0, "Manager Price should be greater than 0");
        require(_isTimeHedge() || _isPriceHedge(), "Time or Price is not within range");
        _checkOTCPrice(managerBuyPrice, _orders[0].managerToken);

        timeAtLastHedge = block.timestamp;

        uint256 remainingAmount = managerSellAmount;
        uint256 prevPrice = 0;
        uint256 currentPrice = 0;
        bytes memory tradePair;
        bytes memory prevTradePair;
        for (uint256 i = 0; i < _orders.length; i++) {
            tradePair = abi.encode(_orders[i].traderToken, _orders[i].managerToken);
            currentPrice = _orders[i].managerAmount.mul(1e18).div(_orders[i].traderAmount);
            require(currentPrice >= prevPrice, "Orders are not arranged properly");
            if (i > 0) {
                require(
                    keccak256(tradePair) == keccak256(prevTradePair),
                    "All orders must have the same buy/sell token."
                );
            }
            prevPrice = currentPrice;
            prevTradePair = tradePair;

            if (remainingAmount > _orders[i].managerAmount) {
                _execOrder(remainingAmount, managerBuyPrice, currentPrice, _orders[i]);
                remainingAmount = remainingAmount.sub(_orders[i].managerAmount);
            } else {
                _execOrder(remainingAmount, managerBuyPrice, currentPrice, _orders[i]);
                break;
            }
        }
    }

    /**
     * @notice check that the proposed sale price is within a tolerance of the current Uniswap twap
     * @param price clearing price provided by manager
     * @param tokenToSell token to be sold
     */
    function _checkOTCPrice(uint256 price, address tokenToSell) internal view {
        // Get twap
        uint256 wSqueethEthPrice = IOracle(oracle).getTwap(ethWSqueethPool, wPowerPerp, weth, hedgingTwapPeriod, true);
        // invert price if we are selling wPowerPerp
        uint256 twapPrice = (tokenToSell == wPowerPerp) ? ONE_ONE.div(wSqueethEthPrice) : wSqueethEthPrice;

        uint256 priceLower = twapPrice.mul((ONE.sub(otcPriceTolerance))).div(ONE);
        // Check that clearing sale price is at least twap*(1 - otcPriceTolerance%)
        require(price >= priceLower, "Price too low relative to Uniswap twap.");
    }

    /**
     * @notice sync strategy debt and collateral amount from vault
     * @return synced debt amount
     * @return synced collateral amount
     */
    function _syncStrategyState() internal view returns (uint256, uint256) {
        (, , uint256 syncedStrategyCollateral, uint256 syncedStrategyDebt) = _getVaultDetails();

        return (syncedStrategyDebt, syncedStrategyCollateral);
    }

    /**
     * @notice calculate the fee adjustment factor, which is the amount of ETH owed per 1 wSqueeth minted
     * @dev the fee is a based off the index value of squeeth and uses a twap scaled down by the PowerPerp's INDEX_SCALE
     * @return the fee adjustment factor
     */
    function _calcFeeAdjustment() internal view returns (uint256) {
        uint256 wSqueethEthPrice = Power2Base._getTwap(
            oracle,
            ethWSqueethPool,
            wPowerPerp,
            weth,
            POWER_PERP_PERIOD,
            false
        );
        uint256 feeRate = IController(powerTokenController).feeRate();
        return wSqueethEthPrice.mul(feeRate).div(10000);
    }

    /**
     * @notice calculate amount of wSqueeth to mint and fee paid from deposited amount
     * @param _depositedAmount amount of deposited WETH
     * @param _strategyDebtAmount amount of strategy debt
     * @param _strategyCollateralAmount collateral amount in strategy
     * @return amount of minted wSqueeth and ETH fee paid on minted squeeth
     */
    function _calcWsqueethToMintAndFee(
        uint256 _depositedAmount,
        uint256 _strategyDebtAmount,
        uint256 _strategyCollateralAmount
    ) internal view returns (uint256, uint256) {
        uint256 wSqueethToMint;
        uint256 feeAdjustment = _calcFeeAdjustment();

        wSqueethToMint = _depositedAmount.wmul(_strategyDebtAmount).wdiv(
            _strategyCollateralAmount.add(_strategyDebtAmount.wmul(feeAdjustment))
        );
        uint256 fee = wSqueethToMint.wmul(feeAdjustment);

        return (wSqueethToMint, fee);
    }

    /**
     * @notice check if hedging based on time threshold is allowed
     * @return true if time hedging is allowed
     */
    function _isTimeHedge() internal view returns (bool) {
        return (block.timestamp >= timeAtLastHedge.add(hedgeTimeThreshold));
    }

    /**
     * @notice check if hedging based on price threshold is allowed
     * @return true if hedging is allowed
     */
    function _isPriceHedge() internal view returns (bool) {
        uint256 wSqueethEthPrice = IOracle(oracle).getTwap(ethWSqueethPool, wPowerPerp, weth, hedgingTwapPeriod, true);
        uint256 cachedRatio = wSqueethEthPrice.wdiv(priceAtLastHedge);
        uint256 priceThreshold = cachedRatio > 1e18 ? (cachedRatio).sub(1e18) : uint256(1e18).sub(cachedRatio);

        return priceThreshold >= hedgePriceThreshold;
    }

    /**
     * @dev calculate amount of strategy token to mint for depositor
     * @param _amount amount of ETH deposited
     * @param _strategyCollateralAmount amount of strategy collateral
     * @param _crabTotalSupply total supply of strategy token
     * @return amount of strategy token to mint
     */
    function _calcSharesToMint(
        uint256 _amount,
        uint256 _strategyCollateralAmount,
        uint256 _crabTotalSupply
    ) internal pure returns (uint256) {
        uint256 depositorShare = _amount.wdiv(_strategyCollateralAmount.add(_amount));

        if (_crabTotalSupply != 0) return _crabTotalSupply.wmul(depositorShare).wdiv(uint256(1e18).sub(depositorShare));

        return _amount;
    }

    /**
     * @notice calculates the ownership proportion for strategy debt and collateral relative to a total amount of strategy tokens
     * @param _crabAmount strategy token amount
     * @param _totalSupply strategy total supply
     * @return ownership proportion of a strategy token amount relative to the total strategy tokens
     */
    function _calcCrabRatio(uint256 _crabAmount, uint256 _totalSupply) internal pure returns (uint256) {
        return _crabAmount.wdiv(_totalSupply);
    }

    /**
     * @notice calculate ETH to withdraw from strategy given a ownership proportion
     * @param _crabRatio crab ratio
     * @param _strategyCollateralAmount amount of collateral in strategy
     * @return amount of ETH allowed to withdraw
     */
    function _calcEthToWithdraw(uint256 _crabRatio, uint256 _strategyCollateralAmount) internal pure returns (uint256) {
        return _strategyCollateralAmount.wmul(_crabRatio);
    }
}
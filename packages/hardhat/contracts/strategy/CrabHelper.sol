//SPDX-License-Identifier: BUSL-1.1

pragma solidity =0.7.6;
pragma abicoder v2;

import {ICrabStrategyV2} from "../interfaces/ICrabStrategyV2.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOracle} from "../interfaces/IOracle.sol";

import {EIP712} from "@openzeppelin/contracts/drafts/EIP712.sol";

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {StrategySwap} from "./helper/StrategySwap.sol";
// StrategyMath licensed under AGPL-3.0-only
import {StrategyMath} from "./base/StrategyMath.sol";
import {ECDSA} from "@openzeppelin/contracts/cryptography/ECDSA.sol";

/**
 * @dev CrabHelper contract
 * @notice Contract for Crab helper functions
 * @author Opyn team
 */
contract CrabHelper is StrategySwap, ReentrancyGuard, EIP712 {
    using Address for address payable;
    using StrategyMath for uint256;

    address public immutable crab;
    address public immutable weth;
    address public immutable wPowerPerp;
    address public immutable ethWSqueethPool;
    address public immutable oracle;

    /// @dev typehash for signed orders
    bytes32 private constant _CRAB_ORDER_TYPEHASH =
        keccak256(
            "Order(uint256 bidId,address trader,uint256 quantity,uint256 price,bool isBuying,uint256 expiry,uint256 nonce)"
        );

    struct Order {
        uint256 bidId;
        address trader;
        uint256 quantity;
        uint256 price;
        bool isBuying;
        uint256 expiry;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
        
    struct OrderCheck {
        bool isValidNonce;
        bool isValidSignature;
        bool isNotExpired;
        bool isSufficientBalance;
        bool isSufficientAllowance;
    }

    event FlashDepositERC20(
        address indexed depositor,
        address depositedERC20,
        uint256 depositedAmount,
        uint256 depositedEthAmount,
        uint256 crabAmount,
        uint256 returnedEth
    );

    event FlashWithdrawERC20(
        address indexed withdrawer,
        address withdrawnERC20,
        uint256 withdrawnAmount,
        uint256 withdrawnEthAmount,
        uint256 crabAmount
    );

    /**
     * @notice constructor
     * @param _crab address of crabV2 contract
     * @param _swapRouter address of Uniswap swap router
     */
    constructor(address _crab, address _swapRouter) StrategySwap(_swapRouter) EIP712("CrabOTC", "2") {
        require(_crab != address(0), "Invalid crab address");

        crab = _crab;
        weth = ICrabStrategyV2(_crab).weth();
        wPowerPerp = ICrabStrategyV2(_crab).wPowerPerp();
        ethWSqueethPool = ICrabStrategyV2(_crab).ethWSqueethPool();
        oracle = ICrabStrategyV2(_crab).oracle();
    }

    /**
     * @notice allows user to flash deposit into crab from an aribtrary ERC20
     * @param _ethToDeposit amount of ETH to deposit
     * @param _amountIn amount of ERC20 token to swap for weth
     * @param _minEthToGet min amount of ETH to receive in the swap
     * @param _erc20Fee pool fee for transfer ERC20/eth pool (3000 = 30bps)
     * @param _wPowerPerpFee pool fee for wPowerPerp/eth pool (3000 = 30bps)
     * @param _tokenIn ERC20 token to pay
     */
    function flashDepositERC20(
        uint256 _ethToDeposit,
        uint256 _amountIn,
        uint256 _minEthToGet,
        uint24 _erc20Fee,
        uint24 _wPowerPerpFee,
        address _tokenIn
    ) external nonReentrant {
        _swapExactInputSingle(_tokenIn, weth, msg.sender, address(this), _amountIn, _minEthToGet, _erc20Fee);

        IWETH9(weth).withdraw(IWETH9(weth).balanceOf(address(this)));
        ICrabStrategyV2(crab).flashDeposit{value: address(this).balance}(_ethToDeposit, _wPowerPerpFee);

        uint256 crabAmount = IERC20(crab).balanceOf(address(this));

        emit FlashDepositERC20(msg.sender, _tokenIn, _amountIn, _ethToDeposit, crabAmount, address(this).balance);

        IERC20(crab).transfer(msg.sender, crabAmount);

        if (address(this).balance > 0) {
            payable(msg.sender).sendValue(address(this).balance);
        }
    }

    /**
     * @notice allows user to flash withdraw from crab to an aribtrary ERC20
     * @param _crabAmount amount of crab shares to withdraw
     * @param _maxEthToPay max eth to pay in swap for wPowerPerp
     * @param _tokenOut ERC20 token to receive
     * @param _minAmountOut min amount of ERC20 to receive
     * @param _erc20Fee pool fee for transfer ERC20/eth pool (3000 = 30bps)
     * @param _wPowerPerpFee pool fee for wPowerPerp/eth pool (3000 = 30bps)
     */
    function flashWithdrawERC20(
        uint256 _crabAmount,
        uint256 _maxEthToPay,
        address _tokenOut,
        uint256 _minAmountOut,
        uint24 _erc20Fee,
        uint24 _wPowerPerpFee
    ) external nonReentrant {
        IERC20(crab).transferFrom(msg.sender, address(this), _crabAmount);

        ICrabStrategyV2(crab).flashWithdraw(_crabAmount, _maxEthToPay, _wPowerPerpFee);

        uint256 ethBalance = address(this).balance;
        IWETH9(weth).deposit{value: ethBalance}();
        uint256 tokenReceived = _swapExactInputSingle(
            weth,
            _tokenOut,
            address(this),
            msg.sender,
            ethBalance,
            _minAmountOut,
            _erc20Fee
        );

        emit FlashWithdrawERC20(msg.sender, _tokenOut, tokenReceived, ethBalance, _crabAmount);
    }

    /**
     * @notice view function to verify an order
     * @param _order crab otc hedge order
     * @return OrderCheck 
     */
    function verifyOrder(Order memory _order) external view returns (OrderCheck memory) {
        bool isSufficientBalance;
        bool isSufficientAllowance;

        // check that nonce has not been used
        bool isValidNonce = ICrabStrategyV2(crab).nonces(_order.trader, _order.nonce) == false;

        // extract signer
        bytes32 structHash = keccak256(
            abi.encode(
                _CRAB_ORDER_TYPEHASH,
                _order.bidId,
                _order.trader,
                _order.quantity,
                _order.price,
                _order.isBuying,
                _order.expiry,
                _order.nonce
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address offerSigner = ECDSA.recover(hash, _order.v, _order.r, _order.s);

        // check signer and expiry
        bool isValidSignature = offerSigner == _order.trader;
        bool isNotExpired = _order.expiry >= block.timestamp;

        // weth price for the order
        uint256 wethAmount = _order.quantity.mul(_order.price).div(1e18);

        if (_order.isBuying) {
            // check weth balance and allowance
            isSufficientBalance = IWETH9(weth).balanceOf(_order.trader) >= wethAmount;
            isSufficientAllowance = IWETH9(weth).allowance(_order.trader, address(this)) >= wethAmount;
        } else {
            // check wPowerPerp balance and allowance
            isSufficientBalance = IWETH9(wPowerPerp).balanceOf(_order.trader) >= _order.quantity;
            isSufficientAllowance = IWETH9(wPowerPerp).allowance(_order.trader, address(this)) >= _order.quantity;
        }
        // pack order checks
        OrderCheck memory orderCheck;
        orderCheck.isValidNonce = isValidNonce;
        orderCheck.isValidSignature = isValidSignature;
        orderCheck.isNotExpired = isNotExpired;
        orderCheck.isSufficientBalance = isSufficientBalance;
        orderCheck.isSufficientAllowance = isSufficientAllowance;
        return orderCheck;
    }

    /**
     * @notice view function for hedge size based on current state
     * @return hedge amount, isSellingSqueeth
     */
    function getHedgeSize() external view returns (uint256, bool) {
        // Get state and calculate hedge
        (, , uint256 ethDelta, uint256 strategyDebt) = ICrabStrategyV2(crab).getVaultDetails();
        uint256 wSqueethEthPrice = IOracle(oracle).getTwap(ethWSqueethPool, wPowerPerp, weth, ICrabStrategyV2(crab).hedgingTwapPeriod(), true);
        uint256 wSqueethDelta = strategyDebt.wmul(2e18).wmul(wSqueethEthPrice);

        return
            (wSqueethDelta > ethDelta)
                ? ((wSqueethDelta.sub(ethDelta)).wdiv(wSqueethEthPrice), false)
                : ((ethDelta.sub(wSqueethDelta)).wdiv(wSqueethEthPrice), true);
    }

    /**
     * @notice receive function to allow ETH transfer to this contract
     */
    receive() external payable {
        require(msg.sender == weth || msg.sender == crab, "Cannot receive eth");
    }
}

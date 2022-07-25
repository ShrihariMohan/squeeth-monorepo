import { Pool } from "../generated/schema";
import { CRAB_STRATEGY_ADDR, USDC_WETH_POOL } from "./addresses";
import {
  BIGDECIMAL_ZERO,
  TOKEN_DECIMALS_18,
  TOKEN_DECIMALS_USDC,
} from "./constants";
import {
  convertTokenToDecimal,
  createTransactionHistory,
  loadOrCreateAccount,
  sqrtPriceX96ToTokenPrices,
  sqthChange,
} from "./util";
import { Swap as USDCSwapEvent, Initialize } from "../generated/USDCPool/Pool";
import { Swap as OSQTHSwapEvent } from "../generated/OSQTHPool/Pool";
import { Address, log } from "@graphprotocol/graph-ts";

export function handleInitialize(event: Initialize): void {
  // update pool sqrt price
  let pool = new Pool(event.address.toHexString());

  pool.sqrtPrice = event.params.sqrtPriceX96;
  pool.createdAtTimestamp = event.block.timestamp;
  let token0_decimals = TOKEN_DECIMALS_18;
  let token1_decimals = TOKEN_DECIMALS_18;
  if (event.address.toHexString().toLowerCase() == USDC_WETH_POOL) {
    token0_decimals = TOKEN_DECIMALS_USDC;
  }
  let prices = sqrtPriceX96ToTokenPrices(
    pool.sqrtPrice,
    token0_decimals,
    token1_decimals
  );

  pool.token0Price = prices[0];
  pool.token1Price = prices[1];
  pool.save();
}

export function handleOSQTHSwap(event: OSQTHSwapEvent): void {
  let osqthPool = Pool.load(event.address.toHexString());
  if (osqthPool == null) {
    return;
  }

  if (event.params.recipient.toHex() === "0x76a7ae64725bdab99a51681872c16f0e641301f3") {
    log.error("Recipient", [event.params.recipient.toHex()])
  }
  if (event.params.sender.toHex() === "0x76a7ae64725bdab99a51681872c16f0e641301f3") {
    log.error("Sender", [event.params.sender.toHex()])
  }

  // const account = loadOrCreateAccount(event.params.recipient.toHex());
  let amount0 = convertTokenToDecimal(event.params.amount0, TOKEN_DECIMALS_18);
  let amount1 = convertTokenToDecimal(event.params.amount1, TOKEN_DECIMALS_18);
  if (amount0.gt(BIGDECIMAL_ZERO)) {
    let transactionHistory = createTransactionHistory("SELL_OSQTH", event)
    transactionHistory.sqthAmount = amount0;
    transactionHistory.ethAmount = amount1;
    transactionHistory.save();
  } else {
    let transactionHistory = createTransactionHistory("BUY_OSQTH", event)
    transactionHistory.sqthAmount = amount0.neg();
    transactionHistory.ethAmount = amount1.neg();
    transactionHistory.save();
  }
  // sqthChange(event.params.recipient.toHex(), amount0.neg());
  // account.save();  

  // token0 osqth
  // token1 weth
  // token0 per token1
  osqthPool.sqrtPrice = event.params.sqrtPriceX96;
  const osqthPrices = sqrtPriceX96ToTokenPrices(
    osqthPool.sqrtPrice,
    TOKEN_DECIMALS_18,
    TOKEN_DECIMALS_18
  );

  osqthPool.token0Price = osqthPrices[0];
  osqthPool.token1Price = osqthPrices[1];
  osqthPool.save();
}

export function handleUSDCSwap(event: USDCSwapEvent): void {
  // token0 osqth
  // token1 weth
  // token0 per token1
  let pool = Pool.load(event.address.toHexString());
  if (pool == null) {
    return;
  }
  pool.sqrtPrice = event.params.sqrtPriceX96;

  let prices = sqrtPriceX96ToTokenPrices(
    pool.sqrtPrice,
    TOKEN_DECIMALS_USDC,
    TOKEN_DECIMALS_18
  );
  pool.token0Price = prices[0];
  pool.token1Price = prices[1];
  pool.save();
}

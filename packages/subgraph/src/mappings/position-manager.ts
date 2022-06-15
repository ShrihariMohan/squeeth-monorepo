/* eslint-disable prefer-const */
import {
  Collect,
  DecreaseLiquidity,
  IncreaseLiquidity,
  NonfungiblePositionManager,
} from "../../generated/NonfungiblePositionManager/NonfungiblePositionManager";
import { LPPosition, Position, Vault } from "../../generated/schema";
import {
  ONE_BD,
  ONE_BI,
  OSQTH_TOKEN_ADDR,
  TOKEN_DECIMALS_18,
  WETH_TOKEN_ADDR,
  ZERO_BD,
  ZERO_BI,
} from "../constants";
import {
  initLPPosition,
  createTransactionHistory,
  loadOrCreateAccount,
  buyOrSellLPSQTH,
  buyOrSellLPETH,
  loadOrCreatePosition,
  buyOrSellETH,
  buyOrSellSQTH,
} from "../util";
import { convertTokenToDecimal } from "../utils";
import { Address, BigInt, log } from "@graphprotocol/graph-ts";

function updateLPposition(
  userAddr: string,
  eventAmount0: BigInt,
  eventAmount1: BigInt
): void {
  const amount0 = convertTokenToDecimal(eventAmount0, TOKEN_DECIMALS_18);
  const amount1 = convertTokenToDecimal(eventAmount1, TOKEN_DECIMALS_18);

  buyOrSellLPSQTH(userAddr, amount0);
  buyOrSellLPETH(userAddr, amount1);
}

function isOSQTHETHPool(address: Address, tokenId: BigInt): boolean {
  let contract = NonfungiblePositionManager.bind(address);
  let positionCall = contract.try_positions(tokenId);
  if (!positionCall.reverted) {
    let positionResult = positionCall.value;
    if (
      positionResult.value2.toHexString().toLowerCase() == OSQTH_TOKEN_ADDR &&
      positionResult.value3.toHexString().toLowerCase() == WETH_TOKEN_ADDR
    ) {
      return true;
    }
  }

  return false;
}
// selling to remove lp
export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
  const isOSQTHNETHPool = isOSQTHETHPool(event.address, event.params.tokenId);
  if (!isOSQTHNETHPool) return;
  const transactionHistory = createTransactionHistory("ADD_LIQUIDITY", event);
  transactionHistory.oSqthAmount = event.params.amount0;
  transactionHistory.ethAmount = event.params.amount1;
  transactionHistory.save();

  const userAddr = event.transaction.from.toHex();
  updateLPposition(userAddr, event.params.amount0, event.params.amount1);

  const amount0 = convertTokenToDecimal(
    event.params.amount0,
    TOKEN_DECIMALS_18
  );
  const amount1 = convertTokenToDecimal(
    event.params.amount1,
    TOKEN_DECIMALS_18
  );

  // const longPosition = Position.load(userAddr);
  // // const longPosition = Vault.load(userAddr);
  // buyOrSellSQTH(userAddr, amount0);
  // buyOrSellETH(userAddr, amount1);

  const position = loadOrCreatePosition(userAddr);
  const account = loadOrCreateAccount(userAddr);
  // // if long & lp, selling osqth and eth for lp
  if (position.currentOSQTHAmount.gt(account.accShortAmount.toBigDecimal())) {
    buyOrSellSQTH(userAddr, amount0.times(ZERO_BD.minus(ONE_BD)));
    buyOrSellETH(userAddr, amount1.times(ZERO_BD.minus(ONE_BD)));
  }
}

// buying to remove lp
export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
  const isOSQTHNETHPool = isOSQTHETHPool(event.address, event.params.tokenId);
  if (!isOSQTHNETHPool) return;
  const transactionHistory = createTransactionHistory(
    "REMOVE_LIQUIDITY",
    event
  );
  transactionHistory.oSqthAmount = event.params.amount0;
  transactionHistory.ethAmount = event.params.amount1;
  transactionHistory.save();

  let userAddr = event.transaction.from.toHex();
  updateLPposition(
    userAddr,
    event.params.amount0.times(ZERO_BI.minus(ONE_BI)),
    event.params.amount1.times(ZERO_BI.minus(ONE_BI))
  );
  const amount0 = convertTokenToDecimal(
    event.params.amount0.times(ZERO_BI.minus(ONE_BI)),
    TOKEN_DECIMALS_18
  );

  const amount1 = convertTokenToDecimal(
    event.params.amount1,
    TOKEN_DECIMALS_18
  );

  const position = loadOrCreatePosition(userAddr);
  const account = loadOrCreateAccount(userAddr);
  // if long & lp, buying back osqth and eth for removing lp token
  if (position.currentOSQTHAmount.gt(account.accShortAmount.toBigDecimal())) {
    buyOrSellSQTH(userAddr, amount0);
    buyOrSellETH(userAddr, amount1);
  }
}

export function handleCollect(event: Collect): void {
  const isOSQTHNETHPool = isOSQTHETHPool(event.address, event.params.tokenId);
  if (!isOSQTHNETHPool) return;
  const transactionHistory = createTransactionHistory("COLLECT_FEE", event);
  transactionHistory.oSqthAmount = event.params.amount0;
  transactionHistory.ethAmount = event.params.amount1;
  transactionHistory.save();

  let userAddr = event.transaction.from.toHex();
  updateLPposition(userAddr, event.params.amount0, event.params.amount1);
}
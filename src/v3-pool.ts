import {
  Initialize,
  Swap,
  Mint,
  Burn,
} from "../generated/templates/UniswapV3Pool/UniswapV3Pool";
import { Pool, Swap as SwapEntity, LiquidityEvent } from "../generated/schema";
import { getDecimals } from "./utils/token-meta";
import { sqrtPriceX96ToTokenPrices } from "./utils/pricing";
import { getOrCreatePoolDayData } from "./utils/day-data";
import { getOrCreateProtocol } from "./utils/protocol";
import { bytesFromAddress, ONE_BI, convertTokenToDecimal } from "./utils/constants";
import { Address, BigInt } from "@graphprotocol/graph-ts";

export function handleInitialize(event: Initialize): void {
  let pool = Pool.load(bytesFromAddress(event.address));
  if (pool == null) return;

  pool.sqrtPriceX96 = event.params.sqrtPriceX96;
  pool.tick = event.params.tick;

  let token0Decimals = getDecimals(Address.fromBytes(pool.token0));
  let token1Decimals = getDecimals(Address.fromBytes(pool.token1));
  let prices = sqrtPriceX96ToTokenPrices(event.params.sqrtPriceX96, token0Decimals, token1Decimals);
  pool.token0Price = prices[0];
  pool.token1Price = prices[1];

  pool.save();
}

export function handleSwap(event: Swap): void {
  let pool = Pool.load(bytesFromAddress(event.address));
  if (pool == null) return;

  pool.sqrtPriceX96 = event.params.sqrtPriceX96;
  pool.tick = event.params.tick;
  pool.liquidity = event.params.liquidity;

  let token0Decimals = getDecimals(Address.fromBytes(pool.token0));
  let token1Decimals = getDecimals(Address.fromBytes(pool.token1));
  let prices = sqrtPriceX96ToTokenPrices(event.params.sqrtPriceX96, token0Decimals, token1Decimals);
  pool.token0Price = prices[0];
  pool.token1Price = prices[1];

  let amount0Abs = event.params.amount0.abs();
  let amount1Abs = event.params.amount1.abs();
  pool.volumeToken0 = pool.volumeToken0.plus(convertTokenToDecimal(amount0Abs, token0Decimals));
  pool.volumeToken1 = pool.volumeToken1.plus(convertTokenToDecimal(amount1Abs, token1Decimals));
  pool.txCount = pool.txCount.plus(ONE_BI);
  pool.save();

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let swap = new SwapEntity(id);
  swap.pool = pool.id;
  swap.type = "UNISWAP_V3";
  swap.sender = bytesFromAddress(event.params.sender);
  swap.recipient = bytesFromAddress(event.params.recipient);
  swap.amount0 = event.params.amount0;
  swap.amount1 = event.params.amount1;
  swap.sqrtPriceX96 = event.params.sqrtPriceX96;
  swap.tick = event.params.tick;
  swap.liquidity = event.params.liquidity;
  swap.timestamp = event.block.timestamp;
  swap.block = event.block.number;
  swap.tx = event.transaction.hash;
  swap.logIndex = event.logIndex;
  swap.save();

  let dayData = getOrCreatePoolDayData(pool as Pool, event.block.timestamp);
  dayData.token0Price = pool.token0Price;
  dayData.token1Price = pool.token1Price;
  dayData.volumeToken0 = dayData.volumeToken0.plus(convertTokenToDecimal(amount0Abs, token0Decimals));
  dayData.volumeToken1 = dayData.volumeToken1.plus(convertTokenToDecimal(amount1Abs, token1Decimals));
  dayData.txCount = dayData.txCount.plus(ONE_BI);
  dayData.liquidity = pool.liquidity;
  dayData.save();

  let protocol = getOrCreateProtocol();
  protocol.totalDexSwaps = protocol.totalDexSwaps.plus(ONE_BI);
  protocol.save();
}

// Every Blitzr V3 pool's principal position is meant to be permanent (one-sided, locked in
// BlitzrLocker) — see BLITZR.md "Launch Flow". The only Mint expected after launch/migration is
// the single locked-liquidity deposit itself; the only Burn-shaped calls expected afterward are
// zero-liquidity fee-collection pokes via BlitzrLocker.claimFees (which don't even emit a V3
// Burn event — claimFees calls the position manager's collect(), not burn()). Recorded generically
// regardless, so any unexpected principal movement is visible on-chain rather than assumed away.
export function handleMint(event: Mint): void {
  let pool = Pool.load(bytesFromAddress(event.address));
  if (pool == null) return;

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let liquidityEvent = new LiquidityEvent(id);
  liquidityEvent.pool = pool.id;
  liquidityEvent.side = "MINT";
  liquidityEvent.sender = bytesFromAddress(event.params.sender);
  liquidityEvent.owner = bytesFromAddress(event.params.owner);
  liquidityEvent.tickLower = event.params.tickLower;
  liquidityEvent.tickUpper = event.params.tickUpper;
  liquidityEvent.amount = event.params.amount;
  liquidityEvent.amount0 = event.params.amount0;
  liquidityEvent.amount1 = event.params.amount1;
  liquidityEvent.timestamp = event.block.timestamp;
  liquidityEvent.block = event.block.number;
  liquidityEvent.tx = event.transaction.hash;
  liquidityEvent.logIndex = event.logIndex;
  liquidityEvent.save();

  pool.liquidity = (pool.liquidity as BigInt).plus(event.params.amount);
  pool.save();
}

export function handleBurn(event: Burn): void {
  let pool = Pool.load(bytesFromAddress(event.address));
  if (pool == null) return;

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let liquidityEvent = new LiquidityEvent(id);
  liquidityEvent.pool = pool.id;
  liquidityEvent.side = "BURN";
  liquidityEvent.owner = bytesFromAddress(event.params.owner);
  liquidityEvent.tickLower = event.params.tickLower;
  liquidityEvent.tickUpper = event.params.tickUpper;
  liquidityEvent.amount = event.params.amount;
  liquidityEvent.amount0 = event.params.amount0;
  liquidityEvent.amount1 = event.params.amount1;
  liquidityEvent.timestamp = event.block.timestamp;
  liquidityEvent.block = event.block.number;
  liquidityEvent.tx = event.transaction.hash;
  liquidityEvent.logIndex = event.logIndex;
  liquidityEvent.save();

  pool.liquidity = (pool.liquidity as BigInt).minus(event.params.amount);
  pool.save();
}

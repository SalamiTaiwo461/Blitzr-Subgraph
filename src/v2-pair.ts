import { Address } from "@graphprotocol/graph-ts";
import { Swap, Mint, Burn, Sync } from "../generated/templates/UniswapV2Pair/UniswapV2Pair";
import { Pool, Swap as SwapEntity, LiquidityEvent } from "../generated/schema";
import { getDecimals } from "./utils/token-meta";
import { reservesToTokenPrices } from "./utils/pricing";
import { getOrCreatePoolDayData } from "./utils/day-data";
import { getOrCreateProtocol } from "./utils/protocol";
import { updateTokenCandles } from "./utils/candles";
import { bytesFromAddress, ONE_BI, convertTokenToDecimal } from "./utils/constants";

// V2 has no in-pool concept of "current tick/liquidity" the way V3 does — reserve0/reserve1
// (updated on every Sync, which fires on every swap/mint/burn) is the V2 equivalent of TVL/price
// state, so token0Price/token1Price are recomputed here rather than in handleSwap.
export function handleSync(event: Sync): void {
  let pool = Pool.load(bytesFromAddress(event.address));
  if (pool == null) return;

  pool.reserve0 = event.params.reserve0;
  pool.reserve1 = event.params.reserve1;

  let token0Decimals = getDecimals(Address.fromBytes(pool.token0));
  let token1Decimals = getDecimals(Address.fromBytes(pool.token1));
  let prices = reservesToTokenPrices(
    event.params.reserve0,
    event.params.reserve1,
    token0Decimals,
    token1Decimals
  );
  pool.token0Price = prices[0];
  pool.token1Price = prices[1];
  pool.save();
}

export function handleSwap(event: Swap): void {
  let pool = Pool.load(bytesFromAddress(event.address));
  if (pool == null) return;

  // Normalize to the same signed, pool-perspective convention as V3 (positive = pool received):
  // amount0In/amount1In are what the pool received, amount0Out/amount1Out are what it paid out.
  let amount0 = event.params.amount0In.minus(event.params.amount0Out);
  let amount1 = event.params.amount1In.minus(event.params.amount1Out);

  let token0Decimals = getDecimals(Address.fromBytes(pool.token0));
  let token1Decimals = getDecimals(Address.fromBytes(pool.token1));
  let volume0Decimal = convertTokenToDecimal(amount0.abs(), token0Decimals);
  let volume1Decimal = convertTokenToDecimal(amount1.abs(), token1Decimals);

  pool.volumeToken0 = pool.volumeToken0.plus(volume0Decimal);
  pool.volumeToken1 = pool.volumeToken1.plus(volume1Decimal);
  pool.txCount = pool.txCount.plus(ONE_BI);
  pool.save();

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let swap = new SwapEntity(id);
  swap.pool = pool.id;
  swap.type = "UNISWAP_V2";
  swap.sender = bytesFromAddress(event.params.sender);
  swap.recipient = bytesFromAddress(event.params.to);
  swap.amount0 = amount0;
  swap.amount1 = amount1;
  swap.timestamp = event.block.timestamp;
  swap.block = event.block.number;
  swap.tx = event.transaction.hash;
  swap.logIndex = event.logIndex;
  swap.save();

  let dayData = getOrCreatePoolDayData(pool as Pool, event.block.timestamp);
  dayData.token0Price = pool.token0Price;
  dayData.token1Price = pool.token1Price;
  dayData.volumeToken0 = dayData.volumeToken0.plus(volume0Decimal);
  dayData.volumeToken1 = dayData.volumeToken1.plus(volume1Decimal);
  dayData.txCount = dayData.txCount.plus(ONE_BI);
  dayData.reserve0 = pool.reserve0;
  dayData.reserve1 = pool.reserve1;
  dayData.save();

  // Candle price/volume are expressed in "launched token" / "quote token" terms regardless of
  // which side ended up as token0/token1 for this particular pair — see TokenCandle in
  // schema.graphql. pool.token0Price/token1Price already reflect the post-swap reserves, since
  // Sync always fires before Swap within the same V2 transaction.
  let candlePrice = pool.launchedTokenIsToken0 ? pool.token0Price : pool.token1Price;
  let candleVolumeToken = pool.launchedTokenIsToken0 ? volume0Decimal : volume1Decimal;
  let candleVolumeQuote = pool.launchedTokenIsToken0 ? volume1Decimal : volume0Decimal;
  updateTokenCandles(pool.token, event.block.timestamp, candlePrice, candleVolumeToken, candleVolumeQuote);

  let protocol = getOrCreateProtocol();
  protocol.totalDexSwaps = protocol.totalDexSwaps.plus(ONE_BI);
  protocol.save();
}

// BlitzrTaxTokenArc mints its V2 LP exactly once, at migration, then sends the LP tokens
// straight to the dead address (BONDING_CURVE.md "Migration") — so in steady state this is the
// one Mint this pair should ever see, and Burn should never fire at all (no one holds the LP to
// burn it). Recorded generically anyway so any deviation is visible on-chain.
export function handleMint(event: Mint): void {
  let pool = Pool.load(bytesFromAddress(event.address));
  if (pool == null) return;

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let liquidityEvent = new LiquidityEvent(id);
  liquidityEvent.pool = pool.id;
  liquidityEvent.side = "MINT";
  liquidityEvent.sender = bytesFromAddress(event.params.sender);
  liquidityEvent.amount0 = event.params.amount0;
  liquidityEvent.amount1 = event.params.amount1;
  liquidityEvent.timestamp = event.block.timestamp;
  liquidityEvent.block = event.block.number;
  liquidityEvent.tx = event.transaction.hash;
  liquidityEvent.logIndex = event.logIndex;
  liquidityEvent.save();
}

export function handleBurn(event: Burn): void {
  let pool = Pool.load(bytesFromAddress(event.address));
  if (pool == null) return;

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let liquidityEvent = new LiquidityEvent(id);
  liquidityEvent.pool = pool.id;
  liquidityEvent.side = "BURN";
  liquidityEvent.sender = bytesFromAddress(event.params.sender);
  liquidityEvent.to = bytesFromAddress(event.params.to);
  liquidityEvent.amount0 = event.params.amount0;
  liquidityEvent.amount1 = event.params.amount1;
  liquidityEvent.timestamp = event.block.timestamp;
  liquidityEvent.block = event.block.number;
  liquidityEvent.tx = event.transaction.hash;
  liquidityEvent.logIndex = event.logIndex;
  liquidityEvent.save();
}

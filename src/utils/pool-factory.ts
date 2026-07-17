import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Pool } from "../../generated/schema";
import {
  UniswapV3Pool as UniswapV3PoolTemplate,
  UniswapV2Pair as UniswapV2PairTemplate,
} from "../../generated/templates";
import { isAddressLessThan } from "./address";
import { ZERO_BI, ZERO_BD, bytesFromAddress } from "./constants";

/**
 * Creates the Pool entity for a V3 pool and starts indexing it as a template data source.
 * Called from either BlitzrLauncherArc.TokenLaunched (pool address given directly) or
 * BlitzrBondingCurveArc.TokenCreated/TokenRegistered (pool address fetched via getToken(),
 * since BlitzrStandardToken's V3 pool is created inside createToken() itself, before
 * TokenConfig is even registered — see BONDING_CURVE.md "Pool Creation").
 */
export function createV3Pool(
  poolAddress: Address,
  launchedTokenId: Bytes,
  launchedToken: Address,
  otherToken: Address,
  feeTier: i32,
  positionManager: Address | null,
  factory: Address | null,
  block: ethereum.Block,
  tx: Bytes
): Pool {
  let id = bytesFromAddress(poolAddress);
  let pool = new Pool(id);
  pool.type = "UNISWAP_V3";
  pool.token = launchedTokenId;

  let launchedIsToken0 = isAddressLessThan(launchedToken, otherToken);
  pool.launchedTokenIsToken0 = launchedIsToken0;
  pool.token0 = bytesFromAddress(launchedIsToken0 ? launchedToken : otherToken);
  pool.token1 = bytesFromAddress(launchedIsToken0 ? otherToken : launchedToken);

  pool.feeTier = feeTier;
  if (positionManager !== null) {
    pool.positionManager = bytesFromAddress(positionManager as Address);
  }
  if (factory !== null) {
    pool.factory = bytesFromAddress(factory as Address);
  }

  pool.createdAtBlock = block.number;
  pool.createdAtTimestamp = block.timestamp;
  pool.createdAtTx = tx;

  pool.sqrtPriceX96 = ZERO_BI;
  pool.tick = 0;
  pool.liquidity = ZERO_BI;
  pool.token0Price = ZERO_BD;
  pool.token1Price = ZERO_BD;
  pool.volumeToken0 = ZERO_BD;
  pool.volumeToken1 = ZERO_BD;
  pool.txCount = ZERO_BI;

  pool.save();

  UniswapV3PoolTemplate.create(poolAddress);

  return pool as Pool;
}

/**
 * Creates the Pool entity for a V2 pair and starts indexing it as a template data source.
 * Called from BlitzrBondingCurveArc.TokenCreated/TokenRegistered for BlitzrTaxTokenArc launches
 * (createTT() creates the pair immediately via initForBlitzr, same as the BSC contract).
 */
export function createV2Pool(
  pairAddress: Address,
  launchedTokenId: Bytes,
  launchedToken: Address,
  otherToken: Address,
  factory: Address | null,
  block: ethereum.Block,
  tx: Bytes
): Pool {
  let id = bytesFromAddress(pairAddress);
  let pool = new Pool(id);
  pool.type = "UNISWAP_V2";
  pool.token = launchedTokenId;

  let launchedIsToken0 = isAddressLessThan(launchedToken, otherToken);
  pool.launchedTokenIsToken0 = launchedIsToken0;
  pool.token0 = bytesFromAddress(launchedIsToken0 ? launchedToken : otherToken);
  pool.token1 = bytesFromAddress(launchedIsToken0 ? otherToken : launchedToken);

  if (factory !== null) {
    pool.factory = bytesFromAddress(factory as Address);
  }

  pool.createdAtBlock = block.number;
  pool.createdAtTimestamp = block.timestamp;
  pool.createdAtTx = tx;

  pool.reserve0 = ZERO_BI;
  pool.reserve1 = ZERO_BI;
  pool.token0Price = ZERO_BD;
  pool.token1Price = ZERO_BD;
  pool.volumeToken0 = ZERO_BD;
  pool.volumeToken1 = ZERO_BD;
  pool.txCount = ZERO_BI;

  pool.save();

  UniswapV2PairTemplate.create(pairAddress);

  return pool as Pool;
}

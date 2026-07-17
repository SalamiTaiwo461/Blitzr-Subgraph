import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { ONE_BD, ZERO_BD, exponentToBigDecimal, safeDiv } from "./constants";

// 2^192, the denominator in the sqrtPriceX96 -> raw-price conversion (price = (sqrtPriceX96 /
// 2^96)^2 = sqrtPriceX96^2 / 2^192).
const Q192 = BigDecimal.fromString(
  "6277101735386680763835789423207666416102355444464034512896"
);

/**
 * Converts a V3 pool's sqrtPriceX96 into human-readable prices for both directions.
 * Returns [token0Price, token1Price] where token0Price = amount of token1 per 1 token0,
 * and token1Price is its reciprocal (amount of token0 per 1 token1) — matching the Pool
 * entity's token0Price/token1Price fields in schema.graphql.
 */
export function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: BigInt,
  token0Decimals: i32,
  token1Decimals: i32
): BigDecimal[] {
  let num = sqrtPriceX96.toBigDecimal().times(sqrtPriceX96.toBigDecimal());
  let rawPrice = safeDiv(num, Q192); // token1 raw units per token0 raw unit

  let token0Price = rawPrice
    .times(exponentToBigDecimal(token0Decimals))
    .div(exponentToBigDecimal(token1Decimals));

  let token1Price = token0Price.equals(ZERO_BD)
    ? ZERO_BD
    : safeDiv(ONE_BD, token0Price);

  return [token0Price, token1Price];
}

/**
 * Converts a V2 pair's reserves into human-readable prices for both directions, same
 * convention as sqrtPriceX96ToTokenPrices above.
 */
export function reservesToTokenPrices(
  reserve0: BigInt,
  reserve1: BigInt,
  token0Decimals: i32,
  token1Decimals: i32
): BigDecimal[] {
  if (reserve0.equals(BigInt.fromI32(0)) || reserve1.equals(BigInt.fromI32(0))) {
    return [ZERO_BD, ZERO_BD];
  }
  let r0 = reserve0.toBigDecimal().div(exponentToBigDecimal(token0Decimals));
  let r1 = reserve1.toBigDecimal().div(exponentToBigDecimal(token1Decimals));
  let token0Price = safeDiv(r1, r0); // token1 per token0
  let token1Price = safeDiv(r0, r1); // token0 per token1
  return [token0Price, token1Price];
}

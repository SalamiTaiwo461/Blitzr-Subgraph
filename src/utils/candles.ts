import { BigInt, BigDecimal, Bytes } from "@graphprotocol/graph-ts";
import { TokenCandle } from "../../generated/schema";
import { ZERO_BD, ZERO_BI, ONE_BI } from "./constants";

// Mirrors TradingView's standard resolution menu (see schema.graphql -> CandleInterval) and
// happens to also be exactly the shape TradingView Lightweight Charts wants per bucket:
// { time: periodStart (unix seconds), open, high, low, close } plus a separate volume series —
// see README "Chart data".
class IntervalDef {
  name: string;
  seconds: i32;
  constructor(name: string, seconds: i32) {
    this.name = name;
    this.seconds = seconds;
  }
}

function intervalDefs(): Array<IntervalDef> {
  let defs = new Array<IntervalDef>();
  defs.push(new IntervalDef("MINUTE_1", 60));
  defs.push(new IntervalDef("MINUTE_5", 300));
  defs.push(new IntervalDef("MINUTE_15", 900));
  defs.push(new IntervalDef("HOUR_1", 3600));
  defs.push(new IntervalDef("HOUR_4", 14400));
  defs.push(new IntervalDef("DAY_1", 86400));
  return defs;
}

/**
 * Rolls one trade/swap into every CandleInterval bucket it falls into for a given Token. Called
 * from both bonding-curve trades (src/bonding-curve-arc.ts) and DEX pool swaps
 * (src/v3-pool.ts, src/v2-pair.ts) so a token's chart is continuous across migration — see
 * TokenCandle in schema.graphql for why that's safe (same quote-asset units on both sides).
 */
export function updateTokenCandles(
  tokenId: Bytes,
  timestamp: BigInt,
  price: BigDecimal,
  volumeToken: BigDecimal,
  volumeQuote: BigDecimal
): void {
  let defs = intervalDefs();
  for (let i = 0; i < defs.length; i++) {
    let def = defs[i];
    let periodStartSeconds = (timestamp.toI32() / def.seconds) * def.seconds;
    let id = tokenId
      .concat(Bytes.fromUTF8(def.name))
      .concatI32(periodStartSeconds);

    let candle = TokenCandle.load(id);
    if (candle == null) {
      candle = new TokenCandle(id);
      candle.token = tokenId;
      candle.interval = def.name;
      candle.periodStart = BigInt.fromI32(periodStartSeconds);
      candle.open = price;
      candle.high = price;
      candle.low = price;
      candle.close = price;
      candle.volumeToken = ZERO_BD;
      candle.volumeQuote = ZERO_BD;
      candle.trades = ZERO_BI;
    }

    if (price.gt(candle.high)) candle.high = price;
    if (price.lt(candle.low)) candle.low = price;
    candle.close = price;
    candle.volumeToken = candle.volumeToken.plus(volumeToken);
    candle.volumeQuote = candle.volumeQuote.plus(volumeQuote);
    candle.trades = candle.trades.plus(ONE_BI);
    candle.save();
  }
}

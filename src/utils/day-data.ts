import { BigInt } from "@graphprotocol/graph-ts";
import { Pool, PoolDayData } from "../../generated/schema";
import { ZERO_BD, ZERO_BI } from "./constants";

const SECONDS_PER_DAY = 86400;

export function getOrCreatePoolDayData(
  pool: Pool,
  timestamp: BigInt
): PoolDayData {
  let dayId = timestamp.toI32() / SECONDS_PER_DAY;
  let id = pool.id.concatI32(dayId);
  let dayData = PoolDayData.load(id);
  if (dayData == null) {
    dayData = new PoolDayData(id);
    dayData.pool = pool.id;
    dayData.date = dayId * SECONDS_PER_DAY;
    dayData.token0Price = pool.token0Price;
    dayData.token1Price = pool.token1Price;
    dayData.volumeToken0 = ZERO_BD;
    dayData.volumeToken1 = ZERO_BD;
    dayData.txCount = ZERO_BI;
  }
  return dayData as PoolDayData;
}

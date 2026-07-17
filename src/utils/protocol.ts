import { Bytes } from "@graphprotocol/graph-ts";
import { Protocol } from "../../generated/schema";
import { ZERO_BI } from "./constants";

const PROTOCOL_ID = Bytes.fromUTF8("1");

export function getOrCreateProtocol(): Protocol {
  let protocol = Protocol.load(PROTOCOL_ID);
  if (protocol == null) {
    protocol = new Protocol(PROTOCOL_ID);
    protocol.tokensLaunchedV3 = ZERO_BI;
    protocol.tokensLaunchedBondingStandard = ZERO_BI;
    protocol.tokensLaunchedBondingTax = ZERO_BI;
    protocol.poolsCreated = ZERO_BI;
    protocol.totalDexSwaps = ZERO_BI;
    protocol.totalBondingTrades = ZERO_BI;
    protocol.totalMigrations = ZERO_BI;
    protocol.totalEmergencyMigrations = ZERO_BI;
  }
  return protocol as Protocol;
}

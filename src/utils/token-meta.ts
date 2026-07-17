import { Address, BigInt } from "@graphprotocol/graph-ts";
// BlitzrToken, BlitzrStandardToken and BlitzrTaxTokenArc all expose the identical
// name()/symbol()/decimals()/totalSupply()/metaURI() selectors (see contracts/BlitzrToken.sol
// and bonding-curve/tokens/*.sol), so one generated binding can safely be reused to read any of
// the three clone types' metadata. Bound here via BlitzrLauncherArc's copy of the ABI; the
// generated class is structurally identical regardless of which data source declared it.
import { BlitzrToken } from "../../generated/BlitzrLauncherArc/BlitzrToken";
import { Token } from "../../generated/schema";
import { ARC_USDC, ARC_USDC_DECIMALS, BLITZR_TOKEN_DECIMALS, bytesFromAddress } from "./constants";

export class TokenMeta {
  name: string;
  symbol: string;
  decimals: i32;
  totalSupply: BigInt;
  metaURI: string;
}

export function fetchTokenMeta(tokenAddress: Address): TokenMeta {
  let contract = BlitzrToken.bind(tokenAddress);
  let meta = new TokenMeta();

  let nameResult = contract.try_name();
  meta.name = nameResult.reverted ? "unknown" : nameResult.value;

  let symbolResult = contract.try_symbol();
  meta.symbol = symbolResult.reverted ? "UNKNOWN" : symbolResult.value;

  let decimalsResult = contract.try_decimals();
  meta.decimals = decimalsResult.reverted
    ? BLITZR_TOKEN_DECIMALS
    : decimalsResult.value;

  let totalSupplyResult = contract.try_totalSupply();
  meta.totalSupply = totalSupplyResult.reverted
    ? BigInt.fromI32(0)
    : totalSupplyResult.value;

  let metaURIResult = contract.try_metaURI();
  meta.metaURI = metaURIResult.reverted ? "" : metaURIResult.value;

  return meta;
}

/**
 * Resolves a pool leg's decimals for price math (see utils/pricing.ts): ARC_USDC is a known
 * constant (6), a leg that's a Blitzr-launched Token is read from its already-indexed entity
 * (no call), and anything else (an arbitrary registered quote token) falls back to a live
 * decimals() call, defaulting to 18 if that reverts.
 */
export function getDecimals(tokenAddress: Address): i32 {
  if (tokenAddress.equals(ARC_USDC)) {
    return ARC_USDC_DECIMALS;
  }
  let token = Token.load(bytesFromAddress(tokenAddress));
  if (token != null) {
    return token.decimals;
  }
  let contract = BlitzrToken.bind(tokenAddress);
  let decimalsResult = contract.try_decimals();
  return decimalsResult.reverted ? BLITZR_TOKEN_DECIMALS : decimalsResult.value;
}

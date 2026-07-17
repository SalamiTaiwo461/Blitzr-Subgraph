import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";

export const ZERO_BI = BigInt.fromI32(0);
export const ONE_BI = BigInt.fromI32(1);
export const ZERO_BD = BigDecimal.fromString("0");
export const ONE_BD = BigDecimal.fromString("1");

export const ADDRESS_ZERO = Address.fromString(
  "0x0000000000000000000000000000000000000000"
);
export const BURN_ADDRESS = Address.fromString(
  "0x000000000000000000000000000000000000dEaD"
);

// Arc's native gas token, mirrored 1:1 as an ERC20 at this fixed, network-wide address.
// See README.md -> "Arc variant" / BLITZR.md -> "Arc Variant".
export const ARC_USDC = Address.fromString(
  "0x3600000000000000000000000000000000000000"
);
export const ARC_USDC_DECIMALS = 6;

export const BLITZR_TOKEN_DECIMALS = 18;

export function bytesFromAddress(address: Address): Bytes {
  return Bytes.fromHexString(address.toHexString());
}

export function exponentToBigDecimal(decimals: i32): BigDecimal {
  let result = "1";
  for (let i = 0; i < decimals; i++) {
    result += "0";
  }
  return BigDecimal.fromString(result);
}

export function convertTokenToDecimal(
  amount: BigInt,
  decimals: i32
): BigDecimal {
  if (decimals == 0) {
    return amount.toBigDecimal();
  }
  return amount.toBigDecimal().div(exponentToBigDecimal(decimals));
}

export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.equals(ZERO_BD)) {
    return ZERO_BD;
  }
  return amount0.div(amount1);
}

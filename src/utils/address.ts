import { Address } from "@graphprotocol/graph-ts";

// Uniswap-style address sort order (token0 = the numerically smaller address). Compared
// byte-by-byte since both addresses are always the same 20-byte length.
export function isAddressLessThan(a: Address, b: Address): boolean {
  let aBytes = a;
  let bBytes = b;
  for (let i = 0; i < aBytes.length; i++) {
    if (aBytes[i] < bBytes[i]) return true;
    if (aBytes[i] > bBytes[i]) return false;
  }
  return false;
}

export function sortTokens(a: Address, b: Address): Address[] {
  return isAddressLessThan(a, b) ? [a, b] : [b, a];
}

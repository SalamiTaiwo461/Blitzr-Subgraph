import {
  SwapAndLiquify,
  ReflectionSwapped,
  ReflectionDistributed,
} from "../generated/templates/BlitzrTaxTokenArc/BlitzrTaxTokenArc";
import { TaxTokenInfo } from "../generated/schema";
import { bytesFromAddress, ONE_BI } from "./utils/constants";

export function handleSwapAndLiquify(event: SwapAndLiquify): void {
  let id = bytesFromAddress(event.address);
  let info = TaxTokenInfo.load(id);
  if (info == null) return;

  info.swapAndLiquifyCount = info.swapAndLiquifyCount.plus(ONE_BI);
  info.totalTokensSwappedForLiquidity = info.totalTokensSwappedForLiquidity.plus(
    event.params.tokensSwapped
  );
  info.totalUsdcAddedToLiquidity = info.totalUsdcAddedToLiquidity.plus(event.params.usdc);
  info.save();
}

export function handleReflectionSwapped(event: ReflectionSwapped): void {
  let id = bytesFromAddress(event.address);
  let info = TaxTokenInfo.load(id);
  if (info == null) return;

  info.reflectionSwapCount = info.reflectionSwapCount.plus(ONE_BI);
  info.save();
}

export function handleReflectionDistributed(event: ReflectionDistributed): void {
  let id = bytesFromAddress(event.address);
  let info = TaxTokenInfo.load(id);
  if (info == null) return;

  info.reflectionDistributionCount = info.reflectionDistributionCount.plus(ONE_BI);
  info.totalReflectionRecipients = info.totalReflectionRecipients.plus(event.params.recipients);
  info.save();
}

import {
  TokenLaunched,
  DexAdded,
  DexDisabled,
  QuoteTokenAdded,
  QuoteTokenDisabled,
  MarketCapRefSet,
  BlitzrLauncherArc as BlitzrLauncherArcContract,
} from "../generated/BlitzrLauncherArc/BlitzrLauncherArc";
import { Address } from "@graphprotocol/graph-ts";
import { Token, DexRegistryEntry, QuoteTokenConfig } from "../generated/schema";
import { fetchTokenMeta } from "./utils/token-meta";
import { createV3Pool } from "./utils/pool-factory";
import { getOrCreateProtocol } from "./utils/protocol";
import { bytesFromAddress, ONE_BI } from "./utils/constants";

// BlitzrLauncherArc always creates its pool at the 1% tier (FEE_TIER, tick spacing 200) — see
// BLITZR.md "Launch Flow" step 4. Not emitted in TokenLaunched itself, so hardcoded here rather
// than re-derived from an extra call.
const V3_FEE_TIER = 10000;

export function handleTokenLaunched(event: TokenLaunched): void {
  let tokenAddress = event.params.token;
  let meta = fetchTokenMeta(tokenAddress);

  let token = new Token(bytesFromAddress(tokenAddress));
  token.stack = "BLITZR_V3";
  token.name = meta.name;
  token.symbol = meta.symbol;
  token.decimals = meta.decimals;
  token.totalSupply = meta.totalSupply;
  token.creator = bytesFromAddress(event.params.creator);
  token.feeWallet = bytesFromAddress(event.params.feeWallet);
  token.metaURI = meta.metaURI;
  token.quoteToken = bytesFromAddress(event.params.quoteToken);
  token.exemptCount = 0;
  token.createdAtBlock = event.block.number;
  token.createdAtTimestamp = event.block.timestamp;
  token.createdAtTx = event.transaction.hash;

  // Resolve the DEX's position manager directly from the launcher's own registry rather than
  // relying on a prior DexAdded event having already landed a DexRegistryEntry.
  let launcher = BlitzrLauncherArcContract.bind(event.address);
  let dexConfigResult = launcher.try_dexes(event.params.factory);
  let positionManager: Address | null = null;
  if (!dexConfigResult.reverted) {
    positionManager = dexConfigResult.value.getPositionManager();
  }

  let pool = createV3Pool(
    event.params.pool,
    token.id,
    tokenAddress,
    event.params.quoteToken,
    V3_FEE_TIER,
    positionManager,
    event.params.factory,
    event.block,
    event.transaction.hash
  );

  token.pool = pool.id;
  token.save();

  let protocol = getOrCreateProtocol();
  protocol.tokensLaunchedV3 = protocol.tokensLaunchedV3.plus(ONE_BI);
  protocol.poolsCreated = protocol.poolsCreated.plus(ONE_BI);
  protocol.save();
}

export function handleDexAdded(event: DexAdded): void {
  let id = bytesFromAddress(event.params.factory);
  let entry = new DexRegistryEntry(id);
  entry.positionManager = bytesFromAddress(event.params.positionManager);
  entry.router = bytesFromAddress(event.params.router);
  entry.enabled = true;
  entry.save();
}

export function handleDexDisabled(event: DexDisabled): void {
  let id = bytesFromAddress(event.params.factory);
  let entry = DexRegistryEntry.load(id);
  if (entry == null) return;
  entry.enabled = false;
  entry.save();
}

export function handleQuoteTokenAdded(event: QuoteTokenAdded): void {
  let id = bytesFromAddress(event.params.token);
  let config = new QuoteTokenConfig(id);
  config.token = id;
  config.marketCapRef = event.params.marketCapRef;
  config.nativePairFee = event.params.nativePairFee;
  config.enabled = true;
  config.save();
}

export function handleQuoteTokenDisabled(event: QuoteTokenDisabled): void {
  let id = bytesFromAddress(event.params.token);
  let config = QuoteTokenConfig.load(id);
  if (config == null) return;
  config.enabled = false;
  config.save();
}

export function handleMarketCapRefSet(event: MarketCapRefSet): void {
  let id = bytesFromAddress(event.params.token);
  let config = QuoteTokenConfig.load(id);
  if (config == null) {
    config = new QuoteTokenConfig(id);
    config.token = id;
    config.enabled = true;
  }
  config.marketCapRef = event.params.marketCapRef;
  config.save();
}

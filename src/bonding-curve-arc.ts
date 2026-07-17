import { Address, BigDecimal } from "@graphprotocol/graph-ts";
import {
  TokenRegistered,
  TokenCreated,
  TokenBought,
  TokenSold,
  TokenMigrated,
  EmergencyMigrated,
  MigrationFailed,
  BlitzrBondingCurveArc as BondingCurveContract,
} from "../generated/BlitzrBondingCurveArc/BlitzrBondingCurveArc";
import { BlitzrTaxTokenArc as BlitzrTaxTokenArcTemplate } from "../generated/templates";
import { Token, BondingCurve, BondingTrade, Migration, TaxTokenInfo } from "../generated/schema";
import { fetchTokenMeta } from "./utils/token-meta";
import { createV3Pool, createV2Pool } from "./utils/pool-factory";
import { getOrCreateProtocol } from "./utils/protocol";
import {
  bytesFromAddress,
  ZERO_BI,
  ONE_BI,
  ARC_USDC,
  ARC_USDC_DECIMALS,
  convertTokenToDecimal,
  safeDiv,
} from "./utils/constants";

// Fired first within createToken()/createTT() (see _registerToken in BlitzrBondingCurveArc.sol),
// before TokenCreated — this is where Token/BondingCurve/Pool entities are actually created.
// creator/totalSupply/virtualUSDC/migrationTarget come straight from the event; pair/useV3/
// router/v3PositionManager/liquidityTokens/bcTokensTotal have no event field at all, so a single
// getToken() call fills those in. Note: like any eth_call in a mapping, this reads state as of
// the END of the current block, not the point mid-transaction where this event was emitted — in
// the extremely unlikely case another transaction later in the same block migrates this same
// brand-new token, this call would observe post-migration state instead. Documented rather than
// worked around, since BlitzrBondingCurveArc's own TokenConfig has no cheaper alternative.
export function handleTokenRegistered(event: TokenRegistered): void {
  let tokenAddress = event.params.token;
  let tokenId = bytesFromAddress(tokenAddress);
  let meta = fetchTokenMeta(tokenAddress);

  let contract = BondingCurveContract.bind(event.address);
  let configResult = contract.try_getToken(tokenAddress);

  let pairAddress = Address.zero();
  let useV3 = true;
  let router = Address.zero();
  let v3PositionManager: Address | null = null;
  let liquidityTokens = ZERO_BI;
  let bcTokensTotal = ZERO_BI;

  if (!configResult.reverted) {
    let cfg = configResult.value;
    pairAddress = cfg.getPair();
    useV3 = cfg.getUseV3();
    router = cfg.getRouter();
    v3PositionManager = useV3 ? cfg.getV3PositionManager() : null;
    liquidityTokens = cfg.getLiquidityTokens();
    bcTokensTotal = cfg.getBcTokensTotal();
  }

  let stack = useV3 ? "BONDING_STANDARD" : "BONDING_TAX";

  let token = new Token(tokenId);
  token.stack = stack;
  token.name = meta.name;
  token.symbol = meta.symbol;
  token.decimals = meta.decimals;
  token.totalSupply = event.params.totalSupply;
  token.creator = bytesFromAddress(event.params.creator);
  token.metaURI = meta.metaURI;
  token.exemptCount = 0;
  token.createdAtBlock = event.block.number;
  token.createdAtTimestamp = event.block.timestamp;
  token.createdAtTx = event.transaction.hash;

  let bondingCurve = new BondingCurve(tokenId);
  bondingCurve.token = tokenId;
  bondingCurve.creator = bytesFromAddress(event.params.creator);
  bondingCurve.totalSupply = event.params.totalSupply;
  bondingCurve.liquidityTokens = liquidityTokens;
  bondingCurve.bcTokensTotal = bcTokensTotal;
  bondingCurve.bcTokensSold = ZERO_BI;
  bondingCurve.virtualUSDC = event.params.virtualUSDC;
  bondingCurve.k = event.params.virtualUSDC.times(bcTokensTotal);
  bondingCurve.raisedUSDC = ZERO_BI;
  bondingCurve.migrationTarget = event.params.migrationTarget;
  bondingCurve.useV3 = useV3;
  bondingCurve.router = bytesFromAddress(router);
  if (v3PositionManager !== null) {
    bondingCurve.v3PositionManager = bytesFromAddress(v3PositionManager as Address);
  }
  // antibotEnabled/creationBlock/tradingBlock are filled in by handleTokenCreated, which fires
  // immediately after this event in the same transaction and carries them directly (no call
  // needed there).
  bondingCurve.antibotEnabled = false;
  bondingCurve.creationBlock = event.block.number;
  bondingCurve.tradingBlock = event.block.number;
  bondingCurve.migrated = false;
  bondingCurve.migrationPending = false;
  bondingCurve.buyCount = ZERO_BI;
  bondingCurve.sellCount = ZERO_BI;

  if (!pairAddress.equals(Address.zero())) {
    let pool = useV3
      ? createV3Pool(
          pairAddress,
          tokenId,
          tokenAddress,
          ARC_USDC,
          10000,
          v3PositionManager,
          null,
          event.block,
          event.transaction.hash
        )
      : createV2Pool(
          pairAddress,
          tokenId,
          tokenAddress,
          ARC_USDC,
          null,
          event.block,
          event.transaction.hash
        );
    bondingCurve.pool = pool.id;
    token.pool = pool.id;

    let protocol = getOrCreateProtocol();
    protocol.poolsCreated = protocol.poolsCreated.plus(ONE_BI);
    protocol.save();
  }

  if (!useV3) {
    let taxInfo = new TaxTokenInfo(tokenId);
    taxInfo.token = tokenId;
    taxInfo.swapAndLiquifyCount = ZERO_BI;
    taxInfo.totalTokensSwappedForLiquidity = ZERO_BI;
    taxInfo.totalUsdcAddedToLiquidity = ZERO_BI;
    taxInfo.reflectionSwapCount = ZERO_BI;
    taxInfo.reflectionDistributionCount = ZERO_BI;
    taxInfo.totalReflectionRecipients = ZERO_BI;
    taxInfo.save();
    bondingCurve.taxInfo = tokenId;

    BlitzrTaxTokenArcTemplate.create(tokenAddress);
  }

  token.bondingCurve = tokenId;
  token.save();
  bondingCurve.save();
}

// Fires immediately after TokenRegistered, same transaction — carries antibotEnabled/tradingBlock
// directly, cheaper and more reliable than reading them back via getToken().
export function handleTokenCreated(event: TokenCreated): void {
  let tokenId = bytesFromAddress(event.params.token);
  let bondingCurve = BondingCurve.load(tokenId);
  if (bondingCurve == null) return;

  bondingCurve.antibotEnabled = event.params.antibotEnabled;
  bondingCurve.tradingBlock = event.params.tradingBlock;
  bondingCurve.save();

  let protocol = getOrCreateProtocol();
  let token = Token.load(tokenId);
  if (token != null && token.stack == "BONDING_STANDARD") {
    protocol.tokensLaunchedBondingStandard = protocol.tokensLaunchedBondingStandard.plus(ONE_BI);
  } else {
    protocol.tokensLaunchedBondingTax = protocol.tokensLaunchedBondingTax.plus(ONE_BI);
  }
  protocol.save();
}

function priceUSDCPerToken(usdcAmount: BigDecimal, tokenAmount: BigDecimal): BigDecimal {
  return safeDiv(usdcAmount, tokenAmount);
}

export function handleTokenBought(event: TokenBought): void {
  let tokenId = bytesFromAddress(event.params.token);
  let bondingCurve = BondingCurve.load(tokenId);
  if (bondingCurve == null) return;

  bondingCurve.bcTokensSold = bondingCurve.bcTokensSold.plus(event.params.tokensOut);
  bondingCurve.raisedUSDC = event.params.raisedUSDC;
  bondingCurve.buyCount = bondingCurve.buyCount.plus(ONE_BI);
  bondingCurve.save();

  let usdcDecimal = convertTokenToDecimal(event.params.usdcIn, ARC_USDC_DECIMALS);
  let tokenDecimal = convertTokenToDecimal(event.params.tokensOut, 18);

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let trade = new BondingTrade(id);
  trade.bondingCurve = tokenId;
  trade.token = tokenId;
  trade.trader = bytesFromAddress(event.params.buyer);
  trade.side = "BUY";
  trade.usdcAmount = event.params.usdcIn;
  trade.tokenAmount = event.params.tokensOut;
  trade.tokensToDead = event.params.tokensToDead;
  trade.raisedUSDCAfter = event.params.raisedUSDC;
  trade.priceUSDCPerToken = priceUSDCPerToken(usdcDecimal, tokenDecimal);
  trade.timestamp = event.block.timestamp;
  trade.block = event.block.number;
  trade.tx = event.transaction.hash;
  trade.logIndex = event.logIndex;
  trade.save();

  let protocol = getOrCreateProtocol();
  protocol.totalBondingTrades = protocol.totalBondingTrades.plus(ONE_BI);
  protocol.save();
}

export function handleTokenSold(event: TokenSold): void {
  let tokenId = bytesFromAddress(event.params.token);
  let bondingCurve = BondingCurve.load(tokenId);
  if (bondingCurve == null) return;

  bondingCurve.bcTokensSold = bondingCurve.bcTokensSold.minus(event.params.tokensIn);
  bondingCurve.raisedUSDC = event.params.raisedUSDC;
  bondingCurve.sellCount = bondingCurve.sellCount.plus(ONE_BI);
  bondingCurve.save();

  let usdcDecimal = convertTokenToDecimal(event.params.usdcOut, ARC_USDC_DECIMALS);
  let tokenDecimal = convertTokenToDecimal(event.params.tokensIn, 18);

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let trade = new BondingTrade(id);
  trade.bondingCurve = tokenId;
  trade.token = tokenId;
  trade.trader = bytesFromAddress(event.params.seller);
  trade.side = "SELL";
  trade.usdcAmount = event.params.usdcOut;
  trade.tokenAmount = event.params.tokensIn;
  trade.tokensToDead = ZERO_BI;
  trade.raisedUSDCAfter = event.params.raisedUSDC;
  trade.priceUSDCPerToken = priceUSDCPerToken(usdcDecimal, tokenDecimal);
  trade.timestamp = event.block.timestamp;
  trade.block = event.block.number;
  trade.tx = event.transaction.hash;
  trade.logIndex = event.logIndex;
  trade.save();

  let protocol = getOrCreateProtocol();
  protocol.totalBondingTrades = protocol.totalBondingTrades.plus(ONE_BI);
  protocol.save();
}

export function handleTokenMigrated(event: TokenMigrated): void {
  let tokenId = bytesFromAddress(event.params.token);
  let bondingCurve = BondingCurve.load(tokenId);
  if (bondingCurve == null) return;

  bondingCurve.migrated = true;
  bondingCurve.migrationPending = false;
  bondingCurve.save();

  let migration = new Migration(tokenId);
  migration.token = tokenId;
  migration.pool = bondingCurve.pool;
  migration.liquidityUSDC = event.params.liquidityUSDC;
  migration.liquidityTokens = event.params.liquidityTokens;
  migration.emergency = false;
  migration.timestamp = event.block.timestamp;
  migration.block = event.block.number;
  migration.tx = event.transaction.hash;
  migration.save();

  let protocol = getOrCreateProtocol();
  protocol.totalMigrations = protocol.totalMigrations.plus(ONE_BI);
  protocol.save();
}

export function handleEmergencyMigrated(event: EmergencyMigrated): void {
  let tokenId = bytesFromAddress(event.params.token);
  let bondingCurve = BondingCurve.load(tokenId);
  if (bondingCurve == null) return;

  bondingCurve.migrated = true;
  bondingCurve.migrationPending = false;
  bondingCurve.save();

  let migration = new Migration(tokenId);
  migration.token = tokenId;
  migration.liquidityUSDC = event.params.usdcAmount;
  migration.liquidityTokens = event.params.tokenAmount;
  migration.emergency = true;
  migration.emergencyTo = bytesFromAddress(event.params.to);
  migration.timestamp = event.block.timestamp;
  migration.block = event.block.number;
  migration.tx = event.transaction.hash;
  migration.save();

  let protocol = getOrCreateProtocol();
  protocol.totalEmergencyMigrations = protocol.totalEmergencyMigrations.plus(ONE_BI);
  protocol.save();
}

export function handleMigrationFailed(event: MigrationFailed): void {
  let tokenId = bytesFromAddress(event.params.token);
  let bondingCurve = BondingCurve.load(tokenId);
  if (bondingCurve == null) return;

  bondingCurve.migrationPending = true;
  bondingCurve.save();
}

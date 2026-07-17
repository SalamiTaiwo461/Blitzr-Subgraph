# Blitzr Subgraph — Arc Network

A [The Graph](https://thegraph.com/) subgraph indexing the **Arc-network** deployment of
[BlitzrDotFunCore](https://github.com/justOneLad/BlitzrDotFunCore), including the real DEX
pools/pairs those contracts create and trade against — not just the launch/migration events.

## Scope

BlitzrDotFunCore ships three parallel launch stacks; **this subgraph only indexes the two that
have an Arc variant**:

| Stack | Contract | DEX it feeds | Indexed here? |
|---|---|---|---|
| Blitzr (V3) | `contracts/BlitzrLauncherArc.sol` | V3 pool, one-sided, locked in `BlitzrLocker` | ✅ |
| Bonding curve → standard | `bonding-curve/BlitzrBondingCurveArc.sol` + `BlitzrStandardToken` | migrates to V3, locked in `BlitzrLocker` | ✅ |
| Bonding curve → tax | `bonding-curve/BlitzrBondingCurveArc.sol` + `BlitzrTaxTokenArc` | migrates to V2, LP burned | ✅ |
| xBlitzr (V4 hooks) | `xBlitzr/XBlitzrLauncher.sol` | Uniswap V4 singleton `PoolManager` | ❌ — **no Arc variant exists** |

Arc's native gas token **is** USDC (6 decimals), mirrored 1:1 as an ERC20 at the fixed address
`0x3600000000000000000000000000000000000000`. There is no WETH on Arc — every "BNB"-named
field/event on the BSC contracts (`raisedBNB`, `virtualBNB`, ...) is renamed to "USDC" in the
Arc variant (`raisedUSDC`, `virtualUSDC`, ...), and this subgraph's schema follows that naming.

## What's indexed

- **Launches** — every token created via `BlitzrLauncherArc.launch()` or
  `BlitzrBondingCurveArc.createToken()`/`createTT()`.
- **DEX pools/pairs** — the actual V3 pool (Blitzr launches, and bonding-curve `BlitzrStandardToken`
  migrations) or V2 pair (`BlitzrTaxTokenArc` migrations) each token trades on: `Initialize`,
  `Swap`, `Mint`, `Burn` (V3) / `Swap`, `Mint`, `Burn`, `Sync` (V2), with running price, reserves/
  liquidity, volume, and a daily rollup (`PoolDayData`). Pools are tracked as dynamic-data-source
  templates, instantiated the moment a pool/pair address becomes known — which for every stack
  here is at *creation* time, not deferred to migration (see `BlitzrLauncherArc`'s `TokenLaunched`
  and `BlitzrBondingCurveArc`'s pre-migration pool creation, both documented in the core repo).
- **Bonding-curve trading** — every `buy`/`sell` against the internal constant-product curve,
  plus migration (`migrate`/`emergencyMigrate`) and stalled-migration (`MigrationFailed`) state.
- **Chart data** — `TokenCandle`: multi-resolution OHLCV, continuous across migration — see
  "Chart data" below.
- **Fee lifecycle** — `BlitzrLocker`'s locked-LP fee claims/burns, CTO (fee-wallet reassignment)
  flow, and its launcher allowlist (`LauncherAuthorization`) — see "Locker instance(s)" below.
- **Tax/reflection mechanics** — `BlitzrTaxTokenArc`'s swap-and-liquify and reflection
  distribution counters (no V3/V2 equivalent, so tracked directly off the token clone).

Deliberately **not** indexed: generic ERC-20 `Transfer`/holder tracking on launched tokens, and
any USD pricing (the protocol itself has no price oracle on Arc — see `BONDING_CURVE.md` →
"Arc Variant" — so this subgraph doesn't invent one either; all volume/liquidity figures are in
each pool's own token units).

## Chart data

`TokenCandle` (`schema.graphql`) is OHLCV data precomputed by the indexer at six resolutions
(`MINUTE_1`, `MINUTE_5`, `MINUTE_15`, `HOUR_1`, `HOUR_4`, `DAY_1` — TradingView's usual menu),
one series **per Token**, fed by `src/utils/candles.ts`'s `updateTokenCandles()` from both
`BlitzrBondingCurveArc.TokenBought`/`TokenSold` (`src/bonding-curve-arc.ts`) and DEX pool/pair
`Swap` (`src/v3-pool.ts`, `src/v2-pair.ts`). Each bucket's fields (`open`/`high`/`low`/`close` as
`BigDecimal`, `periodStart` as a unix-second `BigInt`) map directly onto
[TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/)' candlestick
series shape — query one `interval`, sort by `periodStart`, and pass the array straight to
`series.setData()`; `volumeToken` maps the same way onto a histogram series. No REST/UDF
Datafeed adapter is needed for Lightweight Charts (unlike the full Charting Library) — just query
the subgraph directly.

For `BONDING_STANDARD`/`BONDING_TAX` tokens the series is continuous straight through migration:
pre-migration bonding-curve trades and post-migration DEX swaps are both always priced in
ARC_USDC (see `BlitzrBondingCurveArc`'s pair-creation logic), so there's no unit break to stitch
around. `BLITZR_V3` tokens are priced in whatever quote token that launch registered
(`Token.quoteToken`) — never converted to USDC, per the "no invented pricing" rule above.

## Locker instance(s)

`BlitzrLocker.launchers` is an allowlist (`mapping(address => bool)`), not a single address, so
**one `BlitzrLocker` instance is meant to be shared** across every stack — `BlitzrLauncherArc`
and `BlitzrBondingCurveArc` are both authorized on it simultaneously via `setLauncher(addr,
true)` (see the core repo's "Deployment Order" docs, updated when `launcher` was reworked into
this allowlist). `subgraph.yaml` declares a single `BlitzrLocker` data source accordingly, and
`LauncherSet` is indexed into a `LauncherAuthorization` entity so it's visible which launchers are
currently authorized on it.

If a real deployment instead runs separate locker instances per stack (still supported, just no
longer required), duplicate the `BlitzrLocker` data source block in `subgraph.yaml` per instance
— `src/locker.ts` is already instance-agnostic: it reads `event.address` for the
`LockerPosition.locker` field and the linked `Token.stack` for CTO attribution, never a hardcoded
locker address.

## Before deploying

Every contract address and `startBlock` in `subgraph.yaml` is a placeholder
(`0x000...00N` / `0`) — **BlitzrDotFunCore has not been deployed to Arc yet as of writing**. Fill
in:

1. The three fixed-address data sources in `subgraph.yaml` (`BlitzrLauncherArc`, `BlitzrLocker`,
   `BlitzrBondingCurveArc`) with real deployed addresses and their deployment block numbers —
   plus a fourth `BlitzrLocker` data source block if the deployment ends up running two separate
   locker instances after all (see "Locker instance(s)" above).
2. `network: arc` in every data source/template — set to whatever network name your indexer
   (self-hosted `graph-node`, Subgraph Studio, etc.) registers Arc under.

Then:

```sh
npm install
npm run codegen   # generates AssemblyScript bindings from subgraph.yaml + abis/
npm run build     # compiles the mappings
npm run deploy-local   # or deploy/deploy:studio, per your target
```

## Design notes / known limitations

- **`getToken()` / `dexes()` calls read end-of-block state.** A couple of fields
  (`BondingCurve.pair`/`useV3`/`router`/`v3PositionManager`, `Pool.positionManager` on the V3
  launcher path) aren't emitted in any event, so the mappings fall back to an `eth_call`. Like
  any contract call inside a mapping, this reflects state as of the *end* of the block being
  processed, not the exact point mid-transaction where the event fired. In the ordinary case
  (one launch per block) this is a non-issue; it's called out in code comments (`src/bonding-curve-arc.ts`,
  `src/launcher-arc.ts`) for the edge case where it isn't.
- **`token0`/`token1` sort order** is re-derived locally (`src/utils/address.ts`) rather than
  trusted from any single event, since which side is the launched token varies per pool (see
  `BLITZR.md` → "Per-token burn").
- **Pricing** mirrors the standard Uniswap-subgraph `sqrtPriceX96` (V3) / reserve-ratio (V2)
  conventions (`src/utils/pricing.ts`) — `token0Price` = amount of `token1` per 1 `token0`, and
  vice versa. No USD conversion is attempted anywhere.
- **Permanent-liquidity assumption isn't enforced by the indexer.** Every Blitzr V3 pool's
  principal position is meant to be permanent (`XBlitzrHook`'s equivalent lock doesn't exist on
  V3 — it's `BlitzrLocker` custody instead), and `BlitzrTaxTokenArc`'s V2 LP is burned at
  migration. `LiquidityEvent` still records every raw `Mint`/`Burn` generically, so any deviation
  from that assumption shows up in the data rather than being silently assumed away.

## Layout

```
schema.graphql       Entity definitions
subgraph.yaml         Data sources (fixed contracts) + templates (dynamic pools/pairs/tokens)
abis/                 Hand-authored ABI fragments (events + view functions actually used)
src/
  launcher-arc.ts      BlitzrLauncherArc: TokenLaunched, DEX/quote-token registry
  locker.ts            BlitzrLocker: positions, fee claims, CTO, launcher allowlist
  bonding-curve-arc.ts BlitzrBondingCurveArc: token creation, buy/sell, migration
  tax-token-arc.ts     BlitzrTaxTokenArc clones: swap-and-liquify, reflection
  v3-pool.ts           V3 pool template: Initialize/Swap/Mint/Burn
  v2-pair.ts           V2 pair template: Swap/Mint/Burn/Sync
  utils/               constants, address sorting, pricing math, pool factory, day-data, candles, protocol singleton
```

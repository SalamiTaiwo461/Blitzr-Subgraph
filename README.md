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
- **Fee lifecycle** — `BlitzrLocker`'s locked-LP fee claims/burns and CTO (fee-wallet
  reassignment) flow, for both the V3 stack and the bonding-curve stack (they run **separate**
  `BlitzrLocker` instances — see "Two locker instances" below).
- **Tax/reflection mechanics** — `BlitzrTaxTokenArc`'s swap-and-liquify and reflection
  distribution counters (no V3/V2 equivalent, so tracked directly off the token clone).

Deliberately **not** indexed: generic ERC-20 `Transfer`/holder tracking on launched tokens, and
any USD pricing (the protocol itself has no price oracle on Arc — see `BONDING_CURVE.md` →
"Arc Variant" — so this subgraph doesn't invent one either; all volume/liquidity figures are in
each pool's own token units).

## Two locker instances

`BlitzrLocker.launcher` is a single address — it cannot serve both `BlitzrLauncherArc` and
`BlitzrBondingCurveArc` at once (see the core repo's "Deployment Order" docs), so a real Arc
deployment runs **two separate `BlitzrLocker` contracts**. `subgraph.yaml` declares both as
independent data sources (`BlitzrLockerV3`, `BlitzrLockerBondingCurve`) sharing one mapping file
(`src/locker.ts`); handlers never hardcode which instance is which — they read `event.address`
for the `LockerPosition.locker` field and the linked `Token.stack` for CTO attribution.

## Before deploying

Every contract address and `startBlock` in `subgraph.yaml` is a placeholder
(`0x000...00N` / `0`) — **BlitzrDotFunCore has not been deployed to Arc yet as of writing**. Fill
in:

1. The four fixed-address data sources in `subgraph.yaml` (`BlitzrLauncherArc`,
   `BlitzrLockerV3`, `BlitzrLockerBondingCurve`, `BlitzrBondingCurveArc`) with real deployed
   addresses and their deployment block numbers.
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
  locker.ts            BlitzrLocker (both instances): positions, fee claims, CTO
  bonding-curve-arc.ts BlitzrBondingCurveArc: token creation, buy/sell, migration
  tax-token-arc.ts     BlitzrTaxTokenArc clones: swap-and-liquify, reflection
  v3-pool.ts           V3 pool template: Initialize/Swap/Mint/Burn
  v2-pair.ts           V2 pair template: Swap/Mint/Burn/Sync
  utils/               constants, address sorting, pricing math, pool factory, day-data, protocol singleton
```

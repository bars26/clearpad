# Clearpad

A launchpad for [Ammora](https://ammora.org) V4 launches on GIWA Sepolia that checks graduation before anyone signs.

An Ammora bonding curve can sell out and still fail to graduate. On GIWA Sepolia, Config #6 sold its whole
1,000,000,000-token supply on the curve but needed another 333,333,333 tokens for the graduated pool, so
`migrate()` reverted with `MigrationNotReady` and buyers' WETH stayed in the curve. Ammora quarantined that Config
and asked launchpads to check readiness before requesting a creation signature. Clearpad does that check, and runs it
on every existing launch too.

## What it does

- **Launches:** every `LaunchCreated` event from the auto-route factory, with live curve status, progress and a
  graduation verdict.
- **Token page:** live curve state, the graduation check from the curve's current reserves, policy flags (LP locks,
  fees, anti-snipe, vesting), buy/sell through the SDK's swap planner, and a Graduate button that only appears when an
  `eth_call` of `migrate()` succeeds.
- **Create:** blocked Configs can't be selected. Right before the wallet prompt the Config is re-read at the current
  block, re-checked and the create call simulated. A failing check means no signature request.
- **Config audit:** every Config on the registry with its verdict, shortfall and launch count.

## The check

`src/lib/readiness.ts` mirrors the verified `ALCSegmentedPoolV4.migrate()` source in integer math, with the same
rounding:

1. The curve can absorb at least the quote target.
2. Tokens left after the curve sells out ≥ the pool's base deposit (from `postMigrationLiquidity` at the curve's final
   sqrt price) + locked vesting.
3. A non-zero `migrationBaseThreshold` equals that derived deposit.
4. Raised quote after the migration fee ≥ the pool's quote side.

For Config #6 it reports a 333,333,333-token shortfall, matching Ammora's published investigation, and the KILN
curve's live `migrate()` simulation reverts as predicted.

## SDK usage

`@ammora-protocol/sdk` 0.3.9: `getAmmoraV4ConfigAtBlock`, `getAmmoraV4NextConfigId`, `AmmoraV4LaunchCurveClient`
(state, quotes, `planSwapExactInput`, `planMigrateAtBlock`), `classifyAmmoraV4ExactInputFill`,
`buildCreateAmmoraV4Launch`, `parseAmmoraV4LaunchCreatedReceipt`, and the `giwaSepoliaAutoRouteDeployment` catalog.

## Run

```sh
npm ci
npm run dev          # http://localhost:5173
npm test             # readiness math
npm run index        # refresh public/index.json (read-only RPC)
npm run scan:configs # print every Config's verdict
npm run check:launch -- <curve address>
```

Reads are paced and retried because the public GIWA RPC rate-limits each `eth_call`. Wallet writes go through the
user's injected wallet. No keys are stored anywhere.

`public/index.json` is refreshed hourly by the `Refresh launch index` workflow.

## Disclaimer

Testnet software for GIWA Sepolia test assets. The check covers the graduation conditions above. It is not an audit of
any token, creator or of the Ammora contracts.

MIT licensed.

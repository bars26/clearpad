// Read-only: scans every Config on the GIWA auto-route registry and prints the
// graduation verdict. Usage: npx tsx scripts/scan-configs.ts [fromId] [toId]
import { getAmmoraV4ConfigAtBlock, getAmmoraV4NextConfigId, giwaSepoliaAutoRouteDeployment as d } from "@ammora-protocol/sdk";
import { assessGraduation, lockedTotal } from "../src/lib/readiness.ts";
import { publicClient as client } from "../src/lib/rpc.ts";

const block = await client.getBlockNumber();
const next = await getAmmoraV4NextConfigId(client as never, d.contracts.launch.configRegistry, block);
const from = BigInt(process.argv[2] ?? "1");
const to = BigInt(process.argv[3] ?? String(next - 1n));
for (let id = from; id <= to; id++) {
  const s = await getAmmoraV4ConfigAtBlock(client as never, d.contracts.launch.configRegistry, id, block);
  const c = s.config;
  const r = assessGraduation({
    totalSupply: c.totalSupply,
    startSqrtPrice: c.startSqrtPrice,
    segments: s.segments,
    migrationMode: c.migrationMode,
    migrationQuoteThreshold: c.migrationQuoteThreshold,
    migrationBaseThreshold: c.migrationBaseThreshold,
    migrationQuoteFeeBps: c.migrationQuoteFeeBps,
    postMigrationLiquidity: c.postMigrationLiquidity,
    postMigrationSqrtMinPrice: c.postMigrationSqrtMinPrice,
    postMigrationSqrtMaxPrice: c.postMigrationSqrtMaxPrice,
    lockedBaseTotal: lockedTotal(c.lockedBaseVesting),
    collectFeeInQuote: true,
  });
  const n = r.numbers;
  const dec = 10n ** BigInt(c.tokenDecimals);
  console.log(
    `#${id} ${s.enabled ? "on " : "off"} ${r.verdict.padEnd(7)} mode=${c.migrationMode} sold=${n.curveSold / dec} left=${n.baseLeftAfterSale / dec} needBase=${(n.baseForMigration + n.lockedBase) / dec} shortBase=${n.baseShortfall / dec} quoteShort=${n.quoteShortfall} thr=${c.migrationQuoteThreshold} baseThr=${c.migrationBaseThreshold}`,
  );
}

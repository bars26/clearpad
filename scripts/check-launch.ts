// Read-only: prints the graduation verdict for one launch curve.
// Usage: npx tsx scripts/check-launch.ts <curve>
import type { Address } from "viem";
import { loadLaunch, STATUS_LABEL } from "../src/lib/launch.ts";

const v = await loadLaunch(process.argv[2] as Address);
const dec = 10n ** BigInt(v.token.decimals);
console.log(`${v.token.symbol} config #${v.state.configId} status=${STATUS_LABEL[v.state.status]} progress=${v.progressBps / 100}%`);
console.log(`config verdict: ${v.config.readiness.verdict}; live verdict: ${v.graduation.verdict}`);
console.log(`baseReserve=${v.state.baseReserve / dec} curveLeftToSell=${v.graduation.numbers.curveSold / dec} shortfall=${v.graduation.numbers.baseShortfall / dec}`);
console.log("migrate() simulation:", v.migrateSimulation ?? "n/a (not ReadyToMigrate)");
for (const c of [...v.graduation.checks, ...v.config.flags]) console.log(` [${c.status}] ${c.title}`);

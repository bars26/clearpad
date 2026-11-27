// Read-only: lists LaunchCreated events from the auto-route factory.
// Usage: npx tsx scripts/scan-launches.ts
import { parseAbiItem } from "viem";
import { deployment as d, publicClient as client } from "../src/lib/rpc.ts";

const event = parseAbiItem(
  "event LaunchCreated(address indexed token, address indexed curve, address indexed creator, uint256 configId, bytes32 configHash, uint16 protocolVersion, string metadataURI)",
);
const head = await client.getBlockNumber();
let step = 500_000n;
const rows: { block: bigint; token: string; curve: string; creator: string; configId: bigint; uri: string }[] = [];
for (let from = d.startBlock; from <= head; ) {
  const to = from + step - 1n > head ? head : from + step - 1n;
  try {
    const logs = await client.getLogs({ address: d.contracts.launch.factory, event, fromBlock: from, toBlock: to });
    for (const l of logs) rows.push({ block: l.blockNumber, token: l.args.token!, curve: l.args.curve!, creator: l.args.creator!, configId: l.args.configId!, uri: l.args.metadataURI! });
    from = to + 1n;
  } catch (error) {
    if (step <= 10_000n) throw error;
    step /= 4n;
    console.error(`shrinking range to ${step}: ${String((error as Error).message).slice(0, 120)}`);
  }
}
console.log(`launches: ${rows.length} (head ${head})`);
const byConfig = new Map<string, number>();
for (const r of rows) byConfig.set(String(r.configId), (byConfig.get(String(r.configId)) ?? 0) + 1);
console.log([...byConfig].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `#${k}:${v}`).join(" "));
const watch = new Set((process.env.WATCH ?? "6,7,8,9,36,41,48,50").split(","));
for (const r of rows.filter((x) => watch.has(String(x.configId)))) console.log(`#${r.configId} ${r.token} curve ${r.curve} block ${r.block}`);

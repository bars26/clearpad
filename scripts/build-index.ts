// Read-only indexer. Scans LaunchCreated events incrementally, then refreshes
// every curve's status/reserves (Multicall3) and every used Config's verdict.
// Writes public/index.json for the static site.
// Usage: npx tsx scripts/build-index.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { erc20Abi, parseAbi, parseAbiItem, type Address } from "viem";
import { getAmmoraV4ConfigAtBlock, getAmmoraV4NextConfigId } from "@ammora-protocol/sdk";
import { deployment as d, publicClient as client } from "../src/lib/rpc.ts";
import { assessGraduation, isQuarantined } from "../src/lib/readiness.ts";
import { readinessInput } from "../src/lib/launch.ts";
import type { IndexFile, IndexedConfig, IndexedLaunch } from "../src/lib/indexTypes.ts";

const OUT = new URL("../public/index.json", import.meta.url);
const event = parseAbiItem(
  "event LaunchCreated(address indexed token, address indexed curve, address indexed creator, uint256 configId, bytes32 configHash, uint16 protocolVersion, string metadataURI)",
);
const curveAbi = parseAbi([
  "function status() view returns (uint8)",
  "function baseReserve() view returns (uint256)",
  "function quoteReserve() view returns (uint256)",
  "function migrationQuoteThreshold() view returns (uint256)",
]);

const previous: IndexFile | undefined = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : undefined;
const head = await client.getBlockNumber();
const launches: IndexedLaunch[] = previous?.launches ?? [];
let from = previous ? BigInt(previous.scannedTo) + 1n : d.startBlock;
let step = 7_500n;
while (from <= head) {
  const to = from + step - 1n > head ? head : from + step - 1n;
  try {
    const logs = await client.getLogs({ address: d.contracts.launch.factory, event, fromBlock: from, toBlock: to });
    for (const l of logs) {
      launches.push({
        token: l.args.token!,
        curve: l.args.curve!,
        creator: l.args.creator!,
        configId: Number(l.args.configId!),
        block: Number(l.blockNumber),
        metadataURI: l.args.metadataURI!,
        name: "",
        symbol: "",
        status: 1,
        baseReserve: "0",
        quoteReserve: "0",
        threshold: "0",
      });
    }
    from = to + 1n;
    if (step < 50_000n) step *= 2n;
  } catch {
    if (step <= 500n) throw new Error(`getLogs failed at ${from}`);
    step /= 2n;
  }
}
console.log(`launches: ${launches.length}`);
// Checkpoint the event scan so a later failure does not lose it.
const checkpoint = (configs: IndexFile["configs"]) =>
  writeFileSync(
    OUT,
    JSON.stringify({
      chainId: d.chain.id,
      factory: d.contracts.launch.factory,
      registry: d.contracts.launch.configRegistry,
      generatedAt: new Date().toISOString(),
      scannedTo: Number(head),
      configs,
      launches,
    } satisfies IndexFile),
  );
checkpoint(previous?.configs ?? {});

// Names/symbols once; statuses every run.
const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
for (const group of chunk(launches.filter((l) => !l.symbol), 40)) {
  const res = await client.multicall({
    contracts: group.flatMap((l) => [
      { address: l.token as Address, abi: erc20Abi, functionName: "name" },
      { address: l.token as Address, abi: erc20Abi, functionName: "symbol" },
    ]),
    blockNumber: head,
  });
  group.forEach((l, i) => {
    l.name = String(res[i * 2]?.result ?? "?");
    l.symbol = String(res[i * 2 + 1]?.result ?? "?");
  });
}
for (const group of chunk(launches, 30)) {
  const res = await client.multicall({
    contracts: group.flatMap((l) =>
      (["status", "baseReserve", "quoteReserve", "migrationQuoteThreshold"] as const).map((fn) => ({
        address: l.curve as Address,
        abi: curveAbi,
        functionName: fn,
      })),
    ),
    blockNumber: head,
  });
  group.forEach((l, i) => {
    const [s, b, q, t] = res.slice(i * 4, i * 4 + 4).map((r) => r.result);
    if (s !== undefined) l.status = Number(s);
    if (b !== undefined) l.baseReserve = String(b);
    if (q !== undefined) l.quoteReserve = String(q);
    if (t !== undefined) l.threshold = String(t);
  });
}

// Every Config, not only used ones: the create form needs the full catalog.
const next = await getAmmoraV4NextConfigId(client, d.contracts.launch.configRegistry, head);
const configs: Record<string, IndexedConfig> = previous?.configs ?? {};
for (let id = 1n; id < next; id++) {
  const old = configs[String(id)];
  const snapshot = await getAmmoraV4ConfigAtBlock(client, d.contracts.launch.configRegistry, id, head);
  if (old && old.configHash === snapshot.configHash && old.enabled === snapshot.enabled) continue;
  const r = assessGraduation(readinessInput(snapshot));
  const quarantined = isQuarantined(d.chain.id, d.contracts.launch.configRegistry, id, snapshot.configHash);
  configs[String(id)] = {
    id: Number(id),
    configHash: snapshot.configHash,
    owner: snapshot.identity.owner,
    enabled: snapshot.enabled,
    quarantined,
    verdict: quarantined || r.verdict === "blocked" ? "blocked" : "ready",
    failed: r.checks.filter((c) => c.status === "fail").map((c) => c.id),
    baseShortfall: String(r.numbers.baseShortfall),
    tokenDecimals: snapshot.config.tokenDecimals,
    quoteToken: snapshot.config.quoteToken,
    threshold: String(snapshot.config.migrationQuoteThreshold),
    migrationMode: snapshot.config.migrationMode,
    poolCreationFee: String(snapshot.config.poolCreationFee),
  };
}

const out: IndexFile = {
  chainId: d.chain.id,
  factory: d.contracts.launch.factory,
  registry: d.contracts.launch.configRegistry,
  generatedAt: new Date().toISOString(),
  scannedTo: Number(head),
  configs,
  launches,
};
writeFileSync(OUT, JSON.stringify(out));
const blocked = Object.values(configs).filter((c) => c.verdict === "blocked");
console.log(`configs: ${Object.keys(configs).length}, blocked: ${blocked.map((c) => `#${c.id}${c.enabled ? "(on)" : ""}`).join(" ")}`);
console.log(`launches on blocked configs: ${launches.filter((l) => configs[l.configId]?.verdict === "blocked").length}`);

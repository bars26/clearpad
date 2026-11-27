// Read-only: LaunchCreated events in the last N blocks (default 20,000).
// Usage: npx tsx scripts/recent-launches.ts [blocks]
import { parseAbiItem } from "viem";
import { deployment as d, publicClient as client } from "../src/lib/rpc.ts";

const event = parseAbiItem(
  "event LaunchCreated(address indexed token, address indexed curve, address indexed creator, uint256 configId, bytes32 configHash, uint16 protocolVersion, string metadataURI)",
);
const head = await client.getBlockNumber();
const span = BigInt(process.argv[2] ?? "20000");
for (let from = head - span; from <= head; from += 7_500n) {
  const to = from + 7_499n > head ? head : from + 7_499n;
  const logs = await client.getLogs({ address: d.contracts.launch.factory, event, fromBlock: from, toBlock: to });
  for (const l of logs) {
    console.log(`${l.blockNumber} cfg#${l.args.configId} token ${l.args.token} curve ${l.args.curve} creator ${l.args.creator} tx ${l.transactionHash}`);
  }
}

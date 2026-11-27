// Read-only: simulates the exact create call Clearpad sends, for a throwaway
// address with an overridden ETH balance. Nothing is signed or broadcast.
// Usage: npx tsx scripts/simulate-create.ts <configId>
import { decodeFunctionResult, parseAbi, type Address } from "viem";
import { buildCreateAmmoraV4Launch } from "@ammora-protocol/sdk";
import { deployment as d, publicClient } from "../src/lib/rpc.ts";
import { loadConfig } from "../src/lib/launch.ts";

const configId = BigInt(process.argv[2] ?? "10");
const view = await loadConfig(configId);
console.log(`Config #${configId}: ${view.readiness.verdict}`);
const tx = buildCreateAmmoraV4Launch(
  { name: "Clearpad Sim", symbol: "CSIM", metadataURI: "data:application/json,{}", creatorMetadataURI: "data:application/json,{}", tokenDecimals: view.snapshot.config.tokenDecimals },
  configId,
  view.snapshot.config.poolCreationFee,
);
const from = "0x00000000000000000000000000000000c1ea7bad" as Address;
try {
  const { data } = await publicClient.call({
    account: from,
    to: d.contracts.launch.factory,
    data: tx.data,
    value: tx.value,
    stateOverride: [{ address: from, balance: 10n ** 18n }],
  });
  const abi = parseAbi(["function f() returns (address token, address curve)"]);
  const [token, curve] = decodeFunctionResult({ abi, functionName: "f", data: data! });
  console.log(`create simulation OK → token ${token}, curve ${curve}, value ${tx.value}`);
} catch (error) {
  console.log("create simulation reverted:", (error as Error).message.split("\n")[0]);
}

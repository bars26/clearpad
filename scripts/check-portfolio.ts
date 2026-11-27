// Read-only: prints the portfolio Clearpad shows for a wallet.
// Usage: npx tsx scripts/check-portfolio.ts <wallet>
import { readFileSync } from "node:fs";
import { formatEther, formatUnits, type Address } from "viem";
import { loadPortfolio } from "../src/lib/portfolio.ts";

const index = JSON.parse(readFileSync(new URL("../public/index.json", import.meta.url), "utf8"));
const p = await loadPortfolio(process.argv[2] as Address, index);
console.log(`ETH ${formatEther(p.eth)} · WETH ${formatEther(p.weth)} · holdings value ≈ ${formatEther(p.totalWei)} WETH @ block ${p.asOfBlock}`);
for (const h of p.holdings) {
  console.log(`  ${h.launch.symbol.padEnd(10)} ${formatUnits(h.balance, h.decimals)} ≈ ${formatEther(h.valueWei)} WETH status ${h.status} ${h.progressBps / 100}%`);
}
console.log(`created: ${p.created.map((l) => `${l.symbol} (cfg #${l.configId})`).join(", ") || "none"}`);

// Read-only: explains why a buy would revert for a given wallet.
// Usage: npx tsx scripts/debug-buy.ts <curve> <wallet> [amountWeth]
import { decodeErrorResult, erc20Abi, formatEther, parseEther, type Address, type Hex } from "viem";
import { ammoraLaunchPoolV4Abi, classifyAmmoraV4ExactInputFill } from "@ammora-protocol/sdk";
import { publicClient as c } from "../src/lib/rpc.ts";
import { curveClient } from "../src/lib/launch.ts";
import { WETH } from "../src/lib/wallet.ts";

const [curve, wallet, amt = "0.0002"] = process.argv.slice(2) as [Address, Address, string];
const amount = parseEther(amt);
const cc = curveClient(curve);
const state = await cc.getState();
console.log("status", state.status, "quoteToken", state.quoteToken, "quoteReserve", state.quoteReserve, "threshold", state.migrationQuoteThreshold);
const [eth, weth] = await Promise.all([
  c.getBalance({ address: wallet }),
  c.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
]);
console.log("ETH", formatEther(eth), "WETH", formatEther(weth));
const q = await cc.quoteExactInput(amount, false);
console.log("quote", q, classifyAmmoraV4ExactInputFill(q, false));
const plan = await cc.planSwapExactInput({
  includedAmountIn: amount, baseForQuote: false, allowPartialFill: false, slippageBps: 100,
  recipient: wallet, deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
});
console.log("tx.to", plan.transaction.to, "value", plan.transaction.value, "approval", plan.approvalRequirement);
const allowance = await c.readContract({ address: plan.approvalRequirement.token, abi: erc20Abi, functionName: "allowance", args: [wallet, plan.approvalRequirement.spender] });
console.log("allowance", allowance);
try {
  await c.call({ account: wallet, to: plan.transaction.to, data: plan.transaction.data, value: plan.transaction.value });
  console.log("swap simulation OK");
} catch (e) {
  const data = (e as { cause?: { data?: Hex }; data?: Hex }).cause?.data ?? (e as { data?: Hex }).data;
  console.log("swap simulation reverted, data:", data, (e as Error).message.split("\n")[0]);
  if (data && data.length >= 10) {
    try { console.log("decoded:", decodeErrorResult({ abi: [...ammoraLaunchPoolV4Abi, ...erc20Abi] as never, data }).errorName); } catch { console.log("selector not in pool ABI:", data.slice(0, 10)); }
  }
}

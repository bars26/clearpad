import { erc20Abi, formatEther, type Address, type Hash } from "viem";
import {
  AmmoraSwapClient,
  ammCompoundingPoolV3Abi,
  ammConcentratedPoolV3Abi,
  getAmmoraV4ConfigAtBlock,
  giwaSepoliaAutoRoutePoolProfiles,
} from "@ammora-protocol/sdk";
import { deployment, publicClient } from "./rpc";
import { curveClient, REGISTRY } from "./launch";
import { WETH, encode, quoteTrade, send, trade as curveTrade, wrapEth, type Wallet } from "./wallet";

/**
 * Where a launch token trades right now:
 *  - "curve": bonding curve (status Pending/Trading)
 *  - "pool": the graduated Ammora pool (status Migrated)
 *  - "none": ReadyToMigrate, waiting for migrate()
 */
export type Route =
  | { kind: "curve"; curve: Address; token: Address }
  | { kind: "pool"; pool: Address; model: "concentrated" | "compounding"; token: Address; curve: Address }
  | { kind: "none"; curve: Address; token: Address };

export const resolveRoute = async (curve: Address): Promise<Route> => {
  const st = await curveClient(curve).getState();
  if (st.status === 3) {
    // migrationMode is private on the curve; the immutable Config holds it.
    const cfg = await getAmmoraV4ConfigAtBlock(publicClient, REGISTRY, st.configId, st.asOfBlock);
    const model = Number(cfg.config.migrationMode) === 1 ? "compounding" : "concentrated";
    return { kind: "pool", pool: st.canonicalPool, model, token: st.baseToken, curve };
  }
  if (st.status === 2) return { kind: "none", curve, token: st.baseToken };
  return { kind: "curve", curve, token: st.baseToken };
};

/** Builds the route from data the token page already loaded (no extra reads). */
export const routeFromView = (v: { curve: Address; state: { status: number; canonicalPool: Address; baseToken: Address }; config: { snapshot: { config: { migrationMode: number } } } }): Route => {
  const { status, canonicalPool, baseToken } = v.state;
  if (status === 3) {
    const model = Number(v.config.snapshot.config.migrationMode) === 1 ? "compounding" : "concentrated";
    return { kind: "pool", pool: canonicalPool, model, token: baseToken, curve: v.curve };
  }
  if (status === 2) return { kind: "none", curve: v.curve, token: baseToken };
  return { kind: "curve", curve: v.curve, token: baseToken };
};

let swapClient: Promise<AmmoraSwapClient> | undefined;
const swaps = () =>
  (swapClient ??= AmmoraSwapClient.create(publicClient, {
    deploymentCatalog: { [deployment.chain.id]: deployment },
    factoryProfiles: giwaSepoliaAutoRoutePoolProfiles,
  }));

export type Quote = {
  amountIn: bigint;
  amountOut: bigint;
  minimumOut?: bigint;
  amountLeft: bigint;
  fee?: bigint;
  priceImpactBps?: number | null;
  finalFill: boolean;
};

const preparePool = async (route: Extract<Route, { kind: "pool" }>, sell: boolean, amountIn: bigint, owner: Address, slippageBps: number) =>
  (await swaps()).prepareExactIn({
    model: route.model,
    pool: route.pool,
    tokenIn: sell ? route.token : WETH,
    inputAsset: "erc20",
    amountIn,
    payer: owner,
    recipient: owner,
    slippageBps,
    executionMode: "direct-wallet",
    quoteBlockNumber: await publicClient.getBlockNumber(),
  } as Parameters<AmmoraSwapClient["prepareExactIn"]>[0]);

/** Read-only quote. `sell` = launch token → WETH. */
export const quote = async (route: Route, sell: boolean, amountIn: bigint, slippageBps = 100): Promise<Quote> => {
  if (route.kind === "none") throw new Error("Waiting for graduation: trading resumes in the pool after migrate().");
  if (route.kind === "curve") {
    const q = await quoteTrade(route.curve, amountIn, sell);
    return { amountIn: q.amountIn, amountOut: q.amountOut, amountLeft: q.amountLeft, fee: q.fee, finalFill: q.fill.kind === "graduation-boundary" };
  }
  // Fast path for display: the pool's own quoteExactIn view (one eth_call).
  // Execution still goes through the SDK planner, which re-verifies the pool.
  try {
    const [amountOut, fee] = await publicClient.readContract({
      address: route.pool,
      abi: route.model === "compounding" ? ammCompoundingPoolV3Abi : ammConcentratedPoolV3Abi,
      functionName: "quoteExactIn",
      args: [sell ? route.token : WETH, amountIn],
    } as never) as readonly [bigint, bigint, bigint];
    return {
      amountIn,
      amountOut,
      minimumOut: (amountOut * BigInt(10_000 - slippageBps)) / 10_000n,
      amountLeft: 0n,
      fee,
      priceImpactBps: null,
      finalFill: false,
    };
  } catch {
    /* fall back to the full SDK planner */
  }
  // The pool planner needs a payer; quotes do not depend on it.
  const p = await preparePool(route, sell, amountIn, "0x000000000000000000000000000000000000dEaD", slippageBps);
  return {
    amountIn,
    amountOut: p.quote.expectedAmountOut,
    minimumOut: p.quote.minimumAmountOut,
    amountLeft: 0n,
    fee: p.quote.feeAmount ?? undefined,
    priceImpactBps: p.quote.priceImpactBps == null ? null : Number(p.quote.priceImpactBps),
    finalFill: false,
  };
};

const ensureInput = async (w: Wallet, token: Address, amountIn: bigint, sell: boolean, onStep: (s: string) => void) => {
  const held = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [w.address] });
  if (held >= amountIn) return;
  if (sell) throw new Error("You don't hold that many tokens. Lower the amount.");
  const shortfall = amountIn - held;
  const eth = await publicClient.getBalance({ address: w.address });
  if (eth <= shortfall) throw new Error("Not enough ETH to wrap into WETH for this buy (keep a little ETH for gas).");
  onStep(`Wrap ${formatEther(shortfall)} ETH → WETH in your wallet`);
  await wrapEth(w, shortfall);
};

/** Executes on whichever venue the route points to. */
export const execute = async (
  w: Wallet,
  route: Route,
  sell: boolean,
  amountIn: bigint,
  slippageBps: number,
  onStep: (s: string) => void,
): Promise<Hash> => {
  if (route.kind === "none") throw new Error("Waiting for graduation: trading resumes in the pool after migrate().");
  if (route.kind === "curve") return curveTrade(w, route.curve, amountIn, sell, slippageBps, onStep);

  await ensureInput(w, sell ? route.token : WETH, amountIn, sell, onStep);
  onStep("Getting a fresh pool quote");
  let plan = await preparePool(route, sell, amountIn, w.address, slippageBps);
  for (const need of plan.approvalRequirements) {
    const allowance = await publicClient.readContract({ address: need.token, abi: erc20Abi, functionName: "allowance", args: [w.address, need.spender] });
    if (allowance < need.amount) {
      onStep("Approve the exact amount in your wallet");
      if (need.resetToZero && allowance > 0n) await send(w, { to: need.token, data: encode(erc20Abi, "approve", [need.spender, 0n]) });
      await send(w, { to: need.token, data: encode(erc20Abi, "approve", [need.spender, need.amount]) });
      // Re-quote after the approval block so the minimum output is current.
      plan = await preparePool(route, sell, amountIn, w.address, slippageBps);
    }
  }
  onStep("Confirm the swap in your wallet");
  const { hash } = await send(w, { to: plan.transaction.to, data: plan.transaction.data, value: plan.transaction.value });
  return hash;
};

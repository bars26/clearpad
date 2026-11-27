import { erc20Abi, parseAbi, type Address } from "viem";
import {
  AmmoraV4LaunchCurveClient,
  getAmmoraV4ConfigAtBlock,
  type AmmoraV4ConfigSnapshot,
  type AmmoraV4LaunchCurveState,
} from "@ammora-protocol/sdk";
import { deployment, publicClient } from "./rpc";
import { assessGraduation, isQuarantined, lockedTotal, type Check, type Readiness } from "./readiness";

const L = deployment.contracts.launch;
export const CORE = { launchFactory: L.factory, feePolicy: L.feePolicy } as const;
export const REGISTRY = L.configRegistry;

export const STATUS_LABEL: Record<number, string> = {
  0: "Pending",
  1: "Trading",
  2: "Ready to migrate",
  3: "Graduated",
  4: "Pending (block)",
};

export type ConfigView = { snapshot: AmmoraV4ConfigSnapshot; readiness: Readiness; flags: Check[]; quarantined: boolean };

export const readinessInput = (s: AmmoraV4ConfigSnapshot) => {
  const c = s.config;
  return {
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
  };
};

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

/** Plain-language policy flags a buyer should see. Informational, not pass/fail. */
export const policyFlags = (s: AmmoraV4ConfigSnapshot): Check[] => {
  const c = s.config;
  const d = c.liquidityDistribution;
  const flags: Check[] = [];
  flags.push({
    id: "lp-unlocked",
    status: d.partnerUnlockedBps > 5000 ? "warn" : "pass",
    title: `Graduated LP: ${pct(d.partnerUnlockedBps)} unlocked to the launchpad`,
    detail: `Permanently locked: ${pct(d.partnerPermanentLockedBps)} launchpad, ${pct(d.creatorPermanentLockedBps)} creator. Vesting: ${pct(d.partnerVesting.allocationBps)} launchpad, ${pct(d.creatorVesting.allocationBps)} creator. Unlocked LP can be withdrawn from the graduated pool at any time.`,
  });
  flags.push({
    id: "fees",
    status: c.cliffFeeBps > 1000 ? "warn" : "pass",
    title: `Curve trading fee starts at ${pct(c.cliffFeeBps)}`,
    detail: `Creator gets ${pct(c.creatorShareOfNonProtocolBps)} of the non-protocol share. Graduated pool fee: ${pct(c.postMigrationFeeBps)}. Migration fee on raised quote: ${pct(c.migrationQuoteFeeBps)}.`,
  });
  flags.push({
    id: "snipe",
    status: c.rateLimiterEnabled || c.feeSchedulerMode !== 0 || c.dynamicFeeEnabled ? "pass" : "warn",
    title: c.rateLimiterEnabled || c.feeSchedulerMode !== 0 ? "Launch anti-snipe protection on" : "No anti-snipe fee schedule",
    detail: `Rate limiter ${c.rateLimiterEnabled ? "on" : "off"}, fee scheduler mode ${c.feeSchedulerMode}, dynamic fee ${c.dynamicFeeEnabled ? "on" : "off"}.`,
  });
  const locked = lockedTotal(c.lockedBaseVesting);
  flags.push({
    id: "vesting",
    status: "pass",
    title: locked === 0n ? "No creator token allocation" : "Creator allocation vests on-chain",
    detail:
      locked === 0n
        ? "Every token is either sold on the curve or deposited into the graduated pool."
        : `${((locked * 10_000n) / c.totalSupply) / 100n}% of supply is released by the vesting schedule, not handed out at launch.`,
  });
  return flags;
};

export const loadConfig = async (configId: bigint, block?: bigint): Promise<ConfigView> => {
  const at = block ?? (await publicClient.getBlockNumber());
  const snapshot = await getAmmoraV4ConfigAtBlock(publicClient, REGISTRY, configId, at);
  const quarantined = isQuarantined(deployment.chain.id, REGISTRY, configId, snapshot.configHash);
  const readiness = assessGraduation(readinessInput(snapshot));
  if (quarantined) {
    readiness.verdict = "blocked";
    readiness.checks.unshift({
      id: "quarantine",
      status: "fail",
      title: "Quarantined by Ammora",
      detail: "Ammora's graduation incident notice blocks this Config identity for new launches.",
    });
  }
  if (!snapshot.enabled) {
    readiness.checks.unshift({ id: "enabled", status: "fail", title: "Config disabled", detail: "The registry no longer accepts new launches on this Config." });
    readiness.verdict = "blocked";
  }
  return { snapshot, readiness, flags: policyFlags(snapshot), quarantined };
};

export type TokenMeta = { name: string; symbol: string; decimals: number; totalSupply: bigint };

export const readToken = async (token: Address): Promise<TokenMeta> => {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  return { name, symbol, decimals, totalSupply };
};

const migrateAbi = parseAbi(["function migrate() returns (address)", "error MigrationNotReady()", "error Reentrancy()"]);

export type LaunchView = {
  curve: Address;
  state: AmmoraV4LaunchCurveState;
  config: ConfigView;
  token: TokenMeta;
  quote: TokenMeta;
  progressBps: number;
  graduation: Readiness;
  /** Result of eth_call migrate() when status is ReadyToMigrate. */
  migrateSimulation?: { ok: boolean; error?: string };
};

export const curveClient = (curve: Address) => new AmmoraV4LaunchCurveClient(publicClient, curve, CORE);

export const curveForToken = (token: Address) =>
  publicClient.readContract({
    address: L.factory,
    abi: parseAbi(["function curveForToken(address) view returns (address)"]),
    functionName: "curveForToken",
    args: [token],
  });

export const loadLaunch = async (curve: Address): Promise<LaunchView> => {
  const block = await publicClient.getBlockNumber();
  const client = curveClient(curve);
  const state = await client.getStateAtBlock(block);
  const [config, token, quote] = await Promise.all([
    loadConfig(state.configId, block),
    readToken(state.baseToken),
    readToken(state.quoteToken),
  ]);
  const threshold = state.migrationQuoteThreshold;
  const progressBps =
    state.status === 3 ? 10_000 : threshold === 0n ? 0 : Number(((state.quoteReserve > threshold ? threshold : state.quoteReserve) * 10_000n) / threshold);
  const graduation = assessGraduation(readinessInput(config.snapshot), {
    baseReserveNow: state.baseReserve,
    sqrtPriceNow: state.sqrtPrice,
  });
  let migrateSimulation: LaunchView["migrateSimulation"];
  if (state.status === 2) {
    try {
      // An explicit account keeps this call out of Multicall3 batching, which would
      // swallow the revert data.
      await publicClient.simulateContract({
        account: "0x000000000000000000000000000000000000dEaD",
        address: curve,
        abi: migrateAbi,
        functionName: "migrate",
        blockNumber: block,
      });
      migrateSimulation = { ok: true };
    } catch (error) {
      migrateSimulation = { ok: false, error: shortError(error) };
    }
  }
  return { curve, state, config, token, quote, progressBps, graduation, migrateSimulation };
};

const KNOWN =
  /MigrationNotReady|PartialFillRequired|SlippageExceeded|TradingInactive|DeadlineExpired|ConfigDisabled|InvalidConfiguration|User rejected|insufficient funds/i;

export const shortError = (error: unknown) => {
  // viem nests the decoded custom error (errorName) somewhere in the cause chain.
  for (let e = error as { errorName?: string; data?: { errorName?: string }; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    const name = e.data?.errorName ?? e.errorName;
    if (name) return name;
  }
  const e = error as { shortMessage?: string; message?: string; details?: string };
  const text = [e?.shortMessage, e?.details, e?.message].filter(Boolean).join("\n") || String(error);
  const known = KNOWN.exec(text);
  return known ? known[0] : (e?.shortMessage ?? text).split("\n")[0]!.slice(0, 180);
};

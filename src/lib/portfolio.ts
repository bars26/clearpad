import { erc20Abi, parseAbi, parseAbiItem, type Address } from "viem";
import type { IndexFile, IndexedLaunch } from "./indexTypes";
import { deployment, publicClient } from "./rpc";
import { WETH } from "./wallet";

const curveAbi = parseAbi([
  "function sqrtPrice() view returns (uint128)",
  "function status() view returns (uint8)",
  "function quoteReserve() view returns (uint256)",
  "function migrationQuoteThreshold() view returns (uint256)",
]);
const launchCreated = parseAbiItem(
  "event LaunchCreated(address indexed token, address indexed curve, address indexed creator, uint256 configId, bytes32 configHash, uint16 protocolVersion, string metadataURI)",
);

export type Holding = {
  launch: IndexedLaunch;
  balance: bigint;
  decimals: number;
  /** Curve spot price, raw quote per raw base (Q128-scaled numerator handled in valueWei). */
  valueWei: bigint;
  status: number;
  progressBps: number;
};

export type Portfolio = {
  owner: Address;
  eth: bigint;
  weth: bigint;
  holdings: Holding[];
  created: IndexedLaunch[];
  totalWei: bigint;
  asOfBlock: bigint;
};

const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Launches created after the static index was built, read straight from the factory. */
export const recentLaunches = async (index: IndexFile, head: bigint): Promise<IndexedLaunch[]> => {
  const ranges: [bigint, bigint][] = [];
  for (let from = BigInt(index.scannedTo) + 1n; from <= head; from += 7_500n) {
    ranges.push([from, from + 7_499n > head ? head : from + 7_499n]);
  }
  // The transport caps parallelism, so issuing every range at once is safe.
  const pages = await Promise.all(
    ranges.map(([fromBlock, toBlock]) =>
      publicClient.getLogs({ address: deployment.contracts.launch.factory, event: launchCreated, fromBlock, toBlock }),
    ),
  );
  return pages.flat().map((l) => ({
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
  }));
};

export const loadPortfolio = async (owner: Address, index: IndexFile): Promise<Portfolio> => {
  const head = await publicClient.getBlockNumber();
  const balancesP = Promise.all([
    publicClient.getBalance({ address: owner, blockNumber: head }),
    publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [owner], blockNumber: head }),
  ]);
  const fresh = await recentLaunches(index, head).catch(() => []);
  const known = new Set(index.launches.map((l) => l.token.toLowerCase()));
  const all = [...index.launches, ...fresh.filter((l) => !known.has(l.token.toLowerCase()))];

  const [eth, weth] = await balancesP;

  // Balances for every launch token, 150 per Multicall3 request.
  const held: { launch: IndexedLaunch; balance: bigint }[] = [];
  const groups = chunk(all, 150);
  const results = await Promise.all(
    groups.map((group) =>
      publicClient.multicall({
        contracts: group.map((l) => ({ address: l.token as Address, abi: erc20Abi, functionName: "balanceOf" as const, args: [owner] })),
        blockNumber: head,
      }),
    ),
  );
  groups.forEach((group, g) =>
    group.forEach((l, i) => {
      const b = results[g]![i]?.result;
      if (typeof b === "bigint" && b > 0n) held.push({ launch: l, balance: b });
    }),
  );

  // Price, status and metadata only for what the wallet holds or created.
  const created = all.filter((l) => l.creator.toLowerCase() === owner.toLowerCase());
  const detail = [...new Map([...held.map((h) => h.launch), ...created].map((l) => [l.curve.toLowerCase(), l])).values()];
  const info = new Map<string, { sqrtPrice: bigint; status: number; progressBps: number; decimals: number; name: string; symbol: string }>();
  for (const group of chunk(detail, 25)) {
    const res = await publicClient.multicall({
      contracts: group.flatMap((l) => [
        { address: l.curve as Address, abi: curveAbi, functionName: "sqrtPrice" as const },
        { address: l.curve as Address, abi: curveAbi, functionName: "status" as const },
        { address: l.curve as Address, abi: curveAbi, functionName: "quoteReserve" as const },
        { address: l.curve as Address, abi: curveAbi, functionName: "migrationQuoteThreshold" as const },
        { address: l.token as Address, abi: erc20Abi, functionName: "decimals" as const },
        { address: l.token as Address, abi: erc20Abi, functionName: "name" as const },
        { address: l.token as Address, abi: erc20Abi, functionName: "symbol" as const },
      ]),
      blockNumber: head,
    });
    group.forEach((l, i) => {
      const r = res.slice(i * 7, i * 7 + 7).map((x) => x.result);
      const status = Number(r[1] ?? l.status);
      const q = (r[2] as bigint | undefined) ?? 0n;
      const t = (r[3] as bigint | undefined) ?? 0n;
      info.set(l.curve.toLowerCase(), {
        sqrtPrice: (r[0] as bigint | undefined) ?? 0n,
        status,
        progressBps: status === 3 ? 10_000 : t === 0n ? 0 : Number(((q > t ? t : q) * 10_000n) / t),
        decimals: Number(r[4] ?? 18),
        name: String(r[5] ?? l.name),
        symbol: String(r[6] ?? l.symbol),
      });
    });
  }

  const withMeta = (l: IndexedLaunch) => {
    const m = info.get(l.curve.toLowerCase());
    return m ? { ...l, name: m.name || l.name, symbol: m.symbol || l.symbol, status: m.status } : l;
  };

  const holdings: Holding[] = held
    .map(({ launch, balance }) => {
      const m = info.get(launch.curve.toLowerCase());
      const sp = m?.sqrtPrice ?? 0n;
      // Spot price on the curve: (sqrtPrice / 2^64)^2 quote per base, in raw units.
      const valueWei = (balance * sp * sp) >> 128n;
      return {
        launch: withMeta(launch),
        balance,
        decimals: m?.decimals ?? 18,
        valueWei,
        status: m?.status ?? launch.status,
        progressBps: m?.progressBps ?? 0,
      };
    })
    .sort((a, b) => (b.valueWei > a.valueWei ? 1 : b.valueWei < a.valueWei ? -1 : 0));

  return {
    owner,
    eth,
    weth,
    holdings,
    created: created.map(withMeta).reverse(),
    totalWei: holdings.reduce((s, h) => s + h.valueWei, 0n),
    asOfBlock: head,
  };
};

import { useEffect, useState } from "react";
import { erc20Abi, isAddress, type Address } from "viem";
import type { IndexFile, IndexedLaunch } from "../lib/indexTypes";
import { recentLaunches } from "../lib/portfolio";
import { publicClient } from "../lib/rpc";
import type { Wallet } from "../lib/wallet";
import { SwapBox } from "../components/SwapBox";

type Props = { index?: IndexFile; wallet?: Wallet; onConnect: () => void; curve?: string };

/** Launches created after the static index, with names filled in. */
const useFreshLaunches = (index?: IndexFile) => {
  const [extra, setExtra] = useState<IndexedLaunch[]>([]);
  useEffect(() => {
    if (!index) return;
    let live = true;
    void (async () => {
      const head = await publicClient.getBlockNumber();
      const fresh = await recentLaunches(index, head).catch(() => []);
      if (!fresh.length) return;
      const res = await publicClient.multicall({
        contracts: fresh.flatMap((l) => [
          { address: l.token as Address, abi: erc20Abi, functionName: "symbol" as const },
          { address: l.token as Address, abi: erc20Abi, functionName: "name" as const },
        ]),
      });
      const named = fresh.map((l, i) => ({ ...l, symbol: String(res[i * 2]?.result ?? "?"), name: String(res[i * 2 + 1]?.result ?? "") }));
      if (live) setExtra(named);
    })();
    return () => {
      live = false;
    };
  }, [index]);
  return extra;
};

export const Swap = ({ index, wallet, onConnect, curve }: Props) => {
  const extra = useFreshLaunches(index);
  const initial = curve && isAddress(curve) ? (curve as Address) : undefined;
  return (
    <div className="swap-page">
      <div className="swap-intro">
        <span className="eyebrow">Swap</span>
        <h1 style={{ marginTop: "1rem" }}>
          Trade any launch, <span className="grad-text">wherever it lives.</span>
        </h1>
        <p className="muted">
          Pick a token and Clearpad routes the trade for you: through its bonding curve while it's live, or through its
          Ammora pool once it has graduated. Every swap is simulated before your wallet opens.
        </p>
      </div>
      <SwapBox key={initial ?? "free"} index={index} wallet={wallet} onConnect={onConnect} extra={extra} curve={undefined} initialCurve={initial} />
    </div>
  );
};

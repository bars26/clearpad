import { useCallback, useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import type { IndexFile } from "../lib/indexTypes";
import { loadPortfolio, type Portfolio as P } from "../lib/portfolio";
import { shortError, STATUS_LABEL } from "../lib/launch";
import type { Wallet } from "../lib/wallet";
import { AddressLink, Avatar, Notice, Ring, Verdict, fmt, short } from "../ui";

type Props = { index?: IndexFile; wallet?: Wallet; onConnect: () => void; address?: string };

export const Portfolio = ({ index, wallet, onConnect, address }: Props) => {
  const owner = (address && isAddress(address) ? address : wallet?.address) as Address | undefined;
  const [data, setData] = useState<P>();
  const [err, setErr] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState("");

  const load = useCallback(async () => {
    if (!owner || !index) return;
    setLoading(true);
    setErr(undefined);
    try {
      setData(await loadPortfolio(owner, index));
    } catch (e) {
      setErr(shortError(e));
    } finally {
      setLoading(false);
    }
  }, [owner, index]);

  useEffect(() => {
    setData(undefined);
    void load();
  }, [load]);

  const blocked = (configId: number) => index?.configs[configId]?.verdict === "blocked";
  const mine = !!wallet && owner?.toLowerCase() === wallet.address.toLowerCase();

  if (!owner) {
    return (
      <section className="empty">
        <span className="eyebrow">Portfolio</span>
        <h1 style={{ marginTop: "1rem" }}>
          Your <span className="grad-text">bag</span>, checked.
        </h1>
        <p className="muted">
          Connect a wallet to see every Ammora launch token you hold on GIWA Sepolia, its value on the curve, and whether
          it can still graduate. Or look up any address.
        </p>
        <div className="hero-cta">
          <button className="btn primary lg" onClick={onConnect}>
            Connect wallet
          </button>
        </div>
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            if (isAddress(lookup.trim())) window.location.hash = `#/portfolio/${lookup.trim()}`;
          }}
        >
          <input placeholder="0x… any wallet address" value={lookup} onChange={(e) => setLookup(e.target.value)} />
          <button className="btn" type="submit" disabled={!isAddress(lookup.trim())}>
            Look up
          </button>
        </form>
      </section>
    );
  }

  return (
    <>
      <section className="pf-head">
        <div>
          <span className="eyebrow">{mine ? "Your portfolio" : "Portfolio"}</span>
          <h1 style={{ margin: "1rem 0 .3rem" }}>
            <span className="mono">{short(owner)}</span>
          </h1>
          <p className="muted small">
            <AddressLink address={owner} label="View on GIWA explorer ↗" />
            {data && <> · block {data.asOfBlock.toLocaleString()}</>}
          </p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      {err && <Notice kind="error">{err}</Notice>}
      {!data && !err && <p className="muted">Reading balances for every launch token…</p>}

      {data && (
        <>
          <div className="stats">
            <div className="stat good">
              <strong>{fmt(data.totalWei, 18, 4)}</strong>
              <span>WETH value of tokens (curve price)</span>
            </div>
            <div className="stat">
              <strong>{data.holdings.length}</strong>
              <span>tokens held</span>
            </div>
            <div className="stat">
              <strong>{fmt(data.weth, 18, 4)}</strong>
              <span>WETH</span>
            </div>
            <div className="stat">
              <strong>{fmt(data.eth, 18, 4)}</strong>
              <span>ETH for gas</span>
            </div>
          </div>

          <div className="section-head">
            <h2>Holdings</h2>
            <span className="muted small">Value uses each curve's current spot price; graduated tokens show their final curve price.</span>
          </div>
          {data.holdings.length === 0 ? (
            <div className="panel center">
              <p className="muted">No launch tokens in this wallet yet.</p>
              <a className="btn primary" href="#/">
                Browse launches
              </a>
            </div>
          ) : (
            <div className="holdings">
              {data.holdings.map((h) => {
                const bad = blocked(h.launch.configId);
                const done = h.status === 3;
                const share = data.totalWei > 0n ? Number((h.valueWei * 1000n) / data.totalWei) / 10 : 0;
                return (
                  <a key={h.launch.curve} className={`holding ${bad ? "card-bad" : ""}`} href={`#/token/${h.launch.curve}`}>
                    <div className="card-title">
                      <Avatar seed={h.launch.token} symbol={h.launch.symbol} />
                      <div>
                        <strong>{h.launch.symbol}</strong>
                        <span>{h.launch.name}</span>
                      </div>
                    </div>
                    <div className="h-num">
                      <b>{fmt(h.balance, h.decimals)}</b>
                      <span>{h.launch.symbol}</span>
                    </div>
                    <div className="h-num">
                      <b>{fmt(h.valueWei, 18, 4)}</b>
                      <span>WETH · {share}%</span>
                    </div>
                    <div className="h-state">
                      <Ring bps={h.progressBps} size={44} stroke={4} tone={bad ? "bad" : done ? "done" : "aurora"} label={done ? "✓" : undefined} />
                      <div>
                        {done ? <Verdict ok>Graduated</Verdict> : <Verdict ok={!bad} />}
                        {!done && <span className="muted small">{STATUS_LABEL[h.status] ?? h.status}</span>}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}

          {data.created.length > 0 && (
            <>
              <div className="section-head" style={{ marginTop: "2rem" }}>
                <h2>Launched by {mine ? "you" : "this wallet"}</h2>
              </div>
              <div className="grid">
                {data.created.map((l) => (
                  <a key={l.curve} className={`card ${blocked(l.configId) ? "card-bad" : ""}`} href={`#/token/${l.curve}`}>
                    <div className="card-title">
                      <Avatar seed={l.token} symbol={l.symbol} />
                      <div>
                        <strong>{l.symbol}</strong>
                        <span>{l.name}</span>
                      </div>
                    </div>
                    {l.status === 3 ? <Verdict ok>Graduated</Verdict> : <Verdict ok={!blocked(l.configId)} />}
                    <div className="card-foot">
                      <span className="tag">{STATUS_LABEL[l.status] ?? l.status}</span>
                      <span className="tag">Config #{l.configId}</span>
                      <span className="mono">{short(l.token)}</span>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
};

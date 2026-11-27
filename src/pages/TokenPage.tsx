import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, parseUnits, zeroAddress, type Address } from "viem";
import type { IndexFile } from "../lib/indexTypes";
import { curveForToken, loadLaunch, shortError, STATUS_LABEL, type LaunchView } from "../lib/launch";
import { balances, graduate, quoteTrade, trade, wrapEth, type TradeQuote, type Wallet } from "../lib/wallet";
import { AddressLink, Avatar, CheckList, CurveChart, InventoryBars, Notice, Ring, TxLink, Verdict, fmt } from "../ui";

type Props = { curveOrToken: string; wallet?: Wallet; onConnect: () => void; index?: IndexFile };

export const TokenPage = ({ curveOrToken, wallet, onConnect, index }: Props) => {
  const [view, setView] = useState<LaunchView>();
  const [error, setError] = useState<string>();
  const indexRef = useRef(index);
  indexRef.current = index;

  const load = useCallback(async () => {
    setError(undefined);
    try {
      if (!isAddress(curveOrToken)) throw new Error("Not an address");
      const known = indexRef.current?.launches.find(
        (l) => l.curve.toLowerCase() === curveOrToken.toLowerCase() || l.token.toLowerCase() === curveOrToken.toLowerCase(),
      );
      let curve = known?.curve as Address | undefined;
      if (!curve) {
        const fromFactory = await curveForToken(curveOrToken);
        curve = fromFactory !== zeroAddress ? fromFactory : (curveOrToken as Address);
      }
      setView(await loadLaunch(curve));
    } catch (e) {
      setError(shortError(e));
    }
  }, [curveOrToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Notice kind="error">Could not read this launch: {error}</Notice>;
  if (!view) return <p className="muted">Reading the curve, its Config and the graduation math from GIWA Sepolia…</p>;

  const { state, token, quote, graduation, config } = view;
  const ok = graduation.verdict === "ready" && config.readiness.verdict !== "blocked";
  const n = graduation.numbers;
  const migrated = state.status === 3;

  const fmtTok = (v: bigint) => `${fmt(v, token.decimals)} ${token.symbol}`;
  const verdictTitle = migrated
    ? "Graduated"
    : ok
      ? "This launch can graduate"
      : "This launch can never graduate";
  const verdictText = migrated
    ? "The curve sold out and migrate() moved its liquidity into an Ammora pool."
    : ok
      ? "When the curve sells out, there are enough tokens and WETH left to seed the pool."
      : `After a sell-out the pool would be ${fmtTok(n.baseShortfall)} short, so migrate() reverts and buyers' WETH stays in the curve.`;

  return (
    <div className="token">
      <p className="crumbs">
        <a href="#/">← All launches</a>
      </p>
      <section className="token-head">
        <div className="token-id">
          <Avatar seed={state.baseToken} symbol={token.symbol} />
          <div>
            <h1>
              {token.symbol} <span>{token.name}</span>
            </h1>
            <div className="meta">
              <span>
                Token <AddressLink address={state.baseToken} />
              </span>
              <span>
                Curve <AddressLink address={view.curve} />
              </span>
              <span>
                Creator <AddressLink address={state.creator} />
              </span>
              <a href={`#/audit/${state.configId}`}>Config #{String(state.configId)}</a>
            </div>
          </div>
        </div>
        {migrated ? <Verdict ok>Graduated</Verdict> : <Verdict ok={ok} />}
      </section>

      <div className="cols">
        <div>
          <div className={`big-verdict ${ok || migrated ? "ok" : "bad"}`}>
            <span className="bv-icon">{ok || migrated ? "✓" : "✕"}</span>
            <div>
              <strong>{verdictTitle}</strong>
              <span>{verdictText}</span>
            </div>
          </div>

          <section className="panel glow">
            <h2>Bonding curve</h2>
            <div className="curve-wrap">
              <Ring
                bps={view.progressBps}
                size={112}
                stroke={9}
                tone={migrated ? "done" : ok ? "aurora" : "bad"}
                label={
                  <span style={{ textAlign: "center", lineHeight: 1.1 }}>
                    <span style={{ fontSize: "1.25rem" }}>{(view.progressBps / 100).toFixed(view.progressBps < 1000 ? 1 : 0)}%</span>
                    <br />
                    <span className="muted" style={{ fontSize: ".68rem", fontWeight: 600 }}>
                      to target
                    </span>
                  </span>
                }
              />
              <CurveChart bps={view.progressBps} blocked={!ok && !migrated} done={migrated} />
            </div>
            <dl className="kv">
              <dt>Status</dt>
              <dd>{STATUS_LABEL[state.status] ?? state.status}</dd>
              <dt>Raised</dt>
              <dd>
                {fmt(state.quoteReserve, quote.decimals)} / {fmt(state.migrationQuoteThreshold, quote.decimals)} {quote.symbol}
              </dd>
              <dt>Tokens in curve</dt>
              <dd>{fmtTok(state.baseReserve)}</dd>
              <dt>Current fee</dt>
              <dd>{(state.currentFeeBps / 100).toFixed(2)}%</dd>
              {migrated && (
                <>
                  <dt>Graduated pool</dt>
                  <dd>
                    <AddressLink address={state.canonicalPool} />
                  </dd>
                </>
              )}
            </dl>
          </section>

          {!migrated && (
            <section className="panel">
              <h2>Graduation check</h2>
              <p className="muted small">
                Replays <code>migrate()</code> from this curve's live reserves, assuming the rest of the curve sells out.
              </p>
              <InventoryBars left={n.baseLeftAfterSale} need={n.baseForMigration + n.lockedBase} label={(v) => (v > 0n && v < 10n ** BigInt(token.decimals) ? "< 1" : fmt(v, token.decimals))} />
              <CheckList checks={graduation.checks} />
              <dl className="kv">
                <dt>Still sellable on the curve</dt>
                <dd>{fmtTok(n.curveSold)}</dd>
                {n.baseShortfall > 0n && (
                  <>
                    <dt>Shortfall</dt>
                    <dd className="bad-text">{fmtTok(n.baseShortfall)}</dd>
                  </>
                )}
              </dl>
              {view.migrateSimulation && (
                <Notice kind={view.migrateSimulation.ok ? "ok" : "error"}>
                  Live <code>eth_call migrate()</code>:{" "}
                  {view.migrateSimulation.ok ? "succeeds. Anyone can graduate this launch now." : `reverts (${view.migrateSimulation.error}).`}
                </Notice>
              )}
            </section>
          )}

          <section className="panel">
            <h2>Launch policy</h2>
            <CheckList checks={config.flags} />
          </section>
        </div>

        <div>
          {state.status === 1 || state.status === 0 || state.status === 4 ? (
            <TradePanel view={view} wallet={wallet} onConnect={onConnect} onDone={load} safe={ok} />
          ) : state.status === 2 ? (
            <GraduatePanel view={view} wallet={wallet} onConnect={onConnect} onDone={load} />
          ) : (
            <section className="panel">
              <h2>Trade</h2>
              <p className="muted">This launch has graduated. It now trades in its Ammora pool.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

const TradePanel = ({
  view,
  wallet,
  onConnect,
  onDone,
  safe,
}: {
  view: LaunchView;
  wallet?: Wallet;
  onConnect: () => void;
  onDone: () => void;
  safe: boolean;
}) => {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.001");
  const [slippage, setSlippage] = useState(100);
  const [q, setQ] = useState<TradeQuote>();
  const [qErr, setQErr] = useState<string>();
  const [bal, setBal] = useState<{ eth: bigint; weth: bigint; base: bigint }>();
  const [step, setStep] = useState<string>();
  const [done, setDone] = useState<string>();
  const [err, setErr] = useState<string>();
  const [ack, setAck] = useState(false);
  const { token, quote, curve, state } = view;
  const inDecimals = side === "buy" ? quote.decimals : token.decimals;

  useEffect(() => {
    if (wallet) void balances(wallet.address, state.baseToken).then(setBal);
  }, [wallet, state.baseToken, done]);

  useEffect(() => {
    setQ(undefined);
    setQErr(undefined);
    let raw: bigint;
    try {
      raw = parseUnits(amount || "0", inDecimals);
    } catch {
      setQErr("Enter a number");
      return;
    }
    if (raw === 0n) return;
    const t = setTimeout(() => {
      quoteTrade(curve, raw, side === "sell").then(setQ, (e) => setQErr(shortError(e)));
    }, 350);
    return () => clearTimeout(t);
  }, [amount, side, curve, inDecimals]);

  const go = async () => {
    if (!wallet) return onConnect();
    setErr(undefined);
    setDone(undefined);
    try {
      const raw = parseUnits(amount, inDecimals);
      const hash = await trade(wallet, curve, raw, side === "sell", slippage, setStep);
      setDone(hash);
      onDone();
    } catch (e) {
      setErr(shortError(e));
    } finally {
      setStep(undefined);
    }
  };

  const wrap = async () => {
    if (!wallet) return onConnect();
    setErr(undefined);
    try {
      setStep("Wrap ETH in your wallet");
      const { hash } = await wrapEth(wallet, parseUnits(amount, 18));
      setDone(hash);
    } catch (e) {
      setErr(shortError(e));
    } finally {
      setStep(undefined);
    }
  };

  const outSymbol = side === "buy" ? token.symbol : quote.symbol;
  const outDecimals = side === "buy" ? token.decimals : quote.decimals;
  const needsAck = !safe && side === "buy";

  return (
    <section className="panel sticky glow">
      <h2>Trade on the curve</h2>
      <div className="segmented full">
        <button className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>
          Sell
        </button>
      </div>
      <label className="field">
        <span>
          You pay ({side === "buy" ? quote.symbol : token.symbol})
          {bal && (
            <button
              className="link"
              onClick={() => setAmount((Number(side === "buy" ? bal.weth : bal.base) / 10 ** inDecimals).toString())}
            >
              Balance {fmt(side === "buy" ? bal.weth : bal.base, inDecimals)}
            </button>
          )}
        </span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="quote">
        {qErr ? (
          <span className="bad-text">{qErr}</span>
        ) : q ? (
          <>
            <div>
              You get ≈ <strong>{fmt(q.amountOut, outDecimals, 6)}</strong> {outSymbol}
            </div>
            <div className="muted small">
              Fee {fmt(q.fee, side === "buy" ? quote.decimals : token.decimals, 4)} · min received after {slippage / 100}%
              slippage
            </div>
            {q.fill.kind === "graduation-boundary" && (
              <div className="muted small">
                This is the final fill. {fmt(q.amountLeft, inDecimals)} {side === "buy" ? quote.symbol : token.symbol}{" "}
                will be returned.
              </div>
            )}
          </>
        ) : (
          <span className="muted">Enter an amount</span>
        )}
      </div>
      <label className="field inline">
        <span>Slippage</span>
        <select value={slippage} onChange={(e) => setSlippage(Number(e.target.value))}>
          <option value={50}>0.5%</option>
          <option value={100}>1%</option>
          <option value={300}>3%</option>
        </select>
      </label>
      {needsAck && (
        <label className="ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I understand this launch cannot graduate and my {quote.symbol} may stay locked in the curve.</span>
        </label>
      )}
      <button className="btn primary full" disabled={!!step || (!!wallet && (!q || (needsAck && !ack)))} onClick={go}>
        {step ?? (wallet ? (side === "buy" ? "Buy" : "Sell") : "Connect wallet")}
      </button>
      {side === "buy" && bal && bal.weth === 0n && (
        <p className="muted small">
          Buys are paid in WETH. You have {fmt(bal.eth, 18)} ETH.{" "}
          <button className="link" onClick={wrap} disabled={!!step}>
            Wrap {amount} ETH
          </button>
        </p>
      )}
      {done && (
        <Notice kind="ok">
          Confirmed: <TxLink hash={done} />
        </Notice>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </section>
  );
};

const GraduatePanel = ({
  view,
  wallet,
  onConnect,
  onDone,
}: {
  view: LaunchView;
  wallet?: Wallet;
  onConnect: () => void;
  onDone: () => void;
}) => {
  const [step, setStep] = useState<string>();
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<string>();
  const ok = view.migrateSimulation?.ok;
  const go = async () => {
    if (!wallet) return onConnect();
    setErr(undefined);
    try {
      setDone(await graduate(wallet, view.curve, setStep));
      onDone();
    } catch (e) {
      setErr(shortError(e));
    } finally {
      setStep(undefined);
    }
  };
  return (
    <section className="panel sticky glow">
      <h2>Graduation</h2>
      {ok ? (
        <>
          <p>The target is reached and the live simulation passes. Graduation is permissionless: anyone can send it.</p>
          <button className="btn primary full" disabled={!!step} onClick={go}>
            {step ?? (wallet ? "Graduate to the Ammora pool" : "Connect wallet")}
          </button>
        </>
      ) : (
        <p>
          The target is reached, but <code>migrate()</code> reverts. Clearpad will not ask for a signature that is certain
          to fail. Funds in this curve need an operator recovery path; nothing a holder sends can fix it.
        </p>
      )}
      {done && (
        <Notice kind="ok">
          Graduated: <TxLink hash={done} />
        </Notice>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </section>
  );
};

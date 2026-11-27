import { useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import type { IndexFile, IndexedLaunch } from "../lib/indexTypes";
import { publicClient } from "../lib/rpc";
import { shortError, STATUS_LABEL } from "../lib/launch";
import { execute, quote, resolveRoute, type Quote, type Route } from "../lib/trade";
import { WETH, wrapEth, type Wallet } from "../lib/wallet";
import { Avatar, Notice, TxLink, Verdict, fmt, short } from "../ui";

type Props = {
  wallet?: Wallet;
  onConnect: () => void;
  index?: IndexFile;
  /** Lock the box to one launch (token page). */
  curve?: Address;
  /** Route and token metadata the caller already has (skips re-reading them). */
  preset?: { route: Route; meta: TokenMeta };
  /** Pre-selected token for a free (unlocked) box. */
  initialCurve?: Address;
  /** Extra launches not in the static index (newer than its build). */
  extra?: IndexedLaunch[];
  onDone?: () => void;
};

export type TokenMeta = { symbol: string; name: string; decimals: number; token: Address };

const WETH_META: TokenMeta = { symbol: "WETH", name: "Wrapped Ether", decimals: 18, token: WETH };

export const SwapBox = ({ wallet, onConnect, index, curve: fixedCurve, initialCurve, preset, extra = [], onDone }: Props) => {
  const [curve, setCurve] = useState<Address | undefined>(fixedCurve ?? initialCurve);
  const [sell, setSell] = useState(false);
  const [amount, setAmount] = useState("0.0002");
  const [slippage, setSlippage] = useState(100);
  const [route, setRoute] = useState<Route>();
  const [meta, setMeta] = useState<TokenMeta>();
  const [q, setQ] = useState<Quote>();
  const [qErr, setQErr] = useState<string>();
  const [bal, setBal] = useState<{ eth: bigint; weth: bigint; token: bigint }>();
  const [step, setStep] = useState<string>();
  const [done, setDone] = useState<string>();
  const [err, setErr] = useState<string>();
  const [ack, setAck] = useState(false);
  const [picking, setPicking] = useState(false);

  const launches = useMemo(() => [...(index?.launches ?? []), ...extra], [index, extra]);
  const launch = launches.find((l) => l.curve.toLowerCase() === curve?.toLowerCase());
  const blocked = launch ? index?.configs[launch.configId]?.verdict === "blocked" : false;

  useEffect(() => {
    if (fixedCurve) setCurve(fixedCurve);
  }, [fixedCurve]);

  // Resolve the venue and token metadata whenever the token changes.
  const presetKey = preset ? `${preset.route.kind}:${preset.route.curve}:${preset.route.kind === "pool" ? preset.route.pool : ""}` : "";
  const presetRef = useRef(preset);
  presetRef.current = preset;
  useEffect(() => {
    const preset = presetRef.current;
    if (preset && curve && preset.route.curve.toLowerCase() === curve.toLowerCase()) {
      setRoute(preset.route);
      setMeta(preset.meta);
      return;
    }
    setRoute(undefined);
    setMeta(undefined);
    if (!curve) return;
    let live = true;
    resolveRoute(curve)
      .then(async (r) => {
        const [symbol, name, decimals] = await Promise.all([
          publicClient.readContract({ address: r.token, abi: erc20Abi, functionName: "symbol" }),
          publicClient.readContract({ address: r.token, abi: erc20Abi, functionName: "name" }),
          publicClient.readContract({ address: r.token, abi: erc20Abi, functionName: "decimals" }),
        ]);
        if (live) {
          setRoute(r);
          setMeta({ symbol, name, decimals, token: r.token });
        }
      })
      .catch((e) => live && setQErr(shortError(e)));
    return () => {
      live = false;
    };
  }, [curve, presetKey]);

  const tokenIn = sell ? meta : WETH_META;
  const tokenOut = sell ? WETH_META : meta;

  useEffect(() => {
    if (!wallet) return setBal(undefined);
    void Promise.all([
      publicClient.getBalance({ address: wallet.address }),
      publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
      meta ? publicClient.readContract({ address: meta.token, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }) : 0n,
    ]).then(([eth, weth, token]) => setBal({ eth, weth, token }));
  }, [wallet, meta, done]);

  useEffect(() => {
    setQ(undefined);
    setQErr(undefined);
    if (!route || !tokenIn) return;
    let raw: bigint;
    try {
      raw = parseUnits(amount || "0", tokenIn.decimals);
    } catch {
      return setQErr("Enter a number");
    }
    if (raw === 0n) return;
    let live = true;
    const t = setTimeout(() => {
      quote(route, sell, raw, slippage).then(
        (r) => live && setQ(r),
        (e) => live && setQErr(shortError(e)),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [route, sell, amount, slippage, tokenIn]);

  const balanceOf = (m?: TokenMeta) => (!bal || !m ? undefined : m.token === WETH ? bal.weth : bal.token);

  const go = async () => {
    if (!wallet) return onConnect();
    if (!route || !tokenIn) return;
    setErr(undefined);
    setDone(undefined);
    try {
      const hash = await execute(wallet, route, sell, parseUnits(amount, tokenIn.decimals), slippage, setStep);
      setDone(hash);
      onDone?.();
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
      const { hash } = await wrapEth(wallet, parseUnits(amount || "0", 18));
      setDone(hash);
    } catch (e) {
      setErr(shortError(e));
    } finally {
      setStep(undefined);
    }
  };

  const needsAck = blocked && !sell && route?.kind === "curve";
  const routeLabel =
    route?.kind === "pool" ? `Ammora ${route.model} pool` : route?.kind === "curve" ? "Bonding curve" : route?.kind === "none" ? "Waiting for graduation" : "…";

  const TokenChip = ({ m, pickable }: { m?: TokenMeta; pickable: boolean }) => (
    <button
      type="button"
      className={`token-chip ${pickable ? "pickable" : ""}`}
      onClick={() => pickable && setPicking(true)}
      disabled={!pickable}
    >
      {m ? (
        m.token === WETH ? (
          <span className="avatar weth" aria-hidden>
            Ξ
          </span>
        ) : (
          <Avatar seed={m.token} symbol={m.symbol} />
        )
      ) : null}
      <span>{m?.symbol ?? (curve ? "…" : "Select token")}</span>
      {pickable && <i aria-hidden>▾</i>}
    </button>
  );

  const pickable = !fixedCurve;
  return (
    <section className="panel glow swapbox">
      <div className="row-between">
        <h2>Swap</h2>
        <label className="slip">
          Slippage
          <select value={slippage} onChange={(e) => setSlippage(Number(e.target.value))}>
            <option value={50}>0.5%</option>
            <option value={100}>1%</option>
            <option value={300}>3%</option>
            <option value={500}>5%</option>
          </select>
        </label>
      </div>

      <div className="leg">
        <div className="leg-top">
          <span>You pay</span>
          {balanceOf(tokenIn) !== undefined && tokenIn && (
            <button className="link" onClick={() => setAmount(formatUnits(balanceOf(tokenIn)!, tokenIn.decimals))}>
              Balance {fmt(balanceOf(tokenIn)!, tokenIn.decimals)} · Max
            </button>
          )}
        </div>
        <div className="leg-main">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} aria-label="Amount to pay" />
          <TokenChip m={tokenIn} pickable={pickable && sell} />
        </div>
      </div>

      <button className="flip" onClick={() => setSell((s) => !s)} aria-label="Flip direction" title="Flip">
        ↓↑
      </button>

      <div className="leg">
        <div className="leg-top">
          <span>You receive</span>
          {balanceOf(tokenOut) !== undefined && tokenOut && <span className="muted">Balance {fmt(balanceOf(tokenOut)!, tokenOut.decimals)}</span>}
        </div>
        <div className="leg-main">
          <div className={`out ${q ? "" : "muted"}`}>
            {qErr ? <span className="bad-text small">{qErr}</span> : q && tokenOut ? fmt(q.amountOut, tokenOut.decimals, 6) : "0"}
          </div>
          <TokenChip m={tokenOut} pickable={pickable && !sell} />
        </div>
      </div>

      {curve && (
        <dl className="kv small">
          <dt>Route</dt>
          <dd>
            {routeLabel} {launch && (launch.status === 3 || route?.kind === "pool" ? <Verdict ok>Graduated</Verdict> : <Verdict ok={!blocked} />)}
          </dd>
          {q?.minimumOut !== undefined && tokenOut && (
            <>
              <dt>Minimum received</dt>
              <dd>
                {fmt(q.minimumOut, tokenOut.decimals, 6)} {tokenOut.symbol}
              </dd>
            </>
          )}
          {q?.fee !== undefined && q.fee > 0n && tokenIn && (
            <>
              <dt>Fee</dt>
              <dd>{fmt(q.fee, route?.kind === "curve" ? tokenIn.decimals : 18, 4)}</dd>
            </>
          )}
          {q?.priceImpactBps != null && (
            <>
              <dt>Price impact</dt>
              <dd className={q.priceImpactBps > 500 ? "bad-text" : ""}>{(q.priceImpactBps / 100).toFixed(2)}%</dd>
            </>
          )}
          {q?.finalFill && tokenIn && (
            <>
              <dt>Final fill</dt>
              <dd>
                {fmt(q.amountLeft, tokenIn.decimals)} {tokenIn.symbol} is returned
              </dd>
            </>
          )}
        </dl>
      )}

      {needsAck && (
        <label className="ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I understand this launch cannot graduate and my WETH may stay locked in the curve.</span>
        </label>
      )}

      <button
        className="btn primary full lg"
        disabled={!!step || (!!wallet && (!q || !route || route.kind === "none" || (needsAck && !ack)))}
        onClick={go}
      >
        {step ?? (!wallet ? "Connect wallet" : !curve ? "Select a token" : sell ? `Sell ${meta?.symbol ?? ""}` : `Buy ${meta?.symbol ?? ""}`)}
      </button>

      {!sell && bal && (
        <p className="muted small">
          Paid in WETH. You have {fmt(bal.weth, 18)} WETH and {fmt(bal.eth, 18)} ETH
          {bal.weth === 0n ? "; missing WETH is wrapped from ETH first (one extra confirmation)." : "."}{" "}
          <button className="link" onClick={wrap} disabled={!!step}>
            Wrap {amount} ETH now
          </button>
        </p>
      )}
      {done && (
        <Notice kind="ok">
          Confirmed: <TxLink hash={done} />
        </Notice>
      )}
      {err && <Notice kind="error">{err}</Notice>}

      {picking && (
        <TokenPicker
          launches={launches}
          index={index}
          onPick={(c) => {
            setCurve(c);
            setPicking(false);
            if (!fixedCurve) window.history.replaceState(null, "", `#/swap/${c}`);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
};

const TokenPicker = ({
  launches,
  index,
  onPick,
  onClose,
}: {
  launches: IndexedLaunch[];
  index?: IndexFile;
  onPick: (curve: Address) => void;
  onClose: () => void;
}) => {
  const [qText, setQText] = useState("");
  const list = useMemo(() => {
    const q = qText.trim().toLowerCase();
    return [...launches]
      .reverse()
      .filter((l) => l.status !== 2)
      .filter((l) => !q || `${l.symbol} ${l.name} ${l.token}`.toLowerCase().includes(q))
      .slice(0, 80);
  }, [launches, qText]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Select a token" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Select a token</h2>
          <button className="link" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <input autoFocus placeholder="Search name, symbol or paste address" value={qText} onChange={(e) => setQText(e.target.value)} />
        <ul className="pick-list">
          {list.map((l) => {
            const bad = index?.configs[l.configId]?.verdict === "blocked";
            return (
              <li key={l.curve}>
                <button onClick={() => onPick(l.curve as Address)}>
                  <Avatar seed={l.token} symbol={l.symbol} />
                  <span className="pick-name">
                    <b>{l.symbol || "?"}</b>
                    <span>{l.name}</span>
                  </span>
                  <span className="pick-meta">
                    {l.status === 3 ? <Verdict ok>Graduated</Verdict> : <Verdict ok={!bad} />}
                    <span className="muted small">
                      {STATUS_LABEL[l.status]} · {short(l.token)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="muted center small">No tradable launch matches.</li>}
        </ul>
      </div>
    </div>
  );
};

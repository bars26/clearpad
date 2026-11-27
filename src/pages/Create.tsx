import { useEffect, useMemo, useState } from "react";
import type { IndexFile } from "../lib/indexTypes";
import { loadConfig, shortError, type ConfigView } from "../lib/launch";
import { WETH, createLaunch, type Wallet } from "../lib/wallet";
import { CheckList, Notice, TxLink, Verdict, fmt } from "../ui";

const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export const Create = ({ index, wallet, onConnect }: { index?: IndexFile; wallet?: Wallet; onConnect: () => void }) => {
  const options = useMemo(
    () =>
      index
        ? Object.values(index.configs)
            .filter((c) => c.quoteToken.toLowerCase() === WETH.toLowerCase())
            .sort((a, b) => a.id - b.id)
        : [],
    [index],
  );
  const usable = options.filter((c) => c.enabled && c.verdict === "ready");
  const [configId, setConfigId] = useState<number>();
  const [view, setView] = useState<ConfigView>();
  const [viewErr, setViewErr] = useState<string>();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [step, setStep] = useState<string>();
  const [err, setErr] = useState<string>();
  const [result, setResult] = useState<{ hash: string; curve: string }>();

  useEffect(() => {
    if (configId === undefined && usable.length) setConfigId(usable.find((c) => c.id === 10)?.id ?? usable[0]!.id);
  }, [usable, configId]);

  useEffect(() => {
    if (configId === undefined) return;
    setView(undefined);
    setViewErr(undefined);
    loadConfig(BigInt(configId)).then(setView, (e) => setViewErr(shortError(e)));
  }, [configId]);

  if (!index) return <p className="muted">Loading Configs…</p>;

  const metadataURI = `data:application/json;base64,${toBase64(
    JSON.stringify({ name, symbol, description: description || undefined, image: image || undefined, createdWith: "clearpad" }),
  )}`;
  const valid = name.trim().length >= 2 && /^[A-Z0-9]{2,10}$/.test(symbol) && (!image || /^https:\/\//.test(image));
  const ready = view?.readiness.verdict === "ready";

  const submit = async () => {
    if (!wallet) return onConnect();
    if (configId === undefined) return;
    setErr(undefined);
    setResult(undefined);
    try {
      const r = await createLaunch(wallet, { configId: BigInt(configId), name: name.trim(), symbol, metadataURI }, setStep);
      setResult({ hash: r.hash, curve: r.curve });
    } catch (e) {
      setErr(shortError(e));
    } finally {
      setStep(undefined);
    }
  };

  const c = view?.snapshot.config;
  return (
    <div className="cols create">
      <div>
        <h1>Create a token</h1>
        <p className="muted">
          Pick a Config, name your token, sign once. Before the wallet prompt, Clearpad re-reads the Config at the current
          block, replays the graduation math and simulates the create call. If any check fails, no signature is requested.
        </p>

        <section className="panel">
          <h2>1. Launch policy</h2>
          <label className="field">
            <span>Config (WETH quote)</span>
            <select value={configId ?? ""} onChange={(e) => setConfigId(Number(e.target.value))}>
              {options.map((o) => (
                <option key={o.id} value={o.id} disabled={!o.enabled || o.verdict !== "ready"}>
                  #{o.id} · {o.migrationMode === 0 ? "concentrated" : "compounding"} · target{" "}
                  {fmt(o.threshold, 18)} WETH
                  {!o.enabled ? " · disabled" : o.verdict !== "ready" ? " · BLOCKED: cannot graduate" : ""}
                </option>
              ))}
            </select>
          </label>
          {viewErr && <Notice kind="error">{viewErr}</Notice>}
          {!view && !viewErr && <p className="muted">Reading Config #{configId} live…</p>}
          {view && c && (
            <>
              <div className="row-between">
                <span className="muted">
                  Supply {fmt(c.totalSupply, c.tokenDecimals)} · {c.tokenDecimals} decimals · creation fee{" "}
                  {fmt(c.poolCreationFee, 18)} ETH
                </span>
                <Verdict ok={ready} />
              </div>
              <CheckList checks={[...view.readiness.checks, ...view.flags]} />
            </>
          )}
        </section>
      </div>

      <div>
        <section className="panel sticky">
          <h2>2. Token</h2>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Clear Sky" />
          </label>
          <label className="field">
            <span>Symbol</span>
            <input
              value={symbol}
              maxLength={10}
              onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="SKY"
            />
          </label>
          <label className="field">
            <span>Description (optional)</span>
            <textarea value={description} maxLength={200} rows={3} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            <span>Image URL (optional, https)</span>
            <input value={image} onChange={(e) => setImage(e.target.value.trim())} placeholder="https://…" />
          </label>
          <p className="muted small">Metadata is stored on-chain as a data URI. Keep it short.</p>
          <button className="btn primary full" disabled={!!step || (!!wallet && (!valid || !ready))} onClick={submit}>
            {step ?? (!wallet ? "Connect wallet" : !ready ? "Config is blocked" : "Check & create")}
          </button>
          {err && <Notice kind="error">{err}</Notice>}
          {result && (
            <Notice kind="ok">
              Created: <TxLink hash={result.hash} /> · <a href={`#/token/${result.curve}`}>Open token page →</a>
            </Notice>
          )}
        </section>
      </div>
    </div>
  );
};

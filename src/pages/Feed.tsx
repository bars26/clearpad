import { useMemo, useState } from "react";
import type { IndexFile, IndexedLaunch } from "../lib/indexTypes";
import { STATUS_LABEL } from "../lib/launch";
import { Notice, Progress, Verdict, short } from "../ui";

type Filter = "all" | "safe" | "stuck";

const progressOf = (l: IndexedLaunch) => {
  if (l.status === 3) return 10_000;
  const t = BigInt(l.threshold);
  if (t === 0n) return 0;
  const q = BigInt(l.quoteReserve);
  return Number(((q > t ? t : q) * 10_000n) / t);
};

export const Feed = ({ index, error }: { index?: IndexFile; error?: string }) => {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    return [...index.launches]
      .reverse()
      .filter((l) => {
        const blocked = index.configs[l.configId]?.verdict === "blocked";
        if (filter === "safe" && blocked) return false;
        if (filter === "stuck" && !blocked) return false;
        return !q || `${l.name} ${l.symbol} ${l.token}`.toLowerCase().includes(q);
      });
  }, [index, filter, query]);

  if (error) return <Notice kind="error">Could not load the launch index: {error}</Notice>;
  if (!index) return <p className="muted">Loading launches…</p>;

  const stuck = index.launches.filter((l) => index.configs[l.configId]?.verdict === "blocked");
  const graduated = index.launches.filter((l) => l.status === 3).length;
  const liveTraps = Object.values(index.configs).filter((c) => c.enabled && c.verdict === "blocked");

  return (
    <>
      <section className="hero">
        <h1>Every Ammora launch on GIWA, checked for graduation before you buy.</h1>
        <p>
          A bonding curve can sell out and still fail to graduate. Clearpad replays the curve contract's own{" "}
          <code>migrate()</code> conditions against each launch's Config, and only lets you create tokens on Configs
          that pass.
        </p>
        <div className="stats">
          <div>
            <strong>{index.launches.length}</strong>
            <span>launches indexed</span>
          </div>
          <div>
            <strong>{graduated}</strong>
            <span>graduated</span>
          </div>
          <div className="bad">
            <strong>{stuck.length}</strong>
            <span>can never graduate</span>
          </div>
          <div className="bad">
            <strong>{liveTraps.length}</strong>
            <span>broken Configs still enabled</span>
          </div>
        </div>
        {liveTraps.length > 0 && (
          <Notice kind="error">
            Still accepting new launches with the Config #6 failure:{" "}
            {liveTraps.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <a href={`#/audit/${c.id}`}>Config #{c.id}</a>
              </span>
            ))}
            . Clearpad refuses to create on them.
          </Notice>
        )}
      </section>

      <div className="toolbar">
        <div className="segmented" role="tablist">
          {(["all", "safe", "stuck"] as const).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "safe" ? "Can graduate" : "Cannot graduate"}
            </button>
          ))}
        </div>
        <input placeholder="Search name, symbol or address" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="grid">
        {rows.slice(0, 120).map((l) => {
          const cfg = index.configs[l.configId];
          const blocked = cfg?.verdict === "blocked";
          return (
            <a key={l.curve} className={`card ${blocked ? "card-bad" : ""}`} href={`#/token/${l.curve}`}>
              <div className="card-head">
                <div>
                  <strong>{l.symbol || "?"}</strong>
                  <span className="muted"> {l.name}</span>
                </div>
                {l.status === 3 ? <Verdict ok>Graduated</Verdict> : <Verdict ok={!blocked} />}
              </div>
              <Progress bps={progressOf(l)} />
              <div className="card-foot muted">
                <span>{STATUS_LABEL[l.status] ?? `Status ${l.status}`}</span>
                <span>{(progressOf(l) / 100).toFixed(1)}%</span>
                <span>Config #{l.configId}</span>
                <span className="mono">{short(l.token)}</span>
              </div>
            </a>
          );
        })}
      </div>
      {rows.length > 120 && <p className="muted center">Showing the newest 120 of {rows.length}. Search to narrow down.</p>}
      <p className="muted center small">
        Index built {new Date(index.generatedAt).toLocaleString()} at block {index.scannedTo.toLocaleString()}. Token
        pages read live state.
      </p>
    </>
  );
};

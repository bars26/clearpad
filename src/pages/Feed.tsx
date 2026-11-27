import { useMemo, useState } from "react";
import type { IndexFile, IndexedLaunch } from "../lib/indexTypes";
import { STATUS_LABEL } from "../lib/launch";
import { Avatar, CountUp, Notice, Ring, Verdict, short } from "../ui";

type Filter = "all" | "live" | "graduated" | "stuck";

const progressOf = (l: IndexedLaunch) => {
  if (l.status === 3) return 10_000;
  const t = BigInt(l.threshold);
  if (t === 0n) return 0;
  const q = BigInt(l.quoteReserve);
  return Number(((q > t ? t : q) * 10_000n) / t);
};

/** Two curves leave the same start: one clears the flag into a pool, one hits a broken bridge. */
const HeroArt = () => (
  <div className="hero-art" aria-hidden>
    <span className="orb a" />
    <span className="orb b" />
    <svg viewBox="0 0 460 400">
      <defs>
        <linearGradient id="ha-good" x1="0" x2="1">
          <stop offset="0" stopColor="#7938FB" />
          <stop offset="0.5" stopColor="#49C9F4" />
          <stop offset="1" stopColor="#66F3AC" />
        </linearGradient>
        <linearGradient id="ha-bad" x1="0" x2="1">
          <stop offset="0" stopColor="#7938FB" />
          <stop offset="1" stopColor="#FF6B8B" />
        </linearGradient>
      </defs>
      <g stroke="rgba(255,255,255,.07)">
        {[80, 140, 200, 260, 320].map((y) => (
          <line key={y} x1="30" x2="430" y1={y} y2={y} strokeDasharray="3 7" />
        ))}
      </g>
      {/* good curve */}
      <path className="ha-line" d="M40 330 C 150 325, 230 250, 300 120" fill="none" stroke="url(#ha-good)" strokeWidth="5" strokeLinecap="round" />
      <path className="ha-line delay" d="M300 120 L 420 120" fill="none" stroke="#66F3AC" strokeWidth="5" strokeLinecap="round" />
      <circle className="ha-dot" r="7" fill="#fff">
        <animateMotion dur="5s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.7;1" calcMode="linear" path="M40 330 C 150 325, 230 250, 300 120 L 420 120" />
      </circle>
      {/* bad curve */}
      <path className="ha-line" d="M40 330 C 160 328, 240 290, 300 220" fill="none" stroke="url(#ha-bad)" strokeWidth="4" strokeLinecap="round" opacity=".85" />
      <path d="M312 220 L 338 220 M 368 220 L 420 220" stroke="#FF6B8B" strokeWidth="4" strokeLinecap="round" strokeDasharray="5 7" />
      <text x="346" y="214" fill="#FF6B8B" fontWeight="800" fontSize="16">✕</text>
      {/* flags */}
      <line x1="300" x2="300" y1="350" y2="96" stroke="rgba(255,255,255,.2)" strokeWidth="2" />
      <path d="M300 96 l22 7 l-22 7 z" fill="#66F3AC" />
      <g fontFamily="Manrope, sans-serif" fontWeight="700" fontSize="13">
        <rect x="318" y="134" width="104" height="26" rx="13" fill="rgba(102,243,172,.14)" />
        <text x="332" y="151" fill="#66F3AC">✓ graduates</text>
        <rect x="318" y="236" width="104" height="26" rx="13" fill="rgba(255,107,139,.14)" />
        <text x="331" y="253" fill="#FF6B8B">✕ gets stuck</text>
        <text x="40" y="372" fill="rgba(255,255,255,.35)" fontSize="12">same start · different Config</text>
      </g>
    </svg>
  </div>
);

export const Feed = ({ index, error }: { index?: IndexFile; error?: string }) => {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    return [...index.launches].reverse().filter((l) => {
      const blocked = index.configs[l.configId]?.verdict === "blocked";
      if (filter === "live" && (blocked || l.status === 3)) return false;
      if (filter === "graduated" && l.status !== 3) return false;
      if (filter === "stuck" && !blocked) return false;
      return !q || `${l.name} ${l.symbol} ${l.token}`.toLowerCase().includes(q);
    });
  }, [index, filter, query]);

  if (error) return <Notice kind="error">Could not load the launch index: {error}</Notice>;

  const stuck = index ? index.launches.filter((l) => index.configs[l.configId]?.verdict === "blocked") : [];
  const graduated = index ? index.launches.filter((l) => l.status === 3).length : 0;
  const liveTraps = index ? Object.values(index.configs).filter((c) => c.enabled && c.verdict === "blocked") : [];

  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">Ammora SDK · GIWA Sepolia</span>
          <h1>
            Launch tokens that <span className="grad-text">actually graduate.</span>
          </h1>
          <p className="lede">
            A bonding curve can sell out and still fail to reach its pool. Clearpad replays the curve contract's own{" "}
            <code>migrate()</code> math on every Config and every launch, and never asks you to sign one that's doomed.
          </p>
          <div className="hero-cta">
            <a className="btn primary lg" href="#/create">
              Launch a token
            </a>
            <a className="btn lg" href="#/about">
              How the check works
            </a>
          </div>
        </div>
        <HeroArt />
      </section>

      {!index ? (
        <p className="muted">Loading launches…</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <strong>
                <CountUp value={index.launches.length} />
              </strong>
              <span>launches checked</span>
            </div>
            <div className="stat good">
              <strong>
                <CountUp value={graduated} />
              </strong>
              <span>graduated to a pool</span>
            </div>
            <div className="stat bad">
              <strong>
                <CountUp value={stuck.length} />
              </strong>
              <span>can never graduate</span>
            </div>
            <div className="stat bad">
              <strong>
                <CountUp value={liveTraps.length} />
              </strong>
              <span>broken Configs still open</span>
            </div>
          </div>

          {liveTraps.length > 0 && (
            <div className="alert">
              <span className="alert-icon">!</span>
              <div>
                <strong>The Config #6 bug is still accepting new launches</strong>
                <p>
                  {liveTraps.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ", "}
                      <a href={`#/audit/${c.id}`}>#{c.id}</a>
                    </span>
                  ))}{" "}
                  sell their whole supply on the curve and leave nothing for the pool. Clearpad won't create on them.
                </p>
              </div>
            </div>
          )}

          <div className="section-head">
            <h2>Launches</h2>
            <span className="muted small">
              Updated {new Date(index.generatedAt).toLocaleString()} · block {index.scannedTo.toLocaleString()}
            </span>
          </div>
          <div className="toolbar">
            <div className="segmented" role="tablist">
              {(
                [
                  ["all", "All"],
                  ["live", "Live & healthy"],
                  ["graduated", "Graduated"],
                  ["stuck", "Stuck"],
                ] as const
              ).map(([f, label]) => (
                <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {label}
                </button>
              ))}
            </div>
            <input placeholder="Search name, symbol or address" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="grid">
            {rows.slice(0, 120).map((l, i) => {
              const blocked = index.configs[l.configId]?.verdict === "blocked";
              const bps = progressOf(l);
              const done = l.status === 3;
              return (
                <a
                  key={l.curve}
                  className={`card ${blocked ? "card-bad" : ""}`}
                  href={`#/token/${l.curve}`}
                  style={{ animationDelay: `${Math.min(i, 18) * 30}ms` }}
                >
                  <div className="card-title">
                    <Avatar seed={l.token} symbol={l.symbol} />
                    <div>
                      <strong>{l.symbol || "?"}</strong>
                      <span>{l.name}</span>
                    </div>
                  </div>
                  <Ring bps={bps} tone={blocked ? "bad" : done ? "done" : "aurora"} label={done ? "✓" : undefined} />
                  <div className="card-foot">
                    {done ? <Verdict ok>Graduated</Verdict> : <Verdict ok={!blocked} />}
                    <span className="tag">{STATUS_LABEL[l.status] ?? `Status ${l.status}`}</span>
                    <span className="tag">Config #{l.configId}</span>
                    <span className="mono">{short(l.token)}</span>
                  </div>
                </a>
              );
            })}
          </div>
          {rows.length === 0 && <p className="muted center">No launches match.</p>}
          {rows.length > 120 && <p className="muted center">Showing the newest 120 of {rows.length}. Search to narrow down.</p>}
        </>
      )}
    </>
  );
};
